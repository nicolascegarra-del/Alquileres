#!/usr/bin/env python3
"""KLYP Alquileres: servidor web + API. Solo usa la biblioteca estándar de Python.

Datos en SQLite (DATA_DIR/klyp.db); PDF de las facturas de suministros en DATA_DIR/uploads.
"""
import base64
import calendar
import hashlib
import hmac
import json
import os
import re
import secrets
import smtplib
import sqlite3
import ssl
import sys
import threading
import time
import traceback
from datetime import date, timedelta
from email.message import EmailMessage
from email.utils import formataddr, make_msgid
from http.cookies import SimpleCookie
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlsplit

BASE = os.path.dirname(os.path.abspath(__file__))


def load_env_file():
    """Lee un .env opcional junto al servidor (útil en local; en Coolify se usan variables de entorno)."""
    path = os.path.join(BASE, ".env")
    if not os.path.isfile(path):
        return
    with open(path, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                os.environ.setdefault(k.strip(), v.strip())


load_env_file()

PUBLIC = os.path.join(BASE, "public")
DATA_DIR = os.environ.get("DATA_DIR", os.path.join(BASE, "data"))
UPLOADS = os.path.join(DATA_DIR, "uploads")
DB_PATH = os.path.join(DATA_DIR, "klyp.db")
PORT = int(os.environ.get("PORT", "3000"))
COOKIE = "klyp_s"
SESSION_SECONDS = 365 * 24 * 3600
MAX_BODY = 8 * 1024 * 1024
MAX_PDF = 5 * 1024 * 1024
MODULES = ("pagos", "suministros", "inmuebles")
KINDS = ("luz", "agua", "otro")
MONTHS_BACK = 23  # se muestran como mucho 24 meses por inmueble
CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
TYPES = {
    ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8", ".json": "application/json",
    ".webmanifest": "application/manifest+json", ".png": "image/png",
    ".svg": "image/svg+xml", ".ico": "image/x-icon", ".jpg": "image/jpeg",
}


def ym_of(iso):
    return int(iso[:4]) * 12 + int(iso[5:7]) - 1


def ym_first(ym):
    return f"{ym // 12:04d}-{ym % 12 + 1:02d}-01"


def rent_at(rows, ym):
    """Renta vigente en un mes: la última fila de `rents` que empieza en ese mes o antes."""
    cur = rows[0]["rent"]
    for r in rows:
        if r["from_ym"] <= ym:
            cur = r["rent"]
    return cur


def raised(rent, pct):
    return round(rent * (1 + pct / 100))


def month_info(c, rr, ym, due_day, override=None):
    """Lo que toca pagar a un inquilino en un mes. Si entra o sale ese mes, se reparte por días.

    Devuelve (importe en céntimos, días que ha vivido allí si no es el mes entero, día de cobro de ese mes)."""
    y, m = ym // 12, ym % 12 + 1
    dim = calendar.monthrange(y, m)[1]
    first, last = date(y, m, 1), date(y, m, dim)
    a = max(first, date.fromisoformat(c["start_date"]))
    b = min(last, date.fromisoformat(c["end_date"])) if c["end_date"] else last
    days = (b - a).days + 1
    base = rent_at(rr, ym)
    amount = base if days >= dim else round(base * days / dim)
    # Si entra a mitad de mes, ese mes paga el día que entra; si sale antes del día de cobro, el día que sale.
    due = min(max(due_day, a.day), b.day)
    return (amount if override is None else override), (None if days >= dim else days), due


class ApiError(Exception):
    def __init__(self, status, msg):
        super().__init__(msg)
        self.status = status
        self.msg = msg


def norm_phone(raw):
    d = re.sub(r"\D", "", str(raw or ""))
    if len(d) == 11 and d.startswith("34"):
        d = d[2:]
    return d if 9 <= len(d) <= 15 else ""


ADMIN_PHONES = {norm_phone(p) for p in os.environ.get("ADMIN_PHONE", "").split(",")} - {""}
SUPPORT_CONTACT = os.environ.get("SUPPORT_CONTACT", "").strip()[:120]
RESET_SECONDS = 24 * 3600


def valid_pin(pin):
    if not 6 <= len(pin) <= 100:
        raise ApiError(400, "La clave debe tener al menos 6 números o letras.")


def hash_pin(pin, salt=None):
    salt = salt or secrets.token_bytes(16)
    h = hashlib.scrypt(pin.encode("utf-8"), salt=salt, n=2 ** 14, r=8, p=1, dklen=32)
    return salt.hex() + ":" + h.hex()


def check_pin(pin, stored):
    try:
        salt = bytes.fromhex(stored.split(":")[0])
    except ValueError:
        return False
    return hmac.compare_digest(hash_pin(pin, salt), stored)


def db():
    con = sqlite3.connect(DB_PATH, timeout=10)
    con.row_factory = sqlite3.Row
    con.execute("PRAGMA foreign_keys=ON")
    return con


def init_db():
    os.makedirs(UPLOADS, exist_ok=True)
    con = db()
    con.execute("PRAGMA journal_mode=WAL")
    con.executescript("""
    CREATE TABLE IF NOT EXISTS plans(
      id INTEGER PRIMARY KEY, name TEXT NOT NULL, price TEXT NOT NULL DEFAULT '',
      max_properties INTEGER, max_helpers INTEGER, sort INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS users(
      id INTEGER PRIMARY KEY, name TEXT NOT NULL, phone TEXT NOT NULL UNIQUE, pass_hash TEXT NOT NULL,
      plan_id INTEGER NOT NULL REFERENCES plans(id), blocked INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL, last_seen TEXT);
    CREATE TABLE IF NOT EXISTS sessions(
      token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id), expires_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS resets(
      user_id INTEGER PRIMARY KEY REFERENCES users(id), code_hash TEXT NOT NULL, expires_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS members(
      owner_id INTEGER NOT NULL REFERENCES users(id), user_id INTEGER NOT NULL REFERENCES users(id),
      role TEXT NOT NULL, PRIMARY KEY(owner_id, user_id));
    CREATE TABLE IF NOT EXISTS invites(
      code TEXT PRIMARY KEY, owner_id INTEGER NOT NULL REFERENCES users(id),
      name TEXT NOT NULL, role TEXT NOT NULL, created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS properties(
      id INTEGER PRIMARY KEY, owner_id INTEGER NOT NULL REFERENCES users(id),
      alias TEXT NOT NULL DEFAULT '', address TEXT NOT NULL, tenant TEXT NOT NULL, phone TEXT NOT NULL DEFAULT '',
      rent INTEGER NOT NULL, due_day INTEGER NOT NULL, start_ym INTEGER NOT NULL,
      archived INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS payments(
      property_id INTEGER NOT NULL REFERENCES properties(id), ym INTEGER NOT NULL,
      paid_on TEXT NOT NULL, amount INTEGER NOT NULL, PRIMARY KEY(property_id, ym));
    """)
    con.executescript("""
    CREATE TABLE IF NOT EXISTS contracts(
      id INTEGER PRIMARY KEY, property_id INTEGER NOT NULL REFERENCES properties(id),
      tenant TEXT NOT NULL, phone TEXT NOT NULL DEFAULT '', start_date TEXT NOT NULL, end_date TEXT,
      created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS rents(
      contract_id INTEGER NOT NULL REFERENCES contracts(id), from_ym INTEGER NOT NULL,
      rent INTEGER NOT NULL, pct REAL, PRIMARY KEY(contract_id, from_ym));
    CREATE TABLE IF NOT EXISTS rent_payments(
      contract_id INTEGER NOT NULL REFERENCES contracts(id), ym INTEGER NOT NULL,
      paid_on TEXT NOT NULL, amount INTEGER NOT NULL, PRIMARY KEY(contract_id, ym));
    CREATE TABLE IF NOT EXISTS utilities(
      id INTEGER PRIMARY KEY, property_id INTEGER NOT NULL REFERENCES properties(id),
      contract_id INTEGER NOT NULL REFERENCES contracts(id), kind TEXT NOT NULL, label TEXT NOT NULL DEFAULT '',
      amount INTEGER NOT NULL, bill_date TEXT NOT NULL, file TEXT NOT NULL, created_at TEXT NOT NULL,
      sent_at TEXT, paid_on TEXT);
    CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS month_amounts(
      contract_id INTEGER NOT NULL REFERENCES contracts(id), ym INTEGER NOT NULL,
      amount INTEGER NOT NULL, PRIMARY KEY(contract_id, ym));
    CREATE TABLE IF NOT EXISTS agreements(
      id INTEGER PRIMARY KEY, contract_id INTEGER NOT NULL REFERENCES contracts(id),
      total INTEGER NOT NULL, extra INTEGER NOT NULL, start_ym INTEGER NOT NULL,
      note TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, broken_at TEXT);
    CREATE TABLE IF NOT EXISTS agreement_months(
      agreement_id INTEGER NOT NULL REFERENCES agreements(id), contract_id INTEGER NOT NULL REFERENCES contracts(id),
      ym INTEGER NOT NULL, amount INTEGER NOT NULL, PRIMARY KEY(contract_id, ym));
    CREATE TABLE IF NOT EXISTS agreement_payments(
      id INTEGER PRIMARY KEY, agreement_id INTEGER NOT NULL REFERENCES agreements(id),
      paid_on TEXT NOT NULL, amount INTEGER NOT NULL);
    """)
    for table, col, ddl in (("properties", "utilities", "INTEGER NOT NULL DEFAULT 0"), ("members", "perms", "TEXT"),
                            ("invites", "perms", "TEXT"), ("users", "disabled", "TEXT NOT NULL DEFAULT ''"),
                            ("users", "is_admin", "INTEGER NOT NULL DEFAULT 0"),
                            ("utilities", "agreement_id", "INTEGER"), ("contracts", "email", "TEXT NOT NULL DEFAULT ''"),
                            ("utilities", "email_sent_at", "TEXT"), ("utilities", "email_error", "TEXT"),
                            ("users", "max_props", "INTEGER")):
        if col not in [c["name"] for c in con.execute(f"PRAGMA table_info({table})")]:
            con.execute(f"ALTER TABLE {table} ADD COLUMN {col} {ddl}")
    # Datos de la primera versión (un inquilino fijo por inmueble) -> contratos.
    for p in con.execute("SELECT * FROM properties WHERE tenant<>'' AND id NOT IN (SELECT property_id FROM contracts)").fetchall():
        cur = con.execute("INSERT INTO contracts(property_id, tenant, phone, start_date, created_at) VALUES(?,?,?,?,?)",
                          (p["id"], p["tenant"], p["phone"], ym_first(p["start_ym"]), p["created_at"]))
        con.execute("INSERT INTO rents(contract_id, from_ym, rent) VALUES(?,?,?)", (cur.lastrowid, p["start_ym"], p["rent"]))
        con.execute("INSERT INTO rent_payments(contract_id, ym, paid_on, amount) "
                    "SELECT ?, ym, paid_on, amount FROM payments WHERE property_id=?", (cur.lastrowid, p["id"]))
    if not con.execute("SELECT 1 FROM plans").fetchone():
        con.executemany(
            "INSERT INTO plans(name, price, max_properties, max_helpers, sort) VALUES(?,?,?,?,?)",
            [("Gratis", "0 €", 1, 0, 1), ("Básico", "4,99 € al mes", 5, 1, 2), ("Pro", "9,99 € al mes", None, 5, 3)])
    con.commit()
    con.close()


FAILS = {}
FAILS_LOCK = threading.Lock()


def too_many_fails(phone):
    with FAILS_LOCK:
        rec = FAILS.get(phone)
        if rec and time.time() - rec[1] > 900:
            FAILS.pop(phone, None)
            rec = None
        return bool(rec and rec[0] >= 5)


def note_fail(phone):
    with FAILS_LOCK:
        rec = FAILS.get(phone)
        if rec:
            rec[0] += 1
        else:
            FAILS[phone] = [1, time.time()]


def cur_ym():
    t = date.today()
    return t.year * 12 + t.month - 1


def text(data, key, maxlen, required=None):
    v = str(data.get(key) or "").strip()[:maxlen]
    if required and not v:
        raise ApiError(400, required)
    return v


def day(data, key, required=None):
    v = str(data.get(key) or "").strip()
    if not v:
        if required:
            raise ApiError(400, required)
        return None
    try:
        return date.fromisoformat(v).isoformat()
    except ValueError:
        raise ApiError(400, "Revise la fecha.")


def money(data, key, msg):
    try:
        v = round(float(str(data.get(key)).replace(",", ".")) * 100)
    except (TypeError, ValueError):
        raise ApiError(400, msg)
    if not 0 < v <= 100_000_000:
        raise ApiError(400, msg)
    return v


def clean_perms(raw):
    if not isinstance(raw, dict):
        raise ApiError(400, "Elija qué puede hacer.")
    out = {}
    for m in MODULES:
        v = raw.get(m, 0)
        if v not in (0, 1, 2):
            raise ApiError(400, "Elija qué puede hacer.")
        out[m] = v
    if not any(out.values()):
        raise ApiError(400, "Elija al menos un apartado que pueda ver.")
    return out


def member_perms(row):
    """Permisos de un ayudante por apartado: 0 no lo ve, 1 solo ve, 2 ve y anota."""
    if row["perms"]:
        try:
            saved = json.loads(row["perms"])
            return {m: saved.get(m, 0) for m in MODULES}
        except ValueError:
            pass
    return {m: 1 if row["role"] == "viewer" else 2 for m in MODULES}


def disabled_set(user):
    return {m for m in (user["disabled"] or "").split(",") if m in MODULES}


SMTP_KEYS = ("host", "port", "security", "user", "password", "from_addr", "from_name", "reply_to")


def smtp_config(con):
    cfg = {k: "" for k in SMTP_KEYS}
    for r in con.execute("SELECT key, value FROM settings WHERE key LIKE 'smtp_%'"):
        cfg[r["key"][5:]] = r["value"]
    return cfg


def smtp_ready(cfg):
    return bool(cfg["host"] and cfg["port"] and cfg["from_addr"])


def send_mail(cfg, to, subject, body, attachment=None, filename="factura.pdf"):
    """Envía un correo con el SMTP configurado en /admin. Lanza ApiError con un mensaje claro si falla."""
    msg = EmailMessage()
    msg["From"] = formataddr((cfg["from_name"] or "KLYP Alquileres", cfg["from_addr"]))
    msg["To"] = to
    msg["Subject"] = subject
    msg["Message-ID"] = make_msgid(domain=cfg["from_addr"].split("@")[-1])
    if cfg["reply_to"]:
        msg["Reply-To"] = cfg["reply_to"]
    msg.set_content(body)
    if attachment:
        msg.add_attachment(attachment, maintype="application", subtype="pdf", filename=filename)
    try:
        port = int(cfg["port"])
        ctx = ssl.create_default_context()
        if cfg["security"] == "ssl":
            server = smtplib.SMTP_SSL(cfg["host"], port, timeout=20, context=ctx)
        else:
            server = smtplib.SMTP(cfg["host"], port, timeout=20)
            if cfg["security"] == "starttls":
                server.starttls(context=ctx)
        with server:
            if cfg["user"]:
                server.login(cfg["user"], cfg["password"])
            server.send_message(msg)
    except smtplib.SMTPAuthenticationError:
        raise ApiError(502, "El servidor de correo no acepta el usuario o la contraseña.")
    except smtplib.SMTPRecipientsRefused:
        raise ApiError(502, f"El servidor de correo no acepta la dirección {to}.")
    except (smtplib.SMTPException, OSError, ValueError) as e:
        raise ApiError(502, "No se ha podido enviar el correo: " + (str(e) or e.__class__.__name__)[:200])


def owner_plan(con, owner_id):
    """Plan de un usuario con su límite de inmuebles efectivo: el propio, si el administrador le ha puesto uno, o el del plan."""
    row = con.execute("SELECT p.*, u.max_props FROM plans p JOIN users u ON u.plan_id=p.id WHERE u.id=?", (owner_id,)).fetchone()
    out = plan_json(row)
    if row["max_props"] is not None:
        out["maxProperties"] = row["max_props"]
    out["customLimit"] = row["max_props"] is not None
    return out


def plan_json(p):
    return {"id": p["id"], "name": p["name"], "price": p["price"],
            "maxProperties": p["max_properties"], "maxHelpers": p["max_helpers"]}


def is_admin(u):
    return bool(u["is_admin"]) or u["phone"] in ADMIN_PHONES


def login_id(raw):
    """Identificador de acceso: el móvil o, en las cuentas de administrador creadas por consola, un correo."""
    raw = str(raw or "").strip().lower()
    return raw[:120] if re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", raw) else norm_phone(raw)


def create_admin(email, pin):
    """python server.py crear-admin correo clave  ->  crea esa cuenta de administrador (o le cambia la clave)."""
    ident = login_id(email)
    if "@" not in ident:
        raise SystemExit("Escriba un correo válido.")
    if not 6 <= len(pin) <= 100:
        raise SystemExit("La clave debe tener al menos 6 números o letras.")
    init_db()
    con = db()
    row = con.execute("SELECT id FROM users WHERE phone=?", (ident,)).fetchone()
    if row:
        con.execute("UPDATE users SET pass_hash=?, is_admin=1, blocked=0 WHERE id=?", (hash_pin(pin), row["id"]))
        con.execute("DELETE FROM sessions WHERE user_id=?", (row["id"],))
    else:
        plan = con.execute("SELECT id FROM plans ORDER BY sort DESC, id DESC LIMIT 1").fetchone()
        con.execute("INSERT INTO users(name, phone, pass_hash, plan_id, is_admin, created_at) VALUES(?,?,?,?,1,?)",
                    ("Administrador", ident, hash_pin(pin), plan["id"], date.today().isoformat()))
    con.commit()
    con.close()
    print(f"Administrador listo: {ident}. Entre en /admin con ese correo y su clave.")


def user_json(u):
    return {"id": u["id"], "name": u["name"], "phone": u["phone"], "isAdmin": is_admin(u)}


class Handler(BaseHTTPRequestHandler):
    server_version = "KLYP"

    def log_message(self, fmt, *args):
        pass

    def do_GET(self):
        self.dispatch()

    def do_POST(self):
        self.dispatch()

    def do_PUT(self):
        self.dispatch()

    def do_DELETE(self):
        self.dispatch()

    # ---------- salida ----------
    def send_bytes(self, status, body, ctype, extra=None):
        self.send_response(status)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "same-origin")
        for k, v in (extra or []):
            self.send_header(k, v)
        self.end_headers()
        self.wfile.write(body)

    def send_json(self, status, obj):
        extra = [("Cache-Control", "no-store")] + [("Set-Cookie", c) for c in getattr(self, "_cookies", [])]
        self.send_bytes(status, json.dumps(obj, ensure_ascii=False).encode("utf-8"), "application/json; charset=utf-8", extra)

    def dispatch(self):
        self._cookies = []
        path = urlsplit(self.path).path
        try:
            if path == "/healthz":
                return self.send_bytes(200, b"ok", "text/plain")
            if path.startswith("/api/"):
                con = db()
                try:
                    out = self.api(con, self.command, path)
                    con.commit()
                finally:
                    con.close()
                return self.send_json(200, out if out is not None else {"ok": True})
            if self.command != "GET":
                raise ApiError(405, "Método no permitido.")
            if path.startswith("/factura/"):
                return self.bill(path)
            return self.static(path)
        except ApiError as e:
            self.send_json(e.status, {"error": e.msg})
        except Exception:
            traceback.print_exc()
            self.send_json(500, {"error": "Error del servidor. Inténtelo otra vez."})

    # ---------- entrada ----------
    def body(self):
        length = int(self.headers.get("Content-Length") or 0)
        if length > MAX_BODY:
            raise ApiError(413, "El envío es demasiado grande.")
        if not (self.headers.get("Content-Type") or "").startswith("application/json"):
            raise ApiError(415, "Formato no admitido.")
        if not length:
            return {}
        try:
            data = json.loads(self.rfile.read(length).decode("utf-8"))
        except (ValueError, UnicodeDecodeError):
            raise ApiError(400, "Datos no válidos.")
        if not isinstance(data, dict):
            raise ApiError(400, "Datos no válidos.")
        return data

    def cookie_token(self):
        raw = self.headers.get("Cookie")
        if not raw:
            return None
        try:
            c = SimpleCookie(raw)
        except Exception:
            return None
        return c[COOKIE].value if COOKIE in c else None

    def set_cookie(self, token, max_age):
        secure = "; Secure" if self.headers.get("X-Forwarded-Proto", "").split(",")[0].strip() == "https" else ""
        self._cookies.append(f"{COOKIE}={token}; Path=/; Max-Age={max_age}; HttpOnly; SameSite=Lax{secure}")

    def start_session(self, con, user_id):
        token = secrets.token_urlsafe(32)
        con.execute("INSERT INTO sessions(token_hash, user_id, expires_at) VALUES(?,?,?)",
                    (hashlib.sha256(token.encode()).hexdigest(), user_id, int(time.time()) + SESSION_SECONDS))
        self.set_cookie(token, SESSION_SECONDS)

    def current_user(self, con):
        token = self.cookie_token()
        if not token:
            raise ApiError(401, "Entre con su móvil y su clave.")
        row = con.execute(
            "SELECT u.* FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>?",
            (hashlib.sha256(token.encode()).hexdigest(), int(time.time()))).fetchone()
        if not row:
            raise ApiError(401, "Entre con su móvil y su clave.")
        if row["blocked"]:
            raise ApiError(403, "Esta cuenta está desactivada. Póngase en contacto con KLYP.")
        today = date.today().isoformat()
        if row["last_seen"] != today:
            con.execute("UPDATE users SET last_seen=? WHERE id=?", (today, row["id"]))
        return row

    def cartera(self, con, user):
        raw = (self.headers.get("X-Cartera") or "").strip()
        owner_id = int(raw) if raw.isdigit() else user["id"]
        row = None
        if owner_id != user["id"]:
            row = con.execute("SELECT role, perms FROM members WHERE owner_id=? AND user_id=?", (owner_id, user["id"])).fetchone()
        if row:
            role, lv = "helper", member_perms(row)
        else:
            owner_id, role, lv = user["id"], "owner", {m: 2 for m in MODULES}
        for m in disabled_set(user):  # apartados que el administrador le ha quitado a este usuario
            lv[m] = 0
        return owner_id, role, lv

    # ---------- API ----------
    def api(self, con, m, path):
        seg = path.strip("/").split("/")[1:]
        r = seg[0] if seg else ""
        data = self.body() if m != "GET" else {}

        if r == "plans" and m == "GET":
            return {"plans": [plan_json(p) for p in con.execute("SELECT * FROM plans ORDER BY sort, id")]}
        if r == "register" and m == "POST":
            return self.register(con, data)
        if r == "login" and m == "POST":
            return self.login(con, data)
        if r == "info" and m == "GET":
            return {"support": SUPPORT_CONTACT}
        if r == "reset" and m == "POST":
            return self.reset(con, data)
        if r == "logout" and m == "POST":
            token = self.cookie_token()
            if token:
                con.execute("DELETE FROM sessions WHERE token_hash=?", (hashlib.sha256(token.encode()).hexdigest(),))
            self.set_cookie("", 0)
            return None

        user = self.current_user(con)
        if r == "me" and m == "GET":
            return {"user": user_json(user)}
        if r == "password" and m == "POST":
            pin = str(data.get("pin") or "")
            if not check_pin(str(data.get("current") or ""), user["pass_hash"]):
                raise ApiError(400, "La clave actual no es correcta.")
            valid_pin(pin)
            self.set_pin(con, user["id"], pin)
            return None
        if r == "admin":
            return self.admin(con, m, seg[1:], data, user)
        if r == "invites" and seg[1:] == ["accept"] and m == "POST":
            return self.accept_invite(con, data, user)

        owner_id, role, lv = self.cartera(con, user)
        if r == "state" and m == "GET":
            return self.state(con, user, owner_id, role, lv)

        if r == "properties":
            self.need_edit(lv, "inmuebles")
            if m == "POST" and len(seg) == 1:
                return self.save_property(con, owner_id, None, data)
            pid = self.int_seg(seg, 1)
            prop = con.execute("SELECT * FROM properties WHERE id=? AND owner_id=? AND archived=0", (pid, owner_id)).fetchone()
            if not prop:
                raise ApiError(404, "Ese inmueble ya no existe.")
            if m == "PUT" and len(seg) == 2:
                return self.save_property(con, owner_id, prop, data)
            if m == "DELETE" and len(seg) == 2:
                con.execute("UPDATE properties SET archived=1 WHERE id=?", (pid,))
                return None
            if m == "POST" and seg[2:] == ["contracts"]:
                return self.save_contract(con, prop, None, data)

        if r == "contracts":
            cid = self.int_seg(seg, 1)
            c = con.execute("SELECT c.* FROM contracts c JOIN properties p ON p.id=c.property_id "
                            "WHERE c.id=? AND p.owner_id=? AND p.archived=0", (cid, owner_id)).fetchone()
            if not c:
                raise ApiError(404, "Ese contrato ya no existe.")
            if m == "POST" and seg[2:] == ["pay"]:
                self.need_edit(lv, "pagos")
                return self.pay(con, c, data)
            if m == "POST" and seg[2:] == ["amount"]:
                self.need_edit(lv, "pagos")
                return self.set_amount(con, c, data)
            if m == "POST" and seg[2:] == ["agreements"]:
                self.need_edit(lv, "pagos")
                return self.new_agreement(con, c, data)
            self.need_edit(lv, "inmuebles")
            if m == "PUT" and len(seg) == 2:
                return self.save_contract(con, None, c, data)
            if m == "DELETE" and len(seg) == 2:
                return self.delete_contract(con, c)
            if m == "POST" and seg[2:] == ["ipc"]:
                return self.set_ipc(con, c, data)
            if m == "DELETE" and seg[2:] == ["ipc"]:
                con.execute("DELETE FROM rents WHERE contract_id=? AND from_ym>? AND pct IS NOT NULL", (cid, cur_ym()))
                return None

        if r == "agreements":
            self.need_edit(lv, "pagos")
            aid = self.int_seg(seg, 1)
            ag = con.execute("SELECT a.* FROM agreements a JOIN contracts c ON c.id=a.contract_id "
                             "JOIN properties p ON p.id=c.property_id WHERE a.id=? AND p.owner_id=?", (aid, owner_id)).fetchone()
            if not ag:
                raise ApiError(404, "Ese acuerdo ya no existe.")
            if m == "POST" and seg[2:] == ["payments"]:
                amount = money(data, "amount", "Escriba cuánto ha pagado.")
                left = ag["total"] - con.execute("SELECT COALESCE(SUM(amount),0) FROM agreement_payments WHERE agreement_id=?",
                                                 (aid,)).fetchone()[0]
                if left <= 0:
                    raise ApiError(400, "Este acuerdo ya está pagado del todo.")
                if amount > left:
                    raise ApiError(400, f"Solo le quedan {left / 100:.2f} € por pagar de este acuerdo.".replace(".", ",", 1))
                cur = con.execute("INSERT INTO agreement_payments(agreement_id, paid_on, amount) VALUES(?,?,?)",
                                  (aid, day(data, "date") or date.today().isoformat(), amount))
                return {"id": cur.lastrowid}
            if m == "DELETE" and len(seg) == 4 and seg[2] == "payments":
                con.execute("DELETE FROM agreement_payments WHERE id=? AND agreement_id=?", (self.int_seg(seg, 3), aid))
                return None
            if m == "POST" and seg[2:] == ["broken"]:
                con.execute("UPDATE agreements SET broken_at=? WHERE id=?",
                            (date.today().isoformat() if data.get("broken", True) else None, aid))
                return None
            if m == "DELETE" and len(seg) == 2:
                if con.execute("SELECT 1 FROM agreement_payments WHERE agreement_id=?", (aid,)).fetchone():
                    raise ApiError(400, "Este acuerdo ya tiene pagos anotados. Quítelos primero o márquelo como no cumplido.")
                con.execute("DELETE FROM agreement_months WHERE agreement_id=?", (aid,))
                con.execute("UPDATE utilities SET agreement_id=NULL WHERE agreement_id=?", (aid,))
                con.execute("DELETE FROM agreements WHERE id=?", (aid,))
                return None

        if r == "utilities":
            self.need_edit(lv, "suministros")
            if m == "POST" and len(seg) == 1:
                return self.new_utility(con, owner_id, data)
            uid = self.int_seg(seg, 1)
            u = con.execute("SELECT u.* FROM utilities u JOIN properties p ON p.id=u.property_id "
                            "WHERE u.id=? AND p.owner_id=?", (uid, owner_id)).fetchone()
            if not u:
                raise ApiError(404, "Esa factura ya no existe.")
            today = date.today().isoformat()
            if u["agreement_id"] and m in ("POST", "DELETE") and seg[2:] in (["paid"], []):
                raise ApiError(400, "Esta factura está dentro de un acuerdo de pago: anote los pagos en el acuerdo.")
            if m == "POST" and seg[2:] == ["paid"]:
                con.execute("UPDATE utilities SET paid_on=? WHERE id=?", (today if data.get("paid", True) else None, uid))
                return None
            if m == "POST" and seg[2:] == ["email"]:
                return self.email_utility(con, owner_id, u)
            if m == "POST" and seg[2:] == ["sent"]:
                con.execute("UPDATE utilities SET sent_at=? WHERE id=?", (today, uid))
                return None
            if m == "DELETE" and len(seg) == 2:
                con.execute("DELETE FROM utilities WHERE id=?", (uid,))
                try:
                    os.remove(os.path.join(UPLOADS, u["file"]))
                except OSError:
                    pass
                return None

        if r in ("invites", "helpers"):
            if role != "owner":
                raise ApiError(403, "Solo el propietario puede cambiar quién le ayuda.")
            if r == "invites" and m == "POST" and len(seg) == 1:
                return self.new_invite(con, owner_id, data)
            if r == "invites" and m == "DELETE" and len(seg) == 2:
                con.execute("DELETE FROM invites WHERE code=? AND owner_id=?", (seg[1], owner_id))
                return None
            if r == "helpers" and m == "PUT" and len(seg) == 2:
                con.execute("UPDATE members SET perms=? WHERE owner_id=? AND user_id=?",
                            (json.dumps(clean_perms(data.get("perms"))), owner_id, self.int_seg(seg, 1)))
                return None
            if r == "helpers" and m == "DELETE" and len(seg) == 2:
                con.execute("DELETE FROM members WHERE owner_id=? AND user_id=?", (owner_id, self.int_seg(seg, 1)))
                return None

        raise ApiError(404, "No encontrado.")

    @staticmethod
    def int_seg(seg, i):
        if len(seg) <= i or not seg[i].isdigit():
            raise ApiError(404, "No encontrado.")
        return int(seg[i])

    @staticmethod
    def need_edit(lv, module):
        if lv[module] < 2:
            raise ApiError(403, "No tiene permiso para anotar en este apartado.")

    def register(self, con, data):
        name = text(data, "name", 60)
        phone = norm_phone(data.get("phone"))
        pin = str(data.get("pin") or "")
        if len(name) < 2:
            raise ApiError(400, "Escriba su nombre.")
        if not phone:
            raise ApiError(400, "Escriba un número de móvil válido.")
        valid_pin(pin)
        if con.execute("SELECT 1 FROM users WHERE phone=?", (phone,)).fetchone():
            raise ApiError(409, "Ya hay una cuenta con ese móvil. Pulse «Entrar».")
        plan = con.execute("SELECT id FROM plans ORDER BY sort, id LIMIT 1").fetchone()
        cur = con.execute("INSERT INTO users(name, phone, pass_hash, plan_id, created_at) VALUES(?,?,?,?,?)",
                          (name, phone, hash_pin(pin), plan["id"], date.today().isoformat()))
        self.start_session(con, cur.lastrowid)
        return None

    def login(self, con, data):
        phone = login_id(data.get("phone"))
        pin = str(data.get("pin") or "")
        if too_many_fails(phone):
            raise ApiError(429, "Demasiados intentos. Espere 15 minutos y pruebe otra vez.")
        user = con.execute("SELECT * FROM users WHERE phone=?", (phone,)).fetchone() if phone else None
        if not user or not check_pin(pin, user["pass_hash"]):
            note_fail(phone)
            raise ApiError(401, "El móvil o la clave no son correctos.")
        if user["blocked"]:
            raise ApiError(403, "Esta cuenta está desactivada. Póngase en contacto con KLYP.")
        with FAILS_LOCK:
            FAILS.pop(phone, None)
        self.start_session(con, user["id"])
        return None

    def set_pin(self, con, user_id, pin):
        """Guarda la clave nueva, cierra las demás sesiones y deja abierta la de este dispositivo."""
        con.execute("UPDATE users SET pass_hash=? WHERE id=?", (hash_pin(pin), user_id))
        con.execute("DELETE FROM sessions WHERE user_id=?", (user_id,))
        con.execute("DELETE FROM resets WHERE user_id=?", (user_id,))
        self.start_session(con, user_id)

    def reset(self, con, data):
        phone = norm_phone(data.get("phone"))
        code = re.sub(r"[^A-Z0-9]", "", str(data.get("code") or "").upper())
        pin = str(data.get("pin") or "")
        key = "reset:" + phone
        if too_many_fails(key):
            raise ApiError(429, "Demasiados intentos. Espere 15 minutos y pruebe otra vez.")
        row = con.execute(
            "SELECT u.id, u.blocked, r.code_hash FROM users u JOIN resets r ON r.user_id=u.id "
            "WHERE u.phone=? AND r.expires_at>?", (phone, int(time.time()))).fetchone() if phone and code else None
        if not row or not hmac.compare_digest(row["code_hash"], hashlib.sha256(code.encode()).hexdigest()):
            note_fail(key)
            raise ApiError(400, "El móvil o el código no son correctos, o el código ha caducado.")
        if row["blocked"]:
            raise ApiError(403, "Esta cuenta está desactivada. Póngase en contacto con KLYP.")
        valid_pin(pin)
        with FAILS_LOCK:
            FAILS.pop(key, None)
            FAILS.pop(phone, None)
        self.set_pin(con, row["id"], pin)
        return None

    def state(self, con, user, owner_id, role, lv):
        now = cur_ym()
        today = date.today().isoformat()
        owner = con.execute("SELECT * FROM users WHERE id=?", (owner_id,)).fetchone()
        show_pay = lv["pagos"] >= 1
        show_rent = show_pay or lv["inmuebles"] >= 1
        rents, pays, contracts = {}, {}, {}
        due_days = {p["id"]: p["due_day"] for p in con.execute("SELECT id, due_day FROM properties WHERE owner_id=?", (owner_id,))}
        overrides, covered, ags = {}, {}, {}
        for o in con.execute("SELECT ma.* FROM month_amounts ma JOIN contracts c ON c.id=ma.contract_id "
                             "JOIN properties p ON p.id=c.property_id WHERE p.owner_id=?", (owner_id,)):
            overrides[(o["contract_id"], o["ym"])] = o["amount"]
        for o in con.execute("SELECT am.* FROM agreement_months am JOIN contracts c ON c.id=am.contract_id "
                             "JOIN properties p ON p.id=c.property_id WHERE p.owner_id=?", (owner_id,)):
            covered[(o["contract_id"], o["ym"])] = o["agreement_id"]
        if show_pay:
            apays = {}
            for a in con.execute("SELECT ap.* FROM agreement_payments ap JOIN agreements a ON a.id=ap.agreement_id "
                                 "JOIN contracts c ON c.id=a.contract_id JOIN properties p ON p.id=c.property_id "
                                 "WHERE p.owner_id=? ORDER BY ap.paid_on, ap.id", (owner_id,)):
                apays.setdefault(a["agreement_id"], []).append({"id": a["id"], "paidOn": a["paid_on"], "amount": a["amount"] / 100})
            for a in con.execute("SELECT a.* FROM agreements a JOIN contracts c ON c.id=a.contract_id "
                                 "JOIN properties p ON p.id=c.property_id WHERE p.owner_id=? ORDER BY a.id", (owner_id,)):
                ags.setdefault(a["contract_id"], []).append({
                    "id": a["id"], "total": a["total"] / 100, "extra": a["extra"] / 100, "startYm": a["start_ym"],
                    "note": a["note"], "createdAt": a["created_at"], "brokenAt": a["broken_at"],
                    "payments": apays.get(a["id"], [])})
        for r in con.execute(
                "SELECT r.* FROM rents r JOIN contracts c ON c.id=r.contract_id JOIN properties p ON p.id=c.property_id "
                "WHERE p.owner_id=? ORDER BY r.from_ym", (owner_id,)):
            rents.setdefault(r["contract_id"], []).append(r)
        for p in con.execute(
                "SELECT pa.* FROM rent_payments pa JOIN contracts c ON c.id=pa.contract_id JOIN properties p ON p.id=c.property_id "
                "WHERE p.owner_id=?", (owner_id,)):
            pays[(p["contract_id"], p["ym"])] = p["paid_on"]
        for c in con.execute(
                "SELECT c.* FROM contracts c JOIN properties p ON p.id=c.property_id "
                "WHERE p.owner_id=? AND p.archived=0 ORDER BY c.start_date", (owner_id,)):
            rr = rents[c["id"]]
            s = ym_of(c["start_date"])
            e = ym_of(c["end_date"]) if c["end_date"] else None
            last = now if e is None else min(e, now)
            nxt = next((r for r in rr if r["from_ym"] > now and r["pct"] is not None), None)
            contracts.setdefault(c["property_id"], []).append({
                "id": c["id"], "tenant": c["tenant"], "phone": c["phone"], "email": c["email"],
                "startDate": c["start_date"], "endDate": c["end_date"],
                "active": c["start_date"] <= today and (not c["end_date"] or c["end_date"] >= today),
                "rent": rent_at(rr, max(s, last)) / 100 if show_rent else None,
                "nextRaise": {"pct": nxt["pct"], "fromYm": nxt["from_ym"], "rent": nxt["rent"] / 100} if nxt and show_rent else None,
                "agreements": ags.get(c["id"], []),
                "months": [self.month_json(c, rr, ym, due_days[c["property_id"]], overrides, pays, covered)
                           for ym in range(max(s, now - MONTHS_BACK), last + 1)] if show_pay else []})
        props = [{"id": p["id"], "alias": p["alias"], "address": p["address"], "dueDay": p["due_day"],
                  "utilities": bool(p["utilities"]), "contracts": contracts.get(p["id"], [])}
                 for p in con.execute("SELECT * FROM properties WHERE owner_id=? AND archived=0 ORDER BY id", (owner_id,))]
        utilities = [] if lv["suministros"] < 1 else [
            {"id": u["id"], "propertyId": u["property_id"], "contractId": u["contract_id"], "kind": u["kind"],
             "label": u["label"], "amount": u["amount"] / 100, "billDate": u["bill_date"], "url": "/factura/" + u["file"], "agreementId": u["agreement_id"],
             "createdAt": u["created_at"], "sentAt": u["sent_at"], "paidOn": u["paid_on"],
             "emailSentAt": u["email_sent_at"], "emailError": u["email_error"]}
            for u in con.execute(
                "SELECT u.* FROM utilities u JOIN properties p ON p.id=u.property_id "
                "WHERE p.owner_id=? AND p.archived=0 ORDER BY u.id DESC LIMIT 400", (owner_id,))]
        carteras = [{"ownerId": user["id"], "name": user["name"], "role": "owner"}] + [
            {"ownerId": c["owner_id"], "name": c["name"], "role": "helper"} for c in con.execute(
                "SELECT m.owner_id, u.name FROM members m JOIN users u ON u.id=m.owner_id WHERE m.user_id=?",
                (user["id"],))]
        out = {"user": user_json(user), "today": today,
               "cartera": {"ownerId": owner_id, "ownerName": owner["name"], "role": role, "perms": lv},
               "carteras": carteras, "plan": owner_plan(con, owner_id), "properties": props,
               "utilities": utilities, "mailReady": smtp_ready(smtp_config(con)), "helpers": [], "invites": []}
        if role == "owner":
            out["helpers"] = [{"userId": h["user_id"], "name": h["name"], "phone": h["phone"], "perms": member_perms(h)}
                              for h in con.execute(
                                  "SELECT m.user_id, m.role, m.perms, u.name, u.phone FROM members m JOIN users u ON u.id=m.user_id "
                                  "WHERE m.owner_id=?", (owner_id,))]
            out["invites"] = [{"code": i["code"], "name": i["name"], "perms": member_perms(i)}
                              for i in con.execute("SELECT * FROM invites WHERE owner_id=? ORDER BY created_at", (owner_id,))]
        return out

    @staticmethod
    def month_json(c, rr, ym, due_day, overrides, pays, covered):
        key = (c["id"], ym)
        amount, days, due = month_info(c, rr, ym, due_day, overrides.get(key))
        return {"ym": ym, "rent": amount / 100, "days": days, "due": due, "custom": key in overrides,
                "paidOn": pays.get(key), "agreementId": covered.get(key)}

    def save_property(self, con, owner_id, prop, data):
        alias = text(data, "alias", 40)
        address = text(data, "address", 120, "Escriba la dirección.")
        utilities = 1 if data.get("utilities") else 0
        if "suministros" in disabled_set(con.execute("SELECT disabled FROM users WHERE id=?", (owner_id,)).fetchone()):
            utilities = prop["utilities"] if prop else 0
        try:
            due = int(data.get("dueDay"))
        except (TypeError, ValueError):
            raise ApiError(400, "Revise el día de cobro.")
        if not 1 <= due <= 28:
            raise ApiError(400, "El día de cobro debe estar entre 1 y 28.")
        if prop:
            con.execute("UPDATE properties SET alias=?, address=?, due_day=?, utilities=? WHERE id=?",
                        (alias, address, due, utilities, prop["id"]))
            return {"id": prop["id"]}
        plan = owner_plan(con, owner_id)
        count = con.execute("SELECT COUNT(*) FROM properties WHERE owner_id=? AND archived=0", (owner_id,)).fetchone()[0]
        if plan["maxProperties"] is not None and count >= plan["maxProperties"]:
            n = plan["maxProperties"]
            quien = "Su cuenta" if plan["customLimit"] else f"El plan {plan['name']}"
            raise ApiError(403, f"{quien} permite {n} {'inmueble' if n == 1 else 'inmuebles'}. "
                                "Para añadir más, póngase en contacto con KLYP.")
        # tenant, phone, rent y start_ym son columnas de la primera versión: ya no se usan (ver contracts).
        cur = con.execute(
            "INSERT INTO properties(owner_id, alias, address, tenant, rent, due_day, start_ym, utilities, created_at) "
            "VALUES(?,?,?,'',0,?,?,?,?)",
            (owner_id, alias, address, due, cur_ym(), utilities, date.today().isoformat()))
        new = con.execute("SELECT * FROM properties WHERE id=?", (cur.lastrowid,)).fetchone()
        self.save_contract(con, new, None, data)
        return {"id": new["id"]}

    def save_contract(self, con, prop, c, data):
        """Alta (prop) o cambio (c) de un contrato: un inquilino con sus fechas y su renta."""
        tenant = text(data, "tenant", 80, "Escriba el nombre del inquilino.")
        phone = text(data, "phone", 30)
        email = text(data, "email", 120).lower()
        if email and not re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", email):
            raise ApiError(400, "Revise el correo del inquilino.")
        rent = money(data, "rent", "Escriba la renta al mes.")
        start = day(data, "startDate", "Escriba la fecha en que empieza el contrato.")
        end = day(data, "endDate")
        if end and end < start:
            raise ApiError(400, "La fecha de fin no puede ser anterior a la de inicio.")
        pid = prop["id"] if prop else c["property_id"]
        now = cur_ym()
        if not c:
            # El inquilino anterior, si seguía sin fecha de salida, termina la víspera.
            con.execute("UPDATE contracts SET end_date=? WHERE property_id=? AND end_date IS NULL AND start_date<?",
                        ((date.fromisoformat(start) - timedelta(days=1)).isoformat(), pid, start))
        for o in con.execute("SELECT * FROM contracts WHERE property_id=? AND id<>?", (pid, c["id"] if c else 0)):
            if start <= (o["end_date"] or "9999") and o["start_date"] <= (end or "9999"):
                raise ApiError(400, f"Esas fechas se pisan con las de {o['tenant']}. Revise cuándo sale uno y entra el otro.")
        if c:
            con.execute("UPDATE contracts SET tenant=?, phone=?, email=?, start_date=?, end_date=? WHERE id=?",
                        (tenant, phone, email, start, end, c["id"]))
            rr = con.execute("SELECT * FROM rents WHERE contract_id=? ORDER BY from_ym", (c["id"],)).fetchall()
            ref = max(ym_of(start), now if not end else min(now, ym_of(end)))
            if rent_at(rr, ref) != rent:
                # La renta nueva vale desde este mes; las subidas ya programadas se recalculan sobre ella.
                frm = rr[0]["from_ym"] if ref <= rr[0]["from_ym"] else ref
                con.execute("INSERT OR REPLACE INTO rents(contract_id, from_ym, rent, pct) VALUES(?,?,?,NULL)", (c["id"], frm, rent))
                for r in rr:
                    if r["from_ym"] > frm and r["pct"] is not None:
                        con.execute("UPDATE rents SET rent=? WHERE contract_id=? AND from_ym=?",
                                    (raised(rent, r["pct"]), c["id"], r["from_ym"]))
            return {"id": c["id"]}
        cur = con.execute("INSERT INTO contracts(property_id, tenant, phone, email, start_date, end_date, created_at) "
                          "VALUES(?,?,?,?,?,?,?)", (pid, tenant, phone, email, start, end, date.today().isoformat()))
        con.execute("INSERT INTO rents(contract_id, from_ym, rent) VALUES(?,?,?)", (cur.lastrowid, ym_of(start), rent))
        if str(data.get("ipcPct") or "").strip():
            new = con.execute("SELECT * FROM contracts WHERE id=?", (cur.lastrowid,)).fetchone()
            self.set_ipc(con, new, {"pct": data.get("ipcPct"), "date": data.get("ipcDate")})
        return {"id": cur.lastrowid}

    def delete_contract(self, con, c):
        if (con.execute("SELECT 1 FROM rent_payments WHERE contract_id=?", (c["id"],)).fetchone()
                or con.execute("SELECT 1 FROM utilities WHERE contract_id=?", (c["id"],)).fetchone()
                or con.execute("SELECT 1 FROM agreements WHERE contract_id=?", (c["id"],)).fetchone()):
            raise ApiError(400, "Este inquilino ya tiene pagos o facturas anotados. Póngale fecha de fin en lugar de quitarlo.")
        con.execute("DELETE FROM rents WHERE contract_id=?", (c["id"],))
        con.execute("DELETE FROM month_amounts WHERE contract_id=?", (c["id"],))
        con.execute("DELETE FROM contracts WHERE id=?", (c["id"],))
        return None

    def set_ipc(self, con, c, data):
        """Programa la subida: desde el mes de esa fecha, la renta es la vigente más el porcentaje."""
        try:
            pct = round(float(str(data.get("pct")).replace(",", ".").replace("%", "")), 2)
        except (TypeError, ValueError):
            raise ApiError(400, "Escriba el porcentaje de subida, por ejemplo 2,8.")
        if not -20 <= pct <= 50 or pct == 0:
            raise ApiError(400, "El porcentaje de subida debe estar entre -20 y 50.")
        frm = ym_of(day(data, "date", "Escriba desde qué fecha se aplica la subida."))
        if frm <= max(cur_ym(), ym_of(c["start_date"])):
            raise ApiError(400, "La subida tiene que empezar en un mes posterior al actual y al de inicio del contrato.")
        if c["end_date"] and frm > ym_of(c["end_date"]):
            raise ApiError(400, "Esa fecha es posterior al fin del contrato.")
        con.execute("DELETE FROM rents WHERE contract_id=? AND from_ym>? AND pct IS NOT NULL", (c["id"], cur_ym()))
        rr = con.execute("SELECT * FROM rents WHERE contract_id=? ORDER BY from_ym", (c["id"],)).fetchall()
        new = raised(rent_at(rr, frm - 1), pct)
        con.execute("INSERT OR REPLACE INTO rents(contract_id, from_ym, rent, pct) VALUES(?,?,?,?)", (c["id"], frm, new, pct))
        return {"rent": new / 100}

    def contract_ym(self, c, data):
        try:
            ym = int(data.get("ym"))
        except (TypeError, ValueError):
            raise ApiError(400, "Mes no válido.")
        last = min(cur_ym(), ym_of(c["end_date"])) if c["end_date"] else cur_ym()
        if not ym_of(c["start_date"]) <= ym <= last:
            raise ApiError(400, "Mes no válido.")
        return ym

    def month_amount(self, con, c, ym):
        rr = con.execute("SELECT * FROM rents WHERE contract_id=? ORDER BY from_ym", (c["id"],)).fetchall()
        due_day = con.execute("SELECT due_day FROM properties WHERE id=?", (c["property_id"],)).fetchone()[0]
        o = con.execute("SELECT amount FROM month_amounts WHERE contract_id=? AND ym=?", (c["id"], ym)).fetchone()
        return month_info(c, rr, ym, due_day, o["amount"] if o else None)

    def pay(self, con, c, data):
        ym = self.contract_ym(c, data)
        if con.execute("SELECT 1 FROM agreement_months WHERE contract_id=? AND ym=?", (c["id"], ym)).fetchone():
            raise ApiError(400, "Ese mes está dentro de un acuerdo de pago: anote los pagos en el acuerdo.")
        if data.get("paid", True):
            con.execute("INSERT OR REPLACE INTO rent_payments(contract_id, ym, paid_on, amount) VALUES(?,?,?,?)",
                        (c["id"], ym, date.today().isoformat(), self.month_amount(con, c, ym)[0]))
        else:
            con.execute("DELETE FROM rent_payments WHERE contract_id=? AND ym=?", (c["id"], ym))
        return None

    def set_amount(self, con, c, data):
        """Corrige a mano lo que toca pagar un mes (por ejemplo, el reparto por días). Vacío: vuelve al calculado."""
        ym = self.contract_ym(c, data)
        if con.execute("SELECT 1 FROM agreement_months WHERE contract_id=? AND ym=?", (c["id"], ym)).fetchone():
            raise ApiError(400, "Ese mes está dentro de un acuerdo de pago y ya no se puede cambiar.")
        if str(data.get("amount") or "").strip():
            con.execute("INSERT OR REPLACE INTO month_amounts(contract_id, ym, amount) VALUES(?,?,?)",
                        (c["id"], ym, money(data, "amount", "Escriba el importe de ese mes.")))
        else:
            con.execute("DELETE FROM month_amounts WHERE contract_id=? AND ym=?", (c["id"], ym))
        con.execute("UPDATE rent_payments SET amount=? WHERE contract_id=? AND ym=?", (self.month_amount(con, c, ym)[0], c["id"], ym))
        return None

    def debt(self, con, c):
        """Meses anteriores al actual sin pagar y facturas sin pagar de un inquilino que todavía no están en ningún acuerdo.
        El mes en curso no entra: su renta se cobra aparte, junto con la primera cuota."""
        now = cur_ym()
        last = min(now, ym_of(c["end_date"])) if c["end_date"] else now
        done = {r["ym"] for r in con.execute("SELECT ym FROM rent_payments WHERE contract_id=? UNION "
                                             "SELECT ym FROM agreement_months WHERE contract_id=?", (c["id"], c["id"]))}
        months = []
        for ym in range(max(ym_of(c["start_date"]), now - MONTHS_BACK), last + 1):
            if ym in done:
                continue
            if ym < now:
                months.append((ym, self.month_amount(con, c, ym)[0]))
        utils = con.execute("SELECT id, amount FROM utilities WHERE contract_id=? AND paid_on IS NULL AND agreement_id IS NULL",
                            (c["id"],)).fetchall()
        return months, utils

    def new_agreement(self, con, c, data):
        """Acuerdo de pago: la deuda de hoy se paga con una cuota al mes, además de la renta si sigue viviendo allí."""
        months, utils = self.debt(con, c)
        if not months and not utils:
            raise ApiError(400, "Este inquilino no tiene deudas pendientes.")
        total = money(data, "total", "Escriba la deuda que se va a pagar con el acuerdo.")
        monthly = money(data, "monthly", "Escriba cuánto pagará al mes.")
        now = cur_ym()
        try:
            start = int(data.get("startYm"))
        except (TypeError, ValueError):
            start = now
        if start not in (now, now + 1):
            raise ApiError(400, "El acuerdo empieza este mes o el que viene.")
        lives = ym_of(c["start_date"]) <= start and (not c["end_date"] or ym_of(c["end_date"]) >= start)
        rent = rent_at(con.execute("SELECT * FROM rents WHERE contract_id=? ORDER BY from_ym", (c["id"],)).fetchall(), start) if lives else 0
        extra = monthly - rent
        if extra <= 0:
            raise ApiError(400, f"Lo que pague al mes tiene que ser más que la renta ({rent / 100:.2f} €) "
                                "para que la deuda vaya bajando.".replace(".", ",", 1))
        cur = con.execute("INSERT INTO agreements(contract_id, total, extra, start_ym, note, created_at) VALUES(?,?,?,?,?,?)",
                          (c["id"], total, extra, start, text(data, "note", 300), date.today().isoformat()))
        aid = cur.lastrowid
        con.executemany("INSERT INTO agreement_months(agreement_id, contract_id, ym, amount) VALUES(?,?,?,?)",
                        [(aid, c["id"], ym, amount) for ym, amount in months])
        con.executemany("UPDATE utilities SET agreement_id=? WHERE id=?", [(aid, u["id"]) for u in utils])
        return {"id": aid}

    def new_utility(self, con, owner_id, data):
        try:
            pid = int(data.get("propertyId"))
        except (TypeError, ValueError):
            raise ApiError(400, "Elija un inmueble.")
        prop = con.execute("SELECT * FROM properties WHERE id=? AND owner_id=? AND archived=0", (pid, owner_id)).fetchone()
        if not prop:
            raise ApiError(404, "Ese inmueble ya no existe.")
        if not prop["utilities"]:
            raise ApiError(400, "Ese inmueble no tiene activadas las facturas de suministros.")
        kind = data.get("kind")
        if kind not in KINDS:
            raise ApiError(400, "Elija de qué es la factura.")
        label = text(data, "label", 40, "Escriba de qué es la factura.") if kind == "otro" else ""
        amount = money(data, "amount", "Escriba el importe de la factura.")
        bill_date = day(data, "billDate", "Escriba la fecha de la factura.")
        c = con.execute("SELECT * FROM contracts WHERE property_id=? AND start_date<=? AND (end_date IS NULL OR end_date>=?)",
                        (pid, bill_date, bill_date)).fetchone()
        if not c:
            raise ApiError(400, "En esa fecha no había ningún inquilino en ese inmueble. Revise la fecha de la factura.")
        raw = data.get("pdf")
        try:
            blob = base64.b64decode(raw, validate=True) if isinstance(raw, str) and raw else b""
        except ValueError:
            blob = b""
        if not blob.startswith(b"%PDF-"):
            raise ApiError(400, "Elija el archivo PDF de la factura.")
        if len(blob) > MAX_PDF:
            raise ApiError(400, "El PDF es demasiado grande (máximo 5 MB).")
        name = secrets.token_hex(16) + ".pdf"
        with open(os.path.join(UPLOADS, name), "wb") as f:
            f.write(blob)
        cur = con.execute(
            "INSERT INTO utilities(property_id, contract_id, kind, label, amount, bill_date, file, created_at) VALUES(?,?,?,?,?,?,?,?)",
            (pid, c["id"], kind, label, amount, bill_date, name, date.today().isoformat()))
        return {"id": cur.lastrowid}

    def email_utility(self, con, owner_id, u):
        cfg = smtp_config(con)
        if not smtp_ready(cfg):
            raise ApiError(400, "El envío de correos no está configurado. Pídaselo al administrador.")
        c = con.execute("SELECT * FROM contracts WHERE id=?", (u["contract_id"],)).fetchone()
        if not c["email"]:
            raise ApiError(400, f"No tiene apuntado el correo de {c['tenant']}. Añádalo en la ficha del inmueble, en «Inquilinos».")
        p = con.execute("SELECT * FROM properties WHERE id=?", (u["property_id"],)).fetchone()
        owner = con.execute("SELECT name FROM users WHERE id=?", (owner_id,)).fetchone()
        kind = {"luz": "luz", "agua": "agua"}.get(u["kind"], u["label"].lower())
        when = "/".join(str(int(x)) for x in reversed(u["bill_date"].split("-")))
        amount = f"{u['amount'] / 100:,.2f}".replace(",", " ").replace(".", ",").replace(" ", ".")
        with open(os.path.join(UPLOADS, u["file"]), "rb") as f:
            pdf = f.read()
        body = (f"Hola {c['tenant'].split()[0]},\n\n"
                f"Le envío la factura de {kind} de {p['address']} con fecha {when}, por importe de {amount} €. "
                "La tiene adjunta en PDF.\n\nQueda pendiente de pago.\n\nUn saludo,\n" + owner["name"])
        today = date.today().isoformat()
        try:
            send_mail(cfg, c["email"], f"Factura de {kind} · {p['address']} · {when}", body, pdf,
                      f"factura-{re.sub(r'[^a-z0-9]+', '-', kind) or 'suministro'}-{u['bill_date']}.pdf")
        except ApiError as e:
            con.execute("UPDATE utilities SET email_error=? WHERE id=?", (e.msg, u["id"]))
            con.commit()
            raise
        con.execute("UPDATE utilities SET email_sent_at=?, email_error=NULL, sent_at=COALESCE(sent_at, ?) WHERE id=?",
                    (today, today, u["id"]))
        return {"to": c["email"]}

    def new_invite(self, con, owner_id, data):
        name = text(data, "name", 60, "Escriba el nombre de la persona.")
        perms = clean_perms(data.get("perms"))
        plan = con.execute("SELECT p.* FROM plans p JOIN users u ON u.plan_id=p.id WHERE u.id=?", (owner_id,)).fetchone()
        used = (con.execute("SELECT COUNT(*) FROM members WHERE owner_id=?", (owner_id,)).fetchone()[0]
                + con.execute("SELECT COUNT(*) FROM invites WHERE owner_id=?", (owner_id,)).fetchone()[0])
        if plan["max_helpers"] is not None and used >= plan["max_helpers"]:
            n = plan["max_helpers"]
            msg = (f"El plan {plan['name']} no incluye personas que le ayuden." if n == 0 else
                   f"El plan {plan['name']} permite {n} {'persona' if n == 1 else 'personas'} que le ayuden.")
            raise ApiError(403, msg + " Para invitar a más hay que cambiar de plan.")
        code = "".join(secrets.choice(CODE_ALPHABET) for _ in range(8))
        con.execute("INSERT INTO invites(code, owner_id, name, role, perms, created_at) VALUES(?,?,?,?,?,?)",
                    (code, owner_id, name, "custom", json.dumps(perms), date.today().isoformat()))
        return {"code": code, "name": name}

    def accept_invite(self, con, data, user):
        code = re.sub(r"[^A-Z0-9]", "", str(data.get("code") or "").upper())
        inv = con.execute("SELECT * FROM invites WHERE code=?", (code,)).fetchone() if code else None
        if not inv:
            raise ApiError(404, "Ese código no es válido o ya se ha usado.")
        if inv["owner_id"] == user["id"]:
            raise ApiError(400, "Ese código es suyo: es para la persona a la que invita.")
        con.execute("INSERT OR REPLACE INTO members(owner_id, user_id, role, perms) VALUES(?,?,?,?)",
                    (inv["owner_id"], user["id"], inv["role"], inv["perms"]))
        con.execute("DELETE FROM invites WHERE code=?", (code,))
        return {"ownerId": inv["owner_id"]}

    def admin(self, con, m, seg, data, user):
        if not is_admin(user):
            raise ApiError(403, "Solo para administradores.")
        if m == "GET" and seg == ["overview"]:
            users = [{
                "id": u["id"], "name": u["name"], "phone": u["phone"], "createdAt": u["created_at"],
                "lastSeen": u["last_seen"], "planId": u["plan_id"], "blocked": bool(u["blocked"]),
                "properties": u["props"], "helpers": u["helpers"], "isAdmin": is_admin(u),
                "disabled": sorted(disabled_set(u)), "maxProps": u["max_props"],
            } for u in con.execute(
                "SELECT u.*, (SELECT COUNT(*) FROM properties p WHERE p.owner_id=u.id AND p.archived=0) AS props, "
                "(SELECT COUNT(*) FROM members m WHERE m.owner_id=u.id) AS helpers FROM users u ORDER BY u.id DESC")]
            plans = [plan_json(p) for p in con.execute("SELECT * FROM plans ORDER BY sort, id")]
            return {"users": users, "plans": plans}
        if seg[:1] == ["smtp"]:
            return self.admin_smtp(con, m, seg[1:], data)
        if m == "GET" and len(seg) == 3 and seg[0] == "users" and seg[2] == "properties":
            uid = self.int_seg(seg, 1)
            today = date.today().isoformat()
            return {"properties": [{
                "alias": p["alias"], "address": p["address"], "utilities": bool(p["utilities"]), "createdAt": p["created_at"],
                "tenant": p["tenant_now"], "bills": p["bills"],
            } for p in con.execute(
                "SELECT p.*, (SELECT c.tenant FROM contracts c WHERE c.property_id=p.id AND c.start_date<=? "
                "AND (c.end_date IS NULL OR c.end_date>=?) LIMIT 1) AS tenant_now, "
                "(SELECT COUNT(*) FROM utilities x WHERE x.property_id=p.id) AS bills "
                "FROM properties p WHERE p.owner_id=? AND p.archived=0 ORDER BY p.id", (today, today, uid))]}
        if m == "POST" and len(seg) == 3 and seg[0] == "users" and seg[2] == "reset":
            uid = self.int_seg(seg, 1)
            target = con.execute("SELECT name FROM users WHERE id=?", (uid,)).fetchone()
            if not target:
                raise ApiError(404, "Ese usuario no existe.")
            code = "".join(secrets.choice(CODE_ALPHABET) for _ in range(8))
            con.execute("INSERT OR REPLACE INTO resets(user_id, code_hash, expires_at) VALUES(?,?,?)",
                        (uid, hashlib.sha256(code.encode()).hexdigest(), int(time.time()) + RESET_SECONDS))
            return {"code": code, "name": target["name"]}
        if m == "PUT" and len(seg) == 2 and seg[0] == "users":
            uid = self.int_seg(seg, 1)
            if not con.execute("SELECT 1 FROM users WHERE id=?", (uid,)).fetchone():
                raise ApiError(404, "Ese usuario no existe.")
            if "planId" in data:
                if not con.execute("SELECT 1 FROM plans WHERE id=?", (data["planId"],)).fetchone():
                    raise ApiError(400, "Ese plan no existe.")
                con.execute("UPDATE users SET plan_id=? WHERE id=?", (data["planId"], uid))
            if "maxProps" in data:
                v = data["maxProps"]
                if v is None or str(v).strip() == "":
                    v = None
                else:
                    try:
                        v = int(v)
                    except (TypeError, ValueError):
                        raise ApiError(400, "El límite debe ser un número.")
                    if v < 0:
                        raise ApiError(400, "El límite no puede ser negativo.")
                con.execute("UPDATE users SET max_props=? WHERE id=?", (v, uid))
            if "disabled" in data:
                off = data["disabled"]
                if not isinstance(off, list) or any(x not in MODULES for x in off):
                    raise ApiError(400, "Apartado no válido.")
                con.execute("UPDATE users SET disabled=? WHERE id=?", (",".join(sorted(set(off))), uid))
            if "blocked" in data:
                if uid == user["id"] and data["blocked"]:
                    raise ApiError(400, "No puede desactivar su propia cuenta.")
                con.execute("UPDATE users SET blocked=? WHERE id=?", (1 if data["blocked"] else 0, uid))
                if data["blocked"]:
                    con.execute("DELETE FROM sessions WHERE user_id=?", (uid,))
            return None
        if m == "PUT" and len(seg) == 2 and seg[0] == "plans":
            pid = self.int_seg(seg, 1)
            if not con.execute("SELECT 1 FROM plans WHERE id=?", (pid,)).fetchone():
                raise ApiError(404, "Ese plan no existe.")

            def limit(key):
                v = data.get(key)
                if v is None or v == "":
                    return None
                try:
                    v = int(v)
                except (TypeError, ValueError):
                    raise ApiError(400, "Los límites deben ser números.")
                if v < 0:
                    raise ApiError(400, "Los límites no pueden ser negativos.")
                return v
            con.execute("UPDATE plans SET name=?, price=?, max_properties=?, max_helpers=? WHERE id=?",
                        (text(data, "name", 30, "El plan necesita un nombre."), text(data, "price", 30),
                         limit("maxProperties"), limit("maxHelpers"), pid))
            return None
        raise ApiError(404, "No encontrado.")

    def admin_smtp(self, con, m, seg, data):
        cfg = smtp_config(con)
        if m == "GET" and not seg:
            out = {k: cfg[k] for k in SMTP_KEYS if k != "password"}
            out["hasPassword"] = bool(cfg["password"])
            out["ready"] = smtp_ready(cfg)
            return out
        if m == "PUT" and not seg:
            new = {"host": text(data, "host", 120), "port": text(data, "port", 5), "security": data.get("security") or "starttls",
                   "user": text(data, "user", 200), "from_addr": text(data, "from_addr", 200).lower(),
                   "from_name": text(data, "from_name", 80), "reply_to": text(data, "reply_to", 200).lower()}
            if new["security"] not in ("ssl", "starttls", "none"):
                raise ApiError(400, "Elija el tipo de seguridad.")
            if new["host"] or new["from_addr"]:
                if not new["host"]:
                    raise ApiError(400, "Escriba el servidor SMTP.")
                if not new["port"].isdigit() or not 1 <= int(new["port"]) <= 65535:
                    raise ApiError(400, "Escriba el puerto (normalmente 587 o 465).")
                for k in ("from_addr", "reply_to"):
                    if new[k] and not re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", new[k]):
                        raise ApiError(400, "Revise las direcciones de correo.")
                if not new["from_addr"]:
                    raise ApiError(400, "Escriba la dirección desde la que se envían los correos.")
            if data.get("clearPassword"):
                new["password"] = ""
            elif str(data.get("password") or ""):
                new["password"] = str(data["password"])[:300]
            con.executemany("INSERT OR REPLACE INTO settings(key, value) VALUES(?,?)", [("smtp_" + k, v) for k, v in new.items()])
            return None
        if m == "POST" and seg == ["test"]:
            to = text(data, "to", 200, "Escriba a qué correo enviar la prueba.")
            if not smtp_ready(cfg):
                raise ApiError(400, "Guarde primero los datos del servidor de correo.")
            send_mail(cfg, to, "Prueba de correo de KLYP Alquileres",
                      "Si lee esto, el envío de correos de KLYP Alquileres funciona.\n\nLas facturas de suministros se enviarán desde esta dirección.")
            return None
        raise ApiError(404, "No encontrado.")

    # ---------- ficheros ----------
    def bill(self, path):
        """PDF de una factura. No pide sesión para que el inquilino pueda abrirlo desde WhatsApp:
        la dirección lleva una clave aleatoria de 128 bits que solo conoce quien recibe el enlace."""
        name = path[len("/factura/"):]
        full = os.path.join(UPLOADS, name)
        if not re.fullmatch(r"[0-9a-f]{32}\.pdf", name) or not os.path.isfile(full):
            raise ApiError(404, "No encontrado.")
        with open(full, "rb") as f:
            self.send_bytes(200, f.read(), "application/pdf", [
                ("Cache-Control", "private, max-age=3600"), ("Content-Disposition", 'inline; filename="factura.pdf"'),
                ("X-Robots-Tag", "noindex")])

    def static(self, path):
        rel = {"/": "index.html", "/app": "app.html", "/admin": "admin.html"}.get(path, path.lstrip("/"))
        root = os.path.realpath(PUBLIC)
        full = os.path.realpath(os.path.join(root, rel))
        if not full.startswith(root + os.sep) or not os.path.isfile(full):
            return self.send_bytes(404, "No encontrado".encode("utf-8"), "text/plain; charset=utf-8")
        ctype = TYPES.get(os.path.splitext(full)[1].lower(), "application/octet-stream")
        with open(full, "rb") as f:
            self.send_bytes(200, f.read(), ctype, [("Cache-Control", "no-cache")])


if __name__ == "__main__":
    if sys.argv[1:2] == ["crear-admin"]:
        if len(sys.argv) != 4:
            raise SystemExit("Uso: python server.py crear-admin correo clave")
        create_admin(sys.argv[2], sys.argv[3])
        raise SystemExit(0)
    init_db()
    server = ThreadingHTTPServer(("0.0.0.0", PORT), Handler)
    server.daemon_threads = True
    print(f"KLYP Alquileres en el puerto {PORT} (datos en {DATA_DIR})", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass

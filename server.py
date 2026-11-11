#!/usr/bin/env python3
"""KLYP Alquileres: servidor web + API. Solo usa la biblioteca estándar de Python.

Datos en SQLite (DATA_DIR/klyp.db) y fotos en DATA_DIR/uploads.
"""
import base64
import hashlib
import hmac
import json
import os
import re
import secrets
import sqlite3
import threading
import time
import traceback
from datetime import date
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
MAX_PHOTO = 3 * 1024 * 1024
MONTHS_BACK = 23  # se muestran como mucho 24 meses por inmueble
CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
TYPES = {
    ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8", ".json": "application/json",
    ".webmanifest": "application/manifest+json", ".png": "image/png",
    ".svg": "image/svg+xml", ".ico": "image/x-icon", ".jpg": "image/jpeg",
}


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
    CREATE TABLE IF NOT EXISTS issues(
      id INTEGER PRIMARY KEY, property_id INTEGER NOT NULL REFERENCES properties(id),
      text TEXT NOT NULL, photo TEXT, created_at TEXT NOT NULL, resolved_at TEXT);
    """)
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


def plan_json(p):
    return {"id": p["id"], "name": p["name"], "price": p["price"],
            "maxProperties": p["max_properties"], "maxHelpers": p["max_helpers"]}


def user_json(u):
    return {"id": u["id"], "name": u["name"], "phone": u["phone"], "isAdmin": u["phone"] in ADMIN_PHONES}


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
            if path.startswith("/uploads/"):
                return self.upload(path)
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
        if owner_id == user["id"]:
            return owner_id, "owner"
        row = con.execute("SELECT role FROM members WHERE owner_id=? AND user_id=?", (owner_id, user["id"])).fetchone()
        if not row:
            return user["id"], "owner"
        return owner_id, row["role"]

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

        owner_id, role = self.cartera(con, user)
        if r == "state" and m == "GET":
            return self.state(con, user, owner_id, role)

        if r == "properties":
            self.need_edit(role)
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
            if m == "POST" and seg[2:] == ["pay"]:
                return self.pay(con, prop, data)

        if r == "issues":
            self.need_edit(role)
            if m == "POST" and len(seg) == 1:
                return self.new_issue(con, owner_id, data)
            if m == "POST" and seg[2:] == ["resolve"]:
                iid = self.int_seg(seg, 1)
                ok = con.execute(
                    "SELECT 1 FROM issues i JOIN properties p ON p.id=i.property_id WHERE i.id=? AND p.owner_id=?",
                    (iid, owner_id)).fetchone()
                if not ok:
                    raise ApiError(404, "Esa avería ya no existe.")
                con.execute("UPDATE issues SET resolved_at=? WHERE id=?",
                            (date.today().isoformat() if data.get("resolved", True) else None, iid))
                return None

        if r in ("invites", "helpers"):
            if role != "owner":
                raise ApiError(403, "Solo el propietario puede cambiar quién le ayuda.")
            if r == "invites" and m == "POST" and len(seg) == 1:
                return self.new_invite(con, owner_id, data)
            if r == "invites" and m == "DELETE" and len(seg) == 2:
                con.execute("DELETE FROM invites WHERE code=? AND owner_id=?", (seg[1], owner_id))
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
    def need_edit(role):
        if role == "viewer":
            raise ApiError(403, "Usted solo puede ver. Pida permiso al propietario para anotar.")

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
        phone = norm_phone(data.get("phone"))
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

    def state(self, con, user, owner_id, role):
        now = cur_ym()
        owner = con.execute("SELECT * FROM users WHERE id=?", (owner_id,)).fetchone()
        plan = con.execute("SELECT * FROM plans WHERE id=?", (owner["plan_id"],)).fetchone()
        pays = {(p["property_id"], p["ym"]): p["paid_on"] for p in con.execute(
            "SELECT pa.property_id, pa.ym, pa.paid_on FROM payments pa JOIN properties pr ON pr.id=pa.property_id "
            "WHERE pr.owner_id=?", (owner_id,))}
        props = []
        for p in con.execute("SELECT * FROM properties WHERE owner_id=? AND archived=0 ORDER BY id", (owner_id,)):
            first = max(p["start_ym"], now - MONTHS_BACK)
            props.append({
                "id": p["id"], "alias": p["alias"], "address": p["address"], "tenant": p["tenant"],
                "phone": p["phone"], "rent": p["rent"] / 100, "dueDay": p["due_day"], "startYm": p["start_ym"],
                "months": [{"ym": ym, "paidOn": pays.get((p["id"], ym))} for ym in range(first, now + 1)]})
        issues = [{"id": i["id"], "propertyId": i["property_id"], "text": i["text"],
                   "photo": ("/uploads/" + i["photo"]) if i["photo"] else None,
                   "createdAt": i["created_at"], "resolvedAt": i["resolved_at"]}
                  for i in con.execute(
                      "SELECT i.* FROM issues i JOIN properties p ON p.id=i.property_id "
                      "WHERE p.owner_id=? AND p.archived=0 ORDER BY i.id DESC LIMIT 300", (owner_id,))]
        carteras = [{"ownerId": user["id"], "name": user["name"], "role": "owner"}] + [
            {"ownerId": c["owner_id"], "name": c["name"], "role": c["role"]} for c in con.execute(
                "SELECT m.owner_id, m.role, u.name FROM members m JOIN users u ON u.id=m.owner_id WHERE m.user_id=?",
                (user["id"],))]
        out = {"user": user_json(user), "today": date.today().isoformat(),
               "cartera": {"ownerId": owner_id, "ownerName": owner["name"], "role": role},
               "carteras": carteras, "plan": plan_json(plan), "properties": props, "issues": issues,
               "helpers": [], "invites": []}
        if role == "owner":
            out["helpers"] = [{"userId": h["user_id"], "name": h["name"], "phone": h["phone"], "role": h["role"]}
                              for h in con.execute(
                                  "SELECT m.user_id, m.role, u.name, u.phone FROM members m JOIN users u ON u.id=m.user_id "
                                  "WHERE m.owner_id=?", (owner_id,))]
            out["invites"] = [{"code": i["code"], "name": i["name"], "role": i["role"]}
                              for i in con.execute("SELECT * FROM invites WHERE owner_id=? ORDER BY created_at", (owner_id,))]
        return out

    def save_property(self, con, owner_id, prop, data):
        alias = text(data, "alias", 40)
        address = text(data, "address", 120, "Escriba la dirección.")
        tenant = text(data, "tenant", 80, "Escriba el nombre del inquilino.")
        phone = text(data, "phone", 30)
        try:
            rent = round(float(str(data.get("rent")).replace(",", ".")) * 100)
            due = int(data.get("dueDay"))
        except (TypeError, ValueError):
            raise ApiError(400, "Revise la renta y el día de cobro.")
        if not 0 < rent <= 100_000_000:
            raise ApiError(400, "Escriba la renta al mes.")
        if not 1 <= due <= 28:
            raise ApiError(400, "El día de cobro debe estar entre 1 y 28.")
        if prop:
            con.execute("UPDATE properties SET alias=?, address=?, tenant=?, phone=?, rent=?, due_day=? WHERE id=?",
                        (alias, address, tenant, phone, rent, due, prop["id"]))
            return {"id": prop["id"]}
        plan = con.execute("SELECT p.* FROM plans p JOIN users u ON u.plan_id=p.id WHERE u.id=?", (owner_id,)).fetchone()
        count = con.execute("SELECT COUNT(*) FROM properties WHERE owner_id=? AND archived=0", (owner_id,)).fetchone()[0]
        if plan["max_properties"] is not None and count >= plan["max_properties"]:
            n = plan["max_properties"]
            raise ApiError(403, f"El plan {plan['name']} permite {n} {'inmueble' if n == 1 else 'inmuebles'}. "
                                "Para añadir más hay que cambiar de plan.")
        now = cur_ym()
        try:
            start = int(data.get("startYm", now))
        except (TypeError, ValueError):
            start = now
        start = min(max(start, now - MONTHS_BACK), now)
        cur = con.execute(
            "INSERT INTO properties(owner_id, alias, address, tenant, phone, rent, due_day, start_ym, created_at) "
            "VALUES(?,?,?,?,?,?,?,?,?)",
            (owner_id, alias, address, tenant, phone, rent, due, start, date.today().isoformat()))
        return {"id": cur.lastrowid}

    def pay(self, con, prop, data):
        try:
            ym = int(data.get("ym"))
        except (TypeError, ValueError):
            raise ApiError(400, "Mes no válido.")
        if not prop["start_ym"] <= ym <= cur_ym():
            raise ApiError(400, "Mes no válido.")
        if data.get("paid", True):
            con.execute("INSERT OR REPLACE INTO payments(property_id, ym, paid_on, amount) VALUES(?,?,?,?)",
                        (prop["id"], ym, date.today().isoformat(), prop["rent"]))
        else:
            con.execute("DELETE FROM payments WHERE property_id=? AND ym=?", (prop["id"], ym))
        return None

    def new_issue(self, con, owner_id, data):
        try:
            pid = int(data.get("propertyId"))
        except (TypeError, ValueError):
            raise ApiError(400, "Elija un inmueble.")
        if not con.execute("SELECT 1 FROM properties WHERE id=? AND owner_id=? AND archived=0", (pid, owner_id)).fetchone():
            raise ApiError(404, "Ese inmueble ya no existe.")
        txt = text(data, "text", 300, "Escriba qué ha pasado.")
        photo = None
        raw = data.get("photo")
        if raw:
            prefix = "data:image/jpeg;base64,"
            if not isinstance(raw, str) or not raw.startswith(prefix):
                raise ApiError(400, "La foto no es válida.")
            try:
                blob = base64.b64decode(raw[len(prefix):], validate=True)
            except ValueError:
                raise ApiError(400, "La foto no es válida.")
            if len(blob) > MAX_PHOTO or blob[:2] != b"\xff\xd8":
                raise ApiError(400, "La foto no es válida o es demasiado grande.")
            photo = secrets.token_hex(16) + ".jpg"
            with open(os.path.join(UPLOADS, photo), "wb") as f:
                f.write(blob)
        cur = con.execute("INSERT INTO issues(property_id, text, photo, created_at) VALUES(?,?,?,?)",
                          (pid, txt, photo, date.today().isoformat()))
        return {"id": cur.lastrowid}

    def new_invite(self, con, owner_id, data):
        name = text(data, "name", 60, "Escriba el nombre de la persona.")
        role = data.get("role")
        if role not in ("editor", "viewer"):
            raise ApiError(400, "Elija qué puede hacer.")
        plan = con.execute("SELECT p.* FROM plans p JOIN users u ON u.plan_id=p.id WHERE u.id=?", (owner_id,)).fetchone()
        used = (con.execute("SELECT COUNT(*) FROM members WHERE owner_id=?", (owner_id,)).fetchone()[0]
                + con.execute("SELECT COUNT(*) FROM invites WHERE owner_id=?", (owner_id,)).fetchone()[0])
        if plan["max_helpers"] is not None and used >= plan["max_helpers"]:
            n = plan["max_helpers"]
            msg = (f"El plan {plan['name']} no incluye personas que le ayuden." if n == 0 else
                   f"El plan {plan['name']} permite {n} {'persona' if n == 1 else 'personas'} que le ayuden.")
            raise ApiError(403, msg + " Para invitar a más hay que cambiar de plan.")
        code = "".join(secrets.choice(CODE_ALPHABET) for _ in range(8))
        con.execute("INSERT INTO invites(code, owner_id, name, role, created_at) VALUES(?,?,?,?,?)",
                    (code, owner_id, name, role, date.today().isoformat()))
        return {"code": code, "name": name}

    def accept_invite(self, con, data, user):
        code = re.sub(r"[^A-Z0-9]", "", str(data.get("code") or "").upper())
        inv = con.execute("SELECT * FROM invites WHERE code=?", (code,)).fetchone() if code else None
        if not inv:
            raise ApiError(404, "Ese código no es válido o ya se ha usado.")
        if inv["owner_id"] == user["id"]:
            raise ApiError(400, "Ese código es suyo: es para la persona a la que invita.")
        con.execute("INSERT OR REPLACE INTO members(owner_id, user_id, role) VALUES(?,?,?)",
                    (inv["owner_id"], user["id"], inv["role"]))
        con.execute("DELETE FROM invites WHERE code=?", (code,))
        return {"ownerId": inv["owner_id"]}

    def admin(self, con, m, seg, data, user):
        if user["phone"] not in ADMIN_PHONES:
            raise ApiError(403, "Solo para administradores.")
        if m == "GET" and seg == ["overview"]:
            users = [{
                "id": u["id"], "name": u["name"], "phone": u["phone"], "createdAt": u["created_at"],
                "lastSeen": u["last_seen"], "planId": u["plan_id"], "blocked": bool(u["blocked"]),
                "properties": u["props"], "helpers": u["helpers"], "isAdmin": u["phone"] in ADMIN_PHONES,
            } for u in con.execute(
                "SELECT u.*, (SELECT COUNT(*) FROM properties p WHERE p.owner_id=u.id AND p.archived=0) AS props, "
                "(SELECT COUNT(*) FROM members m WHERE m.owner_id=u.id) AS helpers FROM users u ORDER BY u.id DESC")]
            plans = [plan_json(p) for p in con.execute("SELECT * FROM plans ORDER BY sort, id")]
            return {"users": users, "plans": plans}
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

    # ---------- ficheros ----------
    def upload(self, path):
        name = path[len("/uploads/"):]
        if not re.fullmatch(r"[0-9a-f]{32}\.jpg", name):
            raise ApiError(404, "No encontrado.")
        con = db()
        try:
            user = self.current_user(con)
            row = con.execute("SELECT p.owner_id FROM issues i JOIN properties p ON p.id=i.property_id WHERE i.photo=?",
                              (name,)).fetchone()
            allowed = row and (row["owner_id"] == user["id"] or con.execute(
                "SELECT 1 FROM members WHERE owner_id=? AND user_id=?", (row["owner_id"], user["id"])).fetchone())
            con.commit()
        finally:
            con.close()
        full = os.path.join(UPLOADS, name)
        if not allowed or not os.path.isfile(full):
            raise ApiError(404, "No encontrado.")
        with open(full, "rb") as f:
            self.send_bytes(200, f.read(), "image/jpeg", [("Cache-Control", "private, max-age=86400")])

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
    init_db()
    server = ThreadingHTTPServer(("0.0.0.0", PORT), Handler)
    server.daemon_threads = True
    print(f"KLYP Alquileres en el puerto {PORT} (datos en {DATA_DIR})", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass

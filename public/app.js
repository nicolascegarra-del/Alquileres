/* KLYP Alquileres: aplicación del propietario. */
(function () {
  'use strict';

  var MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
  var ICON = {
    ok: '<svg class="i" viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
    warn: '<svg class="i" viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/></svg>',
    bad: '<svg class="i" viewBox="0 0 24 24"><path d="M12 5v9"/><path d="M12 18.5v.5"/></svg>',
    none: '<svg class="i" viewBox="0 0 24 24"><path d="M4 11l8-7 8 7v9H4z"/></svg>'
  };
  /* mod: apartado del que depende la pestaña. Cuenta se ve siempre. */
  var TABS = [
    { id: 'pagos', mod: 'pagos', label: 'Pagos', svg: '<svg class="i" viewBox="0 0 24 24"><rect x="3" y="6" width="18" height="13" rx="2.5"/><path d="M3 10.5h18"/><path d="M7 15h4"/></svg>' },
    { id: 'impagos', mod: 'pagos', label: 'Impagos', svg: '<svg class="i" viewBox="0 0 24 24"><path d="M12 4l9 16H3z"/><path d="M12 10v4.5"/><path d="M12 17.5v.2"/></svg>' },
    { id: 'facturas', mod: 'suministros', label: 'Facturas', svg: '<svg class="i" viewBox="0 0 24 24"><path d="M6 3h9l4 4v14H6z"/><path d="M14 3v5h5"/><path d="M9 13h6"/><path d="M9 17h4"/></svg>' },
    { id: 'pisos', mod: 'inmuebles', label: 'Inmuebles', svg: '<svg class="i" viewBox="0 0 24 24"><path d="M4 11l8-7 8 7v9H4z"/><path d="M10 20v-6h4v6"/></svg>' },
    { id: 'averias', mod: 'averias', label: 'Averías', svg: '<svg class="i" viewBox="0 0 24 24"><path d="M14.5 5.5a4.2 4.2 0 0 0-5 5.4L4 16.400 7.600 20l5.500-5.500a4.200 4.200 0 0 0 5.400-5l-2.800 2.800-2.300-.7-.7-2.300z"/></svg>' },
    { id: 'cuenta', label: 'Cuenta', svg: '<svg class="i" viewBox="0 0 24 24"><circle cx="12" cy="8.5" r="3.8"/><path d="M4.5 20c1-3.800 4-5.500 7.500-5.500s6.500 1.700 7.500 5.500"/></svg>' }
  ];
  var MODS = [
    { id: 'pagos', label: 'Pagos e impagos' }, { id: 'suministros', label: 'Facturas de suministros' },
    { id: 'averias', label: 'Averías' }, { id: 'inmuebles', label: 'Inmuebles e inquilinos' }
  ];
  var NIVEL = ['No lo ve', 'Solo puede ver', 'Puede ver y anotar'];
  var TIPOS = { luz: 'Luz', agua: 'Agua' };

  var params = new URLSearchParams(location.search);
  var S = {
    data: null, tab: 'pagos', screen: null, cartera: null,
    auth: params.has('olvido') ? 'olvido' : (params.has('registro') || params.has('invitacion') ? 'registro' : 'login'), support: '',
    invite: (params.get('invitacion') || '').toUpperCase(), err: '', photo: null, confirm: null, busy: false
  };
  try { S.cartera = localStorage.getItem('klyp_cartera'); } catch (e) { /* sin almacenamiento */ }

  var view = document.getElementById('view'), tabsEl = document.getElementById('tabs'), tabsBar = document.getElementById('tabsbar'),
    appEl = document.getElementById('app'), toastEl = document.getElementById('toast'), toastT = null;

  /* ---------- utilidades ---------- */
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function eur(n) {
    n = Math.round(Number(n) * 100) / 100;
    var dec = Number.isInteger(n) ? 0 : 2;
    return n.toLocaleString('es-ES', { minimumFractionDigits: dec, maximumFractionDigits: dec }) + ' €';
  }
  function dias(n) { return n + (n === 1 ? ' día' : ' días'); }
  function nMeses(n) { return n + (n === 1 ? ' mes' : ' meses'); }
  function hoy() { var a = S.data.today.split('-').map(Number); return { y: a[0], m: a[1], d: a[2], ym: a[0] * 12 + a[1] - 1 }; }
  function mes(ym, cap) {
    var t = MESES[ym % 12], y = Math.floor(ym / 12);
    if (y !== hoy().y) t += ' de ' + y;
    return cap ? t.charAt(0).toUpperCase() + t.slice(1) : t;
  }
  function fecha(iso) { var a = iso.split('-').map(Number); return a[2] + ' de ' + MESES[a[1] - 1]; }
  function fechaC(iso) { var a = iso.split('-').map(Number); return a[2] + '/' + a[1] + '/' + a[0]; }
  function nom(p) { return p.alias || p.address; }
  function prop(id) { return S.data.properties.filter(function (p) { return p.id === id; })[0]; }
  function contrato(p, cid) { return p.contracts.filter(function (c) { return c.id === cid; })[0]; }
  function est(p, mo) {
    var h = hoy();
    if (mo.paidOn) return { k: 'ok', label: 'Pagado', sub: 'Pagó el ' + fecha(mo.paidOn) };
    if (mo.ym < h.ym) return { k: 'bad', label: 'Sin pagar', sub: 'Mes anterior sin cobrar' };
    if (p.dueDay < h.d) return { k: 'bad', label: 'Retrasado ' + dias(h.d - p.dueDay), sub: 'Tenía que pagar el día ' + p.dueDay };
    if (p.dueDay === h.d) return { k: 'warn', label: 'Se cobra hoy', sub: 'Todavía sin pagar' };
    return { k: 'warn', label: 'Pendiente', sub: 'Se cobra el día ' + p.dueDay + ' (faltan ' + dias(p.dueDay - h.d) + ')' };
  }
  function deuda(p) { return p.months.filter(function (mo) { return est(p, mo).k === 'bad'; }); }
  function suma(arr, k) { return arr.reduce(function (a, x) { return a + x[k]; }, 0); }
  function lv(m) { return S.data.cartera.perms[m]; }
  function can(m) { return lv(m) >= 2; }
  function esPropietario() { return S.data.cartera.role === 'owner'; }
  function listaMeses(arr) {
    var n = arr.map(function (mo) { return mes(mo.ym); });
    return n.length > 1 ? n.slice(0, -1).join(', ') + ' y ' + n[n.length - 1] : n[0];
  }
  function telLimpio(t) { var d = String(t).replace(/\D/g, ''); return d.length === 9 ? '34' + d : d; }
  function tipo(u) { return TIPOS[u.kind] || u.label; }
  function sinPagar(pid) { return S.data.utilities.filter(function (u) { return !u.paidOn && (!pid || u.propertyId === pid); }); }
  function periodo(c) { return c.endDate ? 'Del ' + fechaC(c.startDate) + ' al ' + fechaC(c.endDate) : 'Desde el ' + fechaC(c.startDate); }
  function resumen(perms) {
    var t = MODS.filter(function (m) { return perms[m.id] > 0; }).map(function (m) { return m.label + (perms[m.id] === 1 ? ' (solo ver)' : ''); });
    return t.length ? t.join(' · ') : 'Nada';
  }

  /* Prepara los datos del servidor: inquilino actual y meses de todos los inquilinos, en orden. */
  function preparar(d) {
    var ym = Number(d.today.slice(0, 4)) * 12 + Number(d.today.slice(5, 7)) - 1;
    d.properties.forEach(function (p) {
      p.cur = p.contracts.filter(function (c) { return c.active; })[0] || null;
      p.months = [];
      p.contracts.forEach(function (c) { c.months.forEach(function (mo) { mo.c = c; p.months.push(mo); }); });
      p.months.sort(function (a, b) { return a.ym - b.ym; });
      p.now = p.cur ? p.cur.months.filter(function (mo) { return mo.ym === ym; })[0] || null : null;
      p.tenant = p.cur ? p.cur.tenant : 'Sin inquilino';
    });
    return d;
  }

  function api(method, url, body) {
    return fetch(url, {
      method: method, credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', 'X-Cartera': S.cartera || '' },
      body: body ? JSON.stringify(body) : undefined
    }).catch(function () { throw new Error('Sin conexión. Inténtelo otra vez.'); })
      .then(function (r) {
        return r.json().catch(function () { return {}; }).then(function (j) {
          if (!r.ok) { var e = new Error(j.error || 'No se ha podido completar. Inténtelo otra vez.'); e.status = r.status; throw e; }
          return j;
        });
      });
  }

  function toast(txt, undo) {
    clearTimeout(toastT);
    toastEl.innerHTML = '<span>' + esc(txt) + '</span>' + (undo ? '<button id="toast-undo">Deshacer</button>' : '');
    toastEl.hidden = false;
    if (undo) document.getElementById('toast-undo').onclick = function () { toastEl.hidden = true; undo(); };
    toastT = setTimeout(function () { toastEl.hidden = true; }, undo ? 8000 : 4500);
  }
  function fail(e) {
    if (e.status === 401) { S.data = null; S.err = ''; render(true); return; }
    toast(e.message || 'No se ha podido completar. Inténtelo otra vez.');
  }
  function load(top) {
    return api('GET', '/api/state').then(function (d) {
      S.data = preparar(d); S.cartera = String(d.cartera.ownerId);
      try { localStorage.setItem('klyp_cartera', S.cartera); } catch (e) { /* sin almacenamiento */ }
      if (S.screen && S.screen.id && !prop(S.screen.id)) S.screen = null;
      render(top);
    });
  }
  /* Ejecuta un cambio, recarga los datos y muestra un aviso (con Deshacer si procede). */
  function run(fn, msg, undo) {
    if (S.busy) return Promise.resolve();
    S.busy = true;
    return fn().then(function (res) { return load(false).then(function () { if (msg) toast(msg, undo); return res; }); })
      .catch(fail).then(function (res) { S.busy = false; return res; });
  }
  function pagar(cid, ym, paid) { return function () { return api('POST', '/api/contracts/' + cid + '/pay', { ym: ym, paid: paid }); }; }
  function facturaPagada(id, paid) { return function () { return api('POST', '/api/utilities/' + id + '/paid', { paid: paid }); }; }

  /* ---------- acceso ---------- */
  function vOlvido() {
    return '<button class="back" data-act="auth" data-v="login">‹ Volver a Entrar</button>' +
      '<header class="stack"><h1>He olvidado mi clave</h1></header>' +
      '<section class="card"><p><b>1.</b> Pida un código de recuperación a KLYP' + (S.support ? ': <b>' + esc(S.support) + '</b>' : '') + '.</p>' +
      '<p><b>2.</b> Escríbalo aquí con su móvil y elija una clave nueva.</p></section>' +
      (S.err ? '<p class="err" role="alert">' + esc(S.err) + '</p>' : '') +
      '<form id="form-olvido" class="stack-lg">' +
      '<label class="f">Su número de móvil<input type="tel" id="olv-tel" inputmode="tel" autocomplete="tel" required></label>' +
      '<label class="f">Código de recuperación<input type="text" id="olv-codigo" maxlength="12" autocapitalize="characters" autocomplete="off" required></label>' +
      '<label class="f">Clave nueva<small>Al menos 6 números o letras. Apúntela.</small>' +
      '<input type="password" id="olv-pin" autocomplete="new-password" required minlength="6"></label>' +
      '<button class="btn primary" type="submit">Guardar la clave y entrar</button></form>';
  }
  function vAuth() {
    if (S.auth === 'olvido') return vOlvido();
    var reg = S.auth === 'registro';
    return '<header class="stack"><h1>KLYP Alquileres</h1><p class="muted">Lleve la cuenta de sus alquileres desde el móvil.</p></header>' +
      (S.invite ? '<p class="msg">Tiene una invitación. Entre o cree su cuenta para aceptarla.</p>' : '') +
      '<div class="seg"><button data-act="auth" data-v="login" aria-pressed="' + !reg + '">Entrar</button>' +
      '<button data-act="auth" data-v="registro" aria-pressed="' + reg + '">Crear cuenta</button></div>' +
      (S.err ? '<p class="err" role="alert">' + esc(S.err) + '</p>' : '') +
      '<form id="form-auth" class="stack-lg">' +
      (reg ? '<label class="f">Su nombre<input type="text" id="auth-nombre" autocomplete="name" required></label>' : '') +
      '<label class="f">Su número de móvil<input type="tel" id="auth-tel" inputmode="tel" autocomplete="tel" required></label>' +
      '<label class="f">Clave' + (reg ? '<small>Invéntese una de al menos 6 números o letras y apúntela.</small>' : '') +
      '<input type="password" id="auth-pin" autocomplete="' + (reg ? 'new-password' : 'current-password') + '" required minlength="6"></label>' +
      '<button class="btn primary" type="submit">' + (reg ? 'Crear mi cuenta' : 'Entrar') + '</button></form>' +
      (reg ? '' : '<button class="btn plain" data-act="auth" data-v="olvido">He olvidado mi clave</button>') +
      '<p class="muted">El móvil se queda con la sesión abierta: no tendrá que escribir la clave cada vez.</p>';
  }

  /* ---------- pagos ---------- */
  function fila(p, sub, monto) {
    var k = p.now ? est(p, p.now).k : 'none';
    return '<button class="row" data-act="abrir" data-id="' + p.id + '"><span class="dot ' + k + '">' + ICON[k] + '</span>' +
      '<span><span class="t">' + esc(nom(p)) + '</span><br><span class="s">' + sub + '</span></span>' +
      '<span class="amt">' + monto + '</span></button>';
  }
  function vacio() {
    return '<section class="card"><h2>Empiece por su primer inmueble</h2><p>Añada el piso, local o garaje que tiene alquilado y la app llevará la cuenta de cada mes.</p>' +
      (can('inmuebles') ? '<button class="btn primary" data-act="ir" data-screen="form-piso">+ Añadir un inmueble</button>' : '') + '</section>';
  }
  function vPagos() {
    var h = hoy(), ps = S.data.properties, total = 0, cobrado = 0, g = { bad: [], warn: [], ok: [], none: [] };
    ps.forEach(function (p) {
      if (!p.now) { g.none.push(p); return; }
      total += p.now.rent; if (p.now.paidOn) cobrado += p.now.rent; g[est(p, p.now).k].push(p);
    });
    var head = '<header class="stack"><h1>' + mes(h.ym, true) + ' ' + h.y + '</h1>' +
      (S.data.carteras.length > 1 ? '<p class="muted">Alquileres de ' + esc(S.data.cartera.ownerName) + '</p>' : '') + '</header>';
    if (!ps.length) return head + vacio();
    function grupo(titulo, arr) {
      if (!arr.length) return '';
      return '<section class="stack"><h2>' + titulo + ' (' + arr.length + ')</h2><div class="list">' + arr.map(function (p) {
        var ant = deuda(p).filter(function (mo) { return mo.ym < h.ym; }).length;
        var pill = p.now ? '<span class="pill ' + est(p, p.now).k + '">' + est(p, p.now).label + '</span>' : '';
        return fila(p, esc(p.tenant) + (pill || ant ? '<br>' : '') + pill +
          (ant ? ' <span class="pill bad">' + (p.now ? '+ ' : '') + nMeses(ant) + ' sin pagar</span>' : ''), p.now ? eur(p.now.rent) : '');
      }).join('') + '</div></section>';
    }
    var pct = total ? Math.round(cobrado / total * 100) : 0;
    return head + '<section class="summary" aria-label="Resumen del mes"><p class="muted">Cobrado este mes</p>' +
      '<p class="big">' + eur(cobrado) + '</p><div class="bar"><span style="width:' + pct + '%"></span></div>' +
      '<p>Faltan <b>' + eur(total - cobrado) + '</b> de ' + eur(total) + '</p>' +
      '<button class="btn" data-act="tab" data-tab="impagos">Ver impagos por inmueble</button></section>' +
      grupo('Retrasados', g.bad) + grupo('Pendientes', g.warn) + grupo('Pagados', g.ok) + grupo('Sin inquilino ahora', g.none);
  }

  /* ---------- impagos ---------- */
  function vImpagos() {
    var con = [], sin = [], total = 0, meses = 0, facturas = 0;
    S.data.properties.forEach(function (p) {
      var d = deuda(p), u = sinPagar(p.id), t = suma(d, 'rent') + suma(u, 'amount');
      if (t) { con.push({ p: p, d: d, u: u, t: t }); total += t; meses += d.length; facturas += u.length; } else sin.push(p);
    });
    con.sort(function (a, b) { return b.t - a.t; });
    var h = '<header><h1>Impagos</h1></header>';
    if (!S.data.properties.length) return h + vacio();
    if (!con.length) {
      h += '<section class="status-card ok"><span class="dot">' + ICON.ok + '</span><div><p class="lbl">Todo cobrado</p><p>Ningún inmueble tiene meses ni facturas sin pagar.</p></div></section>';
    } else {
      h += '<section class="summary" aria-label="Total sin cobrar"><p class="muted">Le deben en total</p><p class="big red">' + eur(total) + '</p>' +
        '<p><b>' + con.length + (con.length === 1 ? ' inmueble' : ' inmuebles') + '</b> · <b>' + nMeses(meses) + '</b> de alquiler' +
        (facturas ? ' · <b>' + facturas + (facturas === 1 ? ' factura' : ' facturas') + '</b> de suministros' : '') + '</p></section>' +
        '<section class="stack">' + con.map(function (x) {
          var p = x.p;
          return '<article class="card"><h2>' + esc(nom(p)) + '</h2><p class="muted">' + esc(p.tenant) + (p.alias ? ' · ' + esc(p.address) : '') + '</p>' +
            '<p class="owe">Debe <b>' + eur(x.t) + '</b></p>' +
            (p.months.length ? '<div class="months">' + p.months.slice(-6).map(function (mo) {
              var k = est(p, mo).k;
              return '<div class="mcell ' + k + '" title="' + mes(mo.ym, true) + '">' + ICON[k] + '<span>' + MESES[mo.ym % 12].slice(0, 3) + '</span></div>';
            }).join('') + '</div>' : '') +
            x.d.map(function (mo) {
              return '<div class="kv"><span><b>Alquiler de ' + mes(mo.ym) + '</b><br>' + eur(mo.rent) + (mo.c !== p.cur ? ' · ' + esc(mo.c.tenant) : '') + '</span>' +
                (can('pagos') ? '<button class="btn mini" data-act="cobrar" data-id="' + p.id + '" data-cid="' + mo.c.id + '" data-ym="' + mo.ym + '">Cobrado</button>' : '') + '</div>';
            }).join('') +
            x.u.map(function (u) {
              var c = contrato(p, u.contractId);
              return '<div class="kv"><span><b>Factura de ' + esc(tipo(u).toLowerCase()) + '</b><br>' + eur(u.amount) + ' · ' + fechaC(u.billDate) +
                (c && c !== p.cur ? ' · ' + esc(c.tenant) : '') + '</span>' +
                (can('suministros') ? '<button class="btn mini" data-act="factura-pagada" data-id="' + u.id + '">Pagada</button>' : '') + '</div>';
            }).join('') +
            '<button class="btn" data-act="abrir" data-id="' + p.id + '">Ver ficha y contactar</button></article>';
        }).join('') + '</section>';
    }
    if (sin.length) {
      h += '<section class="stack"><h2>Al día (' + sin.length + ')</h2><div class="list">' +
        sin.map(function (p) { return fila(p, esc(p.tenant), ''); }).join('') + '</div></section>';
    }
    return h;
  }

  /* ---------- ficha del inmueble ---------- */
  function vPiso(id) {
    var p = prop(id), c = p.cur, mo = p.now, h, pagos = lv('pagos') >= 1;
    var abiertas = S.data.issues.filter(function (a) { return a.propertyId === id && !a.resolvedAt; });
    var d = c ? deuda(p).filter(function (m2) { return m2.c === c; }) : [];
    var fu = c ? sinPagar(id).filter(function (u) { return u.contractId === c.id; }) : [];
    var partes = [];
    if (d.length) partes.push('el alquiler de ' + listaMeses(d) + ' (' + eur(suma(d, 'rent')) + ')');
    if (fu.length) partes.push((fu.length === 1 ? 'una factura' : fu.length + ' facturas') + ' de suministros (' + eur(suma(fu, 'amount')) + ')');
    var msg = partes.length ? 'Hola ' + c.tenant.split(' ')[0] + ', le recuerdo que tiene pendiente de pago ' + partes.join(' y ') + ' de ' + p.address + '. Gracias.' : '';
    h = '<button class="back" data-act="volver">‹ Volver</button>' +
      '<header class="stack"><h1>' + esc(nom(p)) + '</h1><p class="muted">' + esc(p.tenant) + (p.alias ? ' · ' + esc(p.address) : '') + '</p></header>';
    if (!c) {
      h += '<section class="status-card none"><span class="dot">' + ICON.none + '</span><div><p class="lbl">Sin inquilino</p><p>Ahora mismo no hay nadie de alquiler.</p></div></section>';
    } else if (pagos && mo) {
      var e = est(p, mo);
      h += '<section class="status-card ' + e.k + '"><span class="dot">' + ICON[e.k] + '</span><div><p class="lbl">' + e.label + '</p><p>' +
        mes(mo.ym, true) + ' · ' + e.sub + ' · ' + eur(mo.rent) + '</p></div></section>';
      if (can('pagos')) {
        h += mo.paidOn
          ? '<button class="btn plain" data-act="descobrar" data-id="' + id + '" data-cid="' + c.id + '" data-ym="' + mo.ym + '">Me equivoqué, no ha pagado</button>'
          : '<button class="btn good" data-act="cobrar" data-id="' + id + '" data-cid="' + c.id + '" data-ym="' + mo.ym + '">' + ICON.ok + ' Ha pagado ' + mes(mo.ym) + '</button>';
      }
    }
    if (c) {
      var tel = telLimpio(c.phone);
      h += '<section class="card"><h2>Contacto</h2>';
      if (tel) {
        h += '<p class="phone">' + esc(c.phone) + '</p><div class="btn-row"><a class="btn" href="tel:+' + tel + '">Llamar</a>' +
          '<a class="btn" target="_blank" rel="noopener" href="https://wa.me/' + tel + (msg ? '?text=' + encodeURIComponent(msg) : '') + '">WhatsApp</a></div>';
      } else {
        h += '<p class="muted">No ha apuntado el teléfono del inquilino.</p>';
      }
      if (msg) h += '<p class="muted">Mensaje de recordatorio que se envía por WhatsApp:</p><p class="msg">' + esc(msg) + '</p>';
      h += '</section>';
    }
    if (pagos && p.months.length) {
      h += '<section class="card"><h2>Mes a mes</h2>' + p.months.slice().reverse().slice(0, 12).map(function (m2) {
        var s = est(p, m2);
        return '<div class="kv"><span><b>' + mes(m2.ym, true) + '</b> · ' + eur(m2.rent) + (m2.c !== c ? ' · ' + esc(m2.c.tenant) : '') +
          '<br><span class="pill ' + s.k + '">' + (m2.paidOn ? 'Pagó el ' + fecha(m2.paidOn) : s.label) + '</span></span>' +
          (can('pagos') ? (m2.paidOn
            ? '<button class="btn mini plain" data-act="descobrar" data-id="' + id + '" data-cid="' + m2.c.id + '" data-ym="' + m2.ym + '">Quitar</button>'
            : '<button class="btn mini" data-act="cobrar" data-id="' + id + '" data-cid="' + m2.c.id + '" data-ym="' + m2.ym + '">Cobrado</button>') : '') + '</div>';
      }).join('') + '</section>';
    }
    if (p.utilities && lv('suministros') >= 1) {
      var us = sinPagar(id);
      h += '<section class="card"><h2>Facturas de suministros sin pagar</h2>' + (us.length ? us.map(function (u) {
        var cu = contrato(p, u.contractId);
        return '<div class="kv"><span><b>' + esc(tipo(u)) + '</b> · ' + eur(u.amount) + '<br><span class="muted">' + fechaC(u.billDate) +
          (cu && cu !== c ? ' · ' + esc(cu.tenant) : '') + (u.sentAt ? '' : ' · sin enviar') + '</span></span>' +
          (can('suministros') ? '<button class="btn mini" data-act="factura-pagada" data-id="' + u.id + '">Pagada</button>' : '') + '</div>';
      }).join('') : '<p class="muted">Ninguna.</p>') +
        (can('suministros') ? '<button class="btn" data-act="nueva-factura" data-id="' + id + '">Subir una factura</button>' : '') + '</section>';
    }
    if (lv('averias') >= 1) {
      h += '<section class="card"><h2>Averías sin resolver</h2>' + (abiertas.length ? abiertas.map(function (a) {
        return '<div class="kv"><span>' + esc(a.text) + '</span><b class="r">' + fecha(a.createdAt) + '</b></div>';
      }).join('') : '<p class="muted">Ninguna.</p>') +
        (can('averias') ? '<button class="btn" data-act="nueva-averia" data-id="' + id + '">Anotar una avería</button>' : '') + '</section>';
    }
    var edit = can('inmuebles');
    h += '<section class="card"><h2>Inquilinos</h2>' + (p.contracts.length ? '' : '<p class="muted">Todavía no ha tenido ninguno.</p>') +
      p.contracts.slice().reverse().map(function (k) {
        var fin = k.endDate && k.endDate < S.data.today, r = k.nextRaise;
        return '<div class="sub"><p><b>' + esc(k.tenant) + '</b> ' + (k.active ? '<span class="pill ok">Actual</span>' : fin ? '<span class="pill none">Anterior</span>' : '<span class="pill warn">Entrará</span>') + '</p>' +
          '<p class="muted">' + periodo(k) + (k.rent != null ? ' · ' + eur(k.rent) + ' al mes' : '') + '</p>' +
          (r ? '<p>Subida del IPC del ' + String(r.pct).replace('.', ',') + ' %: <b>' + eur(r.rent) + '</b> desde ' + mes(r.fromYm) + '.</p>'
            : (!fin && k.rent != null ? '<p class="muted">Sin subida de IPC programada.</p>' : '')) +
          (edit ? '<div class="btn-row"><button class="btn mini" data-act="editar-contrato" data-id="' + id + '" data-cid="' + k.id + '">Cambiar datos</button>' +
            (fin ? '' : '<button class="btn mini" data-act="ipc" data-id="' + id + '" data-cid="' + k.id + '">Subida IPC</button>') + '</div>' : '') + '</div>';
      }).join('') +
      (edit ? '<button class="btn" data-act="nuevo-contrato" data-id="' + id + '">' + (c ? 'Cambiar de inquilino' : '+ Añadir inquilino') + '</button>' : '') + '</section>';
    if (lv('inmuebles') >= 1) {
      h += '<section class="card"><h2>Datos del inmueble</h2>' +
        (p.alias ? '<div class="kv"><span>Nombre corto</span><b class="r">' + esc(p.alias) + '</b></div>' : '') +
        '<div class="kv"><span>Dirección</span><b class="r">' + esc(p.address) + '</b></div>' +
        '<div class="kv"><span>Día de cobro</span><b class="r">Día ' + p.dueDay + '</b></div>' +
        '<div class="kv"><span>Facturas de suministros</span><b class="r">' + (p.utilities ? 'Sí' : 'No') + '</b></div>';
      if (edit) {
        h += '<button class="btn" data-act="editar" data-id="' + id + '">Cambiar estos datos</button>' +
          (S.confirm === id
            ? '<p class="err">¿Seguro? El inmueble dejará de aparecer en la app.</p><div class="btn-row">' +
            '<button class="btn danger" data-act="borrar-si" data-id="' + id + '">Sí, quitarlo</button>' +
            '<button class="btn plain" data-act="borrar-no">No, dejarlo</button></div>'
            : '<button class="btn plain" data-act="borrar" data-id="' + id + '">Quitar este inmueble</button>');
      }
      h += '</section>';
    }
    return h;
  }

  /* ---------- inmuebles e inquilinos ---------- */
  function vPisos() {
    var ps = S.data.properties, pl = S.data.plan;
    var h = '<header class="stack"><h1>Mis inmuebles</h1><p class="muted">' +
      (pl.maxProperties == null ? ps.length + (ps.length === 1 ? ' inmueble' : ' inmuebles')
        : ps.length + ' de ' + pl.maxProperties + ' con el plan ' + esc(pl.name)) + '</p></header>';
    if (!ps.length) return h + vacio();
    return h + '<div class="list">' + ps.map(function (p) {
      return fila(p, esc(p.tenant) + ' · día ' + p.dueDay + (p.alias ? '<br>' + esc(p.address) : ''), p.cur && p.cur.rent != null ? eur(p.cur.rent) : '');
    }).join('') + '</div>' + (can('inmuebles') ? '<button class="btn primary" data-act="ir" data-screen="form-piso">+ Añadir un inmueble</button>' : '');
  }
  function camposContrato(c, nuevo) {
    function val(k) { return c && c[k] != null ? ' value="' + esc(c[k]) + '"' : ''; }
    return '<label class="f">Nombre del inquilino<input type="text" id="con-inq" maxlength="80" required' + val('tenant') + '></label>' +
      '<label class="f">Teléfono del inquilino<small>Para llamarle y enviarle las facturas por WhatsApp.</small>' +
      '<input type="tel" id="con-tel" inputmode="tel" maxlength="30"' + val('phone') + '></label>' +
      '<label class="f">Renta al mes (€)<input type="number" id="con-renta" inputmode="decimal" min="1" step="0.01" required' + val('rent') + '></label>' +
      '<label class="f">Fecha en que empieza el contrato<input type="date" id="con-inicio" required value="' + (c ? c.startDate : S.data.today) + '"></label>' +
      '<label class="f">Fecha en que termina<small>Déjela vacía si todavía no se sabe.</small><input type="date" id="con-fin"' + val('endDate') + '></label>' +
      (nuevo ? '<label class="f">Subida del IPC para el próximo año (%)<small>Si ya la sabe. Por ejemplo 2,8. Puede dejarlo vacío y ponerla más adelante.</small>' +
        '<input type="text" id="con-ipc" inputmode="decimal" maxlength="6"></label>' +
        '<label class="f">¿Desde qué fecha se aplica la subida?<small>La renta sube sola desde la mensualidad de ese mes.</small><input type="date" id="con-ipc-fecha"></label>' : '');
  }
  function vFormPiso(id) {
    var p = id ? prop(id) : null;
    function val(k) { return p ? ' value="' + esc(p[k]) + '"' : ''; }
    return '<button class="back" data-act="volver">‹ Volver</button><header><h1>' + (p ? 'Cambiar datos' : 'Añadir un inmueble') + '</h1></header>' +
      '<form id="form-piso" class="stack-lg">' +
      '<label class="f">Nombre corto<small>Para reconocerlo rápido. Por ejemplo: «Piso de la playa» o «Local farmacia».</small>' +
      '<input type="text" id="piso-alias" maxlength="40"' + val('alias') + '></label>' +
      '<label class="f">Dirección<input type="text" id="piso-dir" maxlength="120" placeholder="Calle, número y piso" required' + val('address') + '></label>' +
      '<label class="f">Día del mes en que paga<input type="number" id="piso-dia" inputmode="numeric" min="1" max="28" required value="' + (p ? p.dueDay : 5) + '"></label>' +
      '<label class="check"><input type="checkbox" id="piso-sum"' + (p && p.utilities ? ' checked' : '') + '>' +
      '<span><b>Necesito facturas de suministros</b><small>Márquelo si el inquilino paga aparte la luz, el agua u otros gastos y quiere subirle las facturas.</small></span></label>' +
      (p ? '' : '<h2>Inquilino</h2>' + camposContrato(null, true)) +
      '<button class="btn primary" type="submit">Guardar</button></form>';
  }
  function vFormContrato(s) {
    var p = prop(s.id), c = s.cid ? contrato(p, s.cid) : null;
    return '<button class="back" data-act="volver">‹ Volver</button><header class="stack"><h1>' + (c ? 'Datos del inquilino' : 'Inquilino nuevo') + '</h1>' +
      '<p class="muted">' + esc(nom(p)) + '</p></header>' +
      (!c && p.cur && !p.cur.endDate ? '<p class="msg">' + esc(p.cur.tenant) + ' quedará como inquilino anterior, con fecha de salida el día antes de que entre el nuevo. Sus pagos y deudas se conservan.</p>' : '') +
      '<form id="form-contrato" class="stack-lg">' + camposContrato(c, !c) +
      '<button class="btn primary" type="submit">Guardar</button></form>' +
      (c ? (S.confirm === 'c' + c.id
        ? '<p class="err">¿Seguro que quiere quitar a ' + esc(c.tenant) + '?</p><div class="btn-row">' +
        '<button class="btn danger" data-act="quitar-contrato-si" data-id="' + p.id + '" data-cid="' + c.id + '">Sí, quitarlo</button>' +
        '<button class="btn plain" data-act="borrar-no">No, dejarlo</button></div>'
        : '<button class="btn plain" data-act="quitar-contrato" data-cid="' + c.id + '">Quitar este inquilino (si lo apuntó por error)</button>') : '');
  }
  function vFormIpc(s) {
    var p = prop(s.id), c = contrato(p, s.cid), r = c.nextRaise;
    return '<button class="back" data-act="volver">‹ Volver</button><header class="stack"><h1>Subida del IPC</h1>' +
      '<p class="muted">' + esc(nom(p)) + ' · ' + esc(c.tenant) + ' · paga ' + eur(c.rent) + ' al mes</p></header>' +
      (r ? '<p class="msg">Ya hay una subida programada del ' + String(r.pct).replace('.', ',') + ' %: pagará ' + eur(r.rent) + ' desde ' + mes(r.fromYm) + '. Si guarda otra, la sustituye.</p>' : '') +
      '<form id="form-ipc" class="stack-lg">' +
      '<label class="f">Porcentaje de subida (%)<small>Por ejemplo 2,8.</small><input type="text" id="ipc-pct" inputmode="decimal" maxlength="6" required></label>' +
      '<label class="f">¿Desde qué fecha se aplica?<small>La renta sube sola desde la mensualidad de ese mes. Los meses anteriores no cambian.</small>' +
      '<input type="date" id="ipc-fecha" required></label>' +
      '<button class="btn primary" type="submit">Guardar la subida</button></form>' +
      (r ? '<button class="btn plain" data-act="quitar-ipc" data-id="' + p.id + '" data-cid="' + c.id + '">Quitar la subida programada</button>' : '');
  }

  /* ---------- facturas de suministros ---------- */
  function waFactura(u) {
    var p = prop(u.propertyId), c = contrato(p, u.contractId);
    var txt = 'Hola ' + c.tenant.split(' ')[0] + ', le envío la factura de ' + tipo(u).toLowerCase() + ' de ' + p.address + ' con fecha ' + fechaC(u.billDate) +
      ': ' + eur(u.amount) + '. Puede verla aquí: ' + location.origin + u.url + ' Queda pendiente de pago. Gracias.';
    return { txt: txt, href: 'https://wa.me/' + telLimpio(c.phone) + '?text=' + encodeURIComponent(txt), c: c };
  }
  function vFacturas() {
    var us = S.data.utilities, pend = us.filter(function (u) { return !u.paidOn; }), hechas = us.filter(function (u) { return u.paidOn; });
    var hay = S.data.properties.some(function (p) { return p.utilities; }), edit = can('suministros');
    function item(u) {
      var p = prop(u.propertyId), w = waFactura(u);
      return '<article class="card"><p><span class="pill ' + (u.paidOn ? 'ok' : 'bad') + '">' + (u.paidOn ? 'Pagada el ' + fecha(u.paidOn) : 'Pendiente de pago') + '</span> ' +
        (u.paidOn ? '' : '<span class="pill ' + (u.sentAt ? 'ok' : 'warn') + '">' + (u.sentAt ? 'Enviada el ' + fecha(u.sentAt) : 'Sin enviar') + '</span>') + '</p>' +
        '<h2>' + esc(tipo(u)) + ' · ' + eur(u.amount) + '</h2><p class="muted">' + esc(nom(p)) + ' · ' + esc(w.c.tenant) + ' · factura del ' + fechaC(u.billDate) + '</p>' +
        (u.paidOn ? '' : '<a class="btn' + (u.sentAt ? '' : ' primary') + '" target="_blank" rel="noopener" href="' + esc(w.href) + '" data-act="enviada" data-id="' + u.id + '">' +
          (u.sentAt ? 'Volver a enviar por WhatsApp' : 'Enviar por WhatsApp') + '</a>') +
        '<div class="btn-row"><a class="btn" target="_blank" rel="noopener" href="' + u.url + '">Ver el PDF</a>' +
        (edit ? (u.paidOn ? '<button class="btn plain" data-act="factura-impagada" data-id="' + u.id + '">Quitar el pago</button>'
          : '<button class="btn" data-act="factura-pagada" data-id="' + u.id + '">Ya la ha pagado</button>') : '<span></span>') + '</div>' +
        (edit ? (S.confirm === 'u' + u.id
          ? '<p class="err">¿Seguro que quiere borrar esta factura?</p><div class="btn-row"><button class="btn danger" data-act="borrar-factura-si" data-id="' + u.id + '">Sí, borrarla</button>' +
          '<button class="btn plain" data-act="borrar-no">No, dejarla</button></div>'
          : '<button class="btn plain" data-act="borrar-factura" data-id="' + u.id + '">Borrar la factura</button>') : '') + '</article>';
    }
    var h = '<header class="stack"><h1>Facturas</h1><p class="muted">Luz, agua y otros gastos que paga el inquilino.</p></header>';
    if (!hay) {
      return h + '<section class="card"><h2>Ningún inmueble las tiene activadas</h2><p>Para subir facturas, abra el inmueble, pulse «Cambiar estos datos» y marque «Necesito facturas de suministros».</p></section>';
    }
    return h + (edit ? '<button class="btn primary" data-act="nueva-factura">+ Subir una factura</button>' : '') +
      '<section class="stack"><h2>Pendientes de pago (' + pend.length + ')</h2>' + (pend.length ? pend.map(item).join('') : '<p class="muted">No hay facturas pendientes.</p>') + '</section>' +
      (hechas.length ? '<section class="stack"><h2>Pagadas (' + hechas.length + ')</h2>' + hechas.slice(0, 30).map(item).join('') + '</section>' : '');
  }
  function vNuevaFactura(sel) {
    var ps = S.data.properties.filter(function (p) { return p.utilities; });
    return '<button class="back" data-act="volver">‹ Volver</button><header><h1>Subir una factura</h1></header>' +
      '<form id="form-factura" class="stack-lg">' +
      '<label class="f">Archivo PDF de la factura<input type="file" id="fac-pdf" accept="application/pdf,.pdf" required></label>' +
      '<label class="f">¿De qué inmueble es?<select id="fac-piso">' + ps.map(function (p) {
        return '<option value="' + p.id + '"' + (p.id === sel ? ' selected' : '') + '>' + esc(nom(p)) + '</option>';
      }).join('') + '</select></label>' +
      '<label class="f">¿De qué es?<select id="fac-tipo"><option value="luz">Luz</option><option value="agua">Agua</option><option value="otro">Otro</option></select></label>' +
      '<label class="f" id="fac-otro-caja" hidden>Escriba de qué es<small>Por ejemplo: gas, comunidad, basuras.</small><input type="text" id="fac-otro" maxlength="40"></label>' +
      '<label class="f">Importe (€)<input type="number" id="fac-importe" inputmode="decimal" min="0.01" step="0.01" required></label>' +
      '<label class="f">Fecha de la factura<small>Se le apunta al inquilino que estaba en el inmueble ese día.</small>' +
      '<input type="date" id="fac-fecha" required value="' + S.data.today + '"></label>' +
      '<button class="btn primary" type="submit">Guardar la factura</button></form>';
  }
  function vFacturaOk(s) {
    var u = S.data.utilities.filter(function (x) { return x.id === s.uid; })[0];
    if (!u) return vFacturas();
    var w = waFactura(u), compartir = navigator.share && navigator.canShare;
    return '<button class="back" data-act="volver">‹ Volver a Facturas</button><header class="stack"><h1>Factura guardada</h1>' +
      '<p>Queda anotada como <b>pendiente de pago</b> por ' + esc(w.c.tenant) + ': ' + esc(tipo(u).toLowerCase()) + ', ' + eur(u.amount) + '.</p></header>' +
      (w.c.phone ? '' : '<p class="msg">No tiene apuntado el teléfono de este inquilino: WhatsApp le pedirá que elija a quién enviarla.</p>') +
      '<a class="btn good" target="_blank" rel="noopener" href="' + esc(w.href) + '" data-act="enviada" data-id="' + u.id + '">Enviar por WhatsApp a ' + esc(w.c.tenant.split(' ')[0]) + '</a>' +
      '<p class="muted">Se abre WhatsApp con este mensaje ya escrito. Solo tiene que pulsar Enviar:</p><p class="msg">' + esc(w.txt) + '</p>' +
      (compartir ? '<button class="btn" data-act="compartir-pdf" data-id="' + u.id + '">Enviar el PDF como archivo</button>' : '') +
      '<a class="btn plain" target="_blank" rel="noopener" href="' + u.url + '">Ver el PDF</a>';
  }

  /* ---------- averías ---------- */
  function vAverias() {
    var pend = S.data.issues.filter(function (a) { return !a.resolvedAt; }), hechas = S.data.issues.filter(function (a) { return a.resolvedAt; });
    function item(a) {
      var p = prop(a.propertyId);
      return '<article class="card"><p><span class="pill ' + (a.resolvedAt ? 'ok' : 'warn') + '">' + (a.resolvedAt ? 'Resuelta' : 'Pendiente') + '</span></p>' +
        '<h2>' + esc(a.text) + '</h2><p class="muted">' + esc(p ? nom(p) : '') + ' · ' + fecha(a.createdAt) + '</p>' +
        (a.photo ? '<img class="thumb" src="' + a.photo + '" alt="Foto de la avería" loading="lazy">' : '') +
        (!a.resolvedAt && can('averias') ? '<button class="btn" data-act="resolver" data-id="' + a.id + '">Ya está arreglada</button>' : '') + '</article>';
    }
    return '<header><h1>Averías</h1></header>' +
      (can('averias') && S.data.properties.length ? '<button class="btn primary" data-act="nueva-averia">+ Anotar una avería</button>' : '') +
      '<section class="stack"><h2>Pendientes (' + pend.length + ')</h2>' + (pend.length ? pend.map(item).join('') : '<p class="muted">No hay averías pendientes.</p>') + '</section>' +
      (hechas.length ? '<section class="stack"><h2>Resueltas (' + hechas.length + ')</h2>' + hechas.map(item).join('') + '</section>' : '');
  }
  function vNuevaAveria(sel) {
    return '<button class="back" data-act="volver">‹ Volver</button><header><h1>Anotar una avería</h1></header>' +
      '<form id="form-averia" class="stack-lg">' +
      '<label class="f">¿En qué inmueble?<select id="averia-piso">' + S.data.properties.map(function (p) {
        return '<option value="' + p.id + '"' + (p.id === sel ? ' selected' : '') + '>' + esc(nom(p)) + '</option>';
      }).join('') + '</select></label>' +
      '<label class="f">¿Qué ha pasado?<textarea id="averia-txt" maxlength="300" placeholder="Por ejemplo: la lavadora pierde agua" required></textarea></label>' +
      '<label class="f">Foto (si quiere)<input type="file" id="averia-foto" accept="image/*"></label>' +
      '<button class="btn primary" type="submit">Guardar avería</button></form>';
  }

  /* ---------- cuenta ---------- */
  function vCuenta() {
    var d = S.data, pl = d.plan, h = '<header class="stack"><h1>Mi cuenta</h1><p class="muted">' + esc(d.user.name) + ' · ' + esc(d.user.phone) + '</p></header>';
    if (d.carteras.length > 1) {
      h += '<section class="card"><h2>¿Qué alquileres quiere ver?</h2>' + d.carteras.map(function (c) {
        var on = c.ownerId === d.cartera.ownerId;
        return '<button class="btn' + (on ? ' primary' : '') + '" data-act="cartera" data-id="' + c.ownerId + '">' +
          (c.role === 'owner' ? 'Los míos' : 'Los de ' + esc(c.name)) + '</button>';
      }).join('') + '</section>';
    }
    if (esPropietario()) {
      h += '<section class="card"><h2>Mi plan: ' + esc(pl.name) + '</h2>' +
        '<div class="kv"><span>Inmuebles</span><b class="r">' + d.properties.length + (pl.maxProperties == null ? ' (sin límite)' : ' de ' + pl.maxProperties) + '</b></div>' +
        '<div class="kv"><span>Personas que me ayudan</span><b class="r">' + (d.helpers.length + d.invites.length) + (pl.maxHelpers == null ? ' (sin límite)' : ' de ' + pl.maxHelpers) + '</b></div>' +
        '<p class="muted">Para cambiar de plan, póngase en contacto con KLYP.</p></section>' +
        '<section class="card"><h2>Personas que me ayudan</h2>' +
        (d.helpers.length || d.invites.length ? '' : '<p class="muted">Puede invitar a un hijo o a su gestor y elegir qué apartados ve cada uno: por ejemplo, uno revisa los pagos y otro sube las facturas.</p>') +
        d.helpers.map(function (a) {
          return '<div class="sub"><p><b>' + esc(a.name) + '</b></p><p class="muted">' + esc(resumen(a.perms)) + '</p>' +
            '<div class="btn-row"><button class="btn mini" data-act="permisos" data-uid="' + a.userId + '">Cambiar permisos</button>' +
            '<button class="btn mini plain" data-act="quitar-ayuda" data-id="' + a.userId + '">Quitar</button></div></div>';
        }).join('') +
        d.invites.map(function (i) {
          return '<div class="sub"><p><b>' + esc(i.name) + '</b></p><p class="muted">Invitación sin aceptar · código ' + esc(i.code) + '<br>' + esc(resumen(i.perms)) + '</p>' +
            '<button class="btn mini plain" data-act="quitar-invitacion" data-code="' + esc(i.code) + '">Anular</button></div>';
        }).join('') +
        '<button class="btn" data-act="ir" data-screen="invitar">+ Invitar a un familiar o gestor</button></section>';
    } else {
      h += '<section class="card"><h2>Está ayudando a ' + esc(d.cartera.ownerName) + '</h2><p>' + esc(resumen(d.cartera.perms)) + '.</p></section>';
    }
    h += '<section class="card"><h2>Tengo un código de invitación</h2><form id="form-codigo" class="stack">' +
      '<label class="f">Código<input type="text" id="codigo" maxlength="12" autocapitalize="characters" autocomplete="off" required></label>' +
      '<button class="btn" type="submit">Aceptar invitación</button></form></section>' +
      '<section class="card"><h2>Cambiar mi clave</h2><form id="form-clave" class="stack">' +
      '<label class="f">Clave actual<input type="password" id="clave-actual" autocomplete="current-password" required></label>' +
      '<label class="f">Clave nueva<small>Al menos 6 números o letras.</small><input type="password" id="clave-nueva" autocomplete="new-password" required minlength="6"></label>' +
      '<button class="btn" type="submit">Cambiar la clave</button></form></section>' +
      '<section class="card"><h2>Tener la app en el móvil</h2><p><b>iPhone:</b> en Safari, pulse Compartir y luego «Añadir a pantalla de inicio».</p>' +
      '<p><b>Android:</b> en Chrome, pulse los tres puntos y luego «Instalar aplicación».</p></section>' +
      (d.user.isAdmin ? '<a class="btn" href="/admin">Panel de administración</a>' : '') +
      '<button class="btn plain" data-act="salir">Cerrar sesión</button>';
    return h;
  }
  /* Invitación nueva, o cambio de permisos de alguien que ya ayuda (s.uid). */
  function vInvitar(s) {
    var a = s.uid ? S.data.helpers.filter(function (x) { return x.userId === s.uid; })[0] : null;
    if (s.uid && !a) return vCuenta();
    return '<button class="back" data-act="volver">‹ Volver</button><header class="stack"><h1>' + (a ? 'Permisos de ' + esc(a.name) : 'Invitar a alguien') + '</h1>' +
      '<p class="muted">' + (a ? 'Elija qué ve y qué puede anotar en cada apartado.' : 'Elija qué puede hacer. Le daremos un código para que se lo envíe a esa persona.') + '</p></header>' +
      '<form id="form-invitar" class="stack-lg">' +
      (a ? '' : '<label class="f">Nombre<input type="text" id="inv-nombre" maxlength="60" required></label>') +
      MODS.map(function (m) {
        var v = a ? a.perms[m.id] : 2;
        return '<label class="f">' + m.label + '<select id="inv-' + m.id + '">' + [2, 1, 0].map(function (n) {
          return '<option value="' + n + '"' + (n === v ? ' selected' : '') + '>' + NIVEL[n] + '</option>';
        }).join('') + '</select></label>';
      }).join('') +
      '<button class="btn primary" type="submit">' + (a ? 'Guardar permisos' : 'Crear invitación') + '</button></form>';
  }
  function vInvitado(s) {
    var link = location.origin + '/app?invitacion=' + s.code;
    var txt = 'Hola ' + s.nombre + ', le invito a ver mis alquileres en KLYP Alquileres. Entre aquí: ' + link + ' (código ' + s.code + ')';
    return '<button class="back" data-act="volver">‹ Volver</button><header class="stack"><h1>Invitación creada</h1>' +
      '<p>Envíe este código a ' + esc(s.nombre) + ':</p></header><p class="code">' + esc(s.code) + '</p>' +
      '<a class="btn primary" target="_blank" rel="noopener" href="https://wa.me/?text=' + encodeURIComponent(txt) + '">Enviar por WhatsApp</a>' +
      '<button class="btn" data-act="copiar" data-txt="' + esc(txt) + '">Copiar el mensaje</button>' +
      '<p class="msg">' + esc(txt) + '</p>';
  }

  /* ---------- pintar ---------- */
  function render(top) {
    var h, s = S.screen;
    if (!S.data) {
      h = vAuth(); tabsBar.hidden = true; appEl.classList.add('no-tabs');
    } else {
      var tabs = TABS.filter(function (t) { return !t.mod || lv(t.mod) >= 1; });
      if (!tabs.some(function (t) { return t.id === S.tab; })) S.tab = tabs[0].id;
      if (s && s.name === 'piso') h = vPiso(s.id);
      else if (s && s.name === 'form-piso') h = vFormPiso(s.id);
      else if (s && s.name === 'form-contrato') h = vFormContrato(s);
      else if (s && s.name === 'form-ipc') h = vFormIpc(s);
      else if (s && s.name === 'nueva-factura') h = vNuevaFactura(s.id);
      else if (s && s.name === 'factura-ok') h = vFacturaOk(s);
      else if (s && s.name === 'nueva-averia') h = vNuevaAveria(s.id);
      else if (s && s.name === 'invitar') h = vInvitar(s);
      else if (s && s.name === 'invitado') h = vInvitado(s);
      else h = { pagos: vPagos, impagos: vImpagos, facturas: vFacturas, pisos: vPisos, averias: vAverias, cuenta: vCuenta }[S.tab]();
      tabsBar.hidden = false; appEl.classList.remove('no-tabs');
      tabsEl.style.gridTemplateColumns = 'repeat(' + tabs.length + ',1fr)';
      tabsEl.classList.toggle('many', tabs.length > 5);
      tabsEl.innerHTML = tabs.map(function (t) {
        return '<button class="tab" data-act="tab" data-tab="' + t.id + '"' + (t.id === S.tab ? ' aria-current="page"' : '') + '>' + t.svg + t.label + '</button>';
      }).join('');
    }
    view.innerHTML = h;
    if (top) window.scrollTo(0, 0);
  }
  function go(screen) { S.screen = screen; S.confirm = null; render(true); }

  /* ---------- eventos ---------- */
  document.addEventListener('click', function (ev) {
    var b = ev.target.closest('[data-act]'); if (!b) return;
    var act = b.getAttribute('data-act'), id = Number(b.getAttribute('data-id')) || null, ym = Number(b.getAttribute('data-ym')),
      cid = Number(b.getAttribute('data-cid')) || null, p;
    if (act === 'auth') { S.auth = b.getAttribute('data-v'); S.err = ''; render(false); }
    else if (act === 'tab') { S.tab = b.getAttribute('data-tab'); go(null); }
    else if (act === 'abrir') go({ name: 'piso', id: id });
    else if (act === 'editar') go({ name: 'form-piso', id: id });
    else if (act === 'nuevo-contrato') go({ name: 'form-contrato', id: id });
    else if (act === 'editar-contrato') go({ name: 'form-contrato', id: id, cid: cid });
    else if (act === 'ipc') go({ name: 'form-ipc', id: id, cid: cid });
    else if (act === 'ir') go({ name: b.getAttribute('data-screen') });
    else if (act === 'permisos') go({ name: 'invitar', uid: Number(b.getAttribute('data-uid')) });
    else if (act === 'volver') go(S.screen && S.screen.id && S.screen.name !== 'piso' ? { name: 'piso', id: S.screen.id } : null);
    else if (act === 'nueva-averia') { S.photo = null; go({ name: 'nueva-averia', id: id }); }
    else if (act === 'nueva-factura') go({ name: 'nueva-factura', id: id });
    else if (act === 'cobrar') { p = prop(id); run(pagar(cid, ym, true), 'Anotado: ' + nom(p) + ' ha pagado ' + mes(ym) + '.', function () { run(pagar(cid, ym, false)); }); }
    else if (act === 'descobrar') { run(pagar(cid, ym, false), 'Pago de ' + mes(ym) + ' quitado.', function () { run(pagar(cid, ym, true)); }); }
    else if (act === 'factura-pagada') { run(facturaPagada(id, true), 'Factura anotada como pagada.', function () { run(facturaPagada(id, false)); }); }
    else if (act === 'factura-impagada') { run(facturaPagada(id, false), 'Pago de la factura quitado.', function () { run(facturaPagada(id, true)); }); }
    else if (act === 'enviada') {
      /* El enlace abre WhatsApp; aquí solo se apunta que se ha enviado. */
      api('POST', '/api/utilities/' + id + '/sent', {}).then(function () { return load(false); }).catch(function () { });
    }
    else if (act === 'compartir-pdf') {
      var u = S.data.utilities.filter(function (x) { return x.id === id; })[0], w = waFactura(u);
      fetch(u.url).then(function (r) { return r.blob(); }).then(function (blob) {
        var f = new File([blob], 'factura-' + tipo(u).toLowerCase().replace(/[^a-z0-9]+/g, '-') + '.pdf', { type: 'application/pdf' });
        if (!navigator.canShare({ files: [f] })) throw new Error('no');
        return navigator.share({ files: [f], text: w.txt });
      }).then(function () { return api('POST', '/api/utilities/' + id + '/sent', {}).then(function () { return load(false); }); })
        .catch(function (e) { if (!e || e.name !== 'AbortError') toast('Este móvil no deja enviar el archivo desde aquí. Use el botón de WhatsApp.'); });
    }
    else if (act === 'borrar-factura') { S.confirm = 'u' + id; render(false); }
    else if (act === 'borrar-factura-si') { S.confirm = null; run(function () { return api('DELETE', '/api/utilities/' + id); }, 'Factura borrada.'); }
    else if (act === 'resolver') {
      run(function () { return api('POST', '/api/issues/' + id + '/resolve', { resolved: true }); }, 'Avería marcada como resuelta.',
        function () { run(function () { return api('POST', '/api/issues/' + id + '/resolve', { resolved: false }); }); });
    }
    else if (act === 'borrar') { S.confirm = id; render(false); }
    else if (act === 'borrar-no') { S.confirm = null; render(false); }
    else if (act === 'borrar-si') { S.screen = null; S.confirm = null; run(function () { return api('DELETE', '/api/properties/' + id); }, 'Inmueble quitado.'); }
    else if (act === 'quitar-contrato') { S.confirm = 'c' + cid; render(false); }
    else if (act === 'quitar-contrato-si') {
      S.confirm = null;
      run(function () { return api('DELETE', '/api/contracts/' + cid).then(function () { S.screen = { name: 'piso', id: id }; }); }, 'Inquilino quitado.');
    }
    else if (act === 'quitar-ipc') {
      run(function () { return api('DELETE', '/api/contracts/' + cid + '/ipc').then(function () { S.screen = { name: 'piso', id: id }; }); }, 'Subida quitada.');
    }
    else if (act === 'cartera') { S.cartera = String(id); S.tab = 'pagos'; S.screen = null; load(true).catch(fail); }
    else if (act === 'quitar-ayuda') run(function () { return api('DELETE', '/api/helpers/' + id); }, 'Ya no tiene acceso a sus alquileres.');
    else if (act === 'quitar-invitacion') run(function () { return api('DELETE', '/api/invites/' + b.getAttribute('data-code')); }, 'Invitación anulada.');
    else if (act === 'copiar') {
      var t = b.getAttribute('data-txt');
      (navigator.clipboard ? navigator.clipboard.writeText(t) : Promise.reject()).then(function () { toast('Mensaje copiado.'); })
        .catch(function () { toast('No se ha podido copiar. Mantenga pulsado el texto para copiarlo.'); });
    }
    else if (act === 'salir') {
      api('POST', '/api/logout', {}).catch(function () { }).then(function () {
        S.data = null; S.cartera = null; S.tab = 'pagos'; S.screen = null; S.err = '';
        try { localStorage.removeItem('klyp_cartera'); } catch (e) { /* sin almacenamiento */ }
        render(true);
      });
    }
  });

  document.addEventListener('change', function (ev) {
    var t = ev.target;
    if (t.id === 'fac-tipo') { document.getElementById('fac-otro-caja').hidden = t.value !== 'otro'; return; }
    /* Reduce la foto en el móvil antes de enviarla. */
    if (t.id !== 'averia-foto' || !t.files || !t.files[0]) return;
    S.photo = null;
    var url = URL.createObjectURL(t.files[0]), img = new Image();
    img.onload = function () {
      var k = Math.min(1, 1280 / Math.max(img.width, img.height)), c = document.createElement('canvas');
      c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      S.photo = c.toDataURL('image/jpeg', 0.8); URL.revokeObjectURL(url);
    };
    img.onerror = function () { URL.revokeObjectURL(url); toast('No se ha podido leer esa foto.'); };
    img.src = url;
  });

  function aceptar(code) {
    return api('POST', '/api/invites/accept', { code: code }).then(function (r) { S.cartera = String(r.ownerId); S.tab = 'pagos'; S.screen = null; });
  }
  function leerPdf(file) {
    return new Promise(function (ok, ko) {
      if (!file) return ko(new Error('Elija el archivo PDF de la factura.'));
      if (file.size > 5 * 1024 * 1024) return ko(new Error('El PDF es demasiado grande (máximo 5 MB).'));
      var r = new FileReader();
      r.onload = function () { ok(String(r.result).split(',')[1] || ''); };
      r.onerror = function () { ko(new Error('No se ha podido leer el archivo.')); };
      r.readAsDataURL(file);
    });
  }

  document.addEventListener('submit', function (ev) {
    ev.preventDefault();
    var f = ev.target.id, v = function (i) { var el = document.getElementById(i); return el ? el.value.trim() : ''; };
    function datosContrato() {
      return { tenant: v('con-inq'), phone: v('con-tel'), rent: v('con-renta'), startDate: v('con-inicio'), endDate: v('con-fin'), ipcPct: v('con-ipc'), ipcDate: v('con-ipc-fecha') };
    }
    if (f === 'form-auth') {
      var reg = S.auth === 'registro';
      if (S.busy) return;
      S.busy = true;
      api('POST', reg ? '/api/register' : '/api/login', { name: v('auth-nombre'), phone: v('auth-tel'), pin: document.getElementById('auth-pin').value })
        .then(function () {
          S.err = '';
          if (!S.invite) return;
          var code = S.invite; S.invite = '';
          history.replaceState(null, '', '/app');
          return aceptar(code).catch(function (e) { setTimeout(function () { toast(e.message); }, 300); });
        })
        .then(function () { return load(true); })
        .catch(function (e) { S.err = e.message; render(false); })
        .then(function () { S.busy = false; });
    } else if (f === 'form-piso') {
      var id = S.screen.id, body = id ? {} : datosContrato();
      body.alias = v('piso-alias'); body.address = v('piso-dir'); body.dueDay = v('piso-dia'); body.utilities = document.getElementById('piso-sum').checked;
      run(function () {
        return api(id ? 'PUT' : 'POST', '/api/properties' + (id ? '/' + id : ''), body).then(function (r) { S.tab = id ? S.tab : 'pisos'; S.screen = { name: 'piso', id: r.id }; return r; });
      }, 'Guardado.').then(function () { window.scrollTo(0, 0); });
    } else if (f === 'form-contrato') {
      var sc = S.screen;
      run(function () {
        return api(sc.cid ? 'PUT' : 'POST', sc.cid ? '/api/contracts/' + sc.cid : '/api/properties/' + sc.id + '/contracts', datosContrato())
          .then(function () { S.screen = { name: 'piso', id: sc.id }; });
      }, 'Guardado.').then(function () { window.scrollTo(0, 0); });
    } else if (f === 'form-ipc') {
      var si = S.screen, nueva = null;
      run(function () {
        return api('POST', '/api/contracts/' + si.cid + '/ipc', { pct: v('ipc-pct'), date: v('ipc-fecha') }).then(function (r) { nueva = r.rent; S.screen = { name: 'piso', id: si.id }; });
      }).then(function () { if (nueva != null) { toast('Subida guardada: pagará ' + eur(nueva) + ' al mes.'); window.scrollTo(0, 0); } });
    } else if (f === 'form-factura') {
      var fb = { propertyId: Number(v('fac-piso')), kind: v('fac-tipo'), label: v('fac-otro'), amount: v('fac-importe'), billDate: v('fac-fecha') };
      run(function () {
        return leerPdf(document.getElementById('fac-pdf').files[0]).then(function (b64) { fb.pdf = b64; return api('POST', '/api/utilities', fb); })
          .then(function (r) { S.tab = lv('suministros') >= 1 ? 'facturas' : S.tab; S.screen = { name: 'factura-ok', uid: r.id }; });
      }).then(function () { window.scrollTo(0, 0); });
    } else if (f === 'form-averia') {
      run(function () {
        return api('POST', '/api/issues', { propertyId: Number(v('averia-piso')), text: v('averia-txt'), photo: S.photo }).then(function () { S.photo = null; S.tab = 'averias'; S.screen = null; });
      }, 'Avería guardada.').then(function () { window.scrollTo(0, 0); });
    } else if (f === 'form-invitar') {
      var nombre = v('inv-nombre'), uid = S.screen.uid, perms = {};
      MODS.forEach(function (m) { perms[m.id] = Number(v('inv-' + m.id)); });
      if (uid) {
        run(function () { return api('PUT', '/api/helpers/' + uid, { perms: perms }).then(function () { S.screen = null; }); }, 'Permisos guardados.')
          .then(function () { window.scrollTo(0, 0); });
      } else {
        run(function () {
          return api('POST', '/api/invites', { name: nombre, perms: perms }).then(function (r) { S.screen = { name: 'invitado', code: r.code, nombre: nombre }; });
        }).then(function () { window.scrollTo(0, 0); });
      }
    } else if (f === 'form-olvido') {
      if (S.busy) return;
      S.busy = true;
      api('POST', '/api/reset', { phone: v('olv-tel'), code: v('olv-codigo'), pin: document.getElementById('olv-pin').value })
        .then(function () { S.err = ''; S.auth = 'login'; history.replaceState(null, '', '/app'); return load(true); })
        .then(function () { toast('Clave cambiada. Ya ha entrado.'); })
        .catch(function (e) { S.err = e.message; render(false); })
        .then(function () { S.busy = false; });
    } else if (f === 'form-clave') {
      run(function () {
        return api('POST', '/api/password', { current: document.getElementById('clave-actual').value, pin: document.getElementById('clave-nueva').value });
      }, 'Clave cambiada.');
    } else if (f === 'form-codigo') {
      run(function () { return aceptar(v('codigo')); }, 'Invitación aceptada.').then(function () { window.scrollTo(0, 0); });
    }
  });

  /* ---------- arranque ---------- */
  api('GET', '/api/info').then(function (d) { S.support = d.support || ''; if (!S.data && S.auth === 'olvido') render(false); }).catch(function () { });
  load(true).then(function () {
    if (S.invite) {
      var code = S.invite; S.invite = '';
      history.replaceState(null, '', '/app');
      run(function () { return aceptar(code); }, 'Invitación aceptada.');
    }
  }).catch(function (e) {
    if (e.status === 401) { render(true); return; }
    view.innerHTML = '<header><h1>KLYP Alquileres</h1></header><p class="err">' + esc(e.message) + '</p><button class="btn" onclick="location.reload()">Probar otra vez</button>';
  });

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', function () { navigator.serviceWorker.register('/sw.js').catch(function () { }); });
  }
})();

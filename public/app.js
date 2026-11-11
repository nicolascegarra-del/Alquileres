/* KLYP Alquileres: aplicación del propietario. */
(function () {
  'use strict';

  var MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
  var ICON = {
    ok: '<svg class="i" viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
    warn: '<svg class="i" viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/></svg>',
    bad: '<svg class="i" viewBox="0 0 24 24"><path d="M12 5v9"/><path d="M12 18.5v.5"/></svg>'
  };
  var TABS = [
    { id: 'pagos', label: 'Pagos', svg: '<svg class="i" viewBox="0 0 24 24"><rect x="3" y="6" width="18" height="13" rx="2.5"/><path d="M3 10.5h18"/><path d="M7 15h4"/></svg>' },
    { id: 'impagos', label: 'Impagos', svg: '<svg class="i" viewBox="0 0 24 24"><path d="M12 4l9 16H3z"/><path d="M12 10v4.5"/><path d="M12 17.5v.2"/></svg>' },
    { id: 'pisos', label: 'Inmuebles', svg: '<svg class="i" viewBox="0 0 24 24"><path d="M4 11l8-7 8 7v9H4z"/><path d="M10 20v-6h4v6"/></svg>' },
    { id: 'averias', label: 'Averías', svg: '<svg class="i" viewBox="0 0 24 24"><path d="M14.5 5.5a4.2 4.2 0 0 0-5 5.4L4 16.4 7.6 20l5.5-5.5a4.2 4.2 0 0 0 5.4-5l-2.8 2.8-2.3-.7-.7-2.3z"/></svg>' },
    { id: 'cuenta', label: 'Cuenta', svg: '<svg class="i" viewBox="0 0 24 24"><circle cx="12" cy="8.5" r="3.8"/><path d="M4.5 20c1-3.800 4-5.500 7.500-5.500s6.500 1.700 7.500 5.500"/></svg>' }
  ];
  var ROLES = { owner: 'Propietario', editor: 'Puede ver y anotar', viewer: 'Solo puede ver' };

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
  function nom(p) { return p.alias || p.address; }
  function prop(id) { return S.data.properties.filter(function (p) { return p.id === id; })[0]; }
  function actual(p) { return p.months[p.months.length - 1]; }
  function est(p, mo) {
    var h = hoy();
    if (mo.paidOn) return { k: 'ok', label: 'Pagado', sub: 'Pagó el ' + fecha(mo.paidOn) };
    if (mo.ym < h.ym) return { k: 'bad', label: 'Sin pagar', sub: 'Mes anterior sin cobrar' };
    if (p.dueDay < h.d) return { k: 'bad', label: 'Retrasado ' + dias(h.d - p.dueDay), sub: 'Tenía que pagar el día ' + p.dueDay };
    if (p.dueDay === h.d) return { k: 'warn', label: 'Se cobra hoy', sub: 'Todavía sin pagar' };
    return { k: 'warn', label: 'Pendiente', sub: 'Se cobra el día ' + p.dueDay + ' (faltan ' + dias(p.dueDay - h.d) + ')' };
  }
  function deuda(p) { return p.months.filter(function (mo) { return est(p, mo).k === 'bad'; }); }
  function puedeAnotar() { return S.data.cartera.role !== 'viewer'; }
  function esPropietario() { return S.data.cartera.role === 'owner'; }
  function listaMeses(arr) {
    var n = arr.map(function (mo) { return mes(mo.ym); });
    return n.length > 1 ? n.slice(0, -1).join(', ') + ' y ' + n[n.length - 1] : n[0];
  }
  function telLimpio(t) { var d = String(t).replace(/\D/g, ''); return d.length === 9 ? '34' + d : d; }

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
      S.data = d; S.cartera = String(d.cartera.ownerId);
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
  function pagar(id, ym, paid) { return function () { return api('POST', '/api/properties/' + id + '/pay', { ym: ym, paid: paid }); }; }

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
    var e = est(p, actual(p));
    return '<button class="row" data-act="abrir" data-id="' + p.id + '"><span class="dot ' + e.k + '">' + ICON[e.k] + '</span>' +
      '<span><span class="t">' + esc(nom(p)) + '</span><br><span class="s">' + sub + '</span></span>' +
      '<span class="amt">' + monto + '</span></button>';
  }
  function vacio() {
    return '<section class="card"><h2>Empiece por su primer inmueble</h2><p>Añada el piso, local o garaje que tiene alquilado y la app llevará la cuenta de cada mes.</p>' +
      (puedeAnotar() ? '<button class="btn primary" data-act="ir" data-screen="form-piso">+ Añadir un inmueble</button>' : '') + '</section>';
  }
  function vPagos() {
    var h = hoy(), ps = S.data.properties, total = 0, cobrado = 0, g = { bad: [], warn: [], ok: [] };
    ps.forEach(function (p) { total += p.rent; if (actual(p).paidOn) cobrado += p.rent; g[est(p, actual(p)).k].push(p); });
    var head = '<header class="stack"><h1>' + mes(h.ym, true) + ' ' + h.y + '</h1>' +
      (S.data.carteras.length > 1 ? '<p class="muted">Alquileres de ' + esc(S.data.cartera.ownerName) + '</p>' : '') + '</header>';
    if (!ps.length) return head + vacio();
    function grupo(titulo, arr) {
      if (!arr.length) return '';
      return '<section class="stack"><h2>' + titulo + ' (' + arr.length + ')</h2><div class="list">' + arr.map(function (p) {
        var e = est(p, actual(p)), ant = deuda(p).filter(function (mo) { return mo.ym < h.ym; }).length;
        return fila(p, esc(p.tenant) + '<br><span class="pill ' + e.k + '">' + e.label + '</span>' +
          (ant ? ' <span class="pill bad">+ ' + nMeses(ant) + ' sin pagar</span>' : ''), eur(p.rent));
      }).join('') + '</div></section>';
    }
    var pct = total ? Math.round(cobrado / total * 100) : 0;
    return head + '<section class="summary" aria-label="Resumen del mes"><p class="muted">Cobrado este mes</p>' +
      '<p class="big">' + eur(cobrado) + '</p><div class="bar"><span style="width:' + pct + '%"></span></div>' +
      '<p>Faltan <b>' + eur(total - cobrado) + '</b> de ' + eur(total) + '</p>' +
      '<button class="btn" data-act="tab" data-tab="impagos">Ver impagos por inmueble</button></section>' +
      grupo('Retrasados', g.bad) + grupo('Pendientes', g.warn) + grupo('Pagados', g.ok);
  }

  /* ---------- impagos ---------- */
  function vImpagos() {
    var con = [], sin = [], total = 0, meses = 0;
    S.data.properties.forEach(function (p) {
      var d = deuda(p);
      if (d.length) { con.push({ p: p, d: d }); total += d.length * p.rent; meses += d.length; } else sin.push(p);
    });
    con.sort(function (a, b) { return b.d.length * b.p.rent - a.d.length * a.p.rent; });
    var h = '<header><h1>Impagos</h1></header>';
    if (!S.data.properties.length) return h + vacio();
    if (!con.length) {
      h += '<section class="status-card ok"><span class="dot">' + ICON.ok + '</span><div><p class="lbl">Todo cobrado</p><p>Ningún inmueble tiene meses sin pagar.</p></div></section>';
    } else {
      h += '<section class="summary" aria-label="Total sin cobrar"><p class="muted">Le deben en total</p><p class="big red">' + eur(total) + '</p>' +
        '<p><b>' + con.length + (con.length === 1 ? ' inmueble' : ' inmuebles') + '</b> · <b>' + nMeses(meses) + '</b> sin cobrar</p></section>' +
        '<section class="stack">' + con.map(function (x) {
          var p = x.p;
          return '<article class="card"><h2>' + esc(nom(p)) + '</h2><p class="muted">' + esc(p.tenant) + (p.alias ? ' · ' + esc(p.address) : '') + '</p>' +
            '<p class="owe">Debe <b>' + eur(x.d.length * p.rent) + '</b> · ' + nMeses(x.d.length) + '</p>' +
            '<div class="months">' + p.months.slice(-6).map(function (mo) {
              var k = est(p, mo).k;
              return '<div class="mcell ' + k + '" title="' + mes(mo.ym, true) + '">' + ICON[k] + '<span>' + MESES[mo.ym % 12].slice(0, 3) + '</span></div>';
            }).join('') + '</div>' +
            x.d.map(function (mo) {
              return '<div class="kv"><span><b>' + mes(mo.ym, true) + '</b><br>' + eur(p.rent) + '</span>' +
                (puedeAnotar() ? '<button class="btn mini" data-act="cobrar" data-id="' + p.id + '" data-ym="' + mo.ym + '">Cobrado</button>' : '') + '</div>';
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
    var p = prop(id), mo = actual(p), e = est(p, mo), d = deuda(p), edit = puedeAnotar();
    var abiertas = S.data.issues.filter(function (a) { return a.propertyId === id && !a.resolvedAt; });
    var msg = d.length ? 'Hola ' + p.tenant.split(' ')[0] + ', le recuerdo que tiene pendiente de pago el alquiler de ' + listaMeses(d) +
      ' (' + eur(d.length * p.rent) + ') de ' + p.address + '. Gracias.' : '';
    var tel = telLimpio(p.phone);
    var h = '<button class="back" data-act="volver">‹ Volver</button>' +
      '<header class="stack"><h1>' + esc(nom(p)) + '</h1><p class="muted">' + esc(p.tenant) + (p.alias ? ' · ' + esc(p.address) : '') + '</p></header>' +
      '<section class="status-card ' + e.k + '"><span class="dot">' + ICON[e.k] + '</span><div><p class="lbl">' + e.label + '</p><p>' +
      mes(mo.ym, true) + ' · ' + e.sub + ' · ' + eur(p.rent) + '</p></div></section>';
    if (edit) {
      h += mo.paidOn
        ? '<button class="btn plain" data-act="descobrar" data-id="' + id + '" data-ym="' + mo.ym + '">Me equivoqué, no ha pagado</button>'
        : '<button class="btn good" data-act="cobrar" data-id="' + id + '" data-ym="' + mo.ym + '">' + ICON.ok + ' Ha pagado ' + mes(mo.ym) + '</button>';
    }
    h += '<section class="card"><h2>Contacto</h2>';
    if (tel) {
      h += '<p class="phone">' + esc(p.phone) + '</p><div class="btn-row"><a class="btn" href="tel:+' + tel + '">Llamar</a>' +
        '<a class="btn" target="_blank" rel="noopener" href="https://wa.me/' + tel + (msg ? '?text=' + encodeURIComponent(msg) : '') + '">WhatsApp</a></div>';
    } else {
      h += '<p class="muted">No ha apuntado el teléfono del inquilino.</p>';
    }
    if (msg) h += '<p class="muted">Mensaje de recordatorio que se envía por WhatsApp:</p><p class="msg">' + esc(msg) + '</p>';
    h += '</section><section class="card"><h2>Mes a mes</h2>' + p.months.slice().reverse().slice(0, 12).map(function (m2) {
      var s = est(p, m2);
      return '<div class="kv"><span><b>' + mes(m2.ym, true) + '</b><br><span class="pill ' + s.k + '">' + (m2.paidOn ? 'Pagó el ' + fecha(m2.paidOn) : s.label) + '</span></span>' +
        (edit ? (m2.paidOn
          ? '<button class="btn mini plain" data-act="descobrar" data-id="' + id + '" data-ym="' + m2.ym + '">Quitar</button>'
          : '<button class="btn mini" data-act="cobrar" data-id="' + id + '" data-ym="' + m2.ym + '">Cobrado</button>') : '') + '</div>';
    }).join('') + '</section>' +
      '<section class="card"><h2>Averías sin resolver</h2>' + (abiertas.length ? abiertas.map(function (a) {
        return '<div class="kv"><span>' + esc(a.text) + '</span><b class="r">' + fecha(a.createdAt) + '</b></div>';
      }).join('') : '<p class="muted">Ninguna.</p>') +
      (edit ? '<button class="btn" data-act="nueva-averia" data-id="' + id + '">Anotar una avería</button>' : '') + '</section>' +
      '<section class="card"><h2>Datos del alquiler</h2>' +
      (p.alias ? '<div class="kv"><span>Nombre corto</span><b class="r">' + esc(p.alias) + '</b></div>' : '') +
      '<div class="kv"><span>Dirección</span><b class="r">' + esc(p.address) + '</b></div>' +
      '<div class="kv"><span>Inquilino</span><b class="r">' + esc(p.tenant) + '</b></div>' +
      '<div class="kv"><span>Renta al mes</span><b class="r">' + eur(p.rent) + '</b></div>' +
      '<div class="kv"><span>Día de cobro</span><b class="r">Día ' + p.dueDay + '</b></div>';
    if (edit) {
      h += '<button class="btn" data-act="editar" data-id="' + id + '">Cambiar estos datos</button>' +
        (S.confirm === id
          ? '<p class="err">¿Seguro? El inmueble dejará de aparecer en la app.</p><div class="btn-row">' +
          '<button class="btn danger" data-act="borrar-si" data-id="' + id + '">Sí, quitarlo</button>' +
          '<button class="btn plain" data-act="borrar-no">No, dejarlo</button></div>'
          : '<button class="btn plain" data-act="borrar" data-id="' + id + '">Quitar este inmueble</button>');
    }
    return h + '</section>';
  }

  /* ---------- inmuebles ---------- */
  function vPisos() {
    var ps = S.data.properties, pl = S.data.plan;
    var h = '<header class="stack"><h1>Mis inmuebles</h1><p class="muted">' +
      (pl.maxProperties == null ? ps.length + (ps.length === 1 ? ' inmueble' : ' inmuebles')
        : ps.length + ' de ' + pl.maxProperties + ' con el plan ' + esc(pl.name)) + '</p></header>';
    if (!ps.length) return h + vacio();
    return h + '<div class="list">' + ps.map(function (p) {
      return fila(p, esc(p.tenant) + ' · día ' + p.dueDay + (p.alias ? '<br>' + esc(p.address) : ''), eur(p.rent));
    }).join('') + '</div>' + (puedeAnotar() ? '<button class="btn primary" data-act="ir" data-screen="form-piso">+ Añadir un inmueble</button>' : '');
  }
  function vFormPiso(id) {
    var p = id ? prop(id) : null, h = hoy(), ops = '';
    for (var i = 0; i < 12; i++) ops += '<option value="' + (h.ym - i) + '">' + mes(h.ym - i, true) + (i === 0 ? ' (este mes)' : '') + '</option>';
    function val(k) { return p ? ' value="' + esc(p[k]) + '"' : ''; }
    return '<button class="back" data-act="volver">‹ Volver</button><header><h1>' + (p ? 'Cambiar datos' : 'Añadir un inmueble') + '</h1></header>' +
      '<form id="form-piso" class="stack-lg">' +
      '<label class="f">Nombre corto<small>Para reconocerlo rápido. Por ejemplo: «Piso de la playa» o «Local farmacia».</small>' +
      '<input type="text" id="piso-alias" maxlength="40"' + val('alias') + '></label>' +
      '<label class="f">Dirección<input type="text" id="piso-dir" maxlength="120" placeholder="Calle, número y piso" required' + val('address') + '></label>' +
      '<label class="f">Nombre del inquilino<input type="text" id="piso-inq" maxlength="80" required' + val('tenant') + '></label>' +
      '<label class="f">Teléfono del inquilino<input type="tel" id="piso-tel" inputmode="tel" maxlength="30"' + val('phone') + '></label>' +
      '<label class="f">Renta al mes (€)<input type="number" id="piso-renta" inputmode="decimal" min="1" step="0.01" required' + val('rent') + '></label>' +
      '<label class="f">Día del mes en que paga<input type="number" id="piso-dia" inputmode="numeric" min="1" max="28" required value="' + (p ? p.dueDay : 5) + '"></label>' +
      (p ? '' : '<label class="f">¿Desde qué mes quiere llevar la cuenta?<small>Si le deben meses anteriores, elija el primero que falta por cobrar.</small>' +
        '<select id="piso-desde">' + ops + '</select></label>') +
      '<button class="btn primary" type="submit">Guardar</button></form>';
  }

  /* ---------- averías ---------- */
  function vAverias() {
    var pend = S.data.issues.filter(function (a) { return !a.resolvedAt; }), hechas = S.data.issues.filter(function (a) { return a.resolvedAt; });
    function item(a) {
      var p = prop(a.propertyId);
      return '<article class="card"><p><span class="pill ' + (a.resolvedAt ? 'ok' : 'warn') + '">' + (a.resolvedAt ? 'Resuelta' : 'Pendiente') + '</span></p>' +
        '<h2>' + esc(a.text) + '</h2><p class="muted">' + esc(p ? nom(p) : '') + ' · ' + fecha(a.createdAt) + '</p>' +
        (a.photo ? '<img class="thumb" src="' + a.photo + '" alt="Foto de la avería" loading="lazy">' : '') +
        (!a.resolvedAt && puedeAnotar() ? '<button class="btn" data-act="resolver" data-id="' + a.id + '">Ya está arreglada</button>' : '') + '</article>';
    }
    return '<header><h1>Averías</h1></header>' +
      (puedeAnotar() && S.data.properties.length ? '<button class="btn primary" data-act="nueva-averia">+ Anotar una avería</button>' : '') +
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
        (d.helpers.length || d.invites.length ? '' : '<p class="muted">Puede invitar a un hijo o a su gestor para que vean sus alquileres.</p>') +
        d.helpers.map(function (a) {
          return '<div class="kv"><span><b>' + esc(a.name) + '</b><br><span class="muted">' + ROLES[a.role] + '</span></span>' +
            '<button class="btn mini plain" data-act="quitar-ayuda" data-id="' + a.userId + '">Quitar</button></div>';
        }).join('') +
        d.invites.map(function (i) {
          return '<div class="kv"><span><b>' + esc(i.name) + '</b><br><span class="muted">Invitación sin aceptar · código ' + esc(i.code) + '</span></span>' +
            '<button class="btn mini plain" data-act="quitar-invitacion" data-code="' + esc(i.code) + '">Anular</button></div>';
        }).join('') +
        '<button class="btn" data-act="ir" data-screen="invitar">+ Invitar a un familiar o gestor</button></section>';
    } else {
      h += '<section class="card"><h2>Está ayudando a ' + esc(d.cartera.ownerName) + '</h2><p>' + ROLES[d.cartera.role] + '.</p></section>';
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
  function vInvitar() {
    return '<button class="back" data-act="volver">‹ Volver</button><header class="stack"><h1>Invitar a alguien</h1>' +
      '<p class="muted">Le daremos un código para que se lo envíe a esa persona.</p></header>' +
      '<form id="form-invitar" class="stack-lg">' +
      '<label class="f">Nombre<input type="text" id="inv-nombre" maxlength="60" required></label>' +
      '<label class="f">¿Qué puede hacer?<select id="inv-rol"><option value="editor">Puede ver y anotar pagos</option><option value="viewer">Solo puede ver</option></select></label>' +
      '<button class="btn primary" type="submit">Crear invitación</button></form>';
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
      if (s && s.name === 'piso') h = vPiso(s.id);
      else if (s && s.name === 'form-piso') h = vFormPiso(s.id);
      else if (s && s.name === 'nueva-averia') h = vNuevaAveria(s.id);
      else if (s && s.name === 'invitar') h = vInvitar();
      else if (s && s.name === 'invitado') h = vInvitado(s);
      else h = { pagos: vPagos, impagos: vImpagos, pisos: vPisos, averias: vAverias, cuenta: vCuenta }[S.tab]();
      tabsBar.hidden = false; appEl.classList.remove('no-tabs');
      tabsEl.innerHTML = TABS.map(function (t) {
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
    var act = b.getAttribute('data-act'), id = Number(b.getAttribute('data-id')) || null, ym = Number(b.getAttribute('data-ym')), p;
    if (act === 'auth') { S.auth = b.getAttribute('data-v'); S.err = ''; render(false); }
    else if (act === 'tab') { S.tab = b.getAttribute('data-tab'); go(null); }
    else if (act === 'abrir') go({ name: 'piso', id: id });
    else if (act === 'editar') go({ name: 'form-piso', id: id });
    else if (act === 'ir') go({ name: b.getAttribute('data-screen') });
    else if (act === 'volver') go(S.screen && S.screen.id && S.screen.name !== 'piso' ? { name: 'piso', id: S.screen.id } : null);
    else if (act === 'nueva-averia') { S.photo = null; go({ name: 'nueva-averia', id: id }); }
    else if (act === 'cobrar') { p = prop(id); run(pagar(id, ym, true), 'Anotado: ' + nom(p) + ' ha pagado ' + mes(ym) + '.', function () { run(pagar(id, ym, false)); }); }
    else if (act === 'descobrar') { run(pagar(id, ym, false), 'Pago de ' + mes(ym) + ' quitado.', function () { run(pagar(id, ym, true)); }); }
    else if (act === 'resolver') {
      run(function () { return api('POST', '/api/issues/' + id + '/resolve', { resolved: true }); }, 'Avería marcada como resuelta.',
        function () { run(function () { return api('POST', '/api/issues/' + id + '/resolve', { resolved: false }); }); });
    }
    else if (act === 'borrar') { S.confirm = id; render(false); }
    else if (act === 'borrar-no') { S.confirm = null; render(false); }
    else if (act === 'borrar-si') { S.screen = null; S.confirm = null; run(function () { return api('DELETE', '/api/properties/' + id); }, 'Inmueble quitado.'); }
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

  /* Reduce la foto en el móvil antes de enviarla. */
  document.addEventListener('change', function (ev) {
    var t = ev.target;
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

  document.addEventListener('submit', function (ev) {
    ev.preventDefault();
    var f = ev.target.id, v = function (i) { var el = document.getElementById(i); return el ? el.value.trim() : ''; };
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
      var id = S.screen.id, body = { alias: v('piso-alias'), address: v('piso-dir'), tenant: v('piso-inq'), phone: v('piso-tel'), rent: v('piso-renta'), dueDay: v('piso-dia') };
      if (!id) body.startYm = Number(v('piso-desde'));
      run(function () {
        return api(id ? 'PUT' : 'POST', '/api/properties' + (id ? '/' + id : ''), body).then(function (r) { S.tab = id ? S.tab : 'pisos'; S.screen = id ? { name: 'piso', id: id } : null; return r; });
      }, 'Guardado.').then(function () { window.scrollTo(0, 0); });
    } else if (f === 'form-averia') {
      run(function () {
        return api('POST', '/api/issues', { propertyId: Number(v('averia-piso')), text: v('averia-txt'), photo: S.photo }).then(function () { S.photo = null; S.tab = 'averias'; S.screen = null; });
      }, 'Avería guardada.').then(function () { window.scrollTo(0, 0); });
    } else if (f === 'form-invitar') {
      var nombre = v('inv-nombre');
      run(function () {
        return api('POST', '/api/invites', { name: nombre, role: v('inv-rol') }).then(function (r) { S.screen = { name: 'invitado', code: r.code, nombre: nombre }; });
      }).then(function () { window.scrollTo(0, 0); });
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

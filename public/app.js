/* KLYP Alquileres: aplicación del propietario. */
(function () {
  'use strict';

  var MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
  var ICON = {
    ok: '<svg class="i" viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
    warn: '<svg class="i" viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/></svg>',
    bad: '<svg class="i" viewBox="0 0 24 24"><path d="M12 5v9"/><path d="M12 18.5v.5"/></svg>',
    none: '<svg class="i" viewBox="0 0 24 24"><path d="M4 11l8-7 8 7v9H4z"/></svg>',
    deal: '<svg class="i" viewBox="0 0 24 24"><rect x="4" y="5" width="16" height="15" rx="2"/><path d="M4 10h16M9 3v4M15 3v4"/><path d="M9 15l2 2 4-4"/></svg>'
  };
  /* mod: apartado del que depende la pestaña. Cuenta se ve siempre. */
  var TABS = [
    { id: 'pagos', mod: 'pagos', label: 'Pagos', svg: '<svg class="i" viewBox="0 0 24 24"><rect x="3" y="6" width="18" height="13" rx="2.5"/><path d="M3 10.5h18"/><path d="M7 15h4"/></svg>' },
    { id: 'impagos', mod: 'pagos', label: 'Impagos', svg: '<svg class="i" viewBox="0 0 24 24"><path d="M12 4l9 16H3z"/><path d="M12 10v4.5"/><path d="M12 17.5v.2"/></svg>' },
    { id: 'facturas', mod: 'suministros', label: 'Facturas', svg: '<svg class="i" viewBox="0 0 24 24"><path d="M6 3h9l4 4v14H6z"/><path d="M14 3v5h5"/><path d="M9 13h6"/><path d="M9 17h4"/></svg>' },
    { id: 'pisos', mod: 'inmuebles', label: 'Inmuebles', svg: '<svg class="i" viewBox="0 0 24 24"><path d="M4 11l8-7 8 7v9H4z"/><path d="M10 20v-6h4v6"/></svg>' },
    { id: 'cuenta', label: 'Cuenta', svg: '<svg class="i" viewBox="0 0 24 24"><circle cx="12" cy="8.5" r="3.8"/><path d="M4.5 20c1-3.800 4-5.500 7.500-5.500s6.500 1.700 7.500 5.500"/></svg>' }
  ];
  var MODS = [
    { id: 'pagos', label: 'Pagos e impagos' }, { id: 'suministros', label: 'Facturas de suministros' },
    { id: 'inmuebles', label: 'Inmuebles e inquilinos' }
  ];
  var NIVEL = ['No lo ve', 'Solo puede ver', 'Puede ver y anotar'];
  var TIPOS = { luz: 'Luz', agua: 'Agua' };

  var params = new URLSearchParams(location.search);
  var S = {
    data: null, tab: 'pagos', screen: null, cartera: null,
    auth: params.has('olvido') ? 'olvido' : (params.has('registro') || params.has('invitacion') ? 'registro' : 'login'), support: '',
    invite: (params.get('invitacion') || '').toUpperCase(), err: '', confirm: null, busy: false,
    doc: null, pages: [], facProp: 0
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
    var h = hoy(), due = mo.due;
    if (mo.paidOn) return { k: 'ok', label: 'Pagado', sub: 'Pagó el ' + fecha(mo.paidOn) };
    if (mo.agreementId) {
      return estAc(S.ags[mo.agreementId]).done ? { k: 'ok', label: 'Pagado con el acuerdo', sub: 'Saldado con el acuerdo de pago' }
        : { k: 'deal', label: 'En acuerdo de pago', sub: 'Se paga con las cuotas del acuerdo' };
    }
    if (mo.ym < h.ym) return { k: 'bad', label: 'Sin pagar', sub: 'Mes anterior sin cobrar' };
    if (due < h.d) return { k: 'bad', label: 'Retrasado ' + dias(h.d - due), sub: 'Tenía que pagar el día ' + due };
    if (due === h.d) return { k: 'warn', label: 'Se cobra hoy', sub: 'Todavía sin pagar' };
    return { k: 'warn', label: 'Pendiente', sub: 'Se cobra el día ' + due + ' (faltan ' + dias(due - h.d) + ')' };
  }
  function cent(n) { return Math.round(n * 100); }
  /* Situación de un acuerdo de pago. Importes en céntimos para no arrastrar decimales. */
  function estAc(a) {
    var h = hoy(), total = cent(a.total), extra = cent(a.extra), paid = cent(suma(a.payments, 'amount'));
    var left = Math.max(0, total - paid), cuotas = Math.ceil(total / extra), vencidas = 0;
    for (var ym = a.startYm; ym <= h.ym; ym++) if (ym < h.ym || a.p.dueDay < h.d) vencidas++;
    var late = Math.max(0, Math.min(total, vencidas * extra) - paid);
    var mesActual = Math.max(0, Math.min(total, Math.max(0, h.ym - a.startYm + 1) * extra) - paid);
    var e = { left: left / 100, paid: paid / 100, late: late / 100, thisMonth: mesActual / 100, cuotas: cuotas, endYm: a.startYm + cuotas - 1, done: left === 0 };
    if (e.done) { e.k = 'ok'; e.label = 'Acuerdo cumplido'; }
    else if (a.brokenAt) { e.k = 'bad'; e.label = 'No cumplido · quedan ' + eur(e.left); }
    else if (late) { e.k = 'bad'; e.label = 'Va retrasado · debe ' + eur(e.late) + ' de cuotas'; }
    else if (mesActual && h.ym >= a.startYm) { e.k = 'warn'; e.label = 'Al día · falta la cuota de ' + mes(h.ym); }
    else { e.k = 'deal'; e.label = 'Al día'; }
    return e;
  }
  function vive(c, ym) { return ym >= ymDe(c.startDate) && (!c.endDate || ymDe(c.endDate) >= ym); }
  function ymDe(iso) { return Number(iso.slice(0, 4)) * 12 + Number(iso.slice(5, 7)) - 1; }
  function rentaEn(c, ym) { return !vive(c, ym) ? 0 : (c.nextRaise && ym >= c.nextRaise.fromYm ? c.nextRaise.rent : c.rent); }
  function deuda(p) { return p.months.filter(function (mo) { return est(p, mo).k === 'bad'; }); }
  function suma(arr, k) { return arr.reduce(function (a, x) { return a + x[k]; }, 0); }
  function lv(m) { return S.data.cartera.perms[m]; }
  function can(m) { return lv(m) >= 2; }
  function esPropietario() { return S.data.cartera.role === 'owner'; }
  function listaMeses(arr) {
    var n = arr.map(function (mo) { return mes(mo.ym); });
    return n.length > 1 ? n.slice(0, -1).join(', ') + ' y ' + n[n.length - 1] : n[0];
  }
  /* Dirección para los enlaces que se envían: la pública configurada o, si no hay, la actual. */
  function base() { return (S.data && S.data.publicUrl) || location.origin; }
  function telLimpio(t) { var d = String(t).replace(/\D/g, ''); return d.length === 9 ? '34' + d : d; }
  function tipo(u) { return TIPOS[u.kind] || u.label; }
  function sinPagar(pid) { return S.data.utilities.filter(function (u) { return !u.paidOn && !u.agreementId && (!pid || u.propertyId === pid); }); }
  function periodo(c) { return c.endDate ? 'Del ' + fechaC(c.startDate) + ' al ' + fechaC(c.endDate) : 'Desde el ' + fechaC(c.startDate); }
  function resumen(perms) {
    var t = MODS.filter(function (m) { return perms[m.id] > 0; }).map(function (m) { return m.label + (perms[m.id] === 1 ? ' (solo ver)' : ''); });
    return t.length ? t.join(' · ') : 'Nada';
  }

  /* Prepara los datos del servidor: inquilino actual y meses de todos los inquilinos, en orden. */
  function preparar(d) {
    var ym = Number(d.today.slice(0, 4)) * 12 + Number(d.today.slice(5, 7)) - 1;
    S.ags = {};
    d.properties.forEach(function (p) {
      p.contracts.forEach(function (c) { c.agreements.forEach(function (a) { a.c = c; a.p = p; S.ags[a.id] = a; }); });
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
  function fila(p, sub, monto, mo) {
    mo = mo === undefined ? p.now : mo;
    var k = mo ? est(p, mo).k : 'none';
    return '<button class="row" data-act="abrir" data-id="' + p.id + '"><span class="dot ' + k + '">' + ICON[k] + '</span>' +
      '<span><span class="t">' + esc(nom(p)) + '</span><br><span class="s">' + sub + '</span></span>' +
      '<span class="amt">' + monto + '</span></button>';
  }
  function vacio() {
    return '<section class="card"><h2>Empiece por su primer inmueble</h2><p>Añada el piso, local o garaje que tiene alquilado y la app llevará la cuenta de cada mes.</p>' +
      (can('inmuebles') ? '<button class="btn primary" data-act="ir" data-screen="form-piso">+ Añadir un inmueble</button>' : '') + '</section>';
  }
  function vPagos() {
    var h = hoy(), ps = S.data.properties, total = 0, cobrado = 0, g = { bad: [], warn: [], deal: [], ok: [], none: [] };
    ps.forEach(function (p) {
      var ms = p.months.filter(function (mo) { return mo.ym === h.ym; });
      if (!ms.length) g.none.push({ p: p, mo: null });
      ms.forEach(function (mo) { total += mo.rent; if (mo.paidOn) cobrado += mo.rent; g[est(p, mo).k].push({ p: p, mo: mo }); });
    });
    var head = '<header class="stack"><h1>' + mes(h.ym, true) + ' ' + h.y + '</h1>' +
      (S.data.carteras.length > 1 ? '<p class="muted">Alquileres de ' + esc(S.data.cartera.ownerName) + '</p>' : '') + '</header>';
    if (!ps.length) return head + vacio();
    function grupo(titulo, arr) {
      if (!arr.length) return '';
      return '<section class="stack"><h2>' + titulo + ' (' + arr.length + ')</h2><div class="list">' + arr.map(function (x) {
        var p = x.p, mo = x.mo;
        if (!mo) return fila(p, 'Sin inquilino este mes', '', null);
        var e = est(p, mo), ant = deuda(p).filter(function (m2) { return m2.c === mo.c && m2.ym < h.ym; }).length;
        return fila(p, esc(mo.c.tenant) + (mo.days ? ' · ' + dias(mo.days) : '') + '<br><span class="pill ' + e.k + '">' + e.label + '</span>' +
          (ant ? ' <span class="pill bad">+ ' + nMeses(ant) + ' sin pagar</span>' : ''), eur(mo.rent), mo);
      }).join('') + '</div></section>';
    }
    var acs = Object.keys(S.ags).map(function (id) { return S.ags[id]; }).filter(function (a) { var e = estAc(a); return !e.done && !a.brokenAt; });
    var pct = total ? Math.round(cobrado / total * 100) : 0;
    return head + '<section class="summary" aria-label="Resumen del mes"><p class="muted">Cobrado este mes</p>' +
      '<p class="big">' + eur(cobrado) + '</p><div class="bar"><span style="width:' + pct + '%"></span></div>' +
      '<p>Faltan <b>' + eur(total - cobrado) + '</b> de ' + eur(total) + '</p>' +
      '<button class="btn" data-act="tab" data-tab="impagos">Ver impagos</button></section>' +
      grupo('Retrasados', g.bad) + grupo('Pendientes', g.warn) + grupo('En acuerdo de pago', g.deal) + grupo('Pagados', g.ok) + grupo('Sin inquilino ahora', g.none) +
      (acs.length ? '<section class="stack"><h2>Cuotas de acuerdos de pago (' + acs.length + ')</h2><div class="list">' + acs.map(filaAcuerdo).join('') + '</div></section>' : '');
  }
  function filaAcuerdo(a) {
    var e = estAc(a);
    return '<button class="row" data-act="acuerdo" data-id="' + a.p.id + '" data-aid="' + a.id + '"><span class="dot ' + e.k + '">' + ICON[e.k === 'ok' ? 'ok' : e.k === 'bad' ? 'bad' : 'deal'] + '</span>' +
      '<span><span class="t">' + esc(a.c.tenant) + '</span><br><span class="s">' + esc(nom(a.p)) + ' · cuota de ' + eur(a.extra) + '<br><span class="pill ' + e.k + '">' + e.label + '</span></span></span>' +
      '<span class="amt">' + eur(e.left) + '</span></button>';
  }

  /* ---------- impagos ---------- */
  function vImpagos() {
    var lista = [], sin = [], total = 0;
    S.data.properties.forEach(function (p) {
      var tiene = false;
      p.contracts.forEach(function (c) {
        var d = deuda(p).filter(function (mo) { return mo.c === c; });
        var u = sinPagar(p.id).filter(function (x) { return x.contractId === c.id; });
        var ags = c.agreements.filter(function (a) { return !estAc(a).done; });
        var t = suma(d, 'rent') + suma(u, 'amount') + ags.reduce(function (acc, a) { return acc + estAc(a).left; }, 0);
        if (cent(t) > 0) { lista.push({ p: p, c: c, d: d, u: u, ags: ags, t: t }); total += t; tiene = true; }
      });
      if (!tiene) sin.push(p);
    });
    lista.sort(function (a, b) { return b.t - a.t; });
    var h = '<header><h1>Impagos</h1></header>';
    if (!S.data.properties.length) return h + vacio();
    if (!lista.length) {
      h += '<section class="status-card ok"><span class="dot">' + ICON.ok + '</span><div><p class="lbl">Todo cobrado</p><p>Nadie debe alquiler ni facturas.</p></div></section>';
    } else {
      h += '<section class="summary" aria-label="Total sin cobrar"><p class="muted">Le deben en total</p><p class="big red">' + eur(total) + '</p>' +
        '<p><b>' + lista.length + (lista.length === 1 ? ' persona' : ' personas') + '</b> con deudas</p></section>' +
        '<section class="stack">' + lista.map(function (x) {
          var p = x.p, c = x.c, fuera = !c.active && c.endDate && c.endDate < S.data.today;
          return '<article class="card"><h2>' + esc(c.tenant) + '</h2><p class="muted">' + esc(nom(p)) +
            (fuera ? ' · <b>ya no vive aquí</b> (salió el ' + fechaC(c.endDate) + ')' : '') + '</p>' +
            '<p class="owe">Debe <b>' + eur(x.t) + '</b></p>' +
            x.d.map(function (mo) {
              return '<div class="kv"><span><b>Alquiler de ' + mes(mo.ym) + '</b><br>' + eur(mo.rent) + (mo.days ? ' (' + dias(mo.days) + ')' : '') + '</span>' +
                (can('pagos') ? '<button class="btn mini" data-act="cobrar" data-id="' + p.id + '" data-cid="' + c.id + '" data-ym="' + mo.ym + '">Cobrado</button>' : '') + '</div>';
            }).join('') +
            x.u.map(function (u) {
              return '<div class="kv"><span><b>Factura de ' + esc(tipo(u).toLowerCase()) + '</b><br>' + eur(u.amount) + ' · ' + fechaC(u.billDate) + '</span>' +
                (can('suministros') ? '<button class="btn mini" data-act="factura-pagada" data-id="' + u.id + '">Pagada</button>' : '') + '</div>';
            }).join('') +
            x.ags.map(function (a) {
              var e = estAc(a);
              return '<div class="kv"><span><b>Acuerdo de pago</b> · quedan ' + eur(e.left) + '<br><span class="pill ' + e.k + '">' + e.label + '</span></span>' +
                '<button class="btn mini" data-act="acuerdo" data-id="' + p.id + '" data-aid="' + a.id + '">Ver</button></div>';
            }).join('') +
            ((x.d.some(function (mo) { return mo.ym < hoy().ym; }) || x.u.length) && can('pagos') ? '<button class="btn primary" data-act="nuevo-acuerdo" data-id="' + p.id + '" data-cid="' + c.id + '">Hacer un acuerdo de pago</button>' : '') +
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
    var d = c ? deuda(p).filter(function (m2) { return m2.c === c; }) : [];
    var fu = c ? sinPagar(id).filter(function (u) { return u.contractId === c.id; }) : [];
    var partes = [];
    if (d.length) partes.push('el alquiler de ' + listaMeses(d) + ' (' + eur(suma(d, 'rent')) + ')');
    if (fu.length) partes.push((fu.length === 1 ? 'una factura' : fu.length + ' facturas') + ' de suministros (' + eur(suma(fu, 'amount')) + ')');
    if (c) c.agreements.forEach(function (a) { var ea = estAc(a); if (!ea.done && !a.brokenAt && ea.thisMonth) partes.push('la cuota del acuerdo de pago (' + eur(ea.thisMonth) + ')'); });
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
        return '<div class="kv"><span><b>' + mes(m2.ym, true) + '</b> · ' + eur(m2.rent) + (m2.days ? ' (' + dias(m2.days) + ')' : '') +
          (m2.custom ? ' (corregido)' : '') + (m2.c !== c ? ' · ' + esc(m2.c.tenant) : '') +
          '<br><span class="pill ' + s.k + '">' + (m2.paidOn ? 'Pagó el ' + fecha(m2.paidOn) : s.label) + '</span></span>' +
          (can('pagos') && !m2.agreementId ? (m2.paidOn
            ? '<button class="btn mini plain" data-act="descobrar" data-id="' + id + '" data-cid="' + m2.c.id + '" data-ym="' + m2.ym + '">Quitar</button>'
            : '<button class="btn mini" data-act="cobrar" data-id="' + id + '" data-cid="' + m2.c.id + '" data-ym="' + m2.ym + '">Cobrado</button>') : '') + '</div>';
      }).join('') + (can('pagos') ? '<button class="btn plain" data-act="importe" data-id="' + id + '">Corregir el importe de un mes</button>' : '') + '</section>';
      var conAc = p.contracts.filter(function (k) { return k.agreements.length; }), conDeuda = p.contracts.filter(function (k) {
        return deuda(p).some(function (m3) { return m3.c === k && m3.ym < hoy().ym; }) || sinPagar(id).some(function (u) { return u.contractId === k.id; });
      });
      if (conAc.length || conDeuda.length) {
        h += '<section class="card"><h2>Acuerdos de pago</h2>' + conAc.map(function (k) {
          return k.agreements.map(function (a) {
            var ea = estAc(a);
            return '<div class="kv"><span><b>' + esc(k.tenant) + '</b> · quedan ' + eur(ea.left) + '<br><span class="pill ' + ea.k + '">' + ea.label + '</span></span>' +
              '<button class="btn mini" data-act="acuerdo" data-id="' + id + '" data-aid="' + a.id + '">Ver</button></div>';
          }).join('');
        }).join('') + (can('pagos') ? conDeuda.map(function (k) {
          return '<button class="btn" data-act="nuevo-acuerdo" data-id="' + id + '" data-cid="' + k.id + '">Hacer un acuerdo de pago con ' + esc(k.tenant.split(' ')[0]) + '</button>';
        }).join('') : '') + '</section>';
      }
    }
    if (p.utilities && lv('suministros') >= 1) {
      var us = sinPagar(id);
      h += '<section class="card"><h2>Facturas de suministros sin pagar</h2>' + (us.length ? us.map(function (u) {
        var cu = contrato(p, u.contractId);
        return '<div class="kv"><span><b>' + esc(tipo(u)) + '</b> · ' + eur(u.amount) + '<br><span class="muted">' + fechaC(u.billDate) +
          (cu && cu !== c ? ' · ' + esc(cu.tenant) : '') + (u.sentAt ? '' : ' · sin enviar') + '</span></span>' +
          (can('suministros') ? '<button class="btn mini" data-act="factura-pagada" data-id="' + u.id + '">Pagada</button>' : '') + '</div>';
      }).join('') : '<p class="muted">Ninguna.</p>') +
        (function () {
          var r = resumenFacturas(S.data.utilities.filter(function (x) { return x.propertyId === id; }));
          return '<p class="muted">En ' + hoy().y + ': ' + r.n + (r.n === 1 ? ' factura' : ' facturas') + ' · ' + eur(r.anio) + ' · cobrado ' + eur(r.pagado) + '</p>';
        })() +
        (can('suministros') ? '<button class="btn" data-act="nueva-factura" data-id="' + id + '">Subir una factura</button>' : '') +
        '<button class="btn plain" data-act="fac-prop" data-id="' + id + '">Ver todas las facturas de este inmueble</button></section>';
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
        (lv('suministros') >= 1 ? '<div class="kv"><span>Facturas de suministros</span><b class="r">' + (p.utilities ? 'Sí' : 'No') + '</b></div>' : '');
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
        : ps.length + ' de ' + pl.maxProperties + (pl.customLimit ? ' permitidos' : ' con el plan ' + esc(pl.name))) + '</p></header>';
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
      '<label class="f">Correo del inquilino<small>Si quiere enviarle las facturas también por correo.</small>' +
      '<input type="email" id="con-mail" inputmode="email" autocapitalize="none" maxlength="120"' + val('email') + '></label>' +
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
      (lv('suministros') >= 1 ? '<label class="check"><input type="checkbox" id="piso-sum"' + (p && p.utilities ? ' checked' : '') + '>' +
        '<span><b>Necesito facturas de suministros</b><small>Márquelo si el inquilino paga aparte la luz, el agua u otros gastos y quiere subirle las facturas.</small></span></label>' : '') +
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
      ': ' + eur(u.amount) + '. Puede verla aquí: ' + base() + u.url + ' Queda pendiente de pago. Gracias.';
    var asunto = 'Factura de ' + tipo(u).toLowerCase() + ' · ' + p.address + ' · ' + fechaC(u.billDate);
    return {
      txt: txt, c: c, href: 'https://wa.me/' + telLimpio(c.phone) + '?text=' + encodeURIComponent(txt),
      mail: 'mailto:' + encodeURIComponent(c.email || '') + '?subject=' + encodeURIComponent(asunto) + '&body=' + encodeURIComponent(txt)
    };
  }
  /* Botones para enviar una factura: WhatsApp, correo y el archivo de verdad (menú de compartir del móvil). */
  function botonesEnvio(u, fuerte) {
    var w = waFactura(u);
    var directo = S.data.mailReady && w.c.email;
    return '<div class="btn-row"><a class="btn' + (fuerte ? ' good' : '') + '" target="_blank" rel="noopener" href="' + esc(w.href) + '" data-act="enviada" data-id="' + u.id + '">WhatsApp</a>' +
      (directo ? '<button class="btn' + (fuerte && !u.emailSentAt ? ' good' : '') + '" data-act="mail-auto" data-id="' + u.id + '">' + (u.emailSentAt ? 'Reenviar correo' : 'Correo') + '</button>'
        : '<a class="btn' + (fuerte ? ' good' : '') + '" href="' + esc(w.mail) + '" data-act="enviada" data-id="' + u.id + '">Correo</a>') + '</div>' +
      (navigator.share && navigator.canShare ? '<button class="btn" data-act="compartir-pdf" data-id="' + u.id + '">Enviar el PDF como archivo</button>' : '');
  }
  function resumenFacturas(us) {
    var y = String(hoy().y), anio = us.filter(function (u) { return u.billDate.slice(0, 4) === y; });
    return {
      pend: suma(us.filter(function (u) { return !u.paidOn && !u.agreementId; }), 'amount'),
      acuerdo: suma(us.filter(function (u) { return !u.paidOn && u.agreementId; }), 'amount'),
      anio: suma(anio, 'amount'), pagado: suma(anio.filter(function (u) { return u.paidOn; }), 'amount'), n: anio.length,
      tipos: anio.reduce(function (acc, u) { var t = tipo(u); acc[t] = (acc[t] || 0) + u.amount; return acc; }, {})
    };
  }
  function vFacturas() {
    var conSum = S.data.properties.filter(function (p) { return p.utilities; }), edit = can('suministros'), y = hoy().y;
    if (S.facProp && !prop(S.facProp)) S.facProp = 0;
    var us = S.data.utilities.filter(function (u) { return !S.facProp || u.propertyId === S.facProp; });
    var pend = us.filter(function (u) { return !u.paidOn; }), hechas = us.filter(function (u) { return u.paidOn; });
    function item(u) {
      var p = prop(u.propertyId), w = waFactura(u);
      var ac = u.agreementId ? S.ags[u.agreementId] : null;
      if (u.agreementId) {
        return '<article class="card"><p><span class="pill deal">En acuerdo de pago</span></p><h2>' + esc(tipo(u)) + ' · ' + eur(u.amount) + '</h2>' +
          '<p class="muted">' + esc(nom(p)) + ' · ' + esc(w.c.tenant) + ' · factura del ' + fechaC(u.billDate) + '</p>' +
          '<div class="btn-row"><a class="btn" target="_blank" rel="noopener" href="' + u.url + '">Ver el PDF</a>' +
          (ac ? '<button class="btn" data-act="acuerdo" data-id="' + p.id + '" data-aid="' + ac.id + '">Ver el acuerdo</button>' : '<span></span>') + '</div></article>';
      }
      return '<article class="card"><p><span class="pill ' + (u.paidOn ? 'ok' : 'bad') + '">' + (u.paidOn ? 'Pagada el ' + fecha(u.paidOn) : 'Pendiente de pago') + '</span> ' +
        (u.paidOn ? '' : u.emailSentAt ? '<span class="pill ok">Correo enviado el ' + fecha(u.emailSentAt) + '</span>'
          : '<span class="pill ' + (u.sentAt ? 'ok' : 'warn') + '">' + (u.sentAt ? 'Enviada el ' + fecha(u.sentAt) : 'Sin enviar') + '</span>') +
        (!u.paidOn && u.emailError && !u.emailSentAt ? ' <span class="pill bad">Correo no enviado</span>' : '') + '</p>' +
        '<h2>' + esc(tipo(u)) + ' · ' + eur(u.amount) + '</h2><p class="muted">' + esc(nom(p)) + ' · ' + esc(w.c.tenant) + ' · factura del ' + fechaC(u.billDate) + '</p>' +
        (!u.paidOn && u.emailError && !u.emailSentAt ? '<p class="err">' + esc(u.emailError) + '</p>' : '') +
        (u.paidOn ? '' : botonesEnvio(u, !u.sentAt)) +
        '<div class="btn-row"><a class="btn" target="_blank" rel="noopener" href="' + u.url + '">Ver el PDF</a>' +
        (edit ? (u.paidOn ? '<button class="btn plain" data-act="factura-impagada" data-id="' + u.id + '">Quitar el pago</button>'
          : '<button class="btn" data-act="factura-pagada" data-id="' + u.id + '">Ya la ha pagado</button>') : '<span></span>') + '</div>' +
        (edit ? (S.confirm === 'u' + u.id
          ? '<p class="err">¿Seguro que quiere borrar esta factura?</p><div class="btn-row"><button class="btn danger" data-act="borrar-factura-si" data-id="' + u.id + '">Sí, borrarla</button>' +
          '<button class="btn plain" data-act="borrar-no">No, dejarla</button></div>'
          : '<button class="btn plain" data-act="borrar-factura" data-id="' + u.id + '">Borrar la factura</button>') : '') + '</article>';
    }
    var h = '<header class="stack"><h1>Facturas</h1><p class="muted">Luz, agua y otros gastos que paga el inquilino.</p></header>';
    if (!conSum.length) {
      return h + '<section class="card"><h2>Ningún inmueble las tiene activadas</h2><p>Para subir facturas, abra el inmueble, pulse «Cambiar estos datos» y marque «Necesito facturas de suministros».</p></section>';
    }
    h += (edit ? '<button class="btn primary" data-act="nueva-factura" data-id="' + (S.facProp || '') + '">+ Subir una factura</button>' : '') +
      '<label class="f">Ver facturas de<select id="fac-filtro"><option value="0">Todos los inmuebles</option>' + conSum.map(function (p) {
        return '<option value="' + p.id + '"' + (p.id === S.facProp ? ' selected' : '') + '>' + esc(nom(p)) + '</option>';
      }).join('') + '</select></label>';
    if (S.facProp) {
      var r = resumenFacturas(us);
      h += '<section class="card"><h2>' + esc(nom(prop(S.facProp))) + '</h2>' +
        '<div class="kv"><span>Pendiente de cobrar</span><b class="r' + (r.pend ? ' red' : '') + '">' + eur(r.pend) + '</b></div>' +
        (r.acuerdo ? '<div class="kv"><span>En acuerdo de pago</span><b class="r">' + eur(r.acuerdo) + '</b></div>' : '') +
        '<div class="kv"><span>Facturas de ' + y + '</span><b class="r">' + r.n + ' · ' + eur(r.anio) + '</b></div>' +
        Object.keys(r.tipos).map(function (t) { return '<div class="kv"><span>· ' + esc(t) + '</span><b class="r">' + eur(r.tipos[t]) + '</b></div>'; }).join('') +
        '<div class="kv"><span>Cobrado de ' + y + '</span><b class="r">' + eur(r.pagado) + '</b></div></section>';
    } else {
      h += '<section class="card"><h2>Por inmueble</h2>' + conSum.map(function (p) {
        var r = resumenFacturas(S.data.utilities.filter(function (u) { return u.propertyId === p.id; }));
        return '<button class="kv link" data-act="fac-prop" data-id="' + p.id + '"><span><b>' + esc(nom(p)) + '</b><br><span class="muted">' + y + ': ' + eur(r.anio) + ' · cobrado ' + eur(r.pagado) + '</span></span>' +
          '<span class="pill ' + (r.pend ? 'bad' : 'ok') + '">' + (r.pend ? 'Debe ' + eur(r.pend) : 'Al día') + '</span></button>';
      }).join('') + '</section>';
    }
    return h + '<section class="stack"><h2>Pendientes de pago (' + pend.length + ')</h2>' + (pend.length ? pend.map(item).join('') : '<p class="muted">No hay facturas pendientes.</p>') + '</section>' +
      (hechas.length ? '<section class="stack"><h2>Pagadas (' + hechas.length + ')</h2>' + hechas.slice(0, 30).map(item).join('') + '</section>' : '');
  }
  function vDoc() {
    if (S.doc) return '<div class="kv"><span><b>' + esc(S.doc.name) + '</b><br><span class="muted">PDF</span></span><button class="btn mini plain" type="button" data-act="doc-quitar">Quitar</button></div>';
    return S.pages.map(function (pg, i) {
      return '<div class="kv"><span class="pg"><img src="' + pg.url + '" alt=""><b>Página ' + (i + 1) + '</b></span>' +
        '<button class="btn mini plain" type="button" data-act="pagina-quitar" data-i="' + i + '">Quitar</button></div>';
    }).join('');
  }
  function vNuevaFactura(sel) {
    var ps = S.data.properties.filter(function (p) { return p.utilities; });
    return '<button class="back" data-act="volver">‹ Volver</button><header><h1>Subir una factura</h1></header>' +
      '<form id="form-factura" class="stack-lg">' +
      '<section class="card"><h2>La factura</h2><p class="muted">Haga una foto al papel (una por página) o elija el PDF o las fotos que ya tenga en el móvil.</p>' +
      '<div id="doc-lista">' + vDoc() + '</div>' +
      '<label class="btn primary">' + (S.pages.length ? 'Hacer foto de otra página' : 'Hacer una foto') + '<input type="file" id="fac-foto" accept="image/*" capture="environment" hidden></label>' +
      '<label class="btn">Elegir PDF o fotos<input type="file" id="fac-archivo" accept="application/pdf,.pdf,image/*" multiple hidden></label></section>' +
      '<label class="f">¿De qué inmueble es?<select id="fac-piso">' + ps.map(function (p) {
        return '<option value="' + p.id + '"' + (p.id === sel ? ' selected' : '') + '>' + esc(nom(p)) + '</option>';
      }).join('') + '</select></label>' +
      '<label class="f">¿De qué es?<select id="fac-tipo"><option value="luz">Luz</option><option value="agua">Agua</option><option value="otro">Otro</option></select></label>' +
      '<label class="f" id="fac-otro-caja" hidden>Escriba de qué es<small>Por ejemplo: gas, comunidad, basuras.</small><input type="text" id="fac-otro" maxlength="40"></label>' +
      '<label class="f">Importe (€)<input type="number" id="fac-importe" inputmode="decimal" min="0.01" step="0.01" required></label>' +
      '<label class="f">Fecha de la factura<small>Se le apunta al inquilino que estaba en el inmueble ese día.</small>' +
      '<input type="date" id="fac-fecha" required value="' + S.data.today + '"></label>' +
      (S.data.mailReady ? '<label class="check"><input type="checkbox" id="fac-mail" checked><span><b>Enviarla por correo al inquilino al guardar</b>' +
        '<small>Con el PDF adjunto. Solo si tiene apuntado su correo.</small></span></label>' : '') +
      '<button class="btn primary" type="submit">Guardar la factura</button></form>';
  }
  function vFacturaOk(s) {
    var u = S.data.utilities.filter(function (x) { return x.id === s.uid; })[0];
    if (!u) return vFacturas();
    var w = waFactura(u);
    return '<button class="back" data-act="volver">‹ Volver a Facturas</button><header class="stack"><h1>Factura guardada</h1>' +
      '<p>Queda anotada como <b>pendiente de pago</b> por ' + esc(w.c.tenant) + ': ' + esc(tipo(u).toLowerCase()) + ', ' + eur(u.amount) + '.</p></header>' +
      (u.emailSentAt ? '<section class="status-card ok"><span class="dot">' + ICON.ok + '</span><div><p class="lbl">Enviada por correo</p><p>A ' + esc(w.c.email) + ', con el PDF adjunto.</p></div></section>' : '') +
      (u.emailError && !u.emailSentAt ? '<p class="err">El correo no se ha podido enviar: ' + esc(u.emailError) + '</p>' : '') +
      '<h2>' + (u.emailSentAt ? 'Enviarla también por otra vía' : 'Envíesela a ' + esc(w.c.tenant.split(' ')[0])) + '</h2>' +
      (w.c.phone ? '' : '<p class="msg">No tiene apuntado su teléfono: WhatsApp le pedirá que elija a quién enviarla.</p>') +
      (w.c.email ? '' : '<p class="msg">No tiene apuntado su correo: puede añadirlo en la ficha del inmueble, en «Inquilinos».</p>') +
      botonesEnvio(u, true) +
      '<p class="muted">' + (S.data.mailReady && w.c.email ? '«Correo» la envía directamente desde la app, con el PDF adjunto. WhatsApp abre el mensaje ya escrito, con un enlace a la factura.'
        : 'WhatsApp y Correo abren el mensaje ya escrito, con un enlace a la factura.') + ' «Enviar el PDF como archivo» adjunta el documento: elija WhatsApp o su correo en el menú que aparece.</p>' +
      '<p class="msg">' + esc(w.txt) + '</p>' +
      '<a class="btn plain" target="_blank" rel="noopener" href="' + u.url + '">Ver el PDF</a>';
  }

  /* ---------- acuerdos de pago ---------- */
  function vNuevoAcuerdo(sc) {
    var p = prop(sc.id), c = contrato(p, sc.cid), h = hoy();
    var d = deuda(p).filter(function (mo) { return mo.c === c && mo.ym < h.ym; }), u = sinPagar(p.id).filter(function (x) { return x.contractId === c.id; });
    var total = suma(d, 'rent') + suma(u, 'amount'), actual = deuda(p).filter(function (mo) { return mo.c === c && mo.ym === h.ym; })[0];
    if (!cent(total)) return '<button class="back" data-act="volver">‹ Volver</button><p class="msg">' + esc(c.tenant) + ' no tiene deudas pendientes.</p>';
    return '<button class="back" data-act="volver">‹ Volver</button><header class="stack"><h1>Acuerdo de pago</h1>' +
      '<p class="muted">' + esc(c.tenant) + ' · ' + esc(nom(p)) + '</p></header>' +
      '<section class="card"><h2>Lo que debe hoy: ' + eur(total) + '</h2>' +
      d.map(function (mo) { return '<div class="kv"><span>Alquiler de ' + mes(mo.ym) + '</span><b class="r">' + eur(mo.rent) + '</b></div>'; }).join('') +
      u.map(function (x) { return '<div class="kv"><span>Factura de ' + esc(tipo(x).toLowerCase()) + ' del ' + fechaC(x.billDate) + '</span><b class="r">' + eur(x.amount) + '</b></div>'; }).join('') +
      '<p class="muted">Todo esto pasa al acuerdo y deja de aparecer suelto en Impagos.' +
      (actual ? ' La renta de ' + mes(h.ym) + ' (' + eur(actual.rent) + ') no entra: se cobra aparte, como siempre.' : '') + '</p></section>' +
      '<form id="form-acuerdo" class="stack-lg">' +
      '<label class="f">Deuda que se paga con el acuerdo (€)<small>Normalmente lo que debe. Puede cambiarlo si han acordado otra cantidad.</small>' +
      '<input type="number" id="ac-total" inputmode="decimal" min="0.01" step="0.01" required value="' + (cent(total) / 100) + '"></label>' +
      '<label class="f">¿Cuánto pagará al mes en total? (€)<small>' + (vive(c, h.ym + 1) || vive(c, h.ym)
        ? 'Incluida la renta. Lo que pase de la renta va a la deuda.' : esc(c.tenant.split(' ')[0]) + ' ya no vive aquí: todo lo que pague va a la deuda.') + '</small>' +
      '<input type="number" id="ac-mensual" inputmode="decimal" min="0.01" step="0.01" required></label>' +
      '<label class="f">¿Desde qué mes?<select id="ac-inicio"><option value="' + h.ym + '">' + mes(h.ym, true) + ' (este mes)</option>' +
      '<option value="' + (h.ym + 1) + '">' + mes(h.ym + 1, true) + ' (el que viene)</option></select></label>' +
      '<p class="msg" id="ac-prev">Escriba cuánto pagará al mes y aquí verá cuánto va a la deuda y cuándo termina.</p>' +
      '<label class="f">Notas (si quiere)<textarea id="ac-nota" maxlength="300" placeholder="Por ejemplo: lo hablamos por teléfono el día 20"></textarea></label>' +
      '<button class="btn primary" type="submit">Guardar el acuerdo</button></form>';
  }
  /* Vista previa del acuerdo mientras se escribe. */
  function previa() {
    var el = document.getElementById('ac-prev'); if (!el || !S.screen) return;
    var c = contrato(prop(S.screen.id), S.screen.cid), start = Number(document.getElementById('ac-inicio').value);
    var total = cent(Number(document.getElementById('ac-total').value)), mensual = cent(Number(document.getElementById('ac-mensual').value));
    var renta = cent(rentaEn(c, start)), extra = mensual - renta;
    if (!total || !mensual) { el.textContent = 'Escriba cuánto pagará al mes y aquí verá cuánto va a la deuda y cuándo termina.'; return; }
    if (extra <= 0) { el.textContent = 'Tiene que ser más que la renta (' + eur(renta / 100) + ') para que la deuda vaya bajando.'; return; }
    var n = Math.ceil(total / extra), ultima = total - (n - 1) * extra;
    el.innerHTML = 'Cada mes: ' + (renta ? eur(renta / 100) + ' de renta + ' : '') + '<b>' + eur(extra / 100) + ' para la deuda</b>.<br>' +
      'Terminará de pagarla en <b>' + mes(start + n - 1) + '</b> (' + nMeses(n) + ')' + (ultima !== extra ? '; la última cuota será de ' + eur(ultima / 100) : '') + '.';
  }
  function textoAcuerdo(a) {
    var e = estAc(a), renta = rentaEn(a.c, a.startYm);
    return 'Hola ' + a.c.tenant.split(' ')[0] + ', como hemos acordado, la deuda de ' + eur(a.total) + ' de ' + a.p.address + ' se pagará con ' + eur(a.extra) + ' al mes' +
      (renta ? ' además de la renta (' + eur(renta + a.extra) + ' en total cada mes)' : '') + ', desde ' + mes(a.startYm) + ' hasta ' + mes(e.endYm) + '.' +
      (e.paid ? ' Lleva pagados ' + eur(e.paid) + ' y quedan ' + eur(e.left) + '.' : '') + ' Gracias.';
  }
  function vAcuerdo(sc) {
    var a = S.ags[sc.aid];
    if (!a) return vPagos();
    var e = estAc(a), renta = rentaEn(a.c, a.startYm), edit = can('pagos'), tel = telLimpio(a.c.phone);
    var meses = a.p.months.filter(function (mo) { return mo.agreementId === a.id; });
    var facts = S.data.utilities.filter(function (u) { return u.agreementId === a.id; });
    var h = '<button class="back" data-act="volver">‹ Volver</button><header class="stack"><h1>Acuerdo de pago</h1>' +
      '<p class="muted">' + esc(a.c.tenant) + ' · ' + esc(nom(a.p)) + '</p></header>' +
      '<section class="status-card ' + e.k + '"><span class="dot">' + ICON[e.k === 'warn' ? 'warn' : e.k] + '</span><div><p class="lbl">' + esc(e.label) + '</p>' +
      '<p>Pagado ' + eur(e.paid) + ' de ' + eur(a.total) + '</p></div></section>' +
      '<div class="bar"><span style="width:' + Math.round(e.paid / a.total * 100) + '%"></span></div>';
    if (edit && !e.done) {
      h += '<form id="form-abono" class="card stack"><h2>Anotar un pago del acuerdo</h2>' +
        '<label class="f">Cantidad (€)<small>Solo la parte de la deuda. La renta del mes se anota aparte, en Pagos.</small>' +
        '<input type="number" id="ab-importe" inputmode="decimal" min="0.01" step="0.01" required value="' + (cent(e.thisMonth || Math.min(a.extra, e.left)) / 100) + '"></label>' +
        '<label class="f">Fecha<input type="date" id="ab-fecha" required value="' + S.data.today + '"></label>' +
        '<button class="btn good" type="submit">' + ICON.ok + ' Ha pagado</button></form>';
    }
    h += '<section class="card"><h2>Condiciones</h2>' +
      '<div class="kv"><span>Deuda del acuerdo</span><b class="r">' + eur(a.total) + '</b></div>' +
      '<div class="kv"><span>Cuota para la deuda</span><b class="r">' + eur(a.extra) + ' al mes</b></div>' +
      (renta ? '<div class="kv"><span>Paga al mes en total</span><b class="r">' + eur(renta + a.extra) + '</b></div>' : '') +
      '<div class="kv"><span>Desde</span><b class="r">' + mes(a.startYm, true) + '</b></div>' +
      '<div class="kv"><span>Hasta</span><b class="r">' + mes(e.endYm, true) + ' (' + nMeses(e.cuotas) + ')</b></div>' +
      '<div class="kv"><span>Queda por pagar</span><b class="r">' + eur(e.left) + '</b></div>' +
      (a.note ? '<p class="msg">' + esc(a.note) + '</p>' : '') + '</section>' +
      '<section class="card"><h2>Pagos del acuerdo</h2>' + (a.payments.length ? a.payments.slice().reverse().map(function (x) {
        return '<div class="kv"><span><b>' + eur(x.amount) + '</b><br><span class="muted">' + fecha(x.paidOn) + '</span></span>' +
          (edit ? '<button class="btn mini plain" data-act="quitar-abono" data-aid="' + a.id + '" data-pid="' + x.id + '">Quitar</button>' : '') + '</div>';
      }).join('') : '<p class="muted">Todavía no ha pagado ninguna cuota.</p>') + '</section>' +
      '<section class="card"><h2>Qué deuda incluye</h2>' +
      meses.map(function (mo) { return '<div class="kv"><span>Alquiler de ' + mes(mo.ym) + '</span><b class="r">' + eur(mo.rent) + '</b></div>'; }).join('') +
      facts.map(function (u) { return '<div class="kv"><span>Factura de ' + esc(tipo(u).toLowerCase()) + ' del ' + fechaC(u.billDate) + '</span><b class="r">' + eur(u.amount) + '</b></div>'; }).join('') +
      '</section>';
    if (!e.done) {
      h += '<a class="btn" target="_blank" rel="noopener" href="https://wa.me/' + tel + '?text=' + encodeURIComponent(textoAcuerdo(a)) + '">Enviar el acuerdo por WhatsApp</a>';
    }
    if (edit && !e.done) {
      h += a.brokenAt ? '<button class="btn" data-act="acuerdo-activo" data-aid="' + a.id + '">Volver a darlo por bueno</button>'
        : '<button class="btn plain" data-act="acuerdo-roto" data-aid="' + a.id + '">Marcar como no cumplido</button>';
    }
    if (edit && !a.payments.length) {
      h += S.confirm === 'a' + a.id
        ? '<p class="err">¿Seguro? La deuda vuelve a aparecer suelta en Impagos.</p><div class="btn-row">' +
        '<button class="btn danger" data-act="anular-acuerdo-si" data-id="' + a.p.id + '" data-aid="' + a.id + '">Sí, anularlo</button><button class="btn plain" data-act="borrar-no">No</button></div>'
        : '<button class="btn plain" data-act="anular-acuerdo" data-aid="' + a.id + '">Anular el acuerdo (si se apuntó por error)</button>';
    }
    return h;
  }
  function vImporte(sc) {
    var p = prop(sc.id), ms = p.months.filter(function (mo) { return !mo.agreementId; }).slice(-12).reverse();
    return '<button class="back" data-act="volver">‹ Volver</button><header class="stack"><h1>Corregir el importe de un mes</h1>' +
      '<p class="muted">' + esc(nom(p)) + '</p></header>' +
      '<p class="msg">Cuando alguien entra o sale a mitad de mes, la app reparte la renta por días. Aquí puede poner otra cantidad si lo han acordado así.</p>' +
      '<form id="form-importe" class="stack-lg"><label class="f">¿Qué mes?<select id="imp-mes">' + ms.map(function (mo) {
        return '<option value="' + mo.c.id + ':' + mo.ym + '">' + mes(mo.ym, true) + ' · ' + esc(mo.c.tenant) + ' · ' + eur(mo.rent) + (mo.days ? ' (' + dias(mo.days) + ')' : '') + '</option>';
      }).join('') + '</select></label>' +
      '<label class="f">Importe nuevo (€)<small>Déjelo vacío para volver al importe que calcula la app.</small>' +
      '<input type="number" id="imp-importe" inputmode="decimal" min="0.01" step="0.01"></label>' +
      '<button class="btn primary" type="submit">Guardar</button></form>';
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
    var link = base() + '/app?invitacion=' + s.code;
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
      else if (s && s.name === 'nuevo-acuerdo') h = vNuevoAcuerdo(s);
      else if (s && s.name === 'acuerdo') h = vAcuerdo(s);
      else if (s && s.name === 'importe') h = vImporte(s);
      else if (s && s.name === 'invitar') h = vInvitar(s);
      else if (s && s.name === 'invitado') h = vInvitado(s);
      else h = { pagos: vPagos, impagos: vImpagos, facturas: vFacturas, pisos: vPisos, cuenta: vCuenta }[S.tab]();
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
    else if (act === 'nueva-factura') { S.doc = null; S.pages = []; go({ name: 'nueva-factura', id: id }); }
    else if (act === 'mail-auto') {
      if (S.busy) return;
      b.disabled = true; b.textContent = 'Enviando…';
      S.busy = true;
      api('POST', '/api/utilities/' + id + '/email', {})
        .then(function (r) { return load(false).then(function () { toast('Factura enviada por correo a ' + r.to + ', con el PDF adjunto.'); }); })
        .catch(function (e) { if (e.status === 401) return fail(e); return load(false).catch(function () { }).then(function () { toast(e.message); }); })
        .then(function () { S.busy = false; });
    }
    else if (act === 'fac-prop') { S.facProp = id; S.tab = 'facturas'; go(null); }
    else if (act === 'doc-quitar') { S.doc = null; pintarDoc(); }
    else if (act === 'pagina-quitar') { S.pages.splice(Number(b.getAttribute('data-i')), 1); pintarDoc(); }
    else if (act === 'nuevo-acuerdo') go({ name: 'nuevo-acuerdo', id: id, cid: cid });
    else if (act === 'acuerdo') go({ name: 'acuerdo', id: id, aid: Number(b.getAttribute('data-aid')) });
    else if (act === 'importe') go({ name: 'importe', id: id });
    else if (act === 'quitar-abono') {
      run(function () { return api('DELETE', '/api/agreements/' + b.getAttribute('data-aid') + '/payments/' + b.getAttribute('data-pid')); }, 'Pago quitado.');
    }
    else if (act === 'acuerdo-roto' || act === 'acuerdo-activo') {
      run(function () { return api('POST', '/api/agreements/' + b.getAttribute('data-aid') + '/broken', { broken: act === 'acuerdo-roto' }); },
        act === 'acuerdo-roto' ? 'Acuerdo marcado como no cumplido. La deuda que queda sigue en Impagos.' : 'Acuerdo activo otra vez.');
    }
    else if (act === 'anular-acuerdo') { S.confirm = 'a' + b.getAttribute('data-aid'); render(false); }
    else if (act === 'anular-acuerdo-si') {
      S.confirm = null;
      run(function () { return api('DELETE', '/api/agreements/' + b.getAttribute('data-aid')).then(function () { S.screen = { name: 'piso', id: id }; }); }, 'Acuerdo anulado.');
    }
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

  document.addEventListener('input', function (ev) { if (/^ac-/.test(ev.target.id)) previa(); });
  document.addEventListener('change', function (ev) {
    var t = ev.target;
    if (/^ac-/.test(t.id)) { previa(); return; }
    if (t.id === 'fac-filtro') { S.facProp = Number(t.value); render(false); return; }
    if ((t.id === 'fac-foto' || t.id === 'fac-archivo') && t.files && t.files.length) { añadirDoc([].slice.call(t.files)); t.value = ''; return; }
    if (t.id === 'fac-tipo') { document.getElementById('fac-otro-caja').hidden = t.value !== 'otro'; }
  });

  function aceptar(code) {
    return api('POST', '/api/invites/accept', { code: code }).then(function (r) { S.cartera = String(r.ownerId); S.tab = 'pagos'; S.screen = null; });
  }
  function pintarDoc() {
    var el = document.getElementById('doc-lista');
    if (el) el.innerHTML = vDoc();
    var foto = document.getElementById('fac-foto');
    if (foto) foto.parentNode.firstChild.textContent = S.pages.length ? 'Hacer foto de otra página' : 'Hacer una foto';
  }
  /* Reduce una foto a JPEG de 1600 px como mucho: se lee bien y ocupa poco. */
  function fotoJpeg(file) {
    return new Promise(function (ok, ko) {
      var url = URL.createObjectURL(file), img = new Image();
      img.onload = function () {
        var k = Math.min(1, 1600 / Math.max(img.width, img.height)), c = document.createElement('canvas');
        c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
        var g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url);
        ok({ url: c.toDataURL('image/jpeg', 0.8), w: c.width, h: c.height });
      };
      img.onerror = function () { URL.revokeObjectURL(url); ko(new Error('No se ha podido leer esa foto.')); };
      img.src = url;
    });
  }
  function añadirDoc(files) {
    var pdf = files.filter(function (f) { return f.type === 'application/pdf' || /\.pdf$/i.test(f.name); })[0];
    if (pdf) { S.doc = { file: pdf, name: pdf.name }; S.pages = []; pintarDoc(); return; }
    S.doc = null;
    Promise.all(files.map(fotoJpeg)).then(function (pgs) { S.pages = S.pages.concat(pgs); pintarDoc(); }).catch(function (e) { toast(e.message); });
  }
  function bytesDeB64(b64) { var bin = atob(b64), out = new Uint8Array(bin.length); for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i); return out; }
  function b64DeBytes(u8) { var s = ''; for (var i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); }
  /* Junta las fotos en un PDF (una página A4 por foto). Las fotos van tal cual, como JPEG dentro del PDF. */
  function pdfDeFotos(pages) {
    var parts = [], offs = [], len = 0, n = 2 + pages.length * 3;
    function put(x) { var b = typeof x === 'string' ? Uint8Array.from(x, function (ch) { return ch.charCodeAt(0); }) : x; parts.push(b); len += b.length; }
    function obj(i, body) { offs[i] = len; put(i + ' 0 obj\n'); body(); put('\nendobj\n'); }
    put('%PDF-1.4\n%\xe2\xe3\xcf\xd3\n');
    obj(1, function () { put('<< /Type /Catalog /Pages 2 0 R >>'); });
    obj(2, function () { put('<< /Type /Pages /Count ' + pages.length + ' /Kids [' + pages.map(function (_, i) { return (3 + i * 3) + ' 0 R'; }).join(' ') + '] >>'); });
    pages.forEach(function (pg, i) {
      var o = 3 + i * 3, jpg = bytesDeB64(pg.url.split(',')[1]), W = 595, H = 842, m = 20;
      var k = Math.min((W - 2 * m) / pg.w, (H - 2 * m) / pg.h), w = pg.w * k, h = pg.h * k;
      var cmd = 'q ' + w.toFixed(2) + ' 0 0 ' + h.toFixed(2) + ' ' + ((W - w) / 2).toFixed(2) + ' ' + ((H - h) / 2).toFixed(2) + ' cm /Im0 Do Q';
      obj(o, function () { put('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ' + W + ' ' + H + '] /Resources << /XObject << /Im0 ' + (o + 1) + ' 0 R >> >> /Contents ' + (o + 2) + ' 0 R >>'); });
      obj(o + 1, function () {
        put('<< /Type /XObject /Subtype /Image /Width ' + pg.w + ' /Height ' + pg.h + ' /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ' + jpg.length + ' >>\nstream\n');
        put(jpg); put('\nendstream');
      });
      obj(o + 2, function () { put('<< /Length ' + cmd.length + ' >>\nstream\n' + cmd + '\nendstream'); });
    });
    var xref = len;
    put('xref\n0 ' + (n + 1) + '\n0000000000 65535 f \n');
    for (var i = 1; i <= n; i++) put(String(offs[i]).padStart(10, '0') + ' 00000 n \n');
    put('trailer\n<< /Size ' + (n + 1) + ' /Root 1 0 R >>\nstartxref\n' + xref + '\n%%EOF\n');
    var out = new Uint8Array(len), at = 0;
    parts.forEach(function (b) { out.set(b, at); at += b.length; });
    return out;
  }
  /* El documento de la factura en base64: el PDF elegido o las fotos convertidas en PDF. */
  function docFactura() {
    if (S.pages.length) {
      var pdf = pdfDeFotos(S.pages);
      if (pdf.length > 5 * 1024 * 1024) return Promise.reject(new Error('Las fotos ocupan demasiado (máximo 5 MB). Quite alguna página.'));
      return Promise.resolve(b64DeBytes(pdf));
    }
    return leerPdf(S.doc && S.doc.file);
  }
  function leerPdf(file) {
    return new Promise(function (ok, ko) {
      if (!file) return ko(new Error('Haga una foto a la factura o elija el PDF.'));
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
      return { tenant: v('con-inq'), phone: v('con-tel'), email: v('con-mail'), rent: v('con-renta'), startDate: v('con-inicio'), endDate: v('con-fin'), ipcPct: v('con-ipc'), ipcDate: v('con-ipc-fecha') };
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
      body.alias = v('piso-alias'); body.address = v('piso-dir'); body.dueDay = v('piso-dia'); body.utilities = document.getElementById('piso-sum') ? document.getElementById('piso-sum').checked : !!(id && prop(id).utilities);
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
      var porCorreo = document.getElementById('fac-mail') && document.getElementById('fac-mail').checked, aviso = null;
      run(function () {
        return docFactura().then(function (b64) { fb.pdf = b64; return api('POST', '/api/utilities', fb); })
          .then(function (r) {
            if (!porCorreo) return r;
            /* Se envía después de guardar: si el correo falla, la factura queda guardada igualmente. */
            return api('POST', '/api/utilities/' + r.id + '/email', {}).then(function (m) { aviso = 'Factura guardada y enviada por correo a ' + m.to + '.'; return r; },
              function (e) { aviso = 'Factura guardada, pero el correo no se ha enviado: ' + e.message; return r; });
          })
          .then(function (r) { S.doc = null; S.pages = []; S.tab = lv('suministros') >= 1 ? 'facturas' : S.tab; S.screen = { name: 'factura-ok', uid: r.id }; });
      }).then(function () { window.scrollTo(0, 0); if (aviso) toast(aviso); });
    } else if (f === 'form-acuerdo') {
      var sa = S.screen;
      run(function () {
        return api('POST', '/api/contracts/' + sa.cid + '/agreements', { total: v('ac-total'), monthly: v('ac-mensual'), startYm: Number(v('ac-inicio')), note: v('ac-nota') })
          .then(function (r) { S.screen = { name: 'acuerdo', id: sa.id, aid: r.id }; });
      }, 'Acuerdo guardado. Puede enviárselo por WhatsApp.').then(function () { window.scrollTo(0, 0); });
    } else if (f === 'form-abono') {
      var aid = S.screen.aid;
      run(function () { return api('POST', '/api/agreements/' + aid + '/payments', { amount: v('ab-importe'), date: v('ab-fecha') }); }, 'Pago anotado.');
    } else if (f === 'form-importe') {
      var sel = v('imp-mes').split(':'), si2 = S.screen;
      run(function () {
        return api('POST', '/api/contracts/' + sel[0] + '/amount', { ym: Number(sel[1]), amount: v('imp-importe') }).then(function () { S.screen = { name: 'piso', id: si2.id }; });
      }, 'Importe guardado.').then(function () { window.scrollTo(0, 0); });
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

/* KLYP Alquileres: panel de administración. */
(function () {
  'use strict';
  var D = null, toastT = null;
  var $ = function (id) { return document.getElementById(id); };
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function fecha(iso) { if (!iso) return 'Nunca'; var a = iso.split('-'); return a[2] + '/' + a[1] + '/' + a[0]; }
  function api(method, url, body) {
    return fetch(url, { method: method, credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined })
      .then(function (r) {
        return r.json().catch(function () { return {}; }).then(function (j) {
          if (!r.ok) { var e = new Error(j.error || 'No se ha podido completar.'); e.status = r.status; throw e; }
          return j;
        });
      });
  }
  function toast(t) {
    clearTimeout(toastT); $('toast').textContent = t; $('toast').hidden = false;
    toastT = setTimeout(function () { $('toast').hidden = true; }, 4000);
  }
  function plan(id) { return D.plans.filter(function (p) { return p.id === id; })[0]; }
  var MODS = [['pagos', 'Pagos'], ['inmuebles', 'Inmuebles']], VER = null;
  function limite(u) { return u.maxProps != null ? u.maxProps : plan(u.planId).maxProperties; }
  function tope(n) { return n == null ? 'sin límite' : n; }

  function render() {
    var q = $('buscar').value.trim().toLowerCase();
    var us = D.users.filter(function (u) { return !q || u.name.toLowerCase().indexOf(q) >= 0 || u.phone.indexOf(q) >= 0 || (u.email || '').indexOf(q) >= 0; });
    $('stats').innerHTML = '<div class="card"><p class="muted">Usuarios</p><p class="price">' + D.users.length + '</p></div>' +
      D.plans.map(function (p) {
        return '<div class="card"><p class="muted">Plan ' + esc(p.name) + '</p><p class="price">' +
          D.users.filter(function (u) { return u.planId === p.id; }).length + '</p></div>';
      }).join('') +
      '<div class="card"><p class="muted">Inmuebles</p><p class="price">' + D.users.reduce(function (a, u) { return a + u.properties; }, 0) + '</p></div>';
    $('usuarios').innerHTML = us.length ? us.map(function (u) {
      var p = plan(u.planId);
      return '<tr><td><b>' + esc(u.name) + '</b>' + (u.isAdmin ? ' <span class="pill ok">Admin</span>' : '') + '</td>' +
        '<td class="num">' + (u.phone.indexOf('@') < 0 ? esc(u.phone) : '—') + '</td><td>' + esc(u.email || '—') +
        (u.activated ? '' : '<br><span class="pill warn">' + (u.mustSetPin ? 'Sin contraseña todavía' : 'Sin activar') + '</span>' +
          (u.mustSetPin ? '' : ' <button class="btn plain" data-activar="' + u.id + '">Activar</button>') +
          (u.email ? ' <button class="btn plain" data-reenviar="' + u.id + '">Reenviar correo</button>' : '')) + '</td><td class="num">' + fecha(u.createdAt) + '</td><td class="num">' + fecha(u.lastSeen) + '</td>' +
        '<td class="num">' + u.properties + ' / ' + tope(limite(u)) + (u.maxProps != null ? ' <span class="pill warn">propio</span>' : '') +
        ' <button class="btn plain" data-ver="' + u.id + '">Ver</button></td><td class="num">' + u.helpers + ' / ' + tope(p.maxHelpers) + '</td>' +
        '<td><select data-plan-user="' + u.id + '" aria-label="Plan de ' + esc(u.name) + '">' + D.plans.map(function (x) {
          return '<option value="' + x.id + '"' + (x.id === u.planId ? ' selected' : '') + '>' + esc(x.name) + '</option>';
        }).join('') + '</select></td>' +
        '<td>' + (u.disabled.indexOf('suministros') < 0
          ? '<span class="pill ok">Activadas</span> <button class="btn plain" data-sum="' + u.id + '" data-v="0">Desactivar</button>'
          : '<span class="pill bad">Desactivadas</span> <button class="btn" data-sum="' + u.id + '" data-v="1">Activar</button>') + '</td>' +
        '<td>' + MODS.map(function (m) {
          return '<label class="mod"><input type="checkbox" data-mod-user="' + u.id + '" value="' + m[0] + '"' + (u.disabled.indexOf(m[0]) < 0 ? ' checked' : '') + '>' + m[1] + '</label>';
        }).join('') + '</td>' +
        '<td>' + (u.blocked ? '<span class="pill bad">Desactivado</span> <button class="btn" data-bloquear="' + u.id + '" data-v="0">Activar</button>'
          : '<span class="pill ok">Activo</span> <button class="btn plain" data-bloquear="' + u.id + '" data-v="1">Desactivar</button>') + '</td>' +
        '<td><button class="btn" data-reset="' + u.id + '">Código de recuperación</button></td></tr>';
    }).join('') : '<tr><td colspan="12" class="muted">' + (D.users.length ? 'Ningún usuario coincide con la búsqueda.' : 'Todavía no se ha dado de alta nadie.') + '</td></tr>';
    $('planes').innerHTML = D.plans.map(function (p) {
      return '<tr><td><input type="text" id="pl-nombre-' + p.id + '" value="' + esc(p.name) + '" maxlength="30" aria-label="Nombre del plan"></td>' +
        '<td><input type="text" id="pl-precio-' + p.id + '" value="' + esc(p.price) + '" maxlength="30" aria-label="Precio"></td>' +
        '<td><input type="number" id="pl-inm-' + p.id + '" value="' + (p.maxProperties == null ? '' : p.maxProperties) + '" min="0" placeholder="Sin límite" aria-label="Máximo de inmuebles"></td>' +
        '<td><input type="number" id="pl-ayu-' + p.id + '" value="' + (p.maxHelpers == null ? '' : p.maxHelpers) + '" min="0" placeholder="Sin límite" aria-label="Máximo de ayudantes"></td>' +
        '<td><button class="btn primary" data-guardar-plan="' + p.id + '">Guardar</button></td></tr>';
    }).join('');
  }

  var SMTP = ['host', 'port', 'security', 'user', 'from_addr', 'from_name', 'reply_to'];
  function renderSmtp(c) {
    SMTP.forEach(function (k) { $('smtp-' + k).value = c[k] || (k === 'security' ? 'starttls' : ''); });
    $('smtp-password').value = '';
    $('smtp-pass-ayuda').textContent = c.hasPassword ? 'Hay una guardada. Déjela vacía para no cambiarla.' : '';
    $('smtp-estado').innerHTML = c.ready ? '<span class="pill ok">Configurado: se envían los correos de activación y las facturas</span>'
      : '<span class="pill bad">Sin configurar: nadie puede crear una cuenta nueva hasta que lo configure</span>';
    $('aviso-smtp').hidden = c.ready;
  }
  function usuario(id) { return D.users.filter(function (x) { return x.id === Number(id); })[0]; }
  /* Inmuebles de un usuario y su límite propio. */
  function detalle() {
    var u = usuario(VER); if (!u) return;
    var p = plan(u.planId), box = $('detalle');
    box.hidden = false; box.innerHTML = '<p class="muted">Cargando…</p>';
    api('GET', '/api/admin/users/' + u.id + '/properties').then(function (r) {
      box.innerHTML = '<div class="topbar"><h3>Inmuebles de ' + esc(u.name) + ' (' + r.properties.length + ')</h3><button class="btn mini plain" id="detalle-cerrar">Cerrar</button></div>' +
        (r.properties.length ? '<div class="tablewrap"><table><thead><tr><th>Nombre</th><th>Dirección</th><th>Inquilino ahora</th><th>Facturas</th><th>Alta</th></tr></thead><tbody>' +
          r.properties.map(function (x) {
            return '<tr><td><b>' + esc(x.alias || '—') + '</b></td><td>' + esc(x.address) + '</td><td>' + esc(x.tenant || 'Sin inquilino') + '</td>' +
              '<td>' + (x.utilities ? 'Sí · ' + x.bills + (x.bills === 1 ? ' factura' : ' facturas') : 'No') + '</td><td class="num">' + fecha(x.createdAt) + '</td></tr>';
          }).join('') + '</tbody></table></div>' : '<p class="muted">Todavía no ha dado de alta ningún inmueble.</p>') +
        '<label class="f" style="max-width:420px">Límite de inmuebles para este usuario<small>Déjelo vacío para usar el de su plan ' + esc(p.name) + ' (' + tope(p.maxProperties) + '). ' +
        'Si pone un número, vale solo para este usuario, cambie o no de plan.</small>' +
        '<input type="number" id="detalle-limite" min="0" placeholder="El del plan (' + tope(p.maxProperties) + ')" value="' + (u.maxProps == null ? '' : u.maxProps) + '"></label>' +
        '<button class="btn primary" style="max-width:420px" data-limite="' + u.id + '">Guardar límite</button>' +
        '<div class="card stack peligro"><h3>Borrar datos de este usuario</h3>' +
        (u.countFrom ? '<p>Ahora cuenta desde el <b>' + fecha(u.countFrom) + '</b>: los meses anteriores no aparecen.</p>' : '') +
        '<label class="f" style="max-width:520px">¿Qué quiere borrar?<small>«Empezar de cero» borra cobros, acuerdos y facturas.</small><select id="wipe-mode">' +
        '<option value="datos">Empezar de cero (se conservan inmuebles e inquilinos)</option>' +
        '<option value="todo">Borrar todo (también inmuebles e inquilinos)</option></select></label>' +
        '<label class="f" style="max-width:300px">Contar desde<small>Los meses anteriores a esta fecha no aparecerán ni contarán como deuda. Vacío: sin límite.</small>' +
        '<input type="date" id="wipe-desde" value="' + (new Date().getFullYear() + 1) + '-01-01"></label>' +
        '<label class="f" style="max-width:420px">Para confirmar, escriba <b>' + esc((u.email || u.phone).toLowerCase()) + '</b><input type="text" id="wipe-confirm" autocomplete="off" autocapitalize="none"></label>' +
        '<p class="err">No se puede deshacer. Antes, haga una copia de seguridad del volumen /data.</p>' +
        '<button class="btn danger" style="max-width:420px" data-wipe="' + u.id + '">Borrar</button></div>';
      box.scrollIntoView({ block: 'start', behavior: 'smooth' });
    }).catch(function (e) { box.innerHTML = '<p class="err">' + esc(e.message) + '</p>'; });
  }
  $('alta').addEventListener('submit', function (ev) {
    ev.preventDefault();
    api('POST', '/api/admin/users', { name: $('alta-nombre').value, email: $('alta-mail').value, planId: Number($('alta-plan').value) })
      .then(function (r) { ev.target.reset(); toast('Alta hecha. Correo enviado a ' + r.email + '.'); return load(); })
      .catch(function (e) { toast(e.message); });
  });
  function load() {
    return Promise.all([api('GET', '/api/admin/overview'), api('GET', '/api/admin/smtp')]).then(function (r) {
      D = r[0]; $('panel').hidden = false; render(); renderSmtp(r[1]);
      var sel = $('alta-plan'), prev = sel.value;
      sel.innerHTML = D.plans.map(function (p) { return '<option value="' + p.id + '">' + esc(p.name) + '</option>'; }).join('');
      if (prev) sel.value = prev;
    });
  }
  $('smtp').addEventListener('submit', function (ev) {
    ev.preventDefault();
    var body = { password: $('smtp-password').value };
    SMTP.forEach(function (k) { body[k] = $('smtp-' + k).value; });
    api('PUT', '/api/admin/smtp', body).then(function () { return api('GET', '/api/admin/smtp'); })
      .then(function (c) { renderSmtp(c); toast('Datos del correo guardados. Envíe una prueba para comprobarlos.'); })
      .catch(function (e) { toast(e.message); });
  });
  $('smtp-test').addEventListener('submit', function (ev) {
    ev.preventDefault();
    var b = ev.target.querySelector('button'); b.disabled = true; b.textContent = 'Enviando…';
    api('POST', '/api/admin/smtp/test', { to: $('smtp-to').value })
      .then(function () { toast('Correo de prueba enviado. Mire la bandeja de entrada (y la de correo no deseado).'); })
      .catch(function (e) { toast(e.message); })
      .then(function () { b.disabled = false; b.textContent = 'Enviar prueba'; });
  });
  function change(promise, msg) {
    promise.then(load).then(function () { toast(msg); }).catch(function (e) { toast(e.message); load().catch(function () { }); });
  }

  $('buscar').addEventListener('input', function () { if (D) render(); });
  document.addEventListener('change', function (ev) {
    var id = ev.target.getAttribute('data-plan-user');
    if (id) change(api('PUT', '/api/admin/users/' + id, { planId: Number(ev.target.value) }), 'Plan cambiado.');
    var mu = ev.target.getAttribute('data-mod-user');
    if (mu) {
      var off = [].filter.call(document.querySelectorAll('[data-mod-user="' + mu + '"]'), function (c) { return !c.checked; }).map(function (c) { return c.value; });
      if (usuario(mu).disabled.indexOf('suministros') >= 0) off.push('suministros');
      change(api('PUT', '/api/admin/users/' + mu, { disabled: off }), 'Apartados guardados.');
    }
  });
  document.addEventListener('click', function (ev) {
    var b = ev.target.closest('button'); if (!b) return;
    var u = b.getAttribute('data-bloquear'), p = b.getAttribute('data-guardar-plan'), rs = b.getAttribute('data-reset');
    var su = b.getAttribute('data-sum'), ver = b.getAttribute('data-ver'), lim = b.getAttribute('data-limite');
    var act = b.getAttribute('data-activar'), ree = b.getAttribute('data-reenviar');
    if (act) change(api('PUT', '/api/admin/users/' + act, { activate: true }), 'Cuenta activada. Ya puede entrar.');
    if (ree) change(api('POST', '/api/admin/users/' + ree + '/activation', {}).then(function (r) { return r; }), 'Correo de activación enviado.');
    if (su) {
      var off = usuario(su).disabled.filter(function (x) { return x !== 'suministros'; });
      if (b.getAttribute('data-v') === '0') off.push('suministros');
      change(api('PUT', '/api/admin/users/' + su, { disabled: off }), b.getAttribute('data-v') === '0' ? 'Facturas de suministros desactivadas para este usuario.' : 'Facturas de suministros activadas.');
    }
    if (ver) { VER = Number(ver); detalle(); }
    if (b.id === 'detalle-cerrar') { VER = null; $('detalle').hidden = true; }
    var wp = b.getAttribute('data-wipe');
    if (wp) {
      b.disabled = true;
      api('POST', '/api/admin/users/' + wp + '/wipe', { mode: $('wipe-mode').value, countFrom: $('wipe-desde').value, confirm: $('wipe-confirm').value })
        .then(function (r) { toast(r.properties ? 'Datos borrados. Se conservan ' + r.properties + ' inmuebles y sus inquilinos.' : 'Datos borrados.'); return load(); })
        .then(function () { detalle(); }).catch(function (e) { toast(e.message); b.disabled = false; });
    }
    if (lim) change(api('PUT', '/api/admin/users/' + lim, { maxProps: $('detalle-limite').value }).then(function (r) { setTimeout(detalle, 300); return r; }), 'Límite guardado.');
    if (rs) api('POST', '/api/admin/users/' + rs + '/reset', {}).then(function (r) {
      $('reset-nombre').textContent = r.name; $('reset-codigo').textContent = r.code; $('reset-box').hidden = false;
      $('reset-box').scrollIntoView({ block: 'center' });
    }).catch(function (e) { toast(e.message); });
    if (u) change(api('PUT', '/api/admin/users/' + u, { blocked: b.getAttribute('data-v') === '1' }), b.getAttribute('data-v') === '1' ? 'Cuenta desactivada.' : 'Cuenta activada.');
    if (p) change(api('PUT', '/api/admin/plans/' + p, {
      name: $('pl-nombre-' + p).value, price: $('pl-precio-' + p).value, maxProperties: $('pl-inm-' + p).value, maxHelpers: $('pl-ayu-' + p).value
    }), 'Plan guardado.');
  });

  function start() {
    return load().then(function () { $('aviso').hidden = true; $('entrar').hidden = true; }).catch(function (e) {
      $('entrar').hidden = e.status !== 401;
      $('aviso').hidden = e.status === 401;
      $('aviso').textContent = e.message;
    });
  }
  $('entrar').addEventListener('submit', function (ev) {
    ev.preventDefault();
    api('POST', '/api/login', { phone: $('adm-id').value, pin: $('adm-pin').value }).then(start)
      .catch(function (e) { $('aviso').hidden = false; $('aviso').textContent = e.message; });
  });
  start();
})();

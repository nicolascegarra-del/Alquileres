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
  var MODS = [['pagos', 'Pagos'], ['suministros', 'Facturas'], ['averias', 'Averías'], ['inmuebles', 'Inmuebles']];
  function tope(n) { return n == null ? 'sin límite' : n; }

  function render() {
    var q = $('buscar').value.trim().toLowerCase();
    var us = D.users.filter(function (u) { return !q || u.name.toLowerCase().indexOf(q) >= 0 || u.phone.indexOf(q) >= 0; });
    $('stats').innerHTML = '<div class="card"><p class="muted">Usuarios</p><p class="price">' + D.users.length + '</p></div>' +
      D.plans.map(function (p) {
        return '<div class="card"><p class="muted">Plan ' + esc(p.name) + '</p><p class="price">' +
          D.users.filter(function (u) { return u.planId === p.id; }).length + '</p></div>';
      }).join('') +
      '<div class="card"><p class="muted">Inmuebles</p><p class="price">' + D.users.reduce(function (a, u) { return a + u.properties; }, 0) + '</p></div>';
    $('usuarios').innerHTML = us.length ? us.map(function (u) {
      var p = plan(u.planId);
      return '<tr><td><b>' + esc(u.name) + '</b>' + (u.isAdmin ? ' <span class="pill ok">Admin</span>' : '') + '</td>' +
        '<td class="num">' + esc(u.phone) + '</td><td class="num">' + fecha(u.createdAt) + '</td><td class="num">' + fecha(u.lastSeen) + '</td>' +
        '<td class="num">' + u.properties + ' / ' + tope(p.maxProperties) + '</td><td class="num">' + u.helpers + ' / ' + tope(p.maxHelpers) + '</td>' +
        '<td><select data-plan-user="' + u.id + '" aria-label="Plan de ' + esc(u.name) + '">' + D.plans.map(function (x) {
          return '<option value="' + x.id + '"' + (x.id === u.planId ? ' selected' : '') + '>' + esc(x.name) + '</option>';
        }).join('') + '</select></td>' +
        '<td>' + MODS.map(function (m) {
          return '<label class="mod"><input type="checkbox" data-mod-user="' + u.id + '" value="' + m[0] + '"' + (u.disabled.indexOf(m[0]) < 0 ? ' checked' : '') + '>' + m[1] + '</label>';
        }).join('') + '</td>' +
        '<td>' + (u.blocked ? '<span class="pill bad">Desactivado</span> <button class="btn" data-bloquear="' + u.id + '" data-v="0">Activar</button>'
          : '<span class="pill ok">Activo</span> <button class="btn plain" data-bloquear="' + u.id + '" data-v="1">Desactivar</button>') + '</td>' +
        '<td><button class="btn" data-reset="' + u.id + '">Código de recuperación</button></td></tr>';
    }).join('') : '<tr><td colspan="10" class="muted">' + (D.users.length ? 'Ningún usuario coincide con la búsqueda.' : 'Todavía no se ha dado de alta nadie.') + '</td></tr>';
    $('planes').innerHTML = D.plans.map(function (p) {
      return '<tr><td><input type="text" id="pl-nombre-' + p.id + '" value="' + esc(p.name) + '" maxlength="30" aria-label="Nombre del plan"></td>' +
        '<td><input type="text" id="pl-precio-' + p.id + '" value="' + esc(p.price) + '" maxlength="30" aria-label="Precio"></td>' +
        '<td><input type="number" id="pl-inm-' + p.id + '" value="' + (p.maxProperties == null ? '' : p.maxProperties) + '" min="0" placeholder="Sin límite" aria-label="Máximo de inmuebles"></td>' +
        '<td><input type="number" id="pl-ayu-' + p.id + '" value="' + (p.maxHelpers == null ? '' : p.maxHelpers) + '" min="0" placeholder="Sin límite" aria-label="Máximo de ayudantes"></td>' +
        '<td><button class="btn primary" data-guardar-plan="' + p.id + '">Guardar</button></td></tr>';
    }).join('');
  }

  function load() {
    return api('GET', '/api/admin/overview').then(function (d) { D = d; $('panel').hidden = false; render(); });
  }
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
      change(api('PUT', '/api/admin/users/' + mu, { disabled: off }), 'Apartados guardados.');
    }
  });
  document.addEventListener('click', function (ev) {
    var b = ev.target.closest('button'); if (!b) return;
    var u = b.getAttribute('data-bloquear'), p = b.getAttribute('data-guardar-plan'), rs = b.getAttribute('data-reset');
    if (rs) api('POST', '/api/admin/users/' + rs + '/reset', {}).then(function (r) {
      $('reset-nombre').textContent = r.name; $('reset-codigo').textContent = r.code; $('reset-box').hidden = false;
      $('reset-box').scrollIntoView({ block: 'center' });
    }).catch(function (e) { toast(e.message); });
    if (u) change(api('PUT', '/api/admin/users/' + u, { blocked: b.getAttribute('data-v') === '1' }), b.getAttribute('data-v') === '1' ? 'Cuenta desactivada.' : 'Cuenta activada.');
    if (p) change(api('PUT', '/api/admin/plans/' + p, {
      name: $('pl-nombre-' + p).value, price: $('pl-precio-' + p).value, maxProperties: $('pl-inm-' + p).value, maxHelpers: $('pl-ayu-' + p).value
    }), 'Plan guardado.');
  });

  load().catch(function (e) {
    $('aviso').hidden = false;
    $('aviso').textContent = e.status === 401 ? 'Entre primero en la app con su móvil y su clave.' : e.message;
  });
})();

/**
 * Lógica pura del panel (la usan el servidor, el navegador y las pruebas).
 *
 * Todo sale del historial de mensajes ("threads") de cada conversación de Help Scout:
 *  - Cliente esperando: el caso está Active o Pending y el último mensaje es del cliente.
 *  - Reloj de espera: desde el PRIMER mensaje del cliente que sigue sin contestar.
 * Las notas internas, las asignaciones y los cambios de estado no cuentan como respuesta.
 * Las cifras del día (respuestas, resueltos, tiempos...) NO se calculan aquí: vienen de los
 * reportes oficiales de Help Scout.
 */
(function (raiz, fabrica) {
  if (typeof module === 'object' && module.exports) module.exports = fabrica();
  else raiz.Logica = fabrica();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  var TIPOS_MENSAJE = ['message', 'chat', 'phone'];

  function hilosPublicados(conv) {
    return ((conv._embedded && conv._embedded.threads) || [])
      .filter(function (h) { return !h.state || h.state === 'published'; })
      .slice()
      .sort(function (a, b) { return (new Date(a.createdAt) - new Date(b.createdAt)) || (a.id - b.id); });
  }
  function idUsuario(p) { return p && Number(p.id) > 0 ? Number(p.id) : null; }
  function esDelCliente(h) { return h.type === 'customer' || (h.createdBy || {}).type === 'customer'; }
  function esRespuesta(h) { return !esDelCliente(h) && (h.createdBy || {}).type === 'user' && TIPOS_MENSAJE.indexOf(h.type) >= 0; }

  /**
   * Conversación de Help Scout (con _embedded.threads) → resumen compacto.
   * @param {Object} conv
   * @param {Date|string} desdeHoy  inicio del día local: los movimientos desde ahí van en `mv`
   * @return {{id, n, s, c, st, a, mb, w, mv}}
   *   w  = fecha ISO desde la que espera el cliente (null si nadie espera)
   *   mv = movimientos de hoy: [tipo, usuarioId, fechaIso]
   *        'C' mensaje del cliente · 'R' respuesta de un usuario · 'X' cierre · 'A' asignación (usuarioId = a quién)
   */
  function resumirConversacion(conv, desdeHoy) {
    var corte = new Date(desdeHoy).getTime();
    var publicada = !conv.state || conv.state === 'published';
    var abierta = publicada && (conv.status === 'active' || conv.status === 'pending');
    var cliente = conv.primaryCustomer || {};
    var nombre = [cliente.first, cliente.last].filter(Boolean).join(' ') || cliente.email || '';
    var mv = [];
    var desde = null, estado = null, asignado;

    hilosPublicados(conv).forEach(function (h) {
      var fecha = new Date(h.createdAt);
      var hoy = fecha.getTime() >= corte;
      var autor = h.createdBy || {};
      var previo = estado;
      if (h.status && h.status !== 'nochange') estado = h.status;

      if ('assignedTo' in h) {
        var nuevo = idUsuario(h.assignedTo);
        if (nuevo !== null && nuevo !== asignado && hoy) mv.push(['A', nuevo, fecha.toISOString()]); // cambió de manos
        asignado = nuevo;
      }
      if (esDelCliente(h)) {
        if (!desde) desde = fecha;
        if (hoy) mv.push(['C', 0, fecha.toISOString()]);
        return;
      }
      if (esRespuesta(h)) {
        desde = null; // le respondieron
        if (hoy) mv.push(['R', Number(autor.id), fecha.toISOString()]);
      }
      if (estado === 'closed' && previo !== 'closed') {
        desde = null; // se cerró el caso
        if (hoy && autor.type === 'user') mv.push(['X', Number(autor.id), fecha.toISOString()]);
      }
    });

    return {
      id: conv.id,
      n: conv.number,
      s: String(conv.subject || '(sin asunto)').slice(0, 140),
      c: String(nombre).slice(0, 60),
      st: publicada ? conv.status : 'deleted',
      a: idUsuario(conv.assignee),
      mb: conv.mailboxId || null,
      w: abierta && desde ? desde.toISOString() : null,
      mv: mv,
    };
  }

  /** ¿Hay que conservar esta conversación en el panel? */
  function esRelevante(c, equipo, mostrarSinAsignar) {
    var abierta = c.st === 'active' || c.st === 'pending';
    if (abierta && c.a && equipo[c.a]) return true;
    if (abierta && !c.a && mostrarSinAsignar) return true;
    return c.mv.some(function (m) { return m[0] !== 'C' && !!equipo[m[1]]; });
  }

  var URL_CASO = 'https://secure.helpscout.net/conversation/';

  /**
   * @param {Object[]} compactos
   * @param {{id: number, nombre: string}[]} agentes  (id null si no está vinculada en Help Scout)
   * @param {{buzones?: Object, mostrarSinAsignar?: boolean, maxFeed?: number}} op
   */
  function armarPanel(compactos, agentes, op) {
    op = op || {};
    var equipo = {};
    agentes.forEach(function (a) { if (a.id) equipo[a.id] = a; });
    var nombre = function (id) { return equipo[id] ? equipo[id].nombre : ''; };
    var ticket = function (c) {
      return {
        id: c.id, numero: c.n, asunto: c.s, cliente: c.c, estado: c.st, esperaDesde: c.w,
        agenteId: c.a && equipo[c.a] ? c.a : null, agente: nombre(c.a),
        buzon: (op.buzones && op.buzones[c.mb]) || '', url: URL_CASO + c.id + '/' + c.n,
      };
    };
    var porEspera = function (x, y) { return String(x.esperaDesde || '9').localeCompare(String(y.esperaDesde || '9')); };

    var abiertos = [], sinAsignar = [], feed = [], ultima = {}, respuestas = {};
    compactos.forEach(function (c) {
      var abierta = c.st === 'active' || c.st === 'pending';
      var delEquipo = !!(c.a && equipo[c.a]);
      if (abierta && delEquipo) abiertos.push(ticket(c));
      if (abierta && !c.a && op.mostrarSinAsignar !== false && c.w) sinAsignar.push(ticket(c));
      c.mv.forEach(function (m) {
        var tipo = m[0], quien = m[1], fecha = m[2];
        if (tipo === 'C') {
          if (delEquipo || !c.a) feed.push({ fecha: fecha, tipo: 'CLIENTE', agente: delEquipo ? nombre(c.a) : '', numero: c.n, asunto: c.s, url: URL_CASO + c.id + '/' + c.n });
          return;
        }
        if (!equipo[quien]) return;
        if (tipo === 'R') {
          respuestas[quien] = (respuestas[quien] || 0) + 1;
          if (!ultima[quien] || fecha > ultima[quien]) ultima[quien] = fecha;
        }
        feed.push({ fecha: fecha, tipo: { R: 'RESPUESTA', X: 'CERRADO', A: 'ASIGNADO' }[tipo], agente: nombre(quien), numero: c.n, asunto: c.s, url: URL_CASO + c.id + '/' + c.n });
      });
    });

    var filas = agentes.map(function (a) {
      var suyos = abiertos.filter(function (t) { return t.agenteId === a.id; });
      var esperando = suyos.filter(function (t) { return t.esperaDesde; }).sort(porEspera);
      return {
        id: a.id, nombre: a.nombre, vinculado: !!a.id,
        esperando: esperando,
        enSeguimiento: suyos.filter(function (t) { return !t.esperaDesde; }).sort(function (x, y) { return x.numero - y.numero; }),
        seguimiento: suyos.length - esperando.length,
        abiertos: suyos.length,
        activos: suyos.filter(function (t) { return t.estado === 'active'; }).length,
        pendientes: suyos.filter(function (t) { return t.estado === 'pending'; }).length,
        ultimaRespuesta: ultima[a.id] || null,
        respuestasVistas: respuestas[a.id] || 0, // conteo directo de hoy, solo para contrastar con el reporte
      };
    });
    var suma = function (k) { return filas.reduce(function (s, f) { return s + (k === 'esperando' ? f.esperando.length : f[k]); }, 0); };
    feed.sort(function (x, y) { return x.fecha < y.fecha ? 1 : x.fecha > y.fecha ? -1 : 0; });
    return {
      agentes: filas,
      sinAsignar: sinAsignar.sort(porEspera),
      equipo: { esperando: suma('esperando'), seguimiento: suma('seguimiento'), abiertos: suma('abiertos'), activos: suma('activos'), pendientes: suma('pendientes') },
      feed: feed.slice(0, op.maxFeed || 60),
      movimientos: feed.length,
    };
  }

  return { resumirConversacion: resumirConversacion, esRelevante: esRelevante, armarPanel: armarPanel };
});

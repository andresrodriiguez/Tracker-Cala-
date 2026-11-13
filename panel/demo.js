/* Datos de ejemplo: solo se usan al abrir panel/index.html suelto, fuera de Apps Script. */
(function () {
  'use strict';
  var nombres = ['Jaideth Andocilla', 'Maryelin Rios', 'Edna Escudero', 'Andrés Rodríguez'];
  var asuntos = ['Cobro duplicado en mi tarjeta', 'Solicitud de reembolso', 'No puedo iniciar sesión', 'Necesito la factura de mi compra', 'Cambio de fecha de mi entrada', 'El código QR no funciona', 'No me llegó el acceso', 'Transferir mi entrada'];
  var clientes = ['José Martínez', 'Ana Lucía Torres', 'Diego Herrera', 'Luis Ramírez', 'Carlos Pérez', 'Valentina Castro', 'Laura Gómez', 'Camila Ortiz'];
  var hace = function (min) { return new Date(Date.now() - min * 60000).toISOString(); };
  var inicioHoy = new Date(new Date().toISOString().slice(0, 10) + 'T00:00:00Z').toISOString();
  function c(n, ag, st, espera, mv) { return { id: 9000 + n, n: 4500 + n, s: asuntos[n % 8], c: clientes[n % 8], st: st, a: ag, mb: 7, w: espera == null ? null : hace(espera), mv: mv || [] }; }
  var abiertos = {
    1: [c(18, 1, 'active', 41, [['C', 0, hace(41)]]), c(12, 1, 'active', 12, [['C', 0, hace(12)]]), c(31, 1, 'pending', null, [['R', 1, hace(2)]]), c(33, 1, 'pending', null, [['R', 1, hace(25)]])],
    2: [c(1, 2, 'active', 96, [['C', 0, hace(96)]]), c(9, 2, 'pending', 67, [['C', 0, hace(67)]]), c(20, 2, 'active', 38, [['C', 0, hace(38)]]), c(35, 2, 'pending', null, [['R', 2, hace(34)]])],
    3: [c(32, 3, 'active', 18, [['C', 0, hace(18)]]), c(36, 3, 'pending', null, [['R', 3, hace(1)]]), c(37, 3, 'pending', null, [['A', 3, hace(50)], ['R', 3, hace(9)]]), c(38, 3, 'active', null, [['R', 3, hace(15)]])],
    4: [c(3, 4, 'active', 54, [['C', 0, hace(54)]]), c(24, 4, 'active', 27, [['C', 0, hace(27)]]), c(39, 4, 'pending', null, [['A', 4, hace(30)], ['R', 4, hace(13)]])],
  };
  var sinAsignar = [c(40, null, 'active', 7, [['C', 0, hace(7)]]), c(42, null, 'active', 1, [['C', 0, hace(1)]])];
  var cerrados = [c(17, 3, 'closed', null, [['R', 3, hace(8)], ['X', 3, hace(5)]])];
  function fila(i, dias) {
    var b = [[38, 27, 24, 17, 16, 744, 9100, 210, 92], [19, 13, 12, 8, 8, 2580, 21400, 340, 71], [44, 31, 28, 22, 21, 492, 6300, 180, 96], [27, 19, 17, 11, 12, 1320, 12800, 260, 85]][i];
    return { id: i + 1, nombre: nombres[i], totalDays: dias, totalConversations: b[1] * dias, conversationsCreated: 2 * dias, customersHelped: b[2] * dias, totalReplies: b[0] * dias, repliesPerDay: b[0],
      conversationsPerDay: b[1], resolved: b[3] * dias, resolvedOnFirstReply: Math.round(b[3] * dias * .55), percentResolvedOnFirstReply: 0.55, repliesToResolve: 1.8, closed: b[4] * dias,
      responseTime: b[5], resolutionTime: b[6], handleTime: b[7], happinessScore: b[8], busiestDay: 2 };
  }
  function parametros(ruta) { var q = {}; (ruta.split('?')[1] || '').split('&').forEach(function (p) { var kv = p.split('='); if (kv[0]) q[kv[0]] = decodeURIComponent(kv[1] || ''); }); return q; }

  window.DemoApi = function (ruta) {
    var q = parametros(ruta), base = ruta.split('?')[0], d;
    var dias = q.desde && q.hasta ? Math.round((Date.parse(q.hasta) - Date.parse(q.desde)) / 86400000) + 1 : 1;
    var ids = (q.agentes || '1,2,3,4').split(',').map(Number);
    var rango = { desde: q.desde, hasta: q.hasta, dias: dias, vista: 'day' };
    if (base === '/api/equipo') {
      d = { agentes: nombres.map(function (n, i) { return { id: i + 1, nombre: n }; }), sinVincular: [], buzones: { 7: 'Soporte' }, hoy: new Date().toISOString().slice(0, 10), inicioHoy: inicioHoy, enHorario: true,
        config: { tz: 'America/New_York', horario: { inicio: 9, fin: 17, dias: [1, 2, 3, 4, 5, 6] }, segundos: 5, segundosFueraDeHorario: 60, segundosReportes: 60, minutosRecarga: 5, metaRespuestaMin: 60, alertaSinResponderMin: [10, 30], horarioDeOficina: false, mostrarSinAsignar: true } };
    } else if (base === '/api/abiertos') {
      if (q.agente === 'sin') d = { compactos: sinAsignar, completo: true };
      else {
        var lista = abiertos[q.agente];
        var cuenta = function (st) { var n = lista.filter(function (x) { return x.st === st; }).length; return { helpScout: n, leidos: n }; };
        d = { agente: Number(q.agente), compactos: lista, totales: { active: cuenta('active'), pending: cuenta('pending') } };
      }
    } else if (base === '/api/cambios') {
      d = { compactos: q.pagina === '1' && q.desde === inicioHoy ? cerrados : [], siguiente: null, total: 0, cursor: new Date().toISOString() };
    } else if (base === '/api/reporte') {
      d = { disponible: true, rango: rango, filas: ids.map(function (id) { return fila(id - 1, dias); }) };
    } else if (base === '/api/reporte-dias') {
      d = { rango: rango, vista: 'day', filas: [] };
      ids.forEach(function (id) { for (var i = 0; i < dias; i++) { var f = new Date(Date.parse(q.desde) + i * 86400000).toISOString().slice(0, 10), b = fila(id - 1, 1); d.filas.push({ fecha: f, id: id, nombre: b.nombre, respuestas: b.totalReplies, resueltos: b.resolved, clientes: b.customersHelped }); } });
    } else {
      d = { rango: rango, agente: Number(q.agente), nombre: nombres[q.agente - 1], total: 3, siguiente: null, filas: [1, 2, 3].map(function (i) {
        return { id: 9000 + i, numero: 4500 + i, estado: 'closed', cliente: clientes[i], respuestas: i, primeraRespuesta: 600 * i, respuesta: 480 * i, resolucion: 7200 * i, gestion: 200, url: 'https://secure.helpscout.net/conversation/' + (9000 + i) + '/' + (4500 + i) };
      }) };
    }
    d.ok = true; d.ahora = new Date().toISOString();
    return new Promise(function (listo) { setTimeout(function () { listo(JSON.stringify(d)); }, 120); });
  };
})();

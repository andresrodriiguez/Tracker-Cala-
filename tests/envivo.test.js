// Pruebas del panel en vivo (EnVivo.gs) con Node: `npm test`
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const contexto = vm.createContext({});
['Config.gs', 'Util.gs', 'Eventos.gs', 'Metricas.gs', 'EnVivo.gs'].forEach(archivo => {
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'apps-script', archivo), 'utf8'), contexto, { filename: archivo });
});
const { resumirConversacion, fusionarCompacto, compactoRelevante, armarPanelEnVivo, clienteEsperando, inicioVentanaJornada } = contexto;
const json = v => JSON.parse(JSON.stringify(v)); // objetos del vm → objetos normales

const JAIDETH = { id: 1, nombre: 'Jaideth Andocilla' };
const EDNA = { id: 2, nombre: 'Edna Escudero' };
const equipo = { 1: JAIDETH, 2: EDNA };
const agentePorId = id => equipo[id] || null;
const dia = f => f.toISOString().slice(0, 10);
const o = {
  agentePorId, dia, hoy: '2026-11-12',
  minutos: (fin, inicio) => (fin - inicio) / 60000,
  ctxEventos: { agentePorId, dia, mailboxesEquipo: [], tagsReasignacion: [], transferenciaInternaEsReasignacion: true },
};
const opPanel = { agentes: [JAIDETH, EDNA, { nombre: 'Sin Cuenta', id: null }], mostrarSinAsignar: true };

let sig = 1;
const cliente = (fecha, extra) => Object.assign({ id: sig++, type: 'customer', status: 'active', createdAt: fecha, createdBy: { id: 777, type: 'customer' } }, extra);
const asignar = (fecha, a) => ({ id: sig++, type: 'lineitem', status: 'nochange', createdAt: fecha, createdBy: { id: a, type: 'user' }, assignedTo: { id: a } });
const responder = (fecha, a, estado) => ({ id: sig++, type: 'message', status: estado || 'active', createdAt: fecha, createdBy: { id: a, type: 'user' }, assignedTo: { id: a } });
const conv = (id, hilos, extra) => Object.assign({
  id, number: id, subject: 'Caso ' + id, status: 'active', mailboxId: 1, createdAt: hilos[0].createdAt,
  primaryCustomer: { first: 'Laura', last: 'Gómez' }, _embedded: { threads: hilos.slice().reverse() },
}, extra);

test('clienteEsperando usa latestReplyFrom y descarta cerrados', () => {
  assert.equal(clienteEsperando({ status: 'pending', customerWaitingSince: { latestReplyFrom: 'customer' } }), true);
  assert.equal(clienteEsperando({ status: 'active', customerWaitingSince: { latestReplyFrom: 'user' } }), false);
  assert.equal(clienteEsperando({ status: 'active' }), true);
  assert.equal(clienteEsperando({ status: 'closed', customerWaitingSince: { latestReplyFrom: 'customer' } }), false);
});

test('respuestas del día con su tiempo de respuesta, desde el primer mensaje del cliente sin responder', () => {
  const c = json(resumirConversacion(conv(10, [
    cliente('2026-11-11T14:00:00Z', { assignedTo: null }), // ayer: no cuenta
    asignar('2026-11-11T14:05:00Z', 1),
    responder('2026-11-11T14:30:00Z', 1, 'pending'),
    cliente('2026-11-12T13:00:00Z'),
    cliente('2026-11-12T13:10:00Z'), // el reloj sigue desde el primero
    responder('2026-11-12T13:40:00Z', 1),
    responder('2026-11-12T13:45:00Z', 1), // seguimiento sin mensaje del cliente: sin tiempo
  ], { assignee: { id: 1 }, customerWaitingSince: { time: '2026-11-12T13:00:00Z', latestReplyFrom: 'user' } }), o));
  assert.equal(c.a, 1);
  assert.equal(c.w, null); // la agente respondió de último
  assert.equal(c.cliente, undefined);
  assert.equal(c.c, 'Laura Gómez');
  assert.deepEqual(c.r, [[1, '2026-11-12T13:40:00.000Z', 40], [1, '2026-11-12T13:45:00.000Z', null]]);
  assert.deepEqual(c.cm, ['2026-11-12T13:00:00.000Z', '2026-11-12T13:10:00.000Z']);
  assert.deepEqual(c.ev.map(e => e[0]), ['NUEVA_CONSULTA']);
});

test('sin hilos conserva la actividad ya calculada', () => {
  const lleno = resumirConversacion(conv(11, [
    cliente('2026-11-12T13:00:00Z', { assignedTo: null }), asignar('2026-11-12T13:01:00Z', 2), responder('2026-11-12T13:20:00Z', 2, 'pending'),
  ], { assignee: { id: 2 } }), o);
  const liviano = resumirConversacion({ id: 11, number: 11, status: 'active', assignee: { id: 2 },
    customerWaitingSince: { time: '2026-11-12T14:00:00Z', latestReplyFrom: 'customer' } }, o);
  const f = json(fusionarCompacto(lleno, liviano));
  assert.equal(f.w, '2026-11-12T14:00:00Z');
  assert.equal(f.st, 'active');
  assert.equal(f.r.length, 1);
  assert.deepEqual(f.ev.map(e => e[0]).sort(), ['ASIGNADO', 'PRIMERA_RESPUESTA']);
});

test('compactoRelevante: abiertos del equipo, sin asignar activos y casos con actividad', () => {
  const del = id => !!equipo[id];
  const base = { st: 'active', a: 1, ev: [], r: [] };
  assert.equal(compactoRelevante(base, del, true), true);
  assert.equal(compactoRelevante(Object.assign({}, base, { a: 99 }), del, true), false);
  assert.equal(compactoRelevante(Object.assign({}, base, { a: null }), del, true), true);
  assert.equal(compactoRelevante(Object.assign({}, base, { a: null }), del, false), false);
  assert.equal(compactoRelevante(Object.assign({}, base, { st: 'closed' }), del, true), false);
  assert.equal(compactoRelevante(Object.assign({}, base, { st: 'closed', r: [[1, 'x', 3]] }), del, true), true);
});

test('armarPanelEnVivo: esperando por agente, sin asignar, totales y feed ordenado', () => {
  const compactos = [
    { id: 1, n: 101, s: 'A', c: 'X', st: 'active', a: 1, w: '2026-11-12T13:30:00Z', h: true, ev: [['ASIGNADO', 1, '2026-11-12T13:00:00Z', null]], r: [], cm: [] },
    { id: 2, n: 102, s: 'B', c: 'Y', st: 'pending', a: 1, w: '2026-11-12T13:10:00Z', h: false, ev: [], r: [], cm: [] },
    { id: 3, n: 103, s: 'C', c: 'Z', st: 'pending', a: 1, w: null, h: true, ev: [['PRIMERA_RESPUESTA', 1, '2026-11-12T13:20:00Z', 20]],
      r: [[1, '2026-11-12T13:20:00Z', 20], [1, '2026-11-12T14:00:00Z', 10]], cm: ['2026-11-12T13:50:00Z'] },
    { id: 4, n: 104, s: 'D', c: 'W', st: 'closed', a: 2, w: null, h: true, ev: [['CERRADO', 2, '2026-11-12T15:00:00Z', 50]], r: [[2, '2026-11-12T14:50:00Z', 30]], cm: [] },
    { id: 5, n: 105, s: 'E', c: 'V', st: 'active', a: null, w: '2026-11-12T15:30:00Z', h: false, ev: [], r: [], cm: [] },
    { id: 6, n: 106, s: 'F', c: 'U', st: 'active', a: 99, w: '2026-11-12T12:00:00Z', h: false, ev: [], r: [], cm: [] }, // otro depto
  ];
  const p = json(armarPanelEnVivo(compactos, opPanel));
  const [ja, ed, sin] = p.agentes;
  assert.deepEqual(ja.esperando.map(t => t.numero), [102, 101]); // el que más espera primero
  assert.equal(ja.seguimiento, 1);
  assert.equal(ja.hoy.respuestas, 2);
  assert.equal(ja.hoy.casosRespondidos, 1);
  assert.equal(ja.hoy.promedioRespuestaMin, 15);
  assert.equal(ja.hoy.promedioPrimeraMin, 20);
  assert.equal(ja.hoy.asignados, 1);
  assert.equal(ja.hoy.ultimaRespuesta, '2026-11-12T14:00:00Z');
  assert.equal(ed.hoy.cerrados, 1);
  assert.equal(ed.esperando.length, 0);
  assert.equal(sin.vinculado, false);
  assert.equal(sin.hoy, null);
  assert.deepEqual(p.sinAsignar.map(t => t.numero), [105]);
  assert.equal(p.equipo.esperando, 2);
  assert.equal(p.equipo.respuestas, 3);
  assert.equal(p.equipo.promedioRespuestaMin, 20);
  assert.equal(p.feed[0].tipo, 'CERRADO');
  assert.ok(p.feed.every((f, i) => i === 0 || p.feed[i - 1].fecha >= f.fecha));
  assert.match(p.feed[0].url, /secure\.helpscout\.net\/conversation\/4\/104/);
});

test('inicioVentanaJornada: desde el cierre de la jornada anterior', () => {
  const H = vm.runInContext('CONFIG', contexto).HORARIO_LABORAL; // 9–17, lunes a sábado
  assert.equal(inicioVentanaJornada('2026-11-11', H), '2026-11-10 17:00:00'); // miércoles → martes
  assert.equal(inicioVentanaJornada('2026-11-16', H), '2026-11-14 17:00:00'); // lunes → sábado
});

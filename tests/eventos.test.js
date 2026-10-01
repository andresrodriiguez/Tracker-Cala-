// Pruebas de la lógica pura (Util.gs, Eventos.gs, Metricas.gs) con Node: `npm test`
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const contexto = vm.createContext({});
['Config.gs', 'Util.gs', 'Eventos.gs', 'Metricas.gs'].forEach(archivo => {
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'apps-script', archivo), 'utf8'), contexto, { filename: archivo });
});
const { derivarEventos, contarDia, colorSemaforo, estadisticasTiempo, diaDesdeCelda, mesDesdeNombreHoja, nombreHojaMes, normalizarTexto, minutosHabiles, diaDeJornada, minutosGestion } = contexto;

const JAIDETH = { id: 1, nombre: 'Jaideth Andocilla' };
const EDNA = { id: 2, nombre: 'Edna Escudero' };
const ANDRES = { id: 9, nombre: 'Andrés Rodríguez' };
const COACH = 50; // usuario/equipo de otro departamento
const equipo = { 1: JAIDETH, 2: EDNA, 9: ANDRES };

function ctx(extra) {
  return Object.assign({
    agentePorId: id => equipo[id] || null,
    dia: f => f.toISOString().slice(0, 10), // UTC para las pruebas
    mailboxesEquipo: [],
    tagsReasignacion: ['coach'],
    transferenciaInternaEsReasignacion: true,
  }, extra);
}

let siguienteId = 100;
const cliente = (fecha, extra) => Object.assign({ id: siguienteId++, type: 'customer', status: 'active', createdAt: fecha, createdBy: { id: 777, type: 'customer' } }, extra);
const asignar = (fecha, a, quien = ANDRES.id) => ({ id: siguienteId++, type: 'lineitem', status: 'nochange', createdAt: fecha, createdBy: { id: quien, type: 'user' }, assignedTo: a === null ? null : { id: a } });
const respuesta = (fecha, a, extra) => Object.assign({ id: siguienteId++, type: 'message', status: 'active', createdAt: fecha, createdBy: { id: a, type: 'user' }, assignedTo: { id: a } }, extra);
const conv = (hilos, extra) => Object.assign({ id: 5000, number: 42, subject: 'Prueba', mailboxId: 1, createdAt: hilos[0].createdAt, _embedded: { threads: hilos.slice().reverse() } }, extra);
const tipos = evs => Array.from(evs, e => e.tipo + ':' + e.agente + ':' + e.dia); // Array.from: los arrays del vm son de otro "realm"

test('asignar, responder y cerrar: asignado + primera respuesta + cerrado con tiempos', () => {
  const evs = derivarEventos(conv([
    cliente('2026-10-01T13:00:00Z', { assignedTo: null }),
    asignar('2026-10-01T13:10:00Z', JAIDETH.id),
    respuesta('2026-10-01T13:40:00Z', JAIDETH.id, { status: 'pending' }),
    respuesta('2026-10-01T15:10:00Z', JAIDETH.id, { status: 'closed' }),
  ]), ctx());
  assert.deepEqual(tipos(evs), [
    'ASIGNADO:Jaideth Andocilla:2026-10-01',
    'PRIMERA_RESPUESTA:Jaideth Andocilla:2026-10-01',
    'CERRADO:Jaideth Andocilla:2026-10-01',
  ]);
  assert.equal(evs[1].minutos, 30);
  assert.equal(evs[2].minutos, 120);
});

test('reasignar a otro departamento (usuario fuera del equipo) cuenta como re-asignado', () => {
  const evs = derivarEventos(conv([
    cliente('2026-10-01T13:00:00Z', { assignedTo: null }),
    asignar('2026-10-01T13:10:00Z', JAIDETH.id),
    asignar('2026-10-01T14:00:00Z', COACH, JAIDETH.id),
    respuesta('2026-10-01T16:00:00Z', COACH, { status: 'closed' }),
  ]), ctx());
  assert.deepEqual(tipos(evs), ['ASIGNADO:Jaideth Andocilla:2026-10-01', 'REASIGNADO:Jaideth Andocilla:2026-10-01']);
});

test('transferencia interna: re-asignado para quien lo tenía y asignado para quien lo recibe', () => {
  const hilos = [
    cliente('2026-10-01T13:00:00Z', { assignedTo: null }),
    asignar('2026-10-01T13:10:00Z', JAIDETH.id),
    asignar('2026-10-01T13:20:00Z', EDNA.id),
  ];
  assert.deepEqual(tipos(derivarEventos(conv(hilos), ctx())), [
    'ASIGNADO:Jaideth Andocilla:2026-10-01', 'REASIGNADO:Jaideth Andocilla:2026-10-01', 'ASIGNADO:Edna Escudero:2026-10-01',
  ]);
  assert.deepEqual(tipos(derivarEventos(conv(hilos), ctx({ transferenciaInternaEsReasignacion: false }))), [
    'ASIGNADO:Jaideth Andocilla:2026-10-01', 'ASIGNADO:Edna Escudero:2026-10-01',
  ]);
});

test('el cliente vuelve a escribir otro día en un caso ya atendido → nueva consulta; tiempo de resolución desde la reapertura', () => {
  const evs = derivarEventos(conv([
    cliente('2026-10-01T13:00:00Z', { assignedTo: null }),
    asignar('2026-10-01T13:10:00Z', JAIDETH.id),
    respuesta('2026-10-01T14:00:00Z', JAIDETH.id, { status: 'closed' }),
    cliente('2026-10-03T13:00:00Z', { assignedTo: { id: JAIDETH.id } }),
    cliente('2026-10-03T13:05:00Z', { assignedTo: { id: JAIDETH.id } }), // mismo día: no se repite
    respuesta('2026-10-03T14:00:00Z', JAIDETH.id, { status: 'closed' }),
  ]), ctx());
  assert.deepEqual(tipos(evs), [
    'ASIGNADO:Jaideth Andocilla:2026-10-01', 'PRIMERA_RESPUESTA:Jaideth Andocilla:2026-10-01',
    'CERRADO:Jaideth Andocilla:2026-10-01', 'NUEVA_CONSULTA:Jaideth Andocilla:2026-10-03',
    'CERRADO:Jaideth Andocilla:2026-10-03',
  ]);
  assert.equal(evs[4].minutos, 60);
});

test('mensajes seguidos del cliente antes de que el agente responda no son nueva consulta', () => {
  const evs = derivarEventos(conv([
    cliente('2026-10-01T13:00:00Z', { assignedTo: null }),
    asignar('2026-10-01T13:10:00Z', JAIDETH.id),
    cliente('2026-10-02T09:00:00Z', { assignedTo: { id: JAIDETH.id } }),
  ]), ctx());
  assert.deepEqual(tipos(evs), ['ASIGNADO:Jaideth Andocilla:2026-10-01']);
});

test('etiqueta COACH cuenta como re-asignado si no hubo otra re-asignación', () => {
  const evs = derivarEventos(conv([
    cliente('2026-10-01T13:00:00Z', { assignedTo: null }),
    asignar('2026-10-01T13:10:00Z', JAIDETH.id),
    respuesta('2026-10-01T13:30:00Z', JAIDETH.id, { status: 'pending' }),
  ], { tags: [{ tag: 'COACH' }] }), ctx());
  assert.deepEqual(tipos(evs).slice(-1), ['REASIGNADO:Jaideth Andocilla:2026-10-01']);
});

test('movido a un buzón que no es del equipo cuenta como re-asignado', () => {
  const evs = derivarEventos(conv([
    cliente('2026-10-01T13:00:00Z', { assignedTo: null }),
    asignar('2026-10-01T13:10:00Z', JAIDETH.id),
    { id: siguienteId++, type: 'lineitem', status: 'nochange', createdAt: '2026-10-01T14:00:00Z', createdBy: { id: 1, type: 'user' }, action: { type: 'moved-from-mailbox' } },
  ], { mailboxId: 99 }), ctx({ mailboxesEquipo: [1] }));
  assert.deepEqual(tipos(evs), ['ASIGNADO:Jaideth Andocilla:2026-10-01', 'REASIGNADO:Jaideth Andocilla:2026-10-01']);
});

test('sin assignedTo en los hilos usa el asignado actual; spam y borradores se ignoran', () => {
  const sinAsignacion = conv([{ id: 1, type: 'customer', status: 'active', createdAt: '2026-10-01T13:00:00Z', createdBy: { type: 'customer' } }], { assignee: { id: EDNA.id } });
  assert.deepEqual(tipos(derivarEventos(sinAsignacion, ctx())), ['ASIGNADO:Edna Escudero:2026-10-01']);
  assert.equal(derivarEventos(Object.assign({}, sinAsignacion, { status: 'spam' }), ctx()).length, 0);
  const borrador = conv([
    cliente('2026-10-01T13:00:00Z', { assignedTo: { id: JAIDETH.id } }),
    respuesta('2026-10-01T13:30:00Z', JAIDETH.id, { status: 'closed', state: 'draft' }),
  ]);
  assert.deepEqual(tipos(derivarEventos(borrador, ctx())), ['ASIGNADO:Jaideth Andocilla:2026-10-01']);
});

test('los eventos se repiten con el mismo ID en cada lectura (para no duplicar)', () => {
  const c = conv([cliente('2026-10-01T13:00:00Z', { assignedTo: { id: JAIDETH.id } })]);
  assert.deepEqual(Array.from(derivarEventos(c, ctx()), e => e.id), Array.from(derivarEventos(c, ctx()), e => e.id));
});

test('contarDia replica las fórmulas del tracker', () => {
  const ev = t => ({ tipo: t });
  const m = contarDia([ev('ASIGNADO'), ev('ASIGNADO'), ev('NUEVA_CONSULTA'), ev('REASIGNADO'), ev('CERRADO')], 3);
  assert.equal(m.total, 3 + 2 + 1 - 1);
  assert.equal(m.pendientes, 4);
  assert.equal(m.hayActividad, true);
  assert.equal(contarDia([], 5).hayActividad, false);
});

test('semáforo y estadísticas de tiempo', () => {
  const u = { verde: 0.9, amarillo: 0.6 };
  assert.equal(colorSemaforo(0.93, u), 'VERDE');
  assert.equal(colorSemaforo(0.8, u), 'AMARILLO');
  assert.equal(colorSemaforo(0.59, u), 'ROJO');
  assert.equal(colorSemaforo(null, u), null);
  const s = estadisticasTiempo([60, 120, 3000], 8);
  assert.equal(s.medianaH, 2);
  assert.equal(s.promedioH, 17.7);
  assert.equal(Math.round(s.pctEnMeta * 100), 67);
  assert.equal(estadisticasTiempo([60]).pctEnMeta, null);
});

test('utilidades de fechas y nombres de hojas', () => {
  const f = d => d.toISOString().slice(0, 10);
  assert.equal(diaDesdeCelda('25/09/2026', f), '2026-09-25');
  assert.equal(diaDesdeCelda('2026-09-25', f), '2026-09-25');
  assert.equal(diaDesdeCelda(new Date('2026-09-25T00:00:00Z'), f), '2026-09-25');
  assert.equal(diaDesdeCelda('', f), null);
  assert.equal(nombreHojaMes('2026-09-30'), 'SEPTIEMBRE 2026');
  assert.deepEqual({ ...mesDesdeNombreHoja(' Septiembre  2026 ') }, { anio: 2026, mes: 9 });
  assert.equal(mesDesdeNombreHoja('RESUMEN MENSUAL'), null);
  assert.equal(normalizarTexto('Andrés  Rodríguez'), 'andres rodriguez');
});

// --- Horario laboral: 9:00 a 17:00, lunes a sábado (hora local como campos UTC) ---
const HORARIO = { inicio: 9, fin: 17, dias: [1, 2, 3, 4, 5, 6] };
const L = t => new Date(t + 'Z');

test('minutos hábiles: solo cuenta 9:00–17:00 de lunes a sábado', () => {
  // Mismo día dentro del horario
  assert.equal(minutosHabiles(L('2026-10-01T10:00:00'), L('2026-10-01T11:30:00'), HORARIO), 90);
  // Llega jueves 4:50 pm, se resuelve viernes 9:10 am → 10 + 10 = 20 min
  assert.equal(minutosHabiles(L('2026-10-01T16:50:00'), L('2026-10-02T09:10:00'), HORARIO), 20);
  // Sábado sí cuenta: sábado 16:00 → lunes 10:00 = 60 (sáb) + 0 (dom) + 60 (lun)
  assert.equal(minutosHabiles(L('2026-10-03T16:00:00'), L('2026-10-05T10:00:00'), HORARIO), 120);
  // Todo fuera de horario (noche) → 0
  assert.equal(minutosHabiles(L('2026-10-01T19:00:00'), L('2026-10-01T21:00:00'), HORARIO), 0);
  // Domingo no cuenta
  assert.equal(minutosHabiles(L('2026-10-04T10:00:00'), L('2026-10-04T15:00:00'), HORARIO), 0);
  // Fin antes que inicio → 0
  assert.equal(minutosHabiles(L('2026-10-01T11:00:00'), L('2026-10-01T10:00:00'), HORARIO), 0);
  // Varios días: jueves 9:00 → viernes 17:00 = 2 jornadas de 8 h
  assert.equal(minutosHabiles(L('2026-10-01T09:00:00'), L('2026-10-02T17:00:00'), HORARIO), 960);
});

test('los tiempos de los eventos usan horario laboral cuando se configura', () => {
  const evs = derivarEventos(conv([
    cliente('2026-10-01T16:40:00Z', { assignedTo: null }),
    asignar('2026-10-01T16:50:00Z', JAIDETH.id),
    respuesta('2026-10-02T09:10:00Z', JAIDETH.id, { status: 'closed' }),
  ]), ctx({ minutos: (fin, inicio) => minutosHabiles(inicio, fin, HORARIO) }));
  assert.deepEqual(Array.from(evs, e => e.tipo + ':' + e.minutos), ['ASIGNADO:null', 'PRIMERA_RESPUESTA:20', 'CERRADO:20']);
});

test('día de jornada: lo de la noche o del domingo cuenta para el siguiente día laboral', () => {
  assert.equal(diaDeJornada(L('2026-10-01T10:00:00'), HORARIO), '2026-10-01'); // jueves en horario
  assert.equal(diaDeJornada(L('2026-10-01T07:30:00'), HORARIO), '2026-10-01'); // jueves antes de abrir
  assert.equal(diaDeJornada(L('2026-10-01T16:59:00'), HORARIO), '2026-10-01'); // jueves justo antes de cerrar
  assert.equal(diaDeJornada(L('2026-10-01T17:00:00'), HORARIO), '2026-10-02'); // jueves al cierre → viernes
  assert.equal(diaDeJornada(L('2026-10-01T22:15:00'), HORARIO), '2026-10-02'); // jueves noche → viernes
  assert.equal(diaDeJornada(L('2026-10-03T18:00:00'), HORARIO), '2026-10-05'); // sábado noche → lunes
  assert.equal(diaDeJornada(L('2026-10-04T12:00:00'), HORARIO), '2026-10-05'); // domingo → lunes
  assert.equal(diaDeJornada(L('2026-10-03T11:00:00'), HORARIO), '2026-10-03'); // sábado en horario
});

test('un caso asignado de noche cuenta como asignado del día siguiente', () => {
  const evs = derivarEventos(conv([
    cliente('2026-10-01T21:00:00Z', { assignedTo: null }),
    asignar('2026-10-01T21:30:00Z', JAIDETH.id), // jueves 21:30 (hora local en la prueba)
    respuesta('2026-10-02T09:20:00Z', JAIDETH.id, { status: 'closed' }),
  ]), ctx({
    dia: f => diaDeJornada(f, HORARIO),
    minutos: (fin, inicio) => minutosHabiles(inicio, fin, HORARIO),
  }));
  assert.deepEqual(Array.from(evs, e => e.tipo + ':' + e.dia + ':' + e.minutos),
    ['ASIGNADO:2026-10-02:null', 'PRIMERA_RESPUESTA:2026-10-02:20', 'CERRADO:2026-10-02:20']);
});

test('tiempo de gestión: fuera de horario el mismo día cuenta minutos reales', () => {
  assert.equal(minutosGestion(L('2026-10-01T07:45:00'), L('2026-10-01T07:55:00'), HORARIO), 10); // madrugada
  assert.equal(minutosGestion(L('2026-10-01T16:50:00'), L('2026-10-02T09:10:00'), HORARIO), 20); // cruza la noche: horario laboral
  assert.equal(minutosGestion(L('2026-10-01T18:00:00'), L('2026-10-02T08:00:00'), HORARIO), 0);  // noche → madrugada siguiente: 0
  assert.equal(minutosGestion(L('2026-10-01T08:30:00'), L('2026-10-01T09:30:00'), HORARIO), 30); // parte dentro del horario
});

// Pruebas del panel en vivo y del reporte (EnVivo.gs, Reporte.gs) con Node: `npm test`
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const contexto = vm.createContext({});
['Config.gs', 'Util.gs', 'Eventos.gs', 'Metricas.gs', 'EnVivo.gs', 'Reporte.gs'].forEach(archivo => {
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'apps-script', archivo), 'utf8'), contexto, { filename: archivo });
});
const { derivarEventos, esperaDeConversacion, resumirConversacion, compactoRelevante, armarPanelEnVivo, detalleAgenteEnVivo,
  inicioVentanaJornada, calcularReporte, estadisticasMinutos } = contexto;
const json = v => JSON.parse(JSON.stringify(v)); // objetos del vm → objetos normales

const JAIDETH = { id: 1, nombre: 'Jaideth Andocilla' };
const EDNA = { id: 2, nombre: 'Edna Escudero' };
const OTRO_DEPTO = 50;
const equipo = { 1: JAIDETH, 2: EDNA };
const agentePorId = id => equipo[id] || null;
const dia = f => f.toISOString().slice(0, 10);
const ctxEventos = { agentePorId, dia, mailboxesEquipo: [], tagsReasignacion: [], transferenciaInternaEsReasignacion: true, incluirRespuestas: true };
const o = { dia, hoy: '2026-11-12', ctxEventos };
const opPanel = { agentes: [JAIDETH, EDNA, { nombre: 'Sin Cuenta', id: null }], mostrarSinAsignar: true };

let sig = 1;
const cliente = (fecha, extra) => Object.assign({ id: sig++, type: 'customer', status: 'active', createdAt: fecha, createdBy: { id: 777, type: 'customer' } }, extra);
const asignar = (fecha, a) => ({ id: sig++, type: 'lineitem', status: 'nochange', createdAt: fecha, createdBy: { id: a, type: 'user' }, assignedTo: { id: a } });
const responder = (fecha, a, estado) => ({ id: sig++, type: 'message', status: estado || 'active', createdAt: fecha, createdBy: { id: a, type: 'user' }, assignedTo: { id: a } });
const nota = (fecha, a, estado) => ({ id: sig++, type: 'note', status: estado || 'nochange', createdAt: fecha, createdBy: { id: a, type: 'user' } });
const cambioEstado = (fecha, a, estado) => ({ id: sig++, type: 'lineitem', status: estado, createdAt: fecha, createdBy: { id: a, type: 'user' } });
const conv = (id, hilos, extra) => Object.assign({
  id, number: id, subject: 'Caso ' + id, status: 'active', mailboxId: 1, createdAt: hilos[0].createdAt,
  primaryCustomer: { first: 'Laura', last: 'Gómez' }, _embedded: { threads: hilos.slice().reverse() },
}, extra);

// ---------- ¿El cliente está esperando? ----------

test('espera: cuenta desde el PRIMER mensaje sin contestar; una respuesta la detiene', () => {
  const hilos = [cliente('2026-11-12T13:00:00Z'), cliente('2026-11-12T13:10:00Z')];
  assert.deepEqual(json(esperaDeConversacion(conv(1, hilos))), { esperando: true, desde: '2026-11-12T13:00:00.000Z', mensajes: 2 });
  hilos.push(responder('2026-11-12T13:30:00Z', 1));
  assert.equal(esperaDeConversacion(conv(1, hilos)).esperando, false);
  hilos.push(cliente('2026-11-12T14:00:00Z'));
  assert.equal(esperaDeConversacion(conv(1, hilos)).desde, '2026-11-12T14:00:00.000Z');
});

test('espera: notas internas, asignaciones y pasar a pending NO cuentan como respuesta', () => {
  const hilos = [cliente('2026-11-12T13:00:00Z'), asignar('2026-11-12T13:05:00Z', 1), nota('2026-11-12T13:10:00Z', 1),
    cambioEstado('2026-11-12T13:15:00Z', 1, 'pending')];
  const e = esperaDeConversacion(conv(2, hilos, { status: 'pending' }));
  assert.equal(e.esperando, true);
  assert.equal(e.desde, '2026-11-12T13:00:00.000Z');
});

test('espera: caso cerrado, spam o borrado no espera; al reabrirse el reloj empieza con el mensaje nuevo', () => {
  const hilos = [cliente('2026-11-10T13:00:00Z'), cambioEstado('2026-11-10T14:00:00Z', 1, 'closed')];
  assert.equal(esperaDeConversacion(conv(3, hilos, { status: 'closed' })).esperando, false);
  hilos.push(cliente('2026-11-12T09:00:00Z'));
  assert.equal(esperaDeConversacion(conv(3, hilos)).desde, '2026-11-12T09:00:00.000Z'); // no desde el día 10
  assert.equal(esperaDeConversacion(conv(3, hilos, { status: 'spam' })).esperando, false);
  assert.equal(esperaDeConversacion(conv(3, hilos, { state: 'deleted' })).esperando, false);
});

test('espera: borradores no cuentan; la respuesta de otro departamento sí detiene el reloj', () => {
  const borrador = Object.assign(responder('2026-11-12T13:20:00Z', 1), { state: 'draft' });
  assert.equal(esperaDeConversacion(conv(4, [cliente('2026-11-12T13:00:00Z'), borrador])).esperando, true);
  assert.equal(esperaDeConversacion(conv(4, [cliente('2026-11-12T13:00:00Z'), responder('2026-11-12T13:20:00Z', OTRO_DEPTO)])).esperando, false);
  // caso que inicia la agente (sin mensaje del cliente): nadie espera
  assert.equal(esperaDeConversacion(conv(4, [responder('2026-11-12T13:00:00Z', 1)])).esperando, false);
});

// ---------- Eventos RESPUESTA ----------

test('RESPUESTA: una por cada respuesta del equipo, con minutos desde el primer mensaje sin contestar', () => {
  const evs = derivarEventos(conv(10, [
    cliente('2026-11-12T13:00:00Z', { assignedTo: null }),
    asignar('2026-11-12T13:05:00Z', 1),
    cliente('2026-11-12T13:10:00Z'),
    responder('2026-11-12T13:40:00Z', 1),
    responder('2026-11-12T13:45:00Z', 1),              // seguimiento: sin tiempo
    cliente('2026-11-12T14:00:00Z'),
    responder('2026-11-12T14:05:00Z', OTRO_DEPTO),     // otro depto: no es del equipo, pero contesta al cliente
    responder('2026-11-12T14:30:00Z', 2),              // Edna responde después: cuenta para ella, sin tiempo (ya estaba contestado)
  ]), ctxEventos);
  const resp = Array.from(evs).filter(e => e.tipo === 'RESPUESTA').map(e => [e.agente, e.minutos]);
  assert.deepEqual(resp, [['Jaideth Andocilla', 40], ['Jaideth Andocilla', null], ['Edna Escudero', null]]);
  // 1ª respuesta: desde la asignación (regla del tracker). Al responder, Help Scout le asigna el caso a Edna.
  const primera = Array.from(evs).filter(e => e.tipo === 'PRIMERA_RESPUESTA').map(e => [e.agente, e.minutos]);
  assert.deepEqual(primera, [['Jaideth Andocilla', 35], ['Edna Escudero', 0]]);
  // sin la opción, no se emiten (el tracker sigue igual)
  const sin = derivarEventos(conv(10, [cliente('2026-11-12T13:00:00Z'), responder('2026-11-12T13:40:00Z', 1)]),
    Object.assign({}, ctxEventos, { incluirRespuestas: false }));
  assert.equal(Array.from(sin).filter(e => e.tipo === 'RESPUESTA').length, 0);
});

test('RESPUESTA: los IDs son estables (no se duplican al releer) y el reloj se reinicia tras un cierre', () => {
  const c = conv(11, [
    cliente('2026-11-10T13:00:00Z'), asignar('2026-11-10T13:01:00Z', 1), cambioEstado('2026-11-10T14:00:00Z', 1, 'closed'),
    cliente('2026-11-12T13:00:00Z'), responder('2026-11-12T13:20:00Z', 1),
  ]);
  const a = Array.from(derivarEventos(c, ctxEventos)).filter(e => e.tipo === 'RESPUESTA');
  const b = Array.from(derivarEventos(c, ctxEventos)).filter(e => e.tipo === 'RESPUESTA');
  assert.deepEqual(a.map(e => e.id), b.map(e => e.id));
  assert.equal(a[0].minutos, 20); // no 2 días
});

// ---------- Panel ----------

test('resumirConversacion: espera, actividad del día y mensajes del cliente de hoy', () => {
  const c = json(resumirConversacion(conv(20, [
    cliente('2026-11-11T14:00:00Z', { assignedTo: null }),
    asignar('2026-11-11T14:05:00Z', 1),
    responder('2026-11-11T14:30:00Z', 1, 'pending'),   // ayer: no entra en la actividad de hoy
    cliente('2026-11-12T13:00:00Z'),
    responder('2026-11-12T13:40:00Z', 1),
    cliente('2026-11-12T15:00:00Z'),
  ], { assignee: { id: 1 } }), o));
  assert.equal(c.a, 1);
  assert.equal(c.c, 'Laura Gómez');
  assert.equal(c.w, '2026-11-12T15:00:00.000Z');
  assert.deepEqual(c.cm, ['2026-11-12T13:00:00.000Z', '2026-11-12T15:00:00.000Z']);
  assert.deepEqual(c.ev.map(e => [e[0], e[1], e[3]]), [['NUEVA_CONSULTA', 1, null], ['RESPUESTA', 1, 40]]);
});

test('compactoRelevante: abiertos del equipo, sin asignar y casos con actividad', () => {
  const del = id => !!equipo[id];
  const base = { st: 'active', a: 1, ev: [] };
  assert.equal(compactoRelevante(base, del, true), true);
  assert.equal(compactoRelevante(Object.assign({}, base, { a: 99 }), del, true), false);
  assert.equal(compactoRelevante(Object.assign({}, base, { a: null }), del, true), true);
  assert.equal(compactoRelevante(Object.assign({}, base, { a: null }), del, false), false);
  assert.equal(compactoRelevante(Object.assign({}, base, { st: 'closed' }), del, true), false);
  assert.equal(compactoRelevante(Object.assign({}, base, { st: 'deleted' }), del, true), false);
  assert.equal(compactoRelevante(Object.assign({}, base, { st: 'closed', ev: [['RESPUESTA', 1, 'x', 3]] }), del, true), true);
});

const compactos = () => [
  { id: 1, n: 101, s: 'A', c: 'X', st: 'active', a: 1, w: '2026-11-12T13:30:00.000Z', ev: [['ASIGNADO', 1, '2026-11-12T13:00:00.000Z', null]], cm: [] },
  { id: 2, n: 102, s: 'B', c: 'Y', st: 'pending', a: 1, w: '2026-11-12T13:10:00.000Z', ev: [], cm: [] },
  { id: 3, n: 103, s: 'C', c: 'Z', st: 'pending', a: 1, w: null, cm: ['2026-11-12T13:50:00.000Z'],
    ev: [['PRIMERA_RESPUESTA', 1, '2026-11-12T13:20:00.000Z', 20], ['RESPUESTA', 1, '2026-11-12T13:20:00.000Z', 20],
      ['RESPUESTA', 1, '2026-11-12T14:00:00.000Z', 10], ['RESPUESTA', 1, '2026-11-12T14:02:00.000Z', null]] },
  { id: 4, n: 104, s: 'D', c: 'W', st: 'closed', a: 2, w: null, cm: [],
    ev: [['RESPUESTA', 2, '2026-11-12T14:50:00.000Z', 30], ['CERRADO', 2, '2026-11-12T15:00:00.000Z', 50]] },
  { id: 5, n: 105, s: 'E', c: 'V', st: 'active', a: null, w: '2026-11-12T15:30:00.000Z', ev: [], cm: [] },
  { id: 6, n: 106, s: 'F', c: 'U', st: 'active', a: 99, w: '2026-11-12T12:00:00.000Z', ev: [], cm: [] }, // otro depto
  { id: 7, n: 107, s: 'G', c: 'T', st: 'active', a: 2, w: null, ev: [], cm: [] }, // Edna respondió de último: en seguimiento
];

test('armarPanelEnVivo: cada cifra sale de los casos y movimientos', () => {
  const p = json(armarPanelEnVivo(compactos(), opPanel));
  const [ja, ed, sin] = p.agentes;
  assert.deepEqual(ja.esperando.map(t => t.numero), [102, 101]); // el que más espera primero
  assert.equal(ja.seguimiento, 1);
  assert.equal(ja.abiertos, 3);
  assert.equal(ja.activos + ja.pendientes, ja.abiertos);
  assert.equal(ja.esperando.length + ja.seguimiento, ja.abiertos);
  assert.equal(ja.hoy.respuestas, 3);
  assert.equal(ja.hoy.casosRespondidos, 1);
  assert.equal(ja.hoy.tiemposMedidos, 2);            // la respuesta sin mensaje previo no entra al promedio
  assert.equal(ja.hoy.promedioRespuestaMin, 15);
  assert.equal(ja.hoy.medianaRespuestaMin, 15);
  assert.equal(ja.hoy.promedioPrimeraMin, 20);
  assert.equal(ja.hoy.asignados, 1);
  assert.equal(ja.hoy.ultimaRespuesta, '2026-11-12T14:02:00.000Z');
  assert.equal(ed.hoy.cerrados, 1);
  assert.equal(ed.esperando.length, 0);
  assert.equal(ed.seguimiento, 1);
  assert.equal(sin.vinculado, false);
  assert.equal(sin.hoy, null);
  assert.deepEqual(p.sinAsignar.map(t => t.numero), [105]);
  // los totales del equipo son la suma de las agentes
  assert.equal(p.equipo.esperando, ja.esperando.length + ed.esperando.length);
  assert.equal(p.equipo.abiertos, ja.abiertos + ed.abiertos);
  assert.equal(p.equipo.respuestas, ja.hoy.respuestas + ed.hoy.respuestas);
  assert.equal(p.equipo.cerrados, 1);
  assert.equal(p.equipo.promedioRespuestaMin, 20);   // (20 + 10 + 30) / 3
  assert.equal(p.equipo.tiemposMedidos, 3);
  // actividad: más reciente primero, sin PRIMERA_RESPUESTA (ya está como RESPUESTA)
  assert.equal(p.feed[0].tipo, 'CERRADO');
  assert.ok(p.feed.every((f, i) => i === 0 || p.feed[i - 1].fecha >= f.fecha));
  assert.equal(p.feed.filter(f => f.tipo === 'PRIMERA_RESPUESTA').length, 0);
  assert.equal(p.feed.filter(f => f.tipo === 'RESPUESTA').length, p.equipo.respuestas);
  assert.match(p.feed[0].url, /secure\.helpscout\.net\/conversation\/4\/104/);
});

test('detalleAgenteEnVivo: las listas cuadran con las cifras de la tabla', () => {
  const p = json(armarPanelEnVivo(compactos(), opPanel));
  const d = json(detalleAgenteEnVivo(compactos(), JAIDETH));
  assert.equal(d.abiertos.length, p.agentes[0].abiertos);
  assert.equal(d.abiertos.filter(t => t.esperaDesde).length, p.agentes[0].esperando.length);
  assert.equal(d.movimientos.filter(m => m.tipo === 'RESPUESTA').length, p.agentes[0].hoy.respuestas);
  assert.equal(d.movimientos.filter(m => m.tipo === 'ASIGNADO').length, p.agentes[0].hoy.asignados);
  assert.deepEqual(d.abiertos.map(t => t.numero), [102, 101, 103]);
});

test('inicioVentanaJornada: desde el cierre de la jornada anterior', () => {
  const H = vm.runInContext('CONFIG', contexto).HORARIO_LABORAL; // 9–17, lunes a sábado
  assert.equal(inicioVentanaJornada('2026-11-11', H), '2026-11-10 17:00:00'); // miércoles → martes
  assert.equal(inicioVentanaJornada('2026-11-16', H), '2026-11-14 17:00:00'); // lunes → sábado
});

// ---------- Reporte para exportar ----------

test('estadisticasMinutos: promedio, mediana, p90, máximo y % en meta', () => {
  const s = json(estadisticasMinutos([10, 20, 30, 40, 100], 30));
  assert.deepEqual(s, { n: 5, promedio: 40, mediana: 30, p90: 100, maximo: 100, pctEnMeta: 0.6 });
  assert.equal(estadisticasMinutos([5, 15]).mediana, 10);
  assert.equal(estadisticasMinutos([null, undefined]).n, 0);
  const diez = estadisticasMinutos([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  assert.equal(diez.p90, 9);
});

const ev = (dia, tipo, agente, numero, minutos) => ({ dia, fecha: dia + ' 10:00:00', tipo, agente, numero, asunto: 'x', minutos: minutos == null ? null : minutos, enlace: 'u' });
const filtros = extra => Object.assign({
  desde: '2026-11-01', hasta: '2026-11-30', agentes: ['Jaideth Andocilla', 'Edna Escudero'],
  metaRespuestaMin: 60, metaResolucionHoras: 8, semaforo: { verde: 0.9, amarillo: 0.6 },
}, extra);

test('calcularReporte: por día usa las mismas reglas del tracker y los totales son la suma', () => {
  const eventos = [
    ev('2026-11-10', 'ASIGNADO', 'Jaideth Andocilla', 1), ev('2026-11-10', 'ASIGNADO', 'Jaideth Andocilla', 2),
    ev('2026-11-10', 'RESPUESTA', 'Jaideth Andocilla', 1, 30), ev('2026-11-10', 'RESPUESTA', 'Jaideth Andocilla', 1, 90),
    ev('2026-11-10', 'RESPUESTA', 'Jaideth Andocilla', 2, null),
    ev('2026-11-10', 'PRIMERA_RESPUESTA', 'Jaideth Andocilla', 1, 25),
    ev('2026-11-10', 'CERRADO', 'Jaideth Andocilla', 1, 120),
    ev('2026-11-11', 'CERRADO', 'Jaideth Andocilla', 2, 600),
    ev('2026-11-11', 'NUEVA_CONSULTA', 'jaideth  andocilla', 9), // nombre con otro formato
    ev('2026-11-11', 'ASIGNADO', 'Edna Escudero', 3), ev('2026-11-11', 'REASIGNADO', 'Edna Escudero', 3),
    ev('2026-10-31', 'ASIGNADO', 'Jaideth Andocilla', 50),       // fuera de rango
    ev('2026-11-10', 'ASIGNADO', 'Otra Persona', 60),            // no pedida
  ];
  const fotos = { '2026-11-11|jaideth andocilla': { total: 1, casos: ['2'] }, '2026-11-12|edna escudero': { total: 2, casos: ['7', '8'] } };
  const r = json(calcularReporte(eventos, fotos, filtros()));

  const d10 = r.porDia.find(x => x.dia === '2026-11-10');
  assert.deepEqual([d10.asignados, d10.cerrados, d10.total, d10.pendientes, d10.respuestas, d10.casosRespondidos], [2, 1, 2, 1, 3, 2]);
  assert.equal(d10.pctResolucion, 0.5);
  assert.equal(d10.semaforo, 'ROJO');
  assert.equal(d10.respuestaPromMin, 60);
  assert.equal(d10.respuestaEnMeta, 0.5);
  assert.equal(d10.resolucionPromH, 2);
  const d11 = r.porDia.find(x => x.dia === '2026-11-11' && x.agente === 'Jaideth Andocilla');
  assert.deepEqual([d11.sinAtender, d11.nuevaConsulta, d11.total, d11.cerrados], [1, 1, 2, 1]); // #2 venía en la foto
  const fotoSola = r.porDia.find(x => x.dia === '2026-11-12');
  assert.deepEqual([fotoSola.agente, fotoSola.sinAtender, fotoSola.total, fotoSola.pendientes], ['Edna Escudero', 2, 2, 2]);

  const [ja, ed, eq] = r.porAgente;
  assert.deepEqual([ja.dias, ja.asignados, ja.nuevaConsulta, ja.cerrados, ja.total], [2, 2, 1, 2, 4]);
  assert.equal(ja.pctResolucion, 0.5);
  assert.deepEqual([ja.respuestas, ja.casosRespondidos, ja.respuestasMedidas, ja.respuestaPromMin, ja.respuestaMedianaMin], [3, 2, 2, 60, 60]);
  assert.deepEqual([ja.resolucionesMedidas, ja.resolucionPromH, ja.resolucionEnMeta], [2, 6, 0.5]); // 2 h y 10 h, meta 8 h
  assert.deepEqual([ed.asignados, ed.reasignados, ed.total, ed.dias], [1, 1, 2, 1]); // 11: 1−1=0 (no cuenta como día); 12: foto 2
  assert.equal(eq.agente, 'EQUIPO');
  ['asignados', 'nuevaConsulta', 'reasignados', 'cerrados', 'total', 'respuestas', 'sinAtender', 'dias'].forEach(c =>
    assert.equal(eq[c], ja[c] + ed[c], c));
  ['asignados', 'cerrados', 'total', 'respuestas'].forEach(c =>
    assert.equal(eq[c], r.porDia.reduce((s, x) => s + x[c], 0), 'suma diaria de ' + c));
  assert.equal(r.detalle.length, 11);
  assert.equal(r.detalle.every(e => e.agente === 'Jaideth Andocilla' || e.agente === 'Edna Escudero'), true);
});

test('calcularReporte: filtros por agente, fechas y tipo de movimiento', () => {
  const eventos = [ev('2026-11-10', 'ASIGNADO', 'Jaideth Andocilla', 1), ev('2026-11-10', 'CERRADO', 'Jaideth Andocilla', 1, 60),
    ev('2026-11-10', 'ASIGNADO', 'Edna Escudero', 2), ev('2026-11-20', 'ASIGNADO', 'Edna Escudero', 3)];
  const r = json(calcularReporte(eventos, {}, filtros({ agentes: ['Edna Escudero'], hasta: '2026-11-15', tipos: ['CERRADO'] })));
  assert.equal(r.porAgente.length, 2);
  assert.equal(r.porAgente[0].asignados, 1);
  assert.equal(r.porAgente[1].asignados, 1);
  assert.equal(r.porDia.length, 1);
  assert.equal(r.detalle.length, 0); // Edna no cerró nada
  assert.equal(r.eventosTotales, 1);
  const vacio = json(calcularReporte([], {}, filtros()));
  assert.equal(vacio.porDia.length, 0);
  assert.equal(vacio.porAgente[2].pctResolucion, null);
});

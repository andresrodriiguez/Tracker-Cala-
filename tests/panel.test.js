// Prueba de punta a punta del servidor del panel (Panel.gs) con Apps Script y Help Scout simulados: `npm test`
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const TZ = 'America/New_York';
function partes(fecha, tz) {
  const p = {};
  new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23', weekday: 'short' })
    .formatToParts(fecha).forEach(x => { p[x.type] = x.value; });
  return p;
}
const Utilities = {
  formatDate(fecha, tz, formato) {
    const p = partes(fecha, tz);
    const dia = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 }[p.weekday];
    return formato.replace(/'([^']*)'/g, (m, t) => '\u0000' + t + '\u0000').split('\u0000').map((trozo, i) => (i % 2 ? trozo : trozo
      .replace('yyyy', p.year).replace('MM', p.month).replace('dd', p.day).replace('HH', p.hour).replace('mm', p.minute).replace('ss', p.second)
      .replace(/\bH\b/, String(Number(p.hour))).replace(/\bu\b/, String(dia)))).join('');
  },
  parseDate(texto, tz) {
    const [d, h] = texto.split(' ');
    const utc = new Date(d + 'T' + (h || '00:00:00') + 'Z');
    const p = partes(utc, tz);
    const local = new Date(`${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}Z`);
    return new Date(utc.getTime() + (utc - local));
  },
  sleep() {},
};

function crearEntorno(ahora, api) {
  const cache = {};
  const props = { HS_APP_ID: 'x', HS_APP_SECRET: 'y' };
  const llamadas = [];
  class FechaFija extends Date {
    constructor(...a) { if (a.length) super(...a); else super(ahora.t); }
    static now() { return ahora.t; }
  }
  const ctx = vm.createContext({
    Date: FechaFija, Utilities, console: { log() {}, warn() {}, error() {} },
    Session: { getScriptTimeZone: () => TZ },
    CacheService: { getScriptCache: () => ({
      get: k => (k in cache ? cache[k] : null), put: (k, v) => { cache[k] = v; }, remove: k => { delete cache[k]; },
      removeAll: ks => ks.forEach(k => delete cache[k]), putAll: o => Object.assign(cache, o),
      getAll: ks => ks.reduce((o, k) => { if (k in cache) o[k] = cache[k]; return o; }, {}),
    }) },
    PropertiesService: { getScriptProperties: () => ({ getProperty: k => (k in props ? props[k] : null), setProperty: (k, v) => { props[k] = v; } }) },
    UrlFetchApp: { fetch(url) {
      llamadas.push(url);
      const u = new URL(url);
      const cuerpo = u.pathname.endsWith('/oauth2/token') ? { access_token: 't', expires_in: 7200 } : api(u.pathname.replace('/v2', ''), u.searchParams);
      return { getResponseCode: () => 200, getContentText: () => JSON.stringify(cuerpo), getHeaders: () => ({}) };
    } },
    HtmlService: {}, SpreadsheetApp: { getActiveSpreadsheet: () => null }, ScriptApp: {}, LockService: {},
  });
  ['Config', 'Util', 'Eventos', 'Metricas', 'EnVivo', 'Reporte', 'HelpScout', 'Sync', 'Panel'].forEach(n =>
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'apps-script', n + '.gs'), 'utf8'), ctx, { filename: n + '.gs' }));
  return { ctx, cache, llamadas };
}

// ----- Help Scout simulado -----
const USUARIOS = [
  { id: 1, firstName: 'Jaideth', lastName: 'Andocilla', email: 'jaideth.andocilla@calapresenta.com', role: 'user' },
  { id: 2, firstName: 'Maryelin', lastName: 'Rios', email: 'maryelin.rios@calapresenta.com', role: 'user' },
  { id: 3, firstName: 'Edna', lastName: 'Escudero', email: 'edna@calapresenta.com', role: 'user' },
  { id: 4, firstName: 'Andrés', lastName: 'Rodríguez', email: 'andres.rodriguez@calapresenta.com', role: 'admin' },
  { id: 50, firstName: 'Coach', lastName: 'Otro', email: 'coach@calapresenta.com', role: 'user' },
];
let hilo = 1;
const cli = f => ({ id: hilo++, type: 'customer', status: 'active', state: 'published', createdAt: f, createdBy: { id: 900, type: 'customer' } });
const asg = (f, a) => ({ id: hilo++, type: 'lineitem', status: 'nochange', state: 'published', createdAt: f, createdBy: { id: 4, type: 'user' }, assignedTo: { id: a } });
const rsp = (f, a, st) => ({ id: hilo++, type: 'message', status: st || 'active', state: 'published', createdAt: f, createdBy: { id: a, type: 'user' }, assignedTo: { id: a } });
const conv = (n, status, asignado, modificado, hilos) => ({
  id: 1000 + n, number: n, subject: 'Caso ' + n, status, state: 'published', mailboxId: 7, createdAt: hilos[0].createdAt, userUpdatedAt: modificado,
  assignee: asignado ? { id: asignado, type: 'user' } : undefined, primaryCustomer: { first: 'Cliente', last: String(n) },
  threads: hilos.filter(h => h.type !== 'note').length, _modificado: modificado, _embedded: { threads: hilos.slice().reverse() },
});

function apiCon(convs) {
  return (ruta, q) => {
    if (ruta === '/users') return { _embedded: { users: USUARIOS }, page: { totalPages: 1, totalElements: USUARIOS.length } };
    if (ruta === '/mailboxes') return { _embedded: { mailboxes: [{ id: 7, name: 'Soporte', email: 's@x.com' }] }, page: { totalPages: 1 } };
    if (ruta === '/conversations') {
      const st = q.get('status');
      let r = convs.filter(c => st === 'all' || c.status === st);
      if (q.get('assigned_to')) r = r.filter(c => c.assignee && String(c.assignee.id) === q.get('assigned_to'));
      if (q.get('query')) r = r.filter(c => !c.assignee);
      if (q.get('modifiedSince')) r = r.filter(c => c._modificado > q.get('modifiedSince'));
      const sinHilos = !q.get('embed');
      const pagina = Number(q.get('page')), porPagina = 2; // páginas chicas para probar la paginación
      const trozo = r.slice((pagina - 1) * porPagina, pagina * porPagina)
        .map(c => (sinHilos ? Object.assign({}, c, { _embedded: undefined }) : c));
      return { _embedded: { conversations: trozo }, page: { totalPages: Math.ceil(r.length / porPagina), totalElements: r.length } };
    }
    throw new Error('Ruta no simulada: ' + ruta);
  };
}

// Jueves 12 nov 2026, 11:00 de Miami = 16:00 UTC (horario estándar).
const H = h => `2026-11-12T${h}Z`;
const AYER = h => `2026-11-11T${h}Z`;
function casosBase() {
  hilo = 1;
  return [
    // Jaideth: #1 esperando desde las 10:00 de Miami; #2 respondido hoy (20 min) y en seguimiento; #3 esperando desde ayer, en pending.
    conv(1, 'active', 1, H('15:00:00'), [cli(H('15:00:00')), asg(H('15:01:00'), 1)]),
    conv(2, 'pending', 1, H('15:30:00'), [cli(H('15:10:00')), asg(H('15:11:00'), 1), rsp(H('15:30:00'), 1, 'pending')]),
    conv(3, 'pending', 1, AYER('19:00:00'), [cli(AYER('18:00:00')), asg(AYER('18:05:00'), 1)]),
    // Edna: #4 cerrado hoy tras responder; #5 abierto, respondido ayer.
    conv(4, 'closed', 3, H('15:45:00'), [cli(H('14:30:00')), asg(H('14:31:00'), 3), rsp(H('15:00:00'), 3), rsp(H('15:45:00'), 3, 'closed')]),
    conv(5, 'active', 3, AYER('20:00:00'), [cli(AYER('19:00:00')), asg(AYER('19:01:00'), 3), rsp(AYER('20:00:00'), 3)]),
    // Sin asignar, y uno de otro departamento.
    conv(6, 'active', null, H('15:50:00'), [cli(H('15:50:00'))]),
    conv(7, 'active', 50, H('15:55:00'), [cli(H('15:55:00')), asg(H('15:56:00'), 50)]),
  ];
}

test('panel de punta a punta: recarga completa, verificación y cifras', () => {
  const ahora = { t: Date.parse(H('16:00:00')) };
  const casos = casosBase();
  const { ctx, llamadas } = crearEntorno(ahora, apiCon(casos));
  const r = JSON.parse(vm.runInContext('datosPanelEnVivo()', ctx));
  assert.equal(r.ok, true, r.error);
  assert.equal(r.hoy, '2026-11-12');
  assert.equal(r.enHorario, true);
  assert.deepEqual(r.sinVincular, []);
  assert.equal(r.verificacion.ok, true, r.verificacion.avisos.join(' '));
  assert.equal(r.verificacion.casosAbiertos, 4); // #1 #2 #3 #5

  const [ja, ma, ed, an] = r.panel.agentes;
  assert.deepEqual(ja.esperando.map(t => t.numero), [3, 1]);           // el de ayer primero
  assert.equal(ja.esperando[0].esperaDesde, AYER('18:00:00').replace('Z', '.000Z'));
  assert.deepEqual([ja.seguimiento, ja.abiertos, ja.activos, ja.pendientes], [1, 3, 1, 2]);
  assert.deepEqual([ja.hoy.asignados, ja.hoy.respuestas, ja.hoy.casosRespondidos, ja.hoy.cerrados], [2, 1, 1, 0]);
  assert.equal(ja.hoy.promedioRespuestaMin, 20);                       // 10:10 → 10:30 de Miami
  assert.equal(ja.hoy.promedioPrimeraMin, 19);                         // asignado 10:11 → 10:30
  assert.equal(ja.hoy.ultimaRespuesta, H('15:30:00').replace('Z', '.000Z'));
  assert.deepEqual([ed.esperando.length, ed.seguimiento, ed.abiertos], [0, 1, 1]);
  assert.deepEqual([ed.hoy.asignados, ed.hoy.respuestas, ed.hoy.cerrados], [1, 2, 1]);
  assert.equal(ed.hoy.promedioRespuestaMin, 30);                       // 9:30 → 10:00; la 2ª respuesta no tenía cliente esperando
  assert.deepEqual([ma.abiertos, ma.hoy.respuestas, an.abiertos], [0, 0, 0]);
  assert.deepEqual(r.panel.sinAsignar.map(t => t.numero), [6]);        // el #7 es de otro departamento
  assert.equal(r.panel.sinAsignar[0].buzon, 'Soporte');
  assert.deepEqual([r.panel.equipo.esperando, r.panel.equipo.abiertos, r.panel.equipo.respuestas, r.panel.equipo.cerrados], [2, 4, 3, 1]);
  assert.equal(r.panel.equipo.promedioRespuestaMin, 25);

  // Detalle auditable: cuadra con la tabla.
  const d = JSON.parse(vm.runInContext('detalleAgentePanel(1)', ctx));
  assert.equal(d.ok, true, d.error);
  assert.equal(d.abiertos.length, ja.abiertos);
  assert.equal(d.movimientos.filter(m => m.tipo === 'RESPUESTA').length, ja.hoy.respuestas);

  // Segunda petición dentro de la misma ventana: sale de la caché, sin llamar a Help Scout.
  const n = llamadas.length;
  vm.runInContext('datosPanelEnVivo()', ctx);
  assert.equal(llamadas.length, n);
});

test('panel de punta a punta: actualización incremental entre recargas', () => {
  const ahora = { t: Date.parse(H('16:00:00')) };
  const casos = casosBase();
  const { ctx, cache, llamadas } = crearEntorno(ahora, apiCon(casos));
  vm.runInContext('datosPanelEnVivo()', ctx);

  // 16:00:20 UTC — Jaideth responde el #1; entra un caso nuevo sin asignar; el #6 lo toma Maryelin.
  casos[0]._embedded.threads.unshift(rsp(H('16:00:20'), 1));
  casos[0]._modificado = H('16:00:20'); casos[0].threads++;
  casos.push(conv(8, 'active', null, H('16:00:25'), [cli(H('16:00:25'))]));
  casos[5].assignee = { id: 2, type: 'user' };
  casos[5]._embedded.threads.unshift(asg(H('16:00:28'), 2));
  casos[5]._modificado = H('16:00:28');

  ahora.t = Date.parse(H('16:00:30'));
  delete cache.PANEL_RESPUESTA; // venció la ventana de 5 s
  const antes = llamadas.length;
  const r = JSON.parse(vm.runInContext('datosPanelEnVivo()', ctx));
  assert.equal(r.ok, true, r.error);
  const nuevas = llamadas.slice(antes).filter(u => u.includes('/conversations'));
  assert.ok(nuevas.every(u => u.includes('modifiedSince')), 'solo consultas incrementales');
  assert.ok(nuevas.length <= 3, 'pocas llamadas: ' + nuevas.length);

  const [ja, ma] = r.panel.agentes;
  assert.deepEqual(ja.esperando.map(t => t.numero), [3]);              // el #1 ya fue respondido
  assert.deepEqual([ja.seguimiento, ja.hoy.respuestas], [2, 2]);
  assert.equal(ja.hoy.promedioRespuestaMin, 40);                       // (20 + 60) / 2
  assert.deepEqual(ma.esperando.map(t => t.numero), [6]);
  assert.equal(ma.hoy.asignados, 1);
  assert.deepEqual(r.panel.sinAsignar.map(t => t.numero), [8]);
  assert.equal(r.panel.feed[0].tipo, 'ASIGNADO');

  // A los 5 min se vuelve a leer todo y vuelve a cuadrar con Help Scout.
  ahora.t = Date.parse(H('16:06:00'));
  delete cache.PANEL_RESPUESTA;
  const r2 = JSON.parse(vm.runInContext('datosPanelEnVivo()', ctx));
  assert.equal(r2.verificacion.ok, true, r2.verificacion.avisos.join(' '));
  assert.notEqual(r2.ultimaRecargaCompleta, r.ultimaRecargaCompleta);
  assert.deepEqual(r2.panel.agentes[0].esperando.map(t => t.numero), [3]);
  assert.equal(r2.panel.equipo.abiertos, 5);
});

test('reporteMetricas sin hoja disponible devuelve un error claro (no revienta)', () => {
  const { ctx } = crearEntorno({ t: Date.parse(H('16:00:00')) }, apiCon([]));
  const r = JSON.parse(vm.runInContext('reporteMetricas({ desde: "2026-11-01", hasta: "2026-11-12", agentes: [], tipos: [] })', ctx));
  assert.equal(r.ok, false);
  assert.match(r.error, /hoja del tracker/);
});

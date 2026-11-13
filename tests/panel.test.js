// Panel en vivo: lógica pura (panel/logica.js) y servidor (PanelServidor.gs) con Apps Script y Help Scout simulados.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const Logica = require('../panel/logica.js');

// ---------- Apps Script simulado ----------
const TZ = 'America/New_York';
function partes(fecha, tz) {
  const p = {};
  new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' })
    .formatToParts(fecha).forEach(x => { p[x.type] = x.value; });
  return p;
}
const Utilities = {
  formatDate(fecha, tz, formato) {
    const p = partes(fecha, tz);
    return formato.replace(/'([^']*)'/g, (m, t) => '\u0000' + t + '\u0000').split('\u0000').map((trozo, i) => (i % 2 ? trozo : trozo
      .replace('yyyy', p.year).replace('MM', p.month).replace('dd', p.day).replace('HH', p.hour).replace('mm', p.minute).replace('ss', p.second))).join('');
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
    CacheService: { getScriptCache: () => ({ get: k => (k in cache ? cache[k] : null), put: (k, v) => { cache[k] = v; }, remove: k => { delete cache[k]; }, removeAll: ks => ks.forEach(k => delete cache[k]) }) },
    PropertiesService: { getScriptProperties: () => ({ getProperty: k => (k in props ? props[k] : null) }) },
    UrlFetchApp: { fetch(url) {
      llamadas.push(url);
      const u = new URL(url);
      let codigo = 200, cuerpo;
      try { cuerpo = u.pathname.endsWith('/oauth2/token') ? { access_token: 't', expires_in: 7200 } : api(u.pathname.replace('/v2', ''), u.searchParams); }
      catch (e) { if (!e.codigo) throw e; codigo = e.codigo; cuerpo = { message: e.message }; }
      return { getResponseCode: () => codigo, getContentText: () => JSON.stringify(cuerpo), getHeaders: () => ({}) };
    } },
    HtmlService: {}, SpreadsheetApp: { getActive() { throw new Error('el panel no debe tocar la hoja'); }, getActiveSpreadsheet() { throw new Error('el panel no debe tocar la hoja'); } },
    ScriptApp: {}, LockService: {},
  });
  // El archivo real que se pega en Apps Script.
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'dist', 'Codigo.gs'), 'utf8'), ctx, { filename: 'Codigo.gs' });
  const pedir = ruta => JSON.parse(vm.runInContext('apiPanel(' + JSON.stringify(ruta) + ')', ctx));
  return { pedir, llamadas };
}

// ---------- Help Scout simulado ----------
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
const nota = (f, a) => ({ id: hilo++, type: 'note', status: 'nochange', state: 'published', createdAt: f, createdBy: { id: a, type: 'user' } });
const estado = (f, a, st) => ({ id: hilo++, type: 'lineitem', status: st, state: 'published', createdAt: f, createdBy: { id: a, type: 'user' } });
const conv = (n, status, asignado, modificado, hilos, extra) => Object.assign({
  id: 1000 + n, number: n, subject: 'Caso ' + n, status, state: 'published', mailboxId: 7, createdAt: hilos[0].createdAt,
  assignee: asignado ? { id: asignado, type: 'user' } : undefined, primaryCustomer: { first: 'Cliente', last: String(n) },
  threads: hilos.filter(h => h.type !== 'note').length, _modificado: modificado, _embedded: { threads: hilos.slice().reverse() },
}, extra);

const REPORTES = { 1: { totalReplies: 12, resolved: 5, closed: 6, totalConversations: 9, customersHelped: 8, responseTime: 900, resolutionTime: 7200, handleTime: 200, happinessScore: 90, totalDays: 1 },
  3: { totalReplies: 20, resolved: 11, closed: 11, totalConversations: 15, customersHelped: 14, responseTime: 300, resolutionTime: 3600, handleTime: 150, happinessScore: 100, totalDays: 1 } };

function apiCon(convs, opciones) {
  const op = opciones || {};
  return (ruta, q) => {
    if (ruta === '/users') return { _embedded: { users: USUARIOS }, page: { totalPages: 1, totalElements: USUARIOS.length } };
    if (ruta === '/mailboxes') return { _embedded: { mailboxes: [{ id: 7, name: 'Soporte', email: 's@x.com' }] }, page: { totalPages: 1 } };
    if (ruta === '/conversations') {
      const st = q.get('status');
      let r = convs.filter(c => st === 'all' || c.status === st);
      if (q.get('assigned_to')) r = r.filter(c => c.assignee && String(c.assignee.id) === q.get('assigned_to'));
      if (q.get('query')) r = r.filter(c => !c.assignee);
      if (q.get('modifiedSince')) r = r.filter(c => c._modificado > q.get('modifiedSince'));
      const pagina = Number(q.get('page')), porPagina = 2; // páginas chicas para probar la paginación
      return { _embedded: { conversations: r.slice((pagina - 1) * porPagina, pagina * porPagina) }, page: { totalPages: Math.ceil(r.length / porPagina), totalElements: r.length } };
    }
    if (/^\/conversations\/\d+\/threads$/.test(ruta)) {
      const c = convs.find(x => String(x.id) === ruta.split('/')[2]);
      return { _embedded: { threads: c._todos || c._embedded.threads }, page: { totalPages: 1 } };
    }
    if (ruta.startsWith('/reports/')) {
      if (op.sinReportes) { const e = new Error('Forbidden'); e.codigo = 403; throw e; }
      (op.vistos = op.vistos || []).push({ ruta, start: q.get('start'), end: q.get('end'), user: q.get('user'), officeHours: q.get('officeHours'), viewBy: q.get('viewBy') });
      if (ruta === '/reports/user') return { current: REPORTES[q.get('user')] || {}, previous: {}, deltas: {} };
      if (ruta === '/reports/user/replies') return { current: [{ date: '2026-11-11T05:00:00Z', replies: 7 }, { date: '2026-11-12T05:00:00Z', replies: 12 }] };
      if (ruta === '/reports/user/resolutions') return { current: [{ date: '2026-11-12T05:00:00Z', resolved: 5 }] };
      if (ruta === '/reports/user/customers-helped') return { current: [{ date: '2026-11-11T05:00:00Z', customers: 4 }] };
      if (ruta === '/reports/user/conversation-history') {
        const pagina = Number(q.get('page'));
        return { page: pagina, pages: 5, count: 9, results: pagina > 5 ? [] : [{ id: 2000 + pagina, number: pagina, status: 'closed', customers: [{ id: 1, name: 'Ana' }], repliesSent: 2, firstResponseTime: 600, responseTime: 480, resolveTime: 7200, avgHandleTime: 120 }] };
      }
    }
    throw new Error('Ruta no simulada: ' + ruta);
  };
}

// Jueves 12 nov 2026. Miami va 5 h por detrás de UTC: las 00:00 de Miami son las 05:00 UTC.
const H = h => `2026-11-12T${h}Z`;
const AYER = h => `2026-11-11T${h}Z`;
function casosBase() {
  hilo = 1;
  return [
    conv(1, 'active', 1, H('15:00:00'), [cli(H('15:00:00')), asg(H('15:01:00'), 1)]),                                   // Jaideth: esperando desde las 10:00
    conv(2, 'pending', 1, H('15:30:00'), [cli(H('15:10:00')), asg(H('15:11:00'), 1), rsp(H('15:30:00'), 1, 'pending')]), // respondido: en seguimiento
    conv(3, 'pending', 1, AYER('19:00:00'), [cli(AYER('18:00:00')), cli(AYER('18:30:00')), asg(AYER('18:35:00'), 1), nota(AYER('18:40:00'), 1), estado(AYER('19:00:00'), 1, 'pending')]), // pasado a pending SIN responder
    conv(4, 'closed', 3, H('15:45:00'), [cli(H('14:30:00')), asg(H('14:31:00'), 3), rsp(H('15:00:00'), 3), rsp(H('15:45:00'), 3, 'closed')]),
    conv(5, 'active', 3, AYER('20:00:00'), [cli(AYER('19:00:00')), asg(AYER('19:01:00'), 3), rsp(AYER('20:00:00'), 3)]),
    conv(6, 'active', null, H('15:50:00'), [cli(H('15:50:00'))]),                                                        // sin asignar
    conv(7, 'active', 50, H('15:55:00'), [cli(H('15:55:00')), asg(H('15:56:00'), 50)]),                                  // otro departamento
  ];
}
const AGENTES = [{ id: 1, nombre: 'Jaideth Andocilla' }, { id: 2, nombre: 'Maryelin Rios' }, { id: 3, nombre: 'Edna Escudero' }, { id: 4, nombre: 'Andrés Rodríguez' }];
const EQUIPO = { 1: 1, 2: 1, 3: 1, 4: 1 };

/** Hace lo mismo que la página: carga completa → estado en memoria. */
function cargaCompleta(pedir) {
  const eq = pedir('/api/equipo');
  assert.equal(eq.ok, true, eq.error);
  const convs = {}, control = [];
  const guardar = lista => lista.forEach(c => { if (Logica.esRelevante(c, EQUIPO, true)) convs[c.id] = c; else delete convs[c.id]; });
  eq.agentes.filter(a => a.id).forEach(a => {
    const r = pedir('/api/abiertos?agente=' + a.id);
    assert.equal(r.ok, true, r.error);
    guardar(r.compactos);
    control.push(r.totales);
  });
  const cola = pedir('/api/abiertos?agente=sin');
  assert.equal(cola.ok, true, cola.error);
  guardar(cola.compactos);
  for (let pagina = 1; pagina;) {
    const r = pedir('/api/cambios?desde=' + encodeURIComponent(eq.inicioHoy) + '&pagina=' + pagina);
    assert.equal(r.ok, true, r.error);
    guardar(r.compactos);
    pagina = r.siguiente;
  }
  return { eq, convs, control, cursor: eq.ahora };
}
const panelDe = convs => Logica.armarPanel(Object.values(convs), AGENTES, { buzones: { 7: 'Soporte' }, mostrarSinAsignar: true });

// ---------- Lógica pura ----------

test('cliente esperando: desde el PRIMER mensaje sin contestar; una respuesta detiene el reloj', () => {
  hilo = 1;
  const hilos = [cli(H('13:00:00')), cli(H('13:10:00')), asg(H('13:11:00'), 1)];
  assert.equal(Logica.resumirConversacion(conv(1, 'active', 1, '', hilos), H('05:00:00')).w, '2026-11-12T13:00:00.000Z');
  hilos.push(rsp(H('13:30:00'), 1));
  assert.equal(Logica.resumirConversacion(conv(1, 'active', 1, '', hilos), H('05:00:00')).w, null);
  hilos.push(cli(H('14:00:00')));
  assert.equal(Logica.resumirConversacion(conv(1, 'active', 1, '', hilos), H('05:00:00')).w, '2026-11-12T14:00:00.000Z');
});

test('cliente esperando: notas, asignaciones, pasar a pending y borradores NO cuentan como respuesta', () => {
  hilo = 1;
  const borrador = Object.assign(rsp(H('13:20:00'), 1), { state: 'draft' });
  const c = Logica.resumirConversacion(conv(2, 'pending', 1, '', [cli(H('13:00:00')), asg(H('13:05:00'), 1), nota(H('13:10:00'), 1), borrador, estado(H('13:25:00'), 1, 'pending')]), H('05:00:00'));
  assert.equal(c.w, '2026-11-12T13:00:00.000Z');
  assert.deepEqual(c.mv.map(m => m[0]), ['C', 'A']); // ni la nota ni el borrador aparecen como respuesta
});

test('cliente esperando: cerrado, spam o borrado no espera; al reabrirse cuenta desde el mensaje nuevo', () => {
  hilo = 1;
  const hilos = [cli(AYER('13:00:00')), estado(AYER('14:00:00'), 1, 'closed')];
  assert.equal(Logica.resumirConversacion(conv(3, 'closed', 1, '', hilos), H('05:00:00')).w, null);
  hilos.push(cli(H('09:00:00')));
  assert.equal(Logica.resumirConversacion(conv(3, 'active', 1, '', hilos), H('05:00:00')).w, '2026-11-12T09:00:00.000Z');
  assert.equal(Logica.resumirConversacion(conv(3, 'spam', 1, '', hilos), H('05:00:00')).w, null);
  const borrada = Logica.resumirConversacion(conv(3, 'active', 1, '', hilos, { state: 'deleted' }), H('05:00:00'));
  assert.deepEqual([borrada.w, borrada.st], [null, 'deleted']);
});

test('cliente esperando: la respuesta de otro departamento también contesta al cliente; un caso iniciado por la agente no espera', () => {
  hilo = 1;
  assert.equal(Logica.resumirConversacion(conv(4, 'active', 1, '', [cli(H('13:00:00')), rsp(H('13:20:00'), 50)]), H('05:00:00')).w, null);
  assert.equal(Logica.resumirConversacion(conv(4, 'active', 1, '', [rsp(H('13:00:00'), 1)]), H('05:00:00')).w, null);
});

test('movimientos de hoy: solo desde el inicio del día local, con cierre y cambio de manos', () => {
  hilo = 1;
  const c = Logica.resumirConversacion(conv(5, 'closed', 2, '', [
    cli(AYER('20:00:00')), asg(AYER('20:05:00'), 1), rsp(AYER('20:30:00'), 1),       // ayer: fuera
    cli(H('13:00:00')), asg(H('13:05:00'), 2), rsp(H('13:20:00'), 2), estado(H('13:40:00'), 2, 'closed'),
  ]), H('05:00:00'));
  assert.deepEqual(c.mv, [['C', 0, '2026-11-12T13:00:00.000Z'], ['A', 2, '2026-11-12T13:05:00.000Z'], ['R', 2, '2026-11-12T13:20:00.000Z'], ['X', 2, '2026-11-12T13:40:00.000Z']]);
});

test('armarPanel: Esperando + Seguimiento = Abiertos = Active + Pending, y los totales son la suma', () => {
  const compactos = [
    { id: 1, n: 101, s: 'A', c: 'X', st: 'active', a: 1, mb: 7, w: '2026-11-12T13:30:00.000Z', mv: [] },
    { id: 2, n: 102, s: 'B', c: 'Y', st: 'pending', a: 1, mb: 7, w: '2026-11-12T13:10:00.000Z', mv: [] },
    { id: 3, n: 103, s: 'C', c: 'Z', st: 'pending', a: 1, mb: 7, w: null, mv: [['R', 1, '2026-11-12T14:00:00.000Z'], ['R', 1, '2026-11-12T14:02:00.000Z']] },
    { id: 4, n: 104, s: 'D', c: 'W', st: 'closed', a: 3, mb: 7, w: null, mv: [['R', 3, '2026-11-12T14:50:00.000Z'], ['X', 3, '2026-11-12T15:00:00.000Z']] },
    { id: 5, n: 105, s: 'E', c: 'V', st: 'active', a: null, mb: 7, w: '2026-11-12T15:30:00.000Z', mv: [['C', 0, '2026-11-12T15:30:00.000Z']] },
    { id: 6, n: 106, s: 'F', c: 'U', st: 'active', a: 50, mb: 7, w: '2026-11-12T12:00:00.000Z', mv: [['C', 0, '2026-11-12T12:00:00.000Z']] }, // otro depto
  ];
  const p = Logica.armarPanel(compactos, AGENTES.concat([{ id: null, nombre: 'Sin Cuenta' }]), { buzones: { 7: 'Soporte' } });
  const [ja, , ed, , sin] = p.agentes;
  assert.deepEqual(ja.esperando.map(t => t.numero), [102, 101]); // el que más espera primero
  assert.deepEqual([ja.seguimiento, ja.abiertos, ja.activos, ja.pendientes, ja.respuestasVistas], [1, 3, 1, 2, 2]);
  assert.equal(ja.ultimaRespuesta, '2026-11-12T14:02:00.000Z');
  p.agentes.forEach(a => {
    assert.equal(a.esperando.length + a.seguimiento, a.abiertos, a.nombre);
    assert.equal(a.activos + a.pendientes, a.abiertos, a.nombre);
    assert.equal(a.enSeguimiento.length, a.seguimiento, a.nombre);
  });
  assert.deepEqual([ed.abiertos, ed.respuestasVistas], [0, 1]);
  assert.equal(sin.vinculado, false);
  assert.deepEqual(p.sinAsignar.map(t => t.numero), [105]);
  assert.deepEqual(p.equipo, { esperando: 2, seguimiento: 1, abiertos: 3, activos: 1, pendientes: 2 });
  assert.equal(p.feed[0].tipo, 'CLIENTE');           // más reciente primero
  assert.equal(p.feed.length, 5);                    // 3 respuestas + 1 cierre + cliente del caso sin asignar; nada del otro depto
  assert.ok(p.feed.every((f, i) => i === 0 || p.feed[i - 1].fecha >= f.fecha));
  assert.match(p.sinAsignar[0].url, /secure\.helpscout\.net\/conversation\/5\/105/);
});

// ---------- Servidor de punta a punta ----------

test('servidor: carga completa, verificación contra Help Scout y cifras "en este momento"', () => {
  const ahora = { t: Date.parse(H('16:00:00')) };
  const { pedir } = crearEntorno(ahora, apiCon(casosBase()));
  const { eq, convs, control } = cargaCompleta(pedir);
  assert.deepEqual([eq.hoy, eq.inicioHoy, eq.enHorario, eq.config.tz], ['2026-11-12', '2026-11-12T05:00:00.000Z', true, TZ]);
  assert.deepEqual(eq.sinVincular, []);
  control.forEach(t => ['active', 'pending'].forEach(st => assert.equal(t[st].helpScout, t[st].leidos))); // se leyó todo, con paginación

  const p = panelDe(convs);
  const [ja, ma, ed, an] = p.agentes;
  assert.deepEqual(ja.esperando.map(t => t.numero), [3, 1]);                  // el de ayer primero
  assert.equal(ja.esperando[0].esperaDesde, '2026-11-11T18:00:00.000Z');      // primer mensaje sin contestar, aunque esté en pending
  assert.deepEqual([ja.seguimiento, ja.abiertos, ja.activos, ja.pendientes], [1, 3, 1, 2]);
  assert.equal(ja.ultimaRespuesta, '2026-11-12T15:30:00.000Z');
  assert.deepEqual([ed.esperando.length, ed.seguimiento, ed.abiertos, ed.respuestasVistas], [0, 1, 1, 2]);
  assert.deepEqual([ma.abiertos, an.abiertos], [0, 0]);
  assert.deepEqual(p.sinAsignar.map(t => [t.numero, t.buzon]), [[6, 'Soporte']]); // el #7 es de otro departamento
  assert.deepEqual(p.equipo, { esperando: 2, seguimiento: 2, abiertos: 4, activos: 2, pendientes: 2 });
  // Abiertos del panel = Active + Pending que informa Help Scout, agente por agente.
  p.agentes.forEach((a, i) => assert.equal(a.abiertos, control[i].active.helpScout + control[i].pending.helpScout, a.nombre));
});

test('servidor: actualización incremental (una consulta) y nueva carga completa', () => {
  const ahora = { t: Date.parse(H('16:00:00')) };
  const casos = casosBase();
  const { pedir, llamadas } = crearEntorno(ahora, apiCon(casos));
  const { convs, cursor } = cargaCompleta(pedir);

  // Jaideth responde el #1; entra un caso nuevo sin asignar; el #6 lo toma Maryelin.
  casos[0]._embedded.threads.unshift(rsp(H('16:00:20'), 1)); casos[0]._modificado = H('16:00:20'); casos[0].threads++;
  casos.push(conv(8, 'active', null, H('16:00:25'), [cli(H('16:00:25'))]));
  casos[5].assignee = { id: 2, type: 'user' };
  casos[5]._embedded.threads.unshift(asg(H('16:00:28'), 2)); casos[5]._modificado = H('16:00:28'); casos[5].threads++;

  ahora.t = Date.parse(H('16:00:30'));
  const antes = llamadas.length;
  const desde = new Date(Date.parse(cursor) - 120000).toISOString();
  let r = pedir('/api/cambios?desde=' + encodeURIComponent(desde) + '&pagina=1');
  assert.equal(r.ok, true, r.error);
  const todos = r.compactos.slice();
  while (r.siguiente) { r = pedir('/api/cambios?desde=' + encodeURIComponent(desde) + '&pagina=' + r.siguiente); todos.push(...r.compactos); }
  assert.ok(llamadas.slice(antes).every(u => u.includes('modifiedSince')), 'solo consultas de cambios');
  todos.forEach(c => { if (Logica.esRelevante(c, EQUIPO, true)) convs[c.id] = c; else delete convs[c.id]; });

  const p = panelDe(convs);
  const [ja, ma] = p.agentes;
  assert.deepEqual(ja.esperando.map(t => t.numero), [3]);                     // el #1 ya fue respondido
  assert.deepEqual([ja.seguimiento, ja.respuestasVistas, ja.ultimaRespuesta], [2, 2, '2026-11-12T16:00:20.000Z']);
  assert.deepEqual(ma.esperando.map(t => t.numero), [6]);
  assert.deepEqual(p.sinAsignar.map(t => t.numero), [8]);
  assert.deepEqual(p.feed[0], { fecha: '2026-11-12T16:00:28.000Z', tipo: 'ASIGNADO', agente: 'Maryelin Rios', numero: 6, asunto: 'Caso 6', url: 'https://secure.helpscout.net/conversation/1006/6' });

  // Una carga completa nueva da exactamente el mismo resultado que el estado actualizado por partes.
  const fresca = panelDe(cargaCompleta(pedir).convs);
  assert.deepEqual(JSON.parse(JSON.stringify(fresca)), JSON.parse(JSON.stringify(p)));
});

test('servidor: si el listado trae el historial incompleto, se pide completo', () => {
  const casos = casosBase();
  casos[1]._todos = casos[1]._embedded.threads;                 // el historial real del #2 (con la respuesta)
  casos[1]._embedded = { threads: casos[1]._todos.slice(1) };   // el listado lo trae sin el último hilo
  const { pedir } = crearEntorno({ t: Date.parse(H('16:00:00')) }, apiCon(casos));
  const r = pedir('/api/abiertos?agente=1');
  assert.equal(r.compactos.find(c => c.n === 2).w, null);       // se vio la respuesta: no está esperando
});

test('servidor: reportes oficiales — fechas del día local, cifras sin recálculo, series y conversaciones', () => {
  const op = {};
  const { pedir } = crearEntorno({ t: Date.parse(H('16:00:00')) }, apiCon(casosBase(), op));
  const r = pedir('/api/reporte?desde=2026-11-12&hasta=2026-11-12');
  assert.equal(r.ok, true, r.error);
  assert.equal(r.disponible, true);
  assert.deepEqual(op.vistos[0], { ruta: '/reports/user', start: '2026-11-12T05:00:00Z', end: '2026-11-13T04:59:59Z', user: '1', officeHours: null, viewBy: null });
  assert.deepEqual(r.filas.map(f => f.nombre), AGENTES.map(a => a.nombre));
  const ja = r.filas[0];
  Object.keys(REPORTES[1]).forEach(k => assert.equal(ja[k], REPORTES[1][k], k)); // tal cual los da Help Scout
  assert.equal(r.filas[1].totalReplies, null);                                   // sin dato ≠ 0

  op.vistos = [];
  const s = pedir('/api/reporte-dias?desde=2026-11-10&hasta=2026-11-12&agentes=1&oficina=1');
  assert.equal(s.ok, true, s.error);
  assert.deepEqual([s.vista, op.vistos[0].viewBy, op.vistos[0].officeHours, op.vistos.length], ['day', 'day', 'true', 3]);
  assert.deepEqual(s.filas, [
    { fecha: '2026-11-11', id: 1, nombre: 'Jaideth Andocilla', respuestas: 7, resueltos: 0, clientes: 4 },
    { fecha: '2026-11-12', id: 1, nombre: 'Jaideth Andocilla', respuestas: 12, resueltos: 5, clientes: 0 },
  ]);
  assert.equal(pedir('/api/reporte-dias?desde=2026-01-01&hasta=2026-11-12&agentes=1').vista, 'week');

  const c1 = pedir('/api/reporte-casos?desde=2026-11-01&hasta=2026-11-12&agente=3&pagina=1');
  assert.deepEqual([c1.filas.length, c1.siguiente, c1.total, c1.nombre], [4, 5, 9, 'Edna Escudero']);
  const c2 = pedir('/api/reporte-casos?desde=2026-11-01&hasta=2026-11-12&agente=3&pagina=5');
  assert.deepEqual([c2.filas.length, c2.siguiente], [1, null]);
  assert.deepEqual(c2.filas[0], { id: 2005, numero: 5, estado: 'closed', cliente: 'Ana', respuestas: 2, primeraRespuesta: 600, respuesta: 480, resolucion: 7200, gestion: 120, url: 'https://secure.helpscout.net/conversation/2005/5' });
});

test('servidor: sin acceso a reportes avisa con claridad; entradas inválidas devuelven error y no revientan', () => {
  const { pedir } = crearEntorno({ t: Date.parse(H('16:00:00')) }, apiCon(casosBase(), { sinReportes: true }));
  const r = pedir('/api/reporte?desde=2026-11-12&hasta=2026-11-12');
  assert.deepEqual([r.ok, r.disponible, r.filas.length], [true, false, 0]);
  assert.match(r.motivo, /Plus y Pro/);
  assert.match(pedir('/api/reporte?desde=2026-11-13&hasta=2026-11-12').error, /Rango/);
  assert.match(pedir('/api/reporte?desde=hoy&hasta=2026-11-12').error, /Rango/);
  assert.match(pedir('/api/abiertos?agente=50').error, /no reconocida/);       // usuario que no es del equipo
  assert.match(pedir('/api/cambios?desde=2020-01-01T00:00:00Z').error, /desde/);
  assert.match(pedir('/api/otra').error, /desconocida/);
});

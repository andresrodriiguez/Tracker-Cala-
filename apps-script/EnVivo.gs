/**
 * Panel en vivo — cálculo puro (sin servicios de Apps Script), se prueba con Node en tests/.
 *
 * Cada conversación de Help Scout se resume en un objeto pequeño ("compacto") con lo que el panel
 * necesita: si el cliente está esperando y desde cuándo, a quién está asignada y lo que pasó en el
 * día de jornada actual. Todo sale del HISTORIAL de mensajes (hilos) de la conversación, la misma
 * fuente que usa el tracker; no se usan campos de resumen de Help Scout sin documentar.
 */

const TIPOS_MENSAJE_ = ['message', 'chat', 'phone'];

function hilosPublicados_(conv) {
  return ((conv._embedded && conv._embedded.threads) || [])
    .filter(h => !h.state || h.state === 'published')
    .slice()
    .sort((a, b) => (new Date(a.createdAt) - new Date(b.createdAt)) || (a.id - b.id));
}

/**
 * ¿El cliente está esperando respuesta? Lo está si el caso sigue abierto (active o pending) y su
 * mensaje es el último: ninguna persona del equipo de Help Scout le ha contestado después.
 * Las notas internas y los cambios de estado o de asignación no cuentan como respuesta.
 * @return {{esperando: boolean, desde: string|null, mensajes: number}}
 *   desde = fecha ISO del PRIMER mensaje del cliente que sigue sin contestar
 */
function esperaDeConversacion(conv) {
  const abierta = (conv.status === 'active' || conv.status === 'pending') && (!conv.state || conv.state === 'published');
  let desde = null;
  let estado = null;
  let mensajes = 0;
  hilosPublicados_(conv).forEach(h => {
    const autor = h.createdBy || {};
    const esCliente = h.type === 'customer' || autor.type === 'customer';
    const previo = estado;
    if (h.status && h.status !== 'nochange') estado = h.status;
    if (esCliente) {
      mensajes++;
      if (!desde) desde = new Date(h.createdAt);
      return;
    }
    if (autor.type === 'user' && TIPOS_MENSAJE_.indexOf(h.type) >= 0) desde = null; // le respondieron
    if (estado === 'closed' && previo !== 'closed') desde = null;                   // se cerró el caso
  });
  return { esperando: abierta && !!desde, desde: abierta && desde ? desde.toISOString() : null, mensajes: mensajes };
}

/**
 * Conversación de la API v2 de Help Scout (con _embedded.threads) → compacto.
 * @param {Object} o  { dia(Date)→'yyyy-MM-dd', hoy, ctxEventos (con incluirRespuestas: true) }
 */
function resumirConversacion(conv, o) {
  const cliente = conv.primaryCustomer || {};
  const nombreCliente = [cliente.first, cliente.last].filter(Boolean).join(' ') || cliente.email || '';
  const asignado = conv.assignee && Number(conv.assignee.id) > 0 ? Number(conv.assignee.id) : null;
  const espera = esperaDeConversacion(conv);
  const borrada = !!conv.state && conv.state !== 'published';
  const c = {
    id: conv.id,
    n: conv.number,
    s: String(conv.subject || '(sin asunto)').slice(0, 140),
    c: String(nombreCliente).slice(0, 60),
    st: borrada ? 'deleted' : conv.status,
    a: asignado,
    mb: conv.mailboxId || null,
    w: espera.desde,
    ev: [], // actividad del equipo en el día de jornada: [tipo, agenteId, fechaIso, minutos]
    cm: [], // mensajes del cliente en el día de jornada: [fechaIso]
  };
  if (borrada || conv.status === 'spam') return c;

  derivarEventos(conv, o.ctxEventos).forEach(ev => {
    if (ev.dia === o.hoy) c.ev.push([ev.tipo, ev.agenteId, ev.fecha.toISOString(), ev.minutos]);
  });
  hilosPublicados_(conv).forEach(h => {
    const fecha = new Date(h.createdAt);
    if ((h.type === 'customer' || (h.createdBy || {}).type === 'customer') && o.dia(fecha) === o.hoy) {
      c.cm.push(fecha.toISOString());
    }
  });
  return c;
}

/** ¿Vale la pena guardar este compacto? (abierto y del equipo, sin asignar, o con actividad del equipo hoy) */
function compactoRelevante(c, esDelEquipo, mostrarSinAsignar) {
  const abierto = c.st === 'active' || c.st === 'pending';
  if (abierto && c.a && esDelEquipo(c.a)) return true;
  if (abierto && !c.a && mostrarSinAsignar) return true;
  return c.ev.length > 0;
}

function promedio_(v) {
  return v.length ? Math.round(v.reduce((s, x) => s + x, 0) / v.length * 10) / 10 : null;
}

function mediana_(v) {
  if (!v.length) return null;
  const o = v.slice().sort((a, b) => a - b);
  const m = Math.floor(o.length / 2);
  return Math.round((o.length % 2 ? o[m] : (o[m - 1] + o[m]) / 2) * 10) / 10;
}

/**
 * Junta los compactos y arma lo que muestra el panel.
 * @param {Object[]} compactos
 * @param {Object} o  { agentes: [{nombre, id}], nombreBuzon(id)?, mostrarSinAsignar, maxFeed }
 */
function armarPanelEnVivo(compactos, o) {
  const porId = {};
  o.agentes.forEach(a => { if (a.id) porId[a.id] = a; });
  const nombre = id => (porId[id] ? porId[id].nombre : '');
  const url = c => 'https://secure.helpscout.net/conversation/' + c.id + '/' + c.n;
  const ticket = c => ({
    id: c.id, numero: c.n, asunto: c.s, cliente: c.c, estado: c.st, esperaDesde: c.w,
    agenteId: c.a && porId[c.a] ? c.a : null, agente: nombre(c.a),
    buzon: o.nombreBuzon ? o.nombreBuzon(c.mb) : '', url: url(c),
  });
  const porEspera = (x, y) => String(x.esperaDesde || '9').localeCompare(String(y.esperaDesde || '9'));

  const hoy = {};
  o.agentes.forEach(a => {
    if (!a.id) return;
    hoy[a.id] = {
      respuestas: 0, casosRespondidos: new Set(), tiempos: [], primeras: [], ultimaRespuesta: null,
      ASIGNADO: new Set(), CERRADO: new Set(), REASIGNADO: new Set(), NUEVA_CONSULTA: new Set(),
    };
  });
  const feed = [];
  const abiertos = [];
  const sinAsignar = [];

  compactos.forEach(c => {
    const abierto = c.st === 'active' || c.st === 'pending';
    if (abierto && c.a && porId[c.a]) abiertos.push(ticket(c));
    if (abierto && !c.a && o.mostrarSinAsignar !== false && c.w) sinAsignar.push(ticket(c));

    c.ev.forEach(e => {
      const h = hoy[e[1]];
      if (!h) return;
      if (e[0] === 'PRIMERA_RESPUESTA') { if (e[3] != null) h.primeras.push(e[3]); return; }
      if (e[0] === 'RESPUESTA') {
        h.respuestas++;
        h.casosRespondidos.add(c.n);
        if (e[3] != null) h.tiempos.push(e[3]);
        if (!h.ultimaRespuesta || e[2] > h.ultimaRespuesta) h.ultimaRespuesta = e[2];
      } else if (h[e[0]]) {
        h[e[0]].add(c.n);
      }
      feed.push({ fecha: e[2], tipo: e[0], agente: nombre(e[1]), numero: c.n, asunto: c.s, minutos: e[3], url: url(c) });
    });
    c.cm.forEach(f => {
      feed.push({ fecha: f, tipo: 'CLIENTE', agente: c.a && porId[c.a] ? nombre(c.a) : '', numero: c.n, asunto: c.s, minutos: null, url: url(c) });
    });
  });

  const agentes = o.agentes.map(a => {
    const suyos = abiertos.filter(t => t.agenteId === a.id);
    const esperando = suyos.filter(t => t.esperaDesde).sort(porEspera);
    const h = hoy[a.id];
    return {
      nombre: a.nombre,
      id: a.id,
      vinculado: !!a.id,
      esperando: esperando,
      seguimiento: suyos.length - esperando.length,
      abiertos: suyos.length,
      activos: suyos.filter(t => t.estado === 'active').length,
      pendientes: suyos.filter(t => t.estado === 'pending').length,
      hoy: h ? {
        respuestas: h.respuestas,
        casosRespondidos: h.casosRespondidos.size,
        asignados: h.ASIGNADO.size,
        cerrados: h.CERRADO.size,
        reasignados: h.REASIGNADO.size,
        nuevasConsultas: h.NUEVA_CONSULTA.size,
        tiemposMedidos: h.tiempos.length,
        promedioRespuestaMin: promedio_(h.tiempos),
        medianaRespuestaMin: mediana_(h.tiempos),
        promedioPrimeraMin: promedio_(h.primeras),
        ultimaRespuesta: h.ultimaRespuesta,
      } : null,
    };
  });

  const vinculados = Object.keys(hoy).map(k => hoy[k]);
  const sumar = f => vinculados.reduce((s, h) => s + f(h), 0);
  const todos = k => vinculados.reduce((v, h) => v.concat(h[k]), []);
  return {
    agentes: agentes,
    sinAsignar: sinAsignar.sort(porEspera),
    equipo: {
      esperando: agentes.reduce((s, a) => s + a.esperando.length, 0),
      seguimiento: agentes.reduce((s, a) => s + a.seguimiento, 0),
      abiertos: agentes.reduce((s, a) => s + a.abiertos, 0),
      respuestas: sumar(h => h.respuestas),
      casosRespondidos: sumar(h => h.casosRespondidos.size),
      asignados: sumar(h => h.ASIGNADO.size),
      cerrados: sumar(h => h.CERRADO.size),
      reasignados: sumar(h => h.REASIGNADO.size),
      nuevasConsultas: sumar(h => h.NUEVA_CONSULTA.size),
      tiemposMedidos: todos('tiempos').length,
      promedioRespuestaMin: promedio_(todos('tiempos')),
      medianaRespuestaMin: mediana_(todos('tiempos')),
      promedioPrimeraMin: promedio_(todos('primeras')),
    },
    feed: feed.sort((x, y) => (x.fecha < y.fecha ? 1 : x.fecha > y.fecha ? -1 : 0)).slice(0, o.maxFeed || 40),
  };
}

/**
 * Detalle de una agente para auditar sus cifras: cada movimiento del día y sus casos abiertos.
 * Los totales de la tabla del panel salen exactamente de estas listas.
 */
function detalleAgenteEnVivo(compactos, agente) {
  const url = c => 'https://secure.helpscout.net/conversation/' + c.id + '/' + c.n;
  const movimientos = [];
  const abiertos = [];
  compactos.forEach(c => {
    if ((c.st === 'active' || c.st === 'pending') && c.a === agente.id) {
      abiertos.push({ numero: c.n, asunto: c.s, cliente: c.c, estado: c.st, esperaDesde: c.w, url: url(c) });
    }
    c.ev.forEach(e => {
      if (e[1] !== agente.id) return;
      movimientos.push({ fecha: e[2], tipo: e[0], numero: c.n, asunto: c.s, minutos: e[3], url: url(c) });
    });
  });
  return {
    agente: agente.nombre,
    movimientos: movimientos.sort((x, y) => (x.fecha < y.fecha ? 1 : -1)),
    abiertos: abiertos.sort((x, y) => String(x.esperaDesde || '9').localeCompare(String(y.esperaDesde || '9'))),
  };
}

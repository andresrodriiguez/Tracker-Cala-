/**
 * Panel en vivo — cálculo puro (sin servicios de Apps Script), se prueba con Node en tests/.
 *
 * Cada conversación de Help Scout se resume en un objeto pequeño ("compacto") con lo que el panel
 * necesita: si el cliente está esperando y desde cuándo, a quién está asignada y lo que pasó en el
 * día de jornada actual (respuestas de cada agente con su tiempo de respuesta, asignaciones,
 * cierres, re-asignaciones...). El panel se arma juntando todos los compactos.
 */

const TIPOS_MENSAJE_ = ['message', 'chat', 'phone'];

/** true si el cliente está esperando respuesta (su mensaje es el último). */
function clienteEsperando(conv) {
  if (conv.status === 'closed' || conv.status === 'spam') return false;
  const espera = conv.customerWaitingSince || {};
  const ultimo = espera.latestReplyFrom || conv.latestReplyFrom;
  if (ultimo) return ultimo === 'customer';
  return conv.status === 'active';
}

/**
 * Conversación de la API v2 de Help Scout → compacto.
 * Si la conversación trae sus hilos (_embedded.threads) se calcula también la actividad del día.
 * @param {Object} o  { agentePorId, dia(Date)→'yyyy-MM-dd', hoy, minutos(fin, inicio), ctxEventos }
 */
function resumirConversacion(conv, o) {
  const espera = conv.customerWaitingSince || {};
  const cliente = conv.primaryCustomer || {};
  const nombreCliente = [cliente.first, cliente.last].filter(Boolean).join(' ') ||
    [cliente.firstName, cliente.lastName].filter(Boolean).join(' ') || cliente.email || '';
  const asignado = conv.assignee && Number(conv.assignee.id) > 0 ? Number(conv.assignee.id) : null;
  const esperando = clienteEsperando(conv);
  const c = {
    id: conv.id,
    n: conv.number,
    s: String(conv.subject || '(sin asunto)').slice(0, 140),
    c: String(nombreCliente).slice(0, 60),
    st: conv.status,
    a: asignado,
    mb: conv.mailboxId || null,
    w: esperando ? (espera.time || conv.userUpdatedAt || conv.createdAt || null) : null,
    h: false, // trae la actividad del día (hilos)
    ev: [],   // [tipo, agenteId, fechaIso, minutos]
    r: [],    // respuestas de agentes del equipo hoy: [agenteId, fechaIso, minutosDeRespuesta|null]
    cm: [],   // mensajes del cliente hoy: [fechaIso]
  };

  const hilos = conv._embedded && conv._embedded.threads;
  if (!hilos) return c;
  c.h = true;

  derivarEventos(conv, o.ctxEventos).forEach(ev => {
    if (ev.dia === o.hoy) c.ev.push([ev.tipo, ev.agenteId, ev.fecha.toISOString(), ev.minutos]);
  });

  let clienteDesde = null;
  hilos
    .filter(t => !t.state || t.state === 'published')
    .slice()
    .sort((x, y) => (new Date(x.createdAt) - new Date(y.createdAt)) || (x.id - y.id))
    .forEach(t => {
      const autor = t.createdBy || {};
      const fecha = new Date(t.createdAt);
      const esHoy = o.dia(fecha) === o.hoy;
      if (t.type === 'customer' || autor.type === 'customer') {
        if (!clienteDesde) clienteDesde = fecha;
        if (esHoy) c.cm.push(fecha.toISOString());
        return;
      }
      if (autor.type !== 'user' || TIPOS_MENSAJE_.indexOf(t.type) < 0) return;
      const agente = o.agentePorId(Number(autor.id));
      if (agente && esHoy) {
        c.r.push([agente.id, fecha.toISOString(),
          clienteDesde ? Math.max(0, Math.round(o.minutos(fecha, clienteDesde) * 10) / 10) : null]);
      }
      clienteDesde = null;
    });
  return c;
}

/** Nuevo compacto sobre el anterior: si el nuevo no trae hilos, conserva la actividad del día ya calculada. */
function fusionarCompacto(previo, nuevo) {
  if (nuevo.h || !previo || !previo.h) return nuevo;
  return Object.assign({}, nuevo, { h: true, ev: previo.ev, r: previo.r, cm: previo.cm });
}

/** ¿Vale la pena guardar este compacto? (abierto y del equipo, sin asignar, o con actividad del equipo hoy) */
function compactoRelevante(c, esDelEquipo, mostrarSinAsignar) {
  const abierto = c.st === 'active' || c.st === 'pending';
  if (abierto && c.a && esDelEquipo(c.a)) return true;
  if (abierto && !c.a && mostrarSinAsignar && c.st === 'active') return true;
  return c.ev.length > 0 || c.r.length > 0;
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
      if (h[e[0]]) h[e[0]].add(c.n);
      const textos = {
        ASIGNADO: nombre(e[1]) + ' tomó el #' + c.n,
        CERRADO: nombre(e[1]) + ' cerró el #' + c.n,
        REASIGNADO: nombre(e[1]) + ' re-asignó el #' + c.n,
        NUEVA_CONSULTA: 'Nueva consulta en el #' + c.n + ' (' + nombre(e[1]) + ')',
      };
      if (textos[e[0]]) feed.push({ fecha: e[2], tipo: e[0], texto: textos[e[0]], url: url(c) });
    });
    c.r.forEach(r => {
      const h = hoy[r[0]];
      if (!h) return;
      h.respuestas++;
      h.casosRespondidos.add(c.n);
      if (r[2] != null) h.tiempos.push(r[2]);
      if (!h.ultimaRespuesta || r[1] > h.ultimaRespuesta) h.ultimaRespuesta = r[1];
      feed.push({ fecha: r[1], tipo: 'RESPUESTA', texto: nombre(r[0]) + ' respondió el #' + c.n, url: url(c) });
    });
    c.cm.forEach(f => {
      const quien = c.a && porId[c.a] ? ' (' + nombre(c.a) + ')' : c.a ? '' : ' · sin asignar';
      feed.push({ fecha: f, tipo: 'CLIENTE', texto: 'El cliente escribió en el #' + c.n + quien, url: url(c) });
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
      hoy: h ? {
        respuestas: h.respuestas,
        casosRespondidos: h.casosRespondidos.size,
        asignados: h.ASIGNADO.size,
        cerrados: h.CERRADO.size,
        reasignados: h.REASIGNADO.size,
        nuevasConsultas: h.NUEVA_CONSULTA.size,
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
      respuestas: sumar(h => h.respuestas),
      casosRespondidos: sumar(h => h.casosRespondidos.size),
      asignados: sumar(h => h.ASIGNADO.size),
      cerrados: sumar(h => h.CERRADO.size),
      reasignados: sumar(h => h.REASIGNADO.size),
      nuevasConsultas: sumar(h => h.NUEVA_CONSULTA.size),
      promedioRespuestaMin: promedio_(todos('tiempos')),
      medianaRespuestaMin: mediana_(todos('tiempos')),
      promedioPrimeraMin: promedio_(todos('primeras')),
    },
    feed: feed.sort((x, y) => (x.fecha < y.fecha ? 1 : x.fecha > y.fecha ? -1 : 0)).slice(0, o.maxFeed || 40),
  };
}

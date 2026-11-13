/**
 * PANEL EN VIVO — servidor (Apps Script).
 *
 * Es independiente del tracker: no lee ni escribe ninguna hoja y no usa sus reglas de conteo.
 *  - Lo que pasa "en este momento" (casos abiertos, cliente esperando, relojes, actividad) se lee
 *    directo de las conversaciones de Help Scout.
 *  - Las cifras del día y las exportaciones son las de los REPORTES OFICIALES de Help Scout
 *    (los mismos números de su sección Reports), sin recálculo. Requieren plan Plus o Pro.
 * Del tracker solo comparte: las credenciales guardadas, CONFIG.AGENTES y CONFIG.HORARIO_LABORAL.
 *
 * La página (Panel.html) guarda el estado en el navegador y llama a apiPanel(ruta) cada pocos segundos.
 */
const PANEL = {
  // Cada cuántos segundos la página consulta Help Scout (dentro y fuera de la jornada).
  SEGUNDOS_ACTUALIZACION: 5,
  SEGUNDOS_FUERA_DE_HORARIO: 60,
  // Cada cuántos segundos se refrescan los reportes oficiales del día.
  SEGUNDOS_REPORTES: 60,
  // Cada cuántos minutos se relee todo y se compara con los totales que informa Help Scout.
  MINUTOS_RECARGA_COMPLETA: 5,
  // Reloj de espera de cada cliente: amarillo a la mitad de la meta, rojo al llegar.
  META_RESPUESTA_MIN: 60,
  // Estado de la agente si tiene clientes esperando y no responde: amarillo / rojo (minutos).
  ALERTA_SIN_RESPONDER_MIN: [10, 30],
  // true: los tiempos de los reportes cuentan solo el horario de oficina configurado EN Help Scout
  // (Manage → Company → Office Hours). Si no está activado allá, Help Scout ignora la opción.
  REPORTES_EN_HORARIO_DE_OFICINA: false,
  // Mostrar la cola de casos activos sin asignar (de CONFIG.MAILBOXES_EQUIPO, o de todos los buzones si está vacío).
  MOSTRAR_SIN_ASIGNAR: true,
};

// Campos del reporte de usuario (GET /v2/reports/user → "current"), tal cual los entrega Help Scout.
const CAMPOS_REPORTE_ = ['totalDays', 'totalConversations', 'conversationsCreated', 'customersHelped', 'totalReplies', 'repliesPerDay',
  'conversationsPerDay', 'resolved', 'resolvedOnFirstReply', 'percentResolvedOnFirstReply', 'repliesToResolve', 'closed',
  'responseTime', 'resolutionTime', 'handleTime', 'happinessScore', 'busiestDay'];

function doGet() {
  return paginaPanel_()
    .setTitle('Soporte · Control en vivo')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

function paginaPanel_() {
  // En dist/Codigo.gs la página va incluida como texto (PANEL_HTML); con clasp se usa el archivo Panel.html.
  return typeof PANEL_HTML !== 'undefined'
    ? HtmlService.createHtmlOutput(PANEL_HTML)
    : HtmlService.createHtmlOutputFromFile('Panel');
}

/**
 * Única función que llama la página. `ruta` es como '/api/cambios?desde=2026-11-12T15:00:00Z'.
 * @return {string} JSON: { ok: true, ahora, ... } o { ok: false, error }
 */
function apiPanel(ruta) {
  try {
    const partes = String(ruta).split('?');
    const q = {};
    (partes[1] || '').split('&').forEach(par => {
      if (!par) return;
      const i = par.indexOf('=');
      q[decodeURIComponent(i < 0 ? par : par.slice(0, i))] = i < 0 ? '' : decodeURIComponent(par.slice(i + 1));
    });
    const rutas = {
      '/api/equipo': panelEquipo_, '/api/abiertos': panelAbiertos_, '/api/cambios': panelCambios_,
      '/api/reporte': panelReporte_, '/api/reporte-dias': panelReporteDias_, '/api/reporte-casos': panelReporteCasos_,
    };
    const manejador = rutas[partes[0]];
    if (!manejador) throw new Error('Ruta desconocida: ' + partes[0]);
    const datos = manejador(q);
    datos.ok = true;
    datos.ahora = new Date().toISOString();
    return JSON.stringify(datos);
  } catch (e) {
    console.error(e);
    return JSON.stringify({ ok: false, error: String((e && e.message) || e) });
  }
}

// ---------- Fechas ----------
function panelTz_() { return Session.getScriptTimeZone(); }
/** Instante en que el reloj local marca 'yyyy-MM-dd' + 'HH:mm:ss'. */
function panelInstante_(dia, hora) { return Utilities.parseDate(dia + ' ' + hora, panelTz_(), 'yyyy-MM-dd HH:mm:ss'); }
function panelHoy_(fecha) { return Utilities.formatDate(fecha || new Date(), panelTz_(), 'yyyy-MM-dd'); }
function panelInicioHoy_() { return panelInstante_(panelHoy_(), '00:00:00'); }
function panelEnHorario_(fecha) {
  const H = CONFIG.HORARIO_LABORAL;
  const local = relojLocal_(fecha, panelTz_()); // campos UTC = hora local
  const hora = local.getUTCHours() + local.getUTCMinutes() / 60;
  return H.dias.indexOf(local.getUTCDay()) >= 0 && hora >= H.inicio && hora < H.fin;
}
function panelEsDia_(v) { return /^\d{4}-\d{2}-\d{2}$/.test(String(v)) && !isNaN(Date.parse(v + 'T00:00:00Z')); }

// ---------- Help Scout ----------
function panelBuzones_() { return CONFIG.MAILBOXES_EQUIPO.length ? CONFIG.MAILBOXES_EQUIPO.join(',') : undefined; }

/**
 * Recorre las páginas de un listado desde `desdePagina`, como máximo `maxPaginas`.
 * @return {{items: Object[], total: number|null, completo: boolean, siguiente: number|null}}
 *   total = el que informa Help Scout (para verificar que se leyó todo)
 */
function panelListar_(ruta, params, clave, maxPaginas, desdePagina) {
  const items = [];
  let total = null;
  const primera = desdePagina || 1;
  for (let pagina = primera; ; pagina++) {
    const d = hsGet_(ruta, Object.assign({}, params, { page: pagina }));
    const trozo = (d._embedded && d._embedded[clave]) || [];
    Array.prototype.push.apply(items, trozo);
    if (d.page && typeof d.page.totalElements === 'number') total = d.page.totalElements;
    const paginas = d.page ? d.page.totalPages : 1;
    const fin = !trozo.length || pagina >= paginas;
    if (fin || (maxPaginas && pagina - primera + 1 >= maxPaginas)) {
      return { items: items, total: total, completo: fin, siguiente: fin ? null : pagina + 1 };
    }
  }
}

/** Conversaciones → compactos. Si el listado no trajo todos los hilos de una conversación, los pide aparte. */
function panelCompactar_(convs, desdeHoy) {
  return convs.map(conv => {
    conv._embedded = conv._embedded || {};
    const hilos = conv._embedded.threads;
    const sinNotas = Array.isArray(hilos) ? hilos.filter(h => h.type !== 'note').length : -1;
    if (sinNotas < 0 || (typeof conv.threads === 'number' && conv.threads > sinNotas)) {
      conv._embedded.threads = hsHilos_(conv.id);
    }
    return Logica.resumirConversacion(conv, desdeHoy);
  });
}

// ---------- Rutas: en este momento ----------
function panelEquipo_() {
  CacheService.getScriptCache().remove('HS_USUARIOS');
  const equipo = resolverEquipo_();
  const buzones = {};
  try {
    hsMailboxes_().forEach(m => { buzones[m.id] = m.nombre; });
  } catch (e) { /* los nombres de buzón son solo informativos */ }
  const ahora = new Date();
  return {
    agentes: equipo.agentes,
    sinVincular: equipo.sinEncontrar,
    buzones: buzones,
    hoy: panelHoy_(ahora),
    inicioHoy: panelInicioHoy_().toISOString(),
    enHorario: panelEnHorario_(ahora),
    config: {
      tz: panelTz_(), horario: CONFIG.HORARIO_LABORAL,
      segundos: PANEL.SEGUNDOS_ACTUALIZACION, segundosFueraDeHorario: PANEL.SEGUNDOS_FUERA_DE_HORARIO,
      segundosReportes: PANEL.SEGUNDOS_REPORTES, minutosRecarga: PANEL.MINUTOS_RECARGA_COMPLETA,
      metaRespuestaMin: PANEL.META_RESPUESTA_MIN, alertaSinResponderMin: PANEL.ALERTA_SIN_RESPONDER_MIN,
      horarioDeOficina: PANEL.REPORTES_EN_HORARIO_DE_OFICINA, mostrarSinAsignar: PANEL.MOSTRAR_SIN_ASIGNAR,
    },
  };
}

/** Casos abiertos (Active + Pending) de una agente con su historial, o la cola sin asignar (agente=sin). */
function panelAbiertos_(q) {
  const desdeHoy = panelInicioHoy_();
  const mailbox = panelBuzones_();
  if (q.agente === 'sin') {
    const base = { status: 'active', mailbox: mailbox, embed: 'threads' };
    let r;
    try { // el filtro de búsqueda evita leer los casos ya asignados
      r = panelListar_('/conversations', Object.assign({ query: '(assigned:"Unassigned")' }, base), 'conversations', 6);
    } catch (e) {
      r = panelListar_('/conversations', base, 'conversations', 6);
    }
    const sinDueno = r.items.filter(c => !(c.assignee && Number(c.assignee.id) > 0));
    return { compactos: panelCompactar_(sinDueno, desdeHoy), completo: r.completo };
  }
  const agente = resolverEquipo_().porId[Number(q.agente)];
  if (!agente) throw new Error('Agente no reconocida.');
  const totales = {};
  let convs = [];
  ['active', 'pending'].forEach(estado => {
    const r = panelListar_('/conversations', { status: estado, assigned_to: agente.id, mailbox: mailbox, embed: 'threads' }, 'conversations');
    totales[estado] = { helpScout: r.total, leidos: r.items.length };
    convs = convs.concat(r.items);
  });
  return { agente: agente.id, compactos: panelCompactar_(convs, desdeHoy), totales: totales };
}

/** Conversaciones modificadas desde `desde` (ISO), con su historial. La página lo llama cada pocos segundos. */
function panelCambios_(q) {
  const inicio = new Date();
  const desde = new Date(q.desde || '');
  if (isNaN(desde.getTime()) || inicio - desde > 3 * 86400000 || desde > inicio) throw new Error('Parámetro "desde" no válido.');
  const r = panelListar_('/conversations', {
    status: 'all', modifiedSince: hsFechaIso_(desde), sortField: 'modifiedAt', sortOrder: 'asc', embed: 'threads', mailbox: panelBuzones_(),
  }, 'conversations', 3, Math.max(1, Number(q.pagina) || 1));
  return { compactos: panelCompactar_(r.items, panelInicioHoy_()), siguiente: r.siguiente, total: r.total, cursor: inicio.toISOString() };
}

// ---------- Rutas: reportes oficiales de Help Scout ----------
function panelRango_(q) {
  if (!panelEsDia_(q.desde) || !panelEsDia_(q.hasta) || q.desde > q.hasta) throw new Error('Rango de fechas no válido.');
  const dias = Math.round((Date.parse(q.hasta) - Date.parse(q.desde)) / 86400000) + 1;
  return {
    desde: q.desde, hasta: q.hasta, dias: dias,
    start: hsFechaIso_(panelInstante_(q.desde, '00:00:00')),
    end: hsFechaIso_(panelInstante_(q.hasta, '23:59:59')),
    // Help Scout: por día hasta 60 días, por semana hasta 1 año, por mes desde 61 días.
    vista: dias <= 60 ? 'day' : dias <= 365 ? 'week' : 'month',
  };
}

function panelParamsReporte_(r, usuario, q) {
  const oficina = 'oficina' in q ? q.oficina === '1' : PANEL.REPORTES_EN_HORARIO_DE_OFICINA;
  return { user: usuario, start: r.start, end: r.end, mailboxes: panelBuzones_(), officeHours: oficina ? 'true' : undefined };
}

function panelAgentesPedidos_(q) {
  const ids = String(q.agentes || '').split(',').map(Number).filter(Boolean);
  const lista = resolverEquipo_().agentes.filter(a => a.id && (!ids.length || ids.indexOf(a.id) >= 0));
  if (!lista.length) throw new Error('No hay agentes vinculadas con Help Scout para este reporte.');
  return lista;
}

/** Si Help Scout rechaza los reportes por plan o permisos, devuelve un aviso entendible; si no, null. */
function panelSinReportes_(e) {
  const m = String((e && e.message) || '').match(/Error de Help Scout (\d{3})/);
  if (!m || ['401', '402', '403', '404'].indexOf(m[1]) < 0) return null;
  return 'Help Scout no permitió consultar los reportes (código ' + m[1] + '). La API de reportes solo está incluida en los planes Plus y Pro, ' +
    'y la app debe pertenecer a un usuario con acceso a Reports.';
}

/** Resumen por agente del periodo (GET /v2/reports/user). */
function panelReporte_(q) {
  const r = panelRango_(q);
  const agentes = panelAgentesPedidos_(q);
  try {
    const filas = agentes.map(a => {
      const actual = hsGet_('/reports/user', panelParamsReporte_(r, a.id, q)).current || {};
      const fila = { id: a.id, nombre: a.nombre };
      CAMPOS_REPORTE_.forEach(c => { fila[c] = actual[c] == null ? null : actual[c]; });
      return fila;
    });
    return { disponible: true, rango: r, filas: filas };
  } catch (e) {
    const aviso = panelSinReportes_(e);
    if (!aviso) throw e;
    return { disponible: false, motivo: aviso, rango: r, filas: [] };
  }
}

/** Series por día / semana / mes: respuestas, resueltos y clientes ayudados de cada agente. */
function panelReporteDias_(q) {
  const r = panelRango_(q);
  const filas = [];
  panelAgentesPedidos_(q).forEach(a => {
    const p = Object.assign(panelParamsReporte_(r, a.id, q), { viewBy: r.vista });
    const porFecha = {};
    const poner = (ruta, campo, origen) => (hsGet_(ruta, p).current || []).forEach(x => {
      const k = String(x.date || x.start || '').slice(0, 10);
      if (!k) return;
      porFecha[k] = porFecha[k] || { fecha: k, id: a.id, nombre: a.nombre, respuestas: 0, resueltos: 0, clientes: 0 };
      porFecha[k][campo] = x[origen] == null ? 0 : x[origen];
    });
    poner('/reports/user/replies', 'respuestas', 'replies');
    poner('/reports/user/resolutions', 'resueltos', 'resolved');
    poner('/reports/user/customers-helped', 'clientes', 'customers');
    Object.keys(porFecha).sort().forEach(k => filas.push(porFecha[k]));
  });
  return { rango: r, vista: r.vista, filas: filas };
}

/** Conversaciones del periodo de una agente, con sus tiempos (GET /v2/reports/user/conversation-history). */
function panelReporteCasos_(q) {
  const r = panelRango_(q);
  const agente = resolverEquipo_().porId[Number(q.agente)];
  if (!agente) throw new Error('Agente no reconocida.');
  const primera = Math.max(1, Number(q.pagina) || 1);
  const filas = [];
  let total = null, siguiente = null;
  for (let pagina = primera; pagina < primera + 4; pagina++) {
    const d = hsGet_('/reports/user/conversation-history',
      Object.assign(panelParamsReporte_(r, agente.id, q), { page: pagina, sortField: 'number', sortOrder: 'ASC' }));
    const resultados = d.results || [];
    if (d.count != null) total = d.count;
    resultados.forEach(x => filas.push({
      id: x.id, numero: x.number, estado: x.status || '',
      cliente: (x.customers || []).map(c => c.name).filter(Boolean).join(', '),
      respuestas: x.repliesSent == null ? null : x.repliesSent,
      primeraRespuesta: x.firstResponseTime == null ? null : x.firstResponseTime,
      respuesta: x.responseTime == null ? null : x.responseTime,
      resolucion: x.resolveTime == null ? null : x.resolveTime,
      gestion: x.avgHandleTime == null ? null : x.avgHandleTime,
      url: 'https://secure.helpscout.net/conversation/' + x.id + '/' + x.number,
    }));
    if (pagina >= (d.pages || 1) || !resultados.length) { siguiente = null; break; }
    siguiente = pagina + 1;
  }
  return { rango: r, agente: agente.id, nombre: agente.nombre, filas: filas, total: total, siguiente: siguiente };
}

// ---------- Menú de la hoja ----------
/** Muestra el enlace de la página y permite abrirla dentro de la hoja. */
function menuPanelEnVivo() {
  let url = '';
  try { url = ScriptApp.getService().getUrl(); } catch (e) { url = ''; }
  const html = '<div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.5">' + (url
    ? '<p><b>Enlace del panel:</b> <a href="' + url + '" target="_blank">abrir en una pestaña nueva</a>. Guárdalo en favoritos: es siempre el mismo.</p>' +
      '<p style="color:#555">Si cambiaste el código: <b>Implementar → Gestionar implementaciones → editar → Versión: Nueva versión</b>.</p>'
    : '<p><b>El enlace todavía no existe.</b> En <b>Extensiones → Apps Script</b>: <b>Implementar → Nueva implementación → Aplicación web</b>, ' +
      'ejecutar como <b>Yo</b>, acceso <b>Solo yo</b>.</p>') +
    '<p><button onclick="google.script.run.withSuccessHandler(google.script.host.close).abrirPanelAqui()" ' +
    'style="padding:8px 14px;font-size:14px;cursor:pointer">Abrir aquí, dentro de la hoja</button></p></div>';
  SpreadsheetApp.getUi().showModalDialog(HtmlService.createHtmlOutput(html).setWidth(480).setHeight(230), 'Panel en vivo');
}

function abrirPanelAqui() {
  SpreadsheetApp.getUi().showModelessDialog(paginaPanel_().setWidth(1500).setHeight(900), 'Soporte · Control en vivo');
}

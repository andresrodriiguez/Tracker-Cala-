/**
 * Panel en vivo (página web aparte) — se publica como "Aplicación web" desde el editor de Apps Script.
 *
 * Cómo se mantiene al día sin pasarse de los límites de Help Scout ni de Google:
 *  - Recarga completa (al abrir, cada CONFIG.PANEL.MINUTOS_RECARGA_COMPLETA y al cambiar de día):
 *    casos abiertos de cada agente, cola sin asignar y todo lo movido en el día de jornada.
 *  - Entre recargas, cada CONFIG.PANEL.SEGUNDOS_ACTUALIZACION: UNA consulta con los casos que
 *    cambiaron desde la anterior (normalmente 1 llamada a la API).
 *  - El estado se guarda en la caché del script, así que varias pestañas abiertas comparten datos.
 *  - Los relojes (cuánto lleva esperando cada cliente) corren cada segundo en el navegador.
 */
const CLAVE_ESTADO_PANEL_ = 'PANEL_ESTADO';
const CLAVE_RESPUESTA_PANEL_ = 'PANEL_RESPUESTA';
const CLAVE_OCUPADO_PANEL_ = 'PANEL_OCUPADO';

function doGet() {
  return paginaPanel_()
    .setTitle('Centro de control · Soporte en vivo')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

function paginaPanel_() {
  // En dist/Codigo.gs el HTML va incluido como texto (PANEL_HTML); con clasp se usa el archivo Panel.html.
  return typeof PANEL_HTML !== 'undefined'
    ? HtmlService.createHtmlOutput(PANEL_HTML)
    : HtmlService.createHtmlOutputFromFile('Panel');
}

/** Lo llama la página cada pocos segundos. Devuelve JSON (texto). */
function datosPanelEnVivo() {
  const cache = CacheService.getScriptCache();
  const reciente = cache.get(CLAVE_RESPUESTA_PANEL_);
  if (reciente) return reciente;
  // Si otra pestaña ya está consultando Help Scout, se devuelve lo último que hay.
  if (cache.get(CLAVE_OCUPADO_PANEL_)) {
    const ultimo = cache.get(CLAVE_RESPUESTA_PANEL_ + '_ULTIMA');
    if (ultimo) return ultimo;
  }
  try {
    cache.put(CLAVE_OCUPADO_PANEL_, '1', 90);
    const respuesta = JSON.stringify(calcularRespuestaPanel_());
    const cfg = CONFIG.PANEL;
    if (respuesta.length < 45000) { // límite de 100 KB por clave en la caché
      cache.put(CLAVE_RESPUESTA_PANEL_, respuesta, Math.max(1, cfg.SEGUNDOS_ACTUALIZACION - 1));
      cache.put(CLAVE_RESPUESTA_PANEL_ + '_ULTIMA', respuesta, 600);
    }
    return respuesta;
  } catch (e) {
    console.error(e);
    return JSON.stringify({ ok: false, error: String(e && e.message || e), ahora: new Date().toISOString() });
  } finally {
    cache.remove(CLAVE_OCUPADO_PANEL_);
  }
}

function calcularRespuestaPanel_() {
  const cfg = CONFIG.PANEL;
  const k = contextoPanel_();
  let estado = leerCacheGrande_(CLAVE_ESTADO_PANEL_);
  const vencido = !estado || estado.v !== 2 || estado.dia !== k.hoy ||
    Date.now() - new Date(estado.base).getTime() > cfg.MINUTOS_RECARGA_COMPLETA * 60000;
  if (vencido) estado = recargaCompletaPanel_(k);
  else actualizarPanel_(estado, k);
  guardarCacheGrande_(CLAVE_ESTADO_PANEL_, estado, 3600);

  const buzones = buzonesPorId_();
  const panel = armarPanelEnVivo(Object.keys(estado.convs).map(id => estado.convs[id]), {
    agentes: k.equipo.agentes,
    nombreBuzon: id => buzones[id] || '',
    mostrarSinAsignar: cfg.MOSTRAR_SIN_ASIGNAR,
    maxFeed: 40,
  });
  const H = CONFIG.HORARIO_LABORAL;
  const local = relojLocal_(k.ahora, k.tz);
  const horaLocal = local.getUTCHours() + local.getUTCMinutes() / 60;
  return {
    ok: true,
    ahora: k.ahora.toISOString(),
    hoy: k.hoy,
    tz: k.tz,
    enHorario: H.dias.indexOf(local.getUTCDay()) >= 0 && horaLocal >= H.inicio && horaLocal < H.fin,
    horario: H,
    segundos: cfg.SEGUNDOS_ACTUALIZACION,
    segundosFueraDeHorario: cfg.SEGUNDOS_FUERA_DE_HORARIO,
    metaRespuestaMin: cfg.META_RESPUESTA_MIN,
    alertaSinResponderMin: cfg.ALERTA_SIN_RESPONDER_MIN,
    ultimaRecargaCompleta: estado.base,
    verificacion: estado.verificacion,
    agentes: k.equipo.agentes.map(a => a.nombre),
    fechaInicio: CONFIG.FECHA_INICIO,
    metaResolucionHoras: CONFIG.META_RESOLUCION_HORAS,
    sinVincular: k.equipo.sinEncontrar,
    panel: panel,
  };
}

function contextoPanel_() {
  const tz = Session.getScriptTimeZone();
  const H = CONFIG.HORARIO_LABORAL;
  const ahora = new Date();
  const hoy = diaDeJornada(relojLocal_(ahora, tz), H);
  const equipo = resolverEquipo_();
  const dia = fecha => diaDeJornada(relojLocal_(fecha, tz), H);
  const agentePorId = id => equipo.porId[id] || null;
  const minutos = (fin, inicio) => minutosGestion(relojLocal_(inicio, tz), relojLocal_(fin, tz), H);
  return {
    tz: tz,
    ahora: ahora,
    hoy: hoy,
    equipo: equipo,
    mailbox: CONFIG.MAILBOXES_EQUIPO.length ? CONFIG.MAILBOXES_EQUIPO.join(',') : undefined,
    o: {
      dia: dia,
      hoy: hoy,
      ctxEventos: {
        incluirRespuestas: true,
        agentePorId: agentePorId,
        dia: dia,
        mailboxesEquipo: CONFIG.MAILBOXES_EQUIPO,
        tagsReasignacion: CONFIG.TAGS_REASIGNACION,
        transferenciaInternaEsReasignacion: CONFIG.TRANSFERENCIA_INTERNA_ES_REASIGNACION,
        fechaInicio: CONFIG.FECHA_INICIO,
        minutos: minutos,
      },
    },
  };
}

/** Guarda (o descarta) una conversación en el estado del panel. Siempre llega con sus hilos. */
function guardarEnPanel_(convs, conv, k) {
  const c = resumirConversacion(completarHilos_(conv), k.o);
  if (compactoRelevante(c, id => !!k.equipo.porId[id], CONFIG.PANEL.MOSTRAR_SIN_ASIGNAR)) convs[c.id] = c;
  else delete convs[c.id];
}

/** Si el listado no trajo todos los hilos de la conversación, los pide aparte. */
function completarHilos_(conv) {
  conv._embedded = conv._embedded || {};
  const hilos = conv._embedded.threads;
  if (!hilos || (typeof conv.threads === 'number' && conv.threads > hilos.length)) {
    conv._embedded.threads = hsHilos_(conv.id);
  }
  return conv;
}

function recargaCompletaPanel_(k) {
  const cfg = CONFIG.PANEL;
  const inicio = new Date();
  const convs = {};
  const control = []; // lo que dice Help Scout vs. lo que se leyó, para verificar
  // 1) Casos abiertos de cada agente (con su historial, para saber si el cliente está esperando).
  k.equipo.agentes.filter(a => a.id).forEach(a => ['active', 'pending'].forEach(estado => {
    const r = hsListarConTotal_('/conversations',
      { status: estado, assigned_to: a.id, mailbox: k.mailbox, embed: 'threads' }, 'conversations');
    r.items.forEach(conv => guardarEnPanel_(convs, conv, k));
    control.push({ agente: a.nombre, estado: estado, helpScout: r.total, leidos: r.items.length });
  }));
  // 2) Cola sin asignar.
  let colaCompleta = true;
  if (cfg.MOSTRAR_SIN_ASIGNAR) {
    const base = { status: 'active', mailbox: k.mailbox, embed: 'threads' };
    let r;
    try { // el filtro de búsqueda evita leer los casos ya asignados
      r = hsListarConTotal_('/conversations', Object.assign({ query: '(assigned:"Unassigned")' }, base),
        'conversations', cfg.MAX_PAGINAS_SIN_ASIGNAR);
    } catch (e) {
      r = hsListarConTotal_('/conversations', base, 'conversations', cfg.MAX_PAGINAS_SIN_ASIGNAR);
    }
    r.items
      .filter(conv => !(conv.assignee && Number(conv.assignee.id) > 0))
      .forEach(conv => guardarEnPanel_(convs, conv, k));
    colaCompleta = r.completo;
  }
  // 3) Todo lo que se movió en el día de jornada.
  const desde = Utilities.parseDate(inicioVentanaJornada(k.hoy, CONFIG.HORARIO_LABORAL), k.tz, 'yyyy-MM-dd HH:mm:ss');
  const dia = hsListarConTotal_('/conversations', {
    status: 'all', modifiedSince: hsFechaIso_(desde), sortField: 'modifiedAt', sortOrder: 'desc', embed: 'threads', mailbox: k.mailbox,
  }, 'conversations', cfg.MAX_PAGINAS_DIA);
  dia.items.forEach(conv => guardarEnPanel_(convs, conv, k));

  const descuadres = control.filter(c => c.helpScout != null && c.helpScout !== c.leidos);
  return {
    v: 2, dia: k.hoy, base: inicio.toISOString(), cursor: inicio.toISOString(), convs: convs,
    verificacion: {
      hora: inicio.toISOString(),
      ok: !descuadres.length && dia.completo && colaCompleta,
      casosAbiertos: control.reduce((s, c) => s + c.leidos, 0),
      casosDelDia: dia.items.length,
      avisos: descuadres.map(c => c.agente + ' (' + c.estado + '): Help Scout informa ' + c.helpScout + ' y se leyeron ' + c.leidos)
        .concat(dia.completo ? [] : ['Hoy hay más movimientos de los que se leyeron: sube CONFIG.PANEL.MAX_PAGINAS_DIA.'])
        .concat(colaCompleta ? [] : ['La cola sin asignar tiene más casos de los que se muestran: sube MAX_PAGINAS_SIN_ASIGNAR.']),
    },
  };
}

function actualizarPanel_(estado, k) {
  const inicio = new Date();
  // 2 minutos de solape: cada conversación se recalcula entera, así que repetirla no duplica nada.
  const desde = new Date(new Date(estado.cursor).getTime() - 120000);
  hsListarTodo_('/conversations', {
    status: 'all', modifiedSince: hsFechaIso_(desde), sortField: 'modifiedAt', sortOrder: 'desc', embed: 'threads', mailbox: k.mailbox,
  }, 'conversations', 10).forEach(conv => guardarEnPanel_(estado.convs, conv, k));
  estado.cursor = inicio.toISOString();
}

function buzonesPorId_() {
  const cache = CacheService.getScriptCache();
  const guardado = cache.get('HS_BUZONES');
  if (guardado) return JSON.parse(guardado);
  const mapa = {};
  try {
    hsMailboxes_().forEach(m => { mapa[m.id] = m.nombre; });
  } catch (e) {
    console.warn('No se pudieron leer los buzones: ' + e);
  }
  cache.put('HS_BUZONES', JSON.stringify(mapa), 21600);
  return mapa;
}

/** CacheService guarda máx. 100 KB por clave: el estado se parte en trozos. */
function guardarCacheGrande_(clave, obj, segundos) {
  const texto = JSON.stringify(obj);
  const TROZO = 40000; // caracteres (con tildes pueden ser más bytes)
  const valores = {};
  let n = 0;
  for (let i = 0; i < texto.length; i += TROZO) valores[clave + '_' + (n++)] = texto.slice(i, i + TROZO);
  valores[clave + '_n'] = String(n);
  CacheService.getScriptCache().putAll(valores, segundos);
}

function leerCacheGrande_(clave) {
  const cache = CacheService.getScriptCache();
  const n = Number(cache.get(clave + '_n'));
  if (!n) return null;
  const claves = [];
  for (let i = 0; i < n; i++) claves.push(clave + '_' + i);
  const trozos = cache.getAll(claves);
  if (claves.some(c => trozos[c] == null)) return null;
  try {
    return JSON.parse(claves.map(c => trozos[c]).join(''));
  } catch (e) {
    return null;
  }
}

/** Lo llama la página: movimientos de hoy y casos abiertos de una agente (para auditar sus cifras). */
function detalleAgentePanel(agenteId) {
  try {
    const estado = leerCacheGrande_(CLAVE_ESTADO_PANEL_);
    if (!estado) throw new Error('Todavía no hay datos cargados. Espera la siguiente actualización.');
    const agente = resolverEquipo_().porId[Number(agenteId)];
    if (!agente) throw new Error('Agente no encontrada.');
    const d = detalleAgenteEnVivo(Object.keys(estado.convs).map(id => estado.convs[id]), agente);
    d.ok = true;
    d.hoy = estado.dia;
    return JSON.stringify(d);
  } catch (e) {
    return JSON.stringify({ ok: false, error: String(e && e.message || e) });
  }
}

/**
 * Lo llama la página: reporte por agente y por día entre dos fechas, a partir de HS_Eventos.
 * @param {{desde: string, hasta: string, agentes: string[], tipos: string[]}} filtros
 */
function reporteMetricas(filtros) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    if (!ss) {
      throw new Error('La página no pudo abrir la hoja del tracker. Abre el panel desde la hoja: ' +
        'menú Help Scout → Panel en vivo → "Abrir aquí".');
    }
    const fecha = v => (/^\d{4}-\d{2}-\d{2}$/.test(String(v)) ? String(v) : null);
    const desde = fecha(filtros && filtros.desde);
    const hasta = fecha(filtros && filtros.hasta);
    if (!desde || !hasta || desde > hasta) throw new Error('Rango de fechas no válido.');
    const equipo = CONFIG.AGENTES.map(a => a.nombre);
    const pedidos = (filtros.agentes || []).map(normalizarTexto);
    const agentes = pedidos.length ? equipo.filter(n => pedidos.indexOf(normalizarTexto(n)) >= 0) : equipo;
    if (!agentes.length) throw new Error('Elige al menos una agente.');

    const tz = ss.getSpreadsheetTimeZone();
    const reporte = calcularReporte(leerEventosCompletos_(ss), leerFotos_(ss), {
      desde: desde < CONFIG.FECHA_INICIO ? CONFIG.FECHA_INICIO : desde,
      hasta: hasta,
      agentes: agentes,
      tipos: filtros.tipos || [],
      metaRespuestaMin: CONFIG.PANEL.META_RESPUESTA_MIN,
      metaResolucionHoras: CONFIG.META_RESOLUCION_HORAS,
      semaforo: CONFIG.SEMAFORO,
    });
    const props = PropertiesService.getScriptProperties();
    const ultima = props.getProperty('HS_ULTIMA_SYNC');
    const pendiente = JSON.parse(props.getProperty('HS_ESTADO_SYNC') || 'null');
    reporte.ok = true;
    reporte.generado = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd HH:mm');
    reporte.ultimaSincronizacion = ultima ? Utilities.formatDate(new Date(ultima), tz, 'yyyy-MM-dd HH:mm') : null;
    reporte.sincronizacionIncompleta = !!(pendiente && pendiente.pagina > 1);
    reporte.fechaInicio = CONFIG.FECHA_INICIO;
    reporte.config = {
      horario: CONFIG.HORARIO_LABORAL, metaRespuestaMin: CONFIG.PANEL.META_RESPUESTA_MIN,
      metaResolucionHoras: CONFIG.META_RESOLUCION_HORAS, semaforo: CONFIG.SEMAFORO, zonaHoraria: tz,
    };
    return JSON.stringify(reporte);
  } catch (e) {
    console.error(e);
    return JSON.stringify({ ok: false, error: String(e && e.message || e) });
  }
}

/** Todas las columnas de HS_Eventos, con la fecha como texto en la zona horaria de la hoja. */
function leerEventosCompletos_(ss) {
  const hoja = ss.getSheetByName(CONFIG.HOJAS.eventos);
  if (!hoja) return [];
  const tz = ss.getSpreadsheetTimeZone();
  const formatear = f => Utilities.formatDate(f, tz, 'yyyy-MM-dd');
  return leerFilas_(hoja).map(f => ({
    dia: diaDesdeCelda(f[1], formatear),
    fecha: f[2] instanceof Date ? Utilities.formatDate(f[2], tz, 'yyyy-MM-dd HH:mm:ss') : String(f[2] || ''),
    tipo: String(f[3]), agente: String(f[4]), numero: Number(f[6]), asunto: String(f[7] || ''),
    minutos: f[8] === '' || f[8] == null ? null : Number(f[8]), enlace: String(f[10] || ''),
  }));
}

/** Menú: abre el panel dentro de la hoja y muestra el enlace de la página aparte. */
function menuPanelEnVivo() {
  let url = '';
  try { url = ScriptApp.getService().getUrl(); } catch (e) { url = ''; }
  const estilo = 'font-family:Arial,sans-serif;font-size:14px;line-height:1.5';
  const html = '<div style="' + estilo + '">' + (url
    ? '<p><b>Página aparte:</b> <a href="' + url + '" target="_blank">abrir el panel en una pestaña nueva</a> (guárdala en favoritos).</p>' +
      '<p style="color:#555">Si cambiaste el código: <b>Implementar → Gestionar implementaciones → editar → Versión: Nueva versión</b>.</p>'
    : '<p><b>Página aparte:</b> todavía no está publicada. En <b>Extensiones → Apps Script</b>: <b>Implementar → Nueva implementación → Aplicación web</b>, ' +
      'ejecutar como <b>Yo</b>, acceso <b>Solo yo</b>.</p>') +
    '<p><button onclick="google.script.run.withSuccessHandler(google.script.host.close).abrirPanelAqui()" ' +
    'style="padding:8px 14px;font-size:14px;cursor:pointer">Abrir aquí, dentro de la hoja</button></p></div>';
  SpreadsheetApp.getUi().showModalDialog(HtmlService.createHtmlOutput(html).setWidth(480).setHeight(230), 'Panel en vivo');
}

function abrirPanelAqui() {
  SpreadsheetApp.getUi().showModelessDialog(paginaPanel_().setWidth(1500).setHeight(900), 'Panel en vivo · Soporte');
}

/**
 * Menú: compara el panel con Help Scout y deja el resultado en la hoja HS_VerificacionPanel,
 * con la lista de casos que el panel considera "esperando respuesta" para revisarlos uno por uno.
 */
function menuVerificarPanel() {
  const ss = SpreadsheetApp.getActive();
  const k = contextoPanel_();
  const estado = recargaCompletaPanel_(k);
  const compactos = Object.keys(estado.convs).map(id => estado.convs[id]);
  const panel = armarPanelEnVivo(compactos, { agentes: k.equipo.agentes, mostrarSinAsignar: CONFIG.PANEL.MOSTRAR_SIN_ASIGNAR, maxFeed: 1 });
  const total = (agenteId, estadoHs) => hsGet_('/conversations', { status: estadoHs, assigned_to: agenteId, mailbox: k.mailbox }).page.totalElements;

  const filas = [['VERIFICACIÓN DEL PANEL EN VIVO', Utilities.formatDate(new Date(), k.tz, 'dd/MM/yyyy HH:mm:ss'), '', '', '', '', '', '', ''],
    ['Agente', 'Active en Help Scout', 'Pending en Help Scout', 'Abiertos en Help Scout', 'Abiertos en el panel', '¿Coincide?',
      'Cliente esperando (panel)', 'En seguimiento (panel)', 'Respuestas hoy (panel)']];
  panel.agentes.filter(a => a.vinculado).forEach(a => {
    const act = total(a.id, 'active');
    const pen = total(a.id, 'pending');
    filas.push([a.nombre, act, pen, act + pen, a.abiertos, act + pen === a.abiertos ? 'SÍ' : 'NO — avisar',
      a.esperando.length, a.seguimiento, a.hoy.respuestas]);
  });
  filas.push(['', '', '', '', '', '', '', '', '']);
  filas.push(['CASOS CON EL CLIENTE ESPERANDO (ábrelos en Help Scout: el último mensaje debe ser del cliente)', '', '', '', '', '', '', '', '']);
  filas.push(['Agente', '# Caso', 'Estado', 'Cliente espera desde', 'Asunto', 'Enlace', '', '', '']);
  panel.agentes.forEach(a => a.esperando.forEach(t => filas.push([a.nombre, t.numero, t.estado,
    Utilities.formatDate(new Date(t.esperaDesde), k.tz, 'dd/MM/yyyy HH:mm:ss'), t.asunto, t.url, '', '', ''])));
  panel.sinAsignar.forEach(t => filas.push(['(sin asignar)', t.numero, t.estado,
    Utilities.formatDate(new Date(t.esperaDesde), k.tz, 'dd/MM/yyyy HH:mm:ss'), t.asunto, t.url, '', '', '']));

  // Quién escribe los mensajes de hoy: sirve para detectar respuestas automáticas (workflows).
  const desde = Utilities.parseDate(inicioVentanaJornada(k.hoy, CONFIG.HORARIO_LABORAL), k.tz, 'yyyy-MM-dd HH:mm:ss');
  const origen = {};
  hsListarTodo_('/conversations', { status: 'all', modifiedSince: hsFechaIso_(desde), embed: 'threads', mailbox: k.mailbox },
    'conversations', CONFIG.PANEL.MAX_PAGINAS_DIA).forEach(conv => ((conv._embedded && conv._embedded.threads) || []).forEach(h => {
    if (k.o.dia(new Date(h.createdAt)) !== k.hoy || ['message', 'chat', 'phone', 'customer'].indexOf(h.type) < 0) return;
    const clave = [h.type, (h.createdBy || {}).type || '', (h.source || {}).type || '', (h.source || {}).via || '',
      (h.action || {}).type || '', h.savedReplyId ? 'con respuesta guardada' : ''].join(' | ');
    origen[clave] = (origen[clave] || 0) + 1;
  }));
  filas.push(['', '', '', '', '', '', '', '', '']);
  filas.push(['MENSAJES DE HOY POR ORIGEN (tipo | autor | fuente | vía | acción | respuesta guardada)', 'Cantidad', '', '', '', '', '', '', '']);
  Object.keys(origen).sort().forEach(c => filas.push([c, origen[c], '', '', '', '', '', '', '']));

  let hoja = ss.getSheetByName('HS_VerificacionPanel');
  if (!hoja) hoja = ss.insertSheet('HS_VerificacionPanel', ss.getNumSheets());
  hoja.clear();
  hoja.getRange(1, 1, filas.length, 9).setValues(filas);
  hoja.getRange(1, 1, 2, 9).setFontWeight('bold');
  ss.setActiveSheet(hoja);
  const mal = filas.filter(f => String(f[5]).indexOf('NO') === 0).length;
  SpreadsheetApp.getUi().alert(mal
    ? '⚠️ Hay ' + mal + ' agente(s) cuyo total no coincide con Help Scout. Revisa la hoja HS_VerificacionPanel.'
    : '✅ Los casos abiertos del panel coinciden con Help Scout para todas las agentes.\n' +
      'En la hoja HS_VerificacionPanel está la lista de casos "esperando" para revisarlos uno por uno.');
}

/** Menú: vuelve a leer Help Scout desde FECHA_INICIO y agrega a HS_Eventos lo que falte (sin borrar nada). */
function menuCompletarHistorial() {
  const ui = SpreadsheetApp.getUi();
  const r = ui.alert('Completar historial',
    'Se volverá a leer Help Scout desde ' + CONFIG.FECHA_INICIO + ' para agregar a HS_Eventos cada respuesta de las agentes ' +
    '(necesario para exportar respuestas y tiempos de respuesta de días pasados). No se borra nada.\n' +
    'Tarda varias sincronizaciones (15–60 min). ¿Continuar?', ui.ButtonSet.YES_NO);
  if (r !== ui.Button.YES) return;
  const tz = SpreadsheetApp.getActive().getSpreadsheetTimeZone();
  PropertiesService.getScriptProperties().setProperty('HS_ESTADO_SYNC', JSON.stringify({
    desde: hsFechaIso_(Utilities.parseDate(CONFIG.FECHA_INICIO, tz, 'yyyy-MM-dd')), pagina: 1,
  }));
  ui.alert('Listo. La sincronización automática irá completando el historial. Revisa "Help Scout → Ver estado".');
}

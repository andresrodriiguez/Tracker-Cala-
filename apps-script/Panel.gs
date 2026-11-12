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
  const vencido = !estado || estado.v !== 1 || estado.dia !== k.hoy ||
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
      agentePorId: agentePorId,
      dia: dia,
      hoy: hoy,
      minutos: minutos,
      ctxEventos: {
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

/** Guarda (o descarta) una conversación en el estado del panel. */
function guardarEnPanel_(convs, conv, k) {
  const c = fusionarCompacto(convs[conv.id], resumirConversacion(conv, k.o));
  if (compactoRelevante(c, id => !!k.equipo.porId[id], CONFIG.PANEL.MOSTRAR_SIN_ASIGNAR)) convs[c.id] = c;
  else delete convs[c.id];
}

function recargaCompletaPanel_(k) {
  const cfg = CONFIG.PANEL;
  const inicio = new Date();
  const convs = {};
  // 1) Casos abiertos de cada agente.
  k.equipo.agentes.filter(a => a.id).forEach(a => ['active', 'pending'].forEach(estado =>
    hsListarTodo_('/conversations', { status: estado, assigned_to: a.id, mailbox: k.mailbox }, 'conversations')
      .forEach(conv => guardarEnPanel_(convs, conv, k))));
  // 2) Cola sin asignar.
  if (cfg.MOSTRAR_SIN_ASIGNAR) {
    hsListarTodo_('/conversations', { status: 'active', mailbox: k.mailbox }, 'conversations', cfg.MAX_PAGINAS_SIN_ASIGNAR)
      .filter(conv => !(conv.assignee && Number(conv.assignee.id) > 0))
      .forEach(conv => guardarEnPanel_(convs, conv, k));
  }
  // 3) Todo lo que se movió en el día de jornada (con su historial).
  const desde = Utilities.parseDate(inicioVentanaJornada(k.hoy, CONFIG.HORARIO_LABORAL), k.tz, 'yyyy-MM-dd HH:mm:ss');
  conversacionesConHilos_(hsFechaIso_(desde), k.mailbox, cfg.MAX_PAGINAS_DIA)
    .forEach(conv => guardarEnPanel_(convs, conv, k));
  return { v: 1, dia: k.hoy, base: inicio.toISOString(), cursor: inicio.toISOString(), convs: convs };
}

function actualizarPanel_(estado, k) {
  const inicio = new Date();
  // 1 minuto de solape: cada conversación se recalcula entera, así que repetirla no duplica nada.
  const desde = new Date(new Date(estado.cursor).getTime() - 60000);
  conversacionesConHilos_(hsFechaIso_(desde), k.mailbox, 10)
    .forEach(conv => guardarEnPanel_(estado.convs, conv, k));
  estado.cursor = inicio.toISOString();
}

/** Conversaciones modificadas desde `desde`, con todos sus hilos. */
function conversacionesConHilos_(desde, mailbox, maxPaginas) {
  const convs = hsListarTodo_('/conversations', {
    status: 'all', modifiedSince: desde, sortField: 'modifiedAt', sortOrder: 'desc', embed: 'threads', mailbox: mailbox,
  }, 'conversations', maxPaginas);
  convs.forEach(conv => {
    conv._embedded = conv._embedded || {};
    const hilos = conv._embedded.threads || [];
    if (typeof conv.threads === 'number' && conv.threads > hilos.length) conv._embedded.threads = hsHilos_(conv.id);
  });
  return convs;
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

/** Menú: muestra el enlace del panel (o cómo publicarlo). */
function menuPanelEnVivo() {
  let url = '';
  try { url = ScriptApp.getService().getUrl(); } catch (e) { url = ''; }
  const html = url
    ? '<div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.5">' +
      '<p>Tu panel en vivo está en:</p><p><a href="' + url + '" target="_blank" style="font-weight:bold">Abrir panel en vivo ↗</a></p>' +
      '<p style="color:#555">Guárdalo en favoritos. Si cambiaste el código, ve a <b>Implementar → Gestionar implementaciones → ✏️ → Versión: nueva</b> para que el panel use la versión nueva.</p></div>'
    : '<div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.5">' +
      '<p>El panel todavía no está publicado. En <b>Extensiones → Apps Script</b>:</p>' +
      '<ol><li><b>Implementar → Nueva implementación</b></li><li>Tipo: <b>Aplicación web</b></li>' +
      '<li>Ejecutar como: <b>Yo</b> · Quién tiene acceso: <b>Solo yo</b></li><li><b>Implementar</b> y copia la URL.</li></ol></div>';
  SpreadsheetApp.getUi().showModalDialog(HtmlService.createHtmlOutput(html).setWidth(460).setHeight(260), 'Panel en vivo');
}

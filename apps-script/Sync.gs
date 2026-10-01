/**
 * Sincronización Help Scout → tracker. La ejecuta el activador cada N minutos.
 */
const LIMITE_EJECUCION_MS = 4.5 * 60 * 1000; // Apps Script corta a los 6 min
const COLUMNAS_EVENTOS = ['ID', 'Día', 'Fecha y hora', 'Tipo', 'Agente', 'ID agente HS',
  '# Conversación', 'Asunto', 'Minutos', 'Horas', 'Enlace'];

/** @return {boolean} false si no corrió porque ya había otra sincronización en curso */
function sincronizar() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) return false; // ya hay otra sincronización corriendo
  try {
    sincronizar_();
    return true;
  } finally {
    lock.releaseLock();
  }
}

function sincronizar_() {
  const inicio = Date.now();
  const ss = SpreadsheetApp.getActive();
  const tz = ss.getSpreadsheetTimeZone();
  // Cada evento cuenta para su día de jornada: lo que pasa de noche o en domingo va al siguiente día laboral.
  const dia = fecha => diaDeJornada(relojLocal_(fecha, tz), CONFIG.HORARIO_LABORAL);
  const diaCalendario = fecha => Utilities.formatDate(fecha, tz, 'yyyy-MM-dd');
  const equipo = resolverEquipo_();
  const props = PropertiesService.getScriptProperties();

  // Punto de partida: última sincronización completa (o FECHA_INICIO la primera vez).
  let estado = JSON.parse(props.getProperty('HS_ESTADO_SYNC') || 'null') || {
    desde: hsFechaIso_(Utilities.parseDate(CONFIG.FECHA_INICIO, tz, 'yyyy-MM-dd')),
    pagina: 1,
  };
  if (estado.pagina === 1) estado.inicioCorrida = hsFechaIso_(new Date());

  const ctx = {
    agentePorId: id => equipo.porId[id] || null,
    dia: dia,
    mailboxesEquipo: CONFIG.MAILBOXES_EQUIPO,
    tagsReasignacion: CONFIG.TAGS_REASIGNACION,
    transferenciaInternaEsReasignacion: CONFIG.TRANSFERENCIA_INTERNA_ES_REASIGNACION,
    fechaInicio: CONFIG.FECHA_INICIO,
    minutos: (fin, inicio) => minutosGestion(relojLocal_(inicio, tz), relojLocal_(fin, tz), CONFIG.HORARIO_LABORAL),
  };

  const hojaEventos = hojaInterna_(ss, CONFIG.HOJAS.eventos, COLUMNAS_EVENTOS);
  const ids = new Set(leerFilas_(hojaEventos).map(f => String(f[0])));
  const nuevos = [];
  let pagina = estado.pagina;
  let terminado = false;

  while (Date.now() - inicio < LIMITE_EJECUCION_MS) {
    const data = hsGet_('/conversations', {
      status: 'all', modifiedSince: estado.desde, sortField: 'modifiedAt', sortOrder: 'asc',
      embed: 'threads', page: pagina,
    });
    const convs = (data._embedded && data._embedded.conversations) || [];
    convs.forEach(conv => {
      conv._embedded = conv._embedded || {};
      const hilos = conv._embedded.threads || [];
      if (typeof conv.threads === 'number' && conv.threads > hilos.length) {
        conv._embedded.threads = hsHilos_(conv.id);
      }
      derivarEventos(conv, ctx).forEach(ev => {
        if (diaCalendario(ev.fecha) < CONFIG.FECHA_INICIO || ids.has(ev.id)) return;
        ids.add(ev.id);
        nuevos.push(ev);
      });
    });
    const totalPaginas = data.page ? data.page.totalPages : 1;
    if (!convs.length || pagina >= totalPaginas) { terminado = true; break; }
    pagina++;
  }

  guardarEventos_(hojaEventos, nuevos);
  if (terminado) {
    // 5 min de solape: los eventos repetidos se descartan por ID.
    estado = { desde: hsFechaIso_(new Date(new Date(estado.inicioCorrida).getTime() - 5 * 60000)), pagina: 1 };
  } else {
    estado.pagina = pagina; // continúa en la próxima ejecución
  }
  props.setProperty('HS_ESTADO_SYNC', JSON.stringify(estado));

  const diasTocados = new Set(nuevos.map(e => e.dia));
  // La foto se toma solo con la lectura completa, para descontar bien lo que ya cuenta hoy.
  const foto = terminado ? tomarFotoInicioJornada_(ss, equipo, false) : null;
  if (foto) diasTocados.add(foto);

  if (diasTocados.size) {
    actualizarTracker_(ss, Array.from(diasTocados).sort(), equipo);
    actualizarResumen_(ss);
  }
  props.setProperty('HS_ULTIMA_SYNC', new Date().toISOString());
  console.log('Sincronización: ' + nuevos.length + ' eventos nuevos, días actualizados: ' +
    Array.from(diasTocados).join(', ') + (terminado ? '' : ' (continúa en la próxima ejecución)'));
}

/**
 * Relaciona CONFIG.AGENTES con los usuarios de Help Scout (por id, email o nombre completo).
 * @return {{agentes: Object[], porId: Object<number, {id, nombre}>, sinEncontrar: string[]}}
 */
function resolverEquipo_() {
  const usuarios = hsUsuarios_();
  const porId = {};
  const sinEncontrar = [];
  const agentes = CONFIG.AGENTES.map(a => {
    const u = usuarios.find(x =>
      (a.id && Number(a.id) === Number(x.id)) ||
      (a.email && normalizarTexto(a.email) === normalizarTexto(x.email)) ||
      (!a.email && !a.id && normalizarTexto(a.nombre) === normalizarTexto(x.nombre + ' ' + x.apellido)));
    const agente = { nombre: a.nombre, id: u ? Number(u.id) : null };
    if (u) porId[agente.id] = agente;
    else sinEncontrar.push(a.nombre);
    return agente;
  });
  if (sinEncontrar.length) {
    console.warn('No se encontraron en Help Scout: ' + sinEncontrar.join(', ') +
      '. Revisa CONFIG.AGENTES (email) y la hoja HS_Usuarios.');
  }
  return { agentes: agentes, porId: porId, sinEncontrar: sinEncontrar };
}

/**
 * Guarda cuántos casos "sin atender" tiene cada agente al iniciar la jornada (una vez al día).
 * @return {string|null} el día de la foto si se tomó ahora
 */
function tomarFotoInicioJornada_(ss, equipo, forzar) {
  const tz = ss.getSpreadsheetTimeZone();
  const ahora = new Date();
  const hoy = Utilities.formatDate(ahora, tz, 'yyyy-MM-dd');
  const hora = Number(Utilities.formatDate(ahora, tz, 'H'));
  const props = PropertiesService.getScriptProperties();
  const esLaboral = CONFIG.HORARIO_LABORAL.dias.indexOf(Number(Utilities.formatDate(ahora, tz, 'u')) % 7) >= 0;
  if (hoy < CONFIG.FECHA_INICIO) return null;
  if (!forzar && (!esLaboral || props.getProperty('HS_FOTO_DIA') === hoy || hora < CONFIG.HORARIO_LABORAL.inicio)) return null;

  // Los casos que ya cuentan hoy como "asignados" o "nueva consulta" (p. ej. asignados anoche)
  // no se cuentan otra vez como "sin atender".
  const eventos = leerEventos_(ss);
  const eventosHoy = eventos.filter(e => e.dia === hoy);
  const clave = (agente, numero) => normalizarTexto(agente) + '|' + numero;
  // Solo cuentan casos que entraron a la carga de la agente desde FECHA_INICIO (el arrastre de
  // antes de la automatización no es confiable).
  const enCarga = new Set(eventos
    .filter(e => e.tipo === 'ASIGNADO' || e.tipo === 'NUEVA_CONSULTA')
    .map(e => clave(e.agente, e.numero)));
  const yaContados = new Set(eventosHoy
    .filter(e => e.tipo === 'ASIGNADO' || e.tipo === 'NUEVA_CONSULTA')
    .map(e => clave(e.agente, e.numero)));
  const mailbox = CONFIG.MAILBOXES_EQUIPO.length ? CONFIG.MAILBOXES_EQUIPO.join(',') : undefined;
  const filas = equipo.agentes.filter(a => a.id).map(a => {
    const pendientes = new Set();
    CONFIG.ESTADOS_SIN_ATENDER.forEach(estado =>
      hsListarTodo_('/conversations', { status: estado, assigned_to: a.id, mailbox: mailbox }, 'conversations')
        .forEach(c => {
          const k = clave(a.nombre, c.number);
          if (enCarga.has(k) && !yaContados.has(k)) pendientes.add(c.number);
        }));
    // Casos pasados a pending sin responder al cliente: siguen sin atender.
    const pendingSinResponder = [];
    if (CONFIG.CONTAR_PENDING_SIN_RESPONDER && CONFIG.ESTADOS_SIN_ATENDER.indexOf('pending') < 0) {
      hsListarTodo_('/conversations', { status: 'pending', assigned_to: a.id, mailbox: mailbox, embed: 'threads' }, 'conversations')
        .forEach(c => {
          const k = clave(a.nombre, c.number);
          if (!enCarga.has(k) || yaContados.has(k) || pendientes.has(c.number)) return;
          let hilos = (c._embedded && c._embedded.threads) || [];
          if (typeof c.threads === 'number' && c.threads > hilos.length) hilos = hsHilos_(c.id);
          if (ultimoMensajeEsDelCliente(hilos)) {
            pendientes.add(c.number);
            pendingSinResponder.push(c.number);
          }
        });
    }
    // Casos de días anteriores que la agente ya cerró hoy antes de la foto (madrugada o anoche):
    // también eran trabajo pendiente al iniciar la jornada.
    eventosHoy
      .filter(e => e.tipo === 'CERRADO' && normalizarTexto(e.agente) === normalizarTexto(a.nombre) &&
        enCarga.has(clave(e.agente, e.numero)) && !yaContados.has(clave(e.agente, e.numero)))
      .forEach(e => pendientes.add(e.numero));
    const casos = Array.from(pendientes).sort((x, y) => x - y).map(n => '#' + n).join(', ');
    const estacionados = pendingSinResponder.sort((x, y) => x - y).map(n => '#' + n).join(', ');
    return [hoy, a.nombre, a.id, pendientes.size, ahora, casos, estacionados];
  });
  const encabezado = ['Día', 'Agente', 'ID agente HS', 'Sin atender', 'Tomada', 'Casos contados',
    'De ellos, en Pending sin responder'];
  const hoja = hojaInterna_(ss, CONFIG.HOJAS.fotos, encabezado);
  hoja.getRange(1, 1, 1, encabezado.length).setValues([encabezado]).setFontWeight('bold');
  if (filas.length) {
    const inicio = hoja.getLastRow() + 1;
    hoja.getRange(inicio, 1, filas.length, filas[0].length).setValues(filas);
    hoja.getRange(inicio, 5, filas.length, 1).setNumberFormat('dd/MM/yyyy HH:mm');
  }
  props.setProperty('HS_FOTO_DIA', hoy);
  return hoy;
}

/** Date → Date cuyos campos UTC son la hora local (reloj de pared) en la zona horaria tz. */
function relojLocal_(fecha, tz) {
  return new Date(Utilities.formatDate(fecha, tz, "yyyy-MM-dd'T'HH:mm:ss'Z'"));
}

/** Hoja interna con encabezado (la crea si no existe). La columna 1 y 2 quedan como texto. */
function hojaInterna_(ss, nombre, encabezado) {
  let hoja = ss.getSheetByName(nombre);
  if (!hoja) {
    hoja = ss.insertSheet(nombre, ss.getNumSheets());
    hoja.getRange(1, 1, 1, encabezado.length).setValues([encabezado]).setFontWeight('bold');
    hoja.setFrozenRows(1);
    hoja.getRange('A:B').setNumberFormat('@');
  }
  return hoja;
}

/** Filas de datos (sin encabezado). */
function leerFilas_(hoja) {
  const ultima = hoja.getLastRow();
  if (ultima < 2) return [];
  return hoja.getRange(2, 1, ultima - 1, hoja.getLastColumn()).getValues();
}

function guardarEventos_(hoja, eventos) {
  if (!eventos.length) return;
  const filas = eventos.map(e => [
    e.id, e.dia, e.fecha, e.tipo, e.agente, e.agenteId, e.numero, e.asunto,
    e.minutos == null ? '' : e.minutos,
    e.minutos == null ? '' : Math.round(e.minutos / 60 * 10) / 10,
    'https://secure.helpscout.net/conversation/' + e.conversacionId + '/' + e.numero,
  ]);
  hoja.getRange(hoja.getLastRow() + 1, 1, filas.length, COLUMNAS_EVENTOS.length).setValues(filas);
  hoja.getRange(2, 3, hoja.getLastRow() - 1, 1).setNumberFormat('dd/MM/yyyy HH:mm');
}

/** Eventos guardados como objetos { dia, tipo, agente, minutos }. */
function leerEventos_(ss) {
  const hoja = ss.getSheetByName(CONFIG.HOJAS.eventos);
  if (!hoja) return [];
  const tz = ss.getSpreadsheetTimeZone();
  const formatear = f => Utilities.formatDate(f, tz, 'yyyy-MM-dd');
  return leerFilas_(hoja).map(f => ({
    dia: diaDesdeCelda(f[1], formatear), tipo: f[3], agente: f[4], numero: Number(f[6]),
    minutos: f[8] === '' ? null : Number(f[8]),
  }));
}

/** Foto de inicio de jornada por 'día|agente' (la última tomada gana). */
function leerFotos_(ss) {
  const hoja = ss.getSheetByName(CONFIG.HOJAS.fotos);
  const fotos = {};
  if (!hoja) return fotos;
  const tz = ss.getSpreadsheetTimeZone();
  const formatear = f => Utilities.formatDate(f, tz, 'yyyy-MM-dd');
  leerFilas_(hoja).forEach(f => { fotos[diaDesdeCelda(f[0], formatear) + '|' + normalizarTexto(f[1])] = Number(f[3]) || 0; });
  return fotos;
}

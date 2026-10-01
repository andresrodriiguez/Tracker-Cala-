// Tracker Gestión Diaria SOP ⇄ Help Scout — archivo generado con `npm run build`.
// Pégalo completo en Extensiones → Apps Script (reemplaza el contenido de Código.gs).

// ===== Config.gs =====
/**
 * CONFIGURACIÓN DEL TRACKER ⇄ HELP SCOUT
 * Este es el único archivo que normalmente necesitas editar.
 */
const CONFIG = {
  // Agentes del equipo SOP. "nombre" debe ser EXACTAMENTE como aparece en la columna
  // "Nombre del Agente" del tracker. "email" es el correo con el que entran a Help Scout.
  // Si dejas el email vacío se busca al usuario de Help Scout por nombre + apellido.
  // (Opcional) "id": ID numérico del usuario en Help Scout (ver hoja HS_Usuarios).
  AGENTES: [
    { nombre: 'Jaideth Andocilla', email: 'jaideth.andocilla@calapresenta.com' },
    { nombre: 'Maryelin Rios', email: 'maryelin.rios@calapresenta.com' },
    { nombre: 'Edna Escudero', email: 'edna@calapresenta.com' },
    { nombre: 'Andrés Rodríguez', email: 'andres.rodriguez@calapresenta.com' },
  ],

  // Desde este día (yyyy-MM-dd) la automatización llena el tracker.
  // Los días anteriores NUNCA se modifican (conservan lo que se llenó a mano).
  FECHA_INICIO: '2026-10-01',

  // Jornada del equipo (zona horaria de la hoja: Miami).
  //  - A la hora "inicio" se toma la "foto" de tickets sin atender al iniciar la jornada.
  //  - Los tiempos de respuesta y resolución cuentan SOLO minutos dentro de este horario
  //    (un caso que llega a las 4:50 pm y se resuelve a las 9:10 am del día hábil siguiente = 20 min).
  //  - dias: 0 = domingo, 1 = lunes … 6 = sábado.
  HORARIO_LABORAL: { inicio: 9, fin: 17, dias: [1, 2, 3, 4, 5, 6] },

  // Meta de resolución en horas LABORALES: el resumen muestra el % de casos resueltos dentro de ella.
  // 8 h laborales = una jornada completa.
  META_RESOLUCION_HORAS: 8,

  // Cada cuántos minutos se sincroniza con Help Scout (1, 5, 10, 15 o 30).
  MINUTOS_ENTRE_SINCRONIZACIONES: 15,

  // Estados de Help Scout que cuentan como "sin atender" en la foto de inicio de jornada.
  // 'active' = esperando respuesta del agente. Agrega 'pending' si también quieres contarlos.
  ESTADOS_SIN_ATENDER: ['active'],

  // --- Cómo se detecta un "Ticket re-asignado a otro dep. CCH / COACH" ---
  // Siempre: cuando el caso pasa de un agente del equipo a un usuario/equipo de Help Scout
  // que NO está en AGENTES (así lo hace el equipo SOP: asignándolo a otra persona).
  // Además, si llenas esta lista con los IDs de los buzones del equipo SOP (ver hoja
  // HS_Usuarios), mover el caso a un buzón que no esté aquí también cuenta como re-asignado.
  MAILBOXES_EQUIPO: [],
  // Además, si el caso tiene alguna de estas etiquetas (tags) de Help Scout, cuenta como re-asignado.
  // Vacío porque el equipo re-asigna asignando a otra persona (ej. ['cch', 'coach'] si algún día usan tags).
  TAGS_REASIGNACION: [],
  // true: pasar un caso de un agente del equipo a OTRO agente del equipo también cuenta como
  // re-asignado para el agente que lo tenía (así no le queda como pendiente).
  TRANSFERENCIA_INTERNA_ES_REASIGNACION: true,

  // Umbrales del semáforo (igual que la fila 2 del tracker).
  SEMAFORO: { verde: 0.9, amarillo: 0.6 },

  // Estructura de las hojas mensuales ("SEPTIEMBRE 2026", "OCTUBRE 2026", ...).
  HOJA_MES: {
    FILA_INICIO_DATOS: 4,
    COLUMNAS: {
      fecha: 'A',
      agente: 'B',
      sinAtender: 'C',
      asignados: 'D',
      nuevaConsulta: 'E',
      reasignados: 'F',
      total: 'G', // fórmula existente: solo se lee, nunca se escribe
      cerrados: 'H',
      pendientes: 'I',
    },
    // Columnas que llena la automatización. Quita alguna si prefieres seguir llenándola a mano.
    COLUMNAS_AUTOMATICAS: ['sinAtender', 'asignados', 'nuevaConsulta', 'reasignados', 'cerrados', 'pendientes'],
    // false: los ceros se dejan en blanco (como se ve hoy el tracker).
    ESCRIBIR_CEROS: false,
  },

  // Hojas que crea el script.
  HOJAS: {
    eventos: 'HS_Eventos',
    fotos: 'HS_InicioJornada',
    usuarios: 'HS_Usuarios',
    resumen: 'RESUMEN MENSUAL',
  },
};

const MESES = [
  'ENERO', 'FEBRERO', 'MARZO', 'ABRIL', 'MAYO', 'JUNIO',
  'JULIO', 'AGOSTO', 'SEPTIEMBRE', 'OCTUBRE', 'NOVIEMBRE', 'DICIEMBRE',
];

// ===== Util.gs =====
/**
 * Utilidades puras (sin servicios de Apps Script) — se prueban con Node en tests/.
 */

/** Minúsculas, sin tildes y sin espacios repetidos: "Andrés  Rodríguez" → "andres rodriguez". */
function normalizarTexto(texto) {
  return String(texto == null ? '' : texto)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Convierte el valor de una celda de fecha a 'yyyy-MM-dd'.
 * Acepta Date, 'dd/MM/yyyy' y 'yyyy-MM-dd'. Devuelve null si no es una fecha.
 * @param {*} valor
 * @param {function(Date): string} formatearDia
 */
function diaDesdeCelda(valor, formatearDia) {
  if (valor instanceof Date || Object.prototype.toString.call(valor) === '[object Date]') {
    return isNaN(valor.getTime()) ? null : formatearDia(valor);
  }
  const texto = String(valor == null ? '' : valor).trim();
  let m = texto.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) return m[3] + '-' + m[2].padStart(2, '0') + '-' + m[1].padStart(2, '0');
  m = texto.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return m[1] + '-' + m[2] + '-' + m[3];
  return null;
}

/**
 * Minutos entre dos momentos contando solo el horario laboral.
 * inicioLocal/finLocal son Date cuyos campos UTC representan la hora LOCAL (reloj de pared),
 * así el cálculo no depende de la zona horaria ni de los cambios de horario de verano.
 * @param {{inicio: number, fin: number, dias: number[]}} horario  horas 0-24 y días 0=domingo…6=sábado
 */
function minutosHabiles(inicioLocal, finLocal, horario) {
  const ini = inicioLocal.getTime();
  const fin = finLocal.getTime();
  if (!(fin > ini)) return 0;
  const DIA = 86400000;
  const HORA = 3600000;
  let total = 0;
  for (let d = Math.floor(ini / DIA) * DIA; d < fin; d += DIA) {
    if (horario.dias.indexOf(new Date(d).getUTCDay()) < 0) continue;
    const desde = Math.max(d + horario.inicio * HORA, ini);
    const hasta = Math.min(d + horario.fin * HORA, fin);
    if (hasta > desde) total += hasta - desde;
  }
  return total / 60000;
}

/**
 * Tiempo de gestión en minutos: horario laboral, salvo que todo pase fuera de horario el mismo
 * día (p. ej. asignado 7:45 y cerrado 7:55 → 10 min reales en vez de 0).
 */
function minutosGestion(inicioLocal, finLocal, horario) {
  const habiles = minutosHabiles(inicioLocal, finLocal, horario);
  if (habiles > 0) return habiles;
  const mismoDia = inicioLocal.toISOString().slice(0, 10) === finLocal.toISOString().slice(0, 10);
  return mismoDia ? Math.max(0, (finLocal - inicioLocal) / 60000) : 0;
}

/**
 * Día de jornada ('yyyy-MM-dd') al que pertenece un momento (hora local como campos UTC):
 * después del cierre de la jornada o en un día no laboral pasa al siguiente día laboral;
 * antes de la apertura cuenta para ese mismo día (si es laboral).
 * Ej. (9–17, lun–sáb): martes 20:00 → miércoles; sábado 18:00 → lunes; lunes 7:30 → lunes.
 */
function diaDeJornada(local, horario) {
  const DIA = 86400000;
  let d = Math.floor(local.getTime() / DIA) * DIA;
  if ((local.getTime() - d) / 3600000 >= horario.fin) d += DIA;
  for (let i = 0; i < 7 && horario.dias.indexOf(new Date(d).getUTCDay()) < 0; i++) d += DIA;
  return new Date(d).toISOString().slice(0, 10);
}

/** 'A' → 1, 'L' → 12, 'AA' → 27 */
function indiceColumna(letra) {
  return String(letra).toUpperCase().split('').reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0);
}

/** Nombre de la hoja mensual para un día 'yyyy-MM-dd' → 'SEPTIEMBRE 2026'. */
function nombreHojaMes(dia) {
  return MESES[Number(dia.slice(5, 7)) - 1] + ' ' + dia.slice(0, 4);
}

/** 'SEPTIEMBRE 2026' (con o sin tildes/espacios extra) → { anio: 2026, mes: 9 } o null. */
function mesDesdeNombreHoja(nombre) {
  const m = normalizarTexto(nombre).match(/^([a-z]+) (\d{4})$/);
  if (!m) return null;
  const mes = MESES.findIndex(n => normalizarTexto(n) === m[1]);
  return mes < 0 ? null : { anio: Number(m[2]), mes: mes + 1 };
}

// ===== Eventos.gs =====
/**
 * Convierte el historial (hilos) de una conversación de Help Scout en eventos por agente.
 * Función pura (sin servicios de Apps Script) — se prueba con Node en tests/.
 *
 * Tipos de evento:
 *   ASIGNADO          el caso quedó asignado al agente (máx. 1 por caso/agente/día)
 *   NUEVA_CONSULTA    el cliente volvió a escribir en un caso que el agente ya tenía
 *                     asignado desde un día anterior y que ya había atendido (máx. 1 por caso/agente/día)
 *   REASIGNADO        el caso salió del agente hacia otro usuario/equipo/buzón (CCH, COACH, ...)
 *   CERRADO           el caso pasó a "closed" estando a cargo del agente; minutos = tiempo de resolución
 *   PRIMERA_RESPUESTA primera respuesta del agente tras la asignación; minutos = tiempo de 1ª respuesta
 *
 * @param {Object} conv  Conversación de la API v2 de Help Scout con _embedded.threads.
 * @param {Object} ctx
 *   agentePorId(id)  → { id, nombre } si el usuario de Help Scout es del equipo, si no null
 *   dia(Date)        → 'yyyy-MM-dd' en la zona horaria de la hoja
 *   mailboxesEquipo  → number[]
 *   tagsReasignacion → string[]
 *   transferenciaInternaEsReasignacion → boolean
 *   minutos(fin, inicio) → (opcional) minutos entre dos Date; por defecto minutos corridos
 * @return {Object[]} eventos
 */
function derivarEventos(conv, ctx) {
  if (!conv || conv.status === 'spam') return [];

  const hilos = ((conv._embedded && conv._embedded.threads) || [])
    .filter(h => !h.state || h.state === 'published')
    .slice()
    .sort((a, b) => (new Date(a.createdAt) - new Date(b.createdAt)) || (a.id - b.id));

  const eventos = [];
  const emitidos = new Set();
  const emitir = (tipo, clave, agente, fecha, minutos) => {
    const id = conv.id + '-' + clave;
    if (emitidos.has(id)) return;
    emitidos.add(id);
    eventos.push({
      id: id,
      tipo: tipo,
      agente: agente.nombre,
      agenteId: agente.id,
      fecha: fecha,
      dia: ctx.dia(fecha),
      conversacionId: conv.id,
      numero: conv.number,
      asunto: conv.subject || '',
      minutos: minutos == null ? null : Math.max(0, Math.round(minutos)),
    });
  };
  const minutosEntre = ctx.minutos || ((fin, inicio) => (fin - inicio) / 60000);
  const idUsuario = p => (p && Number(p.id) > 0 ? Number(p.id) : null);
  const agenteDe = id => (id === null ? null : ctx.agentePorId(id));
  const mailboxesEquipo = (ctx.mailboxesEquipo || []).map(Number);

  let asignado = null;            // id del usuario de Help Scout asignado ahora
  let ultimoAgenteEquipo = null;  // agente del equipo que tiene/tuvo el caso y aún no lo ha re-asignado
  let estado = null;
  let esperandoAgente = true;     // el último mensaje relevante fue del cliente
  let diaAsignacion = null;
  let inicioAsignacion = null;
  let inicioCiclo = null;         // desde cuándo se mide la resolución (asignación o reapertura)
  let primeraRespuestaPendiente = false;
  let hayReasignacion = false;

  const aplicarAsignacion = (nuevoId, fecha, claveHilo) => {
    if (nuevoId === asignado) return;
    asignado = nuevoId;
    if (nuevoId === null) return; // quitar la asignación no cuenta como re-asignación
    const nuevo = agenteDe(nuevoId);
    const esOtro = !nuevo || (ultimoAgenteEquipo && nuevo.id !== ultimoAgenteEquipo.id);
    if (ultimoAgenteEquipo && esOtro && (!nuevo || ctx.transferenciaInternaEsReasignacion)) {
      emitir('REASIGNADO', 'R-' + claveHilo, ultimoAgenteEquipo, fecha);
      hayReasignacion = true;
      ultimoAgenteEquipo = null;
    }
    if (nuevo) {
      const dia = ctx.dia(fecha);
      emitir('ASIGNADO', 'A-' + nuevo.id + '-' + dia, nuevo, fecha);
      ultimoAgenteEquipo = nuevo;
      diaAsignacion = dia;
      inicioAsignacion = fecha;
      inicioCiclo = fecha;
      primeraRespuestaPendiente = true;
    }
  };

  // Si la API no trae la asignación en los hilos, se usa el asignado actual de la conversación.
  if (!hilos.some(h => 'assignedTo' in h) && idUsuario(conv.assignee) !== null) {
    aplicarAsignacion(idUsuario(conv.assignee), new Date(conv.createdAt), 'inicial');
  }

  hilos.forEach(h => {
    const fecha = new Date(h.createdAt);
    const dia = ctx.dia(fecha);
    const autor = h.createdBy || {};
    const esCliente = h.type === 'customer' || autor.type === 'customer';
    const esRespuestaAgente = !esCliente && autor.type === 'user' &&
      ['message', 'chat', 'phone'].indexOf(h.type) >= 0;
    const estadoPrevio = estado;
    const nuevoEstado = h.status && h.status !== 'nochange' ? h.status : estado;

    // 1) El cliente vuelve a escribir en un caso que ya estaba asignado desde otro día.
    if (esCliente) {
      const agente = agenteDe(asignado);
      const yaAtendido = estadoPrevio === 'closed' || estadoPrevio === 'pending' || !esperandoAgente;
      if (agente && diaAsignacion !== dia && yaAtendido) {
        emitir('NUEVA_CONSULTA', 'N-' + agente.id + '-' + dia, agente, fecha);
      }
      esperandoAgente = true;
    }

    // 2) Cambios de asignación.
    if ('assignedTo' in h) aplicarAsignacion(idUsuario(h.assignedTo), fecha, h.id);

    // 3) Movido a un buzón que no es del equipo.
    const accion = (h.action && h.action.type) || '';
    if (h.type === 'lineitem' && /move/i.test(accion) && ultimoAgenteEquipo &&
        mailboxesEquipo.length && mailboxesEquipo.indexOf(Number(conv.mailboxId)) < 0) {
      emitir('REASIGNADO', 'M-' + h.id, ultimoAgenteEquipo, fecha);
      hayReasignacion = true;
      ultimoAgenteEquipo = null;
    }

    // 4) Respuesta del agente.
    if (esRespuestaAgente) {
      esperandoAgente = false;
      const agente = ctx.agentePorId(Number(autor.id));
      if (agente && primeraRespuestaPendiente && asignado === agente.id) {
        emitir('PRIMERA_RESPUESTA', 'P-' + h.id, agente, fecha, minutosEntre(fecha, inicioAsignacion));
        primeraRespuestaPendiente = false;
      }
    }

    // 5) Cambios de estado: reapertura y cierre.
    if (nuevoEstado === 'pending' || nuevoEstado === 'closed') esperandoAgente = false;
    if (estadoPrevio === 'closed' && nuevoEstado !== 'closed') inicioCiclo = fecha;
    if (nuevoEstado === 'closed' && estadoPrevio !== 'closed') {
      // Si el caso estaba sin asignar y lo cerró una agente del equipo, lo tomó y lo resolvió:
      // cuenta como asignado y cerrado para ella (no como "sin atender").
      let agente = agenteDe(asignado);
      if (!agente && autor.type === 'user') {
        agente = ctx.agentePorId(Number(autor.id));
        if (agente) emitir('ASIGNADO', 'A-' + agente.id + '-' + dia, agente, fecha);
      }
      if (agente) {
        emitir('CERRADO', 'C-' + h.id, agente, fecha,
          minutosEntre(fecha, inicioCiclo || new Date(conv.createdAt)));
      }
    }
    estado = nuevoEstado;
  });

  // 6) Etiquetas de re-asignación (CCH, COACH, ...).
  const tags = (conv.tags || []).map(t => normalizarTexto(t.tag || t.name || t));
  const tieneTag = (ctx.tagsReasignacion || []).some(t => tags.indexOf(normalizarTexto(t)) >= 0);
  const ultimoHilo = hilos[hilos.length - 1];
  if (tieneTag && !hayReasignacion && ultimoHilo) {
    const agente = ultimoAgenteEquipo || agenteDe(asignado);
    if (agente) emitir('REASIGNADO', 'T', agente, new Date(ultimoHilo.createdAt));
  }

  return eventos;
}

// ===== Metricas.gs =====
/**
 * Cálculo de métricas — funciones puras, se prueban con Node en tests/.
 */

/**
 * Métricas de un agente en un día, con las mismas reglas del tracker:
 *   Total gestionados = sin atender al inicio + asignados + nuevas consultas − re-asignados
 *   Pendientes        = Total gestionados − cerrados (mínimo 0)
 * @param {Object[]} eventos  eventos de ESE agente en ESE día
 * @param {number} sinAtender foto de inicio de jornada (0 si no hay)
 */
function contarDia(eventos, sinAtender) {
  const c = { sinAtender: Number(sinAtender) || 0, asignados: 0, nuevaConsulta: 0, reasignados: 0, cerrados: 0 };
  eventos.forEach(e => {
    if (e.tipo === 'ASIGNADO') c.asignados++;
    else if (e.tipo === 'NUEVA_CONSULTA') c.nuevaConsulta++;
    else if (e.tipo === 'REASIGNADO') c.reasignados++;
    else if (e.tipo === 'CERRADO') c.cerrados++;
  });
  c.total = c.sinAtender + c.asignados + c.nuevaConsulta - c.reasignados;
  c.pendientes = Math.max(0, c.total - c.cerrados);
  c.hayActividad = c.asignados + c.nuevaConsulta + c.reasignados + c.cerrados > 0;
  return c;
}

/** 'VERDE' | 'AMARILLO' | 'ROJO' | null (sin datos). */
function colorSemaforo(ratio, umbrales) {
  if (ratio == null || isNaN(ratio)) return null;
  if (ratio >= umbrales.verde) return 'VERDE';
  if (ratio >= umbrales.amarillo) return 'AMARILLO';
  return 'ROJO';
}

/** Estadísticas de una lista de minutos → horas; pctEnMeta = % de valores ≤ metaHoras. */
function estadisticasTiempo(minutos, metaHoras) {
  const v = minutos.filter(m => typeof m === 'number' && !isNaN(m)).sort((a, b) => a - b);
  if (!v.length) return { n: 0, promedioH: null, medianaH: null, pctEnMeta: null };
  const mitad = Math.floor(v.length / 2);
  const mediana = v.length % 2 ? v[mitad] : (v[mitad - 1] + v[mitad]) / 2;
  const promedio = v.reduce((s, m) => s + m, 0) / v.length;
  return {
    n: v.length,
    promedioH: Math.round(promedio / 60 * 10) / 10,
    medianaH: Math.round(mediana / 60 * 10) / 10,
    pctEnMeta: metaHoras == null ? null : v.filter(m => m <= metaHoras * 60).length / v.length,
  };
}

// ===== HelpScout.gs =====
/**
 * Cliente mínimo de la API v2 de Help Scout (Mailbox API).
 * Autenticación OAuth2 "client credentials": App ID + App Secret creados en
 * Help Scout → Tu perfil → My Apps. La app actúa con los permisos del usuario que la creó.
 */
const HS_API = 'https://api.helpscout.net/v2';

function hsCredenciales_() {
  const props = PropertiesService.getScriptProperties();
  const id = props.getProperty('HS_APP_ID');
  const secret = props.getProperty('HS_APP_SECRET');
  if (!id || !secret) {
    throw new Error('Faltan las credenciales de Help Scout. Menú "Help Scout" → "1. Configurar credenciales".');
  }
  return { id: id, secret: secret };
}

function hsToken_(renovar) {
  const cache = CacheService.getScriptCache();
  if (!renovar) {
    const guardado = cache.get('HS_TOKEN');
    if (guardado) return guardado;
  }
  const cred = hsCredenciales_();
  const res = UrlFetchApp.fetch(HS_API + '/oauth2/token', {
    method: 'post',
    payload: { grant_type: 'client_credentials', client_id: cred.id, client_secret: cred.secret },
    muteHttpExceptions: true,
  });
  if (res.getResponseCode() !== 200) {
    throw new Error('Help Scout rechazó las credenciales (' + res.getResponseCode() + '): ' + res.getContentText());
  }
  const data = JSON.parse(res.getContentText());
  cache.put('HS_TOKEN', data.access_token, Math.max(60, Math.min(21600, (data.expires_in || 7200) - 300)));
  return data.access_token;
}

/** GET con reintentos (token vencido, límite de peticiones y errores 5xx). */
function hsGet_(ruta, params) {
  const qs = Object.keys(params || {})
    .filter(k => params[k] !== undefined && params[k] !== null && params[k] !== '')
    .map(k => encodeURIComponent(k) + '=' + encodeURIComponent(params[k]))
    .join('&');
  const url = HS_API + ruta + (qs ? '?' + qs : '');
  let renovar = false;
  for (let intento = 1; intento <= 5; intento++) {
    const res = UrlFetchApp.fetch(url, {
      headers: { Authorization: 'Bearer ' + hsToken_(renovar) },
      muteHttpExceptions: true,
    });
    const codigo = res.getResponseCode();
    if (codigo === 200) return JSON.parse(res.getContentText());
    if (codigo === 401 && !renovar) { renovar = true; continue; }
    if (codigo === 429 || codigo >= 500) {
      const headers = res.getHeaders();
      const espera = Number(headers['X-RateLimit-Retry-After'] || headers['Retry-After'] ||
        headers['x-ratelimit-retry-after'] || headers['retry-after']) || Math.pow(2, intento);
      Utilities.sleep(Math.min(60, espera) * 1000);
      continue;
    }
    throw new Error('Error de Help Scout ' + codigo + ' en ' + ruta + ': ' + res.getContentText());
  }
  throw new Error('Help Scout no respondió después de varios intentos: ' + ruta);
}

/** Recorre todas las páginas de un listado y devuelve los elementos de _embedded[clave]. */
function hsListarTodo_(ruta, params, clave) {
  const todos = [];
  for (let pagina = 1; ; pagina++) {
    const data = hsGet_(ruta, Object.assign({}, params, { page: pagina }));
    const items = (data._embedded && data._embedded[clave]) || [];
    Array.prototype.push.apply(todos, items);
    const totalPaginas = data.page ? data.page.totalPages : 1;
    if (!items.length || pagina >= totalPaginas) return todos;
  }
}

function hsUsuarios_() {
  const cache = CacheService.getScriptCache();
  const guardado = cache.get('HS_USUARIOS');
  if (guardado) return JSON.parse(guardado);
  const usuarios = hsListarTodo_('/users', {}, 'users').map(u => ({
    id: u.id, nombre: u.firstName || '', apellido: u.lastName || '', email: u.email || '', rol: u.role || '',
  }));
  cache.put('HS_USUARIOS', JSON.stringify(usuarios), 21600);
  return usuarios;
}

function hsMailboxes_() {
  return hsListarTodo_('/mailboxes', {}, 'mailboxes').map(m => ({ id: m.id, nombre: m.name, email: m.email }));
}

function hsHilos_(conversacionId) {
  return hsListarTodo_('/conversations/' + conversacionId + '/threads', {}, 'threads');
}

/** Date → '2026-09-30T13:00:00Z' (formato que espera Help Scout). */
function hsFechaIso_(fecha) {
  return fecha.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

// ===== Sync.gs =====
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
  const eventosHoy = leerEventos_(ss).filter(e => e.dia === hoy);
  const clave = (agente, numero) => normalizarTexto(agente) + '|' + numero;
  const yaContados = new Set(eventosHoy
    .filter(e => e.tipo === 'ASIGNADO' || e.tipo === 'NUEVA_CONSULTA')
    .map(e => clave(e.agente, e.numero)));
  const mailbox = CONFIG.MAILBOXES_EQUIPO.length ? CONFIG.MAILBOXES_EQUIPO.join(',') : undefined;
  const filas = equipo.agentes.filter(a => a.id).map(a => {
    const pendientes = new Set();
    CONFIG.ESTADOS_SIN_ATENDER.forEach(estado =>
      hsListarTodo_('/conversations', { status: estado, assigned_to: a.id, mailbox: mailbox }, 'conversations')
        .forEach(c => { if (!yaContados.has(clave(a.nombre, c.number))) pendientes.add(c.number); }));
    // Casos de días anteriores que la agente ya cerró hoy antes de la foto (madrugada o anoche):
    // también eran trabajo pendiente al iniciar la jornada.
    eventosHoy
      .filter(e => e.tipo === 'CERRADO' && normalizarTexto(e.agente) === normalizarTexto(a.nombre) &&
        !yaContados.has(clave(e.agente, e.numero)))
      .forEach(e => pendientes.add(e.numero));
    const casos = Array.from(pendientes).sort((x, y) => x - y).map(n => '#' + n).join(', ');
    return [hoy, a.nombre, a.id, pendientes.size, ahora, casos];
  });
  const encabezado = ['Día', 'Agente', 'ID agente HS', 'Sin atender', 'Tomada', 'Casos contados'];
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

// ===== Tracker.gs =====
/**
 * Escritura en las hojas mensuales del tracker ("SEPTIEMBRE 2026", ...).
 * Solo toca las columnas de CONFIG.HOJA_MES.COLUMNAS_AUTOMATICAS; las fórmulas
 * (Total, % / Semáforo) y las Observaciones se respetan.
 */

/** Recalcula y escribe las filas (día × agente) de los días indicados ('yyyy-MM-dd'). */
function actualizarTracker_(ss, dias, equipo) {
  const tz = ss.getSpreadsheetTimeZone();
  const eventos = leerEventos_(ss);
  const fotos = leerFotos_(ss);
  const porDiaAgente = {};
  eventos.forEach(e => {
    const clave = e.dia + '|' + normalizarTexto(e.agente);
    (porDiaAgente[clave] = porDiaAgente[clave] || []).push(e);
  });

  const indices = {}; // nombre de hoja → índice de filas
  dias.filter(d => d >= CONFIG.FECHA_INICIO).forEach(dia => {
    const hoja = obtenerHojaMes_(ss, dia);
    const indice = indices[hoja.getName()] = indices[hoja.getName()] || indexarHojaMes_(hoja, tz);
    equipo.agentes.forEach(agente => {
      const clave = dia + '|' + normalizarTexto(agente.nombre);
      const m = contarDia(porDiaAgente[clave] || [], fotos[clave]);
      let fila = indice.filas[clave];
      if (!fila && !m.hayActividad) return; // no crea filas vacías (días libres, vacaciones)
      if (!fila) fila = indice.filas[clave] = nuevaFilaMes_(hoja, indice, dia, agente.nombre, tz);
      escribirMetricas_(hoja, fila, m);
    });
  });
}

function escribirMetricas_(hoja, fila, m) {
  const cfg = CONFIG.HOJA_MES;
  cfg.COLUMNAS_AUTOMATICAS.forEach(campo => {
    const valor = m[campo];
    hoja.getRange(fila, indiceColumna(cfg.COLUMNAS[campo]))
      .setValue((valor || cfg.ESCRIBIR_CEROS) ? valor : '');
  });
}

/** Mapa 'yyyy-MM-dd|agente' → número de fila, y última fila con datos. */
function indexarHojaMes_(hoja, tz) {
  const cfg = CONFIG.HOJA_MES;
  const colFecha = indiceColumna(cfg.COLUMNAS.fecha);
  const colAgente = indiceColumna(cfg.COLUMNAS.agente);
  const formatear = f => Utilities.formatDate(f, tz, 'yyyy-MM-dd');
  const indice = { filas: {}, ultimaConDatos: cfg.FILA_INICIO_DATOS - 1 };
  const n = hoja.getLastRow() - cfg.FILA_INICIO_DATOS + 1;
  if (n <= 0) return indice;
  const fechas = hoja.getRange(cfg.FILA_INICIO_DATOS, colFecha, n, 1).getValues();
  const agentes = hoja.getRange(cfg.FILA_INICIO_DATOS, colAgente, n, 1).getValues();
  for (let i = 0; i < n; i++) {
    const fila = cfg.FILA_INICIO_DATOS + i;
    const dia = diaDesdeCelda(fechas[i][0], formatear);
    const nombre = normalizarTexto(agentes[i][0]);
    if (dia || nombre) indice.ultimaConDatos = fila;
    if (dia && nombre) indice.filas[dia + '|' + nombre] = fila;
  }
  return indice;
}

/** Usa la siguiente fila libre (o agrega una al final) copiando las fórmulas de la fila de arriba. */
function nuevaFilaMes_(hoja, indice, dia, nombre, tz) {
  const cfg = CONFIG.HOJA_MES;
  const fila = indice.ultimaConDatos + 1;
  if (fila > hoja.getMaxRows()) hoja.insertRowsAfter(hoja.getMaxRows(), 1); // hereda el formato
  if (fila > cfg.FILA_INICIO_DATOS) {
    const columnas = hoja.getMaxColumns();
    const arriba = hoja.getRange(fila - 1, 1, 1, columnas).getFormulasR1C1()[0];
    const actual = hoja.getRange(fila, 1, 1, columnas);
    const formulas = actual.getFormulasR1C1()[0];
    const valores = actual.getValues()[0];
    arriba.forEach((f, i) => {
      if (f && !formulas[i] && valores[i] === '') hoja.getRange(fila, i + 1).setFormulaR1C1(f);
    });
  }
  hoja.getRange(fila, indiceColumna(cfg.COLUMNAS.fecha))
    .setValue(Utilities.parseDate(dia, tz, 'yyyy-MM-dd'))
    .setNumberFormat('dd/MM/yyyy');
  hoja.getRange(fila, indiceColumna(cfg.COLUMNAS.agente)).setValue(nombre);
  indice.ultimaConDatos = fila;
  return fila;
}

/** Hoja del mes del día; si no existe la crea copiando la del mes más reciente (sin datos). */
function obtenerHojaMes_(ss, dia) {
  const objetivo = mesDesdeNombreHoja(nombreHojaMes(dia));
  const hojasMes = ss.getSheets()
    .map(h => ({ hoja: h, mes: mesDesdeNombreHoja(h.getName()) }))
    .filter(x => x.mes);
  const existente = hojasMes.find(x => x.mes.anio === objetivo.anio && x.mes.mes === objetivo.mes);
  if (existente) return existente.hoja;
  if (!hojasMes.length) throw new Error('No encontré ninguna hoja mensual (ej. "SEPTIEMBRE 2026") para usar de plantilla.');

  const valor = m => m.anio * 12 + m.mes;
  hojasMes.sort((a, b) => valor(a.mes) - valor(b.mes));
  const anteriores = hojasMes.filter(x => valor(x.mes) < valor(objetivo));
  const plantilla = (anteriores.length ? anteriores[anteriores.length - 1] : hojasMes[0]).hoja;

  const nueva = plantilla.copyTo(ss).setName(nombreHojaMes(dia));
  ss.setActiveSheet(nueva);
  ss.moveActiveSheet(plantilla.getIndex() + 1);
  // Borra los datos pero conserva fórmulas y formato.
  const inicio = CONFIG.HOJA_MES.FILA_INICIO_DATOS;
  const n = nueva.getLastRow() - inicio + 1;
  if (n > 0) {
    const rango = nueva.getRange(inicio, 1, n, nueva.getLastColumn());
    rango.setValues(rango.getFormulas().map(fila => fila.map(f => f || '')));
  }
  return nueva;
}

// ===== Resumen.gs =====
/**
 * Hoja "RESUMEN MENSUAL": rendimiento por agente y por mes.
 * Las cantidades salen de las hojas mensuales (incluye los meses llenados a mano) y
 * los tiempos de respuesta/resolución salen de HS_Eventos (desde que corre la automatización).
 */
const COLUMNAS_RESUMEN = [
  'Mes', 'Agente', 'Días trabajados', 'Asignados', 'Nuevas consultas', 'Re-asignados',
  'Total gestionados', 'Cerrados', '% Resolución', 'Días en verde', 'Días en amarillo', 'Días en rojo',
  '1ª respuesta prom. (h lab.)', 'Resolución prom. (h lab.)', 'Resolución mediana (h lab.)',
  '% resueltos en la meta',
  'Casos con tiempo medido',
];

function actualizarResumen_(ss) {
  const tz = ss.getSpreadsheetTimeZone();
  const formatear = f => Utilities.formatDate(f, tz, 'yyyy-MM-dd');
  const cfg = CONFIG.HOJA_MES;
  const col = campo => indiceColumna(cfg.COLUMNAS[campo]) - 1;
  const num = v => (typeof v === 'number' ? v : Number(v) || 0);

  // 1) Cantidades y semáforo diario desde las hojas mensuales.
  const acumulado = (anio, mes, agente) => ({
    anio: anio, mes: mes, agente: agente, dias: 0, asignados: 0, nuevaConsulta: 0, reasignados: 0,
    total: 0, cerrados: 0, verde: 0, amarillo: 0, rojo: 0, primeraRespuesta: [], resolucion: [],
  });
  const grupos = {}; // 'aaaa-mm|agente' → acumulado
  const grupo = (anio, mes, agente) => {
    const clave = anio + '-' + String(mes).padStart(2, '0') + '|' + normalizarTexto(agente);
    return grupos[clave] = grupos[clave] || acumulado(anio, mes, agente);
  };
  const ultimaCol = Math.max.apply(null, Object.keys(cfg.COLUMNAS).map(c => col(c) + 1));
  ss.getSheets().forEach(hoja => {
    const mes = mesDesdeNombreHoja(hoja.getName());
    const n = hoja.getLastRow() - cfg.FILA_INICIO_DATOS + 1;
    if (!mes || n <= 0) return;
    hoja.getRange(cfg.FILA_INICIO_DATOS, 1, n, ultimaCol).getValues().forEach(f => {
      const agente = String(f[col('agente')] || '').trim();
      if (!agente || !diaDesdeCelda(f[col('fecha')], formatear)) return;
      const d = {
        sinAtender: num(f[col('sinAtender')]), asignados: num(f[col('asignados')]),
        nuevaConsulta: num(f[col('nuevaConsulta')]), reasignados: num(f[col('reasignados')]),
        cerrados: num(f[col('cerrados')]),
      };
      const totalHoja = f[col('total')];
      const total = typeof totalHoja === 'number' ? totalHoja
        : d.sinAtender + d.asignados + d.nuevaConsulta - d.reasignados;
      if (total <= 0 && d.cerrados === 0) return; // día libre, vacaciones o fila sin datos
      const g = grupo(mes.anio, mes.mes, agente);
      g.dias++;
      g.asignados += d.asignados;
      g.nuevaConsulta += d.nuevaConsulta;
      g.reasignados += d.reasignados;
      g.total += total;
      g.cerrados += d.cerrados;
      const color = colorSemaforo(total > 0 ? d.cerrados / total : null, CONFIG.SEMAFORO);
      if (color) g[color.toLowerCase()]++;
    });
  });

  // 2) Tiempos desde HS_Eventos.
  const agentesPorNombre = {};
  Object.keys(grupos).forEach(k => { agentesPorNombre[normalizarTexto(grupos[k].agente)] = grupos[k].agente; });
  leerEventos_(ss).forEach(e => {
    if (!e.dia || e.minutos == null || (e.tipo !== 'CERRADO' && e.tipo !== 'PRIMERA_RESPUESTA')) return;
    const nombre = agentesPorNombre[normalizarTexto(e.agente)] || e.agente;
    const g = grupo(Number(e.dia.slice(0, 4)), Number(e.dia.slice(5, 7)), nombre);
    (e.tipo === 'CERRADO' ? g.resolucion : g.primeraRespuesta).push(e.minutos);
  });

  // 3) Filas por mes (más reciente primero) + total del equipo.
  const porMes = {};
  Object.keys(grupos).forEach(k => {
    const g = grupos[k];
    (porMes[g.anio * 100 + g.mes] = porMes[g.anio * 100 + g.mes] || []).push(g);
  });
  const filas = [];
  const filasEquipo = [];
  Object.keys(porMes).map(Number).sort((a, b) => b - a).forEach(clave => {
    const lista = porMes[clave].sort((a, b) => a.agente.localeCompare(b.agente));
    const equipo = lista.reduce((t, g) => {
      ['dias', 'asignados', 'nuevaConsulta', 'reasignados', 'total', 'cerrados', 'verde', 'amarillo', 'rojo']
        .forEach(c => { t[c] += g[c]; });
      t.primeraRespuesta = t.primeraRespuesta.concat(g.primeraRespuesta);
      t.resolucion = t.resolucion.concat(g.resolucion);
      return t;
    }, acumulado(lista[0].anio, lista[0].mes, 'EQUIPO'));
    lista.concat([equipo]).forEach(g => {
      if (g === equipo) filasEquipo.push(filas.length);
      const pr = estadisticasTiempo(g.primeraRespuesta);
      const res = estadisticasTiempo(g.resolucion, CONFIG.META_RESOLUCION_HORAS);
      filas.push([
        MESES[g.mes - 1] + ' ' + g.anio, g.agente, g.dias, g.asignados, g.nuevaConsulta, g.reasignados,
        g.total, g.cerrados, g.total > 0 ? g.cerrados / g.total : '', g.verde, g.amarillo, g.rojo,
        pr.promedioH == null ? '' : pr.promedioH,
        res.promedioH == null ? '' : res.promedioH,
        res.medianaH == null ? '' : res.medianaH,
        res.pctEnMeta == null ? '' : res.pctEnMeta,
        res.n || '',
      ]);
    });
  });

  // 4) Escribir la hoja.
  let hoja = ss.getSheetByName(CONFIG.HOJAS.resumen);
  if (!hoja) hoja = ss.insertSheet(CONFIG.HOJAS.resumen, 0);
  hoja.clear();
  hoja.getRange(1, 1).setValue('RESUMEN MENSUAL DE RENDIMIENTO — EQUIPO SOP').setFontSize(14).setFontWeight('bold');
  hoja.getRange(2, 1).setValue('Actualizado: ' + Utilities.formatDate(new Date(), tz, 'dd/MM/yyyy HH:mm') +
    '  ·  Semáforo por día: ≥ ' + CONFIG.SEMAFORO.verde * 100 + '% verde, ≥ ' + CONFIG.SEMAFORO.amarillo * 100 +
    '% amarillo, menos es rojo  ·  Tiempos en horas laborales (' + CONFIG.HORARIO_LABORAL.inicio + ':00–' +
    CONFIG.HORARIO_LABORAL.fin + ':00, ' + nombresDias_(CONFIG.HORARIO_LABORAL.dias) + '), desde ' + CONFIG.FECHA_INICIO +
    '  ·  Meta de resolución: ' + CONFIG.META_RESOLUCION_HORAS + ' h laborales');
  hoja.getRange(3, 1, 1, COLUMNAS_RESUMEN.length).setValues([COLUMNAS_RESUMEN])
    .setFontWeight('bold').setBackground('#434343').setFontColor('#ffffff').setWrap(true);
  hoja.setFrozenRows(3);
  if (filas.length) {
    hoja.getRange(4, 1, filas.length, COLUMNAS_RESUMEN.length).setValues(filas);
    hoja.getRange(4, 9, filas.length, 1).setNumberFormat('0%');
    hoja.getRange(4, 13, filas.length, 3).setNumberFormat('0.0');
    hoja.getRange(4, 16, filas.length, 1).setNumberFormat('0%');
    filasEquipo.forEach(i => hoja.getRange(4 + i, 1, 1, COLUMNAS_RESUMEN.length)
      .setFontWeight('bold').setBackground('#efefef'));
  }
  const rangoPct = hoja.getRange(4, 9, Math.max(1, filas.length), 1);
  hoja.setConditionalFormatRules([
    SpreadsheetApp.newConditionalFormatRule().whenNumberGreaterThanOrEqualTo(CONFIG.SEMAFORO.verde)
      .setBackground('#00b050').setFontColor('#ffffff').setRanges([rangoPct]).build(),
    SpreadsheetApp.newConditionalFormatRule().whenNumberGreaterThanOrEqualTo(CONFIG.SEMAFORO.amarillo)
      .setBackground('#ffd966').setRanges([rangoPct]).build(),
    SpreadsheetApp.newConditionalFormatRule().whenNumberLessThan(CONFIG.SEMAFORO.amarillo)
      .setBackground('#f4a6a6').setRanges([rangoPct]).build(),
  ]);
  hoja.setColumnWidth(1, 130);
  hoja.setColumnWidth(2, 160);
}

/** [1,2,3,4,5,6] → 'lun–sáb' */
function nombresDias_(dias) {
  const nombres = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];
  const orden = dias.slice().sort((a, b) => a - b);
  const consecutivos = orden.every((d, i) => i === 0 || d === orden[i - 1] + 1);
  return consecutivos && orden.length > 2
    ? nombres[orden[0]] + '–' + nombres[orden[orden.length - 1]]
    : orden.map(d => nombres[d]).join(', ');
}

// ===== Menu.gs =====
/**
 * Menú "Help Scout" en la hoja y activadores automáticos.
 */
function onOpen() {
  SpreadsheetApp.getUi().createMenu('Help Scout')
    .addItem('1. Configurar credenciales', 'menuConfigurarCredenciales')
    .addItem('2. Ver usuarios y buzones de Help Scout', 'menuListarUsuarios')
    .addItem('3. Activar sincronización automática', 'menuActivar')
    .addSeparator()
    .addItem('Sincronizar ahora', 'menuSincronizar')
    .addItem('Tomar foto de inicio de jornada ahora', 'menuFoto')
    .addItem('Actualizar resumen mensual', 'menuResumen')
    .addItem('Ver estado', 'menuEstado')
    .addSeparator()
    .addItem('Desactivar sincronización automática', 'menuDesactivar')
    .addItem('Recalcular todo desde FECHA_INICIO', 'menuReiniciar')
    .addToUi();
}

function menuConfigurarCredenciales() {
  const ui = SpreadsheetApp.getUi();
  const id = ui.prompt('Help Scout — App ID', 'Pega el App ID (Help Scout → Tu perfil → My Apps):', ui.ButtonSet.OK_CANCEL);
  if (id.getSelectedButton() !== ui.Button.OK) return;
  const secret = ui.prompt('Help Scout — App Secret', 'Pega el App Secret:', ui.ButtonSet.OK_CANCEL);
  if (secret.getSelectedButton() !== ui.Button.OK) return;
  PropertiesService.getScriptProperties().setProperties({
    HS_APP_ID: id.getResponseText().trim(),
    HS_APP_SECRET: secret.getResponseText().trim(),
  });
  CacheService.getScriptCache().removeAll(['HS_TOKEN', 'HS_USUARIOS']);
  hsToken_(true); // valida las credenciales
  ui.alert('✅ Conectado a Help Scout. Siguiente paso: "2. Ver usuarios y buzones de Help Scout".');
}

function menuListarUsuarios() {
  const ss = SpreadsheetApp.getActive();
  CacheService.getScriptCache().remove('HS_USUARIOS');
  const equipo = resolverEquipo_();
  const usuarios = hsUsuarios_();
  const mailboxes = hsMailboxes_();

  let hoja = ss.getSheetByName(CONFIG.HOJAS.usuarios);
  if (!hoja) hoja = ss.insertSheet(CONFIG.HOJAS.usuarios, ss.getNumSheets());
  hoja.clear();
  const filasUsuarios = usuarios.map(u => [u.id, u.nombre + ' ' + u.apellido, u.email, u.rol,
    equipo.porId[u.id] ? '✅ ' + equipo.porId[u.id].nombre : '']);
  hoja.getRange(1, 1, 1, 5).setValues([['ID usuario', 'Nombre en Help Scout', 'Email', 'Rol', 'Agente en el tracker']])
    .setFontWeight('bold');
  if (filasUsuarios.length) hoja.getRange(2, 1, filasUsuarios.length, 5).setValues(filasUsuarios);
  const fila = filasUsuarios.length + 3;
  hoja.getRange(fila, 1, 1, 3).setValues([['ID buzón (mailbox)', 'Buzón', 'Email']]).setFontWeight('bold');
  if (mailboxes.length) {
    hoja.getRange(fila + 1, 1, mailboxes.length, 3).setValues(mailboxes.map(m => [m.id, m.nombre, m.email]));
  }
  ss.setActiveSheet(hoja);

  SpreadsheetApp.getUi().alert(equipo.sinEncontrar.length
    ? '⚠️ No encontré en Help Scout a: ' + equipo.sinEncontrar.join(', ') +
      '.\nEscribe su email de Help Scout en CONFIG.AGENTES (archivo Config.gs) y vuelve a probar.'
    : '✅ Todos los agentes del tracker están vinculados con su usuario de Help Scout.\n' +
      'Siguiente paso: "3. Activar sincronización automática".');
}

function menuActivar() {
  eliminarActivadores_();
  ScriptApp.newTrigger('sincronizar').timeBased().everyMinutes(CONFIG.MINUTOS_ENTRE_SINCRONIZACIONES).create();
  sincronizar();
  SpreadsheetApp.getUi().alert('✅ Sincronización activada: cada ' + CONFIG.MINUTOS_ENTRE_SINCRONIZACIONES +
    ' minutos. La foto de "sin atender" se toma a partir de las ' + CONFIG.HORARIO_LABORAL.inicio + ':00.\n\n' +
    'La primera vez puede tardar varias ejecuciones en leer todo el historial desde ' + CONFIG.FECHA_INICIO + '.');
}

function menuDesactivar() {
  eliminarActivadores_();
  SpreadsheetApp.getUi().alert('Sincronización automática desactivada.');
}

function menuSincronizar() {
  const corrio = sincronizar();
  SpreadsheetApp.getActive().toast(corrio
    ? 'Sincronización terminada.'
    : 'Ya hay una sincronización en curso. Espera un minuto y vuelve a intentarlo.', 'Help Scout');
}

function menuFoto() {
  const ss = SpreadsheetApp.getActive();
  const equipo = resolverEquipo_();
  const dia = tomarFotoInicioJornada_(ss, equipo, true);
  if (dia) {
    actualizarTracker_(ss, [dia], equipo);
    ss.toast('Foto de inicio de jornada guardada.', 'Help Scout');
  } else {
    ss.toast('Aún no llega la FECHA_INICIO configurada.', 'Help Scout');
  }
}

function menuResumen() {
  actualizarResumen_(SpreadsheetApp.getActive());
  SpreadsheetApp.getActive().toast('Resumen mensual actualizado.', 'Help Scout');
}

function menuEstado() {
  const props = PropertiesService.getScriptProperties();
  const ultima = props.getProperty('HS_ULTIMA_SYNC');
  const activo = ScriptApp.getProjectTriggers().some(t => t.getHandlerFunction() === 'sincronizar');
  const estado = JSON.parse(props.getProperty('HS_ESTADO_SYNC') || 'null');
  SpreadsheetApp.getUi().alert(
    'Sincronización automática: ' + (activo ? 'ACTIVA' : 'inactiva') + '\n' +
    'Última sincronización: ' + (ultima ? new Date(ultima).toLocaleString() : 'nunca') + '\n' +
    (estado && estado.pagina > 1 ? 'Leyendo historial… (página ' + estado.pagina + ')\n' : '') +
    'Credenciales: ' + (props.getProperty('HS_APP_ID') ? 'configuradas' : 'FALTAN'));
}

/** Borra HS_Eventos, vuelve a leer Help Scout desde FECHA_INICIO y rehace la foto de hoy. */
function menuReiniciar() {
  const ui = SpreadsheetApp.getUi();
  const r = ui.alert('Recalcular todo',
    'Se borrará la pestaña HS_Eventos y se volverá a leer Help Scout desde ' + CONFIG.FECHA_INICIO +
    '. La foto de "sin atender" de hoy se vuelve a tomar con los casos abiertos en este momento.\n' +
    'Puede tardar unos minutos. ¿Continuar?', ui.ButtonSet.YES_NO);
  if (r !== ui.Button.YES) return;
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) {
    ui.alert('Hay una sincronización en curso. Intenta de nuevo en un minuto.');
    return;
  }
  try {
    const ss = SpreadsheetApp.getActive();
    const hoja = ss.getSheetByName(CONFIG.HOJAS.eventos);
    if (hoja && hoja.getLastRow() > 1) hoja.getRange(2, 1, hoja.getLastRow() - 1, hoja.getLastColumn()).clearContent();
    const props = PropertiesService.getScriptProperties();
    props.deleteProperty('HS_ESTADO_SYNC');
    props.deleteProperty('HS_FOTO_DIA');
    CacheService.getScriptCache().remove('HS_USUARIOS');
    sincronizar_();
  } finally {
    lock.releaseLock();
  }
  const pendiente = JSON.parse(PropertiesService.getScriptProperties().getProperty('HS_ESTADO_SYNC') || 'null');
  ui.alert(pendiente && pendiente.pagina > 1
    ? 'Recalculando… Help Scout tiene muchos casos: la sincronización automática termina de leerlos en los próximos minutos.'
    : '✅ Listo: todo recalculado desde ' + CONFIG.FECHA_INICIO + '.');
}

function eliminarActivadores_() {
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === 'sincronizar')
    .forEach(t => ScriptApp.deleteTrigger(t));
}

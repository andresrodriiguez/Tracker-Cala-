// Panel en vivo de soporte + tracker (Help Scout) — archivo generado con `npm run build`.
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
  // true: un caso en 'pending' cuyo ÚLTIMO mensaje es del cliente (la agente lo pasó a pending sin
  // responder) también cuenta como "sin atender". Los pending donde la agente ya respondió y
  // espera al cliente no cuentan.
  CONTAR_PENDING_SIN_RESPONDER: true,

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

/** Todos los días 'yyyy-MM-dd' entre desde y hasta (incluidos). */
function diasEntre(desde, hasta) {
  const dias = [];
  for (let d = new Date(desde + 'T00:00:00Z'); d.toISOString().slice(0, 10) <= hasta; d.setUTCDate(d.getUTCDate() + 1)) {
    dias.push(d.toISOString().slice(0, 10));
  }
  return dias;
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
 *   fechaInicio      → (opcional) 'yyyy-MM-dd'; cerrar un caso que entró a la carga antes de esta
 *                      fecha cuenta como asignado + cerrado ese día
 * @return {Object[]} eventos
 */
/**
 * true si el último mensaje de la conversación (sin contar notas internas ni cambios de estado)
 * es del cliente, es decir, el cliente está esperando respuesta.
 */
function ultimoMensajeEsDelCliente(hilos) {
  const mensajes = (hilos || [])
    .filter(h => (!h.state || h.state === 'published') && ['customer', 'message', 'chat', 'phone'].indexOf(h.type) >= 0)
    .sort((a, b) => (new Date(a.createdAt) - new Date(b.createdAt)) || (a.id - b.id));
  const ultimo = mensajes[mensajes.length - 1];
  return !!ultimo && (ultimo.type === 'customer' || (ultimo.createdBy && ultimo.createdBy.type === 'customer'));
}

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
  let diaEntrada = null;          // último día en que el caso entró a la carga (asignación o nueva consulta)
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
      diaEntrada = dia;
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
        diaEntrada = dia;
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
      // Si el caso estaba sin asignar, o es anterior a la automatización (ctx.fechaInicio) y no
      // está en la carga registrada de la agente, cuenta como asignado y cerrado ese día.
      // Los cierres automáticos de Help Scout (reglas que cierran solos los pending) no cuentan.
      const cierreAutomatico = autor.type !== 'user' || /automatic/i.test(accion);
      let agente = cierreAutomatico ? null : agenteDe(asignado);
      const fueraDeCarga = !agente || (ctx.fechaInicio && !(diaEntrada >= ctx.fechaInicio));
      if (!agente && !cierreAutomatico) agente = ctx.agentePorId(Number(autor.id));
      if (agente && fueraDeCarga) emitir('ASIGNADO', 'A-' + agente.id + '-' + dia, agente, fecha);
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
 * Cada caso cuenta una sola vez por tipo y día. Un caso de días anteriores que se cierra hoy y no
 * estaba en la foto (p. ej. estaba en pending esperando al cliente) se suma a "sin atender", para
 * que todo lo cerrado esté dentro del total y el % no pase de 100%.
 * @param {Object[]} eventos  eventos de ESE agente en ESE día
 * @param {number|{total: number, casos: Array}} foto  foto de inicio de jornada (0/null si no hay)
 */
function contarDia(eventos, foto) {
  const casos = tipo => {
    const s = new Set();
    eventos.forEach((e, i) => {
      if (e.tipo !== tipo) return;
      s.add(e.numero != null && e.numero !== '' && !isNaN(e.numero) ? String(e.numero) : 'evento-' + i);
    });
    return s;
  };
  const asignados = casos('ASIGNADO');
  const nuevas = casos('NUEVA_CONSULTA');
  const cerrados = casos('CERRADO');
  const fotoTotal = typeof foto === 'number' ? foto : (foto && Number(foto.total)) || 0;
  const fotoCasos = foto && foto.casos ? new Set(foto.casos.map(String)) : new Set();
  let cerradosDeAntes = 0;
  cerrados.forEach(n => {
    if (n.indexOf('evento-') !== 0 && !asignados.has(n) && !nuevas.has(n) && !fotoCasos.has(n)) cerradosDeAntes++;
  });
  const c = {
    sinAtender: fotoTotal + cerradosDeAntes,
    asignados: asignados.size,
    nuevaConsulta: nuevas.size,
    reasignados: casos('REASIGNADO').size,
    cerrados: cerrados.size,
  };
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
  const recalculando = !!estado.recalculando; // "Recalcular todo": la hoja se escribe al terminar de leer

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

  const diasTocados = new Set(recalculando ? [] : nuevos.map(e => e.dia));
  // La foto se toma solo con la lectura completa, para descontar bien lo que ya cuenta hoy.
  const foto = terminado ? tomarFotoInicioJornada_(ss, equipo, false) : null;
  if (foto) diasTocados.add(foto);
  if (recalculando && terminado) {
    diasEntre(CONFIG.FECHA_INICIO, Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd')).forEach(d => diasTocados.add(d));
  }

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

/** Foto de inicio de jornada por 'día|agente' → { total, casos } (la última tomada gana). */
function leerFotos_(ss) {
  const hoja = ss.getSheetByName(CONFIG.HOJAS.fotos);
  const fotos = {};
  if (!hoja) return fotos;
  const tz = ss.getSpreadsheetTimeZone();
  const formatear = f => Utilities.formatDate(f, tz, 'yyyy-MM-dd');
  leerFilas_(hoja).forEach(f => {
    fotos[diaDesdeCelda(f[0], formatear) + '|' + normalizarTexto(f[1])] = {
      total: Number(f[3]) || 0,
      casos: (String(f[5] || '').match(/\d+/g) || []),
    };
  });
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
    .addItem('Panel en vivo', 'menuPanelEnVivo')
    .addSeparator()
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
    const tz = ss.getSpreadsheetTimeZone();
    props.setProperty('HS_ESTADO_SYNC', JSON.stringify({
      desde: hsFechaIso_(Utilities.parseDate(CONFIG.FECHA_INICIO, tz, 'yyyy-MM-dd')), pagina: 1, recalculando: true,
    }));
    props.deleteProperty('HS_FOTO_DIA');
    CacheService.getScriptCache().remove('HS_USUARIOS');
    sincronizar_();
  } finally {
    lock.releaseLock();
  }
  const pendiente = JSON.parse(PropertiesService.getScriptProperties().getProperty('HS_ESTADO_SYNC') || 'null');
  ui.alert(pendiente && pendiente.pagina > 1
    ? 'Recalculando… Help Scout tiene muchos casos: la sincronización automática termina de leerlos en los próximos minutos ' +
      'y recién ahí actualiza la hoja. Revisa "Help Scout → Ver estado" en unos 15-30 minutos.'
    : '✅ Listo: todo recalculado desde ' + CONFIG.FECHA_INICIO + '.');
}

function eliminarActivadores_() {
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === 'sincronizar')
    .forEach(t => ScriptApp.deleteTrigger(t));
}

// ===== Logica.gs =====
/** GENERADO desde panel/logica.js con `npm run build`: no editar aquí. */
var Logica = (function () {
  var module = { exports: {} };
/**
 * Lógica pura del panel (la usan el servidor, el navegador y las pruebas).
 *
 * Todo sale del historial de mensajes ("threads") de cada conversación de Help Scout:
 *  - Cliente esperando: el caso está Active o Pending y el último mensaje es del cliente.
 *  - Reloj de espera: desde el PRIMER mensaje del cliente que sigue sin contestar.
 * Las notas internas, las asignaciones y los cambios de estado no cuentan como respuesta.
 * Las cifras del día (respuestas, resueltos, tiempos...) NO se calculan aquí: vienen de los
 * reportes oficiales de Help Scout.
 */
(function (raiz, fabrica) {
  if (typeof module === 'object' && module.exports) module.exports = fabrica();
  else raiz.Logica = fabrica();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  var TIPOS_MENSAJE = ['message', 'chat', 'phone'];

  function hilosPublicados(conv) {
    return ((conv._embedded && conv._embedded.threads) || [])
      .filter(function (h) { return !h.state || h.state === 'published'; })
      .slice()
      .sort(function (a, b) { return (new Date(a.createdAt) - new Date(b.createdAt)) || (a.id - b.id); });
  }
  function idUsuario(p) { return p && Number(p.id) > 0 ? Number(p.id) : null; }
  function esDelCliente(h) { return h.type === 'customer' || (h.createdBy || {}).type === 'customer'; }
  function esRespuesta(h) { return !esDelCliente(h) && (h.createdBy || {}).type === 'user' && TIPOS_MENSAJE.indexOf(h.type) >= 0; }

  /**
   * Conversación de Help Scout (con _embedded.threads) → resumen compacto.
   * @param {Object} conv
   * @param {Date|string} desdeHoy  inicio del día local: los movimientos desde ahí van en `mv`
   * @return {{id, n, s, c, st, a, mb, w, mv}}
   *   w  = fecha ISO desde la que espera el cliente (null si nadie espera)
   *   mv = movimientos de hoy: [tipo, usuarioId, fechaIso]
   *        'C' mensaje del cliente · 'R' respuesta de un usuario · 'X' cierre · 'A' asignación (usuarioId = a quién)
   */
  function resumirConversacion(conv, desdeHoy) {
    var corte = new Date(desdeHoy).getTime();
    var publicada = !conv.state || conv.state === 'published';
    var abierta = publicada && (conv.status === 'active' || conv.status === 'pending');
    var cliente = conv.primaryCustomer || {};
    var nombre = [cliente.first, cliente.last].filter(Boolean).join(' ') || cliente.email || '';
    var mv = [];
    var desde = null, estado = null, asignado;

    hilosPublicados(conv).forEach(function (h) {
      var fecha = new Date(h.createdAt);
      var hoy = fecha.getTime() >= corte;
      var autor = h.createdBy || {};
      var previo = estado;
      if (h.status && h.status !== 'nochange') estado = h.status;

      if ('assignedTo' in h) {
        var nuevo = idUsuario(h.assignedTo);
        if (nuevo !== null && nuevo !== asignado && hoy) mv.push(['A', nuevo, fecha.toISOString()]); // cambió de manos
        asignado = nuevo;
      }
      if (esDelCliente(h)) {
        if (!desde) desde = fecha;
        if (hoy) mv.push(['C', 0, fecha.toISOString()]);
        return;
      }
      if (esRespuesta(h)) {
        desde = null; // le respondieron
        if (hoy) mv.push(['R', Number(autor.id), fecha.toISOString()]);
      }
      if (estado === 'closed' && previo !== 'closed') {
        desde = null; // se cerró el caso
        if (hoy && autor.type === 'user') mv.push(['X', Number(autor.id), fecha.toISOString()]);
      }
    });

    return {
      id: conv.id,
      n: conv.number,
      s: String(conv.subject || '(sin asunto)').slice(0, 140),
      c: String(nombre).slice(0, 60),
      st: publicada ? conv.status : 'deleted',
      a: idUsuario(conv.assignee),
      mb: conv.mailboxId || null,
      w: abierta && desde ? desde.toISOString() : null,
      mv: mv,
    };
  }

  /** ¿Hay que conservar esta conversación en el panel? */
  function esRelevante(c, equipo, mostrarSinAsignar) {
    var abierta = c.st === 'active' || c.st === 'pending';
    if (abierta && c.a && equipo[c.a]) return true;
    if (abierta && !c.a && mostrarSinAsignar) return true;
    return c.mv.some(function (m) { return m[0] !== 'C' && !!equipo[m[1]]; });
  }

  var URL_CASO = 'https://secure.helpscout.net/conversation/';

  /**
   * @param {Object[]} compactos
   * @param {{id: number, nombre: string}[]} agentes  (id null si no está vinculada en Help Scout)
   * @param {{buzones?: Object, mostrarSinAsignar?: boolean, maxFeed?: number}} op
   */
  function armarPanel(compactos, agentes, op) {
    op = op || {};
    var equipo = {};
    agentes.forEach(function (a) { if (a.id) equipo[a.id] = a; });
    var nombre = function (id) { return equipo[id] ? equipo[id].nombre : ''; };
    var ticket = function (c) {
      return {
        id: c.id, numero: c.n, asunto: c.s, cliente: c.c, estado: c.st, esperaDesde: c.w,
        agenteId: c.a && equipo[c.a] ? c.a : null, agente: nombre(c.a),
        buzon: (op.buzones && op.buzones[c.mb]) || '', url: URL_CASO + c.id + '/' + c.n,
      };
    };
    var porEspera = function (x, y) { return String(x.esperaDesde || '9').localeCompare(String(y.esperaDesde || '9')); };

    var abiertos = [], sinAsignar = [], feed = [], ultima = {}, respuestas = {};
    compactos.forEach(function (c) {
      var abierta = c.st === 'active' || c.st === 'pending';
      var delEquipo = !!(c.a && equipo[c.a]);
      if (abierta && delEquipo) abiertos.push(ticket(c));
      if (abierta && !c.a && op.mostrarSinAsignar !== false && c.w) sinAsignar.push(ticket(c));
      c.mv.forEach(function (m) {
        var tipo = m[0], quien = m[1], fecha = m[2];
        if (tipo === 'C') {
          if (delEquipo || !c.a) feed.push({ fecha: fecha, tipo: 'CLIENTE', agente: delEquipo ? nombre(c.a) : '', numero: c.n, asunto: c.s, url: URL_CASO + c.id + '/' + c.n });
          return;
        }
        if (!equipo[quien]) return;
        if (tipo === 'R') {
          respuestas[quien] = (respuestas[quien] || 0) + 1;
          if (!ultima[quien] || fecha > ultima[quien]) ultima[quien] = fecha;
        }
        feed.push({ fecha: fecha, tipo: { R: 'RESPUESTA', X: 'CERRADO', A: 'ASIGNADO' }[tipo], agente: nombre(quien), numero: c.n, asunto: c.s, url: URL_CASO + c.id + '/' + c.n });
      });
    });

    var filas = agentes.map(function (a) {
      var suyos = abiertos.filter(function (t) { return t.agenteId === a.id; });
      var esperando = suyos.filter(function (t) { return t.esperaDesde; }).sort(porEspera);
      return {
        id: a.id, nombre: a.nombre, vinculado: !!a.id,
        esperando: esperando,
        enSeguimiento: suyos.filter(function (t) { return !t.esperaDesde; }).sort(function (x, y) { return x.numero - y.numero; }),
        seguimiento: suyos.length - esperando.length,
        abiertos: suyos.length,
        activos: suyos.filter(function (t) { return t.estado === 'active'; }).length,
        pendientes: suyos.filter(function (t) { return t.estado === 'pending'; }).length,
        ultimaRespuesta: ultima[a.id] || null,
        respuestasVistas: respuestas[a.id] || 0, // conteo directo de hoy, solo para contrastar con el reporte
      };
    });
    var suma = function (k) { return filas.reduce(function (s, f) { return s + (k === 'esperando' ? f.esperando.length : f[k]); }, 0); };
    feed.sort(function (x, y) { return x.fecha < y.fecha ? 1 : x.fecha > y.fecha ? -1 : 0; });
    return {
      agentes: filas,
      sinAsignar: sinAsignar.sort(porEspera),
      equipo: { esperando: suma('esperando'), seguimiento: suma('seguimiento'), abiertos: suma('abiertos'), activos: suma('activos'), pendientes: suma('pendientes') },
      feed: feed.slice(0, op.maxFeed || 60),
      movimientos: feed.length,
    };
  }

  return { resumirConversacion: resumirConversacion, esRelevante: esRelevante, armarPanel: armarPanel };
});

  return module.exports;
})();

// ===== PanelServidor.gs =====
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

// ===== Panel.html =====
const PANEL_HTML = "<!DOCTYPE html>\n<html lang=\"es\">\n<head>\n<meta charset=\"utf-8\">\n<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">\n<base target=\"_top\">\n<title>Soporte · Control en vivo</title>\n<link rel=\"preconnect\" href=\"https://fonts.googleapis.com\">\n<link rel=\"preconnect\" href=\"https://fonts.gstatic.com\" crossorigin>\n<link href=\"https://fonts.googleapis.com/css2?family=Montserrat:wght@400;500;600;700&display=swap\" rel=\"stylesheet\">\n<style>\n\n:root {\n  --bg: #0B0B0C;\n  --surface: #111113;\n  --raised: #18181B;\n  --line: #232327;\n  --line-2: #33333A;\n  --text: #F2F2F3;\n  --text-2: #A6A6AE;\n  --text-3: #85858E;\n  --ok: #5BC79A;\n  --warn: #E2B340;\n  --bad: #F2716B;\n  --r: 6px;\n}\n* { box-sizing: border-box; }\nhtml, body { margin: 0; background: var(--bg); color: var(--text); }\nbody {\n  font-family: 'Montserrat', 'Helvetica Neue', Arial, sans-serif; font-size: 13px; line-height: 1.45; font-weight: 500;\n  font-feature-settings: 'tnum' 1, 'lnum' 1; -webkit-font-smoothing: antialiased;\n}\na { color: inherit; text-decoration: none; }\na:hover { text-decoration: underline; text-underline-offset: 3px; }\nbutton, input, select { font: inherit; color: inherit; }\n:focus-visible { outline: 2px solid var(--text); outline-offset: 2px; }\n.pagina { max-width: 1680px; margin: 0 auto; padding: 0 28px 48px; }\n.num { text-align: right; white-space: nowrap; }\n.ok { color: var(--ok); } .warn { color: var(--warn); } .bad { color: var(--bad); } .tenue { color: var(--text-2); }\n\n/* Cabecera */\n.cab { position: sticky; top: 0; z-index: 5; background: var(--bg); border-bottom: 1px solid var(--line); }\n.cab-in { max-width: 1680px; margin: 0 auto; padding: 0 28px; min-height: 60px; display: flex; align-items: center; gap: 12px 24px; flex-wrap: wrap; }\n.marca { display: flex; align-items: baseline; gap: 12px; margin-right: auto; padding: 14px 0; }\n.marca b { font-size: 15px; font-weight: 700; letter-spacing: .01em; }\n.marca span { font-size: 13px; color: var(--text-2); padding-left: 12px; border-left: 1px solid var(--line-2); }\n.estado-con { display: inline-flex; align-items: center; gap: 8px; font-size: 12px; font-weight: 600; letter-spacing: .06em; text-transform: uppercase; }\n.estado-con i { width: 7px; height: 7px; border-radius: 50%; background: currentColor; }\n.hora { text-align: right; line-height: 1.25; }\n.hora b { display: block; font-size: 17px; font-weight: 600; letter-spacing: .02em; }\n.hora span { font-size: 11.5px; color: var(--text-2); }\n.btn { height: 36px; padding: 0 14px; border-radius: var(--r); border: 1px solid var(--line-2); background: transparent; font-weight: 600; font-size: 12.5px; cursor: pointer; white-space: nowrap; }\n.btn:hover { background: var(--raised); }\n.btn.principal { background: var(--text); color: var(--bg); border-color: var(--text); }\n.btn.principal:hover { background: #D9D9DC; }\n.btn:disabled { opacity: .5; cursor: default; }\n.btn.chico { height: 28px; padding: 0 10px; font-size: 11.5px; }\n.avance { height: 1px; }\n.avance i { display: block; height: 1px; width: 0; background: var(--text-3); transition: width 1s linear; }\n\n.aviso { margin-top: 16px; padding: 10px 14px; border-radius: var(--r); font-size: 12.5px; border: 1px solid var(--line-2); border-left: 3px solid var(--warn); background: var(--surface); }\n.aviso.error { border-left-color: var(--bad); }\n\n.seccion { margin-top: 32px; }\n.seccion-cab { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; flex-wrap: wrap; margin-bottom: 10px; }\n.seccion-cab h2 { margin: 0; font-size: 11.5px; font-weight: 700; letter-spacing: .1em; text-transform: uppercase; }\n.seccion-cab p { margin: 0; font-size: 12px; color: var(--text-2); }\n\n/* Indicadores */\n.indicadores { margin-top: 24px; display: grid; grid-template-columns: repeat(6, minmax(0, 1fr)); border: 1px solid var(--line); border-radius: var(--r); background: var(--surface); }\n.ind { padding: 16px 18px 15px; border-left: 1px solid var(--line); min-width: 0; }\n.ind:first-child { border-left: 0; }\n.ind .l { font-size: 11px; font-weight: 600; letter-spacing: .07em; text-transform: uppercase; color: var(--text-2); }\n.ind .v { font-size: clamp(22px, 1.9vw, 30px); font-weight: 600; letter-spacing: -.02em; line-height: 1.25; margin-top: 6px; white-space: nowrap; }\n.ind .n { font-size: 12px; color: var(--text-2); margin-top: 2px; }\n@media (max-width: 1100px) { .indicadores { grid-template-columns: repeat(3, minmax(0, 1fr)); } .ind:nth-child(4) { border-left: 0; } .ind:nth-child(n+4) { border-top: 1px solid var(--line); } }\n@media (max-width: 620px) { .indicadores { grid-template-columns: repeat(2, minmax(0, 1fr)); } .ind { border-top: 1px solid var(--line); } .ind:nth-child(-n+2) { border-top: 0; } .ind:nth-child(odd) { border-left: 0; } .ind:nth-child(even) { border-left: 1px solid var(--line); } }\n\n/* Tablas */\n.caja { border: 1px solid var(--line); border-radius: var(--r); background: var(--surface); overflow: hidden; }\n.desliza { overflow-x: auto; }\ntable { width: 100%; border-collapse: collapse; }\nth { font-size: 10.5px; font-weight: 600; letter-spacing: .07em; text-transform: uppercase; color: var(--text-2); text-align: left; padding: 10px 14px; border-bottom: 1px solid var(--line); white-space: nowrap; background: var(--surface); }\ntd { padding: 11px 14px; border-bottom: 1px solid var(--line); vertical-align: middle; }\ntbody tr:last-child td, tfoot td { border-bottom: 0; }\ntfoot td { border-top: 1px solid var(--line-2); font-weight: 600; background: var(--raised); }\nth.num { text-align: right; }\n.t-agentes { min-width: 1120px; }\n.t-agentes th, .t-agentes td { padding-left: 9px; padding-right: 9px; }\n.t-agentes th:first-child, .t-agentes td:first-child { padding-left: 16px; }\n.t-agentes tbody tr { cursor: pointer; }\n.t-agentes tbody tr:hover td { background: var(--raised); }\n.t-agentes tbody tr.sel td { background: var(--raised); }\n.t-agentes tbody tr.sel td:first-child { box-shadow: inset 2px 0 0 var(--text); }\n.t-agentes td.fuerte { font-size: 15px; font-weight: 600; }\n.nombre { font-weight: 600; font-size: 13.5px; white-space: nowrap; }\n.est { display: inline-flex; align-items: center; gap: 7px; font-size: 11.5px; font-weight: 600; white-space: nowrap; margin-top: 3px; }\n.est i { width: 7px; height: 7px; border-radius: 50%; background: currentColor; flex: none; }\n.grupo-izq { border-left: 1px solid var(--line); }\n\n/* Pestañas */\n.pestanas { display: flex; gap: 22px; padding: 0 16px; border-bottom: 1px solid var(--line); overflow-x: auto; }\n.pest { background: none; border: 0; padding: 13px 0 12px; font-size: 12.5px; font-weight: 600; color: var(--text-2); cursor: pointer; border-bottom: 2px solid transparent; white-space: nowrap; }\n.pest:hover { color: var(--text); }\n.pest.sel { color: var(--text); border-bottom-color: var(--text); }\n.pest span { color: var(--text-3); font-weight: 500; margin-left: 5px; }\n.t-cola { min-width: 760px; }\n.t-cola tbody tr:hover td { background: var(--raised); }\n.espera { font-weight: 600; font-size: 13px; white-space: nowrap; }\n.barra { display: block; width: 84px; height: 2px; background: var(--line-2); margin-top: 5px; }\n.barra i { display: block; height: 2px; background: currentColor; }\n.asunto { max-width: 380px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }\n.vacio { padding: 28px 16px; text-align: center; color: var(--text-2); }\n\n.dos { display: flex; flex-wrap: wrap; gap: 20px; align-items: flex-start; }\n.dos > .col-a { flex: 999 1 720px; min-width: 0; }\n.dos > .col-b { flex: 1 1 380px; min-width: 0; }\n\n/* Registro */\n.registro { list-style: none; margin: 0; padding: 0; max-height: 620px; overflow-y: auto; }\n.registro li { display: grid; grid-template-columns: 48px 96px minmax(0, 1fr); gap: 10px; padding: 9px 16px; border-bottom: 1px solid var(--line); align-items: baseline; }\n.registro li:last-child { border-bottom: 0; }\n.registro time { color: var(--text-2); font-size: 12px; }\n.registro .tipo { font-size: 10.5px; font-weight: 700; letter-spacing: .07em; text-transform: uppercase; }\n.registro .txt { min-width: 0; }\n.registro .txt small { display: block; color: var(--text-2); font-size: 11.5px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }\n\n.pie { margin-top: 28px; padding-top: 14px; border-top: 1px solid var(--line); font-size: 11.5px; color: var(--text-2); display: flex; justify-content: space-between; gap: 8px 24px; flex-wrap: wrap; }\n.cargando { color: var(--text-2); padding: 80px 0; text-align: center; }\n\n/* Diálogos */\ndialog { border: 1px solid var(--line-2); border-radius: 8px; background: var(--surface); color: var(--text); padding: 0; width: min(1120px, calc(100vw - 32px)); max-height: calc(100vh - 32px); box-shadow: 0 24px 80px rgba(0, 0, 0, .6); }\ndialog::backdrop { background: rgba(0, 0, 0, .66); }\n.dlg-cab { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 16px 20px; border-bottom: 1px solid var(--line); position: sticky; top: 0; background: var(--surface); z-index: 1; }\n.dlg-cab h3 { margin: 0; font-size: 15px; font-weight: 700; }\n.dlg-cab p { margin: 2px 0 0; font-size: 12px; color: var(--text-2); }\n.dlg-cuerpo { padding: 20px; }\n.filtros { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 20px 28px; }\n.campo > label, .campo > .rot { display: block; font-size: 10.5px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; color: var(--text-2); margin-bottom: 8px; }\n.campo input[type=date], .campo select { height: 36px; padding: 0 10px; border-radius: var(--r); border: 1px solid var(--line-2); background: var(--bg); color-scheme: dark; width: 100%; }\n.fechas { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-top: 8px; }\n.fechas span { display: block; font-size: 11px; color: var(--text-2); margin-bottom: 3px; }\n.checks { display: flex; flex-direction: column; gap: 2px; }\n.checks label { display: flex; align-items: center; gap: 9px; min-height: 28px; font-size: 13px; cursor: pointer; }\n.checks input { width: 15px; height: 15px; accent-color: #F2F2F3; }\n.acciones { display: flex; gap: 10px; flex-wrap: wrap; align-items: center; margin-top: 22px; padding-top: 18px; border-top: 1px solid var(--line); }\n.acciones .nota { font-size: 12px; color: var(--text-2); margin-left: auto; }\n.previa { margin-top: 20px; }\n.previa h4 { margin: 0 0 8px; font-size: 11.5px; font-weight: 700; letter-spacing: .1em; text-transform: uppercase; }\n.previa table { min-width: 980px; }\n.resumen-dlg { display: flex; gap: 28px; flex-wrap: wrap; margin-bottom: 18px; }\n.resumen-dlg div b { display: block; font-size: 20px; font-weight: 600; }\n.resumen-dlg div span { font-size: 11px; color: var(--text-2); text-transform: uppercase; letter-spacing: .07em; font-weight: 600; }\n\n@media (max-width: 640px) {\n  .pagina, .cab-in { padding-left: 16px; padding-right: 16px; }\n  .marca span { display: none; }\n  .hora { text-align: left; }\n  .registro li { grid-template-columns: 44px 92px minmax(0, 1fr); padding: 9px 12px; }\n}\n\n/* Encabezado agrupado de la tabla de agentes */\n.t-agentes thead tr.grupos th { font-size: 10px; color: var(--text-3); padding-top: 9px; padding-bottom: 0; border-bottom: 0; }\n.t-agentes thead tr.grupos + tr th { padding-top: 5px; }\n.fuente { font-size: 11.5px; color: var(--text-2); }\n[hidden] { display: none !important; }\n.linea-check { display: flex; align-items: center; gap: 9px; min-height: 28px; font-size: 13px; cursor: pointer; }\n.linea-check input { width: 15px; height: 15px; accent-color: #F2F2F3; }\n</style>\n</head>\n<body>\n<div id=\"app\">\n<header class=\"cab\">\n  <div class=\"cab-in\">\n    <div class=\"marca\"><b>Soporte</b><span>Control en vivo · Help Scout</span></div>\n    <span id=\"conexion\" class=\"estado-con tenue\"><i></i><span>Conectando</span></span>\n    <div class=\"hora\"><b id=\"reloj\">--:--:--</b><span id=\"actualizado\">Cargando</span></div>\n    <button type=\"button\" class=\"btn\" id=\"btnPausa\" aria-pressed=\"false\">Pausar</button>\n    <button type=\"button\" class=\"btn principal\" id=\"btnExportar\">Exportar métricas</button>\n  </div>\n  <div class=\"avance\"><i id=\"avance\"></i></div>\n</header>\n\n<main class=\"pagina\">\n  <div id=\"avisos\"></div>\n  <div id=\"contenido\"><div class=\"cargando\" id=\"progreso\">Leyendo Help Scout.</div></div>\n</main>\n</div>\n\n<dialog id=\"dlgExportar\" aria-labelledby=\"tituloExportar\">\n  <div class=\"dlg-cab\">\n    <div><h3 id=\"tituloExportar\">Exportar métricas</h3><p>Cifras de los reportes oficiales de Help Scout (las mismas de su sección Reports).</p></div>\n    <button type=\"button\" class=\"btn chico\" data-cerrar>Cerrar</button>\n  </div>\n  <div class=\"dlg-cuerpo\">\n    <div class=\"filtros\">\n      <div class=\"campo\">\n        <label for=\"expPeriodo\">Periodo</label>\n        <select id=\"expPeriodo\">\n          <option value=\"hoy\">Hoy</option>\n          <option value=\"ayer\">Ayer</option>\n          <option value=\"semana\" selected>Esta semana</option>\n          <option value=\"semanaPasada\">Semana pasada</option>\n          <option value=\"mes\">Este mes</option>\n          <option value=\"mesPasado\">Mes pasado</option>\n          <option value=\"90\">Últimos 90 días</option>\n          <option value=\"personal\">Personalizado</option>\n        </select>\n        <div class=\"fechas\">\n          <div><span>Desde</span><input type=\"date\" id=\"expDesde\" aria-label=\"Desde\"></div>\n          <div><span>Hasta</span><input type=\"date\" id=\"expHasta\" aria-label=\"Hasta\"></div>\n        </div>\n      </div>\n      <div class=\"campo\">\n        <span class=\"rot\">Agentes</span>\n        <div class=\"checks\" id=\"expAgentes\"></div>\n      </div>\n      <div class=\"campo\">\n        <span class=\"rot\">Contenido del archivo</span>\n        <div class=\"checks\">\n          <label><input type=\"checkbox\" checked disabled> Resumen por agente</label>\n          <label><input type=\"checkbox\" id=\"expSeries\" checked> Evolución por día, semana o mes</label>\n          <label><input type=\"checkbox\" id=\"expCasos\"> Lista de conversaciones con sus tiempos (más lento)</label>\n          <label><input type=\"checkbox\" id=\"expOficina\"> Tiempos solo en horario de oficina de Help Scout</label>\n        </div>\n      </div>\n    </div>\n    <div class=\"acciones\">\n      <button type=\"button\" class=\"btn\" id=\"expVer\">Ver vista previa</button>\n      <button type=\"button\" class=\"btn principal\" id=\"expExcel\">Descargar Excel</button>\n      <select id=\"expCsvHoja\" aria-label=\"Hoja para CSV\" style=\"height:36px;padding:0 10px;border-radius:6px;border:1px solid var(--line-2);background:var(--bg);color-scheme:dark\">\n        <option value=\"resumen\">CSV · Resumen por agente</option>\n        <option value=\"series\">CSV · Evolución</option>\n        <option value=\"casos\">CSV · Conversaciones</option>\n      </select>\n      <button type=\"button\" class=\"btn\" id=\"expCsv\">Descargar CSV</button>\n      <span class=\"nota\" id=\"expEstado\" role=\"status\"></span>\n    </div>\n    <div class=\"previa\" id=\"expPrevia\"></div>\n  </div>\n</dialog>\n\n<dialog id=\"dlgDetalle\" aria-labelledby=\"tituloDetalle\">\n  <div class=\"dlg-cab\">\n    <div><h3 id=\"tituloDetalle\">Detalle</h3><p id=\"subDetalle\"></p></div>\n    <button type=\"button\" class=\"btn chico\" data-cerrar>Cerrar</button>\n  </div>\n  <div class=\"dlg-cuerpo\" id=\"cuerpoDetalle\"></div>\n</dialog>\n\n<script>\n/**\n * Lógica pura del panel (la usan el servidor, el navegador y las pruebas).\n *\n * Todo sale del historial de mensajes (\"threads\") de cada conversación de Help Scout:\n *  - Cliente esperando: el caso está Active o Pending y el último mensaje es del cliente.\n *  - Reloj de espera: desde el PRIMER mensaje del cliente que sigue sin contestar.\n * Las notas internas, las asignaciones y los cambios de estado no cuentan como respuesta.\n * Las cifras del día (respuestas, resueltos, tiempos...) NO se calculan aquí: vienen de los\n * reportes oficiales de Help Scout.\n */\n(function (raiz, fabrica) {\n  if (typeof module === 'object' && module.exports) module.exports = fabrica();\n  else raiz.Logica = fabrica();\n})(typeof self !== 'undefined' ? self : this, function () {\n  'use strict';\n  var TIPOS_MENSAJE = ['message', 'chat', 'phone'];\n\n  function hilosPublicados(conv) {\n    return ((conv._embedded && conv._embedded.threads) || [])\n      .filter(function (h) { return !h.state || h.state === 'published'; })\n      .slice()\n      .sort(function (a, b) { return (new Date(a.createdAt) - new Date(b.createdAt)) || (a.id - b.id); });\n  }\n  function idUsuario(p) { return p && Number(p.id) > 0 ? Number(p.id) : null; }\n  function esDelCliente(h) { return h.type === 'customer' || (h.createdBy || {}).type === 'customer'; }\n  function esRespuesta(h) { return !esDelCliente(h) && (h.createdBy || {}).type === 'user' && TIPOS_MENSAJE.indexOf(h.type) >= 0; }\n\n  /**\n   * Conversación de Help Scout (con _embedded.threads) → resumen compacto.\n   * @param {Object} conv\n   * @param {Date|string} desdeHoy  inicio del día local: los movimientos desde ahí van en `mv`\n   * @return {{id, n, s, c, st, a, mb, w, mv}}\n   *   w  = fecha ISO desde la que espera el cliente (null si nadie espera)\n   *   mv = movimientos de hoy: [tipo, usuarioId, fechaIso]\n   *        'C' mensaje del cliente · 'R' respuesta de un usuario · 'X' cierre · 'A' asignación (usuarioId = a quién)\n   */\n  function resumirConversacion(conv, desdeHoy) {\n    var corte = new Date(desdeHoy).getTime();\n    var publicada = !conv.state || conv.state === 'published';\n    var abierta = publicada && (conv.status === 'active' || conv.status === 'pending');\n    var cliente = conv.primaryCustomer || {};\n    var nombre = [cliente.first, cliente.last].filter(Boolean).join(' ') || cliente.email || '';\n    var mv = [];\n    var desde = null, estado = null, asignado;\n\n    hilosPublicados(conv).forEach(function (h) {\n      var fecha = new Date(h.createdAt);\n      var hoy = fecha.getTime() >= corte;\n      var autor = h.createdBy || {};\n      var previo = estado;\n      if (h.status && h.status !== 'nochange') estado = h.status;\n\n      if ('assignedTo' in h) {\n        var nuevo = idUsuario(h.assignedTo);\n        if (nuevo !== null && nuevo !== asignado && hoy) mv.push(['A', nuevo, fecha.toISOString()]); // cambió de manos\n        asignado = nuevo;\n      }\n      if (esDelCliente(h)) {\n        if (!desde) desde = fecha;\n        if (hoy) mv.push(['C', 0, fecha.toISOString()]);\n        return;\n      }\n      if (esRespuesta(h)) {\n        desde = null; // le respondieron\n        if (hoy) mv.push(['R', Number(autor.id), fecha.toISOString()]);\n      }\n      if (estado === 'closed' && previo !== 'closed') {\n        desde = null; // se cerró el caso\n        if (hoy && autor.type === 'user') mv.push(['X', Number(autor.id), fecha.toISOString()]);\n      }\n    });\n\n    return {\n      id: conv.id,\n      n: conv.number,\n      s: String(conv.subject || '(sin asunto)').slice(0, 140),\n      c: String(nombre).slice(0, 60),\n      st: publicada ? conv.status : 'deleted',\n      a: idUsuario(conv.assignee),\n      mb: conv.mailboxId || null,\n      w: abierta && desde ? desde.toISOString() : null,\n      mv: mv,\n    };\n  }\n\n  /** ¿Hay que conservar esta conversación en el panel? */\n  function esRelevante(c, equipo, mostrarSinAsignar) {\n    var abierta = c.st === 'active' || c.st === 'pending';\n    if (abierta && c.a && equipo[c.a]) return true;\n    if (abierta && !c.a && mostrarSinAsignar) return true;\n    return c.mv.some(function (m) { return m[0] !== 'C' && !!equipo[m[1]]; });\n  }\n\n  var URL_CASO = 'https://secure.helpscout.net/conversation/';\n\n  /**\n   * @param {Object[]} compactos\n   * @param {{id: number, nombre: string}[]} agentes  (id null si no está vinculada en Help Scout)\n   * @param {{buzones?: Object, mostrarSinAsignar?: boolean, maxFeed?: number}} op\n   */\n  function armarPanel(compactos, agentes, op) {\n    op = op || {};\n    var equipo = {};\n    agentes.forEach(function (a) { if (a.id) equipo[a.id] = a; });\n    var nombre = function (id) { return equipo[id] ? equipo[id].nombre : ''; };\n    var ticket = function (c) {\n      return {\n        id: c.id, numero: c.n, asunto: c.s, cliente: c.c, estado: c.st, esperaDesde: c.w,\n        agenteId: c.a && equipo[c.a] ? c.a : null, agente: nombre(c.a),\n        buzon: (op.buzones && op.buzones[c.mb]) || '', url: URL_CASO + c.id + '/' + c.n,\n      };\n    };\n    var porEspera = function (x, y) { return String(x.esperaDesde || '9').localeCompare(String(y.esperaDesde || '9')); };\n\n    var abiertos = [], sinAsignar = [], feed = [], ultima = {}, respuestas = {};\n    compactos.forEach(function (c) {\n      var abierta = c.st === 'active' || c.st === 'pending';\n      var delEquipo = !!(c.a && equipo[c.a]);\n      if (abierta && delEquipo) abiertos.push(ticket(c));\n      if (abierta && !c.a && op.mostrarSinAsignar !== false && c.w) sinAsignar.push(ticket(c));\n      c.mv.forEach(function (m) {\n        var tipo = m[0], quien = m[1], fecha = m[2];\n        if (tipo === 'C') {\n          if (delEquipo || !c.a) feed.push({ fecha: fecha, tipo: 'CLIENTE', agente: delEquipo ? nombre(c.a) : '', numero: c.n, asunto: c.s, url: URL_CASO + c.id + '/' + c.n });\n          return;\n        }\n        if (!equipo[quien]) return;\n        if (tipo === 'R') {\n          respuestas[quien] = (respuestas[quien] || 0) + 1;\n          if (!ultima[quien] || fecha > ultima[quien]) ultima[quien] = fecha;\n        }\n        feed.push({ fecha: fecha, tipo: { R: 'RESPUESTA', X: 'CERRADO', A: 'ASIGNADO' }[tipo], agente: nombre(quien), numero: c.n, asunto: c.s, url: URL_CASO + c.id + '/' + c.n });\n      });\n    });\n\n    var filas = agentes.map(function (a) {\n      var suyos = abiertos.filter(function (t) { return t.agenteId === a.id; });\n      var esperando = suyos.filter(function (t) { return t.esperaDesde; }).sort(porEspera);\n      return {\n        id: a.id, nombre: a.nombre, vinculado: !!a.id,\n        esperando: esperando,\n        enSeguimiento: suyos.filter(function (t) { return !t.esperaDesde; }).sort(function (x, y) { return x.numero - y.numero; }),\n        seguimiento: suyos.length - esperando.length,\n        abiertos: suyos.length,\n        activos: suyos.filter(function (t) { return t.estado === 'active'; }).length,\n        pendientes: suyos.filter(function (t) { return t.estado === 'pending'; }).length,\n        ultimaRespuesta: ultima[a.id] || null,\n        respuestasVistas: respuestas[a.id] || 0, // conteo directo de hoy, solo para contrastar con el reporte\n      };\n    });\n    var suma = function (k) { return filas.reduce(function (s, f) { return s + (k === 'esperando' ? f.esperando.length : f[k]); }, 0); };\n    feed.sort(function (x, y) { return x.fecha < y.fecha ? 1 : x.fecha > y.fecha ? -1 : 0; });\n    return {\n      agentes: filas,\n      sinAsignar: sinAsignar.sort(porEspera),\n      equipo: { esperando: suma('esperando'), seguimiento: suma('seguimiento'), abiertos: suma('abiertos'), activos: suma('activos'), pendientes: suma('pendientes') },\n      feed: feed.slice(0, op.maxFeed || 60),\n      movimientos: feed.length,\n    };\n  }\n\n  return { resumirConversacion: resumirConversacion, esRelevante: esRelevante, armarPanel: armarPanel };\n});\n</script>\n<script>\n/* Panel en vivo: pide los datos al servidor (apiPanel), guarda el estado en el navegador y pinta la página. */\n(function () {\n  'use strict';\n  // Dentro de Apps Script existe google.script.run; fuera (al abrir el archivo suelto) se usan datos de ejemplo.\n  var GAS = typeof google !== 'undefined' && google.script && google.script.run;\n  var DEMO = !GAS;\n  var E = {\n    cfg: null, agentes: [], buzones: {}, sinVincular: [], hoy: null, inicioHoy: null, enHorario: true,\n    convs: {}, cursor: null, baseEn: 0, cargandoBase: false, verificacion: null,\n    reporte: null, reporteEn: 0, panel: null,\n  };\n  var desfase = 0, filtro = 'todos', pausado = false, enCurso = false, ultimaOk = 0, proxima = 0, temporizador = null, errorActual = '';\n  var exportacion = null;\n\n  var $ = function (id) { return document.getElementById(id); };\n  var todos = function (sel, raiz) { return Array.prototype.slice.call((raiz || document).querySelectorAll(sel)); };\n  var ahora = function () { return Date.now() + desfase; };\n  var esc = function (t) {\n    return String(t == null ? '' : t).replace(/[&<>\"']/g, function (c) {\n      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '\"': '&quot;', \"'\": '&#39;' }[c];\n    });\n  };\n  var p2 = function (n) { return (n < 10 ? '0' : '') + n; };\n  function dur(seg) {\n    seg = Math.max(0, Math.floor(seg));\n    var d = Math.floor(seg / 86400), h = Math.floor(seg % 86400 / 3600), m = Math.floor(seg % 3600 / 60), s = seg % 60;\n    return (d ? d + ' d ' : '') + p2(h) + ':' + p2(m) + ':' + p2(s);\n  }\n  function corto(seg) {\n    if (seg == null) return '—';\n    seg = Math.max(0, Math.round(seg));\n    if (seg < 60) return seg + ' s';\n    if (seg < 3600) return Math.floor(seg / 60) + ' min';\n    if (seg < 86400) return Math.floor(seg / 3600) + ' h ' + p2(Math.floor(seg % 3600 / 60)) + ' min';\n    return Math.floor(seg / 86400) + ' d ' + Math.floor(seg % 86400 / 3600) + ' h';\n  }\n  var num = function (v) { return v == null ? '—' : Number(v).toLocaleString('es', { maximumFractionDigits: 1 }); };\n  var tz = function () { return (E.cfg && E.cfg.tz) || 'America/New_York'; };\n  function hora(ms, seg) {\n    var o = { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: tz() };\n    if (seg) o.second = '2-digit';\n    try { return new Date(ms).toLocaleTimeString('es', o); } catch (e) { return new Date(ms).toTimeString().slice(0, seg ? 8 : 5); }\n  }\n  function diaLocal(ms) {\n    try { return new Intl.DateTimeFormat('en-CA', { timeZone: tz(), year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ms)); }\n    catch (e) { return new Date(ms).toISOString().slice(0, 10); }\n  }\n  function diaLargo(d) {\n    try { return new Date(d + 'T12:00:00Z').toLocaleDateString('es', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' }); } catch (e) { return d; }\n  }\n  function tono(min) {\n    var meta = (E.cfg && E.cfg.metaRespuestaMin) || 60;\n    return min < meta / 2 ? 'ok' : min < meta ? 'warn' : 'bad';\n  }\n\n  // ---------- Servidor ----------\n  function api(ruta) {\n    var llamada = DEMO ? window.DemoApi(ruta) : new Promise(function (listo) {\n      google.script.run\n        .withSuccessHandler(listo)\n        .withFailureHandler(function (err) { listo(JSON.stringify({ ok: false, error: String((err && err.message) || err) })); })\n        .apiPanel(ruta);\n    });\n    return llamada.then(function (texto) {\n      var d;\n      try { d = typeof texto === 'string' ? JSON.parse(texto) : texto; } catch (e) { d = { ok: false, error: 'Respuesta no válida del servidor.' }; }\n      if (!d.ok) throw new Error(d.error || 'Error desconocido.');\n      if (d.ahora) desfase = Date.parse(d.ahora) - Date.now();\n      return d;\n    });\n  }\n\n  // ---------- Carga completa (y verificación contra Help Scout) ----------\n  function relevante(c) {\n    var equipo = {};\n    E.agentes.forEach(function (a) { if (a.id) equipo[a.id] = a; });\n    return Logica.esRelevante(c, equipo, E.cfg.mostrarSinAsignar);\n  }\n  function progreso(texto) { var el = $('progreso'); if (el) el.textContent = texto; }\n\n  function cargarBase() {\n    E.cargandoBase = true;\n    var nuevas = {}, control = [], colaCompleta = true, inicio;\n    var guardar = function (lista) { lista.forEach(function (c) { if (relevante(c)) nuevas[c.id] = c; else delete nuevas[c.id]; }); };\n    return api('/api/equipo').then(function (eq) {\n      E.cfg = eq.config; E.agentes = eq.agentes; E.buzones = eq.buzones; E.sinVincular = eq.sinVincular;\n      E.hoy = eq.hoy; E.inicioHoy = eq.inicioHoy; E.enHorario = eq.enHorario;\n      inicio = eq.ahora;\n      var vinculadas = E.agentes.filter(function (a) { return a.id; });\n      // 1) Casos abiertos de cada agente, una por una.\n      return vinculadas.reduce(function (cadena, a) {\n        return cadena.then(function () {\n          progreso('Leyendo los casos abiertos de ' + a.nombre + '.');\n          return api('/api/abiertos?agente=' + a.id).then(function (r) {\n            guardar(r.compactos);\n            ['active', 'pending'].forEach(function (st) { control.push({ agente: a.nombre, id: a.id, estado: st, helpScout: r.totales[st].helpScout, leidos: r.totales[st].leidos }); });\n          });\n        });\n      }, Promise.resolve());\n    }).then(function () {\n      // 2) Cola sin asignar.\n      if (!E.cfg.mostrarSinAsignar) return null;\n      progreso('Leyendo la cola sin asignar.');\n      return api('/api/abiertos?agente=sin').then(function (r) { guardar(r.compactos); colaCompleta = r.completo; });\n    }).then(function () {\n      // 3) Movimientos de hoy (para el registro de actividad y la última respuesta de cada agente).\n      var leer = function (pagina, vueltas) {\n        progreso('Leyendo los movimientos de hoy (página ' + pagina + ').');\n        return api('/api/cambios?desde=' + encodeURIComponent(E.inicioHoy) + '&pagina=' + pagina).then(function (r) {\n          guardar(r.compactos);\n          return r.siguiente && vueltas < 60 ? leer(r.siguiente, vueltas + 1) : null;\n        });\n      };\n      return leer(1, 0);\n    }).then(function () {\n      E.convs = nuevas;\n      E.cursor = inicio;\n      E.baseEn = Date.now();\n      // Verificación: lo leído debe coincidir con los totales que informa Help Scout,\n      // y los abiertos del panel deben ser exactamente Active + Pending de cada agente.\n      var avisos = [];\n      control.forEach(function (c) {\n        if (c.helpScout != null && c.helpScout !== c.leidos) avisos.push(c.agente + ' (' + c.estado + '): Help Scout informa ' + c.helpScout + ' y se leyeron ' + c.leidos);\n      });\n      if (!colaCompleta) avisos.push('La cola sin asignar tiene más casos de los que se muestran');\n      E.verificacion = {\n        hora: Date.now(), ok: !avisos.length, avisos: avisos,\n        abiertos: control.reduce(function (s, c) { return s + c.leidos; }, 0), control: control,\n      };\n      E.cargandoBase = false;\n    }).catch(function (e) { E.cargandoBase = false; throw e; });\n  }\n\n  // ---------- Actualización incremental ----------\n  function cargarCambios() {\n    var desde = new Date(Date.parse(E.cursor) - 120000).toISOString(); // 2 min de solape\n    var leer = function (pagina, vueltas, cursor) {\n      return api('/api/cambios?desde=' + encodeURIComponent(desde) + '&pagina=' + pagina).then(function (r) {\n        r.compactos.forEach(function (c) { if (relevante(c)) E.convs[c.id] = c; else delete E.convs[c.id]; });\n        cursor = cursor || r.cursor;\n        return r.siguiente && vueltas < 10 ? leer(r.siguiente, vueltas + 1, cursor) : cursor;\n      });\n    };\n    return leer(1, 0, null).then(function (cursor) { E.cursor = cursor; });\n  }\n\n  function cargarReporte() {\n    return api('/api/reporte?desde=' + E.hoy + '&hasta=' + E.hoy).then(function (r) {\n      var porId = {};\n      r.filas.forEach(function (f) { porId[f.id] = f; });\n      E.reporte = { disponible: r.disponible, motivo: r.motivo, porId: porId, hora: Date.now() };\n      E.reporteEn = Date.now();\n    }).catch(function (e) {\n      E.reporte = { disponible: false, motivo: 'No se pudieron leer los reportes de Help Scout: ' + e.message, porId: {}, hora: Date.now() };\n      E.reporteEn = Date.now();\n    });\n  }\n\n  function intervalo() {\n    if (!E.cfg) return 5;\n    return E.enHorario ? E.cfg.segundos : E.cfg.segundosFueraDeHorario;\n  }\n  function ciclo() {\n    if (enCurso || pausado) return;\n    enCurso = true;\n    var cambioDeDia = E.hoy && diaLocal(ahora()) !== E.hoy;\n    var tocaBase = !E.baseEn || cambioDeDia || Date.now() - E.baseEn > E.cfg.minutosRecarga * 60000;\n    var paso = tocaBase ? cargarBase() : cargarCambios();\n    paso.then(function () {\n      if (!E.reporteEn || cambioDeDia || Date.now() - E.reporteEn > E.cfg.segundosReportes * 1000) return cargarReporte();\n    }).then(function () {\n      errorActual = ''; ultimaOk = Date.now();\n      pintar();\n    }).catch(function (e) {\n      errorActual = e.message || String(e);\n      pintarAvisos(); tic();\n    }).then(function () {\n      enCurso = false;\n      programar();\n    });\n  }\n  function programar() {\n    clearTimeout(temporizador);\n    if (pausado) return;\n    var s = errorActual ? Math.max(15, intervalo()) : intervalo();\n    proxima = Date.now() + s * 1000;\n    temporizador = setTimeout(ciclo, s * 1000);\n  }\n  function arrancar() {\n    E.baseEn = 0; E.reporteEn = 0;\n    ciclo();\n  }\n\n  // ---------- Pintado ----------\n  function pintarAvisos() {\n    var h = '';\n    if (errorActual) {\n      h += '<div class=\"aviso error\" role=\"alert\"><b>No se pudo leer Help Scout.</b> ' + esc(errorActual) +\n        (ultimaOk ? ' Se muestran los últimos datos recibidos (' + hora(ultimaOk + desfase, true) + ').' : '') + '</div>';\n    }\n    if (E.verificacion && !E.verificacion.ok) {\n      h += '<div class=\"aviso error\" role=\"alert\"><b>La lectura no cuadra con Help Scout.</b> ' + esc(E.verificacion.avisos.join(' · ')) + '</div>';\n    }\n    if (E.reporte && !E.reporte.disponible) {\n      h += '<div class=\"aviso\"><b>Sin reportes del día.</b> ' + esc(E.reporte.motivo) + ' Las columnas \"Hoy\" quedan vacías; lo que pasa en este momento sí se muestra.</div>';\n    }\n    if (E.sinVincular.length) h += '<div class=\"aviso\">No encontré en Help Scout a: ' + esc(E.sinVincular.join(', ')) + '. Revisa su email en la configuración (AGENTES).</div>';\n    if (DEMO) h += '<div class=\"aviso\">Vista de demostración con datos de ejemplo.</div>';\n    $('avisos').innerHTML = h;\n  }\n  function reloj(desde, clases, extra) {\n    return '<span class=\"reloj ' + (clases || '') + '\" data-desde=\"' + esc(desde) + '\"' + (extra || '') + '>' + dur((ahora() - Date.parse(desde)) / 1000) + '</span>';\n  }\n  function ind(l, v, n) { return '<div class=\"ind\"><div class=\"l\">' + esc(l) + '</div><div class=\"v\">' + v + '</div><div class=\"n\">' + esc(n) + '</div></div>'; }\n  function rep(id) { return (E.reporte && E.reporte.disponible && E.reporte.porId[id]) || null; }\n  function sumaRep(campo) {\n    if (!E.reporte || !E.reporte.disponible) return null;\n    return E.agentes.reduce(function (s, a) { var r = rep(a.id); return s + ((r && r[campo]) || 0); }, 0);\n  }\n\n  function pintar() {\n    pintarAvisos();\n    var p = E.panel = Logica.armarPanel(Object.keys(E.convs).map(function (k) { return E.convs[k]; }), E.agentes, { buzones: E.buzones, mostrarSinAsignar: E.cfg.mostrarSinAsignar, maxFeed: 60 });\n    var e = p.equipo, viejo = null;\n    p.agentes.forEach(function (a) { if (a.esperando.length && (!viejo || a.esperando[0].esperaDesde < viejo)) viejo = a.esperando[0].esperaDesde; });\n    var hayRep = E.reporte && E.reporte.disponible;\n    var h = '';\n    h += '<section class=\"indicadores\" aria-label=\"Indicadores del equipo\">' +\n      ind('Clientes esperando', e.esperando, 'casos asignados con el cliente esperando') +\n      ind('Mayor espera', viejo ? reloj(viejo, '', ' data-tono=\"1\"') : '—', viejo ? 'reloj en vivo · hh:mm:ss' : 'nadie esperando') +\n      ind('Casos abiertos', e.abiertos, e.activos + ' Active · ' + e.pendientes + ' Pending') +\n      ind('Respuestas hoy', hayRep ? num(sumaRep('totalReplies')) : '—', hayRep ? 'según Reports de Help Scout' : 'reporte no disponible') +\n      ind('Resueltos hoy', hayRep ? num(sumaRep('resolved')) : '—', hayRep ? num(sumaRep('closed')) + ' cerrados · según Reports' : 'reporte no disponible') +\n      ind('Sin asignar', p.sinAsignar.length, p.sinAsignar.length ? 'con el cliente esperando' : 'cola vacía') +\n      '</section>';\n\n    h += '<section class=\"seccion\"><div class=\"seccion-cab\"><h2>Agentes</h2><p>' + esc(diaLargo(E.hoy)) + ' · clic en una fila para filtrar la cola</p></div>' +\n      '<div class=\"caja\"><div class=\"desliza\"><table class=\"t-agentes\"><thead>' +\n      '<tr class=\"grupos\"><th></th><th colspan=\"4\" class=\"grupo-izq\">En este momento</th><th colspan=\"7\" class=\"grupo-izq\">Hoy · Reports de Help Scout' +\n      (hayRep ? ' · ' + hora(E.reporte.hora + desfase, false) : '') + '</th><th colspan=\"2\" class=\"grupo-izq\"></th></tr>' +\n      '<tr><th>Agente</th><th class=\"num grupo-izq\">Esperando</th><th class=\"num\">Mayor espera</th><th class=\"num\">Seguimiento</th><th class=\"num\">Abiertos</th>' +\n      '<th class=\"num grupo-izq\">Respuestas</th><th class=\"num\">Conversaciones</th><th class=\"num\">Clientes</th><th class=\"num\">Resueltos</th><th class=\"num\">Cerrados</th><th class=\"num\">T. respuesta</th><th class=\"num\">T. resolución</th>' +\n      '<th class=\"num grupo-izq\">Últ. respuesta</th><th></th></tr></thead><tbody>' + p.agentes.map(filaAgente).join('') + '</tbody><tfoot><tr><td>Equipo</td>' +\n      '<td class=\"num grupo-izq\">' + e.esperando + '</td><td class=\"num\">' + (viejo ? reloj(viejo, '', ' data-tono=\"1\"') : '—') + '</td><td class=\"num\">' + e.seguimiento + '</td><td class=\"num\">' + e.abiertos + '</td>' +\n      '<td class=\"num grupo-izq\">' + num(sumaRep('totalReplies')) + '</td><td class=\"num\">' + num(sumaRep('totalConversations')) + '</td><td class=\"num\">' + num(sumaRep('customersHelped')) + '</td><td class=\"num\">' + num(sumaRep('resolved')) + '</td><td class=\"num\">' + num(sumaRep('closed')) + '</td>' +\n      '<td class=\"num tenue\">—</td><td class=\"num tenue\">—</td><td class=\"grupo-izq\"></td><td></td></tr></tfoot></table></div></div></section>';\n\n    h += '<section class=\"seccion dos\"><div class=\"col-a\"><div class=\"seccion-cab\"><h2>Clientes esperando respuesta</h2><p>Del que más espera al más reciente · meta ' +\n      E.cfg.metaRespuestaMin + ' min</p></div><div class=\"caja\" id=\"cola\"></div></div>' +\n      '<div class=\"col-b\"><div class=\"seccion-cab\"><h2>Registro de actividad</h2><p>Hoy · ' + p.movimientos + ' movimientos</p></div><div class=\"caja\">' + registro(p.feed) + '</div></div></section>';\n\n    var v = E.verificacion;\n    h += '<footer class=\"pie\"><span>Zona horaria ' + esc(tz()) + ' · jornada ' + E.cfg.horario.inicio + ':00–' + E.cfg.horario.fin + ':00 · los relojes de espera corren en tiempo real</span>' +\n      '<span>' + (v ? (v.ok ? 'Verificado con Help Scout ' : 'Lectura con diferencias ') + hora(v.hora + desfase, true) + ' · ' + v.abiertos + ' casos abiertos leídos' : '') + '</span></footer>';\n\n    $('contenido').innerHTML = h;\n    todos('.t-agentes tbody tr[data-id]').forEach(function (tr) {\n      tr.addEventListener('click', function (ev) {\n        if (ev.target.closest('button')) return;\n        var id = tr.getAttribute('data-id');\n        filtro = filtro === id ? 'todos' : id;\n        marcar(); pintarCola();\n      });\n    });\n    todos('[data-detalle]').forEach(function (b) { b.addEventListener('click', function () { abrirDetalle(Number(b.getAttribute('data-detalle'))); }); });\n    marcar();\n    pintarCola();\n    tic();\n  }\n\n  function filaAgente(a) {\n    if (!a.vinculado) return '<tr><td class=\"nombre\">' + esc(a.nombre) + '</td><td colspan=\"13\" class=\"tenue\">No está vinculada con un usuario de Help Scout</td></tr>';\n    var r = rep(a.id) || {}, viejo = a.esperando.length ? a.esperando[0].esperaDesde : null;\n    return '<tr data-id=\"' + a.id + '\">' +\n      '<td><div class=\"nombre\">' + esc(a.nombre) + '</div><span class=\"est tenue\" data-ultima=\"' + esc(a.ultimaRespuesta || '') + '\" data-esperando=\"' + a.esperando.length + '\"><i></i><span>—</span></span></td>' +\n      '<td class=\"num fuerte grupo-izq\">' + a.esperando.length + '</td>' +\n      '<td class=\"num\">' + (viejo ? reloj(viejo, '', ' data-tono=\"1\"') : '<span class=\"tenue\">—</span>') + '</td>' +\n      '<td class=\"num\">' + a.seguimiento + '</td><td class=\"num\">' + a.abiertos + '</td>' +\n      '<td class=\"num grupo-izq\">' + num(r.totalReplies) + '</td><td class=\"num\">' + num(r.totalConversations) + '</td><td class=\"num\">' + num(r.customersHelped) + '</td><td class=\"num\">' + num(r.resolved) + '</td><td class=\"num\">' + num(r.closed) + '</td>' +\n      '<td class=\"num\">' + corto(r.responseTime) + '</td><td class=\"num\">' + corto(r.resolutionTime) + '</td>' +\n      '<td class=\"num grupo-izq\">' + (a.ultimaRespuesta ? 'hace <span class=\"reloj\" data-desde=\"' + esc(a.ultimaRespuesta) + '\" data-corto=\"1\">' + corto((ahora() - Date.parse(a.ultimaRespuesta)) / 1000) + '</span>' : '<span class=\"tenue\">sin respuestas hoy</span>') + '</td>' +\n      '<td class=\"num\"><button type=\"button\" class=\"btn chico\" data-detalle=\"' + a.id + '\">Detalle</button></td></tr>';\n  }\n  function marcar() { todos('.t-agentes tbody tr[data-id]').forEach(function (tr) { tr.classList.toggle('sel', tr.getAttribute('data-id') === String(filtro)); }); }\n\n  function pintarCola() {\n    var p = E.panel, filas = [];\n    p.agentes.forEach(function (a) { a.esperando.forEach(function (t) { filas.push(t); }); });\n    p.sinAsignar.forEach(function (t) { filas.push(t); });\n    var pest = [{ id: 'todos', t: 'Todos', n: filas.length }]\n      .concat(p.agentes.filter(function (a) { return a.vinculado; }).map(function (a) { return { id: String(a.id), t: a.nombre, n: a.esperando.length }; }))\n      .concat(E.cfg.mostrarSinAsignar ? [{ id: 'sin', t: 'Sin asignar', n: p.sinAsignar.length }] : []);\n    if (!pest.some(function (x) { return x.id === String(filtro); })) filtro = 'todos';\n    var visibles = filas.filter(function (t) {\n      return filtro === 'todos' || (filtro === 'sin' ? !t.agenteId : String(t.agenteId) === String(filtro));\n    }).sort(function (x, y) { return x.esperaDesde < y.esperaDesde ? -1 : x.esperaDesde > y.esperaDesde ? 1 : 0; });\n    var h = '<div class=\"pestanas\" role=\"tablist\">' + pest.map(function (x) {\n      var sel = String(filtro) === x.id;\n      return '<button type=\"button\" role=\"tab\" aria-selected=\"' + sel + '\" class=\"pest' + (sel ? ' sel' : '') + '\" data-f=\"' + x.id + '\">' + esc(x.t) + '<span>' + x.n + '</span></button>';\n    }).join('') + '</div>';\n    if (!visibles.length) h += '<div class=\"vacio\">Ningún cliente está esperando respuesta.</div>';\n    else {\n      h += '<div class=\"desliza\"><table class=\"t-cola\"><thead><tr><th>Espera</th><th>Caso</th><th>Asunto</th><th>Cliente</th><th>Agente</th><th>Estado en Help Scout</th></tr></thead><tbody>' +\n        visibles.map(function (t) {\n          return '<tr><td>' + reloj(t.esperaDesde, 'espera', ' data-tono=\"1\" data-barra=\"1\"') + '<span class=\"barra\"><i></i></span></td>' +\n            '<td><a href=\"' + esc(t.url) + '\" target=\"_blank\" rel=\"noopener\"><b>#' + esc(t.numero) + '</b></a></td>' +\n            '<td class=\"asunto\" title=\"' + esc(t.asunto) + '\">' + esc(t.asunto) + '</td><td class=\"tenue\">' + esc(t.cliente || '—') + '</td>' +\n            '<td>' + (t.agenteId ? esc(t.agente) : '<span class=\"bad\">Sin asignar</span>') + '</td>' +\n            '<td class=\"tenue\">' + (t.estado === 'pending' ? 'Pending' : 'Active') + (t.buzon ? ' · ' + esc(t.buzon) : '') + '</td></tr>';\n        }).join('') + '</tbody></table></div>';\n    }\n    $('cola').innerHTML = h;\n    todos('.pest').forEach(function (b) { b.addEventListener('click', function () { filtro = b.getAttribute('data-f'); marcar(); pintarCola(); }); });\n    tic();\n  }\n\n  var TIPOS = { RESPUESTA: ['Respuesta', 'ok'], CLIENTE: ['Cliente', 'warn'], ASIGNADO: ['Asignado', ''], CERRADO: ['Cerrado', 'ok'] };\n  function textoMovimiento(f) {\n    var caso = '<a href=\"' + esc(f.url) + '\" target=\"_blank\" rel=\"noopener\"><b>#' + esc(f.numero) + '</b></a>', ag = esc(f.agente || '');\n    if (f.tipo === 'RESPUESTA') return ag + ' respondió ' + caso;\n    if (f.tipo === 'CLIENTE') return 'El cliente escribió en ' + caso + (ag ? ' <span class=\"tenue\">· ' + ag + '</span>' : ' <span class=\"bad\">· sin asignar</span>');\n    if (f.tipo === 'ASIGNADO') return caso + ' asignado a ' + ag;\n    return ag + ' cerró ' + caso;\n  }\n  function registro(items) {\n    if (!items.length) return '<div class=\"vacio\">Todavía no hay movimientos hoy.</div>';\n    return '<ol class=\"registro\">' + items.map(function (f) {\n      var t = TIPOS[f.tipo];\n      return '<li><time>' + esc(hora(Date.parse(f.fecha), false)) + '</time><span class=\"tipo ' + t[1] + '\">' + esc(t[0]) + '</span>' +\n        '<span class=\"txt\">' + textoMovimiento(f) + '<small>' + esc(f.asunto || '') + '</small></span></li>';\n    }).join('') + '</ol>';\n  }\n\n  // ---------- Cada segundo ----------\n  function conexion(clase, texto) { var el = $('conexion'); el.className = 'estado-con ' + clase; el.lastElementChild.textContent = texto; }\n  function tic() {\n    var t = ahora();\n    $('reloj').textContent = hora(t, true);\n    if (!E.cfg || !ultimaOk) { conexion(errorActual ? 'bad' : 'tenue', errorActual ? 'Sin conexión' : 'Conectando'); return; }\n    var hace = Math.max(0, Math.floor((Date.now() - ultimaOk) / 1000));\n    var atrasado = !E.cargandoBase && hace > Math.max(45, intervalo() * 6);\n    $('actualizado').textContent = pausado ? 'En pausa · datos de hace ' + corto(hace) : 'Actualizado hace ' + corto(hace) + ' · cada ' + intervalo() + ' s';\n    if (pausado) conexion('warn', 'En pausa');\n    else if (errorActual || atrasado) conexion('bad', 'Sin conexión');\n    else if (!E.enHorario) conexion('tenue', 'Fuera de horario');\n    else conexion('ok', 'En vivo');\n    $('avance').style.width = pausado ? '0' : Math.min(100, Math.max(0, 100 - (proxima - Date.now()) / (intervalo() * 1000) * 100)) + '%';\n\n    var meta = E.cfg.metaRespuestaMin;\n    todos('.reloj[data-desde]').forEach(function (el) {\n      var seg = (t - Date.parse(el.getAttribute('data-desde'))) / 1000;\n      el.textContent = el.getAttribute('data-corto') ? corto(seg) : dur(seg);\n      if (el.getAttribute('data-tono')) {\n        var c = tono(seg / 60);\n        el.classList.remove('ok', 'warn', 'bad'); el.classList.add(c);\n        if (el.getAttribute('data-barra')) {\n          var b = el.parentNode.querySelector('.barra');\n          b.className = 'barra ' + c;\n          b.firstChild.style.width = Math.min(100, seg / 60 / meta * 100) + '%';\n        }\n      }\n    });\n    var alerta = E.cfg.alertaSinResponderMin;\n    todos('.est[data-esperando]').forEach(function (el) {\n      var esperando = Number(el.getAttribute('data-esperando')), ultima = el.getAttribute('data-ultima');\n      var min = ultima ? (t - Date.parse(ultima)) / 60000 : Infinity, clase, texto;\n      if (!esperando) { clase = 'ok'; texto = 'Al día'; }\n      else if (!E.enHorario) { clase = 'tenue'; texto = 'Fuera de horario'; }\n      else if (min < alerta[0]) { clase = 'ok'; texto = 'Respondiendo'; }\n      else if (min < alerta[1]) { clase = 'warn'; texto = 'Sin responder ' + Math.floor(min) + ' min'; }\n      else { clase = 'bad'; texto = ultima ? 'Sin responder ' + corto(min * 60) : 'Sin responder hoy'; }\n      el.className = 'est ' + clase;\n      el.lastElementChild.textContent = texto;\n    });\n  }\n\n  // ---------- Detalle de una agente ----------\n  function abrirDetalle(id) {\n    var a = E.panel.agentes.filter(function (x) { return x.id === id; })[0];\n    if (!a) return;\n    var r = rep(id);\n    var movs = [];\n    Object.keys(E.convs).forEach(function (k) {\n      var c = E.convs[k];\n      c.mv.forEach(function (m) {\n        if (m[0] !== 'C' && m[1] === id) movs.push({ fecha: m[2], tipo: { R: 'RESPUESTA', X: 'CERRADO', A: 'ASIGNADO' }[m[0]], numero: c.n, asunto: c.s, url: 'https://secure.helpscout.net/conversation/' + c.id + '/' + c.n });\n      });\n    });\n    movs.sort(function (x, y) { return x.fecha < y.fecha ? 1 : -1; });\n    $('tituloDetalle').textContent = a.nombre;\n    $('subDetalle').textContent = 'Casos y movimientos de hoy, con enlace a Help Scout para comprobarlos.';\n    var caja = function (v, l) { return '<div><b>' + v + '</b><span>' + l + '</span></div>'; };\n    var h = '<div class=\"resumen-dlg\">' + caja(a.esperando.length, 'Esperando') + caja(a.seguimiento, 'En seguimiento') + caja(a.activos, 'Active') + caja(a.pendientes, 'Pending') +\n      caja(a.respuestasVistas, 'Respuestas vistas hoy') + caja(r ? num(r.totalReplies) : '—', 'Respuestas según Reports') + '</div>' +\n      '<p class=\"fuente\">\"Respuestas vistas\" es el conteo directo de mensajes enviados hoy en los casos leídos; \"según Reports\" es la cifra oficial de Help Scout, que puede tardar unos minutos en actualizarse.</p>';\n    var filaCaso = function (x) {\n      return '<tr><td><a href=\"' + esc(x.url) + '\" target=\"_blank\" rel=\"noopener\"><b>#' + esc(x.numero) + '</b></a></td><td class=\"asunto\">' + esc(x.asunto) + '</td><td class=\"tenue\">' + esc(x.cliente) +\n        '</td><td class=\"tenue\">' + (x.estado === 'pending' ? 'Pending' : 'Active') + '</td><td>' + (x.esperaDesde ? esc(hora(Date.parse(x.esperaDesde), true)) + ' · ' + corto((ahora() - Date.parse(x.esperaDesde)) / 1000) : '<span class=\"tenue\">respondido, espera al cliente</span>') + '</td></tr>';\n    };\n    var abiertos = a.esperando.concat(a.enSeguimiento);\n    h += '<div class=\"previa\"><h4>Casos abiertos (' + abiertos.length + ')</h4><div class=\"caja\"><div class=\"desliza\"><table><thead><tr><th>Caso</th><th>Asunto</th><th>Cliente</th><th>Estado</th><th>Cliente espera desde</th></tr></thead><tbody>' +\n      (abiertos.map(filaCaso).join('') || '<tr><td colspan=\"5\" class=\"vacio\">Sin casos abiertos.</td></tr>') + '</tbody></table></div></div></div>';\n    h += '<div class=\"previa\"><h4>Movimientos de hoy (' + movs.length + ')</h4><div class=\"caja\"><div class=\"desliza\"><table><thead><tr><th>Hora</th><th>Movimiento</th><th>Caso</th><th>Asunto</th></tr></thead><tbody>' +\n      (movs.map(function (m) {\n        var t = TIPOS[m.tipo];\n        return '<tr><td>' + esc(hora(Date.parse(m.fecha), true)) + '</td><td class=\"' + t[1] + '\">' + esc(t[0]) + '</td><td><a href=\"' + esc(m.url) + '\" target=\"_blank\" rel=\"noopener\"><b>#' + esc(m.numero) + '</b></a></td><td class=\"asunto\">' + esc(m.asunto) + '</td></tr>';\n      }).join('') || '<tr><td colspan=\"4\" class=\"vacio\">Sin movimientos hoy.</td></tr>') + '</tbody></table></div></div></div>';\n    $('cuerpoDetalle').innerHTML = h;\n    $('dlgDetalle').showModal();\n  }\n\n  // ---------- Exportar ----------\n  function sumarDias(d, n) { var f = new Date(d + 'T12:00:00Z'); f.setUTCDate(f.getUTCDate() + n); return f.toISOString().slice(0, 10); }\n  function rango(tipo) {\n    var hoy = diaLocal(ahora()), f = new Date(hoy + 'T12:00:00Z'), lunes = sumarDias(hoy, -((f.getUTCDay() + 6) % 7)), mes1 = hoy.slice(0, 8) + '01';\n    if (tipo === 'hoy') return [hoy, hoy];\n    if (tipo === 'ayer') return [sumarDias(hoy, -1), sumarDias(hoy, -1)];\n    if (tipo === 'semana') return [lunes, hoy];\n    if (tipo === 'semanaPasada') return [sumarDias(lunes, -7), sumarDias(lunes, -1)];\n    if (tipo === 'mes') return [mes1, hoy];\n    if (tipo === 'mesPasado') { var fin = sumarDias(mes1, -1); return [fin.slice(0, 8) + '01', fin]; }\n    if (tipo === '90') return [sumarDias(hoy, -89), hoy];\n    return null;\n  }\n  function aplicarPeriodo() { var r = rango($('expPeriodo').value); if (r) { $('expDesde').value = r[0]; $('expHasta').value = r[1]; } }\n  function abrirExportar() {\n    if (!E.cfg) return;\n    if (!$('expAgentes').children.length) {\n      $('expAgentes').innerHTML = E.agentes.filter(function (a) { return a.id; }).map(function (a) {\n        return '<label><input type=\"checkbox\" value=\"' + a.id + '\" checked> ' + esc(a.nombre) + '</label>';\n      }).join('');\n      $('expOficina').checked = !!E.cfg.horarioDeOficina;\n      aplicarPeriodo();\n    }\n    $('expPrevia').innerHTML = ''; $('expEstado').textContent = ''; exportacion = null;\n    $('dlgExportar').showModal();\n  }\n  function botones(activos) { ['expVer', 'expExcel', 'expCsv'].forEach(function (id) { $(id).disabled = !activos; }); }\n  function pedirExportacion(conCasos, despues) {\n    var f = {\n      desde: $('expDesde').value, hasta: $('expHasta').value, oficina: $('expOficina').checked,\n      agentes: todos('#expAgentes input:checked').map(function (i) { return Number(i.value); }),\n      series: $('expSeries').checked, casos: conCasos && $('expCasos').checked,\n    };\n    if (!f.desde || !f.hasta || f.desde > f.hasta) { $('expEstado').textContent = 'Revisa las fechas.'; return; }\n    if (!f.agentes.length) { $('expEstado').textContent = 'Elige al menos una agente.'; return; }\n    var qs = '?desde=' + f.desde + '&hasta=' + f.hasta + '&agentes=' + f.agentes.join(',') + '&oficina=' + (f.oficina ? 1 : 0);\n    var x = { filtros: f, resumen: null, series: null, casos: null, generado: Date.now() };\n    botones(false);\n    $('expEstado').textContent = 'Consultando los reportes de Help Scout.';\n    api('/api/reporte' + qs).then(function (r) {\n      if (!r.disponible) throw new Error(r.motivo);\n      x.resumen = r;\n      if (!f.series) return null;\n      $('expEstado').textContent = 'Leyendo la evolución por periodo.';\n      return api('/api/reporte-dias' + qs).then(function (s) { x.series = s; });\n    }).then(function () {\n      if (!f.casos) return null;\n      x.casos = [];\n      return f.agentes.reduce(function (cadena, id) {\n        return cadena.then(function () {\n          var leer = function (pagina) {\n            return api('/api/reporte-casos' + qs + '&agente=' + id + '&pagina=' + pagina).then(function (c) {\n              c.filas.forEach(function (fila) { fila.agente = c.nombre; x.casos.push(fila); });\n              $('expEstado').textContent = 'Leyendo conversaciones de ' + c.nombre + ' (' + x.casos.length + ').';\n              return c.siguiente ? leer(c.siguiente) : null;\n            });\n          };\n          return leer(1);\n        });\n      }, Promise.resolve());\n    }).then(function () {\n      exportacion = x;\n      $('expEstado').textContent = 'Listo.';\n      pintarPrevia();\n      if (despues) despues();\n    }).catch(function (e) {\n      $('expEstado').textContent = '';\n      $('expPrevia').innerHTML = '<div class=\"aviso error\">' + esc(e.message) + '</div>';\n    }).then(function () { botones(true); });\n  }\n  var fraccion = function (v) { return v == null ? null : (v > 1 ? v / 100 : v); };\n  var pct = function (v) { v = fraccion(v); return v == null ? '—' : Math.round(v * 100) + '%'; };\n  function total(filas, campo) { return filas.reduce(function (s, f) { return s + (f[campo] || 0); }, 0); }\n  function pintarPrevia() {\n    var r = exportacion.resumen;\n    var fila = function (f) {\n      return '<tr><td class=\"nombre\">' + esc(f.nombre) + '</td><td class=\"num\">' + num(f.totalConversations) + '</td><td class=\"num\">' + num(f.customersHelped) + '</td><td class=\"num\">' + num(f.totalReplies) +\n        '</td><td class=\"num\">' + num(f.repliesPerDay) + '</td><td class=\"num\">' + num(f.resolved) + '</td><td class=\"num\">' + pct(f.percentResolvedOnFirstReply) + '</td><td class=\"num\">' + num(f.closed) +\n        '</td><td class=\"num\">' + corto(f.responseTime) + '</td><td class=\"num\">' + corto(f.resolutionTime) + '</td><td class=\"num\">' + corto(f.handleTime) + '</td><td class=\"num\">' + num(f.happinessScore) + '</td></tr>';\n    };\n    $('expPrevia').innerHTML = '<div class=\"previa\"><h4>Resumen por agente · ' + esc(r.rango.desde) + ' a ' + esc(r.rango.hasta) + '</h4><div class=\"caja\"><div class=\"desliza\"><table><thead><tr>' +\n      '<th>Agente</th><th class=\"num\">Conversaciones</th><th class=\"num\">Clientes</th><th class=\"num\">Respuestas</th><th class=\"num\">Resp. por día</th><th class=\"num\">Resueltos</th><th class=\"num\">% en 1ª resp.</th><th class=\"num\">Cerrados</th>' +\n      '<th class=\"num\">T. respuesta</th><th class=\"num\">T. resolución</th><th class=\"num\">T. gestión</th><th class=\"num\">Felicidad</th></tr></thead><tbody>' + r.filas.map(fila).join('') + '</tbody><tfoot><tr><td>Suma</td>' +\n      '<td class=\"num\">' + num(total(r.filas, 'totalConversations')) + '</td><td class=\"num\">' + num(total(r.filas, 'customersHelped')) + '</td><td class=\"num\">' + num(total(r.filas, 'totalReplies')) + '</td><td></td><td class=\"num\">' + num(total(r.filas, 'resolved')) +\n      '</td><td></td><td class=\"num\">' + num(total(r.filas, 'closed')) + '</td><td colspan=\"4\"></td></tr></tfoot></table></div></div>' +\n      '<p class=\"fuente\" style=\"margin-top:10px\">Fuente: Reports de Help Scout, del ' + esc(r.rango.desde) + ' 00:00 al ' + esc(r.rango.hasta) + ' 23:59 (' + esc(tz()) + '). Una conversación atendida por dos agentes cuenta para cada una, por eso la suma puede ser mayor que el total del equipo.</p></div>';\n  }\n\n  var DIAS_SEMANA = ['', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo'];\n  function hojas() {\n    var x = exportacion, r = x.resumen, v = function (n) { return n == null ? '' : n; };\n    var min = function (s) { return s == null ? '' : Math.round(s / 6) / 10; }, hrs = function (s) { return s == null ? '' : Math.round(s / 360) / 10; };\n    var resumen = [['Agente', 'Días del periodo', 'Conversaciones', 'Conversaciones creadas', 'Clientes ayudados', 'Respuestas enviadas', 'Respuestas por día', 'Conversaciones por día',\n      'Resueltos', 'Resueltos en la 1ª respuesta', '% resueltos en la 1ª respuesta', 'Respuestas para resolver', 'Cerrados', 'T. respuesta (min)', 'T. resolución (h)', 'T. gestión (min)',\n      'Felicidad', 'Día más ocupado', 'T. respuesta (s)', 'T. resolución (s)', 'T. gestión (s)']]\n      .concat(r.filas.map(function (f) {\n        return [f.nombre, v(f.totalDays), v(f.totalConversations), v(f.conversationsCreated), v(f.customersHelped), v(f.totalReplies), v(f.repliesPerDay), v(f.conversationsPerDay), v(f.resolved),\n          v(f.resolvedOnFirstReply), v(fraccion(f.percentResolvedOnFirstReply)), v(f.repliesToResolve), v(f.closed), min(f.responseTime), hrs(f.resolutionTime), min(f.handleTime), v(f.happinessScore),\n          DIAS_SEMANA[f.busiestDay] || '', v(f.responseTime), v(f.resolutionTime), v(f.handleTime)];\n      }));\n    var etiqueta = { day: 'Día', week: 'Semana (inicio)', month: 'Mes (inicio)' }[(x.series && x.series.vista) || 'day'];\n    var series = [[etiqueta, 'Agente', 'Respuestas enviadas', 'Resueltos', 'Clientes ayudados']]\n      .concat(((x.series && x.series.filas) || []).map(function (f) { return [f.fecha, f.nombre, f.respuestas, f.resueltos, f.clientes]; }));\n    var casos = [['Agente', '# Caso', 'Cliente', 'Estado', 'Respuestas enviadas', '1ª respuesta (min)', 'T. respuesta (min)', 'T. resolución (h)', 'T. gestión (min)', 'Enlace']]\n      .concat((x.casos || []).map(function (c) { return [c.agente, c.numero, c.cliente, c.estado, v(c.respuestas), min(c.primeraRespuesta), min(c.respuesta), hrs(c.resolucion), min(c.gestion), c.url]; }));\n    var nombres = E.agentes.filter(function (a) { return x.filtros.agentes.indexOf(a.id) >= 0; }).map(function (a) { return a.nombre; });\n    var notas = [['Métricas de soporte — Help Scout'], [],\n      ['Periodo', r.rango.desde + ' 00:00 a ' + r.rango.hasta + ' 23:59 (' + tz() + ')'], ['Agentes', nombres.join(', ')],\n      ['Tiempos en horario de oficina', x.filtros.oficina ? 'Sí (si está activado en Help Scout)' : 'No: tiempo corrido'],\n      ['Generado', new Date(x.generado).toLocaleString('es', { timeZone: tz() }) + ' (' + tz() + ')'], [],\n      ['Fuente', 'Todas las cifras son las de los reportes oficiales de Help Scout (sección Reports → Team → usuario), sin recálculo.'],\n      ['Conversaciones', 'Conversaciones en las que el agente participó en el periodo (totalConversations).'],\n      ['Clientes ayudados', 'Clientes distintos a los que el agente respondió (customersHelped).'],\n      ['Respuestas enviadas', 'Mensajes enviados a clientes (totalReplies). No cuentan las notas internas.'],\n      ['Resueltos', 'Conversaciones resueltas por el agente (resolved). Help Scout cuenta una conversación como resuelta cuando se cierra y no se reabre.'],\n      ['Cerrados', 'Veces que el agente cerró una conversación (closed).'],\n      ['T. respuesta', 'Tiempo promedio de respuesta (responseTime). Help Scout lo entrega en segundos; aquí se muestra en minutos y también en segundos.'],\n      ['T. resolución', 'Tiempo promedio hasta resolver (resolutionTime), en horas y en segundos.'],\n      ['T. gestión', 'Tiempo promedio de gestión de cada respuesta (handleTime). Help Scout no documenta la unidad; se asume segundos.'],\n      ['Felicidad', 'Happiness score de Help Scout: % de calificaciones \"Great\" menos % de \"Not Good\".'],\n      ['Sumas', 'Una conversación atendida por dos agentes cuenta para cada una: la suma de agentes puede superar el total del equipo.'],\n      ['Evolución', 'Help Scout entrega la serie por día hasta 60 días, por semana hasta 1 año y por mes para rangos mayores.']];\n    return { resumen: resumen, series: series, casos: casos, notas: notas };\n  }\n  function nombreArchivo(ext, sufijo) { var f = exportacion.filtros; return 'metricas-soporte_' + f.desde + '_a_' + f.hasta + (sufijo ? '_' + sufijo : '') + '.' + ext; }\n  function bajar(blob, nombre) {\n    var a = document.createElement('a');\n    a.href = URL.createObjectURL(blob); a.download = nombre; document.body.appendChild(a); a.click();\n    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 2000);\n  }\n  function cargarXlsx(listo) {\n    if (window.XLSX) return listo(true);\n    var s = document.createElement('script');\n    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';\n    s.onload = function () { listo(!!window.XLSX); };\n    s.onerror = function () { listo(false); };\n    document.head.appendChild(s);\n  }\n  function descargarExcel() {\n    cargarXlsx(function (ok) {\n      if (!ok) { $('expEstado').textContent = 'No se pudo cargar el generador de Excel. Usa la descarga en CSV.'; return; }\n      var h = hojas(), libro = XLSX.utils.book_new();\n      var agregar = function (nombre, filas, anchos, columnasPct) {\n        var hoja = XLSX.utils.aoa_to_sheet(filas);\n        hoja['!cols'] = filas[0].map(function (t, i) { return { wch: (anchos && anchos[i]) || Math.max(12, Math.min(32, String(t).length + 2)) }; });\n        (columnasPct || []).forEach(function (col) {\n          for (var f = 1; f < filas.length; f++) { var celda = hoja[XLSX.utils.encode_cell({ r: f, c: col })]; if (celda && typeof celda.v === 'number') celda.z = '0%'; }\n        });\n        if (filas.length > 1) hoja['!autofilter'] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: filas.length - 1, c: filas[0].length - 1 } }) };\n        XLSX.utils.book_append_sheet(libro, hoja, nombre);\n      };\n      agregar('Resumen por agente', h.resumen, { 0: 24 }, [10]);\n      if (exportacion.series) agregar('Evolución', h.series, { 0: 16, 1: 24 });\n      if (exportacion.casos) agregar('Conversaciones', h.casos, { 0: 24, 2: 28, 9: 58 });\n      var notas = XLSX.utils.aoa_to_sheet(h.notas);\n      notas['!cols'] = [{ wch: 32 }, { wch: 120 }];\n      XLSX.utils.book_append_sheet(libro, notas, 'Notas');\n      bajar(new Blob([XLSX.write(libro, { bookType: 'xlsx', type: 'array' })], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), nombreArchivo('xlsx'));\n      $('expEstado').textContent = 'Excel descargado.';\n    });\n  }\n  function descargarCsv() {\n    var cual = $('expCsvHoja').value;\n    if ((cual === 'series' && !exportacion.series) || (cual === 'casos' && !exportacion.casos)) { $('expEstado').textContent = 'Marca esa opción en \"Contenido del archivo\" para incluirla.'; return; }\n    var texto = hojas()[cual].map(function (f) {\n      return f.map(function (c) { var s = String(c == null ? '' : c); return /[\",\\n;]/.test(s) ? '\"' + s.replace(/\"/g, '\"\"') + '\"' : s; }).join(',');\n    }).join('\\r\\n');\n    bajar(new Blob(['﻿' + texto], { type: 'text/csv;charset=utf-8' }), nombreArchivo('csv', cual));\n    $('expEstado').textContent = 'CSV descargado.';\n  }\n\n  // ---------- Controles ----------\n  $('btnPausa').addEventListener('click', function () {\n    pausado = !pausado;\n    this.setAttribute('aria-pressed', pausado ? 'true' : 'false');\n    this.textContent = pausado ? 'Reanudar' : 'Pausar';\n    if (pausado) clearTimeout(temporizador); else ciclo();\n    tic();\n  });\n  $('btnExportar').addEventListener('click', abrirExportar);\n  $('expPeriodo').addEventListener('change', aplicarPeriodo);\n  ['expDesde', 'expHasta'].forEach(function (id) { $(id).addEventListener('change', function () { $('expPeriodo').value = 'personal'; }); });\n  $('expVer').addEventListener('click', function () { pedirExportacion(false); });\n  $('expExcel').addEventListener('click', function () { pedirExportacion(true, descargarExcel); });\n  $('expCsv').addEventListener('click', function () { pedirExportacion(true, descargarCsv); });\n  todos('[data-cerrar]').forEach(function (b) { b.addEventListener('click', function () { b.closest('dialog').close(); }); });\n  todos('dialog').forEach(function (d) { d.addEventListener('click', function (ev) { if (ev.target === d) d.close(); }); });\n  document.addEventListener('visibilitychange', function () {\n    if (!document.hidden && !pausado && E.cfg && Date.now() - ultimaOk > intervalo() * 1000) ciclo();\n  });\n\n  setInterval(tic, 1000);\n  if (DEMO) {\n    var s = document.createElement('script');\n    s.src = 'demo.js';\n    s.onload = arrancar;\n    document.head.appendChild(s);\n  } else {\n    arrancar();\n  }\n})();\n</script>\n</body>\n</html>\n";

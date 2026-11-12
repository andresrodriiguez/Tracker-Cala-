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

  // --- Panel en vivo (página web aparte: ver README, "Panel en vivo") ---
  PANEL: {
    // Cada cuántos segundos la página consulta Help Scout (en horario laboral y fuera de él).
    SEGUNDOS_ACTUALIZACION: 5,
    SEGUNDOS_FUERA_DE_HORARIO: 60,
    // Cada cuántos minutos se vuelve a leer todo desde cero (por si algo se escapó).
    MINUTOS_RECARGA_COMPLETA: 10,
    // Meta para responder al cliente: el reloj de cada ticket pasa a amarillo a la mitad y a rojo al llegar.
    META_RESPUESTA_MIN: 60,
    // Estado de cada agente: amarillo / rojo si tiene clientes esperando y no responde hace estos minutos.
    ALERTA_SIN_RESPONDER_MIN: [10, 30],
    // Mostrar la cola de casos activos sin asignar (de los buzones de MAILBOXES_EQUIPO, o de todos si está vacío).
    MOSTRAR_SIN_ASIGNAR: true,
    MAX_PAGINAS_SIN_ASIGNAR: 4, // 25 casos por página
    MAX_PAGINAS_DIA: 30,
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

/**
 * Momento (hora local 'yyyy-MM-dd HH:mm:ss') desde el que los movimientos cuentan para el día de
 * jornada `dia`: el cierre de la jornada laboral anterior.
 * Ej. (9–17, lun–sáb): miércoles → martes 17:00:00; lunes → sábado 17:00:00.
 */
function inicioVentanaJornada(dia, horario) {
  const DIA = 86400000;
  let d = new Date(dia + 'T00:00:00Z').getTime() - DIA;
  for (let i = 0; i < 7 && horario.dias.indexOf(new Date(d).getUTCDay()) < 0; i++) d -= DIA;
  return new Date(d).toISOString().slice(0, 10) + ' ' + String(horario.fin).padStart(2, '0') + ':00:00';
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

// ===== EnVivo.gs =====
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

/**
 * Recorre todas las páginas de un listado y devuelve los elementos de _embedded[clave].
 * maxPaginas (opcional) corta la lectura después de esa cantidad de páginas.
 */
function hsListarTodo_(ruta, params, clave, maxPaginas) {
  const todos = [];
  for (let pagina = 1; ; pagina++) {
    const data = hsGet_(ruta, Object.assign({}, params, { page: pagina }));
    const items = (data._embedded && data._embedded[clave]) || [];
    Array.prototype.push.apply(todos, items);
    const totalPaginas = data.page ? data.page.totalPages : 1;
    if (!items.length || pagina >= totalPaginas || (maxPaginas && pagina >= maxPaginas)) return todos;
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

// ===== Panel.gs =====
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
    .addItem('📡 Panel en vivo', 'menuPanelEnVivo')
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

// ===== Panel.html =====
const PANEL_HTML = "<!DOCTYPE html>\n<html lang=\"es\">\n<head>\n<base target=\"_top\">\n<meta charset=\"utf-8\">\n<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">\n<title>Centro de control · Soporte en vivo</title>\n<link rel=\"preconnect\" href=\"https://fonts.googleapis.com\">\n<link rel=\"preconnect\" href=\"https://fonts.gstatic.com\" crossorigin>\n<link href=\"https://fonts.googleapis.com/css2?family=Montserrat:wght@400;500;600;700;800&display=swap\" rel=\"stylesheet\">\n<style>\n:root {\n  --bg: #0A0D13;\n  --panel: #10151E;\n  --panel-2: #151B26;\n  --panel-3: #1B2230;\n  --line: #222B3A;\n  --line-2: #2C3648;\n  --ink: #EEF1F6;\n  --muted: #8F9AAE;\n  --accent: #7C93FF;\n  --accent-ink: #0A0D13;\n  --ok: #3ED598;\n  --ok-bg: rgba(62, 213, 152, .12);\n  --warn: #F7C04A;\n  --warn-bg: rgba(247, 192, 74, .13);\n  --late: #FF7A7A;\n  --late-bg: rgba(255, 122, 122, .14);\n  --radius: 16px;\n}\n* { box-sizing: border-box; }\nhtml, body { margin: 0; background: var(--bg); color: var(--ink); }\nbody {\n  font-family: 'Montserrat', system-ui, sans-serif; font-size: 14px; line-height: 1.45;\n  font-feature-settings: 'tnum' 1, 'lnum' 1; -webkit-font-smoothing: antialiased;\n}\na { color: inherit; text-decoration: none; }\na:hover { color: var(--accent); }\nbutton { font: inherit; color: inherit; }\n.wrap { max-width: 1600px; margin: 0 auto; padding: 0 24px 40px; }\n\n/* Barra superior */\n.top { position: sticky; top: 0; z-index: 5; background: rgba(10, 13, 19, .92); backdrop-filter: blur(10px); border-bottom: 1px solid var(--line); }\n.top-in { max-width: 1600px; margin: 0 auto; padding: 14px 24px; display: flex; align-items: center; gap: 20px; flex-wrap: wrap; }\n.brand { display: flex; align-items: center; gap: 12px; margin-right: auto; }\n.mark { width: 40px; height: 40px; border-radius: 12px; display: grid; place-items: center; background: linear-gradient(145deg, #2A3A7A, #1A2246); border: 1px solid #34437F; }\n.brand h1 { margin: 0; font-size: 17px; font-weight: 700; letter-spacing: -.01em; }\n.brand p { margin: 0; font-size: 12px; color: var(--muted); font-weight: 500; }\n.pill { display: inline-flex; align-items: center; gap: 8px; height: 30px; padding: 0 12px; border-radius: 999px; font-size: 12px; font-weight: 700; letter-spacing: .04em; text-transform: uppercase; }\n.pill .dot { width: 8px; height: 8px; border-radius: 50%; background: currentColor; }\n.pill.vivo { color: var(--ok); background: var(--ok-bg); }\n.pill.vivo .dot { animation: pulso 1.6s ease-out infinite; }\n.pill.pausa, .pill.fuera { color: var(--warn); background: var(--warn-bg); }\n.pill.error { color: var(--late); background: var(--late-bg); }\n.pill.cargando { color: var(--muted); background: var(--panel-3); }\n@keyframes pulso { 0% { box-shadow: 0 0 0 0 rgba(62, 213, 152, .55); } 100% { box-shadow: 0 0 0 9px rgba(62, 213, 152, 0); } }\n.clock { display: flex; flex-direction: column; align-items: flex-end; }\n.clock b { font-size: 22px; font-weight: 700; letter-spacing: .02em; }\n.clock span { font-size: 12px; color: var(--muted); font-weight: 500; }\n.btn { height: 40px; padding: 0 14px; border-radius: 10px; border: 1px solid var(--line-2); background: var(--panel-2); font-weight: 600; font-size: 13px; cursor: pointer; display: inline-flex; align-items: center; gap: 8px; }\n.btn:hover { border-color: var(--accent); }\n.btn:focus-visible, .card:focus-visible, .chip:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }\n.progreso { height: 2px; background: transparent; }\n.progreso i { display: block; height: 100%; width: 0; background: var(--accent); transition: width 1s linear; }\n\n.aviso { margin-top: 18px; padding: 12px 16px; border-radius: 12px; font-weight: 500; font-size: 13px; border: 1px solid; }\n.aviso.error { color: var(--late); background: var(--late-bg); border-color: rgba(255, 122, 122, .35); }\n.aviso.info { color: var(--warn); background: var(--warn-bg); border-color: rgba(247, 192, 74, .35); }\n\n.titulo { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; flex-wrap: wrap; margin: 28px 0 12px; }\n.titulo h2 { margin: 0; font-size: 13px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; color: var(--muted); }\n.titulo span { font-size: 12px; color: var(--muted); }\n\n/* KPI */\n.kpis { display: grid; grid-template-columns: repeat(auto-fit, minmax(190px, 1fr)); gap: 12px; margin-top: 24px; }\n.kpi { background: var(--panel); border: 1px solid var(--line); border-radius: var(--radius); padding: 16px 18px; display: flex; flex-direction: column; gap: 4px; min-width: 0; }\n.kpi .l { font-size: 12px; font-weight: 600; color: var(--muted); }\n.kpi .v { font-size: clamp(24px, 2.1vw, 34px); font-weight: 800; letter-spacing: -.03em; line-height: 1.15; white-space: nowrap; }\n.kpi .n { font-size: 12px; color: var(--muted); font-weight: 500; }\n.kpi.destacado { background: linear-gradient(160deg, #161E31, var(--panel)); border-color: #2B3756; }\n\n/* Agentes */\n.agentes { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 14px; }\n.card { text-align: left; cursor: pointer; background: var(--panel); border: 1px solid var(--line); border-radius: var(--radius); padding: 18px; display: flex; flex-direction: column; gap: 16px; min-width: 0; transition: border-color .15s, transform .15s; }\n.card:hover { border-color: var(--line-2); transform: translateY(-1px); }\n.card.activa { border-color: var(--accent); box-shadow: 0 0 0 1px var(--accent) inset; }\n.card.sin-vincular { opacity: .6; cursor: default; }\n.cab { display: flex; align-items: center; gap: 12px; }\n.avatar { width: 44px; height: 44px; border-radius: 50%; display: grid; place-items: center; font-weight: 700; font-size: 14px; background: var(--panel-3); border: 1px solid var(--line-2); flex: none; }\n.cab .nom { font-weight: 700; font-size: 15px; display: block; }\n.estado { display: inline-flex; align-items: center; gap: 6px; margin-top: 4px; padding: 3px 9px; border-radius: 999px; font-size: 11.5px; font-weight: 700; }\n.estado::before { content: ''; width: 6px; height: 6px; border-radius: 50%; background: currentColor; }\n.t-ok { color: var(--ok); background: var(--ok-bg); }\n.t-warn { color: var(--warn); background: var(--warn-bg); }\n.t-late { color: var(--late); background: var(--late-bg); }\n.t-neutro { color: var(--muted); background: var(--panel-3); }\n.duo { display: grid; grid-template-columns: 1fr 1.25fr; gap: 10px; }\n.caja { border-radius: 12px; padding: 11px 13px; background: var(--panel-2); display: flex; flex-direction: column; gap: 2px; min-width: 0; }\n.caja .l { font-size: 11.5px; font-weight: 600; color: var(--muted); }\n.caja .v { font-size: 30px; font-weight: 800; letter-spacing: -.03em; line-height: 1.15; }\n.caja .r { font-size: 20px; font-weight: 700; padding-top: 6px; white-space: nowrap; }\n.caja.t-ok, .caja.t-warn, .caja.t-late { background: none; }\n.caja.t-ok { background: var(--ok-bg); } .caja.t-warn { background: var(--warn-bg); } .caja.t-late { background: var(--late-bg); }\n.caja.t-ok .l, .caja.t-warn .l, .caja.t-late .l { color: var(--muted); }\n.metricas { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px 8px; }\n.metricas div { display: flex; flex-direction: column; min-width: 0; }\n.metricas .l { font-size: 11px; color: var(--muted); font-weight: 600; }\n.metricas .v { font-size: 17px; font-weight: 700; }\n.pie { font-size: 12px; color: var(--muted); border-top: 1px solid var(--line); padding-top: 12px; font-weight: 500; }\n.pie b { color: var(--ink); font-weight: 700; }\n\n/* Tabla + feed */\n.doble { display: flex; flex-wrap: wrap; gap: 16px; align-items: flex-start; margin-top: 28px; }\n.bloque { background: var(--panel); border: 1px solid var(--line); border-radius: var(--radius); padding: 18px; min-width: 0; }\n.bloque.tabla { flex: 999 1 680px; }\n.bloque.feed { flex: 1 1 340px; }\n.bloque h3 { margin: 0; font-size: 15px; font-weight: 700; }\n.bloque .sub { font-size: 12px; color: var(--muted); font-weight: 500; }\n.bloque-cab { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; flex-wrap: wrap; margin-bottom: 14px; }\n.chips { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 14px; }\n.chip { height: 34px; padding: 0 13px; border-radius: 999px; border: 1px solid var(--line-2); background: var(--panel-2); font-size: 12.5px; font-weight: 600; cursor: pointer; }\n.chip:hover { border-color: var(--accent); }\n.chip.activa { background: var(--accent); border-color: var(--accent); color: var(--accent-ink); }\n.scroll { overflow-x: auto; }\ntable { width: 100%; border-collapse: collapse; min-width: 720px; }\nth { text-align: left; font-size: 11px; font-weight: 700; letter-spacing: .06em; text-transform: uppercase; color: var(--muted); padding: 0 12px 10px; border-bottom: 1px solid var(--line); }\ntd { padding: 11px 12px; border-bottom: 1px solid var(--line); vertical-align: middle; }\ntr:last-child td { border-bottom: 0; }\ntbody tr:hover td { background: var(--panel-2); }\n.reloj-t { display: inline-block; min-width: 104px; padding: 5px 9px; border-radius: 8px; font-weight: 700; font-size: 13px; text-align: center; white-space: nowrap; }\n.num { font-weight: 700; }\n.num a { display: inline-flex; align-items: center; gap: 4px; }\n.asunto { max-width: 420px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }\n.tenue { color: var(--muted); }\n.vacio { padding: 26px 12px; text-align: center; color: var(--muted); font-weight: 500; }\n.feed ol { list-style: none; margin: 0; padding: 0; max-height: 640px; overflow-y: auto; }\n.feed li { display: flex; gap: 12px; padding: 10px 0; border-bottom: 1px solid var(--line); }\n.feed li:last-child { border-bottom: 0; }\n.feed .ic { width: 28px; height: 28px; border-radius: 8px; display: grid; place-items: center; flex: none; }\n.feed .tx { font-size: 13px; font-weight: 500; }\n.feed .hr { font-size: 11.5px; color: var(--muted); }\nfooter { margin-top: 28px; font-size: 12px; color: var(--muted); display: flex; justify-content: space-between; gap: 12px; flex-wrap: wrap; }\n.esqueleto { color: var(--muted); padding: 60px 0; text-align: center; font-weight: 500; }\n\n@media (max-width: 640px) {\n  .wrap, .top-in { padding-left: 16px; padding-right: 16px; }\n  .clock { align-items: flex-start; }\n  .kpi .v { font-size: 28px; }\n}\n</style>\n</head>\n<body>\n<div class=\"top\">\n  <div class=\"top-in\">\n    <div class=\"brand\">\n      <div class=\"mark\" aria-hidden=\"true\">\n        <svg width=\"20\" height=\"20\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"#B9C6FF\" stroke-width=\"2.2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M3 12h4l3-8 4 16 3-8h4\"/></svg>\n      </div>\n      <div>\n        <h1>Centro de control · Soporte</h1>\n        <p>Help Scout en tiempo real</p>\n      </div>\n    </div>\n    <span id=\"estadoConexion\" class=\"pill cargando\"><span class=\"dot\"></span><span>Conectando</span></span>\n    <div class=\"clock\"><b id=\"reloj\">--:--:--</b><span id=\"actualizado\">Cargando datos…</span></div>\n    <button type=\"button\" class=\"btn\" id=\"btnPausa\" aria-pressed=\"false\">\n      <svg width=\"14\" height=\"14\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2.4\" stroke-linecap=\"round\" aria-hidden=\"true\"><path d=\"M8 5v14M16 5v14\"/></svg>\n      <span>Pausar</span>\n    </button>\n    <button type=\"button\" class=\"btn\" id=\"btnPantalla\" hidden>\n      <svg width=\"14\" height=\"14\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2.4\" stroke-linecap=\"round\" stroke-linejoin=\"round\" aria-hidden=\"true\"><path d=\"M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5\"/></svg>\n      <span>Pantalla completa</span>\n    </button>\n  </div>\n  <div class=\"progreso\"><i id=\"barra\"></i></div>\n</div>\n\n<main class=\"wrap\">\n  <div id=\"avisos\"></div>\n  <div id=\"contenido\"><div class=\"esqueleto\">Leyendo Help Scout… la primera carga puede tardar unos segundos.</div></div>\n</main>\n\n<script>\n(function () {\n  'use strict';\n  var datos = null;          // última respuesta del servidor\n  var desfase = 0;           // reloj del servidor − reloj del navegador\n  var filtro = 'todos';\n  var pausado = false;\n  var enCurso = false;\n  var ultimaOk = 0;\n  var proxima = 0;\n  var temporizador = null;\n  var demo = typeof google === 'undefined' || !google.script || !google.script.run;\n\n  var $ = function (id) { return document.getElementById(id); };\n  var ahora = function () { return Date.now() + desfase; };\n  var esc = function (t) {\n    return String(t == null ? '' : t).replace(/[&<>\"']/g, function (c) {\n      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '\"': '&quot;', \"'\": '&#39;' }[c];\n    });\n  };\n  var p2 = function (n) { return (n < 10 ? '0' : '') + n; };\n  function dur(seg) {\n    seg = Math.max(0, Math.floor(seg));\n    var d = Math.floor(seg / 86400), h = Math.floor(seg % 86400 / 3600), m = Math.floor(seg % 3600 / 60), s = seg % 60;\n    if (d) return d + 'd ' + p2(h) + 'h ' + p2(m) + 'm';\n    if (h) return h + 'h ' + p2(m) + 'm ' + p2(s) + 's';\n    return p2(m) + 'm ' + p2(s) + 's';\n  }\n  function minTxt(m) {\n    if (m == null) return '—';\n    if (m < 60) return Math.round(m) + ' min';\n    return Math.floor(m / 60) + ' h ' + p2(Math.round(m % 60)) + ' min';\n  }\n  function hora(ms, conSegundos) {\n    var o = { hour: '2-digit', minute: '2-digit', hour12: false };\n    if (conSegundos) o.second = '2-digit';\n    try { o.timeZone = (datos && datos.tz) || 'America/New_York'; return new Date(ms).toLocaleTimeString('es', o); }\n    catch (e) { return new Date(ms).toTimeString().slice(0, conSegundos ? 8 : 5); }\n  }\n  function iniciales(n) {\n    return String(n).split(/\\s+/).filter(Boolean).slice(0, 2).map(function (x) { return x[0]; }).join('').toUpperCase();\n  }\n  function tonoEspera(min) {\n    var meta = (datos && datos.metaRespuestaMin) || 60;\n    return min < meta / 2 ? 't-ok' : min < meta ? 't-warn' : 't-late';\n  }\n\n  // ---------- Datos ----------\n  function pedir() {\n    if (enCurso || pausado) return;\n    enCurso = true;\n    if (!datos) pintarConexion('cargando', 'Conectando');\n    var listo = function (texto) { enCurso = false; recibir(texto); programar(); };\n    var falla = function (err) { enCurso = false; recibir(JSON.stringify({ ok: false, error: String(err && err.message || err) })); programar(); };\n    if (demo) { setTimeout(function () { listo(JSON.stringify(datosDemo())); }, 300); return; }\n    google.script.run.withSuccessHandler(listo).withFailureHandler(falla).datosPanelEnVivo();\n  }\n  function intervalo() {\n    if (!datos) return 10;\n    return datos.enHorario ? (datos.segundos || 5) : (datos.segundosFueraDeHorario || 60);\n  }\n  function programar() {\n    clearTimeout(temporizador);\n    if (pausado) return;\n    var s = datos && datos.ok === false ? 15 : intervalo();\n    proxima = Date.now() + s * 1000;\n    temporizador = setTimeout(pedir, s * 1000);\n  }\n  function recibir(texto) {\n    var r;\n    try { r = JSON.parse(texto); } catch (e) { r = { ok: false, error: 'Respuesta no válida del servidor.' }; }\n    if (!r.ok) {\n      $('avisos').innerHTML = '<div class=\"aviso error\" role=\"alert\">No se pudo leer Help Scout: ' + esc(r.error) +\n        (datos ? ' · Se muestran los últimos datos recibidos.' : '') + ' Reintentando…</div>';\n      pintarConexion('error', 'Sin conexión');\n      if (!datos) $('contenido').innerHTML = '<div class=\"esqueleto\">Sin datos todavía.</div>';\n      return;\n    }\n    desfase = Date.parse(r.ahora) - Date.now();\n    datos = r;\n    ultimaOk = Date.now();\n    var avisos = '';\n    if (r.sinVincular && r.sinVincular.length) {\n      avisos += '<div class=\"aviso info\">No encontré en Help Scout a: ' + esc(r.sinVincular.join(', ')) +\n        '. Revisa su email en CONFIG.AGENTES.</div>';\n    }\n    if (demo) avisos += '<div class=\"aviso info\">Vista de demostración con datos de ejemplo (fuera de Apps Script).</div>';\n    $('avisos').innerHTML = avisos;\n    pintar();\n  }\n\n  // ---------- Pintado ----------\n  function pintarConexion(clase, texto) {\n    var el = $('estadoConexion');\n    el.className = 'pill ' + clase;\n    el.lastElementChild.textContent = texto;\n  }\n\n  function pintar() {\n    var p = datos.panel, e = p.equipo;\n    var viejo = null;\n    p.agentes.forEach(function (a) { a.esperando.forEach(function (t) { if (!viejo || t.esperaDesde < viejo) viejo = t.esperaDesde; }); });\n    var html = '';\n    html += '<section class=\"kpis\" aria-label=\"Totales del equipo\">' +\n      kpi('Clientes esperando respuesta', '<span>' + e.esperando + '</span>', 'casos asignados · ' + e.seguimiento + ' en seguimiento', true) +\n      kpi('El que más lleva esperando', viejo ? '<span class=\"reloj\" data-desde=\"' + esc(viejo) + '\" data-color=\"1\">' + dur((ahora() - Date.parse(viejo)) / 1000) + '</span>' : '—', 'corre en vivo, segundo a segundo') +\n      kpi('Respuestas hoy', e.respuestas, e.casosRespondidos + ' casos respondidos') +\n      kpi('Cerrados hoy', e.cerrados, e.asignados + ' asignados · ' + e.reasignados + ' re-asignados') +\n      kpi('Tiempo prom. de respuesta', minTxt(e.promedioRespuestaMin), 'mediana ' + minTxt(e.medianaRespuestaMin) + ' · horario laboral') +\n      kpi('Sin asignar', p.sinAsignar.length, p.sinAsignar.length ? 'esperando que alguien los tome' : 'cola vacía') +\n      '</section>';\n\n    html += '<div class=\"titulo\"><h2>Agentes</h2><span>Toca una tarjeta para ver solo sus tickets</span></div>';\n    html += '<section class=\"agentes\" aria-label=\"Agentes\">' + p.agentes.map(tarjeta).join('') + '</section>';\n\n    html += '<div class=\"doble\">' +\n      '<section class=\"bloque tabla\" aria-label=\"Tickets esperando respuesta\"><div id=\"tabla\"></div></section>' +\n      '<section class=\"bloque feed\" aria-label=\"Actividad\"><div class=\"bloque-cab\"><h3>Lo que va pasando</h3><span class=\"sub\">Hoy · ' + esc(diaBonito(datos.hoy)) + '</span></div>' +\n      feed(p.feed) + '</section></div>';\n\n    html += '<footer><span>Fuente: Help Scout · horario ' + datos.horario.inicio + ':00–' + datos.horario.fin + ':00 · meta de respuesta ' + datos.metaRespuestaMin + ' min</span>' +\n      '<span>Recarga completa a las ' + esc(hora(Date.parse(datos.ultimaRecargaCompleta), false)) + '</span></footer>';\n\n    $('contenido').innerHTML = html;\n    Array.prototype.forEach.call(document.querySelectorAll('.card[data-id]'), function (b) {\n      b.addEventListener('click', function () {\n        var id = b.getAttribute('data-id');\n        filtro = filtro === id ? 'todos' : id;\n        pintarTabla();\n        marcarTarjetas();\n      });\n    });\n    marcarTarjetas();\n    pintarTabla();\n    tic();\n  }\n\n  function kpi(l, v, n, destacado) {\n    return '<div class=\"kpi' + (destacado ? ' destacado' : '') + '\"><span class=\"l\">' + esc(l) + '</span><span class=\"v\">' + v + '</span><span class=\"n\">' + esc(n) + '</span></div>';\n  }\n\n  function tarjeta(a) {\n    if (!a.vinculado || !a.hoy) {\n      return '<div class=\"card sin-vincular\"><div class=\"cab\"><span class=\"avatar\">' + esc(iniciales(a.nombre)) + '</span><span><span class=\"nom\">' + esc(a.nombre) +\n        '</span><span class=\"estado t-neutro\">No vinculada en Help Scout</span></span></div></div>';\n    }\n    var h = a.hoy;\n    var viejo = a.esperando.length ? a.esperando[0].esperaDesde : null;\n    return '<button type=\"button\" class=\"card\" data-id=\"' + a.id + '\" aria-pressed=\"false\">' +\n      '<span class=\"cab\"><span class=\"avatar\">' + esc(iniciales(a.nombre)) + '</span><span><span class=\"nom\">' + esc(a.nombre) + '</span>' +\n      '<span class=\"estado t-neutro\" data-ultima=\"' + esc(h.ultimaRespuesta || '') + '\" data-esperando=\"' + a.esperando.length + '\">—</span></span></span>' +\n      '<span class=\"duo\">' +\n        '<span class=\"caja\"><span class=\"l\">Esperando respuesta</span><span class=\"v\">' + a.esperando.length + '</span></span>' +\n        (viejo\n          ? '<span class=\"caja reloj-caja\" data-desde=\"' + esc(viejo) + '\"><span class=\"l\">El que más espera</span><span class=\"r reloj\" data-desde=\"' + esc(viejo) + '\">' + dur((ahora() - Date.parse(viejo)) / 1000) + '</span></span>'\n          : '<span class=\"caja t-ok\"><span class=\"l\">El que más espera</span><span class=\"r\">Al día</span></span>') +\n      '</span>' +\n      '<span class=\"metricas\">' +\n        m('Asignados hoy', h.asignados) + m('Respuestas', h.respuestas) + m('Cerrados', h.cerrados) +\n        m('En seguimiento', a.seguimiento) + m('Prom. respuesta', minTxt(h.promedioRespuestaMin)) + m('Prom. 1ª resp.', minTxt(h.promedioPrimeraMin)) +\n      '</span>' +\n      '<span class=\"pie\">' + (h.ultimaRespuesta\n        ? 'Última respuesta hace <b class=\"reloj\" data-desde=\"' + esc(h.ultimaRespuesta) + '\">' + dur((ahora() - Date.parse(h.ultimaRespuesta)) / 1000) + '</b> · ' + h.reasignados + ' re-asignados'\n        : 'Todavía no responde hoy · ' + h.reasignados + ' re-asignados') + '</span>' +\n      '</button>';\n  }\n  function m(l, v) { return '<div><span class=\"l\">' + esc(l) + '</span><span class=\"v\">' + esc(v) + '</span></div>'; }\n\n  function marcarTarjetas() {\n    Array.prototype.forEach.call(document.querySelectorAll('.card[data-id]'), function (b) {\n      var activa = b.getAttribute('data-id') === String(filtro);\n      b.classList.toggle('activa', activa);\n      b.setAttribute('aria-pressed', activa ? 'true' : 'false');\n    });\n  }\n\n  function pintarTabla() {\n    var p = datos.panel;\n    var filas = [];\n    p.agentes.forEach(function (a) { a.esperando.forEach(function (t) { filas.push(t); }); });\n    p.sinAsignar.forEach(function (t) { filas.push(t); });\n    var cuenta = function (f) { return filas.filter(f).length; };\n    var chips = [{ id: 'todos', t: 'Todos', n: filas.length }]\n      .concat(p.agentes.filter(function (a) { return a.vinculado; }).map(function (a) {\n        return { id: String(a.id), t: a.nombre.split(' ')[0], n: a.esperando.length };\n      }))\n      .concat([{ id: 'sin', t: 'Sin asignar', n: p.sinAsignar.length }]);\n    var visibles = filas.filter(function (t) {\n      return filtro === 'todos' || (filtro === 'sin' ? !t.agenteId : String(t.agenteId) === String(filtro));\n    }).sort(function (x, y) { return x.esperaDesde < y.esperaDesde ? -1 : 1; });\n    var titulo = filtro === 'todos' ? 'todo el equipo' : filtro === 'sin' ? 'sin asignar'\n      : (p.agentes.filter(function (a) { return String(a.id) === String(filtro); })[0] || {}).nombre;\n\n    var html = '<div class=\"bloque-cab\"><h3>Clientes esperando respuesta · ' + esc(titulo) + '</h3>' +\n      '<span class=\"sub\">Del que más espera al más reciente · meta ' + datos.metaRespuestaMin + ' min</span></div>';\n    html += '<div class=\"chips\" role=\"group\" aria-label=\"Filtrar por agente\">' + chips.map(function (c) {\n      var activa = String(filtro) === c.id;\n      return '<button type=\"button\" class=\"chip' + (activa ? ' activa' : '') + '\" data-f=\"' + c.id + '\" aria-pressed=\"' + activa + '\">' + esc(c.t) + ' · ' + c.n + '</button>';\n    }).join('') + '</div>';\n    if (!visibles.length) {\n      html += '<div class=\"vacio\">Nadie está esperando respuesta aquí.</div>';\n    } else {\n      html += '<div class=\"scroll\"><table><thead><tr><th>Esperando</th><th>Ticket</th><th>Asunto</th><th>Cliente</th><th>Agente</th><th>Estado</th></tr></thead><tbody>' +\n        visibles.map(function (t) {\n          return '<tr><td><span class=\"reloj-t reloj\" data-desde=\"' + esc(t.esperaDesde) + '\" data-color=\"1\">' + dur((ahora() - Date.parse(t.esperaDesde)) / 1000) + '</span></td>' +\n            '<td class=\"num\"><a href=\"' + esc(t.url) + '\" target=\"_blank\" rel=\"noopener\">#' + esc(t.numero) +\n            ' <svg width=\"11\" height=\"11\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2.5\" stroke-linecap=\"round\" stroke-linejoin=\"round\" aria-hidden=\"true\"><path d=\"M7 17 17 7M8 7h9v9\"/></svg></a></td>' +\n            '<td class=\"asunto\" title=\"' + esc(t.asunto) + '\">' + esc(t.asunto) + '</td>' +\n            '<td class=\"tenue\">' + esc(t.cliente || '—') + '</td>' +\n            '<td>' + (t.agenteId ? esc(t.agente) : '<span class=\"estado t-late\">Sin asignar</span>') + '</td>' +\n            '<td class=\"tenue\">' + (t.estado === 'pending' ? 'Pending · el cliente respondió' : 'Activo') + (t.buzon ? ' · ' + esc(t.buzon) : '') + '</td></tr>';\n        }).join('') + '</tbody></table></div>';\n    }\n    $('tabla').innerHTML = html;\n    Array.prototype.forEach.call(document.querySelectorAll('.chip'), function (b) {\n      b.addEventListener('click', function () { filtro = b.getAttribute('data-f'); pintarTabla(); marcarTarjetas(); });\n    });\n    tic();\n  }\n\n  var ICONOS = {\n    RESPUESTA: ['var(--ok)', 'var(--ok-bg)', '<path d=\"M9 14 4 9l5-5\"/><path d=\"M4 9h10a6 6 0 0 1 6 6v5\"/>'],\n    CLIENTE: ['var(--warn)', 'var(--warn-bg)', '<path d=\"M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z\"/>'],\n    ASIGNADO: ['var(--accent)', 'rgba(124,147,255,.14)', '<circle cx=\"12\" cy=\"8\" r=\"4\"/><path d=\"M4 21a8 8 0 0 1 16 0\"/>'],\n    CERRADO: ['var(--ok)', 'var(--ok-bg)', '<path d=\"M20 6 9 17l-5-5\"/>'],\n    REASIGNADO: ['var(--muted)', 'var(--panel-3)', '<path d=\"M17 1l4 4-4 4\"/><path d=\"M3 11V9a4 4 0 0 1 4-4h14\"/><path d=\"M7 23l-4-4 4-4\"/><path d=\"M21 13v2a4 4 0 0 1-4 4H3\"/>'],\n    NUEVA_CONSULTA: ['var(--warn)', 'var(--warn-bg)', '<path d=\"M12 5v14M5 12h14\"/>'],\n  };\n  function feed(items) {\n    if (!items.length) return '<div class=\"vacio\">Todavía no hay movimientos hoy.</div>';\n    return '<ol>' + items.map(function (f) {\n      var ic = ICONOS[f.tipo] || ICONOS.REASIGNADO;\n      return '<li><span class=\"ic\" style=\"color:' + ic[0] + ';background:' + ic[1] + '\"><svg width=\"14\" height=\"14\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2.2\" stroke-linecap=\"round\" stroke-linejoin=\"round\" aria-hidden=\"true\">' + ic[2] + '</svg></span>' +\n        '<span><a class=\"tx\" href=\"' + esc(f.url) + '\" target=\"_blank\" rel=\"noopener\">' + esc(f.texto) + '</a><br>' +\n        '<span class=\"hr\">' + esc(hora(Date.parse(f.fecha), false)) + ' · hace <span class=\"reloj\" data-desde=\"' + esc(f.fecha) + '\" data-corto=\"1\">' + corto((ahora() - Date.parse(f.fecha)) / 1000) + '</span></span></span></li>';\n    }).join('') + '</ol>';\n  }\n  function corto(seg) {\n    seg = Math.max(0, Math.floor(seg));\n    if (seg < 60) return seg + ' s';\n    if (seg < 3600) return Math.floor(seg / 60) + ' min';\n    return Math.floor(seg / 3600) + ' h ' + p2(Math.floor(seg % 3600 / 60)) + ' min';\n  }\n  function diaBonito(d) {\n    var f = new Date(d + 'T12:00:00Z');\n    try { return f.toLocaleDateString('es', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' }); } catch (e) { return d; }\n  }\n\n  // ---------- Cada segundo ----------\n  function tic() {\n    var t = ahora();\n    $('reloj').textContent = hora(t, true);\n    if (!datos || !datos.ok) return;\n    var hace = Math.max(0, Math.floor((Date.now() - ultimaOk) / 1000));\n    $('actualizado').textContent = pausado ? 'En pausa · datos de hace ' + corto(hace)\n      : 'Actualizado hace ' + hace + ' s · ' + (datos.enHorario ? 'cada ' + datos.segundos + ' s' : 'fuera de horario, cada ' + datos.segundosFueraDeHorario + ' s');\n    if (!pausado && !enCurso) pintarConexion(datos.enHorario ? 'vivo' : 'fuera', datos.enHorario ? 'En vivo' : 'Fuera de horario');\n    if (pausado) pintarConexion('pausa', 'En pausa');\n    var total = intervalo() * 1000;\n    $('barra').style.width = pausado ? '0' : Math.min(100, Math.max(0, 100 - (proxima - Date.now()) / total * 100)) + '%';\n\n    Array.prototype.forEach.call(document.querySelectorAll('.reloj[data-desde]'), function (el) {\n      var seg = (t - Date.parse(el.getAttribute('data-desde'))) / 1000;\n      el.textContent = el.getAttribute('data-corto') ? corto(seg) : dur(seg);\n      if (el.getAttribute('data-color')) {\n        el.classList.remove('t-ok', 't-warn', 't-late');\n        el.classList.add(tonoEspera(seg / 60));\n        if (!el.classList.contains('reloj-t')) el.style.background = 'none';\n      }\n    });\n    Array.prototype.forEach.call(document.querySelectorAll('.reloj-caja'), function (el) {\n      var min = (t - Date.parse(el.getAttribute('data-desde'))) / 60000;\n      el.classList.remove('t-ok', 't-warn', 't-late');\n      el.classList.add(tonoEspera(min));\n      var r = el.querySelector('.r');\n      r.style.color = min < datos.metaRespuestaMin / 2 ? 'var(--ok)' : min < datos.metaRespuestaMin ? 'var(--warn)' : 'var(--late)';\n    });\n    var alerta = datos.alertaSinResponderMin || [10, 30];\n    Array.prototype.forEach.call(document.querySelectorAll('.estado[data-esperando]'), function (el) {\n      var esperando = Number(el.getAttribute('data-esperando'));\n      var ultima = el.getAttribute('data-ultima');\n      var min = ultima ? (t - Date.parse(ultima)) / 60000 : Infinity;\n      var clase, texto;\n      if (!esperando) { clase = 't-ok'; texto = 'Al día'; }\n      else if (!datos.enHorario) { clase = 't-neutro'; texto = 'Fuera de horario'; }\n      else if (min < alerta[0]) { clase = 't-ok'; texto = 'Respondiendo'; }\n      else if (min < alerta[1]) { clase = 't-warn'; texto = 'Sin responder hace ' + Math.floor(min) + ' min'; }\n      else { clase = 't-late'; texto = ultima ? 'Sin responder hace ' + corto(min * 60) : 'Sin responder hoy'; }\n      el.className = 'estado ' + clase;\n      el.textContent = texto;\n    });\n  }\n\n  // ---------- Controles ----------\n  $('btnPausa').addEventListener('click', function () {\n    pausado = !pausado;\n    this.setAttribute('aria-pressed', pausado ? 'true' : 'false');\n    this.lastElementChild.textContent = pausado ? 'Reanudar' : 'Pausar';\n    if (pausado) clearTimeout(temporizador); else pedir();\n    tic();\n  });\n  if (document.fullscreenEnabled) {\n    $('btnPantalla').hidden = false;\n    $('btnPantalla').addEventListener('click', function () {\n      if (document.fullscreenElement) document.exitFullscreen(); else document.documentElement.requestFullscreen();\n    });\n  }\n  document.addEventListener('visibilitychange', function () {\n    if (!document.hidden && !pausado && Date.now() - ultimaOk > intervalo() * 1000) pedir();\n  });\n\n  // ---------- Demo (solo al abrir el archivo fuera de Apps Script) ----------\n  function datosDemo() {\n    var n = Date.now();\n    var hace = function (min) { return new Date(n - min * 60000).toISOString(); };\n    var t = function (num, min, asunto, cliente, agenteId, agente, estado) {\n      return { id: num, numero: num, asunto: asunto, cliente: cliente, estado: estado || 'active', esperaDesde: hace(min), agenteId: agenteId, agente: agente, buzon: 'Soporte', url: '#' };\n    };\n    var ag = function (id, nombre, esp, seg, hoy) { return { id: id, nombre: nombre, vinculado: true, esperando: esp, seguimiento: seg, abiertos: esp.length + seg, hoy: hoy }; };\n    var hoy = function (r, c, a, re, pr, p1, ult) { return { respuestas: r, casosRespondidos: Math.round(r * .7), asignados: a, cerrados: c, reasignados: re, nuevasConsultas: 2, promedioRespuestaMin: pr, medianaRespuestaMin: pr - 2, promedioPrimeraMin: p1, ultimaRespuesta: ult }; };\n    return {\n      ok: true, ahora: new Date(n).toISOString(), hoy: new Date(n).toISOString().slice(0, 10), tz: 'America/New_York', enHorario: true,\n      horario: { inicio: 9, fin: 17 }, segundos: 5, segundosFueraDeHorario: 60, metaRespuestaMin: 60, alertaSinResponderMin: [10, 30],\n      ultimaRecargaCompleta: hace(4), sinVincular: [],\n      panel: {\n        agentes: [\n          ag(1, 'Jaideth Andocilla', [t(4518, 41, 'Quiero cambiar la fecha de mi entrada', 'Carlos Pérez', 1, 'Jaideth Andocilla'), t(4512, 12, 'No me llegó el acceso al evento', 'Laura Gómez', 1, 'Jaideth Andocilla')], 2, hoy(38, 17, 21, 2, 12, 9, hace(2))),\n          ag(2, 'Maryelin Rios', [t(4498, 96, 'Cobro duplicado en mi tarjeta', 'José Martínez', 2, 'Maryelin Rios'), t(4509, 67, 'Solicitud de reembolso', 'Ana Lucía Torres', 2, 'Maryelin Rios', 'pending'), t(4520, 38, 'No puedo iniciar sesión', 'Diego Herrera', 2, 'Maryelin Rios')], 1, hoy(19, 8, 18, 1, 43, 31, hace(34))),\n          ag(3, 'Edna Escudero', [t(4532, 18, 'El código QR no funciona', 'Valentina Castro', 3, 'Edna Escudero')], 3, hoy(44, 22, 23, 3, 8, 6, hace(1))),\n          ag(4, 'Andrés Rodríguez', [t(4503, 54, 'Necesito la factura de mi compra', 'Luis Ramírez', 4, 'Andrés Rodríguez'), t(4524, 27, '¿Puedo transferir mi entrada?', 'Camila Ortiz', 4, 'Andrés Rodríguez')], 1, hoy(27, 11, 16, 4, 22, 15, hace(13))),\n        ],\n        sinAsignar: [t(4540, 7, 'Ubicación del evento', 'Andrea Molina', null, ''), t(4542, 1, 'Error al pagar con PayPal', 'Felipe Rojas', null, '')],\n        equipo: { esperando: 8, seguimiento: 7, respuestas: 128, casosRespondidos: 90, asignados: 78, cerrados: 58, reasignados: 10, nuevasConsultas: 8, promedioRespuestaMin: 18.4, medianaRespuestaMin: 12, promedioPrimeraMin: 14 },\n        feed: [\n          { fecha: hace(0.3), tipo: 'RESPUESTA', texto: 'Edna Escudero respondió el #4521', url: '#' },\n          { fecha: hace(1), tipo: 'CLIENTE', texto: 'El cliente escribió en el #4542 · sin asignar', url: '#' },\n          { fecha: hace(2), tipo: 'RESPUESTA', texto: 'Jaideth Andocilla respondió el #4531', url: '#' },\n          { fecha: hace(5), tipo: 'CERRADO', texto: 'Edna Escudero cerró el #4517', url: '#' },\n          { fecha: hace(9), tipo: 'ASIGNADO', texto: 'Andrés Rodríguez tomó el #4530', url: '#' },\n          { fecha: hace(13), tipo: 'REASIGNADO', texto: 'Andrés Rodríguez re-asignó el #4511', url: '#' },\n          { fecha: hace(20), tipo: 'NUEVA_CONSULTA', texto: 'Nueva consulta en el #4470 (Maryelin Rios)', url: '#' },\n        ],\n      },\n    };\n  }\n\n  setInterval(tic, 1000);\n  tic();\n  pedir();\n})();\n</script>\n</body>\n</html>\n";

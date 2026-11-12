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
    MINUTOS_RECARGA_COMPLETA: 5,
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
 *   RESPUESTA         (solo con ctx.incluirRespuestas) cada respuesta de un agente del equipo; minutos = tiempo
 *                     desde el primer mensaje del cliente que estaba sin contestar (null si no había ninguno)
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
 *   incluirRespuestas → (opcional) true para emitir también los eventos RESPUESTA
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
  let clienteDesde = null;        // primer mensaje del cliente que sigue sin respuesta

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
      if (!clienteDesde) clienteDesde = fecha;
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
      if (ctx.incluirRespuestas && agente) {
        emitir('RESPUESTA', 'Q-' + h.id, agente, fecha, clienteDesde ? minutosEntre(fecha, clienteDesde) : null);
      }
      clienteDesde = null;
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
    // Al cerrarse el caso, el cliente deja de estar esperando.
    if (nuevoEstado === 'closed' && estadoPrevio !== 'closed' && !esCliente) clienteDesde = null;
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

// ===== Reporte.gs =====
/**
 * Reporte para exportar — cálculo puro (sin servicios de Apps Script), se prueba con Node en tests/.
 * Usa los mismos eventos de HS_Eventos y las mismas reglas (contarDia) que llenan el tracker,
 * así que las cantidades por día coinciden con las de las hojas mensuales.
 */

/** Estadísticas de una lista de minutos. meta (en minutos) es opcional. */
function estadisticasMinutos(valores, meta) {
  const v = valores.filter(m => typeof m === 'number' && !isNaN(m)).sort((a, b) => a - b);
  if (!v.length) return { n: 0, promedio: null, mediana: null, p90: null, maximo: null, pctEnMeta: null };
  const r1 = x => Math.round(x * 10) / 10;
  const mitad = Math.floor(v.length / 2);
  return {
    n: v.length,
    promedio: r1(v.reduce((s, m) => s + m, 0) / v.length),
    mediana: r1(v.length % 2 ? v[mitad] : (v[mitad - 1] + v[mitad]) / 2),
    p90: r1(v[Math.max(0, Math.ceil(v.length * 0.9) - 1)]), // el 90% de los casos tardó esto o menos
    maximo: r1(v[v.length - 1]),
    pctEnMeta: meta == null ? null : v.filter(m => m <= meta).length / v.length,
  };
}

/**
 * @param {Object[]} eventos  filas de HS_Eventos: { dia, fecha, tipo, agente, numero, asunto, minutos, enlace }
 * @param {Object} fotos      'día|agente normalizado' → { total, casos } (hoja HS_InicioJornada)
 * @param {Object} f
 *   desde, hasta          'yyyy-MM-dd' (incluidos)
 *   agentes               nombres de los agentes a incluir
 *   tipos                 (opcional) tipos de evento para la hoja de detalle
 *   metaRespuestaMin, metaResolucionHoras, semaforo
 */
function calcularReporte(eventos, fotos, f) {
  const nombres = {};
  f.agentes.forEach(n => { nombres[normalizarTexto(n)] = n; });
  const enRango = e => e.dia && e.dia >= f.desde && e.dia <= f.hasta && nombres[normalizarTexto(e.agente)];
  const propios = eventos.filter(enRango);

  const grupos = {}; // 'día|agente' → eventos
  propios.forEach(e => {
    const k = e.dia + '|' + normalizarTexto(e.agente);
    (grupos[k] = grupos[k] || []).push(e);
  });
  // Días con foto de inicio de jornada pero sin movimientos.
  Object.keys(fotos || {}).forEach(k => {
    const dia = k.split('|')[0];
    const ag = k.slice(dia.length + 1);
    if (dia >= f.desde && dia <= f.hasta && nombres[ag] && !grupos[k] && fotos[k].total > 0) grupos[k] = [];
  });

  const minutosDe = (evs, tipo) => evs.filter(e => e.tipo === tipo && e.minutos != null).map(e => Number(e.minutos));
  const acumulado = agente => ({
    agente: agente, dias: 0, sinAtender: 0, asignados: 0, nuevaConsulta: 0, reasignados: 0, total: 0, cerrados: 0,
    verde: 0, amarillo: 0, rojo: 0, respuestas: 0, casos: new Set(), tResp: [], tPrimera: [], tResol: [],
  });
  const porAgente = {};
  f.agentes.forEach(n => { porAgente[normalizarTexto(n)] = acumulado(n); });
  const equipo = acumulado('EQUIPO');

  const porDia = Object.keys(grupos).sort().map(k => {
    const dia = k.split('|')[0];
    const ag = k.slice(dia.length + 1);
    const evs = grupos[k];
    const m = contarDia(evs, fotos && fotos[k]);
    const respuestas = evs.filter(e => e.tipo === 'RESPUESTA');
    const casos = new Set(respuestas.map(e => String(e.numero)));
    const tResp = minutosDe(evs, 'RESPUESTA');
    const tPrimera = minutosDe(evs, 'PRIMERA_RESPUESTA');
    const tResol = minutosDe(evs, 'CERRADO');
    const ratio = m.total > 0 ? m.cerrados / m.total : null;
    const color = colorSemaforo(ratio, f.semaforo);
    const trabajado = m.total > 0 || m.cerrados > 0;

    [porAgente[ag], equipo].forEach(a => {
      if (trabajado) a.dias++;
      ['sinAtender', 'asignados', 'nuevaConsulta', 'reasignados', 'total', 'cerrados'].forEach(c => { a[c] += m[c]; });
      if (color) a[color.toLowerCase()]++;
      a.respuestas += respuestas.length;
      casos.forEach(n => a.casos.add(n));
      a.tResp = a.tResp.concat(tResp);
      a.tPrimera = a.tPrimera.concat(tPrimera);
      a.tResol = a.tResol.concat(tResol);
    });
    const sr = estadisticasMinutos(tResp, f.metaRespuestaMin);
    const sp = estadisticasMinutos(tPrimera);
    const so = estadisticasMinutos(tResol);
    return {
      dia: dia, agente: nombres[ag],
      sinAtender: m.sinAtender, asignados: m.asignados, nuevaConsulta: m.nuevaConsulta, reasignados: m.reasignados,
      total: m.total, cerrados: m.cerrados, pendientes: m.pendientes, pctResolucion: ratio, semaforo: color,
      respuestas: respuestas.length, casosRespondidos: casos.size,
      respuestaPromMin: sr.promedio, respuestaMedianaMin: sr.mediana, respuestaEnMeta: sr.pctEnMeta,
      primeraPromMin: sp.promedio,
      resolucionPromH: so.promedio == null ? null : Math.round(so.promedio / 60 * 10) / 10,
    };
  });

  const aHoras = x => (x == null ? null : Math.round(x / 60 * 10) / 10);
  const fila = a => {
    const sr = estadisticasMinutos(a.tResp, f.metaRespuestaMin);
    const sp = estadisticasMinutos(a.tPrimera);
    const so = estadisticasMinutos(a.tResol, f.metaResolucionHoras * 60);
    return {
      agente: a.agente, dias: a.dias,
      sinAtender: a.sinAtender, asignados: a.asignados, nuevaConsulta: a.nuevaConsulta, reasignados: a.reasignados,
      total: a.total, cerrados: a.cerrados, pctResolucion: a.total > 0 ? a.cerrados / a.total : null,
      verde: a.verde, amarillo: a.amarillo, rojo: a.rojo,
      respuestas: a.respuestas, casosRespondidos: a.casos.size,
      respuestasPorDia: a.dias ? Math.round(a.respuestas / a.dias * 10) / 10 : null,
      respuestasMedidas: sr.n, respuestaPromMin: sr.promedio, respuestaMedianaMin: sr.mediana, respuestaP90Min: sr.p90,
      respuestaMaxMin: sr.maximo, respuestaEnMeta: sr.pctEnMeta,
      primerasMedidas: sp.n, primeraPromMin: sp.promedio, primeraMedianaMin: sp.mediana, primeraP90Min: sp.p90,
      resolucionesMedidas: so.n, resolucionPromH: aHoras(so.promedio), resolucionMedianaH: aHoras(so.mediana),
      resolucionP90H: aHoras(so.p90), resolucionEnMeta: so.pctEnMeta,
    };
  };

  const tipos = f.tipos && f.tipos.length ? f.tipos : null;
  return {
    filtros: { desde: f.desde, hasta: f.hasta, agentes: f.agentes.slice(), tipos: tipos },
    porAgente: f.agentes.map(n => fila(porAgente[normalizarTexto(n)])).concat([fila(equipo)]),
    porDia: porDia,
    detalle: propios
      .filter(e => !tipos || tipos.indexOf(e.tipo) >= 0)
      .sort((x, y) => String(x.fecha).localeCompare(String(y.fecha)))
      .map(e => ({
        dia: e.dia, fecha: e.fecha, tipo: e.tipo, agente: nombres[normalizarTexto(e.agente)],
        numero: e.numero, asunto: e.asunto, minutos: e.minutos, enlace: e.enlace,
      })),
    eventosTotales: propios.length,
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
  return hsListarConTotal_(ruta, params, clave, maxPaginas).items;
}

/** Igual que hsListarTodo_, pero devuelve también el total que informa Help Scout (para verificar). */
function hsListarConTotal_(ruta, params, clave, maxPaginas) {
  const todos = [];
  let total = null;
  for (let pagina = 1; ; pagina++) {
    const data = hsGet_(ruta, Object.assign({}, params, { page: pagina }));
    const items = (data._embedded && data._embedded[clave]) || [];
    Array.prototype.push.apply(todos, items);
    if (data.page && typeof data.page.totalElements === 'number') total = data.page.totalElements;
    const totalPaginas = data.page ? data.page.totalPages : 1;
    if (!items.length || pagina >= totalPaginas || (maxPaginas && pagina >= maxPaginas)) {
      return { items: todos, total: total, completo: !items.length || pagina >= totalPaginas };
    }
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
    incluirRespuestas: true, // cada respuesta queda en HS_Eventos (para el panel y la exportación)
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
    .addItem('Panel en vivo', 'menuPanelEnVivo')
    .addItem('Verificar panel contra Help Scout', 'menuVerificarPanel')
    .addItem('Completar historial de respuestas (para exportar)', 'menuCompletarHistorial')
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
const PANEL_HTML = "<!DOCTYPE html>\n<html lang=\"es\">\n<head>\n<base target=\"_top\">\n<meta charset=\"utf-8\">\n<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">\n<title>Soporte · Control en vivo</title>\n<link rel=\"preconnect\" href=\"https://fonts.googleapis.com\">\n<link rel=\"preconnect\" href=\"https://fonts.gstatic.com\" crossorigin>\n<link href=\"https://fonts.googleapis.com/css2?family=Montserrat:wght@400;500;600;700&display=swap\" rel=\"stylesheet\">\n<style>\n:root {\n  --bg: #0B0B0C;\n  --surface: #111113;\n  --raised: #18181B;\n  --line: #232327;\n  --line-2: #33333A;\n  --text: #F2F2F3;\n  --text-2: #A6A6AE;\n  --text-3: #85858E;\n  --ok: #5BC79A;\n  --warn: #E2B340;\n  --bad: #F2716B;\n  --r: 6px;\n}\n* { box-sizing: border-box; }\nhtml, body { margin: 0; background: var(--bg); color: var(--text); }\nbody {\n  font-family: 'Montserrat', 'Helvetica Neue', Arial, sans-serif; font-size: 13px; line-height: 1.45; font-weight: 500;\n  font-feature-settings: 'tnum' 1, 'lnum' 1; -webkit-font-smoothing: antialiased;\n}\na { color: inherit; text-decoration: none; }\na:hover { text-decoration: underline; text-underline-offset: 3px; }\nbutton, input, select { font: inherit; color: inherit; }\n:focus-visible { outline: 2px solid var(--text); outline-offset: 2px; }\n.pagina { max-width: 1680px; margin: 0 auto; padding: 0 28px 48px; }\n.num { text-align: right; white-space: nowrap; }\n.ok { color: var(--ok); } .warn { color: var(--warn); } .bad { color: var(--bad); } .tenue { color: var(--text-2); }\n\n/* Cabecera */\n.cab { position: sticky; top: 0; z-index: 5; background: var(--bg); border-bottom: 1px solid var(--line); }\n.cab-in { max-width: 1680px; margin: 0 auto; padding: 0 28px; min-height: 60px; display: flex; align-items: center; gap: 12px 24px; flex-wrap: wrap; }\n.marca { display: flex; align-items: baseline; gap: 12px; margin-right: auto; padding: 14px 0; }\n.marca b { font-size: 15px; font-weight: 700; letter-spacing: .01em; }\n.marca span { font-size: 13px; color: var(--text-2); padding-left: 12px; border-left: 1px solid var(--line-2); }\n.estado-con { display: inline-flex; align-items: center; gap: 8px; font-size: 12px; font-weight: 600; letter-spacing: .06em; text-transform: uppercase; }\n.estado-con i { width: 7px; height: 7px; border-radius: 50%; background: currentColor; }\n.hora { text-align: right; line-height: 1.25; }\n.hora b { display: block; font-size: 17px; font-weight: 600; letter-spacing: .02em; }\n.hora span { font-size: 11.5px; color: var(--text-2); }\n.btn { height: 36px; padding: 0 14px; border-radius: var(--r); border: 1px solid var(--line-2); background: transparent; font-weight: 600; font-size: 12.5px; cursor: pointer; white-space: nowrap; }\n.btn:hover { background: var(--raised); }\n.btn.principal { background: var(--text); color: var(--bg); border-color: var(--text); }\n.btn.principal:hover { background: #D9D9DC; }\n.btn:disabled { opacity: .5; cursor: default; }\n.btn.chico { height: 28px; padding: 0 10px; font-size: 11.5px; }\n.avance { height: 1px; }\n.avance i { display: block; height: 1px; width: 0; background: var(--text-3); transition: width 1s linear; }\n\n.aviso { margin-top: 16px; padding: 10px 14px; border-radius: var(--r); font-size: 12.5px; border: 1px solid var(--line-2); border-left: 3px solid var(--warn); background: var(--surface); }\n.aviso.error { border-left-color: var(--bad); }\n\n.seccion { margin-top: 32px; }\n.seccion-cab { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; flex-wrap: wrap; margin-bottom: 10px; }\n.seccion-cab h2 { margin: 0; font-size: 11.5px; font-weight: 700; letter-spacing: .1em; text-transform: uppercase; }\n.seccion-cab p { margin: 0; font-size: 12px; color: var(--text-2); }\n\n/* Indicadores */\n.indicadores { margin-top: 24px; display: grid; grid-template-columns: repeat(6, minmax(0, 1fr)); border: 1px solid var(--line); border-radius: var(--r); background: var(--surface); }\n.ind { padding: 16px 18px 15px; border-left: 1px solid var(--line); min-width: 0; }\n.ind:first-child { border-left: 0; }\n.ind .l { font-size: 11px; font-weight: 600; letter-spacing: .07em; text-transform: uppercase; color: var(--text-2); }\n.ind .v { font-size: clamp(22px, 1.9vw, 30px); font-weight: 600; letter-spacing: -.02em; line-height: 1.25; margin-top: 6px; white-space: nowrap; }\n.ind .n { font-size: 12px; color: var(--text-2); margin-top: 2px; }\n@media (max-width: 1100px) { .indicadores { grid-template-columns: repeat(3, minmax(0, 1fr)); } .ind:nth-child(4) { border-left: 0; } .ind:nth-child(n+4) { border-top: 1px solid var(--line); } }\n@media (max-width: 620px) { .indicadores { grid-template-columns: repeat(2, minmax(0, 1fr)); } .ind { border-top: 1px solid var(--line); } .ind:nth-child(-n+2) { border-top: 0; } .ind:nth-child(odd) { border-left: 0; } .ind:nth-child(even) { border-left: 1px solid var(--line); } }\n\n/* Tablas */\n.caja { border: 1px solid var(--line); border-radius: var(--r); background: var(--surface); overflow: hidden; }\n.desliza { overflow-x: auto; }\ntable { width: 100%; border-collapse: collapse; }\nth { font-size: 10.5px; font-weight: 600; letter-spacing: .07em; text-transform: uppercase; color: var(--text-2); text-align: left; padding: 10px 14px; border-bottom: 1px solid var(--line); white-space: nowrap; background: var(--surface); }\ntd { padding: 11px 14px; border-bottom: 1px solid var(--line); vertical-align: middle; }\ntbody tr:last-child td, tfoot td { border-bottom: 0; }\ntfoot td { border-top: 1px solid var(--line-2); font-weight: 600; background: var(--raised); }\nth.num { text-align: right; }\n.t-agentes { min-width: 1120px; }\n.t-agentes th, .t-agentes td { padding-left: 9px; padding-right: 9px; }\n.t-agentes th:first-child, .t-agentes td:first-child { padding-left: 16px; }\n.t-agentes tbody tr { cursor: pointer; }\n.t-agentes tbody tr:hover td { background: var(--raised); }\n.t-agentes tbody tr.sel td { background: var(--raised); }\n.t-agentes tbody tr.sel td:first-child { box-shadow: inset 2px 0 0 var(--text); }\n.t-agentes td.fuerte { font-size: 15px; font-weight: 600; }\n.nombre { font-weight: 600; font-size: 13.5px; white-space: nowrap; }\n.est { display: inline-flex; align-items: center; gap: 7px; font-size: 11.5px; font-weight: 600; white-space: nowrap; margin-top: 3px; }\n.est i { width: 7px; height: 7px; border-radius: 50%; background: currentColor; flex: none; }\n.grupo-izq { border-left: 1px solid var(--line); }\n\n/* Pestañas */\n.pestanas { display: flex; gap: 22px; padding: 0 16px; border-bottom: 1px solid var(--line); overflow-x: auto; }\n.pest { background: none; border: 0; padding: 13px 0 12px; font-size: 12.5px; font-weight: 600; color: var(--text-2); cursor: pointer; border-bottom: 2px solid transparent; white-space: nowrap; }\n.pest:hover { color: var(--text); }\n.pest.sel { color: var(--text); border-bottom-color: var(--text); }\n.pest span { color: var(--text-3); font-weight: 500; margin-left: 5px; }\n.t-cola { min-width: 760px; }\n.t-cola tbody tr:hover td { background: var(--raised); }\n.espera { font-weight: 600; font-size: 13px; white-space: nowrap; }\n.barra { display: block; width: 84px; height: 2px; background: var(--line-2); margin-top: 5px; }\n.barra i { display: block; height: 2px; background: currentColor; }\n.asunto { max-width: 380px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }\n.vacio { padding: 28px 16px; text-align: center; color: var(--text-2); }\n\n.dos { display: flex; flex-wrap: wrap; gap: 20px; align-items: flex-start; }\n.dos > .col-a { flex: 999 1 720px; min-width: 0; }\n.dos > .col-b { flex: 1 1 380px; min-width: 0; }\n\n/* Registro */\n.registro { list-style: none; margin: 0; padding: 0; max-height: 620px; overflow-y: auto; }\n.registro li { display: grid; grid-template-columns: 48px 96px minmax(0, 1fr); gap: 10px; padding: 9px 16px; border-bottom: 1px solid var(--line); align-items: baseline; }\n.registro li:last-child { border-bottom: 0; }\n.registro time { color: var(--text-2); font-size: 12px; }\n.registro .tipo { font-size: 10.5px; font-weight: 700; letter-spacing: .07em; text-transform: uppercase; }\n.registro .txt { min-width: 0; }\n.registro .txt small { display: block; color: var(--text-2); font-size: 11.5px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }\n\n.pie { margin-top: 28px; padding-top: 14px; border-top: 1px solid var(--line); font-size: 11.5px; color: var(--text-2); display: flex; justify-content: space-between; gap: 8px 24px; flex-wrap: wrap; }\n.cargando { color: var(--text-2); padding: 80px 0; text-align: center; }\n\n/* Diálogos */\ndialog { border: 1px solid var(--line-2); border-radius: 8px; background: var(--surface); color: var(--text); padding: 0; width: min(1120px, calc(100vw - 32px)); max-height: calc(100vh - 32px); box-shadow: 0 24px 80px rgba(0, 0, 0, .6); }\ndialog::backdrop { background: rgba(0, 0, 0, .66); }\n.dlg-cab { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 16px 20px; border-bottom: 1px solid var(--line); position: sticky; top: 0; background: var(--surface); z-index: 1; }\n.dlg-cab h3 { margin: 0; font-size: 15px; font-weight: 700; }\n.dlg-cab p { margin: 2px 0 0; font-size: 12px; color: var(--text-2); }\n.dlg-cuerpo { padding: 20px; }\n.filtros { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 20px 28px; }\n.campo > label, .campo > .rot { display: block; font-size: 10.5px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; color: var(--text-2); margin-bottom: 8px; }\n.campo input[type=date], .campo select { height: 36px; padding: 0 10px; border-radius: var(--r); border: 1px solid var(--line-2); background: var(--bg); color-scheme: dark; width: 100%; }\n.fechas { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-top: 8px; }\n.fechas span { display: block; font-size: 11px; color: var(--text-2); margin-bottom: 3px; }\n.checks { display: flex; flex-direction: column; gap: 2px; }\n.checks label { display: flex; align-items: center; gap: 9px; min-height: 28px; font-size: 13px; cursor: pointer; }\n.checks input { width: 15px; height: 15px; accent-color: #F2F2F3; }\n.acciones { display: flex; gap: 10px; flex-wrap: wrap; align-items: center; margin-top: 22px; padding-top: 18px; border-top: 1px solid var(--line); }\n.acciones .nota { font-size: 12px; color: var(--text-2); margin-left: auto; }\n.previa { margin-top: 20px; }\n.previa h4 { margin: 0 0 8px; font-size: 11.5px; font-weight: 700; letter-spacing: .1em; text-transform: uppercase; }\n.previa table { min-width: 980px; }\n.resumen-dlg { display: flex; gap: 28px; flex-wrap: wrap; margin-bottom: 18px; }\n.resumen-dlg div b { display: block; font-size: 20px; font-weight: 600; }\n.resumen-dlg div span { font-size: 11px; color: var(--text-2); text-transform: uppercase; letter-spacing: .07em; font-weight: 600; }\n\n@media (max-width: 640px) {\n  .pagina, .cab-in { padding-left: 16px; padding-right: 16px; }\n  .marca span { display: none; }\n  .hora { text-align: left; }\n  .registro li { grid-template-columns: 44px 92px minmax(0, 1fr); padding: 9px 12px; }\n}\n</style>\n</head>\n<body>\n<header class=\"cab\">\n  <div class=\"cab-in\">\n    <div class=\"marca\"><b>Soporte</b><span>Control en vivo · Help Scout</span></div>\n    <span id=\"conexion\" class=\"estado-con tenue\"><i></i><span>Conectando</span></span>\n    <div class=\"hora\"><b id=\"reloj\">--:--:--</b><span id=\"actualizado\">Cargando</span></div>\n    <button type=\"button\" class=\"btn\" id=\"btnPausa\" aria-pressed=\"false\">Pausar</button>\n    <button type=\"button\" class=\"btn principal\" id=\"btnExportar\">Exportar métricas</button>\n  </div>\n  <div class=\"avance\"><i id=\"avance\"></i></div>\n</header>\n\n<main class=\"pagina\">\n  <div id=\"avisos\"></div>\n  <div id=\"contenido\"><div class=\"cargando\">Leyendo Help Scout. La primera carga puede tardar hasta un minuto.</div></div>\n</main>\n\n<dialog id=\"dlgExportar\" aria-labelledby=\"tituloExportar\">\n  <div class=\"dlg-cab\">\n    <div><h3 id=\"tituloExportar\">Exportar métricas</h3><p id=\"subExportar\">Datos del historial del tracker (hoja HS_Eventos).</p></div>\n    <button type=\"button\" class=\"btn chico\" data-cerrar>Cerrar</button>\n  </div>\n  <div class=\"dlg-cuerpo\">\n    <div class=\"filtros\">\n      <div class=\"campo\">\n        <label for=\"expPeriodo\">Periodo</label>\n        <select id=\"expPeriodo\">\n          <option value=\"hoy\">Hoy</option>\n          <option value=\"ayer\">Ayer</option>\n          <option value=\"semana\" selected>Esta semana</option>\n          <option value=\"semanaPasada\">Semana pasada</option>\n          <option value=\"mes\">Este mes</option>\n          <option value=\"mesPasado\">Mes pasado</option>\n          <option value=\"todo\">Todo el historial</option>\n          <option value=\"personal\">Personalizado</option>\n        </select>\n        <div class=\"fechas\">\n          <div><span>Desde</span><input type=\"date\" id=\"expDesde\" aria-label=\"Desde\"></div>\n          <div><span>Hasta</span><input type=\"date\" id=\"expHasta\" aria-label=\"Hasta\"></div>\n        </div>\n      </div>\n      <div class=\"campo\">\n        <span class=\"rot\">Agentes</span>\n        <div class=\"checks\" id=\"expAgentes\"></div>\n      </div>\n      <div class=\"campo\">\n        <span class=\"rot\">Movimientos en la hoja de detalle</span>\n        <div class=\"checks\" id=\"expTipos\">\n          <label><input type=\"checkbox\" value=\"ASIGNADO\" checked> Asignados</label>\n          <label><input type=\"checkbox\" value=\"RESPUESTA\" checked> Respuestas</label>\n          <label><input type=\"checkbox\" value=\"PRIMERA_RESPUESTA\" checked> Primeras respuestas</label>\n          <label><input type=\"checkbox\" value=\"NUEVA_CONSULTA\" checked> Nuevas consultas</label>\n          <label><input type=\"checkbox\" value=\"REASIGNADO\" checked> Re-asignados</label>\n          <label><input type=\"checkbox\" value=\"CERRADO\" checked> Cerrados</label>\n        </div>\n      </div>\n    </div>\n    <div class=\"acciones\">\n      <button type=\"button\" class=\"btn\" id=\"expVer\">Ver vista previa</button>\n      <button type=\"button\" class=\"btn principal\" id=\"expExcel\">Descargar Excel</button>\n      <select id=\"expCsvHoja\" aria-label=\"Hoja para CSV\" style=\"height:36px;padding:0 10px;border-radius:6px;border:1px solid var(--line-2);background:var(--bg);color-scheme:dark\">\n        <option value=\"agentes\">CSV · Resumen por agente</option>\n        <option value=\"dias\">CSV · Por día</option>\n        <option value=\"detalle\">CSV · Detalle de movimientos</option>\n      </select>\n      <button type=\"button\" class=\"btn\" id=\"expCsv\">Descargar CSV</button>\n      <span class=\"nota\" id=\"expEstado\" role=\"status\"></span>\n    </div>\n    <div class=\"previa\" id=\"expPrevia\"></div>\n  </div>\n</dialog>\n\n<dialog id=\"dlgDetalle\" aria-labelledby=\"tituloDetalle\">\n  <div class=\"dlg-cab\">\n    <div><h3 id=\"tituloDetalle\">Detalle</h3><p id=\"subDetalle\"></p></div>\n    <button type=\"button\" class=\"btn chico\" data-cerrar>Cerrar</button>\n  </div>\n  <div class=\"dlg-cuerpo\" id=\"cuerpoDetalle\"></div>\n</dialog>\n\n<script>\n(function () {\n  'use strict';\n  var datos = null, desfase = 0, filtro = 'todos', pausado = false, enCurso = false, ultimaOk = 0, proxima = 0, temporizador = null;\n  var demo = typeof google === 'undefined' || !google.script || !google.script.run;\n  var reporte = null;\n\n  var $ = function (id) { return document.getElementById(id); };\n  var todos = function (sel, raiz) { return Array.prototype.slice.call((raiz || document).querySelectorAll(sel)); };\n  var ahora = function () { return Date.now() + desfase; };\n  var esc = function (t) {\n    return String(t == null ? '' : t).replace(/[&<>\"']/g, function (c) {\n      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '\"': '&quot;', \"'\": '&#39;' }[c];\n    });\n  };\n  var p2 = function (n) { return (n < 10 ? '0' : '') + n; };\n  function dur(seg) {\n    seg = Math.max(0, Math.floor(seg));\n    var d = Math.floor(seg / 86400), h = Math.floor(seg % 86400 / 3600), m = Math.floor(seg % 3600 / 60), s = seg % 60;\n    if (d) return d + ' d ' + p2(h) + ':' + p2(m) + ':' + p2(s);\n    return p2(h) + ':' + p2(m) + ':' + p2(s);\n  }\n  function corto(seg) {\n    seg = Math.max(0, Math.floor(seg));\n    if (seg < 60) return seg + ' s';\n    if (seg < 3600) return Math.floor(seg / 60) + ' min';\n    if (seg < 86400) return Math.floor(seg / 3600) + ' h ' + p2(Math.floor(seg % 3600 / 60)) + ' min';\n    return Math.floor(seg / 86400) + ' d ' + Math.floor(seg % 86400 / 3600) + ' h';\n  }\n  function minTxt(m) {\n    if (m == null) return '—';\n    if (m < 60) return (Math.round(m * 10) / 10).toLocaleString('es') + ' min';\n    return Math.floor(m / 60) + ' h ' + p2(Math.round(m % 60)) + ' min';\n  }\n  function tz() { return (datos && datos.tz) || 'America/New_York'; }\n  function hora(ms, seg) {\n    var o = { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: tz() };\n    if (seg) o.second = '2-digit';\n    try { return new Date(ms).toLocaleTimeString('es', o); } catch (e) { return new Date(ms).toTimeString().slice(0, seg ? 8 : 5); }\n  }\n  function tono(min) {\n    var meta = (datos && datos.metaRespuestaMin) || 60;\n    return min < meta / 2 ? 'ok' : min < meta ? 'warn' : 'bad';\n  }\n  function servidor(fn, arg, listo) {\n    if (demo) { setTimeout(function () { listo(JSON.stringify(DEMO[fn](arg))); }, 250); return; }\n    var corre = google.script.run\n      .withSuccessHandler(listo)\n      .withFailureHandler(function (err) { listo(JSON.stringify({ ok: false, error: String(err && err.message || err) })); });\n    if (arg === undefined) corre[fn](); else corre[fn](arg);\n  }\n  function leer(texto) { try { return JSON.parse(texto); } catch (e) { return { ok: false, error: 'Respuesta no válida del servidor.' }; } }\n\n  // ---------- Datos en vivo ----------\n  function pedir() {\n    if (enCurso || pausado) return;\n    enCurso = true;\n    servidor('datosPanelEnVivo', undefined, function (texto) { enCurso = false; recibir(leer(texto)); programar(); });\n  }\n  function intervalo() {\n    if (!datos) return 10;\n    return datos.enHorario ? (datos.segundos || 5) : (datos.segundosFueraDeHorario || 60);\n  }\n  function programar() {\n    clearTimeout(temporizador);\n    if (pausado) return;\n    var s = intervalo();\n    proxima = Date.now() + s * 1000;\n    temporizador = setTimeout(pedir, s * 1000);\n  }\n  var errorActual = '';\n  function recibir(r) {\n    if (!r.ok) {\n      errorActual = r.error || 'Error desconocido';\n      pintarAvisos();\n      if (!datos) $('contenido').innerHTML = '<div class=\"cargando\">Sin datos todavía. Reintentando.</div>';\n      return;\n    }\n    errorActual = '';\n    desfase = Date.parse(r.ahora) - Date.now();\n    datos = r;\n    ultimaOk = Date.now();\n    pintarAvisos();\n    pintar();\n  }\n  function pintarAvisos() {\n    var h = '';\n    if (errorActual) {\n      h += '<div class=\"aviso error\" role=\"alert\"><b>No se pudo leer Help Scout.</b> ' + esc(errorActual) +\n        (datos ? ' Se muestran los últimos datos recibidos (' + hora(ultimaOk + desfase, true) + ').' : '') + '</div>';\n    }\n    if (datos && datos.verificacion && !datos.verificacion.ok) {\n      h += '<div class=\"aviso error\" role=\"alert\"><b>La lectura no cuadra con Help Scout.</b> ' + esc(datos.verificacion.avisos.join(' · ')) + '</div>';\n    }\n    if (datos && datos.sinVincular && datos.sinVincular.length) {\n      h += '<div class=\"aviso\">No encontré en Help Scout a: ' + esc(datos.sinVincular.join(', ')) + '. Revisa su email en la configuración (AGENTES).</div>';\n    }\n    if (demo) h += '<div class=\"aviso\">Vista de demostración con datos de ejemplo. Los datos reales aparecen al abrir la página publicada desde Apps Script.</div>';\n    $('avisos').innerHTML = h;\n  }\n\n  // ---------- Pintado ----------\n  function reloj(desde, clases, extra) {\n    return '<span class=\"reloj ' + (clases || '') + '\" data-desde=\"' + esc(desde) + '\"' + (extra || '') + '>' + dur((ahora() - Date.parse(desde)) / 1000) + '</span>';\n  }\n  function ind(l, v, n) { return '<div class=\"ind\"><div class=\"l\">' + esc(l) + '</div><div class=\"v\">' + v + '</div><div class=\"n\">' + esc(n) + '</div></div>'; }\n\n  function pintar() {\n    var p = datos.panel, e = p.equipo, viejo = null;\n    p.agentes.forEach(function (a) { if (a.esperando.length && (!viejo || a.esperando[0].esperaDesde < viejo)) viejo = a.esperando[0].esperaDesde; });\n    var h = '';\n    h += '<section class=\"indicadores\" aria-label=\"Indicadores del equipo\">' +\n      ind('Clientes esperando', e.esperando, e.abiertos + ' casos abiertos · ' + e.seguimiento + ' en seguimiento') +\n      ind('Mayor espera', viejo ? reloj(viejo, '', ' data-tono=\"1\"') : '—', viejo ? 'reloj en vivo · hh:mm:ss' : 'nadie esperando') +\n      ind('Respuestas hoy', e.respuestas, 'en ' + e.casosRespondidos + ' casos') +\n      ind('Cerrados hoy', e.cerrados, e.asignados + ' asignados · ' + e.reasignados + ' re-asignados') +\n      ind('Tiempo de respuesta', minTxt(e.promedioRespuestaMin), 'promedio · mediana ' + minTxt(e.medianaRespuestaMin)) +\n      ind('Sin asignar', p.sinAsignar.length, p.sinAsignar.length ? 'con el cliente esperando' : 'cola vacía') +\n      '</section>';\n\n    h += '<section class=\"seccion\"><div class=\"seccion-cab\"><h2>Agentes</h2><p>Jornada del ' + esc(diaLargo(datos.hoy)) +\n      ' · clic en una fila para filtrar la cola</p></div><div class=\"caja\"><div class=\"desliza\"><table class=\"t-agentes\">' +\n      '<thead><tr><th>Agente</th><th class=\"num grupo-izq\">Esperando</th><th class=\"num\">Mayor espera</th><th class=\"num\">Seguimiento</th><th class=\"num\">Abiertos</th>' +\n      '<th class=\"num grupo-izq\">Asignados</th><th class=\"num\">Respuestas</th><th class=\"num\">Casos</th><th class=\"num\">Cerrados</th><th class=\"num\">Re-asig.</th>' +\n      '<th class=\"num grupo-izq\">T. respuesta</th><th class=\"num\">1ª respuesta</th><th class=\"num\">Últ. respuesta</th><th></th></tr></thead><tbody>' +\n      p.agentes.map(filaAgente).join('') + '</tbody><tfoot><tr><td>Equipo</td>' +\n      '<td class=\"num grupo-izq\">' + e.esperando + '</td><td class=\"num\">' + (viejo ? reloj(viejo, '', ' data-tono=\"1\"') : '—') + '</td><td class=\"num\">' + e.seguimiento + '</td><td class=\"num\">' + e.abiertos + '</td>' +\n      '<td class=\"num grupo-izq\">' + e.asignados + '</td><td class=\"num\">' + e.respuestas + '</td><td class=\"num\">' + e.casosRespondidos + '</td><td class=\"num\">' + e.cerrados + '</td><td class=\"num\">' + e.reasignados + '</td>' +\n      '<td class=\"num grupo-izq\">' + minTxt(e.promedioRespuestaMin) + '</td><td class=\"num\">' + minTxt(e.promedioPrimeraMin) + '</td><td></td><td></td></tr></tfoot></table></div></div></section>';\n\n    h += '<section class=\"seccion dos\"><div class=\"col-a\"><div class=\"seccion-cab\"><h2>Clientes esperando respuesta</h2><p>Del que más espera al más reciente · meta ' +\n      datos.metaRespuestaMin + ' min</p></div><div class=\"caja\" id=\"cola\"></div></div>' +\n      '<div class=\"col-b\"><div class=\"seccion-cab\"><h2>Registro de actividad</h2><p>Últimos ' + p.feed.length + ' movimientos</p></div><div class=\"caja\">' + registro(p.feed) + '</div></div></section>';\n\n    var v = datos.verificacion;\n    h += '<footer class=\"pie\"><span>Horario ' + datos.horario.inicio + ':00–' + datos.horario.fin + ':00 (' + esc(tz()) + ') · tiempos de respuesta en horario laboral · relojes de espera en tiempo real</span>' +\n      '<span>' + (v ? (v.ok ? 'Verificado con Help Scout ' : 'Lectura con diferencias ') + hora(Date.parse(v.hora), true) + ' · ' + v.casosAbiertos + ' casos abiertos · ' + v.casosDelDia + ' casos con movimiento' : '') + '</span></footer>';\n\n    $('contenido').innerHTML = h;\n    todos('.t-agentes tbody tr[data-id]').forEach(function (tr) {\n      tr.addEventListener('click', function (ev) {\n        if (ev.target.closest('button')) return;\n        var id = tr.getAttribute('data-id');\n        filtro = filtro === id ? 'todos' : id;\n        marcar(); pintarCola();\n      });\n    });\n    todos('[data-detalle]').forEach(function (b) { b.addEventListener('click', function () { abrirDetalle(b.getAttribute('data-detalle'), b.getAttribute('data-nombre')); }); });\n    marcar();\n    pintarCola();\n    tic();\n  }\n\n  function filaAgente(a) {\n    if (!a.vinculado || !a.hoy) {\n      return '<tr><td class=\"nombre\">' + esc(a.nombre) + '</td><td colspan=\"13\" class=\"tenue\">No está vinculada con un usuario de Help Scout</td></tr>';\n    }\n    var h = a.hoy, viejo = a.esperando.length ? a.esperando[0].esperaDesde : null;\n    return '<tr data-id=\"' + a.id + '\">' +\n      '<td><div class=\"nombre\">' + esc(a.nombre) + '</div>' +\n      '<span class=\"est tenue\" data-ultima=\"' + esc(h.ultimaRespuesta || '') + '\" data-esperando=\"' + a.esperando.length + '\"><i></i><span>—</span></span></td>' +\n      '<td class=\"num fuerte grupo-izq\">' + a.esperando.length + '</td>' +\n      '<td class=\"num\">' + (viejo ? reloj(viejo, '', ' data-tono=\"1\"') : '<span class=\"tenue\">—</span>') + '</td>' +\n      '<td class=\"num\">' + a.seguimiento + '</td><td class=\"num\">' + a.abiertos + '</td>' +\n      '<td class=\"num grupo-izq\">' + h.asignados + '</td><td class=\"num\">' + h.respuestas + '</td><td class=\"num\">' + h.casosRespondidos + '</td><td class=\"num\">' + h.cerrados + '</td><td class=\"num\">' + h.reasignados + '</td>' +\n      '<td class=\"num grupo-izq\">' + minTxt(h.promedioRespuestaMin) + '</td><td class=\"num\">' + minTxt(h.promedioPrimeraMin) + '</td>' +\n      '<td class=\"num\">' + (h.ultimaRespuesta ? 'hace <span class=\"reloj\" data-desde=\"' + esc(h.ultimaRespuesta) + '\" data-corto=\"1\">' + corto((ahora() - Date.parse(h.ultimaRespuesta)) / 1000) + '</span>' : '<span class=\"tenue\">sin respuestas hoy</span>') + '</td>' +\n      '<td class=\"num\"><button type=\"button\" class=\"btn chico\" data-detalle=\"' + a.id + '\" data-nombre=\"' + esc(a.nombre) + '\">Detalle</button></td></tr>';\n  }\n  function marcar() {\n    todos('.t-agentes tbody tr[data-id]').forEach(function (tr) { tr.classList.toggle('sel', tr.getAttribute('data-id') === String(filtro)); });\n  }\n\n  function pintarCola() {\n    var p = datos.panel, filas = [];\n    p.agentes.forEach(function (a) { a.esperando.forEach(function (t) { filas.push(t); }); });\n    p.sinAsignar.forEach(function (t) { filas.push(t); });\n    var pest = [{ id: 'todos', t: 'Todos', n: filas.length }]\n      .concat(p.agentes.filter(function (a) { return a.vinculado; }).map(function (a) { return { id: String(a.id), t: a.nombre, n: a.esperando.length }; }))\n      .concat([{ id: 'sin', t: 'Sin asignar', n: p.sinAsignar.length }]);\n    if (!pest.some(function (x) { return x.id === String(filtro); })) filtro = 'todos';\n    var visibles = filas.filter(function (t) {\n      return filtro === 'todos' || (filtro === 'sin' ? !t.agenteId : String(t.agenteId) === String(filtro));\n    }).sort(function (x, y) { return x.esperaDesde < y.esperaDesde ? -1 : x.esperaDesde > y.esperaDesde ? 1 : 0; });\n    var h = '<div class=\"pestanas\" role=\"tablist\">' + pest.map(function (x) {\n      var sel = String(filtro) === x.id;\n      return '<button type=\"button\" role=\"tab\" aria-selected=\"' + sel + '\" class=\"pest' + (sel ? ' sel' : '') + '\" data-f=\"' + x.id + '\">' + esc(x.t) + '<span>' + x.n + '</span></button>';\n    }).join('') + '</div>';\n    if (!visibles.length) {\n      h += '<div class=\"vacio\">Ningún cliente está esperando respuesta.</div>';\n    } else {\n      h += '<div class=\"desliza\"><table class=\"t-cola\"><thead><tr><th>Espera</th><th>Caso</th><th>Asunto</th><th>Cliente</th><th>Agente</th><th>Estado en Help Scout</th></tr></thead><tbody>' +\n        visibles.map(function (t) {\n          return '<tr><td>' + reloj(t.esperaDesde, 'espera', ' data-tono=\"1\" data-barra=\"1\"') + '<span class=\"barra\"><i></i></span></td>' +\n            '<td><a href=\"' + esc(t.url) + '\" target=\"_blank\" rel=\"noopener\"><b>#' + esc(t.numero) + '</b></a></td>' +\n            '<td class=\"asunto\" title=\"' + esc(t.asunto) + '\">' + esc(t.asunto) + '</td>' +\n            '<td class=\"tenue\">' + esc(t.cliente || '—') + '</td>' +\n            '<td>' + (t.agenteId ? esc(t.agente) : '<span class=\"bad\">Sin asignar</span>') + '</td>' +\n            '<td class=\"tenue\">' + (t.estado === 'pending' ? 'Pending' : 'Active') + (t.buzon ? ' · ' + esc(t.buzon) : '') + '</td></tr>';\n        }).join('') + '</tbody></table></div>';\n    }\n    $('cola').innerHTML = h;\n    todos('.pest').forEach(function (b) { b.addEventListener('click', function () { filtro = b.getAttribute('data-f'); marcar(); pintarCola(); }); });\n    tic();\n  }\n\n  var TIPOS = {\n    RESPUESTA: ['Respuesta', 'ok'], CLIENTE: ['Cliente', 'warn'], ASIGNADO: ['Asignado', ''], CERRADO: ['Cerrado', 'ok'],\n    REASIGNADO: ['Re-asignado', 'tenue'], NUEVA_CONSULTA: ['Consulta', 'warn'], PRIMERA_RESPUESTA: ['1ª respuesta', 'ok'],\n  };\n  function textoMovimiento(f) {\n    var caso = '<a href=\"' + esc(f.url) + '\" target=\"_blank\" rel=\"noopener\"><b>#' + esc(f.numero) + '</b></a>';\n    var ag = esc(f.agente || '');\n    if (f.tipo === 'RESPUESTA') return ag + ' respondió ' + caso + (f.minutos != null ? ' <span class=\"tenue\">en ' + minTxt(f.minutos) + '</span>' : '');\n    if (f.tipo === 'CLIENTE') return 'El cliente escribió en ' + caso + (ag ? ' <span class=\"tenue\">· ' + ag + '</span>' : ' <span class=\"bad\">· sin asignar</span>');\n    if (f.tipo === 'ASIGNADO') return caso + ' asignado a ' + ag;\n    if (f.tipo === 'CERRADO') return ag + ' cerró ' + caso;\n    if (f.tipo === 'REASIGNADO') return ag + ' re-asignó ' + caso;\n    if (f.tipo === 'NUEVA_CONSULTA') return 'Nueva consulta en ' + caso + ' <span class=\"tenue\">· ' + ag + '</span>';\n    return ag + ' ' + caso;\n  }\n  function registro(items) {\n    if (!items.length) return '<div class=\"vacio\">Todavía no hay movimientos en esta jornada.</div>';\n    return '<ol class=\"registro\">' + items.map(function (f) {\n      var t = TIPOS[f.tipo] || [f.tipo, ''];\n      return '<li><time>' + esc(hora(Date.parse(f.fecha), false)) + '</time><span class=\"tipo ' + t[1] + '\">' + esc(t[0]) + '</span>' +\n        '<span class=\"txt\">' + textoMovimiento(f) + '<small>' + esc(f.asunto || '') + '</small></span></li>';\n    }).join('') + '</ol>';\n  }\n  function diaLargo(d) {\n    try { return new Date(d + 'T12:00:00Z').toLocaleDateString('es', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' }); } catch (e) { return d; }\n  }\n\n  // ---------- Cada segundo ----------\n  function conexion(clase, texto) {\n    var el = $('conexion');\n    el.className = 'estado-con ' + clase;\n    el.lastElementChild.textContent = texto;\n  }\n  function tic() {\n    var t = ahora();\n    $('reloj').textContent = hora(t, true);\n    if (!datos) { if (errorActual) conexion('bad', 'Sin conexión'); return; }\n    var hace = Math.max(0, Math.floor((Date.now() - ultimaOk) / 1000));\n    var atrasado = hace > Math.max(30, intervalo() * 4);\n    $('actualizado').textContent = pausado ? 'En pausa · datos de hace ' + corto(hace)\n      : 'Actualizado hace ' + corto(hace) + ' · cada ' + intervalo() + ' s';\n    if (pausado) conexion('warn', 'En pausa');\n    else if (errorActual || atrasado) conexion('bad', 'Sin conexión');\n    else if (!datos.enHorario) conexion('tenue', 'Fuera de horario');\n    else conexion('ok', 'En vivo');\n    $('avance').style.width = pausado ? '0' : Math.min(100, Math.max(0, 100 - (proxima - Date.now()) / (intervalo() * 1000) * 100)) + '%';\n\n    var meta = datos.metaRespuestaMin || 60;\n    todos('.reloj[data-desde]').forEach(function (el) {\n      var seg = (t - Date.parse(el.getAttribute('data-desde'))) / 1000;\n      el.textContent = el.getAttribute('data-corto') ? corto(seg) : dur(seg);\n      if (el.getAttribute('data-tono')) {\n        var c = tono(seg / 60);\n        el.classList.remove('ok', 'warn', 'bad');\n        el.classList.add(c);\n        if (el.getAttribute('data-barra')) {\n          var b = el.parentNode.querySelector('.barra');\n          b.className = 'barra ' + c;\n          b.firstChild.style.width = Math.min(100, seg / 60 / meta * 100) + '%';\n        }\n      }\n    });\n    var alerta = datos.alertaSinResponderMin || [10, 30];\n    todos('.est[data-esperando]').forEach(function (el) {\n      var esperando = Number(el.getAttribute('data-esperando')), ultima = el.getAttribute('data-ultima');\n      var min = ultima ? (t - Date.parse(ultima)) / 60000 : Infinity, clase, texto;\n      if (!esperando) { clase = 'ok'; texto = 'Al día'; }\n      else if (!datos.enHorario) { clase = 'tenue'; texto = 'Fuera de horario'; }\n      else if (min < alerta[0]) { clase = 'ok'; texto = 'Respondiendo'; }\n      else if (min < alerta[1]) { clase = 'warn'; texto = 'Sin responder ' + Math.floor(min) + ' min'; }\n      else { clase = 'bad'; texto = ultima ? 'Sin responder ' + corto(min * 60) : 'Sin responder hoy'; }\n      el.className = 'est ' + clase;\n      el.lastElementChild.textContent = texto;\n    });\n  }\n\n  // ---------- Detalle de una agente ----------\n  function abrirDetalle(id, nombre) {\n    $('tituloDetalle').textContent = nombre;\n    $('subDetalle').textContent = 'Cada cifra de la tabla sale de estas listas.';\n    $('cuerpoDetalle').innerHTML = '<div class=\"vacio\">Cargando.</div>';\n    $('dlgDetalle').showModal();\n    servidor('detalleAgentePanel', id, function (texto) {\n      var d = leer(texto);\n      if (!d.ok) { $('cuerpoDetalle').innerHTML = '<div class=\"aviso error\">' + esc(d.error) + '</div>'; return; }\n      var cuenta = function (tipo) { return d.movimientos.filter(function (m) { return m.tipo === tipo; }).length; };\n      var unicos = function (tipo) { var s = {}; d.movimientos.forEach(function (m) { if (m.tipo === tipo) s[m.numero] = 1; }); return Object.keys(s).length; };\n      var esperando = d.abiertos.filter(function (x) { return x.esperaDesde; }).length;\n      var h = '<div class=\"resumen-dlg\">' +\n        '<div><b>' + esperando + '</b><span>Esperando</span></div><div><b>' + (d.abiertos.length - esperando) + '</b><span>En seguimiento</span></div>' +\n        '<div><b>' + unicos('ASIGNADO') + '</b><span>Asignados</span></div><div><b>' + cuenta('RESPUESTA') + '</b><span>Respuestas</span></div>' +\n        '<div><b>' + unicos('CERRADO') + '</b><span>Cerrados</span></div><div><b>' + unicos('REASIGNADO') + '</b><span>Re-asignados</span></div></div>';\n      h += '<div class=\"previa\"><h4>Casos abiertos (' + d.abiertos.length + ')</h4><div class=\"caja\"><div class=\"desliza\"><table><thead><tr><th>Caso</th><th>Asunto</th><th>Cliente</th><th>Estado</th><th>Cliente espera desde</th></tr></thead><tbody>' +\n        (d.abiertos.map(function (x) {\n          return '<tr><td><a href=\"' + esc(x.url) + '\" target=\"_blank\" rel=\"noopener\"><b>#' + esc(x.numero) + '</b></a></td><td class=\"asunto\">' + esc(x.asunto) + '</td><td class=\"tenue\">' + esc(x.cliente) +\n            '</td><td class=\"tenue\">' + (x.estado === 'pending' ? 'Pending' : 'Active') + '</td><td>' + (x.esperaDesde ? esc(hora(Date.parse(x.esperaDesde), true)) + ' · ' + corto((ahora() - Date.parse(x.esperaDesde)) / 1000) : '<span class=\"tenue\">respondido, en seguimiento</span>') + '</td></tr>';\n        }).join('') || '<tr><td colspan=\"5\" class=\"vacio\">Sin casos abiertos.</td></tr>') + '</tbody></table></div></div></div>';\n      h += '<div class=\"previa\"><h4>Movimientos de la jornada (' + d.movimientos.length + ')</h4><div class=\"caja\"><div class=\"desliza\"><table><thead><tr><th>Hora</th><th>Movimiento</th><th>Caso</th><th>Asunto</th><th class=\"num\">Minutos laborales</th></tr></thead><tbody>' +\n        (d.movimientos.map(function (m) {\n          var t = TIPOS[m.tipo] || [m.tipo, ''];\n          return '<tr><td>' + esc(hora(Date.parse(m.fecha), true)) + '</td><td class=\"' + t[1] + '\">' + esc(t[0]) + '</td><td><a href=\"' + esc(m.url) + '\" target=\"_blank\" rel=\"noopener\"><b>#' + esc(m.numero) +\n            '</b></a></td><td class=\"asunto\">' + esc(m.asunto) + '</td><td class=\"num\">' + (m.minutos == null ? '<span class=\"tenue\">—</span>' : m.minutos) + '</td></tr>';\n        }).join('') || '<tr><td colspan=\"5\" class=\"vacio\">Sin movimientos.</td></tr>') + '</tbody></table></div></div></div>';\n      $('cuerpoDetalle').innerHTML = h;\n    });\n  }\n\n  // ---------- Exportar ----------\n  function hoyLocal() {\n    try { return new Intl.DateTimeFormat('en-CA', { timeZone: tz(), year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ahora())); }\n    catch (e) { return new Date(ahora()).toISOString().slice(0, 10); }\n  }\n  function sumarDias(d, n) { var f = new Date(d + 'T12:00:00Z'); f.setUTCDate(f.getUTCDate() + n); return f.toISOString().slice(0, 10); }\n  function rango(tipo) {\n    var hoy = hoyLocal(), f = new Date(hoy + 'T12:00:00Z'), lunes = sumarDias(hoy, -((f.getUTCDay() + 6) % 7));\n    var mes1 = hoy.slice(0, 8) + '01';\n    if (tipo === 'hoy') return [hoy, hoy];\n    if (tipo === 'ayer') return [sumarDias(hoy, -1), sumarDias(hoy, -1)];\n    if (tipo === 'semana') return [lunes, hoy];\n    if (tipo === 'semanaPasada') return [sumarDias(lunes, -7), sumarDias(lunes, -1)];\n    if (tipo === 'mes') return [mes1, hoy];\n    if (tipo === 'mesPasado') { var fin = sumarDias(mes1, -1); return [fin.slice(0, 8) + '01', fin]; }\n    if (tipo === 'todo') return [(datos && datos.fechaInicio) || '2026-01-01', hoy];\n    return null;\n  }\n  function aplicarPeriodo() {\n    var r = rango($('expPeriodo').value);\n    if (r) { $('expDesde').value = r[0]; $('expHasta').value = r[1]; }\n  }\n  function filtrosExportar() {\n    return {\n      desde: $('expDesde').value, hasta: $('expHasta').value,\n      agentes: todos('#expAgentes input:checked').map(function (i) { return i.value; }),\n      tipos: todos('#expTipos input:checked').map(function (i) { return i.value; }),\n    };\n  }\n  function abrirExportar() {\n    var nombres = (datos && datos.agentes) || [];\n    if (!$('expAgentes').children.length) {\n      $('expAgentes').innerHTML = nombres.map(function (n) { return '<label><input type=\"checkbox\" value=\"' + esc(n) + '\" checked> ' + esc(n) + '</label>'; }).join('');\n      if (datos && datos.fechaInicio) { $('expDesde').min = datos.fechaInicio; $('expHasta').min = datos.fechaInicio; }\n      aplicarPeriodo();\n    }\n    $('expPrevia').innerHTML = '';\n    $('expEstado').textContent = '';\n    reporte = null;\n    $('dlgExportar').showModal();\n  }\n  function pedirReporte(despues) {\n    var f = filtrosExportar();\n    if (!f.desde || !f.hasta || f.desde > f.hasta) { $('expEstado').textContent = 'Revisa las fechas.'; return; }\n    if (!f.agentes.length) { $('expEstado').textContent = 'Elige al menos una agente.'; return; }\n    $('expEstado').textContent = 'Calculando.';\n    ['expVer', 'expExcel', 'expCsv'].forEach(function (id) { $(id).disabled = true; });\n    servidor('reporteMetricas', f, function (texto) {\n      ['expVer', 'expExcel', 'expCsv'].forEach(function (id) { $(id).disabled = false; });\n      var r = leer(texto);\n      if (!r.ok) { $('expEstado').textContent = ''; $('expPrevia').innerHTML = '<div class=\"aviso error\">' + esc(r.error) + '</div>'; return; }\n      reporte = r;\n      $('expEstado').textContent = r.porDia.length + ' filas por día · ' + r.detalle.length + ' movimientos';\n      pintarPrevia();\n      if (despues) despues();\n    });\n  }\n  var pct = function (v) { return v == null ? '—' : Math.round(v * 100) + '%'; };\n  var nv = function (v) { return v == null ? '—' : v.toLocaleString('es'); };\n  function pintarPrevia() {\n    var r = reporte;\n    var h = '';\n    if (r.sincronizacionIncompleta) h += '<div class=\"aviso\">La sincronización con Help Scout todavía está leyendo el historial: las cifras pueden estar incompletas.</div>';\n    h += '<div class=\"previa\"><h4>Resumen por agente · ' + esc(r.filtros.desde) + ' a ' + esc(r.filtros.hasta) + '</h4><div class=\"caja\"><div class=\"desliza\"><table><thead><tr>' +\n      '<th>Agente</th><th class=\"num\">Días</th><th class=\"num\">Asignados</th><th class=\"num\">Nuevas cons.</th><th class=\"num\">Re-asig.</th><th class=\"num\">Total</th><th class=\"num\">Cerrados</th><th class=\"num\">% Resol.</th>' +\n      '<th class=\"num\">Respuestas</th><th class=\"num\">T. resp. prom.</th><th class=\"num\">Mediana</th><th class=\"num\">% en meta</th><th class=\"num\">1ª resp.</th><th class=\"num\">Resolución</th></tr></thead><tbody>' +\n      r.porAgente.slice(0, -1).map(filaPrevia).join('') + '</tbody><tfoot>' + filaPrevia(r.porAgente[r.porAgente.length - 1]) + '</tfoot></table></div></div>' +\n      '<p class=\"tenue\" style=\"margin:10px 0 0;font-size:12px\">Sincronizado con Help Scout: ' + esc(r.ultimaSincronizacion || 'nunca') +\n      ' · historial desde ' + esc(r.fechaInicio) + '. El archivo incluye además el detalle por día, cada movimiento con su enlace y las definiciones.</p></div>';\n    $('expPrevia').innerHTML = h;\n  }\n  function filaPrevia(a) {\n    return '<tr><td class=\"nombre\">' + esc(a.agente === 'EQUIPO' ? 'Equipo' : a.agente) + '</td><td class=\"num\">' + a.dias + '</td><td class=\"num\">' + a.asignados + '</td><td class=\"num\">' + a.nuevaConsulta +\n      '</td><td class=\"num\">' + a.reasignados + '</td><td class=\"num\">' + a.total + '</td><td class=\"num\">' + a.cerrados + '</td><td class=\"num\">' + pct(a.pctResolucion) + '</td><td class=\"num\">' + a.respuestas +\n      '</td><td class=\"num\">' + minTxt(a.respuestaPromMin) + '</td><td class=\"num\">' + minTxt(a.respuestaMedianaMin) + '</td><td class=\"num\">' + pct(a.respuestaEnMeta) + '</td><td class=\"num\">' + minTxt(a.primeraPromMin) +\n      '</td><td class=\"num\">' + (a.resolucionPromH == null ? '—' : nv(a.resolucionPromH) + ' h') + '</td></tr>';\n  }\n\n  var NOMBRE_TIPO = { ASIGNADO: 'Asignado', RESPUESTA: 'Respuesta', PRIMERA_RESPUESTA: 'Primera respuesta', NUEVA_CONSULTA: 'Nueva consulta', REASIGNADO: 'Re-asignado', CERRADO: 'Cerrado' };\n  function hojas() {\n    var r = reporte, c = r.config, v = function (x) { return x == null ? '' : x; };\n    var agentes = [['Agente', 'Días con actividad', 'Sin atender al iniciar (suma diaria)', 'Asignados', 'Nuevas consultas', 'Re-asignados', 'Total gestionados (suma diaria)', 'Cerrados', '% Resolución',\n      'Días en verde', 'Días en amarillo', 'Días en rojo', 'Respuestas enviadas', 'Casos respondidos', 'Respuestas por día', 'Respuestas con tiempo medido', 'T. respuesta promedio (min)',\n      'T. respuesta mediana (min)', 'T. respuesta P90 (min)', 'T. respuesta máximo (min)', '% respuestas dentro de la meta', 'Primeras respuestas medidas', '1ª respuesta promedio (min)',\n      '1ª respuesta mediana (min)', '1ª respuesta P90 (min)', 'Cierres medidos', 'Resolución promedio (h)', 'Resolución mediana (h)', 'Resolución P90 (h)', '% resueltos dentro de la meta']]\n      .concat(r.porAgente.map(function (a) {\n        return [a.agente, a.dias, a.sinAtender, a.asignados, a.nuevaConsulta, a.reasignados, a.total, a.cerrados, v(a.pctResolucion), a.verde, a.amarillo, a.rojo, a.respuestas, a.casosRespondidos,\n          v(a.respuestasPorDia), a.respuestasMedidas, v(a.respuestaPromMin), v(a.respuestaMedianaMin), v(a.respuestaP90Min), v(a.respuestaMaxMin), v(a.respuestaEnMeta), a.primerasMedidas,\n          v(a.primeraPromMin), v(a.primeraMedianaMin), v(a.primeraP90Min), a.resolucionesMedidas, v(a.resolucionPromH), v(a.resolucionMedianaH), v(a.resolucionP90H), v(a.resolucionEnMeta)];\n      }));\n    var dias = [['Día de jornada', 'Agente', 'Sin atender al iniciar', 'Asignados', 'Nuevas consultas', 'Re-asignados', 'Total gestionados', 'Cerrados', 'Pendientes', '% Resolución', 'Semáforo',\n      'Respuestas enviadas', 'Casos respondidos', 'T. respuesta promedio (min)', 'T. respuesta mediana (min)', '% respuestas dentro de la meta', '1ª respuesta promedio (min)', 'Resolución promedio (h)']]\n      .concat(r.porDia.map(function (d) {\n        return [d.dia, d.agente, d.sinAtender, d.asignados, d.nuevaConsulta, d.reasignados, d.total, d.cerrados, d.pendientes, v(d.pctResolucion), v(d.semaforo), d.respuestas, d.casosRespondidos,\n          v(d.respuestaPromMin), v(d.respuestaMedianaMin), v(d.respuestaEnMeta), v(d.primeraPromMin), v(d.resolucionPromH)];\n      }));\n    var detalle = [['Día de jornada', 'Fecha y hora', 'Movimiento', 'Agente', '# Caso', 'Asunto', 'Minutos laborales', 'Enlace']]\n      .concat(r.detalle.map(function (e) { return [e.dia, e.fecha, NOMBRE_TIPO[e.tipo] || e.tipo, e.agente, e.numero, e.asunto, v(e.minutos), e.enlace]; }));\n    var notas = [['Métricas de soporte — Help Scout'], [],\n      ['Periodo', r.filtros.desde + ' a ' + r.filtros.hasta], ['Agentes', r.filtros.agentes.join(', ')],\n      ['Movimientos en el detalle', r.filtros.tipos ? r.filtros.tipos.map(function (t) { return NOMBRE_TIPO[t] || t; }).join(', ') : 'Todos'],\n      ['Generado', r.generado + ' (' + c.zonaHoraria + ')'], ['Última sincronización con Help Scout', r.ultimaSincronizacion || 'nunca'],\n      ['Historial disponible desde', r.fechaInicio], [],\n      ['Definiciones'],\n      ['Día de jornada', 'Lo que pasa después de las ' + c.horario.fin + ':00 o en un día no laboral cuenta para el siguiente día laboral.'],\n      ['Asignados', 'Casos que quedaron asignados al agente ese día. Cada caso cuenta una vez por día.'],\n      ['Nuevas consultas', 'El cliente volvió a escribir en un caso que el agente tenía desde un día anterior y ya había atendido.'],\n      ['Re-asignados', 'El caso pasó del agente a otra persona, equipo o buzón.'],\n      ['Sin atender al iniciar', 'Foto de las ' + c.horario.inicio + ':00: casos que el agente traía sin atender. La suma de varios días cuenta el mismo caso cada día que siguió abierto.'],\n      ['Total gestionados', 'Sin atender al iniciar + Asignados + Nuevas consultas − Re-asignados (igual que el tracker).'],\n      ['% Resolución', 'Cerrados ÷ Total gestionados. Semáforo: verde ≥ ' + c.semaforo.verde * 100 + '%, amarillo ≥ ' + c.semaforo.amarillo * 100 + '%, rojo por debajo.'],\n      ['Respuestas enviadas', 'Cada mensaje que el agente envió al cliente (no cuentan notas internas).'],\n      ['T. respuesta', 'Minutos desde el primer mensaje del cliente que estaba sin contestar hasta la respuesta. Solo se mide cuando había un mensaje del cliente esperando. Meta: ' + c.metaRespuestaMin + ' min.'],\n      ['1ª respuesta', 'Minutos desde que el caso quedó asignado al agente hasta su primera respuesta.'],\n      ['Resolución', 'Horas desde la asignación (o reapertura) hasta el cierre. Meta: ' + c.metaResolucionHoras + ' h. Los cierres automáticos de Help Scout no cuentan.'],\n      ['Tiempos', 'Todos los tiempos cuentan solo el horario laboral (' + c.horario.inicio + ':00–' + c.horario.fin + ':00, días laborales).'],\n      ['P90', 'El 90% de los casos tardó ese tiempo o menos.'],\n      ['Respuestas de días pasados', 'Las respuestas individuales se registran desde que se instaló esta versión. Para días anteriores usa en la hoja: Help Scout → Completar historial de respuestas.']];\n    return { agentes: agentes, dias: dias, detalle: detalle, notas: notas };\n  }\n  function nombreArchivo(ext, sufijo) { return 'metricas-soporte_' + reporte.filtros.desde + '_a_' + reporte.filtros.hasta + (sufijo ? '_' + sufijo : '') + '.' + ext; }\n  function bajar(blob, nombre) {\n    var a = document.createElement('a');\n    a.href = URL.createObjectURL(blob); a.download = nombre; document.body.appendChild(a); a.click();\n    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 2000);\n  }\n  function cargarXlsx(listo) {\n    if (window.XLSX) return listo(true);\n    var s = document.createElement('script');\n    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';\n    s.onload = function () { listo(!!window.XLSX); };\n    s.onerror = function () { listo(false); };\n    document.head.appendChild(s);\n  }\n  function descargarExcel() {\n    cargarXlsx(function (ok) {\n      if (!ok) { $('expEstado').textContent = 'No se pudo cargar el generador de Excel. Usa la descarga en CSV.'; return; }\n      var h = hojas(), libro = XLSX.utils.book_new();\n      var agregar = function (nombre, filas, anchos, columnasPct) {\n        var hoja = XLSX.utils.aoa_to_sheet(filas);\n        hoja['!cols'] = filas[0].map(function (t, i) { return { wch: (anchos && anchos[i]) || Math.max(12, Math.min(34, String(t).length + 2)) }; });\n        (columnasPct || []).forEach(function (col) {\n          for (var f = 1; f < filas.length; f++) {\n            var celda = hoja[XLSX.utils.encode_cell({ r: f, c: col })];\n            if (celda && typeof celda.v === 'number') celda.z = '0%';\n          }\n        });\n        if (filas.length > 1) hoja['!autofilter'] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: filas.length - 1, c: filas[0].length - 1 } }) };\n        XLSX.utils.book_append_sheet(libro, hoja, nombre);\n      };\n      agregar('Resumen por agente', h.agentes, { 0: 24 }, [8, 20, 29]);\n      agregar('Por día', h.dias, { 0: 14, 1: 24 }, [9, 15]);\n      agregar('Detalle', h.detalle, { 0: 14, 1: 20, 2: 18, 3: 24, 5: 48, 7: 58 });\n      var notas = XLSX.utils.aoa_to_sheet(h.notas);\n      notas['!cols'] = [{ wch: 36 }, { wch: 120 }];\n      XLSX.utils.book_append_sheet(libro, notas, 'Notas');\n      var datosBin = XLSX.write(libro, { bookType: 'xlsx', type: 'array' });\n      bajar(new Blob([datosBin], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), nombreArchivo('xlsx'));\n      $('expEstado').textContent = 'Excel descargado.';\n    });\n  }\n  function descargarCsv() {\n    var cual = $('expCsvHoja').value, filas = hojas()[cual];\n    var texto = filas.map(function (f) {\n      return f.map(function (c) { var s = String(c == null ? '' : c); return /[\",\\n;]/.test(s) ? '\"' + s.replace(/\"/g, '\"\"') + '\"' : s; }).join(',');\n    }).join('\\r\\n');\n    bajar(new Blob(['﻿' + texto], { type: 'text/csv;charset=utf-8' }), nombreArchivo('csv', cual));\n    $('expEstado').textContent = 'CSV descargado.';\n  }\n\n  // ---------- Controles ----------\n  $('btnPausa').addEventListener('click', function () {\n    pausado = !pausado;\n    this.setAttribute('aria-pressed', pausado ? 'true' : 'false');\n    this.textContent = pausado ? 'Reanudar' : 'Pausar';\n    if (pausado) clearTimeout(temporizador); else pedir();\n    tic();\n  });\n  $('btnExportar').addEventListener('click', abrirExportar);\n  $('expPeriodo').addEventListener('change', aplicarPeriodo);\n  ['expDesde', 'expHasta'].forEach(function (id) { $(id).addEventListener('change', function () { $('expPeriodo').value = 'personal'; }); });\n  $('expVer').addEventListener('click', function () { pedirReporte(); });\n  $('expExcel').addEventListener('click', function () { pedirReporte(descargarExcel); });\n  $('expCsv').addEventListener('click', function () { pedirReporte(descargarCsv); });\n  todos('[data-cerrar]').forEach(function (b) { b.addEventListener('click', function () { b.closest('dialog').close(); }); });\n  todos('dialog').forEach(function (d) { d.addEventListener('click', function (ev) { if (ev.target === d) d.close(); }); });\n  document.addEventListener('visibilitychange', function () {\n    if (!document.hidden && !pausado && Date.now() - ultimaOk > intervalo() * 1000) pedir();\n  });\n\n  // ---------- Demostración (solo al abrir el archivo fuera de Apps Script) ----------\n  var DEMO = (function () {\n    var nombres = ['Jaideth Andocilla', 'Maryelin Rios', 'Edna Escudero', 'Andrés Rodríguez'];\n    var asuntos = ['Cobro duplicado en mi tarjeta', 'Solicitud de reembolso', 'No puedo iniciar sesión', 'Necesito la factura de mi compra', 'Cambio de fecha de mi entrada', 'El código QR no funciona', 'No me llegó el acceso', 'Transferir mi entrada'];\n    var clientes = ['José Martínez', 'Ana Lucía Torres', 'Diego Herrera', 'Luis Ramírez', 'Carlos Pérez', 'Valentina Castro', 'Laura Gómez', 'Camila Ortiz'];\n    function hace(min) { return new Date(Date.now() - min * 60000).toISOString(); }\n    function t(i, min, ag, estado) {\n      return { id: 4500 + i, numero: 4500 + i, asunto: asuntos[i % 8], cliente: clientes[i % 8], estado: estado || 'active', esperaDesde: hace(min), agenteId: ag ? ag : null, agente: ag ? nombres[ag - 1] : '', buzon: 'Soporte', url: '#' };\n    }\n    function hoy(r, c, a, re, pr, p1, ult) { return { respuestas: r, casosRespondidos: Math.round(r * .7), asignados: a, cerrados: c, reasignados: re, nuevasConsultas: 2, tiemposMedidos: r - 4, promedioRespuestaMin: pr, medianaRespuestaMin: pr - 2, promedioPrimeraMin: p1, ultimaRespuesta: hace(ult) }; }\n    function ag(id, esp, seg, h) { return { id: id, nombre: nombres[id - 1], vinculado: true, esperando: esp, seguimiento: seg, abiertos: esp.length + seg, activos: esp.length, pendientes: seg, hoy: h }; }\n    return {\n      datosPanelEnVivo: function () {\n        return {\n          ok: true, ahora: new Date().toISOString(), hoy: new Date().toISOString().slice(0, 10), tz: 'America/New_York', enHorario: true, horario: { inicio: 9, fin: 17 },\n          segundos: 5, segundosFueraDeHorario: 60, metaRespuestaMin: 60, alertaSinResponderMin: [10, 30], ultimaRecargaCompleta: hace(3), sinVincular: [],\n          verificacion: { hora: hace(3), ok: true, casosAbiertos: 15, casosDelDia: 96, avisos: [] }, agentes: nombres, fechaInicio: '2026-10-01', metaResolucionHoras: 8,\n          panel: {\n            agentes: [ag(1, [t(18, 41, 1), t(12, 12, 1)], 2, hoy(38, 17, 21, 2, 12.4, 9, 2)), ag(2, [t(1, 96, 2), t(9, 67, 2, 'pending'), t(20, 38, 2)], 1, hoy(19, 8, 18, 1, 43, 31, 34)),\n              ag(3, [t(32, 18, 3)], 3, hoy(44, 22, 23, 3, 8.2, 6, 1)), ag(4, [t(3, 54, 4), t(24, 27, 4)], 1, hoy(27, 11, 16, 4, 22, 15, 13))],\n            sinAsignar: [t(40, 7, 0), t(42, 1, 0)],\n            equipo: { esperando: 8, seguimiento: 7, abiertos: 15, respuestas: 128, casosRespondidos: 90, asignados: 78, cerrados: 58, reasignados: 10, nuevasConsultas: 8, tiemposMedidos: 112, promedioRespuestaMin: 18.4, medianaRespuestaMin: 12, promedioPrimeraMin: 14 },\n            feed: [['RESPUESTA', 3, 21, 0.4, 6], ['CLIENTE', 0, 42, 1, null], ['RESPUESTA', 1, 31, 2, 14], ['CERRADO', 3, 17, 5, 95], ['ASIGNADO', 4, 30, 9, null], ['REASIGNADO', 4, 11, 13, null], ['NUEVA_CONSULTA', 2, 70, 20, null], ['CLIENTE', 2, 20, 38, null]]\n              .map(function (f) { return { fecha: hace(f[3]), tipo: f[0], agente: f[1] ? nombres[f[1] - 1] : '', numero: 4500 + f[2], asunto: asuntos[f[2] % 8], minutos: f[4], url: '#' }; }),\n          },\n        };\n      },\n      detalleAgentePanel: function (id) {\n        return { ok: true, agente: nombres[id - 1], abiertos: [{ numero: 4518, asunto: asuntos[2], cliente: clientes[2], estado: 'active', esperaDesde: hace(41), url: '#' }, { numero: 4531, asunto: asuntos[5], cliente: clientes[5], estado: 'pending', esperaDesde: null, url: '#' }],\n          movimientos: [['RESPUESTA', 2, 14], ['CERRADO', 9, 95], ['RESPUESTA', 12, null], ['ASIGNADO', 30, null]].map(function (m, i) { return { fecha: hace(m[1]), tipo: m[0], numero: 4520 + i, asunto: asuntos[i], minutos: m[2], url: '#' }; }) };\n      },\n      reporteMetricas: function (f) {\n        var filas = f.agentes.map(function (n, i) {\n          return { agente: n, dias: 5, sinAtender: 9 + i, asignados: 80 + i * 7, nuevaConsulta: 12, reasignados: 6, total: 95 + i * 7, cerrados: 82 + i * 5, pctResolucion: 0.86, verde: 3, amarillo: 2, rojo: 0, respuestas: 160 + i * 11, casosRespondidos: 90,\n            respuestasPorDia: 32, respuestasMedidas: 140, respuestaPromMin: 18.2 + i, respuestaMedianaMin: 12, respuestaP90Min: 55, respuestaMaxMin: 190, respuestaEnMeta: 0.91, primerasMedidas: 80, primeraPromMin: 14, primeraMedianaMin: 9, primeraP90Min: 40,\n            resolucionesMedidas: 82, resolucionPromH: 3.4, resolucionMedianaH: 2.1, resolucionP90H: 9, resolucionEnMeta: 0.88 };\n        });\n        var eq = JSON.parse(JSON.stringify(filas[0])); eq.agente = 'EQUIPO';\n        return { ok: true, filtros: { desde: f.desde, hasta: f.hasta, agentes: f.agentes, tipos: f.tipos }, porAgente: filas.concat([eq]),\n          porDia: f.agentes.map(function (n) { return { dia: f.hasta, agente: n, sinAtender: 2, asignados: 16, nuevaConsulta: 2, reasignados: 1, total: 19, cerrados: 17, pendientes: 2, pctResolucion: 0.89, semaforo: 'AMARILLO', respuestas: 31, casosRespondidos: 20, respuestaPromMin: 17, respuestaMedianaMin: 11, respuestaEnMeta: 0.93, primeraPromMin: 12, resolucionPromH: 3.1 }; }),\n          detalle: [{ dia: f.hasta, fecha: f.hasta + ' 10:02:11', tipo: 'RESPUESTA', agente: f.agentes[0], numero: 4521, asunto: asuntos[0], minutos: 12, enlace: 'https://secure.helpscout.net/conversation/1/4521' }],\n          eventosTotales: 1, generado: f.hasta + ' 16:00', ultimaSincronizacion: f.hasta + ' 15:45', sincronizacionIncompleta: false, fechaInicio: '2026-10-01',\n          config: { horario: { inicio: 9, fin: 17 }, metaRespuestaMin: 60, metaResolucionHoras: 8, semaforo: { verde: 0.9, amarillo: 0.6 }, zonaHoraria: 'America/New_York' } };\n      },\n    };\n  })();\n\n  setInterval(tic, 1000);\n  tic();\n  pedir();\n})();\n</script>\n</body>\n</html>\n";

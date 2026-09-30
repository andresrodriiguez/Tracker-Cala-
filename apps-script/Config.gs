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

  // Hora (0-23, zona horaria de la hoja) en que se toma la "foto" de tickets sin atender
  // al iniciar la jornada (columna "Tickets sin atender al iniciar la jornada").
  HORA_INICIO_JORNADA: 9, // jornada del equipo: 9:00 a 17:00 hora de Miami

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

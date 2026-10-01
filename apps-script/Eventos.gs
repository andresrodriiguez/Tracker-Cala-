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
      let agente = agenteDe(asignado);
      const fueraDeCarga = !agente || (ctx.fechaInicio && !(diaEntrada >= ctx.fechaInicio));
      if (!agente && autor.type === 'user') agente = ctx.agentePorId(Number(autor.id));
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

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

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

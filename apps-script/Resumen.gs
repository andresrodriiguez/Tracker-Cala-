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
      const g = grupo(mes.anio, mes.mes, agente);
      const d = {
        sinAtender: num(f[col('sinAtender')]), asignados: num(f[col('asignados')]),
        nuevaConsulta: num(f[col('nuevaConsulta')]), reasignados: num(f[col('reasignados')]),
        cerrados: num(f[col('cerrados')]),
      };
      const totalHoja = f[col('total')];
      const total = typeof totalHoja === 'number' ? totalHoja
        : d.sinAtender + d.asignados + d.nuevaConsulta - d.reasignados;
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

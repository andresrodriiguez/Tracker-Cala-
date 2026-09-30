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

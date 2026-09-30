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

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

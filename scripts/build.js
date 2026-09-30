// Une todos los .gs en dist/Codigo.gs para pegarlo como un solo archivo en Apps Script: `npm run build`
const fs = require('node:fs');
const path = require('node:path');

const orden = ['Config', 'Util', 'Eventos', 'Metricas', 'HelpScout', 'Sync', 'Tracker', 'Resumen', 'Menu'];
const carpeta = path.join(__dirname, '..', 'apps-script');
const cuerpo = orden
  .map(n => '// ===== ' + n + '.gs =====\n' + fs.readFileSync(path.join(carpeta, n + '.gs'), 'utf8').trim())
  .join('\n\n');
const encabezado = '// Tracker Gestión Diaria SOP ⇄ Help Scout — archivo generado con `npm run build`.\n' +
  '// Pégalo completo en Extensiones → Apps Script (reemplaza el contenido de Código.gs).\n\n';
fs.mkdirSync(path.join(__dirname, '..', 'dist'), { recursive: true });
fs.writeFileSync(path.join(__dirname, '..', 'dist', 'Codigo.gs'), encabezado + cuerpo + '\n');
console.log('dist/Codigo.gs generado');

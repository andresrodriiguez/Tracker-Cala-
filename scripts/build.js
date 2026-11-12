// Une todos los .gs en dist/Codigo.gs para pegarlo como un solo archivo en Apps Script: `npm run build`
const fs = require('node:fs');
const path = require('node:path');

const orden = ['Config', 'Util', 'Eventos', 'Metricas', 'EnVivo', 'Reporte', 'HelpScout', 'Sync', 'Tracker', 'Resumen', 'Panel', 'Menu'];
const carpeta = path.join(__dirname, '..', 'apps-script');
const cuerpo = orden
  .map(n => '// ===== ' + n + '.gs =====\n' + fs.readFileSync(path.join(carpeta, n + '.gs'), 'utf8').trim())
  .join('\n\n');
// La página del panel en vivo va incluida como texto, así se instala pegando un solo archivo.
const html = fs.readFileSync(path.join(carpeta, 'Panel.html'), 'utf8');
const panel = '// ===== Panel.html =====\nconst PANEL_HTML = ' + JSON.stringify(html) + ';';
const encabezado = '// Tracker Gestión Diaria SOP ⇄ Help Scout — archivo generado con `npm run build`.\n' +
  '// Pégalo completo en Extensiones → Apps Script (reemplaza el contenido de Código.gs).\n\n';
fs.mkdirSync(path.join(__dirname, '..', 'dist'), { recursive: true });
fs.writeFileSync(path.join(__dirname, '..', 'dist', 'Codigo.gs'), encabezado + cuerpo + '\n\n' + panel + '\n');
console.log('dist/Codigo.gs generado');

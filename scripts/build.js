// Genera dist/Codigo.gs (todo el código en un solo archivo para pegar en Apps Script): `npm run build`
// También deja apps-script/Logica.gs y apps-script/Panel.html para quien use clasp.
const fs = require('node:fs');
const path = require('node:path');

const raiz = path.join(__dirname, '..');
const leer = (...p) => fs.readFileSync(path.join(raiz, ...p), 'utf8');

// La lógica pura del panel se comparte entre el servidor (Apps Script) y la página.
const logica = leer('panel', 'logica.js');
const logicaGs = '/** GENERADO desde panel/logica.js con `npm run build`: no editar aquí. */\n' +
  'var Logica = (function () {\n  var module = { exports: {} };\n' + logica + '\n  return module.exports;\n})();\n';
fs.writeFileSync(path.join(raiz, 'apps-script', 'Logica.gs'), logicaGs);

// La página: un solo HTML con los estilos y el código incluidos.
const cerrar = js => js.replace(/<\/script/gi, '<\\/script');
const html = leer('panel', 'index.html')
  .replace('<link rel="stylesheet" href="estilos.css">', () => '<style>\n' + leer('panel', 'estilos.css') + '</style>')
  .replace('<script src="logica.js"></script>', () => '<script>\n' + cerrar(logica) + '</script>')
  .replace('<script src="app.js"></script>', () => '<script>\n' + cerrar(leer('panel', 'app.js')) + '</script>');
if (/href="estilos\.css"|src="(logica|app)\.js"/.test(html)) throw new Error('No se pudo incluir algún archivo en la página.');
fs.writeFileSync(path.join(raiz, 'apps-script', 'Panel.html'), html);

const orden = ['Config', 'Util', 'Eventos', 'Metricas', 'HelpScout', 'Sync', 'Tracker', 'Resumen', 'Menu', 'Logica', 'PanelServidor'];
const cuerpo = orden
  .map(n => '// ===== ' + n + '.gs =====\n' + leer('apps-script', n + '.gs').trim())
  .join('\n\n');
const encabezado = '// Panel en vivo de soporte + tracker (Help Scout) — archivo generado con `npm run build`.\n' +
  '// Pégalo completo en Extensiones → Apps Script (reemplaza el contenido de Código.gs).\n\n';
fs.mkdirSync(path.join(raiz, 'dist'), { recursive: true });
fs.writeFileSync(path.join(raiz, 'dist', 'Codigo.gs'),
  encabezado + cuerpo + '\n\n// ===== Panel.html =====\nconst PANEL_HTML = ' + JSON.stringify(html) + ';\n');
console.log('dist/Codigo.gs generado (' + Math.round(fs.statSync(path.join(raiz, 'dist', 'Codigo.gs')).size / 1024) + ' KB)');

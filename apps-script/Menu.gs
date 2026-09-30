/**
 * Menú "Help Scout" en la hoja y activadores automáticos.
 */
function onOpen() {
  SpreadsheetApp.getUi().createMenu('Help Scout')
    .addItem('1. Configurar credenciales', 'menuConfigurarCredenciales')
    .addItem('2. Ver usuarios y buzones de Help Scout', 'menuListarUsuarios')
    .addItem('3. Activar sincronización automática', 'menuActivar')
    .addSeparator()
    .addItem('Sincronizar ahora', 'menuSincronizar')
    .addItem('Tomar foto de inicio de jornada ahora', 'menuFoto')
    .addItem('Actualizar resumen mensual', 'menuResumen')
    .addItem('Ver estado', 'menuEstado')
    .addSeparator()
    .addItem('Desactivar sincronización automática', 'menuDesactivar')
    .addItem('Reiniciar sincronización (volver a leer desde FECHA_INICIO)', 'menuReiniciar')
    .addToUi();
}

function menuConfigurarCredenciales() {
  const ui = SpreadsheetApp.getUi();
  const id = ui.prompt('Help Scout — App ID', 'Pega el App ID (Help Scout → Tu perfil → My Apps):', ui.ButtonSet.OK_CANCEL);
  if (id.getSelectedButton() !== ui.Button.OK) return;
  const secret = ui.prompt('Help Scout — App Secret', 'Pega el App Secret:', ui.ButtonSet.OK_CANCEL);
  if (secret.getSelectedButton() !== ui.Button.OK) return;
  PropertiesService.getScriptProperties().setProperties({
    HS_APP_ID: id.getResponseText().trim(),
    HS_APP_SECRET: secret.getResponseText().trim(),
  });
  CacheService.getScriptCache().removeAll(['HS_TOKEN', 'HS_USUARIOS']);
  hsToken_(true); // valida las credenciales
  ui.alert('✅ Conectado a Help Scout. Siguiente paso: "2. Ver usuarios y buzones de Help Scout".');
}

function menuListarUsuarios() {
  const ss = SpreadsheetApp.getActive();
  CacheService.getScriptCache().remove('HS_USUARIOS');
  const equipo = resolverEquipo_();
  const usuarios = hsUsuarios_();
  const mailboxes = hsMailboxes_();

  let hoja = ss.getSheetByName(CONFIG.HOJAS.usuarios);
  if (!hoja) hoja = ss.insertSheet(CONFIG.HOJAS.usuarios, ss.getNumSheets());
  hoja.clear();
  const filasUsuarios = usuarios.map(u => [u.id, u.nombre + ' ' + u.apellido, u.email, u.rol,
    equipo.porId[u.id] ? '✅ ' + equipo.porId[u.id].nombre : '']);
  hoja.getRange(1, 1, 1, 5).setValues([['ID usuario', 'Nombre en Help Scout', 'Email', 'Rol', 'Agente en el tracker']])
    .setFontWeight('bold');
  if (filasUsuarios.length) hoja.getRange(2, 1, filasUsuarios.length, 5).setValues(filasUsuarios);
  const fila = filasUsuarios.length + 3;
  hoja.getRange(fila, 1, 1, 3).setValues([['ID buzón (mailbox)', 'Buzón', 'Email']]).setFontWeight('bold');
  if (mailboxes.length) {
    hoja.getRange(fila + 1, 1, mailboxes.length, 3).setValues(mailboxes.map(m => [m.id, m.nombre, m.email]));
  }
  ss.setActiveSheet(hoja);

  SpreadsheetApp.getUi().alert(equipo.sinEncontrar.length
    ? '⚠️ No encontré en Help Scout a: ' + equipo.sinEncontrar.join(', ') +
      '.\nEscribe su email de Help Scout en CONFIG.AGENTES (archivo Config.gs) y vuelve a probar.'
    : '✅ Todos los agentes del tracker están vinculados con su usuario de Help Scout.\n' +
      'Siguiente paso: "3. Activar sincronización automática".');
}

function menuActivar() {
  eliminarActivadores_();
  ScriptApp.newTrigger('sincronizar').timeBased().everyMinutes(CONFIG.MINUTOS_ENTRE_SINCRONIZACIONES).create();
  sincronizar();
  SpreadsheetApp.getUi().alert('✅ Sincronización activada: cada ' + CONFIG.MINUTOS_ENTRE_SINCRONIZACIONES +
    ' minutos. La foto de "sin atender" se toma a partir de las ' + CONFIG.HORA_INICIO_JORNADA + ':00.\n\n' +
    'La primera vez puede tardar varias ejecuciones en leer todo el historial desde ' + CONFIG.FECHA_INICIO + '.');
}

function menuDesactivar() {
  eliminarActivadores_();
  SpreadsheetApp.getUi().alert('Sincronización automática desactivada.');
}

function menuSincronizar() {
  sincronizar();
  SpreadsheetApp.getActive().toast('Sincronización terminada.', 'Help Scout');
}

function menuFoto() {
  const ss = SpreadsheetApp.getActive();
  const equipo = resolverEquipo_();
  const dia = tomarFotoInicioJornada_(ss, equipo, true);
  if (dia) {
    actualizarTracker_(ss, [dia], equipo);
    ss.toast('Foto de inicio de jornada guardada.', 'Help Scout');
  } else {
    ss.toast('Aún no llega la FECHA_INICIO configurada.', 'Help Scout');
  }
}

function menuResumen() {
  actualizarResumen_(SpreadsheetApp.getActive());
  SpreadsheetApp.getActive().toast('Resumen mensual actualizado.', 'Help Scout');
}

function menuEstado() {
  const props = PropertiesService.getScriptProperties();
  const ultima = props.getProperty('HS_ULTIMA_SYNC');
  const activo = ScriptApp.getProjectTriggers().some(t => t.getHandlerFunction() === 'sincronizar');
  const estado = JSON.parse(props.getProperty('HS_ESTADO_SYNC') || 'null');
  SpreadsheetApp.getUi().alert(
    'Sincronización automática: ' + (activo ? 'ACTIVA' : 'inactiva') + '\n' +
    'Última sincronización: ' + (ultima ? new Date(ultima).toLocaleString() : 'nunca') + '\n' +
    (estado && estado.pagina > 1 ? 'Leyendo historial… (página ' + estado.pagina + ')\n' : '') +
    'Credenciales: ' + (props.getProperty('HS_APP_ID') ? 'configuradas' : 'FALTAN'));
}

function menuReiniciar() {
  const ui = SpreadsheetApp.getUi();
  const r = ui.alert('Reiniciar sincronización',
    'Se volverá a leer Help Scout desde ' + CONFIG.FECHA_INICIO + '. Los eventos ya guardados no se duplican.\n¿Continuar?',
    ui.ButtonSet.YES_NO);
  if (r !== ui.Button.YES) return;
  PropertiesService.getScriptProperties().deleteProperty('HS_ESTADO_SYNC');
  CacheService.getScriptCache().remove('HS_USUARIOS');
  ui.alert('Listo. Usa "Sincronizar ahora" o espera la próxima sincronización automática.');
}

function eliminarActivadores_() {
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === 'sincronizar')
    .forEach(t => ScriptApp.deleteTrigger(t));
}

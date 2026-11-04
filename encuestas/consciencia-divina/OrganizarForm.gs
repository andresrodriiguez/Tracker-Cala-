/**
 * Organiza el Google Form de la encuesta "Consciencia Divina" en secciones.
 *
 * Cómo usarlo (una sola vez, con la cuenta que edita el Form):
 *   1. Abre el Form en modo edición → ⋮ (arriba a la derecha) → Apps Script.
 *   2. Borra lo que trae, pega este archivo completo y guarda.
 *   3. Ejecuta `revisar`: solo muestra en el registro qué va a cambiar (no toca nada).
 *   4. Si todo sale ✅, ejecuta `aplicar`. Antes de cambiar nada, guarda una copia
 *      de respaldo del Form en tu Drive.
 *
 * Qué hace `aplicar`:
 *   - Divide las preguntas en 7 secciones, con barra de progreso.
 *   - Corrige las opciones "Option 2" → "Algo satisfecho" y "Defciente" → "Deficiente".
 *   - Corrige la ortografía de algunos títulos (tildes, signos de interrogación, "*" de más).
 *   - No borra preguntas ni respuestas. El orden de las preguntas no cambia.
 *
 * El banner, los colores y la letra se ponen a mano en "Personalizar tema" (🎨),
 * porque Google no permite cambiarlos con Apps Script.
 */

/**
 * Si el script se crea desde el Form (⋮ → Apps Script), no hace falta el ID.
 * Si se crea aparte en script.google.com, pon aquí el ID del enlace de EDICIÓN:
 * https://docs.google.com/forms/d/ESTE_ES_EL_ID/edit
 */
const FORM_ID = '1j6LpbJw4qF6eI5oQXMYf1U8tYI7GSmf9qYrCSfYweyY';

function abrirForm_() {
  const activo = FormApp.getActiveForm();
  if (activo) return activo;
  try {
    return FormApp.openById(FORM_ID);
  } catch (e) {
    throw new Error('No se pudo abrir el Form. Crea el script desde el propio Form (⋮ → Apps Script) ' +
      'con una cuenta que sea editora, o revisa FORM_ID. Detalle: ' + e.message);
  }
}

/** Cada sección empieza justo antes de la pregunta cuyo título contiene `antes`. */
const SECCIONES = [
  { antes: 'cuan satisfecho te sientes',
    titulo: 'Tu experiencia en general',
    ayuda: 'Empecemos por cómo te sentiste con Consciencia Divina.' },
  { antes: 'informacion que necesitaste',
    titulo: 'Antes del evento',
    ayuda: 'Tu inscripción y la información que recibiste.' },
  { antes: 'organizacion de este evento',
    titulo: 'Organización y Cala Team',
    ayuda: 'La logística, los materiales y el acompañamiento durante el encuentro.' },
  { antes: 'meditaciones guiadas',
    titulo: 'Sesiones y facilitadores',
    ayuda: 'Cuéntanos cómo viviste cada una de las sesiones.' },
  { antes: 'cumplimiento del cronograma',
    titulo: 'Programa y tiempos',
    ayuda: 'El itinerario, la duración de las sesiones y el cierre.' },
  { antes: 'instalaciones del cala center',
    titulo: 'Cala Center y alimentación',
    ayuda: 'Las instalaciones y la comida durante tu estadía.' },
  { antes: 'menos te gusto',
    titulo: 'Tus comentarios',
    ayuda: 'Para terminar, queremos escucharte con tus propias palabras.' },
];

/** Opciones mal escritas. Las respuestas que ya llegaron conservan el texto anterior. */
const CORREGIR_OPCIONES = [
  { pregunta: 'cuan satisfecho te sientes', de: 'Option 2', a: 'Algo satisfecho' },
  { pregunta: 'soporte que recibiste', de: 'Defciente', a: 'Deficiente' },
];

/** Títulos con ortografía corregida. Pon `false` en CORREGIR_TITULOS para no tocarlos. */
const CORREGIR_TITULOS = true;
const TITULOS = [
  { pregunta: 'cuan probable es que desees',
    a: '¿Cuán probable es que desees adquirir otra experiencia de Cala Enterprises?' },
  { pregunta: 'considerando la inversion',
    a: 'Considerando la inversión realizada, ¿cómo calificas la calidad de esta experiencia?' },
  { pregunta: 'calificas la organizacion de este evento',
    a: '¿Cómo calificas la organización de este evento?' },
  { pregunta: 'sesiones con alberto becerra',
    a: 'En general, ¿cómo evalúas las sesiones con Alberto Becerra?' },
  { pregunta: 'sesiones con betsy dopico',
    a: 'En general, ¿cómo evalúas las sesiones con Betsy Dopico?' },
  { pregunta: 'servicio de la comida',
    a: '¿Cómo fue el servicio de la comida?' },
  { pregunta: 'tamano de las porciones',
    a: '¿Qué te pareció el tamaño de las porciones?' },
];

const MENSAJE_CONFIRMACION =
  '¡Gracias por compartir tu experiencia en Consciencia Divina! ' +
  'Cada comentario nos ayuda a seguir creciendo en consciencia y bienestar. 💚';

// ---------------------------------------------------------------------------

/** Solo muestra lo que se va a cambiar. No modifica el Form. */
function revisar() {
  const form = abrirForm_();
  const items = form.getItems();
  Logger.log('Form: "%s" — %s elementos', form.getTitle(), items.length);
  items.forEach(function (it, i) {
    Logger.log('%s. [%s] %s', i, it.getType(), it.getTitle());
  });

  const problemas = verificar_(form);
  const secciones = items.filter(function (it) { return it.getType() === FormApp.ItemType.PAGE_BREAK; });
  Logger.log('');
  Logger.log('Secciones que tiene hoy: %s (se reemplazan por las 7 nuevas)', secciones.length);
  SECCIONES.forEach(function (s, i) {
    const it = buscar_(form, s.antes);
    Logger.log('Sección %s "%s" empieza antes de: %s', i + 1, s.titulo, it ? it.getTitle() : '❌ NO ENCONTRADA');
  });
  CORREGIR_OPCIONES.forEach(function (c) {
    const it = buscar_(form, c.pregunta);
    const tiene = it && opciones_(it).indexOf(c.de) >= 0;
    Logger.log('Opción "%s" → "%s": %s', c.de, c.a, tiene ? 'se corrige' : 'ya no está (se omite)');
  });
  if (CORREGIR_TITULOS) {
    TITULOS.forEach(function (t) {
      const it = buscar_(form, t.pregunta);
      Logger.log('Título: %s → %s', it ? it.getTitle() : '❌ NO ENCONTRADA', t.a);
    });
  }
  Logger.log('');
  Logger.log(problemas.length ? '⚠️ Revisa antes de aplicar:\n' + problemas.join('\n') : '✅ Todo listo. Ejecuta "aplicar".');
}

/** Aplica los cambios al Form (después de guardar una copia de respaldo). */
function aplicar() {
  const form = abrirForm_();
  const problemas = verificar_(form);
  if (problemas.length) throw new Error('No se cambió nada:\n' + problemas.join('\n'));

  const copia = DriveApp.getFileById(form.getId())
    .makeCopy(form.getTitle() + ' (respaldo ' + Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm') + ')');
  Logger.log('Respaldo guardado: %s', copia.getUrl());

  // 1. Quitar las secciones anteriores (y el encabezado de la sección 1 si se ejecuta de nuevo).
  form.getItems().forEach(function (it) {
    const esSeccion = it.getType() === FormApp.ItemType.PAGE_BREAK;
    const esNuestroEncabezado = it.getType() === FormApp.ItemType.SECTION_HEADER && it.getTitle() === SECCIONES[0].titulo;
    if (esSeccion || esNuestroEncabezado) form.deleteItem(it);
  });

  // 2. Corregir opciones y títulos.
  CORREGIR_OPCIONES.forEach(function (c) {
    const it = buscar_(form, c.pregunta);
    if (it && opciones_(it).indexOf(c.de) >= 0) {
      cambiarOpcion_(it, c.de, c.a);
      Logger.log('Opción corregida: "%s" → "%s"', c.de, c.a);
    }
  });
  if (CORREGIR_TITULOS) {
    TITULOS.forEach(function (t) {
      const it = buscar_(form, t.pregunta);
      if (it && it.getTitle() !== t.a) it.setTitle(t.a);
    });
  }

  // 3. Crear las secciones nuevas.
  SECCIONES.forEach(function (s, i) {
    const destino = buscar_(form, s.antes).getIndex();
    const nueva = i === 0 ? form.addSectionHeaderItem() : form.addPageBreakItem();
    nueva.setTitle(s.titulo).setHelpText(s.ayuda);
    form.moveItem(nueva.getIndex(), destino);
  });

  form.setProgressBar(true);
  form.setConfirmationMessage(MENSAJE_CONFIRMACION);
  Logger.log('✅ Listo: %s secciones creadas. Abre el Form y revisa la vista previa (👁).', SECCIONES.length);
}

// ---------------------------------------------------------------------------

function normalizar_(s) {
  return String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

function preguntas_(form) {
  return form.getItems().filter(function (it) {
    const t = it.getType();
    return t !== FormApp.ItemType.PAGE_BREAK && t !== FormApp.ItemType.SECTION_HEADER;
  });
}

/** La única pregunta cuyo título contiene `clave` (sin tildes ni mayúsculas), o null. */
function buscar_(form, clave) {
  const k = normalizar_(clave);
  const hallados = preguntas_(form).filter(function (it) { return normalizar_(it.getTitle()).indexOf(k) >= 0; });
  return hallados.length === 1 ? hallados[0] : null;
}

function verificar_(form) {
  const problemas = [];
  const claves = SECCIONES.map(function (s) { return s.antes; })
    .concat(CORREGIR_OPCIONES.map(function (c) { return c.pregunta; }))
    .concat(CORREGIR_TITULOS ? TITULOS.map(function (t) { return t.pregunta; }) : []);
  claves.forEach(function (clave) {
    const k = normalizar_(clave);
    const n = preguntas_(form).filter(function (it) { return normalizar_(it.getTitle()).indexOf(k) >= 0; }).length;
    if (n !== 1) problemas.push('- "' + clave + '": ' + (n ? n + ' preguntas coinciden' : 'no se encontró la pregunta'));
  });
  return problemas;
}

function conOpciones_(it) {
  switch (it.getType()) {
    case FormApp.ItemType.MULTIPLE_CHOICE: return it.asMultipleChoiceItem();
    case FormApp.ItemType.LIST: return it.asListItem();
    case FormApp.ItemType.CHECKBOX: return it.asCheckboxItem();
    default: return null;
  }
}

function opciones_(it) {
  const c = conOpciones_(it);
  return c ? c.getChoices().map(function (ch) { return ch.getValue(); }) : [];
}

function cambiarOpcion_(it, de, a) {
  const c = conOpciones_(it);
  c.setChoiceValues(c.getChoices().map(function (ch) { return ch.getValue() === de ? a : ch.getValue(); }));
}

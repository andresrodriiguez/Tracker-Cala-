/**
 * Cliente mínimo de la API v2 de Help Scout (Mailbox API).
 * Autenticación OAuth2 "client credentials": App ID + App Secret creados en
 * Help Scout → Tu perfil → My Apps. La app actúa con los permisos del usuario que la creó.
 */
const HS_API = 'https://api.helpscout.net/v2';

function hsCredenciales_() {
  const props = PropertiesService.getScriptProperties();
  const id = props.getProperty('HS_APP_ID');
  const secret = props.getProperty('HS_APP_SECRET');
  if (!id || !secret) {
    throw new Error('Faltan las credenciales de Help Scout. Menú "Help Scout" → "1. Configurar credenciales".');
  }
  return { id: id, secret: secret };
}

function hsToken_(renovar) {
  const cache = CacheService.getScriptCache();
  if (!renovar) {
    const guardado = cache.get('HS_TOKEN');
    if (guardado) return guardado;
  }
  const cred = hsCredenciales_();
  const res = UrlFetchApp.fetch(HS_API + '/oauth2/token', {
    method: 'post',
    payload: { grant_type: 'client_credentials', client_id: cred.id, client_secret: cred.secret },
    muteHttpExceptions: true,
  });
  if (res.getResponseCode() !== 200) {
    throw new Error('Help Scout rechazó las credenciales (' + res.getResponseCode() + '): ' + res.getContentText());
  }
  const data = JSON.parse(res.getContentText());
  cache.put('HS_TOKEN', data.access_token, Math.max(60, Math.min(21600, (data.expires_in || 7200) - 300)));
  return data.access_token;
}

/** GET con reintentos (token vencido, límite de peticiones y errores 5xx). */
function hsGet_(ruta, params) {
  const qs = Object.keys(params || {})
    .filter(k => params[k] !== undefined && params[k] !== null && params[k] !== '')
    .map(k => encodeURIComponent(k) + '=' + encodeURIComponent(params[k]))
    .join('&');
  const url = HS_API + ruta + (qs ? '?' + qs : '');
  let renovar = false;
  for (let intento = 1; intento <= 5; intento++) {
    const res = UrlFetchApp.fetch(url, {
      headers: { Authorization: 'Bearer ' + hsToken_(renovar) },
      muteHttpExceptions: true,
    });
    const codigo = res.getResponseCode();
    if (codigo === 200) return JSON.parse(res.getContentText());
    if (codigo === 401 && !renovar) { renovar = true; continue; }
    if (codigo === 429 || codigo >= 500) {
      const headers = res.getHeaders();
      const espera = Number(headers['X-RateLimit-Retry-After'] || headers['Retry-After'] ||
        headers['x-ratelimit-retry-after'] || headers['retry-after']) || Math.pow(2, intento);
      Utilities.sleep(Math.min(60, espera) * 1000);
      continue;
    }
    throw new Error('Error de Help Scout ' + codigo + ' en ' + ruta + ': ' + res.getContentText());
  }
  throw new Error('Help Scout no respondió después de varios intentos: ' + ruta);
}

/** Recorre todas las páginas de un listado y devuelve los elementos de _embedded[clave]. */
function hsListarTodo_(ruta, params, clave) {
  const todos = [];
  for (let pagina = 1; ; pagina++) {
    const data = hsGet_(ruta, Object.assign({}, params, { page: pagina }));
    const items = (data._embedded && data._embedded[clave]) || [];
    Array.prototype.push.apply(todos, items);
    const totalPaginas = data.page ? data.page.totalPages : 1;
    if (!items.length || pagina >= totalPaginas) return todos;
  }
}

function hsUsuarios_() {
  const cache = CacheService.getScriptCache();
  const guardado = cache.get('HS_USUARIOS');
  if (guardado) return JSON.parse(guardado);
  const usuarios = hsListarTodo_('/users', {}, 'users').map(u => ({
    id: u.id, nombre: u.firstName || '', apellido: u.lastName || '', email: u.email || '', rol: u.role || '',
  }));
  cache.put('HS_USUARIOS', JSON.stringify(usuarios), 21600);
  return usuarios;
}

function hsMailboxes_() {
  return hsListarTodo_('/mailboxes', {}, 'mailboxes').map(m => ({ id: m.id, nombre: m.name, email: m.email }));
}

function hsHilos_(conversacionId) {
  return hsListarTodo_('/conversations/' + conversacionId + '/threads', {}, 'threads');
}

/** Número de conversaciones que cumplen el filtro (sin descargarlas). */
function hsContarConversaciones_(params) {
  const data = hsGet_('/conversations', Object.assign({}, params, { page: 1 }));
  return data.page ? data.page.totalElements : ((data._embedded && data._embedded.conversations) || []).length;
}

/** Date → '2026-09-30T13:00:00Z' (formato que espera Help Scout). */
function hsFechaIso_(fecha) {
  return fecha.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

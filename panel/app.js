/* Panel en vivo: pide los datos al servidor (apiPanel), guarda el estado en el navegador y pinta la página. */
(function () {
  'use strict';
  // Dentro de Apps Script existe google.script.run; fuera (al abrir el archivo suelto) se usan datos de ejemplo.
  var GAS = typeof google !== 'undefined' && google.script && google.script.run;
  var DEMO = !GAS;
  var E = {
    cfg: null, agentes: [], buzones: {}, sinVincular: [], hoy: null, inicioHoy: null, enHorario: true,
    convs: {}, cursor: null, baseEn: 0, cargandoBase: false, verificacion: null,
    reporte: null, reporteEn: 0, panel: null,
  };
  var desfase = 0, filtro = 'todos', pausado = false, enCurso = false, ultimaOk = 0, proxima = 0, temporizador = null, errorActual = '';
  var exportacion = null;

  var $ = function (id) { return document.getElementById(id); };
  var todos = function (sel, raiz) { return Array.prototype.slice.call((raiz || document).querySelectorAll(sel)); };
  var ahora = function () { return Date.now() + desfase; };
  var esc = function (t) {
    return String(t == null ? '' : t).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  };
  var p2 = function (n) { return (n < 10 ? '0' : '') + n; };
  function dur(seg) {
    seg = Math.max(0, Math.floor(seg));
    var d = Math.floor(seg / 86400), h = Math.floor(seg % 86400 / 3600), m = Math.floor(seg % 3600 / 60), s = seg % 60;
    return (d ? d + ' d ' : '') + p2(h) + ':' + p2(m) + ':' + p2(s);
  }
  function corto(seg) {
    if (seg == null) return '—';
    seg = Math.max(0, Math.round(seg));
    if (seg < 60) return seg + ' s';
    if (seg < 3600) return Math.floor(seg / 60) + ' min';
    if (seg < 86400) return Math.floor(seg / 3600) + ' h ' + p2(Math.floor(seg % 3600 / 60)) + ' min';
    return Math.floor(seg / 86400) + ' d ' + Math.floor(seg % 86400 / 3600) + ' h';
  }
  var num = function (v) { return v == null ? '—' : Number(v).toLocaleString('es', { maximumFractionDigits: 1 }); };
  var tz = function () { return (E.cfg && E.cfg.tz) || 'America/New_York'; };
  function hora(ms, seg) {
    var o = { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: tz() };
    if (seg) o.second = '2-digit';
    try { return new Date(ms).toLocaleTimeString('es', o); } catch (e) { return new Date(ms).toTimeString().slice(0, seg ? 8 : 5); }
  }
  function diaLocal(ms) {
    try { return new Intl.DateTimeFormat('en-CA', { timeZone: tz(), year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ms)); }
    catch (e) { return new Date(ms).toISOString().slice(0, 10); }
  }
  function diaLargo(d) {
    try { return new Date(d + 'T12:00:00Z').toLocaleDateString('es', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' }); } catch (e) { return d; }
  }
  function tono(min) {
    var meta = (E.cfg && E.cfg.metaRespuestaMin) || 60;
    return min < meta / 2 ? 'ok' : min < meta ? 'warn' : 'bad';
  }

  // ---------- Servidor ----------
  function api(ruta) {
    var llamada = DEMO ? window.DemoApi(ruta) : new Promise(function (listo) {
      google.script.run
        .withSuccessHandler(listo)
        .withFailureHandler(function (err) { listo(JSON.stringify({ ok: false, error: String((err && err.message) || err) })); })
        .apiPanel(ruta);
    });
    return llamada.then(function (texto) {
      var d;
      try { d = typeof texto === 'string' ? JSON.parse(texto) : texto; } catch (e) { d = { ok: false, error: 'Respuesta no válida del servidor.' }; }
      if (!d.ok) throw new Error(d.error || 'Error desconocido.');
      if (d.ahora) desfase = Date.parse(d.ahora) - Date.now();
      return d;
    });
  }

  // ---------- Carga completa (y verificación contra Help Scout) ----------
  function relevante(c) {
    var equipo = {};
    E.agentes.forEach(function (a) { if (a.id) equipo[a.id] = a; });
    return Logica.esRelevante(c, equipo, E.cfg.mostrarSinAsignar);
  }
  function progreso(texto) { var el = $('progreso'); if (el) el.textContent = texto; }

  function cargarBase() {
    E.cargandoBase = true;
    var nuevas = {}, control = [], colaCompleta = true, inicio;
    var guardar = function (lista) { lista.forEach(function (c) { if (relevante(c)) nuevas[c.id] = c; else delete nuevas[c.id]; }); };
    return api('/api/equipo').then(function (eq) {
      E.cfg = eq.config; E.agentes = eq.agentes; E.buzones = eq.buzones; E.sinVincular = eq.sinVincular;
      E.hoy = eq.hoy; E.inicioHoy = eq.inicioHoy; E.enHorario = eq.enHorario;
      inicio = eq.ahora;
      var vinculadas = E.agentes.filter(function (a) { return a.id; });
      // 1) Casos abiertos de cada agente, una por una.
      return vinculadas.reduce(function (cadena, a) {
        return cadena.then(function () {
          progreso('Leyendo los casos abiertos de ' + a.nombre + '.');
          return api('/api/abiertos?agente=' + a.id).then(function (r) {
            guardar(r.compactos);
            ['active', 'pending'].forEach(function (st) { control.push({ agente: a.nombre, id: a.id, estado: st, helpScout: r.totales[st].helpScout, leidos: r.totales[st].leidos }); });
          });
        });
      }, Promise.resolve());
    }).then(function () {
      // 2) Cola sin asignar.
      if (!E.cfg.mostrarSinAsignar) return null;
      progreso('Leyendo la cola sin asignar.');
      return api('/api/abiertos?agente=sin').then(function (r) { guardar(r.compactos); colaCompleta = r.completo; });
    }).then(function () {
      // 3) Movimientos de hoy (para el registro de actividad y la última respuesta de cada agente).
      var leer = function (pagina, vueltas) {
        progreso('Leyendo los movimientos de hoy (página ' + pagina + ').');
        return api('/api/cambios?desde=' + encodeURIComponent(E.inicioHoy) + '&pagina=' + pagina).then(function (r) {
          guardar(r.compactos);
          return r.siguiente && vueltas < 60 ? leer(r.siguiente, vueltas + 1) : null;
        });
      };
      return leer(1, 0);
    }).then(function () {
      E.convs = nuevas;
      E.cursor = inicio;
      E.baseEn = Date.now();
      // Verificación: lo leído debe coincidir con los totales que informa Help Scout,
      // y los abiertos del panel deben ser exactamente Active + Pending de cada agente.
      var avisos = [];
      control.forEach(function (c) {
        if (c.helpScout != null && c.helpScout !== c.leidos) avisos.push(c.agente + ' (' + c.estado + '): Help Scout informa ' + c.helpScout + ' y se leyeron ' + c.leidos);
      });
      if (!colaCompleta) avisos.push('La cola sin asignar tiene más casos de los que se muestran');
      E.verificacion = {
        hora: Date.now(), ok: !avisos.length, avisos: avisos,
        abiertos: control.reduce(function (s, c) { return s + c.leidos; }, 0), control: control,
      };
      E.cargandoBase = false;
    }).catch(function (e) { E.cargandoBase = false; throw e; });
  }

  // ---------- Actualización incremental ----------
  function cargarCambios() {
    var desde = new Date(Date.parse(E.cursor) - 120000).toISOString(); // 2 min de solape
    var leer = function (pagina, vueltas, cursor) {
      return api('/api/cambios?desde=' + encodeURIComponent(desde) + '&pagina=' + pagina).then(function (r) {
        r.compactos.forEach(function (c) { if (relevante(c)) E.convs[c.id] = c; else delete E.convs[c.id]; });
        cursor = cursor || r.cursor;
        return r.siguiente && vueltas < 10 ? leer(r.siguiente, vueltas + 1, cursor) : cursor;
      });
    };
    return leer(1, 0, null).then(function (cursor) { E.cursor = cursor; });
  }

  function cargarReporte() {
    return api('/api/reporte?desde=' + E.hoy + '&hasta=' + E.hoy).then(function (r) {
      var porId = {};
      r.filas.forEach(function (f) { porId[f.id] = f; });
      E.reporte = { disponible: r.disponible, motivo: r.motivo, porId: porId, hora: Date.now() };
      E.reporteEn = Date.now();
    }).catch(function (e) {
      E.reporte = { disponible: false, motivo: 'No se pudieron leer los reportes de Help Scout: ' + e.message, porId: {}, hora: Date.now() };
      E.reporteEn = Date.now();
    });
  }

  function intervalo() {
    if (!E.cfg) return 5;
    return E.enHorario ? E.cfg.segundos : E.cfg.segundosFueraDeHorario;
  }
  function ciclo() {
    if (enCurso || pausado) return;
    enCurso = true;
    var cambioDeDia = E.hoy && diaLocal(ahora()) !== E.hoy;
    var tocaBase = !E.baseEn || cambioDeDia || Date.now() - E.baseEn > E.cfg.minutosRecarga * 60000;
    var paso = tocaBase ? cargarBase() : cargarCambios();
    paso.then(function () {
      if (!E.reporteEn || cambioDeDia || Date.now() - E.reporteEn > E.cfg.segundosReportes * 1000) return cargarReporte();
    }).then(function () {
      errorActual = ''; ultimaOk = Date.now();
      pintar();
    }).catch(function (e) {
      errorActual = e.message || String(e);
      pintarAvisos(); tic();
    }).then(function () {
      enCurso = false;
      programar();
    });
  }
  function programar() {
    clearTimeout(temporizador);
    if (pausado) return;
    var s = errorActual ? Math.max(15, intervalo()) : intervalo();
    proxima = Date.now() + s * 1000;
    temporizador = setTimeout(ciclo, s * 1000);
  }
  function arrancar() {
    E.baseEn = 0; E.reporteEn = 0;
    ciclo();
  }

  // ---------- Pintado ----------
  function pintarAvisos() {
    var h = '';
    if (errorActual) {
      h += '<div class="aviso error" role="alert"><b>No se pudo leer Help Scout.</b> ' + esc(errorActual) +
        (ultimaOk ? ' Se muestran los últimos datos recibidos (' + hora(ultimaOk + desfase, true) + ').' : '') + '</div>';
    }
    if (E.verificacion && !E.verificacion.ok) {
      h += '<div class="aviso error" role="alert"><b>La lectura no cuadra con Help Scout.</b> ' + esc(E.verificacion.avisos.join(' · ')) + '</div>';
    }
    if (E.reporte && !E.reporte.disponible) {
      h += '<div class="aviso"><b>Sin reportes del día.</b> ' + esc(E.reporte.motivo) + ' Las columnas "Hoy" quedan vacías; lo que pasa en este momento sí se muestra.</div>';
    }
    if (E.sinVincular.length) h += '<div class="aviso">No encontré en Help Scout a: ' + esc(E.sinVincular.join(', ')) + '. Revisa su email en la configuración (AGENTES).</div>';
    if (DEMO) h += '<div class="aviso">Vista de demostración con datos de ejemplo.</div>';
    $('avisos').innerHTML = h;
  }
  function reloj(desde, clases, extra) {
    return '<span class="reloj ' + (clases || '') + '" data-desde="' + esc(desde) + '"' + (extra || '') + '>' + dur((ahora() - Date.parse(desde)) / 1000) + '</span>';
  }
  function ind(l, v, n) { return '<div class="ind"><div class="l">' + esc(l) + '</div><div class="v">' + v + '</div><div class="n">' + esc(n) + '</div></div>'; }
  function rep(id) { return (E.reporte && E.reporte.disponible && E.reporte.porId[id]) || null; }
  function sumaRep(campo) {
    if (!E.reporte || !E.reporte.disponible) return null;
    return E.agentes.reduce(function (s, a) { var r = rep(a.id); return s + ((r && r[campo]) || 0); }, 0);
  }

  function pintar() {
    pintarAvisos();
    var p = E.panel = Logica.armarPanel(Object.keys(E.convs).map(function (k) { return E.convs[k]; }), E.agentes, { buzones: E.buzones, mostrarSinAsignar: E.cfg.mostrarSinAsignar, maxFeed: 60 });
    var e = p.equipo, viejo = null;
    p.agentes.forEach(function (a) { if (a.esperando.length && (!viejo || a.esperando[0].esperaDesde < viejo)) viejo = a.esperando[0].esperaDesde; });
    var hayRep = E.reporte && E.reporte.disponible;
    var h = '';
    h += '<section class="indicadores" aria-label="Indicadores del equipo">' +
      ind('Clientes esperando', e.esperando, 'casos asignados con el cliente esperando') +
      ind('Mayor espera', viejo ? reloj(viejo, '', ' data-tono="1"') : '—', viejo ? 'reloj en vivo · hh:mm:ss' : 'nadie esperando') +
      ind('Casos abiertos', e.abiertos, e.activos + ' Active · ' + e.pendientes + ' Pending') +
      ind('Respuestas hoy', hayRep ? num(sumaRep('totalReplies')) : '—', hayRep ? 'según Reports de Help Scout' : 'reporte no disponible') +
      ind('Resueltos hoy', hayRep ? num(sumaRep('resolved')) : '—', hayRep ? num(sumaRep('closed')) + ' cerrados · según Reports' : 'reporte no disponible') +
      ind('Sin asignar', p.sinAsignar.length, p.sinAsignar.length ? 'con el cliente esperando' : 'cola vacía') +
      '</section>';

    h += '<section class="seccion"><div class="seccion-cab"><h2>Agentes</h2><p>' + esc(diaLargo(E.hoy)) + ' · clic en una fila para filtrar la cola</p></div>' +
      '<div class="caja"><div class="desliza"><table class="t-agentes"><thead>' +
      '<tr class="grupos"><th></th><th colspan="4" class="grupo-izq">En este momento</th><th colspan="7" class="grupo-izq">Hoy · Reports de Help Scout' +
      (hayRep ? ' · ' + hora(E.reporte.hora + desfase, false) : '') + '</th><th colspan="2" class="grupo-izq"></th></tr>' +
      '<tr><th>Agente</th><th class="num grupo-izq">Esperando</th><th class="num">Mayor espera</th><th class="num">Seguimiento</th><th class="num">Abiertos</th>' +
      '<th class="num grupo-izq">Respuestas</th><th class="num">Conversaciones</th><th class="num">Clientes</th><th class="num">Resueltos</th><th class="num">Cerrados</th><th class="num">T. respuesta</th><th class="num">T. resolución</th>' +
      '<th class="num grupo-izq">Últ. respuesta</th><th></th></tr></thead><tbody>' + p.agentes.map(filaAgente).join('') + '</tbody><tfoot><tr><td>Equipo</td>' +
      '<td class="num grupo-izq">' + e.esperando + '</td><td class="num">' + (viejo ? reloj(viejo, '', ' data-tono="1"') : '—') + '</td><td class="num">' + e.seguimiento + '</td><td class="num">' + e.abiertos + '</td>' +
      '<td class="num grupo-izq">' + num(sumaRep('totalReplies')) + '</td><td class="num">' + num(sumaRep('totalConversations')) + '</td><td class="num">' + num(sumaRep('customersHelped')) + '</td><td class="num">' + num(sumaRep('resolved')) + '</td><td class="num">' + num(sumaRep('closed')) + '</td>' +
      '<td class="num tenue">—</td><td class="num tenue">—</td><td class="grupo-izq"></td><td></td></tr></tfoot></table></div></div></section>';

    h += '<section class="seccion dos"><div class="col-a"><div class="seccion-cab"><h2>Clientes esperando respuesta</h2><p>Del que más espera al más reciente · meta ' +
      E.cfg.metaRespuestaMin + ' min</p></div><div class="caja" id="cola"></div></div>' +
      '<div class="col-b"><div class="seccion-cab"><h2>Registro de actividad</h2><p>Hoy · ' + p.movimientos + ' movimientos</p></div><div class="caja">' + registro(p.feed) + '</div></div></section>';

    var v = E.verificacion;
    h += '<footer class="pie"><span>Zona horaria ' + esc(tz()) + ' · jornada ' + E.cfg.horario.inicio + ':00–' + E.cfg.horario.fin + ':00 · los relojes de espera corren en tiempo real</span>' +
      '<span>' + (v ? (v.ok ? 'Verificado con Help Scout ' : 'Lectura con diferencias ') + hora(v.hora + desfase, true) + ' · ' + v.abiertos + ' casos abiertos leídos' : '') + '</span></footer>';

    $('contenido').innerHTML = h;
    todos('.t-agentes tbody tr[data-id]').forEach(function (tr) {
      tr.addEventListener('click', function (ev) {
        if (ev.target.closest('button')) return;
        var id = tr.getAttribute('data-id');
        filtro = filtro === id ? 'todos' : id;
        marcar(); pintarCola();
      });
    });
    todos('[data-detalle]').forEach(function (b) { b.addEventListener('click', function () { abrirDetalle(Number(b.getAttribute('data-detalle'))); }); });
    marcar();
    pintarCola();
    tic();
  }

  function filaAgente(a) {
    if (!a.vinculado) return '<tr><td class="nombre">' + esc(a.nombre) + '</td><td colspan="13" class="tenue">No está vinculada con un usuario de Help Scout</td></tr>';
    var r = rep(a.id) || {}, viejo = a.esperando.length ? a.esperando[0].esperaDesde : null;
    return '<tr data-id="' + a.id + '">' +
      '<td><div class="nombre">' + esc(a.nombre) + '</div><span class="est tenue" data-ultima="' + esc(a.ultimaRespuesta || '') + '" data-esperando="' + a.esperando.length + '"><i></i><span>—</span></span></td>' +
      '<td class="num fuerte grupo-izq">' + a.esperando.length + '</td>' +
      '<td class="num">' + (viejo ? reloj(viejo, '', ' data-tono="1"') : '<span class="tenue">—</span>') + '</td>' +
      '<td class="num">' + a.seguimiento + '</td><td class="num">' + a.abiertos + '</td>' +
      '<td class="num grupo-izq">' + num(r.totalReplies) + '</td><td class="num">' + num(r.totalConversations) + '</td><td class="num">' + num(r.customersHelped) + '</td><td class="num">' + num(r.resolved) + '</td><td class="num">' + num(r.closed) + '</td>' +
      '<td class="num">' + corto(r.responseTime) + '</td><td class="num">' + corto(r.resolutionTime) + '</td>' +
      '<td class="num grupo-izq">' + (a.ultimaRespuesta ? 'hace <span class="reloj" data-desde="' + esc(a.ultimaRespuesta) + '" data-corto="1">' + corto((ahora() - Date.parse(a.ultimaRespuesta)) / 1000) + '</span>' : '<span class="tenue">sin respuestas hoy</span>') + '</td>' +
      '<td class="num"><button type="button" class="btn chico" data-detalle="' + a.id + '">Detalle</button></td></tr>';
  }
  function marcar() { todos('.t-agentes tbody tr[data-id]').forEach(function (tr) { tr.classList.toggle('sel', tr.getAttribute('data-id') === String(filtro)); }); }

  function pintarCola() {
    var p = E.panel, filas = [];
    p.agentes.forEach(function (a) { a.esperando.forEach(function (t) { filas.push(t); }); });
    p.sinAsignar.forEach(function (t) { filas.push(t); });
    var pest = [{ id: 'todos', t: 'Todos', n: filas.length }]
      .concat(p.agentes.filter(function (a) { return a.vinculado; }).map(function (a) { return { id: String(a.id), t: a.nombre, n: a.esperando.length }; }))
      .concat(E.cfg.mostrarSinAsignar ? [{ id: 'sin', t: 'Sin asignar', n: p.sinAsignar.length }] : []);
    if (!pest.some(function (x) { return x.id === String(filtro); })) filtro = 'todos';
    var visibles = filas.filter(function (t) {
      return filtro === 'todos' || (filtro === 'sin' ? !t.agenteId : String(t.agenteId) === String(filtro));
    }).sort(function (x, y) { return x.esperaDesde < y.esperaDesde ? -1 : x.esperaDesde > y.esperaDesde ? 1 : 0; });
    var h = '<div class="pestanas" role="tablist">' + pest.map(function (x) {
      var sel = String(filtro) === x.id;
      return '<button type="button" role="tab" aria-selected="' + sel + '" class="pest' + (sel ? ' sel' : '') + '" data-f="' + x.id + '">' + esc(x.t) + '<span>' + x.n + '</span></button>';
    }).join('') + '</div>';
    if (!visibles.length) h += '<div class="vacio">Ningún cliente está esperando respuesta.</div>';
    else {
      h += '<div class="desliza"><table class="t-cola"><thead><tr><th>Espera</th><th>Caso</th><th>Asunto</th><th>Cliente</th><th>Agente</th><th>Estado en Help Scout</th></tr></thead><tbody>' +
        visibles.map(function (t) {
          return '<tr><td>' + reloj(t.esperaDesde, 'espera', ' data-tono="1" data-barra="1"') + '<span class="barra"><i></i></span></td>' +
            '<td><a href="' + esc(t.url) + '" target="_blank" rel="noopener"><b>#' + esc(t.numero) + '</b></a></td>' +
            '<td class="asunto" title="' + esc(t.asunto) + '">' + esc(t.asunto) + '</td><td class="tenue">' + esc(t.cliente || '—') + '</td>' +
            '<td>' + (t.agenteId ? esc(t.agente) : '<span class="bad">Sin asignar</span>') + '</td>' +
            '<td class="tenue">' + (t.estado === 'pending' ? 'Pending' : 'Active') + (t.buzon ? ' · ' + esc(t.buzon) : '') + '</td></tr>';
        }).join('') + '</tbody></table></div>';
    }
    $('cola').innerHTML = h;
    todos('.pest').forEach(function (b) { b.addEventListener('click', function () { filtro = b.getAttribute('data-f'); marcar(); pintarCola(); }); });
    tic();
  }

  var TIPOS = { RESPUESTA: ['Respuesta', 'ok'], CLIENTE: ['Cliente', 'warn'], ASIGNADO: ['Asignado', ''], CERRADO: ['Cerrado', 'ok'] };
  function textoMovimiento(f) {
    var caso = '<a href="' + esc(f.url) + '" target="_blank" rel="noopener"><b>#' + esc(f.numero) + '</b></a>', ag = esc(f.agente || '');
    if (f.tipo === 'RESPUESTA') return ag + ' respondió ' + caso;
    if (f.tipo === 'CLIENTE') return 'El cliente escribió en ' + caso + (ag ? ' <span class="tenue">· ' + ag + '</span>' : ' <span class="bad">· sin asignar</span>');
    if (f.tipo === 'ASIGNADO') return caso + ' asignado a ' + ag;
    return ag + ' cerró ' + caso;
  }
  function registro(items) {
    if (!items.length) return '<div class="vacio">Todavía no hay movimientos hoy.</div>';
    return '<ol class="registro">' + items.map(function (f) {
      var t = TIPOS[f.tipo];
      return '<li><time>' + esc(hora(Date.parse(f.fecha), false)) + '</time><span class="tipo ' + t[1] + '">' + esc(t[0]) + '</span>' +
        '<span class="txt">' + textoMovimiento(f) + '<small>' + esc(f.asunto || '') + '</small></span></li>';
    }).join('') + '</ol>';
  }

  // ---------- Cada segundo ----------
  function conexion(clase, texto) { var el = $('conexion'); el.className = 'estado-con ' + clase; el.lastElementChild.textContent = texto; }
  function tic() {
    var t = ahora();
    $('reloj').textContent = hora(t, true);
    if (!E.cfg || !ultimaOk) { conexion(errorActual ? 'bad' : 'tenue', errorActual ? 'Sin conexión' : 'Conectando'); return; }
    var hace = Math.max(0, Math.floor((Date.now() - ultimaOk) / 1000));
    var atrasado = !E.cargandoBase && hace > Math.max(45, intervalo() * 6);
    $('actualizado').textContent = pausado ? 'En pausa · datos de hace ' + corto(hace) : 'Actualizado hace ' + corto(hace) + ' · cada ' + intervalo() + ' s';
    if (pausado) conexion('warn', 'En pausa');
    else if (errorActual || atrasado) conexion('bad', 'Sin conexión');
    else if (!E.enHorario) conexion('tenue', 'Fuera de horario');
    else conexion('ok', 'En vivo');
    $('avance').style.width = pausado ? '0' : Math.min(100, Math.max(0, 100 - (proxima - Date.now()) / (intervalo() * 1000) * 100)) + '%';

    var meta = E.cfg.metaRespuestaMin;
    todos('.reloj[data-desde]').forEach(function (el) {
      var seg = (t - Date.parse(el.getAttribute('data-desde'))) / 1000;
      el.textContent = el.getAttribute('data-corto') ? corto(seg) : dur(seg);
      if (el.getAttribute('data-tono')) {
        var c = tono(seg / 60);
        el.classList.remove('ok', 'warn', 'bad'); el.classList.add(c);
        if (el.getAttribute('data-barra')) {
          var b = el.parentNode.querySelector('.barra');
          b.className = 'barra ' + c;
          b.firstChild.style.width = Math.min(100, seg / 60 / meta * 100) + '%';
        }
      }
    });
    var alerta = E.cfg.alertaSinResponderMin;
    todos('.est[data-esperando]').forEach(function (el) {
      var esperando = Number(el.getAttribute('data-esperando')), ultima = el.getAttribute('data-ultima');
      var min = ultima ? (t - Date.parse(ultima)) / 60000 : Infinity, clase, texto;
      if (!esperando) { clase = 'ok'; texto = 'Al día'; }
      else if (!E.enHorario) { clase = 'tenue'; texto = 'Fuera de horario'; }
      else if (min < alerta[0]) { clase = 'ok'; texto = 'Respondiendo'; }
      else if (min < alerta[1]) { clase = 'warn'; texto = 'Sin responder ' + Math.floor(min) + ' min'; }
      else { clase = 'bad'; texto = ultima ? 'Sin responder ' + corto(min * 60) : 'Sin responder hoy'; }
      el.className = 'est ' + clase;
      el.lastElementChild.textContent = texto;
    });
  }

  // ---------- Detalle de una agente ----------
  function abrirDetalle(id) {
    var a = E.panel.agentes.filter(function (x) { return x.id === id; })[0];
    if (!a) return;
    var r = rep(id);
    var movs = [];
    Object.keys(E.convs).forEach(function (k) {
      var c = E.convs[k];
      c.mv.forEach(function (m) {
        if (m[0] !== 'C' && m[1] === id) movs.push({ fecha: m[2], tipo: { R: 'RESPUESTA', X: 'CERRADO', A: 'ASIGNADO' }[m[0]], numero: c.n, asunto: c.s, url: 'https://secure.helpscout.net/conversation/' + c.id + '/' + c.n });
      });
    });
    movs.sort(function (x, y) { return x.fecha < y.fecha ? 1 : -1; });
    $('tituloDetalle').textContent = a.nombre;
    $('subDetalle').textContent = 'Casos y movimientos de hoy, con enlace a Help Scout para comprobarlos.';
    var caja = function (v, l) { return '<div><b>' + v + '</b><span>' + l + '</span></div>'; };
    var h = '<div class="resumen-dlg">' + caja(a.esperando.length, 'Esperando') + caja(a.seguimiento, 'En seguimiento') + caja(a.activos, 'Active') + caja(a.pendientes, 'Pending') +
      caja(a.respuestasVistas, 'Respuestas vistas hoy') + caja(r ? num(r.totalReplies) : '—', 'Respuestas según Reports') + '</div>' +
      '<p class="fuente">"Respuestas vistas" es el conteo directo de mensajes enviados hoy en los casos leídos; "según Reports" es la cifra oficial de Help Scout, que puede tardar unos minutos en actualizarse.</p>';
    var filaCaso = function (x) {
      return '<tr><td><a href="' + esc(x.url) + '" target="_blank" rel="noopener"><b>#' + esc(x.numero) + '</b></a></td><td class="asunto">' + esc(x.asunto) + '</td><td class="tenue">' + esc(x.cliente) +
        '</td><td class="tenue">' + (x.estado === 'pending' ? 'Pending' : 'Active') + '</td><td>' + (x.esperaDesde ? esc(hora(Date.parse(x.esperaDesde), true)) + ' · ' + corto((ahora() - Date.parse(x.esperaDesde)) / 1000) : '<span class="tenue">respondido, espera al cliente</span>') + '</td></tr>';
    };
    var abiertos = a.esperando.concat(a.enSeguimiento);
    h += '<div class="previa"><h4>Casos abiertos (' + abiertos.length + ')</h4><div class="caja"><div class="desliza"><table><thead><tr><th>Caso</th><th>Asunto</th><th>Cliente</th><th>Estado</th><th>Cliente espera desde</th></tr></thead><tbody>' +
      (abiertos.map(filaCaso).join('') || '<tr><td colspan="5" class="vacio">Sin casos abiertos.</td></tr>') + '</tbody></table></div></div></div>';
    h += '<div class="previa"><h4>Movimientos de hoy (' + movs.length + ')</h4><div class="caja"><div class="desliza"><table><thead><tr><th>Hora</th><th>Movimiento</th><th>Caso</th><th>Asunto</th></tr></thead><tbody>' +
      (movs.map(function (m) {
        var t = TIPOS[m.tipo];
        return '<tr><td>' + esc(hora(Date.parse(m.fecha), true)) + '</td><td class="' + t[1] + '">' + esc(t[0]) + '</td><td><a href="' + esc(m.url) + '" target="_blank" rel="noopener"><b>#' + esc(m.numero) + '</b></a></td><td class="asunto">' + esc(m.asunto) + '</td></tr>';
      }).join('') || '<tr><td colspan="4" class="vacio">Sin movimientos hoy.</td></tr>') + '</tbody></table></div></div></div>';
    $('cuerpoDetalle').innerHTML = h;
    $('dlgDetalle').showModal();
  }

  // ---------- Exportar ----------
  function sumarDias(d, n) { var f = new Date(d + 'T12:00:00Z'); f.setUTCDate(f.getUTCDate() + n); return f.toISOString().slice(0, 10); }
  function rango(tipo) {
    var hoy = diaLocal(ahora()), f = new Date(hoy + 'T12:00:00Z'), lunes = sumarDias(hoy, -((f.getUTCDay() + 6) % 7)), mes1 = hoy.slice(0, 8) + '01';
    if (tipo === 'hoy') return [hoy, hoy];
    if (tipo === 'ayer') return [sumarDias(hoy, -1), sumarDias(hoy, -1)];
    if (tipo === 'semana') return [lunes, hoy];
    if (tipo === 'semanaPasada') return [sumarDias(lunes, -7), sumarDias(lunes, -1)];
    if (tipo === 'mes') return [mes1, hoy];
    if (tipo === 'mesPasado') { var fin = sumarDias(mes1, -1); return [fin.slice(0, 8) + '01', fin]; }
    if (tipo === '90') return [sumarDias(hoy, -89), hoy];
    return null;
  }
  function aplicarPeriodo() { var r = rango($('expPeriodo').value); if (r) { $('expDesde').value = r[0]; $('expHasta').value = r[1]; } }
  function abrirExportar() {
    if (!E.cfg) return;
    if (!$('expAgentes').children.length) {
      $('expAgentes').innerHTML = E.agentes.filter(function (a) { return a.id; }).map(function (a) {
        return '<label><input type="checkbox" value="' + a.id + '" checked> ' + esc(a.nombre) + '</label>';
      }).join('');
      $('expOficina').checked = !!E.cfg.horarioDeOficina;
      aplicarPeriodo();
    }
    $('expPrevia').innerHTML = ''; $('expEstado').textContent = ''; exportacion = null;
    $('dlgExportar').showModal();
  }
  function botones(activos) { ['expVer', 'expExcel', 'expCsv'].forEach(function (id) { $(id).disabled = !activos; }); }
  function pedirExportacion(conCasos, despues) {
    var f = {
      desde: $('expDesde').value, hasta: $('expHasta').value, oficina: $('expOficina').checked,
      agentes: todos('#expAgentes input:checked').map(function (i) { return Number(i.value); }),
      series: $('expSeries').checked, casos: conCasos && $('expCasos').checked,
    };
    if (!f.desde || !f.hasta || f.desde > f.hasta) { $('expEstado').textContent = 'Revisa las fechas.'; return; }
    if (!f.agentes.length) { $('expEstado').textContent = 'Elige al menos una agente.'; return; }
    var qs = '?desde=' + f.desde + '&hasta=' + f.hasta + '&agentes=' + f.agentes.join(',') + '&oficina=' + (f.oficina ? 1 : 0);
    var x = { filtros: f, resumen: null, series: null, casos: null, generado: Date.now() };
    botones(false);
    $('expEstado').textContent = 'Consultando los reportes de Help Scout.';
    api('/api/reporte' + qs).then(function (r) {
      if (!r.disponible) throw new Error(r.motivo);
      x.resumen = r;
      if (!f.series) return null;
      $('expEstado').textContent = 'Leyendo la evolución por periodo.';
      return api('/api/reporte-dias' + qs).then(function (s) { x.series = s; });
    }).then(function () {
      if (!f.casos) return null;
      x.casos = [];
      return f.agentes.reduce(function (cadena, id) {
        return cadena.then(function () {
          var leer = function (pagina) {
            return api('/api/reporte-casos' + qs + '&agente=' + id + '&pagina=' + pagina).then(function (c) {
              c.filas.forEach(function (fila) { fila.agente = c.nombre; x.casos.push(fila); });
              $('expEstado').textContent = 'Leyendo conversaciones de ' + c.nombre + ' (' + x.casos.length + ').';
              return c.siguiente ? leer(c.siguiente) : null;
            });
          };
          return leer(1);
        });
      }, Promise.resolve());
    }).then(function () {
      exportacion = x;
      $('expEstado').textContent = 'Listo.';
      pintarPrevia();
      if (despues) despues();
    }).catch(function (e) {
      $('expEstado').textContent = '';
      $('expPrevia').innerHTML = '<div class="aviso error">' + esc(e.message) + '</div>';
    }).then(function () { botones(true); });
  }
  var fraccion = function (v) { return v == null ? null : (v > 1 ? v / 100 : v); };
  var pct = function (v) { v = fraccion(v); return v == null ? '—' : Math.round(v * 100) + '%'; };
  function total(filas, campo) { return filas.reduce(function (s, f) { return s + (f[campo] || 0); }, 0); }
  function pintarPrevia() {
    var r = exportacion.resumen;
    var fila = function (f) {
      return '<tr><td class="nombre">' + esc(f.nombre) + '</td><td class="num">' + num(f.totalConversations) + '</td><td class="num">' + num(f.customersHelped) + '</td><td class="num">' + num(f.totalReplies) +
        '</td><td class="num">' + num(f.repliesPerDay) + '</td><td class="num">' + num(f.resolved) + '</td><td class="num">' + pct(f.percentResolvedOnFirstReply) + '</td><td class="num">' + num(f.closed) +
        '</td><td class="num">' + corto(f.responseTime) + '</td><td class="num">' + corto(f.resolutionTime) + '</td><td class="num">' + corto(f.handleTime) + '</td><td class="num">' + num(f.happinessScore) + '</td></tr>';
    };
    $('expPrevia').innerHTML = '<div class="previa"><h4>Resumen por agente · ' + esc(r.rango.desde) + ' a ' + esc(r.rango.hasta) + '</h4><div class="caja"><div class="desliza"><table><thead><tr>' +
      '<th>Agente</th><th class="num">Conversaciones</th><th class="num">Clientes</th><th class="num">Respuestas</th><th class="num">Resp. por día</th><th class="num">Resueltos</th><th class="num">% en 1ª resp.</th><th class="num">Cerrados</th>' +
      '<th class="num">T. respuesta</th><th class="num">T. resolución</th><th class="num">T. gestión</th><th class="num">Felicidad</th></tr></thead><tbody>' + r.filas.map(fila).join('') + '</tbody><tfoot><tr><td>Suma</td>' +
      '<td class="num">' + num(total(r.filas, 'totalConversations')) + '</td><td class="num">' + num(total(r.filas, 'customersHelped')) + '</td><td class="num">' + num(total(r.filas, 'totalReplies')) + '</td><td></td><td class="num">' + num(total(r.filas, 'resolved')) +
      '</td><td></td><td class="num">' + num(total(r.filas, 'closed')) + '</td><td colspan="4"></td></tr></tfoot></table></div></div>' +
      '<p class="fuente" style="margin-top:10px">Fuente: Reports de Help Scout, del ' + esc(r.rango.desde) + ' 00:00 al ' + esc(r.rango.hasta) + ' 23:59 (' + esc(tz()) + '). Una conversación atendida por dos agentes cuenta para cada una, por eso la suma puede ser mayor que el total del equipo.</p></div>';
  }

  var DIAS_SEMANA = ['', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo'];
  function hojas() {
    var x = exportacion, r = x.resumen, v = function (n) { return n == null ? '' : n; };
    var min = function (s) { return s == null ? '' : Math.round(s / 6) / 10; }, hrs = function (s) { return s == null ? '' : Math.round(s / 360) / 10; };
    var resumen = [['Agente', 'Días del periodo', 'Conversaciones', 'Conversaciones creadas', 'Clientes ayudados', 'Respuestas enviadas', 'Respuestas por día', 'Conversaciones por día',
      'Resueltos', 'Resueltos en la 1ª respuesta', '% resueltos en la 1ª respuesta', 'Respuestas para resolver', 'Cerrados', 'T. respuesta (min)', 'T. resolución (h)', 'T. gestión (min)',
      'Felicidad', 'Día más ocupado', 'T. respuesta (s)', 'T. resolución (s)', 'T. gestión (s)']]
      .concat(r.filas.map(function (f) {
        return [f.nombre, v(f.totalDays), v(f.totalConversations), v(f.conversationsCreated), v(f.customersHelped), v(f.totalReplies), v(f.repliesPerDay), v(f.conversationsPerDay), v(f.resolved),
          v(f.resolvedOnFirstReply), v(fraccion(f.percentResolvedOnFirstReply)), v(f.repliesToResolve), v(f.closed), min(f.responseTime), hrs(f.resolutionTime), min(f.handleTime), v(f.happinessScore),
          DIAS_SEMANA[f.busiestDay] || '', v(f.responseTime), v(f.resolutionTime), v(f.handleTime)];
      }));
    var etiqueta = { day: 'Día', week: 'Semana (inicio)', month: 'Mes (inicio)' }[(x.series && x.series.vista) || 'day'];
    var series = [[etiqueta, 'Agente', 'Respuestas enviadas', 'Resueltos', 'Clientes ayudados']]
      .concat(((x.series && x.series.filas) || []).map(function (f) { return [f.fecha, f.nombre, f.respuestas, f.resueltos, f.clientes]; }));
    var casos = [['Agente', '# Caso', 'Cliente', 'Estado', 'Respuestas enviadas', '1ª respuesta (min)', 'T. respuesta (min)', 'T. resolución (h)', 'T. gestión (min)', 'Enlace']]
      .concat((x.casos || []).map(function (c) { return [c.agente, c.numero, c.cliente, c.estado, v(c.respuestas), min(c.primeraRespuesta), min(c.respuesta), hrs(c.resolucion), min(c.gestion), c.url]; }));
    var nombres = E.agentes.filter(function (a) { return x.filtros.agentes.indexOf(a.id) >= 0; }).map(function (a) { return a.nombre; });
    var notas = [['Métricas de soporte — Help Scout'], [],
      ['Periodo', r.rango.desde + ' 00:00 a ' + r.rango.hasta + ' 23:59 (' + tz() + ')'], ['Agentes', nombres.join(', ')],
      ['Tiempos en horario de oficina', x.filtros.oficina ? 'Sí (si está activado en Help Scout)' : 'No: tiempo corrido'],
      ['Generado', new Date(x.generado).toLocaleString('es', { timeZone: tz() }) + ' (' + tz() + ')'], [],
      ['Fuente', 'Todas las cifras son las de los reportes oficiales de Help Scout (sección Reports → Team → usuario), sin recálculo.'],
      ['Conversaciones', 'Conversaciones en las que el agente participó en el periodo (totalConversations).'],
      ['Clientes ayudados', 'Clientes distintos a los que el agente respondió (customersHelped).'],
      ['Respuestas enviadas', 'Mensajes enviados a clientes (totalReplies). No cuentan las notas internas.'],
      ['Resueltos', 'Conversaciones resueltas por el agente (resolved). Help Scout cuenta una conversación como resuelta cuando se cierra y no se reabre.'],
      ['Cerrados', 'Veces que el agente cerró una conversación (closed).'],
      ['T. respuesta', 'Tiempo promedio de respuesta (responseTime). Help Scout lo entrega en segundos; aquí se muestra en minutos y también en segundos.'],
      ['T. resolución', 'Tiempo promedio hasta resolver (resolutionTime), en horas y en segundos.'],
      ['T. gestión', 'Tiempo promedio de gestión de cada respuesta (handleTime). Help Scout no documenta la unidad; se asume segundos.'],
      ['Felicidad', 'Happiness score de Help Scout: % de calificaciones "Great" menos % de "Not Good".'],
      ['Sumas', 'Una conversación atendida por dos agentes cuenta para cada una: la suma de agentes puede superar el total del equipo.'],
      ['Evolución', 'Help Scout entrega la serie por día hasta 60 días, por semana hasta 1 año y por mes para rangos mayores.']];
    return { resumen: resumen, series: series, casos: casos, notas: notas };
  }
  function nombreArchivo(ext, sufijo) { var f = exportacion.filtros; return 'metricas-soporte_' + f.desde + '_a_' + f.hasta + (sufijo ? '_' + sufijo : '') + '.' + ext; }
  function bajar(blob, nombre) {
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = nombre; document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
  }
  function cargarXlsx(listo) {
    if (window.XLSX) return listo(true);
    var s = document.createElement('script');
    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
    s.onload = function () { listo(!!window.XLSX); };
    s.onerror = function () { listo(false); };
    document.head.appendChild(s);
  }
  function descargarExcel() {
    cargarXlsx(function (ok) {
      if (!ok) { $('expEstado').textContent = 'No se pudo cargar el generador de Excel. Usa la descarga en CSV.'; return; }
      var h = hojas(), libro = XLSX.utils.book_new();
      var agregar = function (nombre, filas, anchos, columnasPct) {
        var hoja = XLSX.utils.aoa_to_sheet(filas);
        hoja['!cols'] = filas[0].map(function (t, i) { return { wch: (anchos && anchos[i]) || Math.max(12, Math.min(32, String(t).length + 2)) }; });
        (columnasPct || []).forEach(function (col) {
          for (var f = 1; f < filas.length; f++) { var celda = hoja[XLSX.utils.encode_cell({ r: f, c: col })]; if (celda && typeof celda.v === 'number') celda.z = '0%'; }
        });
        if (filas.length > 1) hoja['!autofilter'] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: filas.length - 1, c: filas[0].length - 1 } }) };
        XLSX.utils.book_append_sheet(libro, hoja, nombre);
      };
      agregar('Resumen por agente', h.resumen, { 0: 24 }, [10]);
      if (exportacion.series) agregar('Evolución', h.series, { 0: 16, 1: 24 });
      if (exportacion.casos) agregar('Conversaciones', h.casos, { 0: 24, 2: 28, 9: 58 });
      var notas = XLSX.utils.aoa_to_sheet(h.notas);
      notas['!cols'] = [{ wch: 32 }, { wch: 120 }];
      XLSX.utils.book_append_sheet(libro, notas, 'Notas');
      bajar(new Blob([XLSX.write(libro, { bookType: 'xlsx', type: 'array' })], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), nombreArchivo('xlsx'));
      $('expEstado').textContent = 'Excel descargado.';
    });
  }
  function descargarCsv() {
    var cual = $('expCsvHoja').value;
    if ((cual === 'series' && !exportacion.series) || (cual === 'casos' && !exportacion.casos)) { $('expEstado').textContent = 'Marca esa opción en "Contenido del archivo" para incluirla.'; return; }
    var texto = hojas()[cual].map(function (f) {
      return f.map(function (c) { var s = String(c == null ? '' : c); return /[",\n;]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }).join(',');
    }).join('\r\n');
    bajar(new Blob(['﻿' + texto], { type: 'text/csv;charset=utf-8' }), nombreArchivo('csv', cual));
    $('expEstado').textContent = 'CSV descargado.';
  }

  // ---------- Controles ----------
  $('btnPausa').addEventListener('click', function () {
    pausado = !pausado;
    this.setAttribute('aria-pressed', pausado ? 'true' : 'false');
    this.textContent = pausado ? 'Reanudar' : 'Pausar';
    if (pausado) clearTimeout(temporizador); else ciclo();
    tic();
  });
  $('btnExportar').addEventListener('click', abrirExportar);
  $('expPeriodo').addEventListener('change', aplicarPeriodo);
  ['expDesde', 'expHasta'].forEach(function (id) { $(id).addEventListener('change', function () { $('expPeriodo').value = 'personal'; }); });
  $('expVer').addEventListener('click', function () { pedirExportacion(false); });
  $('expExcel').addEventListener('click', function () { pedirExportacion(true, descargarExcel); });
  $('expCsv').addEventListener('click', function () { pedirExportacion(true, descargarCsv); });
  todos('[data-cerrar]').forEach(function (b) { b.addEventListener('click', function () { b.closest('dialog').close(); }); });
  todos('dialog').forEach(function (d) { d.addEventListener('click', function (ev) { if (ev.target === d) d.close(); }); });
  document.addEventListener('visibilitychange', function () {
    if (!document.hidden && !pausado && E.cfg && Date.now() - ultimaOk > intervalo() * 1000) ciclo();
  });

  setInterval(tic, 1000);
  if (DEMO) {
    var s = document.createElement('script');
    s.src = 'demo.js';
    s.onload = arrancar;
    document.head.appendChild(s);
  } else {
    arrancar();
  }
})();

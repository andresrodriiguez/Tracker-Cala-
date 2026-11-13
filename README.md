# Soporte · Panel en vivo sobre Help Scout

## Panel en vivo

Una página web que muestra **en tiempo real** cómo va el equipo en Help Scout. Vive dentro del Apps Script de esta hoja
(usa las credenciales de Help Scout que ya están guardadas aquí), pero **es independiente del tracker**: no lee ni escribe
ninguna pestaña y no usa sus reglas de conteo. Se abre con un enlace fijo o desde el menú **Help Scout → Panel en vivo**.

### De dónde sale cada cifra

| Bloque | Fuente | Regla |
|---|---|---|
| **Esperando / Mayor espera** | Historial de mensajes de cada caso abierto | El caso está *Active* o *Pending* y el último mensaje es del cliente. El reloj cuenta desde el **primer** mensaje sin contestar. Notas internas, asignaciones y cambios de estado **no** cuentan como respuesta. |
| **Seguimiento** | Igual | Caso abierto donde lo último fue una respuesta de Help Scout (se espera al cliente). |
| **Abiertos** | Listado de Help Scout | *Active + Pending* asignados a la agente. *Esperando + Seguimiento = Abiertos.* |
| **Respuestas, Conversaciones, Clientes, Resueltos, Cerrados, T. respuesta, T. resolución (hoy)** | **Reportes oficiales de Help Scout** (`/v2/reports/user`) | Son los mismos números de *Reports* en Help Scout, del día de hoy (00:00 a 23:59, hora de Miami), **sin recálculo**. Se refrescan cada minuto. |
| **Últ. respuesta / estado de la agente** | Historial de mensajes | Hora del último mensaje que envió hoy. Con clientes esperando: verde si respondió hace menos de 10 min, amarillo hasta 30, rojo después. |
| **Registro de actividad** | Historial de mensajes | Mensajes de clientes, respuestas, asignaciones y cierres de hoy. |

> Los reportes de Help Scout solo están disponibles por API en los planes **Plus y Pro**. Si el plan no los incluye, el panel lo
> avisa arriba, deja vacías las columnas "Hoy" y sigue mostrando todo lo que pasa en este momento.

**Cómo se actualiza**: cada **5 segundos** (60 fuera de la jornada) pide a Help Scout los casos que cambiaron. Cada 5 minutos relee
todo y **comprueba que lo leído coincide con los totales que informa Help Scout** (casos *Active* y *Pending* por agente); si no
cuadra, aparece un aviso en rojo. El pie de página muestra la hora de la última verificación. Los relojes corren cada segundo.

### Cómo comprobar una cifra
- **Abiertos**: en Help Scout, la carpeta *Mine* de la agente (Active + Pending) debe dar el mismo número.
- **Esperando**: botón **Detalle** de la agente → lista de casos con enlace; al abrirlos, el último mensaje debe ser del cliente.
- **Columnas "Hoy"**: Help Scout → *Reports → Team* → la agente → rango *Today*.

### Exportar métricas
Botón **Exportar métricas**. Filtros: **periodo** (hoy, ayer, esta semana, semana pasada, este mes, mes pasado, últimos 90 días o fechas a mano)
y **agentes**. Opciones: evolución por día/semana/mes, lista de conversaciones y tiempos solo en horario de oficina. Vista previa y descarga en **Excel** o **CSV**.

| Hoja | Contenido (todo de los reportes oficiales de Help Scout) |
|---|---|
| **Resumen por agente** | Conversaciones, conversaciones creadas, clientes ayudados, respuestas enviadas, respuestas y conversaciones por día, resueltos, resueltos en la 1ª respuesta (y %), respuestas para resolver, cerrados, tiempo de respuesta, de resolución y de gestión, felicidad y día más ocupado. |
| **Evolución** | Respuestas, resueltos y clientes ayudados de cada agente por día (hasta 60 días), semana (hasta 1 año) o mes. |
| **Conversaciones** | Cada conversación del periodo con sus respuestas, 1ª respuesta, tiempo de respuesta, resolución y enlace. |
| **Notas** | Filtros usados y definición de cada métrica. |

### Publicarlo (una vez, ~5 min)
1. En la hoja: **Extensiones → Apps Script**. Reemplaza el contenido de `Código.gs` por [`dist/Codigo.gs`](dist/Codigo.gs) y el de `appsscript.json` por [`apps-script/appsscript.json`](apps-script/appsscript.json). Guarda.
2. **Implementar → Nueva implementación** → ⚙️ **Aplicación web** → *Ejecutar como*: **Yo** · *Quién tiene acceso*: **Solo yo** → **Implementar**. Autoriza si lo pide.
3. Copia la **URL de la aplicación web** y guárdala en favoritos. También está en **Help Scout → Panel en vivo**, donde además se puede abrir dentro de la hoja.

Si las credenciales de Help Scout no estaban guardadas: **Help Scout → 1. Configurar credenciales**.
Si ya no usas el tracker: **Help Scout → Desactivar sincronización automática** (el panel no la necesita).

> Cuando actualices el código, el panel no cambia hasta que hagas **Implementar → Gestionar implementaciones → ✏️ → Versión: Nueva versión → Implementar** (la URL se mantiene).

**Ajustes**: al inicio de `PanelServidor.gs` (`PANEL`): segundos entre consultas, meta de respuesta, alertas, horario de oficina y cola sin asignar. Los agentes y la jornada son los de `CONFIG`.

**Límites**: con la página abierta son ~720 consultas por hora a Help Scout y a Google (UrlFetch: 20.000 al día en cuentas gratuitas, 100.000 en Google Workspace).
Si la dejas abierta las 24 h en una cuenta gratuita, sube `SEGUNDOS_ACTUALIZACION` a 10. Si `MAILBOXES_EQUIPO` está vacío, la cola "sin asignar" incluye todos los buzones que ve la app.

## Desarrollo

- `panel/`: la página (`index.html`, `estilos.css`, `app.js`) y la lógica pura compartida (`logica.js`). Abre `panel/index.html` en el navegador para verla con datos de ejemplo.
- `apps-script/PanelServidor.gs`: el servidor del panel. Los demás `.gs` son el tracker.
- `apps-script/Logica.gs`, `apps-script/Panel.html` y `dist/Codigo.gs` se **generan**: no se editan a mano.

```bash
npm test        # pruebas (lógica, servidor con Help Scout simulado y tracker)
npm run build   # regenera dist/Codigo.gs
```

---

# Tracker en la hoja (anterior)

> Lo que sigue describe el tracker que llena las hojas mensuales desde Help Scout. **El panel en vivo no depende de él** y se puede dejar desactivado.

Automatiza el **Tracker Gestión Diaria Equipo SOP** (Google Sheets) con los datos de **Help Scout**:
cuando asignas un caso a un agente en Help Scout, su fila del día en el tracker se actualiza sola, y se
agrega un **resumen mensual** con el rendimiento de cada agente, incluidos los tiempos de respuesta y
de resolución.

Es un **Google Apps Script** que vive dentro de la misma hoja: no necesita servidores ni costos extra.

```
Help Scout (API v2) ──cada 15 min──►  Apps Script  ──►  Hoja del mes (SEPTIEMBRE 2026, OCTUBRE 2026…)
                                         │          ──►  RESUMEN MENSUAL
                                         └────────────►  HS_Eventos (detalle por ticket, con enlace)
```

## Qué llena automáticamente

| Columna del tracker | Cómo se calcula desde Help Scout |
|---|---|
| **Tickets sin atender al iniciar la jornada** (C) | "Foto" diaria al inicio de la jornada (9:00 am, hora de Miami): casos en estado *Active* que entraron a la carga del agente **desde `FECHA_INICIO`** (asignados o con nueva consulta; el arrastre anterior no se cuenta), más los casos en *Pending* cuyo último mensaje es del cliente (pasados a Pending sin responder). Los Pending donde la agente ya respondió y espera al cliente no cuentan. |
| **Tickets asignados en el día** (D) | Casos que quedaron asignados al agente ese día, ya sea que los asigne el líder o que el agente los tome. |
| **Nueva consulta en ticket ya asignado** (E) | El cliente volvió a escribir en un caso que el agente tenía desde un día anterior y que ya había respondido, dejado en *Pending* o cerrado. Cuenta máximo 1 por caso por día. |
| **Ticket re-asignados a otro dep. CCH / COACH** (F) | El caso pasó del agente a un usuario o equipo de Help Scout que **no** es del equipo SOP, o se movió a un buzón de otro departamento, o tiene una etiqueta configurada. Pasarlo a otro compañero del equipo también cuenta, porque así no le queda pendiente (se puede desactivar). |
| **Total Tickets Gestionados (Auto)** (G) | **No se toca**: sigue siendo tu fórmula. |
| **Tickets Cerrados** (H) | Casos que pasaron a *Closed* estando a cargo del agente. Si cierra un caso que estaba sin asignar, o uno de antes de `FECHA_INICIO`, cuenta como asignado y cerrado para ella ese día. |
| **Tickets Pendientes/Seguimiento** (I) | `C + D + E − F − H` (mínimo 0). |

Cada caso cuenta **una sola vez por día** en cada columna. Si una agente cierra un caso de un día anterior que no estaba en la foto de las 9:00 (por ejemplo, estaba en *Pending* esperando al cliente), ese caso se suma a la columna C, para que todo lo cerrado esté dentro del Total y el % no pase de 100%. Los **cierres automáticos** de Help Scout (reglas que cierran solos los casos) no cuentan.
| **% / Semáforo** y **Observaciones** | **No se tocan.** |

Reglas importantes:
- **Cada movimiento cuenta para su día de jornada** (9:00–17:00, lunes a sábado, hora de Miami). Lo que pasa **después de las 5:00 pm o en domingo cuenta para el siguiente día laboral**; por ejemplo, un caso asignado el martes a las 10 pm es "asignado" del miércoles. Lo que pasa **antes de las 9:00 am** cuenta para ese mismo día. En la hoja HS_Eventos se ve la hora real de cada movimiento.
- Un caso asignado de noche o de madrugada cuenta **solo como "asignado"** de ese día, no también como "sin atender al iniciar la jornada".
- Los días **anteriores a `FECHA_INICIO`** (por defecto `2026-10-01`) nunca se modifican, así que lo que ya llenaste a mano queda intacto.
- Solo se crean filas cuando el agente tiene actividad ese día, así que no aparecen filas en rojo por días libres.
- Si no existe la hoja del mes (por ejemplo `NOVIEMBRE 2026`), se crea copiando la del mes anterior: mismas fórmulas y formato, sin datos.

## Hojas nuevas que crea

- **RESUMEN MENSUAL**: por mes y por agente, con una fila de total del EQUIPO. Muestra días trabajados, asignados, nuevas consultas, re-asignados, total, cerrados, **% de resolución**, días en verde, amarillo y rojo, **tiempo promedio de 1ª respuesta**, **tiempo promedio y mediano de resolución**, y **% de casos resueltos dentro de la meta** (por defecto 8 h laborales). Los tiempos se cuentan **solo en horario laboral** (9:00–17:00, lunes a sábado). Las cantidades salen de las hojas mensuales, así que incluye febrero a septiembre aunque se hayan llenado a mano. Los tiempos existen desde que se activa la automatización.
- **HS_Eventos**: cada asignación, re-asignación, nueva consulta, primera respuesta y cierre, con agente, número de caso, minutos y **enlace directo al caso en Help Scout**. Sirve para auditar y para hacer tablas dinámicas.
- **HS_InicioJornada**: la foto diaria de casos sin atender por agente, con la hora, la **lista de números de caso que contó** y, aparte, **cuáles estaban en Pending sin responder** (para revisarlos en Help Scout).
- **HS_Usuarios**: usuarios y buzones de Help Scout con sus IDs, para revisar la configuración.

## Instalación (una sola vez, ~15 min)

### 1. Convertir el archivo a Google Sheets
El tracker hoy es un archivo **.xlsx** abierto en Drive, y Apps Script no funciona con archivos de Excel.
Ábrelo y usa **Archivo → Guardar como Hoja de cálculo de Google**. A partir de ahí el equipo debe usar el archivo nuevo.

### 2. Crear las credenciales en Help Scout
1. En Help Scout: **tu foto (arriba a la derecha) → Your Profile → My Apps → Create My App**.
2. Nombre: `Tracker SOP`. Redirection URL: cualquiera, por ejemplo `https://www.google.com`.
3. Copia el **App ID** y el **App Secret**.

> La app ve lo mismo que el usuario que la crea. Créala con un usuario administrador o que tenga acceso a todos los buzones del equipo.

### 3. Pegar el código en la hoja
1. En la hoja: **Extensiones → Apps Script**.
2. Abre [`dist/Codigo.gs`](dist/Codigo.gs) (todo el código en un solo archivo), cópialo completo y **reemplaza** el contenido de `Código.gs` en el editor.
3. En **Configuración del proyecto (⚙️)** activa *"Mostrar el archivo de manifiesto appsscript.json"*, vuelve al editor y reemplaza el contenido de `appsscript.json` por el de [`apps-script/appsscript.json`](apps-script/appsscript.json).
4. Guarda (💾).

> Alternativa para desarrolladores: con [clasp](https://github.com/google/clasp), crea `.clasp.json` con `"rootDir": "apps-script"` y el `scriptId` de la hoja, y luego ejecuta `clasp push`.

> La zona horaria de la hoja debe ser la del equipo (**Archivo → Configuración**). Ya está en
> **America/New_York (Miami)**: con ella se decide a qué día pertenece cada ticket y a qué hora se toma la foto de inicio de jornada.

### 4. Configurar (sección `CONFIG` al inicio del código)
- **AGENTES**: nombre como aparece en la columna "Nombre del Agente" y su **email de Help Scout** (ya configurados para Jaideth, Maryelin, Edna y Andrés).
- **FECHA_INICIO**: desde qué día llena la automatización.
- **HORARIO_LABORAL**: jornada del equipo (9:00–17:00, lunes a sábado). Marca la hora de la foto de "sin atender" y el horario en que corren los tiempos.
- **META_RESOLUCION_HORAS**: meta de resolución en horas laborales (por defecto 8 = una jornada).
- **Re-asignaciones a CCH / COACH**: ver la sección [¿Cómo pasan los casos a CCH / COACH?](#cómo-pasan-los-casos-a-cch--coach).

### 5. Activar
Recarga la hoja. Aparece el menú **Help Scout**:
1. **Configurar credenciales**: pega el App ID y el App Secret.
2. **Ver usuarios y buzones de Help Scout**: confirma que cada agente quedó vinculado (✅).
3. **Activar sincronización automática**: queda corriendo cada 15 minutos, aunque nadie tenga la hoja abierta.

Google pedirá autorizar el script la primera vez. Es normal: se conecta a Help Scout y edita esta hoja.

## ¿Cómo pasan los casos a CCH / COACH?

Según cómo lo hagan en Help Scout, ajusta `Config.gs`:

| Si los pasan… | Configura |
|---|---|
| Asignándolos a un usuario o **Team** de CCH/COACH (**así lo hace hoy el equipo SOP**) | Nada: ya funciona, porque ese usuario no está en `AGENTES`. |
| **Moviéndolos a otro buzón** | Pon en `MAILBOXES_EQUIPO` los IDs de los buzones del equipo SOP (están en la hoja `HS_Usuarios`). |
| Poniéndoles una **etiqueta** | Pon las etiquetas en `TAGS_REASIGNACION` (ej. `['cch', 'coach']`). |

## Preguntas frecuentes

- **¿Es instantáneo?** Se actualiza cada 15 minutos (`MINUTOS_ENTRE_SINCRONIZACIONES`, mínimo 1). "Help Scout → Sincronizar ahora" fuerza una actualización.
- **¿Los agentes siguen llenando algo a mano?** No hace falta. Si alguien edita una columna automática del día, la siguiente sincronización la sobrescribe. Si quieres que una columna siga siendo manual, quítala de `COLUMNAS_AUTOMATICAS`. "Observaciones" siempre es manual.
- **¿Los tiempos son en horario laboral?** Sí. Solo cuentan los minutos dentro de `HORARIO_LABORAL` (9:00–17:00, lunes a sábado, hora de Miami). Un caso que llega el jueves a las 4:50 pm y se resuelve el viernes a las 9:10 am suma **20 minutos**, no 16 horas. El trabajo fuera de horario cuenta como 0.
- **¿Qué pasa si cambia la fórmula de "Total"?** El script no la escribe. Los "Pendientes" usan `C + D + E − F − H`; si tu fórmula de Total no incluye la columna C, avísame para alinearlo.
- **Recalcular**: "Recalcular todo desde FECHA_INICIO" borra HS_Eventos, vuelve a leer Help Scout desde `FECHA_INICIO` y rehace la foto de hoy. Úsalo después de actualizar el código.

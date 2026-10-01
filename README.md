# Tracker Gestión Diaria SOP ⇄ Help Scout

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

## Desarrollo

El código fuente está separado por archivos en [`apps-script/`](apps-script). `dist/Codigo.gs` se genera a partir de ellos,
así que después de cualquier cambio hay que regenerarlo. La lógica que interpreta el historial de Help Scout
(`Eventos.gs`, `Metricas.gs`, `Util.gs`) es JavaScript puro y tiene pruebas:

```bash
npm test        # pruebas
npm run build   # regenera dist/Codigo.gs
```

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
| **Tickets sin atender al iniciar la jornada** (C) | "Foto" diaria a la `HORA_INICIO_JORNADA`: casos en estado *Active* asignados al agente. |
| **Tickets asignados en el día** (D) | Casos que quedaron asignados al agente ese día, ya sea que los asigne el líder o que el agente los tome. |
| **Nueva consulta en ticket ya asignado** (E) | El cliente volvió a escribir en un caso que el agente tenía desde un día anterior y que ya había respondido, dejado en *Pending* o cerrado. Cuenta máximo 1 por caso por día. |
| **Ticket re-asignados a otro dep. CCH / COACH** (F) | El caso pasó del agente a un usuario o equipo de Help Scout que **no** es del equipo SOP, o se movió a un buzón de otro departamento, o tiene la etiqueta `cch`/`coach`. Pasarlo a otro compañero del equipo también cuenta, porque así no le queda pendiente (se puede desactivar). |
| **Total Tickets Gestionados (Auto)** (G) | **No se toca**: sigue siendo tu fórmula. |
| **Tickets Cerrados** (H) | Casos que pasaron a *Closed* estando a cargo del agente. |
| **Tickets Pendientes/Seguimiento** (I) | `C + D + E − F − H` (mínimo 0). |
| **% / Semáforo** y **Observaciones** | **No se tocan.** |

Reglas importantes:
- Los días **anteriores a `FECHA_INICIO`** (por defecto `2026-10-01`) nunca se modifican, así que lo que ya llenaste a mano queda intacto.
- Solo se crean filas cuando el agente tiene actividad ese día, así que no aparecen filas en rojo por días libres.
- Si no existe la hoja del mes (por ejemplo `NOVIEMBRE 2026`), se crea copiando la del mes anterior: mismas fórmulas y formato, sin datos.

## Hojas nuevas que crea

- **RESUMEN MENSUAL**: por mes y por agente, con una fila de total del EQUIPO. Muestra días trabajados, asignados, nuevas consultas, re-asignados, total, cerrados, **% de resolución**, días en verde, amarillo y rojo, **tiempo promedio de 1ª respuesta**, **tiempo promedio y mediano de resolución**, y **% de casos resueltos en menos de 24 h**. Las cantidades salen de las hojas mensuales, así que incluye febrero a septiembre aunque se hayan llenado a mano. Los tiempos existen desde que se activa la automatización.
- **HS_Eventos**: cada asignación, re-asignación, nueva consulta, primera respuesta y cierre, con agente, número de caso, minutos y **enlace directo al caso en Help Scout**. Sirve para auditar y para hacer tablas dinámicas.
- **HS_InicioJornada**: la foto diaria de casos sin atender por agente.
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
1. En la hoja convertida: **Extensiones → Apps Script**.
2. Crea un archivo por cada `.gs` de la carpeta [`apps-script/`](apps-script) con el mismo nombre (`Config`, `Util`, `Eventos`, `Metricas`, `HelpScout`, `Sync`, `Tracker`, `Resumen`, `Menu`) y pega su contenido.
3. En **Configuración del proyecto (⚙️)** activa *"Mostrar el archivo de manifiesto appsscript.json"* y reemplaza su contenido por [`apps-script/appsscript.json`](apps-script/appsscript.json).
4. Guarda.

> Alternativa para desarrolladores: con [clasp](https://github.com/google/clasp), crea `.clasp.json` con `"rootDir": "apps-script"` y el `scriptId` de la hoja, y luego ejecuta `clasp push`.

### 4. Configurar `Config.gs`
- **AGENTES**: nombre **exactamente** como aparece en la columna "Nombre del Agente" y su **email de Help Scout**.
- **FECHA_INICIO**: desde qué día llena la automatización.
- **HORA_INICIO_JORNADA**: hora de la foto de "sin atender".
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
| Asignándolos a un usuario o **Team** de CCH/COACH | Nada: ya funciona, porque ese usuario no está en `AGENTES`. |
| **Moviéndolos a otro buzón** | Pon en `MAILBOXES_EQUIPO` los IDs de los buzones del equipo SOP (están en la hoja `HS_Usuarios`). |
| Poniéndoles una **etiqueta** | Pon las etiquetas en `TAGS_REASIGNACION` (por defecto `cch`, `coach`). |

## Preguntas frecuentes

- **¿Es instantáneo?** Se actualiza cada 15 minutos (`MINUTOS_ENTRE_SINCRONIZACIONES`, mínimo 1). "Help Scout → Sincronizar ahora" fuerza una actualización.
- **¿Los agentes siguen llenando algo a mano?** No hace falta. Si alguien edita una columna automática del día, la siguiente sincronización la sobrescribe. Si quieres que una columna siga siendo manual, quítala de `COLUMNAS_AUTOMATICAS`. "Observaciones" siempre es manual.
- **¿Los tiempos son en horario laboral?** No, son horas calendario: un caso asignado el viernes a las 5 pm y cerrado el lunes a las 9 am suma 64 h. Por eso el resumen muestra también la **mediana**, que se ve menos afectada por esos casos.
- **¿Qué pasa si cambia la fórmula de "Total"?** El script no la escribe. Los "Pendientes" usan `C + D + E − F − H`; si tu fórmula de Total no incluye la columna C, avísame para alinearlo.
- **Reiniciar**: "Reiniciar sincronización" vuelve a leer Help Scout desde `FECHA_INICIO` sin duplicar eventos.

## Desarrollo

La lógica que interpreta el historial de Help Scout (`Eventos.gs`, `Metricas.gs`, `Util.gs`) es JavaScript puro y tiene pruebas:

```bash
npm test
```

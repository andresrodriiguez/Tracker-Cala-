# Encuesta Consciencia Divina

Organiza el Google Form de la encuesta en secciones y le pone el banner y los colores de la página de Consciencia Divina.

## 1. Dividir en secciones (script, ~3 min)

1. Abre [script.google.com](https://script.google.com) con la cuenta que **edita** el Form y crea un **Nuevo proyecto**.
2. Borra lo que trae y pega todo [`OrganizarForm.gs`](OrganizarForm.gs). Guarda (💾).
3. Elige la función **`revisar`** arriba y pulsa **Ejecutar**. La primera vez Google pide permisos: *Revisar permisos → tu cuenta → Avanzado → Ir a (no seguro) → Permitir*. Es tu propio script.
4. En **Registro de ejecución** debe decir **✅ Todo listo**. Esta función no cambia nada.
5. Elige **`aplicar`** y pulsa **Ejecutar**. Primero guarda en tu Drive una copia de respaldo del Form y después hace los cambios.

Qué cambia:

| Sección | Preguntas |
|---|---|
| 1. Tu experiencia en general | Satisfacción, expectativas, recomendación (0–4), otra experiencia, cómo te enteraste, calidad vs. inversión |
| 2. Antes del evento | Información previa, Servicio al Cliente, asesor |
| 3. Organización y Cala Team | Organización, transporte, cuaderno, apoyo y amabilidad del Cala Team, recepción, afinidad con el grupo |
| 4. Sesiones y facilitadores | Meditaciones, Ismael, Julian Merchan, Alberto Becerra, Betsy Dopico, Mercedes Guzman |
| 5. Programa y tiempos | Cronograma, duración de sesiones, recesos, cierre |
| 6. Cala Center y alimentación | Instalaciones, comida, porciones |
| 7. Tus comentarios | Lo que menos gustó, aprendizaje, qué mejorar, 3 recomendados |

- Activa la **barra de progreso** y pone un mensaje de agradecimiento al terminar.
- Corrige las opciones **"Option 2" → "Algo satisfecho"** y **"Defciente" → "Deficiente"**. Las respuestas que ya llegaron conservan el texto anterior en la hoja de respuestas.
- Corrige tildes y signos de interrogación en 7 títulos, y quita el `*` sobrante en los de Alberto y Betsy. Para no tocar los títulos, pon `CORREGIR_TITULOS = false`.
- **No** borra preguntas ni respuestas, y el orden de las preguntas no cambia.

## 2. Banner y colores (a mano, ~2 min)

Google no deja cambiar el tema con un script. En el Form, pulsa **🎨 Personalizar tema**:

1. **Encabezado → Elegir imagen → Subir**: [`banner-form.png`](banner-form.png) (1600×400).
2. **Color**: pulsa **+** y escribe `#0C8F63` (el verde de la página).
3. **Color de fondo**: elige el tono verde más claro que ofrece.
4. **Estilo de texto**: si aparece *Montserrat* en la lista de fuentes, úsala en el encabezado, las preguntas y el texto.

## Alternativa: página propia (`index.html`)

[`index.html`](index.html) es la misma encuesta como página web, con el fondo y el logo de Consciencia Divina. Envía las respuestas al mismo Google Form. Para conectarla:

1. En el Form: **⋮ → Obtener vínculo previamente completado**, responde **todas** las preguntas y copia el vínculo.
2. Pégalo en `CONFIG.PREFILLED_URL` dentro de `index.html`.
3. `PAGE_HISTORY` ya está en `'0,1,2,3,4,5,6'` (las 7 secciones del paso 1). Si no corres el script, cámbialo a `'0'`.

El Form debe aceptar respuestas de cualquier persona: en **Configuración → Respuestas**, desactiva *"Restringir a usuarios de…"*.

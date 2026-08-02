# Desplegar "El Banquete" en Render — paso a paso

No hace falta terminal ni saber programar. Son dos webs, todo a golpe de clic. Unos 10 minutos la primera vez.

## Parte 1 — Subir el código a GitHub (para que Render lo pueda leer)

1. Ve a **github.com** y crea una cuenta gratis si no tienes (botón "Sign up", solo pide email y contraseña).
2. Una vez dentro, ve a **github.com/new** para crear un repositorio nuevo.
   - Nombre: `el-banquete` (o el que quieras).
   - Marca **Public**.
   - No marques "Add a README" (déjalo todo vacío).
   - Click **Create repository**.
3. En la página del repo recién creado verás un enlace que dice algo como *"uploading an existing file"* — haz click ahí.
4. Descomprime el zip que te mandé en tu ordenador. Arrastra **todo el contenido de la carpeta** `el-banquete-app` (los archivos `server.js`, `data.js`, `package.json`, `render.yaml`, `README.md`, y la carpeta `public` con `index.html` dentro) a la zona de subida de GitHub.
   - Importante: arrastra el *contenido* de la carpeta, no la carpeta entera envuelta en otra carpeta.
5. Abajo, click **Commit changes**.

Ya tienes el código en GitHub — es la fuente que Render va a leer.

## Parte 2 — Desplegarlo en Render

1. Ve a **render.com** y click en **Get Started**. Lo más rápido es elegir **"Sign up with GitHub"** — así el siguiente paso conecta solo.
2. Una vez dentro, click en **New +** (arriba a la derecha) → **Web Service**.
3. Conecta tu cuenta de GitHub si te lo pide, y selecciona el repositorio `el-banquete` que acabas de crear.
4. Render debería detectar automáticamente que es Node (gracias al archivo `render.yaml` que incluí). Si te pide confirmar los campos, deja:
   - **Name:** el que quieras (será parte de la URL, ej. `el-banquete` → `el-banquete.onrender.com`).
   - **Region:** la más cercana a vosotros (ej. Frankfurt).
   - **Branch:** `main`.
   - **Build Command:** vacío.
   - **Start Command:** `node server.js`.
   - **Instance Type:** **Free**.
5. Click **Create Web Service** (o **Deploy**). Espera 1-2 minutos mientras se despliega — verás los logs pasando y al final `El Banquete escuchando en :3000` (o el puerto que Render asigne).
6. Cuando el estado pase a **Live**, arriba verás la URL, algo como `https://el-banquete.onrender.com`. Esa es la que abrís los 3 desde el móvil.

## Cosas a saber del plan gratuito de Render

- Si nadie juega durante 15 minutos, el servicio "se duerme". La próxima vez que alguien abra el enlace tarda unos 30-50 segundos en despertar (verás una pantalla cargando) — no es que esté roto, solo se despierta. Después va fluido.
- La partida vive en la memoria del servidor mientras dura; si Render reinicia el servicio a mitad de partida (raro, pero puede pasar en el plan gratis tras muchas horas), tocaría empezar de nuevo. Para una partida de una tarde con amigos no debería notarse.
- El enlace es permanente — podéis guardarlo y volver a jugar cuando queráis, no hay que repetir estos pasos.

## Si algo falla

- Si Render no detecta Node automáticamente, en la configuración del servicio busca "Runtime" o "Environment" y ponlo manualmente a **Node**.
- Si el despliegue falla, mira la pestaña **Logs** del servicio en Render — casi siempre dice justo qué archivo falta o qué ha ido mal.

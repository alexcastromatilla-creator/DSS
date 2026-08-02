# El Banquete

Juego de conquista, historia y brindis para 3 jugadores, cada uno desde su móvil.

Es la primera versión jugable del diseño que hicimos juntos: tablero de 12 territorios que se abre en 3 Eras (Grecia/Roma → Rutas de Oriente → Renacimiento y Nuevo Mundo), combate por dados, trivia como ventaja táctica, cartas de Personaje y los Desafíos de estrategia+bebida.

## Requisitos

- Node.js 18 o superior (no hace falta nada más — el proyecto no tiene dependencias externas, así que **no hace falta `npm install`**).

## Cómo arrancarlo

```
node server.js
```

Verás `El Banquete escuchando en :3000`. Abre `http://localhost:3000` en un navegador para comprobar que funciona.

## Cómo jugar los 3 desde el móvil

### Opción A — mismo wifi (la más rápida para probarlo)

1. En el ordenador donde corre el servidor, mira tu IP local: en Mac/Linux `ifconfig | grep inet`, en Windows `ipconfig`. Busca algo como `192.168.1.23`.
2. Con los 3 móviles conectados a la misma red wifi, abrid `http://192.168.1.23:3000` (con tu IP) en cada uno.
3. Uno crea la sala, os pasa el código de 4 letras, los otros dos se unen.

### Opción B — cada uno desde su casa (por internet)

Necesitas desplegar el servidor en algún sitio con IP pública. Es gratis y tarda 5 minutos:

1. Crea una cuenta en [Render](https://render.com) (o Railway/Fly.io, todos tienen capa gratuita).
2. "New Web Service" → conecta este código (puedes subirlo a un repo de GitHub primero, o usar la opción de subir el zip directamente).
3. Build command: (vacío, no hace falta). Start command: `node server.js`.
4. Al desplegar te da una URL pública tipo `https://el-banquete.onrender.com` — esa es la que abrís los 3 desde vuestros móviles.

Si solo queréis probarlo una vez sin desplegar nada permanente, también podéis correr el servidor en un ordenador y exponerlo con un túnel como `ngrok http 3000` (gratis, da una URL temporal).

## Cómo se juega

1. **Lobby:** el anfitrión crea la sala y comparte el código. Los otros dos se unen. Cada uno elige su Arquetipo (Filósofo, Estratega o Diplomático).
2. **Cada Era** (3 en total) abre 4 territorios nuevos en el tablero y dura 3 rondas.
3. **Cada ronda:** primero una pregunta de trivia rápida (30 segundos) — acertarla da una ventaja táctica en tu próximo combate. Luego, en secreto desde tu móvil, eliges una orden: **Atacar** un territorio, **Reforzar** uno tuyo, **Reclutar** un Personaje, o **Espiar** a un rival. Se resuelve todo a la vez y el resultado (incluidos los sorbos) se muestra en pantalla.
4. **Tras la 2ª ronda de cada Era:** un Desafío de grupo (dilema, riesgo o debate) — el componente más "de beber" del juego.
5. **Al final de cada Era:** un Simposio reparte Gloria según los territorios que controla cada uno.
6. Gana quien más Gloria tenga al final de la Era III.

Las cantidades de sorbos que muestra la app son orientativas — ajustadlas a vuestro gusto, la app no os obliga a nada, solo lleva la cuenta del juego.

## Qué está simplificado en esta v1 (para que fuera jugable ya)

Comparado con el documento de diseño completo:

- **Personajes:** cada Era tiene un mazo de 4 (en vez de los ~13-16 del diseño completo). 2 de cada 4 tienen efecto mecánico real en el juego (César, Diógenes, Genghis Khan, Avicena, Maquiavelo, Isabel de Castilla); los otros 2 son cartas de prestigio que dan +1 Gloria.
- **Desafíos:** hay 3 implementados (Dilema del Prisionero, Encrucijada de Aníbal, Debate de Atenas) que rotan uno por Era, en vez del mazo completo de 8.
- **Combate:** dados estilo Risk (hasta 3 atacantes vs 2 defensores) con los bonos de Arquetipo y Personaje ya integrados.
- **Refuerzos militares:** las legiones que envías a atacar salen siempre de tu reserva (no gestionas el movimiento físico de tropas entre territorios), para mantener la partida ágil desde el móvil.

Nada de esto es difícil de ampliar — si tras un par de partidas veis que os falta contenido (más trivia, más Personajes, más Desafíos), es la parte más rápida de añadir porque toda la estructura ya está montada en `data.js`.

## Verificación

Antes de entregarlo, la lógica del juego se probó con una simulación automática de una partida completa de 3 jugadores (las 3 Eras, todas las fases) sin errores, y por separado con un test en navegador real (3 pestañas simultáneas) cubriendo lobby, elección de Arquetipo, trivia y envío de órdenes, también sin errores.

## Estructura del proyecto

```
server.js       → toda la lógica del juego y el servidor (sin dependencias externas)
data.js         → territorios, personajes, trivia y desafíos (aquí se amplía el contenido)
public/index.html → la interfaz — una sola página, funciona en cualquier móvil
package.json
```

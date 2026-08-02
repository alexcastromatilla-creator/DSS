# El Banquete

Juego de conquista, historia y brindis para 2 a 6 jugadores, cada uno desde su móvil.

Tablero de 12 territorios repartidos en 3 Eras (Grecia/Roma → Rutas de Oriente → Renacimiento y Nuevo Mundo) — **el mapa se genera al azar en cada partida** (hay 8 regiones posibles por Era, se eligen 4 y se conectan de forma distinta cada vez), combate por dados al estilo Risk (atacas desde un territorio tuyo concreto, con las tropas que tengas ahí estacionadas), cartas de Personaje y los Desafíos de estrategia+bebida. También puedes jugar contra bots para probarlo sin esperar a tener gente disponible.

El tablero se ve como un mapa fraccionado de verdad, sin círculos ni marcadores sueltos: cada territorio es un fragmento de terreno con su propio color desde el primer turno — en cuanto alguien lo conquista, se repinta con el color de ese jugador — y hay una frontera marcada entre fragmentos, como en un mapa de conquista. El borde de tus territorios se ve dorado, y el de los que hacen frontera contigo (= los que puedes atacar ahora mismo) rojo. Toca cualquier fragmento para ver su ficha completa en la lista de abajo.

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

### Opción B — un enlace permanente, jugable desde cualquier sitio

Sigue **`DEPLOY_RENDER.md`** (incluido en esta carpeta) — son dos webs y un rato de clics, sin terminal ni saber programar, y al final tenéis una URL fija tipo `https://el-banquete.onrender.com` que podéis guardar y reutilizar siempre.

**Importante sobre el plan gratuito de Render:** si nadie usa la sala durante un rato largo (típicamente 15 minutos), Render "duerme" el servicio para ahorrar recursos. La próxima vez que alguien entre tarda unos segundos extra en despertar, y — como las salas viven en memoria, no en una base de datos — **cualquier sala que hubiera creada antes de dormirse desaparece**. Si un código de sala deja de funcionar de un día para otro, esa es la causa más probable: hay que crear la sala de nuevo. No afecta a partidas que estéis jugando activamente, solo a salas abandonadas.

## Reiniciar una partida o salir de la sala

Arriba de la pantalla, mientras estás en una sala, hay una barra con el código y dos botones: **🔄 Reiniciar** (solo lo ve el anfitrión — vuelve al lobby con un mapa nuevo, resetea Gloria y progreso, pero mantiene a los mismos jugadores y sus Arquetipos, sin tener que compartir un código nuevo) y **🚪 Salir** (te devuelve a la pantalla inicial si te has quedado atascado o quieres crear/unirte a otra sala). Al terminar una partida también aparece un botón para que el anfitrión empiece otra ronda con el mismo grupo.

## Jugar solo/a contra bots (para probar el juego)

Ya no hace falta esperar a tener 2 amigos disponibles para probarlo. En la pantalla inicial, al crear sala, eliges cuántos jugadores en total (2 a 6) y cuántos de ellos son bots (por defecto 0, para no dejar sin sitio a tus amigos por despiste). Si quieres testear una partida completa tú solo/a, sube el número de bots a "total - 1". Los bots eligen arquetipo, envían órdenes y participan en los Desafíos de forma automática (con un pequeño retraso, para que se sienta natural).

## Cómo se juega

1. **Lobby:** el anfitrión crea la sala (eligiendo nº de jugadores y de bots) y comparte el código con los jugadores humanos que falten — los bots ya están dentro. Cada uno elige su Arquetipo: hay 6 disponibles (Filósofo, Estratega, Diplomático, Explorador, Guerrero, Comerciante), cada uno con un icono y un bonus distinto.
2. **Cada Era** (3 en total) abre 4 territorios nuevos, elegidos al azar de un pool de 8 posibles por Era, y dura 3 rondas. Las tropas también cambian por Época: legiones en la Era I, jinetes en la Era II, regimientos en la Era III — y los territorios más tardíos empiezan con más guarnición.
3. **Cada ronda, sin prisa (ya no hay contador):** en secreto desde tu móvil, eliges una orden: **Atacar** (eligiendo territorio de origen —uno tuyo, con tropas de sobra— y el territorio vecino que quieres conquistar, como en el Risk), **Reforzar** uno tuyo, **Reclutar** un Personaje, o **Espiar** a un rival. Se resuelve todo a la vez y el resultado (incluidos los sorbos) se muestra en pantalla junto al tablero actualizado.
4. **Tras la 2ª ronda de cada Era:** un Desafío de grupo (dilema, riesgo o debate) — el componente más "de beber" del juego.
5. **Al final de cada Era:** un Simposio reparte Gloria según los territorios que controla cada uno.
6. Gana quien más Gloria tenga al final de la Era III.

Las cantidades de sorbos que muestra la app son orientativas — ajustadlas a vuestro gusto, la app no os obliga a nada, solo lleva la cuenta del juego.

## Qué está simplificado en esta v1 (para que fuera jugable ya)

Comparado con el documento de diseño completo:

- **Arquetipos:** hay 6 implementados (Filósofo, Estratega, Diplomático, Explorador, Guerrero, Comerciante) de los que puede haber más en el diseño completo.
- **Regiones:** hay 8 posibles por Era en `data.js` (24 en total); cada partida usa 4 por Era elegidas y conectadas al azar. Añadir más regiones al pool es tan fácil como añadir una línea más.
- **Personajes:** cada Era tiene un mazo de 4 (en vez de los ~13-16 del diseño completo). 2 de cada 4 tienen efecto mecánico real en el juego (César, Diógenes, Genghis Khan, Avicena, Maquiavelo, Isabel de Castilla); los otros 2 son cartas de prestigio que dan +1 Gloria.
- **Desafíos:** hay 3 implementados (Dilema del Prisionero, Encrucijada de Aníbal, Debate de Atenas) que rotan uno por Era, en vez del mazo completo de 8.
- **Combate:** dados estilo Risk (hasta 3 atacantes vs 2 defensores) con los bonos de Arquetipo y Personaje ya integrados. Atacas desde un territorio tuyo concreto (dejando al menos 1 tropa de guarnición); si conquistas, las tropas supervivientes se mudan al territorio nuevo, si fracasas solo pierdes las bajas y el resto vuelve a casa.
- **Territorios libres:** en la 1ª ronda de cada Era, los 4 territorios nuevos están sin dueño y se colonizan directamente desde tu reserva (no hace falta tener ya un vecino tuyo).
- **Ilustraciones:** por defecto el juego usa dibujos vectoriales propios (monumento de fondo por Era) e iconos con marco animado (personajes) — no dependen de ningún servicio externo. Hay ilustraciones "pintadas" opcionales generadas con IA; instrucciones en `public/images/LEEME.md`.

Nada de esto es difícil de ampliar — si tras un par de partidas veis que os falta contenido (más Personajes, más Desafíos, más regiones), es la parte más rápida de añadir porque toda la estructura ya está montada en `data.js`.

## Verificación

La lógica del juego se probó con simulaciones automáticas de partidas completas (3 humanos, y por separado 1 humano + bots) sin errores, un test dedicado de reiniciar partida (permisos, reseteo de progreso, mapa nuevo, se puede jugar de nuevo), y con tests en navegador real cubriendo lobby, selección de nº de jugadores/bots, elección de Arquetipo, envío de órdenes de ataque con territorio de origen, que el formulario de órdenes no se borra aunque otro jugador (o un bot) envíe su orden mientras tú sigues eligiendo la tuya, y que ya no hay ningún contador visible en pantalla.

## Estructura del proyecto

```
server.js       → toda la lógica del juego y el servidor (sin dependencias externas)
data.js         → regiones, tropas por Época, personajes y desafíos (aquí se amplía el contenido)
public/index.html → la interfaz — una sola página, funciona en cualquier móvil
public/images/  → ilustraciones opcionales (ver LEEME.md ahí dentro)
package.json
```

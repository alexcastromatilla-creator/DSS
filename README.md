# El Banquete

Juego de conquista, historia y brindis para 2 a 6 jugadores, cada uno desde su móvil.

Tablero de 24 territorios repartidos en 3 Eras (Grecia/Roma → Rutas de Oriente → Renacimiento y Nuevo Mundo, 8 territorios por Era) — **el mapa se genera al azar en cada partida** (hay 12 regiones posibles por Era, se eligen 8 y se conectan de forma distinta cada vez) con la forma orgánica de un país inventado, no un continente entero ni territorios sueltos. Combate por dados al estilo Risk (atacas desde un territorio tuyo concreto, con las tropas que tengas ahí estacionadas), tropas con 3 niveles mejorables gastando Recursos, cartas de Personaje y los Desafíos de estrategia+bebida. También puedes jugar contra bots para probarlo sin esperar a tener gente disponible.

El tablero se ve como el mapa de un país de verdad, sin círculos ni marcadores sueltos: cada territorio es un fragmento de terreno con su propio color desde el primer turno — en cuanto alguien lo conquista, se repinta con el color de ese jugador — y hay una frontera marcada entre fragmentos, como en un mapa de conquista. El borde de tus territorios se ve dorado, y el de los que hacen frontera contigo (= los que puedes atacar ahora mismo) rojo. Se ve el país entero desde el primer turno: los territorios de Eras que todavía no han empezado aparecen como zonas en niebla (🔒), que se revelan con su terreno real al llegar su Era. Toca cualquier fragmento abierto para ver su ficha completa en la lista de abajo.

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
2. **Cada Era** (3 en total) abre 8 territorios nuevos, elegidos al azar de un pool de 12 posibles por Era, y dura 3 rondas. Las tropas también cambian por Época: legiones en la Era I, jinetes en la Era II, regimientos en la Era III — cada tipo tiene 3 niveles mejorables (ver más abajo) y los territorios más tardíos empiezan con más guarnición.
3. **Cada ronda, sin prisa (ya no hay contador):** en secreto desde tu móvil, eliges una orden: **Atacar** (eligiendo territorio de origen —uno tuyo, con tropas de sobra— y el territorio vecino que quieres conquistar, como en el Risk), **Reforzar** uno tuyo, **Reclutar** un Personaje, o **Espiar** a un rival. Se resuelve todo a la vez y el resultado (incluidos los sorbos) se muestra en pantalla junto al tablero actualizado. Mejorar tus tropas (ver abajo) no consume esta orden — es una decisión aparte, se puede hacer en cualquier momento.
4. **Tras la 2ª ronda de cada Era:** un Desafío de grupo (dilema, riesgo o debate) — el componente más "de beber" del juego.
5. **Al final de cada Era:** un Simposio reparte Gloria según los territorios que controla cada uno.
6. Gana quien más Gloria tenga al final de la Era III.

Las cantidades de sorbos que muestra la app son orientativas — ajustadlas a vuestro gusto, la app no os obliga a nada, solo lleva la cuenta del juego.

## Recursos y mejora de tropas

Cada territorio que controlas te da **1 Recurso** al final de cada ronda — cuanto más mapa controlas, más rápido acumulas. Los Recursos sirven para mejorar tus tropas: cada tipo de tropa (legiones, jinetes, regimientos) tiene 3 niveles, explicados en detalle dentro de la propia app:

1. **Nivel 1** (inicial, gratis): dados de combate normales (hasta 3 al atacar, hasta 2 al defender).
2. **Nivel 2** ("veterana/o", cuesta 8 Recursos): +1 dado extra tanto al atacar como al defender.
3. **Nivel 3** ("de élite", cuesta 16 Recursos): igual que nivel 2, y además gana los empates en combate (normalmente los gana quien defiende).

Mejorar es "tecnología compartida": en cuanto subes de nivel un tipo de tropa, sube **para siempre y para todas** tus tropas de esa Época — las que ya tienes estacionadas y las que consigas después —, no solo el ejército que combatió. No consume tu orden de la ronda: puedes mejorar en cualquier momento que te alcancen los Recursos, siempre que esa Era ya haya empezado. Dentro de la partida, la tarjeta "⚔️ Tus tropas y mejoras" muestra en todo momento cuántos Recursos tienes, en qué nivel está cada tropa y qué hace exactamente cada nivel.

## Qué está simplificado en esta v1 (para que fuera jugable ya)

Comparado con el documento de diseño completo:

- **Arquetipos:** hay 6 implementados (Filósofo, Estratega, Diplomático, Explorador, Guerrero, Comerciante) de los que puede haber más en el diseño completo.
- **Regiones:** hay 12 posibles por Era en `data.js` (36 en total); cada partida usa 8 por Era elegidas y conectadas al azar (24 territorios en juego, con la disposición calculada por el servidor para que salga siempre una única masa de tierra conectada tipo país). Añadir más regiones al pool es tan fácil como añadir una línea más.
- **Personajes:** cada Era tiene un mazo de 4 (en vez de los ~13-16 del diseño completo). 2 de cada 4 tienen efecto mecánico real en el juego (César, Diógenes, Genghis Khan, Avicena, Maquiavelo, Isabel de Castilla); los otros 2 son cartas de prestigio que dan +1 Gloria.
- **Desafíos:** hay 3 implementados (Dilema del Prisionero, Encrucijada de Aníbal, Debate de Atenas) que rotan uno por Era, en vez del mazo completo de 8.
- **Combate:** dados estilo Risk (hasta 3 atacantes vs 2 defensores) con los bonos de Arquetipo, Personaje y nivel de tropa ya integrados. Atacas desde un territorio tuyo concreto (dejando al menos 1 tropa de guarnición); si conquistas, las tropas supervivientes se mudan al territorio nuevo, si fracasas solo pierdes las bajas y el resto vuelve a casa.
- **Niveles de tropa:** 3 niveles por tipo de tropa (ver "Recursos y mejora de tropas" más arriba), iguales en estructura para las 3 Épocas. Añadir un 4º nivel o variar el coste es cuestión de tocar el array `levels` de cada tropa en `data.js`.
- **Territorios libres:** en la 1ª ronda de cada Era, los 4 territorios nuevos están sin dueño y se colonizan directamente desde tu reserva (no hace falta tener ya un vecino tuyo).
- **Ilustraciones:** por defecto el juego usa dibujos vectoriales propios (monumento de fondo por Era) e iconos con marco animado (personajes) — no dependen de ningún servicio externo. Hay ilustraciones "pintadas" opcionales generadas con IA; instrucciones en `public/images/LEEME.md`.

Nada de esto es difícil de ampliar — si tras un par de partidas veis que os falta contenido (más Personajes, más Desafíos, más regiones), es la parte más rápida de añadir porque toda la estructura ya está montada en `data.js`.

## Verificación

La lógica del juego se probó con simulaciones automáticas de partidas completas (3 humanos, y por separado 1 humano + bots) sin errores — comprobando también que el mapa siempre tiene 24 territorios (8 abiertos en Era I) y que Recursos y niveles de tropa parten bien inicializados para todos los jugadores —, un test dedicado de reiniciar partida (permisos, reseteo de progreso incluidos Recursos y niveles, mapa nuevo de 24 territorios, se puede jugar de nuevo), dos tests dedicados al sistema de mejora de tropas (rechazo sin Recursos suficientes, rechazo al mejorar una Era todavía no alcanzada, y el camino completo de una mejora real: conquista, ingreso de Recursos, subida de nivel con su coste correcto, y que la mejora de un jugador no afecte a los demás), y tests en navegador real cubriendo lobby, selección de nº de jugadores/bots, elección de Arquetipo, el panel "Tus tropas y mejoras", que la barra de sala muestra los Recursos, el mapa del país completo (24 fragmentos pintados, 16 en niebla al empezar la Era I, sin círculos), envío de órdenes de ataque con territorio de origen, que el formulario de órdenes no se borra aunque otro jugador (o un bot) envíe su orden mientras tú sigues eligiendo la tuya, y que ya no hay ningún contador visible en pantalla.

## Estructura del proyecto

```
server.js       → toda la lógica del juego y el servidor, incluida la disposición del mapa (sin dependencias externas)
data.js         → regiones, tropas por Época con sus niveles de mejora, personajes y desafíos (aquí se amplía el contenido)
public/index.html → la interfaz — una sola página, funciona en cualquier móvil
public/images/  → ilustraciones opcionales (ver LEEME.md ahí dentro)
package.json
```

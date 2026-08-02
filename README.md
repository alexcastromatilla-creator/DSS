# El Banquete

Juego de conquista, historia y brindis para 2 a 6 jugadores, cada uno desde su móvil — al estilo de un Civilization de sobremesa, con Risk en el corazón del combate.

Cada jugador encarna a un **Líder histórico** (Alejandro Magno, Juana de Arco, Aníbal, Pericles, Zheng He, Mansa Musa, Simón Bolívar o Sun Tzu), cada uno con un bonus permanente propio. El tablero es un **mapa político generado al azar en cada partida**: un país de 24 provincias con fronteras orgánicas y mar alrededor, repartido en 3 Eras (Grecia/Roma → Rutas de Oriente → Renacimiento y Nuevo Mundo, 8 provincias por Era, elegidas de un pool de 12 por Era). Las provincias de Eras futuras se ven desde el primer turno como zonas en niebla 🔒 que se revelan al llegar su Era.

Hay **3 clases de tropa** con ventajas entre sí (Infantería vence a Caballería, Caballería vence a las tropas A distancia, y éstas vencen a Infantería), **3 modos de ataque** (Asalto, Asedio e Incursión), **Recursos** que generan tus territorios, **niveles de tropa mejorables**, **Maravillas** construibles y **3 formas distintas de ganar**. Y, siendo El Banquete, los Desafíos de estrategia+bebida siguen en el centro de la fiesta. También puedes jugar contra bots para probarlo sin esperar a tener gente disponible.

## Requisitos

- Node.js 18 o superior (no hace falta nada más — el proyecto no tiene dependencias externas, así que **no hace falta `npm install`**).

## Cómo arrancarlo

```
node server.js
```

Verás `El Banquete escuchando en :3000`. Abre `http://localhost:3000` en un navegador para comprobar que funciona.

## Cómo jugar desde el móvil

### Opción A — mismo wifi (la más rápida para probarlo)

1. En el ordenador donde corre el servidor, mira tu IP local: en Mac/Linux `ifconfig | grep inet`, en Windows `ipconfig`. Busca algo como `192.168.1.23`.
2. Con los móviles conectados a la misma red wifi, abrid `http://192.168.1.23:3000` (con tu IP) en cada uno.
3. Uno crea la sala, os pasa el código de 4 letras, los demás se unen.

### Opción B — un enlace permanente, jugable desde cualquier sitio

Sigue **`DEPLOY_RENDER.md`** (incluido en esta carpeta) — son dos webs y un rato de clics, sin terminal ni saber programar, y al final tenéis una URL fija tipo `https://el-banquete.onrender.com` que podéis guardar y reutilizar siempre.

**Importante sobre el plan gratuito de Render:** si nadie usa la sala durante un rato largo (típicamente 15 minutos), Render "duerme" el servicio para ahorrar recursos. La próxima vez que alguien entre tarda unos segundos extra en despertar, y — como las salas viven en memoria, no en una base de datos — **cualquier sala creada antes de dormirse desaparece**. Si un código de sala deja de funcionar de un día para otro, esa es la causa más probable: hay que crear la sala de nuevo. No afecta a partidas que estéis jugando activamente, solo a salas abandonadas.

## Reiniciar una partida o salir de la sala

Arriba de la pantalla, mientras estás en una sala, hay una barra con el código, tus Recursos 💰 y dos botones: **🔄 Reiniciar** (solo lo ve el anfitrión — vuelve al lobby con un mapa nuevo, resetea Gloria, Recursos, niveles y Maravillas, pero mantiene a los mismos jugadores y sus Líderes) y **🚪 Salir**. Al terminar una partida también aparece un botón para que el anfitrión empiece otra con el mismo grupo.

## Jugar solo/a contra bots (para probar el juego)

En la pantalla inicial, al crear sala, eliges cuántos jugadores en total (2 a 6) y cuántos de ellos son bots (por defecto 0). Los bots eligen Líder, envían órdenes con los tres modos de ataque, eligen la clase con ventaja al colonizar, mejoran sus tropas, construyen Maravillas si van sobrados y participan en los Desafíos, todo de forma automática.

## Cómo se juega

1. **Lobby:** el anfitrión crea la sala y comparte el código. Cada jugador elige su **Líder histórico** — 8 disponibles, cada uno con retrato, título y un bonus permanente distinto (defensa, conquista, economía, mejoras más baratas...). Una tarjeta "Cómo funciona" resume las reglas ahí mismo.
2. **Cada Era** (3 en total) abre 8 provincias nuevas y dura 3 rondas. Cada provincia tiene una **clase de guarnición** visible en el mapa (p. ej. Hoplitas 🛡️, Hetairoi 🐎 o Arqueros cretenses 🏹 en la Era I — los nombres cambian por Época, el rol táctico no).
3. **Cada ronda, en secreto desde tu móvil**, eliges una orden:
   - **⚔️ Atacar / Colonizar** con 3 modos: **Asalto** (combate a dados estilo Risk: si aniquilas la guarnición, conquistas la provincia y tus supervivientes se mudan), **Asedio** (duelo a 1 dado: si ganas, el defensor pierde 1 tropa — desgaste sin arriesgar conquista) o **Incursión** (duelo a 1 dado contra provincia de un rival: si ganas, le robas hasta 3 Recursos 💰). En la 1ª ronda de cada Era, las provincias nuevas están libres y se **colonizan** desde tu reserva eligiendo tú la clase de tropa con la que desembarcas.
   - **🛡️ Reforzar** una provincia tuya con tu reserva.
   - **👑 Reclutar** un Personaje histórico (cartas con efectos, ver abajo).
   - **🕵️ Espiar** el ejército de un rival.
4. **La ventaja de clase** funciona en todos los modos: si tu clase vence a la del defensor (Infantería > Caballería > A distancia > Infantería), juegas con +1 dado; si es al revés, el defensor lo recibe él. El mapa te enseña la clase de cada provincia justamente para que puedas planear con qué atacar.
5. **Tras la 2ª ronda de cada Era:** un Desafío de grupo (dilema, riesgo o debate) — el componente más "de beber" del juego.
6. **Al final de cada Era:** un Simposio reparte Gloria según las provincias que controla cada uno.

Las cantidades de sorbos que muestra la app son orientativas — ajustadlas a vuestro gusto, la app no os obliga a nada, solo lleva la cuenta del juego.

## Recursos, mejoras de tropa y Maravillas

Cada provincia que controlas te da **1 Recurso 💰** al final de cada ronda (Mansa Musa gana 1 extra). Los Recursos se gastan en dos cosas, y ninguna consume tu orden de la ronda:

- **⬆️ Mejorar una clase de tropa** (para siempre, todas tus tropas de esa clase en todas las Épocas): Nivel 1 Recluta (gratis) → Nivel 2 Veterana (+1 dado, 8 💰) → Nivel 3 De élite (+1 dado y gana los empates, que normalmente favorecen al defensor, 16 💰). Sun Tzu paga 2 💰 menos. El panel "⚔️ Tus tropas y mejoras" explica cada clase y cada nivel durante toda la partida.
- **🏛️ Construir una Maravilla** (15 💰, en una provincia tuya, máximo una por provincia): El Partenón, la Gran Muralla, Machu Picchu... La Maravilla queda ligada a la provincia — **si te la conquistan, la Maravilla cambia de dueño**.

## Las 3 formas de ganar

El panel "🏆 Vías de victoria" muestra en todo momento el progreso de cada jugador hacia las tres:

1. **🗺️ Dominación** — controla el 60% de las provincias abiertas al final de cualquier ronda (5 de 8 en la Era I, 10 de 16 en la II, 15 de 24 en la III) y ganas al instante.
2. **🏛️ Cultura** — controla 3 Maravillas a la vez y ganas al instante (construirlas... o conquistárselas a otro).
3. **🏆 Gloria** — si nadie ha ganado antes, al final de la Era III gana quien más Gloria haya acumulado (Simposios, Desafíos, Personajes y conquistas de Bolívar).

## Qué está simplificado en esta versión (para que fuera jugable ya)

- **Líderes:** 8 implementados, cada uno con un bonus real en el motor del juego.
- **Regiones:** hay 12 posibles por Era en `data.js` (36 en total); cada partida usa 8 por Era, conectadas al azar, con el mapa político calculado por el servidor (disposición de fuerzas + celdas de Voronoi suavizadas — sin librerías externas). Añadir regiones es añadir una línea.
- **Clases de tropa:** 3 clases con ventaja circular y 3 niveles cada una, iguales en estructura para las 3 Épocas (cambian nombre e icono por Era). Añadir un 4º nivel o variar costes es tocar el array `levels` en `data.js`.
- **Personajes:** cada Era tiene un mazo de 4 (2 con efecto mecánico real, 2 de prestigio que dan +1 Gloria).
- **Desafíos:** 3 implementados que rotan uno por Era.
- **Combate:** dados estilo Risk (hasta 3 atacantes vs 2 defensores) con los bonos de Líder, Personaje, ventaja de clase y nivel de tropa integrados; el atacante deja siempre al menos 1 tropa de guarnición en el origen. El Asedio y la Incursión son duelos a 1 dado (más la ventaja de clase), pensados para desgastar o robar sin jugarse la conquista.
- **Ilustraciones:** por defecto todo funciona con dibujos vectoriales e iconos con marco animado. Hay retratos "pintados" opcionales generados con IA (los 8 Líderes, los 12 Personajes y los 3 monumentos); instrucciones en `public/images/LEEME.md`.

## Verificación

Todo el flujo se probó con una suite automática contra el servidor real: partidas completas de 3 humanos y de 1 humano + 2 bots hasta el final con motivo de victoria válido; reinicio de partida (permisos, reseteo completo incluidos Recursos/niveles/Maravillas, mapa nuevo de 24 provincias); validaciones de mejora de clase y de Maravillas (fondos, clase inexistente, territorio ajeno); el camino feliz de la mejora de clase (colonización real eligiendo la clase con ventaja, coste exacto, aislamiento por jugador); el camino feliz de las Maravillas (acumulación real de Recursos con Mansa Musa, coste exacto, visible para todos, rechazo de duplicada y de sin-fondos); los modos de ataque (asedio real que desgasta exactamente 1 tropa de un solo bando sin cambiar dueños; rechazos de incursión sin origen y sobre territorio neutral); y dos tests de navegador real (Chromium) cubriendo lobby, 8 líderes con los de los bots bloqueados, panel de 3 clases con 9 niveles, vías de victoria, Maravillas, mapa político de 24 provincias con 16 en niebla y sin cuadrícula, toque en provincia para ver su ficha, y persistencia del formulario de órdenes — todo sin errores de consola.

## Estructura del proyecto

```
server.js       → toda la lógica del juego y el servidor, incluido el cálculo del mapa político (sin dependencias externas)
data.js         → regiones, líderes, clases de tropa con niveles, maravillas, personajes y desafíos (aquí se amplía el contenido)
public/index.html → la interfaz — una sola página, funciona en cualquier móvil
public/images/  → ilustraciones opcionales (ver LEEME.md ahí dentro)
package.json
test_*.js       → suite de verificación automática (no hace falta para jugar)
```

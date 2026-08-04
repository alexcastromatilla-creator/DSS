# El Banquete

Juego de conquista, historia y brindis para 2 a 6 jugadores, cada uno desde su móvil — un Civilization de sobremesa con el combate del Risk en el corazón, y la fiesta en el centro.

Cada jugador encarna a un **Líder histórico** (Alejandro Magno, Juana de Arco, Aníbal, Pericles, Zheng He, Mansa Musa, Simón Bolívar o Sun Tzu), cada uno con un bonus permanente. El tablero es un **continente generado al azar en cada partida**, con forma de mapa de verdad: masa continental, penínsulas colgando al sur, islas, estrechos con **rutas marítimas** (línea discontinua, como en el Risk), relieve de costa, terreno pintado (bosques, montañas nevadas, colinas, dunas), ríos que bajan de las montañas y niebla sobre las Eras aún no abiertas. La **Era I empieza en el sur** (el Mediterráneo del mapa) y el continente se va abriendo hacia el norte con las Eras II y III.

Cada Era dura **5 rondas** con **2 Desafíos** de estrategia+bebida (6 desafíos distintos por partida). Hay **8 órdenes** entre las que elegir cada ronda, **3 clases de tropa** con ventajas entre sí, **niveles de tropa mejorables**, **Maravillas**, **matrimonios dinásticos** y **3 formas de ganar**. También puedes jugar contra bots para probarlo sin esperar a tener gente.

## Requisitos

- Node.js 18 o superior (sin dependencias externas: **no hace falta `npm install`**).

## Cómo arrancarlo

```
node server.js
```

Verás `El Banquete escuchando en :3000`. Abre `http://localhost:3000` para comprobar que funciona.

## Cómo jugar desde el móvil

### Opción A — mismo wifi
1. Mira la IP local del ordenador que corre el servidor (`ifconfig` / `ipconfig`, algo como `192.168.1.23`).
2. Con los móviles en el mismo wifi, abrid `http://TU-IP:3000` en cada uno.
3. Uno crea la sala y comparte el código de 4 letras.

### Opción B — enlace permanente (Render)
Sigue **`DEPLOY_RENDER.md`**: dos webs y un rato de clics, sin terminal, y tenéis una URL fija tipo `https://el-banquete.onrender.com` para siempre.

**Plan gratuito de Render:** si nadie usa el servicio ~15 min, se "duerme"; al volver tarda unos segundos y las salas creadas antes de dormirse desaparecen (viven en memoria). No afecta a partidas activas.

## Las 8 órdenes de cada ronda

1. **⚔️ Asalto** — combate a dados estilo Risk contra una provincia vecina (o **colonización** de las provincias que quedan libres en la 1ª ronda de cada Era, eligiendo tú la clase con la que desembarcas). Si aniquilas la guarnición, conquistas y tus supervivientes **marchan** a la nueva provincia.
2. **💣 Asedio** — duelo a 1 dado (la ventaja de clase suma +1): si ganas, la guarnición pierde 1 tropa; si pierdes, la pierdes tú. No conquista: desgasta.
3. **🐎 Incursión** — duelo a 1 dado contra la provincia de un rival: si ganas, le robas hasta 3 Recursos 💰.
4. **🛡️ Reforzar** — mueve tropas de tu reserva a una provincia tuya.
5. **🪙 Levas** — paga 3 💰 y suma 2 tropas a tu reserva.
6. **💍 Matrimonio** — propone una alianza dinástica a otro jugador (ver abajo).
7. **👑 Personaje** — roba una carta histórica del mazo de la Era (César, Gengis Kan, Maquiavelo... 2 de cada 4 con efecto mecánico real).
8. **🕵️ Espiar** — ve el ejército de un rival **y la orden que ha dado esta ronda**.

Aparte, **sin gastar tu orden**: mejorar el nivel de una clase de tropa y construir Maravillas.

## Combate: como en el Risk, y se ve

Atacas desde una provincia tuya (dejando 1 de guarnición). El atacante tira hasta 3 dados (+1 por ventaja de clase, +bonus de nivel/líder), el defensor hasta 2 (+ los suyos). **Los dados se enfrentan de mayor a mayor**, cada duelo mata 1 tropa del perdedor, y el empate favorece al defensor (salvo tropas de élite). Cada batalla se muestra como **escena**: las dos formaciones frente a frente (falange con escudos, arqueros, caballería montada), los dados rodando duelo a duelo con su resultado, y el lazo final de conquista o resistencia. En el mapa, las conquistas se ven con la unidad **marchando** de una provincia a otra, los asedios con 💥, las incursiones con la bolsa 💰 volando y los refuerzos con un "+N".

## Clases de tropa y niveles

3 clases con ventaja circular (+1 dado contra la clase batida): **Infantería** vence a **Caballería**, que vence a **A distancia**, que vence a Infantería. Cambian de nombre por Época (Hoplitas/Hetairoi/Arqueros cretenses → Almogávares/Caballeros/Ballesteros → Mosqueteros/Húsares/Artillería), el rol táctico no. Cada provincia muestra en el mapa su clase de guarnición, para planear contraataques. Cada clase tiene 3 niveles (Recluta → Veterana +1 dado, 8 💰 → De élite +1 dado y gana empates, 16 💰; Sun Tzu paga 2 💰 menos): la mejora es **para siempre y para todas** tus tropas de esa clase.

## Matrimonios dinásticos 💍

Propones matrimonio como orden; el otro jugador acepta o rechaza cuando quiera (sin gastar orden). Si acepta: **todo el grupo brinda por los novios** 🥂, no deberíais atacaros, ambos defendéis con +1 dado y **veis la orden secreta del otro** en cuanto la envía. Rechazar: bebes 1 sorbo por la vergüenza. Atacar a tu cónyuge = **escándalo**: divorcio inmediato, −2 Gloria y 3 sorbos.

## Recursos y Maravillas

Cada provincia da 1 💰 por ronda (Mansa Musa +1). Las **Maravillas** cuestan 15 💰, se construyen en provincias tuyas (una por provincia) y **quedan ligadas a la provincia: si te la conquistan, la Maravilla cambia de dueño**.

## Cómo se gana: conquistando el mapa

**Cada casa empieza la partida con un territorio aleatorio de la Era I** (con 3 tropas) — desde el primer minuto tienes hogar que defender y frontera que expandir.

1. **🗺️ Conquista total** — si al final de cualquier ronda controlas TODOS los territorios abiertos del mapa, ganas al instante.
2. **⚑ Recuento final** — si nadie conquista el mapa entero, al final de la Era III gana quien más territorio controle. Cada **Maravilla 🏛️ hace que su provincia valga doble** en el recuento (y se puede robar conquistando la provincia). Desempates: Gloria 🏆 (Simposios, Desafíos, Personajes, Bolívar) y después Recursos.

El panel "🏆 Vías de victoria" muestra en todo momento la puntuación ⚑ de conquista de cada jugador.

## Reiniciar / salir / bots

Barra superior: código de sala, tus 💰 y Gloria, **🔄 Reiniciar** (anfitrión: mapa nuevo, mismo grupo, misma elección de líderes) y **🚪 Salir**. Al crear sala eliges jugadores totales (2-6) y cuántos bots: los bots eligen líder, usan los tres modos de ataque, colonizan con la clase con ventaja, compran levas, mejoran tropas, construyen Maravillas y hasta se declaran y aceptan bodas.

## Ilustraciones opcionales

Todo funciona con dibujo vectorial propio. Hay retratos "pintados" con IA para los 8 líderes y los 12 personajes (instrucciones y nombres exactos en `public/images/LEEME.md`); si faltan, se usan los iconos con marco dorado.

## Verificación

Suite automática contra el servidor real (10 tests): partidas completas de 3 humanos y de 1 humano + 2 bots hasta el final con motivo de victoria; generador de mapa continental (24 provincias con polígono y terreno, rutas marítimas, Era I al sur, separación mínima entre capitales); reinicio (reseteo completo incluidos matrimonios y Maravillas); validaciones y caminos felices de mejora de clase, Maravillas (coste exacto, duplicada, sin fondos), asedio (desgasta exactamente 1 tropa de un solo bando sin cambiar dueños), incursión (rechazos sobre neutral y sin origen); mecánicas sociales (propuesta, rechazo con sorbo, boda con brindis, ver la orden del cónyuge, escándalo con divorcio, levas con coste exacto y sin fondos); y 2 tests de navegador real cubriendo lobby con 8 líderes, rejilla de 8 órdenes, mapa continental (24 provincias, 5 capas de fondo, rutas marítimas, niebla), paneles de victoria/tropas/Maravillas y persistencia del formulario — todo sin errores de consola.

## Estructura del proyecto

```
server.js         → lógica del juego + generador de mapa continental (sin dependencias)
data.js           → regiones, líderes, clases de tropa, maravillas, personajes, desafíos
public/index.html → interfaz completa — una sola página, funciona en cualquier móvil
public/images/    → ilustraciones opcionales (ver LEEME.md)
test_*.js         → suite de verificación (no hace falta para jugar)
DEPLOY_RENDER.md  → guía de despliegue con enlace permanente
```

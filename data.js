// Datos del juego: pools de regiones (el tablero se genera al azar cada partida),
// tropas por Época (con niveles mejorables), personajes, desafíos y monumentos.

// Pool de posibles regiones por Era — cada partida se eligen 8 al azar de cada pool de 12
// y se generan conexiones (vecindad) también al azar, así el mapa cambia cada vez aunque
// siempre acaba formando una única masa de tierra conectada (ver generateBoard en server.js).
const REGION_POOLS = {
  1: [
    { id: 'atenas', name: 'Atenas', region: 'Grecia', resource: 'sabiduria', icon: '🏛️' },
    { id: 'esparta', name: 'Esparta', region: 'Grecia', resource: 'poder', icon: '🛡️' },
    { id: 'roma', name: 'Roma', region: 'Italia', resource: 'poder', icon: '🦅' },
    { id: 'alejandria', name: 'Alejandría', region: 'Egipto', resource: 'sabiduria', icon: '📚' },
    { id: 'cartago', name: 'Cartago', region: 'Norte de África', resource: 'comercio', icon: '⛵' },
    { id: 'creta', name: 'Creta (Cnosos)', region: 'Creta', resource: 'cultura', icon: '🐂' },
    { id: 'efeso', name: 'Éfeso', region: 'Anatolia', resource: 'sabiduria', icon: '🏺' },
    { id: 'persepolis', name: 'Persépolis', region: 'Persia', resource: 'poder', icon: '🔥' },
    { id: 'siracusa', name: 'Siracusa', region: 'Sicilia', resource: 'comercio', icon: '🌋' },
    { id: 'tebas', name: 'Tebas', region: 'Egipto', resource: 'sabiduria', icon: '🐍' },
    { id: 'rodas', name: 'Rodas', region: 'Grecia', resource: 'poder', icon: '⚓' },
    { id: 'gades', name: 'Gades (Cádiz)', region: 'Iberia', resource: 'cultura', icon: '🐚' },
  ],
  2: [
    { id: 'bagdad', name: 'Bagdad', region: 'Mesopotamia', resource: 'sabiduria', icon: '🕌' },
    { id: 'cordoba', name: 'Córdoba', region: 'Al-Ándalus', resource: 'cultura', icon: '🌙' },
    { id: 'samarcanda', name: 'Samarcanda', region: 'Asia Central', resource: 'comercio', icon: '🐫' },
    { id: 'changan', name: "Chang'an", region: 'China', resource: 'comercio', icon: '🏮' },
    { id: 'constantinopla', name: 'Constantinopla', region: 'Bizancio', resource: 'poder', icon: '⚜️' },
    { id: 'delhi', name: 'Delhi', region: 'India', resource: 'sabiduria', icon: '🐘' },
    { id: 'kioto', name: 'Kioto', region: 'Japón', resource: 'cultura', icon: '⛩️' },
    { id: 'tombuctu', name: 'Tombuctú', region: 'Malí', resource: 'sabiduria', icon: '📖' },
    { id: 'isfahan', name: 'Isfahán', region: 'Persia', resource: 'cultura', icon: '🌷' },
    { id: 'cairo', name: 'El Cairo', region: 'Egipto', resource: 'comercio', icon: '🐪' },
    { id: 'novgorod', name: 'Nóvgorod', region: 'Rus de Kiev', resource: 'sabiduria', icon: '🛶' },
    { id: 'mogadiscio', name: 'Mogadiscio', region: 'Cuerno de África', resource: 'poder', icon: '🌴' },
  ],
  3: [
    { id: 'florencia', name: 'Florencia', region: 'Italia', resource: 'cultura', icon: '🎨' },
    { id: 'paris', name: 'París', region: 'Francia', resource: 'cultura', icon: '⚜️' },
    { id: 'tenochtitlan', name: 'Tenochtitlan', region: 'Imperio Azteca', resource: 'poder', icon: '🌞' },
    { id: 'potosi', name: 'Potosí', region: 'Imperio Inca', resource: 'comercio', icon: '⛰️' },
    { id: 'londres', name: 'Londres', region: 'Inglaterra', resource: 'comercio', icon: '👑' },
    { id: 'amsterdam', name: 'Ámsterdam', region: 'Provincias Unidas', resource: 'comercio', icon: '🚢' },
    { id: 'lisboa', name: 'Lisboa', region: 'Portugal', resource: 'comercio', icon: '🧭' },
    { id: 'cusco', name: 'Cusco', region: 'Imperio Inca', resource: 'poder', icon: '☀️' },
    { id: 'venecia', name: 'Venecia', region: 'Italia', resource: 'comercio', icon: '🌊' },
    { id: 'viena', name: 'Viena', region: 'Sacro Imperio', resource: 'poder', icon: '🎻' },
    { id: 'petersburgo', name: 'San Petersburgo', region: 'Rusia', resource: 'cultura', icon: '❄️' },
    { id: 'bahia', name: 'Salvador de Bahía', region: 'Brasil colonial', resource: 'poder', icon: '🥁' },
  ],
};

// Cuántos territorios de cada pool se abren por Era (24 en total). Ver server.js#generateBoard.
const TERRITORIES_PER_ERA = 8;

const ERA_INFO = [
  null,
  {
    titulo: 'Era I — El Mediterráneo Antiguo',
    flavor: 'Grecia discute, Roma construye legiones y Egipto atesora el saber del mundo conocido. La partida por la Antigüedad clásica empieza ahora — el mapa de esta partida es nuevo, nadie lo ha jugado antes.',
    monumento: 'monumento_era1.png',
  },
  {
    titulo: 'Era II — Las Rutas de Oriente',
    flavor: 'Se abren las Rutas de la Seda: nuevas ciudades conectan el Mediterráneo con Asia y África. El comercio y el saber valen tanto como las armas.',
    monumento: 'monumento_era2.png',
  },
  {
    titulo: 'Era III — Europa Moderna y el Nuevo Mundo',
    flavor: 'Europa vive el Renacimiento y la Ilustración, mientras el Atlántico se abre hacia el Nuevo Mundo. La última campaña decide la Gloria.',
    monumento: 'monumento_era3.png',
  },
];

// Tropas por Época: cambian de nombre e icono, y los territorios abiertos en Épocas más
// tardías empiezan con más guarnición. Cada tipo de tropa tiene 3 niveles — se mejoran para
// SIEMPRE (toda tropa de ese tipo, la que ya tienes y la que consigas después) gastando
// Recursos (ver server.js: cada territorio que controlas genera 1 Recurso por ronda).
const TROOP_TYPES = {
  1: {
    singular: 'legión', plural: 'legiones', icon: '🛡️', garrison: 2,
    levels: [
      { level: 1, name: 'Legión', desc: 'Dados de combate normales (hasta 3 al atacar, hasta 2 al defender).', diceBonus: 0, winsTies: false, cost: 0 },
      { level: 2, name: 'Legión veterana', desc: '+1 dado extra tanto al atacar como al defender.', diceBonus: 1, winsTies: false, cost: 8 },
      { level: 3, name: 'Legión de élite', desc: 'Igual que veterana, y además gana los empates en combate (normalmente los gana quien defiende).', diceBonus: 1, winsTies: true, cost: 16 },
    ],
  },
  2: {
    singular: 'jinete', plural: 'jinetes', icon: '🐎', garrison: 3,
    levels: [
      { level: 1, name: 'Jinete', desc: 'Dados de combate normales (hasta 3 al atacar, hasta 2 al defender).', diceBonus: 0, winsTies: false, cost: 0 },
      { level: 2, name: 'Jinete veterano', desc: '+1 dado extra tanto al atacar como al defender.', diceBonus: 1, winsTies: false, cost: 8 },
      { level: 3, name: 'Jinete de élite', desc: 'Igual que veterano, y además gana los empates en combate.', diceBonus: 1, winsTies: true, cost: 16 },
    ],
  },
  3: {
    singular: 'regimiento', plural: 'regimientos', icon: '🔫', garrison: 4,
    levels: [
      { level: 1, name: 'Regimiento', desc: 'Dados de combate normales (hasta 3 al atacar, hasta 2 al defender).', diceBonus: 0, winsTies: false, cost: 0 },
      { level: 2, name: 'Regimiento veterano', desc: '+1 dado extra tanto al atacar como al defender.', diceBonus: 1, winsTies: false, cost: 8 },
      { level: 3, name: 'Regimiento de élite', desc: 'Igual que veterano, y además gana los empates en combate.', diceBonus: 1, winsTies: true, cost: 16 },
    ],
  },
};

const ARCHETYPES = {
  filosofo: { name: 'El Filósofo', desc: '+1 dado siempre que defiendes un territorio.', icon: '🦉', color: '#8e7cc3' },
  estratega: { name: 'El Estratega', desc: 'Al Espiar, además de ver el ejército rival, ganas 1 legión extra de reserva.', icon: '♟️', color: '#4cb8a0' },
  diplomatico: { name: 'El Diplomático', desc: 'Cuando ganas un Desafío de votación, tu recompensa de Gloria se duplica.', icon: '🕊️', color: '#e1a940' },
  explorador: { name: 'El Explorador', desc: 'En la 1ª ronda de cada Era (conquistas de territorio neutral), +1 dado atacante.', icon: '🧭', color: '#5aa9e6' },
  guerrero: { name: 'El Guerrero', desc: 'Siempre pierdes 1 legión menos en combate (mínimo 0).', icon: '⚔️', color: '#e15757' },
  comerciante: { name: 'El Comerciante', desc: 'Al Reforzar un territorio, añades 1 legión extra gratis.', icon: '⚖️', color: '#c98a3e' },
};

const BOT_NAMES = ['Pericles', 'Boudica', 'Atila', 'Nefertiti', 'Zenobia', 'Amanirenas', 'Wu Zetian', 'Saladino'];

// Mazos de personajes por Era. Los marcados con "coded" tienen efecto mecánico real.
// "portrait" apunta a la ilustración en public/images/.
const CHARACTER_DECKS = {
  1: [
    { id: 'cesar', name: 'Julio César', region: 'Roma', icon: '🏛️', portrait: 'cesar.png', flavor: 'Al reclutarlo, robas 1 legión de un territorio rival (si existe).', coded: 'steal_army' },
    { id: 'diogenes', name: 'Diógenes de Sinope', region: 'Grecia', icon: '🏺', portrait: 'diogenes.png', flavor: 'Una vez por partida, ignoras la primera derrota en combate sin perder legiones.', coded: 'shield_once' },
    { id: 'cleopatra', name: 'Cleopatra VII', region: 'Egipto', icon: '👑', portrait: 'cleopatra.png', flavor: 'Carta de prestigio: +1 Gloria al final de la partida.', coded: null },
    { id: 'hipatia', name: 'Hipatia de Alejandría', region: 'Egipto', icon: '📜', portrait: 'hipatia.png', flavor: 'Carta de prestigio: +1 Gloria al final de la partida.', coded: null },
  ],
  2: [
    { id: 'gengis', name: 'Genghis Khan', region: 'Estepas', icon: '🏹', portrait: 'gengis.png', flavor: 'Al reclutarlo, cada rival pierde 1 legión de su territorio más débil.', coded: 'weaken_rivals' },
    { id: 'avicena', name: 'Avicena (Ibn Sina)', region: 'Persia', icon: '⚗️', portrait: 'avicena.png', flavor: '+1 dado permanente al defender (se acumula con El Filósofo).', coded: 'extra_defense_die' },
    { id: 'marcopolo', name: 'Marco Polo', region: 'Venecia / Asia', icon: '🐫', portrait: 'marcopolo.png', flavor: 'Carta de prestigio: +1 Gloria al final de la partida.', coded: null },
    { id: 'confucio', name: 'Confucio', region: 'China', icon: '🎋', portrait: 'confucio.png', flavor: 'Carta de prestigio: +1 Gloria al final de la partida.', coded: null },
  ],
  3: [
    { id: 'maquiavelo', name: 'Nicolás Maquiavelo', region: 'Italia', icon: '🎭', portrait: 'maquiavelo.png', flavor: 'Tus órdenes nunca pueden ser reveladas por un Espía rival.', coded: 'order_hidden' },
    { id: 'isabel', name: 'Isabel I de Castilla', region: 'España', icon: '⛵', portrait: 'isabel.png', flavor: 'Al final de la partida, tus territorios de la Era III valen doble Gloria.', coded: 'double_era3_score' },
    { id: 'voltaire', name: 'Voltaire', region: 'Francia', icon: '🖋️', portrait: 'voltaire.png', flavor: 'Carta de prestigio: +1 Gloria al final de la partida.', coded: null },
    { id: 'moctezuma', name: 'Moctezuma II', region: 'Imperio Azteca', icon: '🪶', portrait: 'moctezuma.png', flavor: 'Carta de prestigio: +1 Gloria al final de la partida.', coded: null },
  ],
};

// Desafíos: se dispara 1 por Era (tras la 2ª ronda). Se cicla por tipo.
const DESAFIOS = [
  {
    id: 'prisionero',
    tipo: 'eleccion_secreta',
    titulo: 'El Dilema del Prisionero Espartano',
    texto: 'En secreto, elige Lealtad o Traición respecto a la alianza. Si los tres sois leales, todos ganáis 1 Gloria y nadie bebe. Si hay algún traidor, cada traidor gana 2 Gloria y cada leal bebe 1 sorbo.',
    opciones: ['Lealtad', 'Traición'],
  },
  {
    id: 'anibal',
    tipo: 'riesgo',
    titulo: 'La Encrucijada de Aníbal',
    texto: 'Elige en secreto tu ruta. "Por los Alpes" es alto riesgo: si sale bien (dado 4+), ganas 3 Gloria; si sale mal, pierdes 1 legión y bebes 2 sorbos. "Por mar" es segura: siempre ganas 1 Gloria.',
    opciones: ['Por los Alpes (riesgo)', 'Por mar (seguro)'],
  },
  {
    id: 'debate',
    tipo: 'votacion',
    titulo: 'El Debate de Atenas',
    texto: '¿Es más justo un rey sabio o una asamblea de ciudadanos? Defended vuestra postura en voz alta 30 segundos cada uno y votad quién ha argumentado mejor (no podéis votaros a vosotros mismos).',
    opciones: [],
  },
];

module.exports = { REGION_POOLS, TERRITORIES_PER_ERA, ERA_INFO, TROOP_TYPES, ARCHETYPES, CHARACTER_DECKS, DESAFIOS, BOT_NAMES };

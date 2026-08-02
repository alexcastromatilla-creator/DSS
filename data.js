// Datos del juego: pools de regiones (el tablero se genera al azar cada partida), líderes
// históricos jugables, clases de tropa con ventajas entre sí, maravillas, personajes y desafíos.

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

// ---------------------------------------------------------------------------
// CLASES DE TROPA — 3 clases con ventaja circular (piedra-papel-tijera):
//   Infantería vence a Caballería (muros de picas y escudos),
//   Caballería vence a los tiradores A distancia (los arrolla antes de recargar),
//   A distancia vence a Infantería (la acribilla desde lejos).
// La ventaja da +1 dado en combate contra la clase batida (atacando y defendiendo).
// Cada clase cambia de nombre e icono según la Época (Hoplitas → Almogávares → Mosqueteros...)
// pero su rol táctico y su nivel de mejora son los mismos toda la partida: los niveles se
// compran POR CLASE y valen para todas las Épocas (tecnología compartida).
// Cada territorio tiene UNA clase de guarnición (visible en el mapa): al colonizar un territorio
// libre eliges con qué clase lo ocupas; al conquistar, tus tropas llevan la clase del territorio
// desde el que atacas.
// ---------------------------------------------------------------------------
const TROOP_CLASSES = {
  inf: {
    key: 'inf',
    clase: 'Infantería',
    beats: 'cab',
    tacticaDesc: 'Vence a la Caballería: sus picas y escudos frenan cualquier carga (+1 dado contra ella).',
    byEra: {
      1: { name: 'Hoplitas', icon: '🛡️' },
      2: { name: 'Almogávares', icon: '⚔️' },
      3: { name: 'Mosqueteros', icon: '🔫' },
    },
    levels: [
      { level: 1, name: 'Recluta', desc: 'Dados de combate normales (hasta 3 al atacar, hasta 2 al defender).', diceBonus: 0, winsTies: false, cost: 0 },
      { level: 2, name: 'Veterana', desc: '+1 dado extra tanto al atacar como al defender.', diceBonus: 1, winsTies: false, cost: 8 },
      { level: 3, name: 'De élite', desc: 'Igual que Veterana, y además gana los empates en combate (normalmente los gana quien defiende).', diceBonus: 1, winsTies: true, cost: 16 },
    ],
  },
  cab: {
    key: 'cab',
    clase: 'Caballería',
    beats: 'arq',
    tacticaDesc: 'Vence a las tropas A distancia: las arrolla antes de que recarguen (+1 dado contra ellas).',
    byEra: {
      1: { name: 'Hetairoi', icon: '🐎' },
      2: { name: 'Caballeros', icon: '🏇' },
      3: { name: 'Húsares', icon: '🐎' },
    },
    levels: [
      { level: 1, name: 'Recluta', desc: 'Dados de combate normales (hasta 3 al atacar, hasta 2 al defender).', diceBonus: 0, winsTies: false, cost: 0 },
      { level: 2, name: 'Veterana', desc: '+1 dado extra tanto al atacar como al defender.', diceBonus: 1, winsTies: false, cost: 8 },
      { level: 3, name: 'De élite', desc: 'Igual que Veterana, y además gana los empates en combate (normalmente los gana quien defiende).', diceBonus: 1, winsTies: true, cost: 16 },
    ],
  },
  arq: {
    key: 'arq',
    clase: 'A distancia',
    beats: 'inf',
    tacticaDesc: 'Vence a la Infantería: la acribilla desde lejos antes del choque (+1 dado contra ella).',
    byEra: {
      1: { name: 'Arqueros cretenses', icon: '🏹' },
      2: { name: 'Ballesteros', icon: '🏹' },
      3: { name: 'Artillería', icon: '💣' },
    },
    levels: [
      { level: 1, name: 'Recluta', desc: 'Dados de combate normales (hasta 3 al atacar, hasta 2 al defender).', diceBonus: 0, winsTies: false, cost: 0 },
      { level: 2, name: 'Veterana', desc: '+1 dado extra tanto al atacar como al defender.', diceBonus: 1, winsTies: false, cost: 8 },
      { level: 3, name: 'De élite', desc: 'Igual que Veterana, y además gana los empates en combate (normalmente los gana quien defiende).', diceBonus: 1, winsTies: true, cost: 16 },
    ],
  },
};
const TROOP_CLASS_KEYS = ['inf', 'cab', 'arq'];

// Guarnición inicial de los territorios neutrales según la Era en la que se abren.
const ERA_GARRISON = { 1: 2, 2: 3, 3: 4 };

// ---------------------------------------------------------------------------
// LÍDERES HISTÓRICOS jugables (como elegir civilización en Civilization): cada jugador
// encarna a un líder con un bonus permanente propio. "portrait" apunta a la ilustración
// en public/images/ (si falta, la interfaz enseña el icono con el mismo marco de cuadro).
// ---------------------------------------------------------------------------
const LEADERS = {
  alejandro: {
    name: 'Alejandro Magno', title: 'El Conquistador', icon: '🗡️', color: '#e15757', portrait: 'lider_alejandro.png',
    desc: 'Rey de Macedonia, invicto de Grecia al Indo. Pierdes 1 tropa menos en cada combate (mínimo 0).',
  },
  juana: {
    name: 'Juana de Arco', title: 'La Guardiana', icon: '⚔️', color: '#5aa9e6', portrait: 'lider_juana.png',
    desc: 'La doncella de Orleans, imbatible tras una muralla. +1 dado siempre que defiendes un territorio.',
  },
  anibal: {
    name: 'Aníbal Barca', title: 'El Táctico', icon: '🐘', color: '#b06ee0', portrait: 'lider_anibal.png',
    desc: 'El general que cruzó los Alpes. Al Espiar, además de ver el ejército rival, ganas 1 tropa de reserva.',
  },
  pericles: {
    name: 'Pericles', title: 'El Orador', icon: '🏛️', color: '#e1a940', portrait: 'lider_pericles.png',
    desc: 'La voz de oro de Atenas. Cuando ganas un Desafío de votación, tu recompensa de Gloria se duplica.',
  },
  zhenghe: {
    name: 'Zheng He', title: 'El Navegante', icon: '⛵', color: '#4cb8a0', portrait: 'lider_zhenghe.png',
    desc: 'Almirante de la flota del tesoro Ming. +1 dado al colonizar territorios libres (1ª ronda de cada Era).',
  },
  mansamusa: {
    name: 'Mansa Musa', title: 'El Áureo', icon: '👑', color: '#c98a3e', portrait: 'lider_mansamusa.png',
    desc: 'El hombre más rico de la historia. +1 Recurso extra al final de cada ronda.',
  },
  bolivar: {
    name: 'Simón Bolívar', title: 'El Libertador', icon: '🎖️', color: '#6ee0a8', portrait: 'lider_bolivar.png',
    desc: 'Libertador de seis naciones. +1 Gloria cada vez que conquistas un territorio de un rival.',
  },
  suntzu: {
    name: 'Sun Tzu', title: 'El Maestro', icon: '📜', color: '#8e7cc3', portrait: 'lider_suntzu.png',
    desc: 'Autor de "El arte de la guerra". Mejorar el nivel de tus tropas te cuesta 2 Recursos menos.',
  },
};

// ---------------------------------------------------------------------------
// MARAVILLAS — la vía de victoria cultural: se construyen gastando Recursos en un territorio
// propio (una por territorio). ¡Cuidado! La maravilla pertenece al territorio: si te lo
// conquistan, la maravilla cambia de dueño. Controlar 3 a la vez = victoria por Cultura.
// ---------------------------------------------------------------------------
const WONDERS = [
  { id: 'partenon', name: 'El Partenón', icon: '🏛️' },
  { id: 'coloso', name: 'El Coloso de Rodas', icon: '🗿' },
  { id: 'biblioteca', name: 'La Gran Biblioteca', icon: '📜' },
  { id: 'muralla', name: 'La Gran Muralla', icon: '🧱' },
  { id: 'santasofia', name: 'Santa Sofía', icon: '🕌' },
  { id: 'alhambra', name: 'La Alhambra', icon: '🌙' },
  { id: 'angkor', name: 'Angkor Wat', icon: '🛕' },
  { id: 'machupicchu', name: 'Machu Picchu', icon: '⛰️' },
  { id: 'sanpedro', name: 'La Basílica de San Pedro', icon: '⛪' },
  { id: 'versalles', name: 'El Palacio de Versalles', icon: '👑' },
];
const WONDER_COST = 15;
const WONDERS_TO_WIN = 3;

// Victoria por Dominación: controlar esta fracción de los territorios ABIERTOS al final
// de cualquier ronda (con 8 abiertos → 5, con 16 → 10, con 24 → 15).
const DOMINATION_RATIO = 0.6;

const BOT_NAMES = ['Boudica', 'Atila', 'Nefertiti', 'Zenobia', 'Amanirenas', 'Wu Zetian', 'Ramsés II', 'Carlomagno'];

// Mazos de personajes por Era. Los marcados con "coded" tienen efecto mecánico real.
// "portrait" apunta a la ilustración en public/images/.
const CHARACTER_DECKS = {
  1: [
    { id: 'cesar', name: 'Julio César', region: 'Roma', icon: '🏛️', portrait: 'cesar.png', flavor: 'Al reclutarlo, robas 1 tropa de un territorio rival (si existe).', coded: 'steal_army' },
    { id: 'diogenes', name: 'Diógenes de Sinope', region: 'Grecia', icon: '🏺', portrait: 'diogenes.png', flavor: 'Una vez por partida, ignoras la primera derrota en combate sin perder tropas.', coded: 'shield_once' },
    { id: 'cleopatra', name: 'Cleopatra VII', region: 'Egipto', icon: '👑', portrait: 'cleopatra.png', flavor: 'Carta de prestigio: +1 Gloria al final de la partida.', coded: null },
    { id: 'hipatia', name: 'Hipatia de Alejandría', region: 'Egipto', icon: '📜', portrait: 'hipatia.png', flavor: 'Carta de prestigio: +1 Gloria al final de la partida.', coded: null },
  ],
  2: [
    { id: 'gengis', name: 'Genghis Khan', region: 'Estepas', icon: '🏹', portrait: 'gengis.png', flavor: 'Al reclutarlo, cada rival pierde 1 tropa de su territorio más débil.', coded: 'weaken_rivals' },
    { id: 'avicena', name: 'Avicena (Ibn Sina)', region: 'Persia', icon: '⚗️', portrait: 'avicena.png', flavor: '+1 dado permanente al defender (se acumula con La Guardiana).', coded: 'extra_defense_die' },
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
    texto: 'Elige en secreto tu ruta. "Por los Alpes" es alto riesgo: si sale bien (dado 4+), ganas 3 Gloria; si sale mal, pierdes 1 tropa y bebes 2 sorbos. "Por mar" es segura: siempre ganas 1 Gloria.',
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

module.exports = {
  REGION_POOLS, TERRITORIES_PER_ERA, ERA_INFO,
  TROOP_CLASSES, TROOP_CLASS_KEYS, ERA_GARRISON,
  LEADERS, WONDERS, WONDER_COST, WONDERS_TO_WIN, DOMINATION_RATIO,
  CHARACTER_DECKS, DESAFIOS, BOT_NAMES,
};

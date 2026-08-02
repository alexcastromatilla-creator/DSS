// Datos del juego: territorios, personajes, trivia y desafíos.

const TERRITORIES = {
  atenas:       { name: 'Atenas',        era: 1, region: 'Grecia',           resource: 'sabiduria', neighbors: ['esparta', 'alejandria'] },
  esparta:      { name: 'Esparta',       era: 1, region: 'Grecia',           resource: 'poder',      neighbors: ['atenas', 'roma'] },
  roma:         { name: 'Roma',          era: 1, region: 'Italia',           resource: 'poder',      neighbors: ['esparta', 'alejandria', 'florencia'] },
  alejandria:   { name: 'Alejandría',    era: 1, region: 'Egipto',           resource: 'sabiduria', neighbors: ['atenas', 'roma', 'bagdad'] },

  bagdad:       { name: 'Bagdad',        era: 2, region: 'Mesopotamia',      resource: 'sabiduria', neighbors: ['alejandria', 'samarcanda'] },
  cordoba:      { name: 'Córdoba',       era: 2, region: 'Al-Ándalus',       resource: 'cultura',    neighbors: ['roma', 'tenochtitlan'] },
  samarcanda:   { name: 'Samarcanda',    era: 2, region: 'Asia Central',     resource: 'comercio',   neighbors: ['bagdad', 'changan'] },
  changan:      { name: "Chang'an",      era: 2, region: 'China',           resource: 'comercio',   neighbors: ['samarcanda'] },

  florencia:    { name: 'Florencia',     era: 3, region: 'Italia',           resource: 'cultura',    neighbors: ['roma', 'paris'] },
  paris:        { name: 'París',         era: 3, region: 'Francia',         resource: 'cultura',    neighbors: ['florencia', 'tenochtitlan'] },
  tenochtitlan: { name: 'Tenochtitlan',  era: 3, region: 'Imperio Azteca',   resource: 'poder',      neighbors: ['cordoba', 'paris', 'potosi'] },
  potosi:       { name: 'Potosí',        era: 3, region: 'Imperio Inca',     resource: 'comercio',   neighbors: ['tenochtitlan'] },
};

const ERA_INFO = [
  null,
  { titulo: 'Era I — El Mediterráneo Antiguo', flavor: 'Atenas discute, Esparta entrena, Roma construye legiones y Alejandría atesora el saber del mundo conocido. La partida por la Antigüedad clásica empieza ahora.' },
  { titulo: 'Era II — Las Rutas de Oriente', flavor: 'Se abren las Rutas de la Seda: Bagdad, Córdoba, Samarcanda y Chang\'an conectan el Mediterráneo con Asia. El comercio y el saber valen tanto como las armas.' },
  { titulo: 'Era III — Europa Moderna y el Nuevo Mundo', flavor: 'Florencia y París viven el Renacimiento y la Ilustración, mientras el Atlántico se abre hacia Tenochtitlan y Potosí. La última campaña decide la Gloria.' },
];

const ARCHETYPES = {
  filosofo: { name: 'El Filósofo', desc: '+1 dado siempre que defiendes un territorio.' },
  estratega: { name: 'El Estratega', desc: 'Al Espiar, además de ver el ejército rival, ganas 1 legión extra de reserva.' },
  diplomatico: { name: 'El Diplomático', desc: 'Cuando ganas un Desafío de votación, tu recompensa de Gloria se duplica.' },
};

// Mazos de personajes por Era. Los marcados con "coded" tienen efecto mecánico real.
const CHARACTER_DECKS = {
  1: [
    { id: 'cesar', name: 'Julio César', region: 'Roma', flavor: 'Al reclutarlo, robas 1 legión de un territorio rival (si existe).', coded: 'steal_army' },
    { id: 'diogenes', name: 'Diógenes de Sinope', region: 'Grecia', flavor: 'Una vez por partida, ignoras la primera derrota en combate sin perder legiones.', coded: 'shield_once' },
    { id: 'cleopatra', name: 'Cleopatra VII', region: 'Egipto', flavor: 'Carta de prestigio: +1 Gloria al final de la partida.', coded: null },
    { id: 'hipatia', name: 'Hipatia de Alejandría', region: 'Egipto', flavor: 'Carta de prestigio: +1 Gloria al final de la partida.', coded: null },
  ],
  2: [
    { id: 'gengis', name: 'Genghis Khan', region: 'Estepas', flavor: 'Al reclutarlo, cada rival pierde 1 legión de su territorio más débil.', coded: 'weaken_rivals' },
    { id: 'avicena', name: 'Avicena (Ibn Sina)', region: 'Persia', flavor: '+1 dado permanente al defender (se acumula con El Filósofo).', coded: 'extra_defense_die' },
    { id: 'marcopolo', name: 'Marco Polo', region: 'Venecia / Asia', flavor: 'Carta de prestigio: +1 Gloria al final de la partida.', coded: null },
    { id: 'confucio', name: 'Confucio', region: 'China', flavor: 'Carta de prestigio: +1 Gloria al final de la partida.', coded: null },
  ],
  3: [
    { id: 'maquiavelo', name: 'Nicolás Maquiavelo', region: 'Italia', flavor: 'Tus órdenes nunca pueden ser reveladas por un Espía rival.', coded: 'order_hidden' },
    { id: 'isabel', name: 'Isabel I de Castilla', region: 'España', flavor: 'Al final de la partida, tus territorios de la Era III valen doble Gloria.', coded: 'double_era3_score' },
    { id: 'voltaire', name: 'Voltaire', region: 'Francia', flavor: 'Carta de prestigio: +1 Gloria al final de la partida.', coded: null },
    { id: 'moctezuma', name: 'Moctezuma II', region: 'Imperio Azteca', flavor: 'Carta de prestigio: +1 Gloria al final de la partida.', coded: null },
  ],
};

const TRIVIA = {
  1: [
    { q: '¿Qué filósofo ateniense fue condenado a beber cicuta?', options: ['Sócrates', 'Platón', 'Aristóteles', 'Pitágoras'], correct: 0 },
    { q: '¿Cómo se llama el sistema de gobierno ateniense basado en la participación directa de los ciudadanos?', options: ['Democracia directa', 'Oligarquía', 'Tiranía', 'República federal'], correct: 0 },
    { q: '¿En qué batalla resistieron los 300 espartanos de Leónidas al ejército persa?', options: ['Maratón', 'Salamina', 'Termópilas', 'Platea'], correct: 2 },
    { q: '"El Banquete" de Platón trata, en el fondo, sobre...', options: ['La guerra', 'El amor', 'La economía', 'La agricultura'], correct: 1 },
    { q: '¿Qué emperador dividió el Imperio romano en una Tetrarquía?', options: ['Constantino', 'Diocleciano', 'Nerón', 'Adriano'], correct: 1 },
  ],
  2: [
    { q: '¿Qué ruta comercial conectaba China con el Mediterráneo?', options: ['Ruta de la Seda', 'Ruta de las Especias', 'Camino de Santiago', 'Ruta del Ámbar'], correct: 0 },
    { q: '¿Cómo se llamaba la institución de traducción y estudio fundada en Bagdad en el siglo VIII?', options: ['Biblioteca de Alejandría', 'Casa de la Sabiduría', 'Academia de Platón', 'Museion'], correct: 1 },
    { q: '¿Qué imperio, el más extenso en territorio contiguo de la historia, fundó Genghis Khan?', options: ['Imperio Otomano', 'Imperio Persa', 'Imperio Mongol', 'Imperio Bizantino'], correct: 2 },
    { q: '¿Qué viajero veneciano narró su viaje a la corte del Gran Kan?', options: ['Marco Polo', 'Ibn Battuta', 'Vasco da Gama', 'Américo Vespucio'], correct: 0 },
    { q: '¿Qué califato tuvo su capital en Córdoba durante Al-Ándalus?', options: ['Califato Abasí', 'Califato Omeya de Córdoba', 'Califato Fatimí', 'Sultanato de Delhi'], correct: 1 },
  ],
  3: [
    { q: '¿Quién pintó "La Gioconda" y diseñó también máquinas voladoras?', options: ['Miguel Ángel', 'Rafael', 'Leonardo da Vinci', 'Botticelli'], correct: 2 },
    { q: '¿Qué obra de Maquiavelo explica cómo debe gobernar un príncipe?', options: ['El Príncipe', 'Utopía', 'El Leviatán', 'Los Discursos'], correct: 0 },
    { q: '¿En qué año llegó Cristóbal Colón a América?', options: ['1492', '1453', '1521', '1488'], correct: 0 },
    { q: '¿Qué filósofo ilustrado defendió la separación de poderes en "El espíritu de las leyes"?', options: ['Voltaire', 'Rousseau', 'Montesquieu', 'Diderot'], correct: 2 },
    { q: '¿Cómo se llamaba el imperio mesoamericano gobernado por Moctezuma II?', options: ['Imperio Inca', 'Imperio Azteca', 'Imperio Maya', 'Imperio Tolteca'], correct: 1 },
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

module.exports = { TERRITORIES, ERA_INFO, ARCHETYPES, CHARACTER_DECKS, TRIVIA, DESAFIOS };

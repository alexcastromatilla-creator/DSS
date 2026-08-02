// El Banquete — servidor sin dependencias externas: Node.js puro (http + Server-Sent Events).
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const {
  REGION_POOLS, TERRITORIES_PER_ERA, ERA_INFO,
  TROOP_CLASSES, TROOP_CLASS_KEYS, ERA_GARRISON,
  LEADERS, WONDERS, WONDER_COST, WONDERS_TO_WIN, DOMINATION_RATIO,
  CHARACTER_DECKS, DESAFIOS, BOT_NAMES,
} = require('./data');

// Tamaño del lienzo en el que se calculan las coordenadas x,y y los polígonos de cada territorio.
// El cliente usa exactamente este mismo tamaño como viewBox del mapa SVG.
const MAP_W = 320;
const MAP_H = 380;

// Estos tiempos ya NO se muestran al jugador (el contador visible se quitó porque
// se buggeaba) — son solo una red de seguridad interna para que una partida nunca
// se quede colgada del todo si alguien no responde.
const ORDERS_TIME = 180000;
const DESAFIO_TIME = 90000;
const PUBLIC_DIR = path.join(__dirname, 'public');
const LEADER_KEYS = Object.keys(LEADERS);
const MIN_PLAYERS = 2;
const MAX_PLAYERS = 6;
// Retardo con el que "piensan" los bots, para que no se sienta instantáneo ni lento.
const BOT_MIN_DELAY = 700;
const BOT_MAX_DELAY = 2600;

const rooms = {};        // code -> room
const playerRoom = {};   // playerId -> room code
const sseClients = new Map(); // playerId -> http.ServerResponse

// ---------- utilidades ----------

function roll(n) {
  const out = [];
  for (let i = 0; i < n; i++) out.push(1 + Math.floor(Math.random() * 6));
  return out.sort((a, b) => b - a);
}

function makeCode() {
  const letters = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  let code;
  do {
    code = Array.from({ length: 4 }, () => letters[Math.floor(Math.random() * letters.length)]).join('');
  } while (rooms[code]);
  return code;
}

function newId() {
  return crypto.randomBytes(8).toString('hex');
}

function makePlayer(id, name, isBot) {
  return {
    id, name: name.slice(0, 20), leader: null, reserve: 0, gloria: 0, characters: [], shield: false, isBot: !!isBot,
    resources: 0, troopLevels: { inf: 1, cab: 1, arq: 1 },
  };
}

function botDelay() {
  return BOT_MIN_DELAY + Math.random() * (BOT_MAX_DELAY - BOT_MIN_DELAY);
}

function addBots(room, count) {
  const usedNames = new Set(room.players.map((p) => p.name));
  const namePool = [...BOT_NAMES].sort(() => Math.random() - 0.5);
  const leaderPool = [...LEADER_KEYS].sort(() => Math.random() - 0.5);
  let leaderIdx = 0;
  for (let i = 0; i < count; i++) {
    const id = 'bot_' + newId();
    let name = namePool.find((n) => !usedNames.has(n)) || `Bot ${i + 1}`;
    usedNames.add(name);
    const bot = makePlayer(id, name, true);
    // Los bots eligen un líder que ningún otro jugador (humano o bot) tenga ya cogido.
    while (leaderIdx < leaderPool.length && room.players.some((p) => p.leader === leaderPool[leaderIdx])) leaderIdx++;
    bot.leader = leaderPool[leaderIdx % leaderPool.length];
    leaderIdx++;
    room.players.push(bot);
    playerRoom[id] = room.code;
  }
}

function shuffle(arr) { return [...arr].sort(() => Math.random() - 0.5); }

function connectTerritories(territories, aId, bId) {
  if (aId === bId) return;
  if (!territories[aId].neighbors.includes(bId)) territories[aId].neighbors.push(bId);
  if (!territories[bId].neighbors.includes(aId)) territories[bId].neighbors.push(aId);
}

// Coloca cada territorio en (x,y) con un layout de fuerzas: todos los nodos se repelen entre sí
// (como cargas iguales) y cada arista de vecindad tira como un muelle hacia una longitud ideal.
// Tras unos cientos de iteraciones, un grafo conectado como el nuestro (árbol por Era + puentes
// entre Eras) siempre acaba formando una única mancha orgánica y sin agujeros — ahí es donde nace
// la forma de "país" del mapa, sin tener que dibujar ninguna costa a mano. Se calcula una sola vez
// al generar el tablero.
function layoutTerritories(territories, W, H) {
  const ids = Object.keys(territories);
  const n = ids.length;
  if (!n) return;
  const pos = {};
  ids.forEach((id, i) => {
    const angle = (i / n) * Math.PI * 2;
    const radius = Math.min(W, H) * 0.26;
    pos[id] = { x: W / 2 + Math.cos(angle) * radius, y: H / 2 + Math.sin(angle) * radius };
  });
  const vel = {};
  ids.forEach((id) => { vel[id] = { x: 0, y: 0 }; });

  const REPULSION = 1100;
  const SPRING = 0.02;
  const IDEAL_LEN = 46;
  const DAMPING = 0.82;
  const CENTER_PULL = 0.006;

  for (let iter = 0; iter < 320; iter++) {
    const force = {};
    ids.forEach((id) => { force[id] = { x: 0, y: 0 }; });

    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const a = pos[ids[i]], b = pos[ids[j]];
        let dx = a.x - b.x, dy = a.y - b.y;
        let distSq = dx * dx + dy * dy;
        if (distSq < 4) { dx = ((i * 37 + j * 13) % 7) - 3 || 0.5; dy = ((i * 11 + j * 29) % 7) - 3 || 0.5; distSq = dx * dx + dy * dy; }
        const dist = Math.sqrt(distSq);
        const f = REPULSION / distSq;
        const fx = (dx / dist) * f, fy = (dy / dist) * f;
        force[ids[i]].x += fx; force[ids[i]].y += fy;
        force[ids[j]].x -= fx; force[ids[j]].y -= fy;
      }
    }

    ids.forEach((id) => {
      (territories[id].neighbors || []).forEach((nId) => {
        if (!pos[nId] || nId < id) return; // procesa cada arista una sola vez
        const a = pos[id], b = pos[nId];
        const dx = b.x - a.x, dy = b.y - a.y;
        const dist = Math.max(1, Math.sqrt(dx * dx + dy * dy));
        const f = SPRING * (dist - IDEAL_LEN);
        const fx = (dx / dist) * f, fy = (dy / dist) * f;
        force[id].x += fx; force[id].y += fy;
        force[nId].x -= fx; force[nId].y -= fy;
      });
    });

    ids.forEach((id) => {
      force[id].x += (W / 2 - pos[id].x) * CENTER_PULL;
      force[id].y += (H / 2 - pos[id].y) * CENTER_PULL;
    });

    ids.forEach((id) => {
      vel[id].x = (vel[id].x + force[id].x) * DAMPING;
      vel[id].y = (vel[id].y + force[id].y) * DAMPING;
      pos[id].x += vel[id].x;
      pos[id].y += vel[id].y;
    });
  }

  const xs = ids.map((id) => pos[id].x), ys = ids.map((id) => pos[id].y);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  const margin = 34;
  const spanX = Math.max(1, maxX - minX), spanY = Math.max(1, maxY - minY);
  const scale = Math.min((W - margin * 2) / spanX, (H - margin * 2) / spanY, 1.7);
  ids.forEach((id) => {
    territories[id].x = Math.round((pos[id].x - minX) * scale + margin + (W - margin * 2 - spanX * scale) / 2);
    territories[id].y = Math.round((pos[id].y - minY) * scale + margin + (H - margin * 2 - spanY * scale) / 2);
  });
}

// Convierte los puntos (x,y) en un MAPA POLÍTICO de verdad: para cada territorio calcula el
// polígono de su "provincia" — su celda de Voronoi (la zona del plano más cercana a él que a
// ningún otro territorio) recortada a un radio máximo de tierra (lo que crea la costa del país,
// con sus bahías y penínsulas) — y lo suaviza para que las fronteras se vean orgánicas, no
// cuadriculadas. Como la celda de Voronoi de un punto siempre es convexa y contiene a su
// territorio, se puede muestrear con rayos desde el centro (búsqueda binaria por rayo) sin
// necesidad de ninguna librería de geometría. El polígono viaja al cliente como un path SVG
// listo para pintar (t.path); el cliente no calcula nada.
function computeTerritoryShapes(territories, W, H) {
  const sites = Object.keys(territories).map((id) => ({ id, x: territories[id].x, y: territories[id].y }));
  const LAND_R = 56;   // radio máximo de tierra alrededor de cada territorio (crea la costa)
  const RAYS = 40;     // rayos por territorio (tras suavizar quedan 80 vértices)
  const EDGE = 4;      // margen mínimo con el borde del lienzo

  function isMine(px, py, myId) {
    if (px < EDGE || px > W - EDGE || py < EDGE || py > H - EDGE) return false;
    let best = null, bd = Infinity;
    for (const s of sites) {
      const dx = s.x - px, dy = s.y - py;
      const d = dx * dx + dy * dy;
      if (d < bd) { bd = d; best = s.id; }
    }
    return best === myId;
  }

  for (const s of sites) {
    const pts = [];
    for (let k = 0; k < RAYS; k++) {
      const th = (k / RAYS) * Math.PI * 2;
      const ct = Math.cos(th), st = Math.sin(th);
      let lo = 0, hi = LAND_R;
      for (let i = 0; i < 9; i++) {
        const mid = (lo + hi) / 2;
        if (isMine(s.x + ct * mid, s.y + st * mid, s.id)) lo = mid; else hi = mid;
      }
      pts.push([s.x + ct * lo, s.y + st * lo]);
    }
    // Una pasada de suavizado de Chaikin: convierte el polígono anguloso en una frontera orgánica.
    const sm = [];
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length];
      sm.push([a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25]);
      sm.push([a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75]);
    }
    territories[s.id].path = 'M' + sm.map((p) => `${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join('L') + 'Z';
  }
}

// Genera un tablero nuevo y distinto cada partida: elige TERRITORIES_PER_ERA regiones al azar de
// cada pool de Era (data.js tiene el doble de candidatas por Era), las conecta con un grafo
// aleatorio, asigna a cada territorio una clase de guarnición, calcula la disposición orgánica
// de todo el conjunto y, por último, los polígonos del mapa político.
function generateBoard() {
  const chosenByEra = {};
  for (const era of [1, 2, 3]) {
    chosenByEra[era] = shuffle(REGION_POOLS[era]).slice(0, TERRITORIES_PER_ERA).map((r) => ({ ...r }));
  }

  const territories = {};
  for (const era of [1, 2, 3]) {
    for (const r of chosenByEra[era]) {
      r.era = era;
      r.neighbors = [];
      r.owner = null;
      r.armies = 0;
      r.open = false;
      r.wonder = null;
      r.unitClass = TROOP_CLASS_KEYS[Math.floor(Math.random() * TROOP_CLASS_KEYS.length)];
      territories[r.id] = r;
    }
  }

  for (const era of [1, 2, 3]) {
    const ids = chosenByEra[era].map((r) => r.id);
    const order = shuffle(ids);
    // Árbol de expansión aleatorio: garantiza que las regiones de la Era queden conectadas entre sí.
    for (let i = 1; i < order.length; i++) {
      const b = order[Math.floor(Math.random() * i)];
      connectTerritories(territories, order[i], b);
    }
    // Un par de conexiones extra al azar, para que el mapa no sea siempre un camino lineal.
    const extraEdges = Math.max(1, Math.floor(ids.length / 4));
    for (let k = 0; k < extraEdges; k++) {
      const a = ids[Math.floor(Math.random() * ids.length)];
      const b = ids[Math.floor(Math.random() * ids.length)];
      connectTerritories(territories, a, b);
    }
  }

  // Puentes entre Eras: cada región nueva se conecta con al menos 1 región de la Era anterior,
  // así siempre hay forma de expandirse hacia la Era siguiente desde territorio ya conquistado.
  for (const era of [2, 3]) {
    const prevIds = chosenByEra[era - 1].map((r) => r.id);
    for (const r of chosenByEra[era]) {
      const bridge = prevIds[Math.floor(Math.random() * prevIds.length)];
      connectTerritories(territories, r.id, bridge);
    }
  }

  layoutTerritories(territories, MAP_W, MAP_H);
  computeTerritoryShapes(territories, MAP_W, MAP_H);
  return territories;
}

function openEraTerritories(room, era) {
  const garrison = ERA_GARRISON[era];
  for (const id in room.territories) {
    if (room.territories[id].era === era) {
      room.territories[id].open = true;
      room.territories[id].armies = garrison;
      room.territories[id].owner = null;
    }
  }
}

// Nombre histórico de una clase de tropa en una Era concreta (ej. inf en Era I -> "Hoplitas").
function unitName(cls, era) {
  const c = TROOP_CLASSES[cls] || TROOP_CLASSES.inf;
  return (c.byEra[era] || c.byEra[1]).name;
}
function unitIcon(cls, era) {
  const c = TROOP_CLASSES[cls] || TROOP_CLASSES.inf;
  return (c.byEra[era] || c.byEra[1]).icon;
}
// La clase que tiene ventaja CONTRA la clase dada (la que la vence).
function counterOf(cls) {
  return TROOP_CLASS_KEYS.find((k) => TROOP_CLASSES[k].beats === cls) || TROOP_CLASS_KEYS[0];
}

function log(room, msg) {
  room.log.unshift(msg);
  room.log = room.log.slice(0, 10);
}

function pickDesafio(room) {
  const d = DESAFIOS[room.desafioCursor % DESAFIOS.length];
  room.desafioCursor++;
  return d;
}

// Nota: 'resolve' NO es un paso propio de la lista. Es una fase transitoria que
// resolveOrders()/resolveDesafio() activan sin mover stepIdx; al pulsar "continuar"
// se llama a advanceStep(), que sí avanza stepIdx hasta el siguiente paso real.
function buildEraSteps() {
  return [
    { p: 'era_intro' },
    { p: 'orders', round: 1 },
    { p: 'orders', round: 2 },
    { p: 'desafio' },
    { p: 'orders', round: 3 },
    { p: 'simposio' },
  ];
}

function playerById(room, id) { return room.players.find((p) => p.id === id); }
function ownedTerritories(room, playerId, era) {
  return Object.values(room.territories).filter((t) => t.owner === playerId && (era ? t.era === era : true));
}
function ownedWonders(room, playerId) {
  return Object.values(room.territories).filter((t) => t.wonder && t.owner === playerId);
}
function openCount(room) {
  return Object.values(room.territories).filter((t) => t.open).length;
}
function dominationNeeded(room) {
  return Math.ceil(openCount(room) * DOMINATION_RATIO);
}
function publicPlayer(p) {
  return {
    id: p.id, name: p.name, leader: p.leader, gloria: p.gloria, reserve: p.reserve,
    characterCount: p.characters.length, isBot: !!p.isBot,
    resources: p.resources || 0, troopLevels: p.troopLevels || { inf: 1, cab: 1, arq: 1 },
  };
}

function publicState(room) {
  return {
    code: room.code,
    phase: room.phase,
    era: room.era,
    round: room.round || null,
    maxPlayers: room.maxPlayers,
    leaders: LEADERS,
    troopClasses: TROOP_CLASSES,
    wonderCost: WONDER_COST,
    wondersToWin: WONDERS_TO_WIN,
    dominationNeeded: dominationNeeded(room),
    eraInfo: ERA_INFO[room.era],
    territories: room.territories,
    players: room.players.map(publicPlayer),
    log: room.log,
    ordersSubmitted: room.phase === 'orders' ? Object.keys(room.orders) : [],
    desafio: room.phase === 'desafio' ? room.currentDesafio : null,
    desafioResponses: room.phase === 'desafio' ? Object.keys(room.desafioResponses) : [],
    resolveLog: room.phase === 'resolve' ? room.resolveLog : null,
    simposioResult: room.phase === 'simposio' ? room.simposioResult : null,
    finalResult: room.phase === 'fin' ? room.finalResult : null,
    victory: room.phase === 'fin' ? room.victory || null : null,
  };
}

function pushToPlayer(playerId, payload) {
  const res = sseClients.get(playerId);
  if (res) {
    try { res.write(`data: ${JSON.stringify(payload)}\n\n`); } catch (e) { /* ignore broken pipe */ }
  }
}

function emitRoom(room, notices = {}) {
  const state = publicState(room);
  for (const p of room.players) {
    pushToPlayer(p.id, { ...state, you: { id: p.id, characters: p.characters, shield: p.shield }, notice: notices[p.id] || null });
  }
}

// Termina la partida inmediatamente con un ganador y un motivo (dominación, cultura o gloria).
// El ganador va primero en el ranking; el resto se ordena por Gloria como desempate visual.
function endGame(room, winnerId, type) {
  clearTimeout(room.timer);
  room.phase = 'fin';
  const winner = playerById(room, winnerId);
  const rest = room.players.filter((p) => p.id !== winnerId).sort((a, b) => b.gloria - a.gloria);
  const ranking = winner ? [winner, ...rest] : [...room.players].sort((a, b) => b.gloria - a.gloria);
  room.finalResult = ranking.map((p) => ({ name: p.name, gloria: p.gloria, territorios: ownedTerritories(room, p.id).length }));
  const labels = {
    dominacion: `🗺️ Victoria por DOMINACIÓN: ${winner ? winner.name : '?'} controla ${dominationNeeded(room)} o más territorios.`,
    cultura: `🏛️ Victoria por CULTURA: ${winner ? winner.name : '?'} controla ${WONDERS_TO_WIN} Maravillas.`,
    gloria: `🏆 Victoria por GLORIA: ${winner ? winner.name : '?'} termina la Era III con más Gloria.`,
  };
  room.victory = { type, winner: winner ? winner.name : null, detalle: labels[type] || '' };
  room.phaseEndsAt = null;
  emitRoom(room);
}

// Comprueba, al final de una ronda resuelta, si alguien ha ganado ya por Dominación o por
// Cultura. Devuelve {winnerId, type} o null. (La de Gloria solo se decide al final de la Era III.)
function checkInstantVictory(room) {
  const needed = dominationNeeded(room);
  for (const p of room.players) {
    if (ownedTerritories(room, p.id).filter((t) => t.open).length >= needed) return { winnerId: p.id, type: 'dominacion' };
  }
  for (const p of room.players) {
    if (ownedWonders(room, p.id).length >= WONDERS_TO_WIN) return { winnerId: p.id, type: 'cultura' };
  }
  return null;
}

// ---------- máquina de fases ----------

function runStep(room) {
  const step = room.steps[room.stepIdx];
  room.phase = step.p;
  room.round = step.round || room.round;
  clearTimeout(room.timer);

  if (step.p === 'era_intro') {
    openEraTerritories(room, room.era);
    room.eraDeckTaken = new Set();
    for (const p of room.players) p.reserve = (p.reserve || 0) + 3;
    log(room, `Comienza la ${ERA_INFO[room.era].titulo}`);
    room.phaseEndsAt = null;
    emitRoom(room);
    return;
  }

  if (step.p === 'orders') {
    room.orders = {};
    room.phaseEndsAt = Date.now() + ORDERS_TIME;
    emitRoom(room);
    scheduleBots(room);
    room.timer = setTimeout(() => resolveOrders(room), ORDERS_TIME);
    return;
  }

  if (step.p === 'desafio') {
    room.currentDesafio = pickDesafio(room);
    room.desafioResponses = {};
    room.phaseEndsAt = Date.now() + DESAFIO_TIME;
    emitRoom(room);
    scheduleBots(room);
    room.timer = setTimeout(() => resolveDesafio(room), DESAFIO_TIME);
    return;
  }

  if (step.p === 'simposio') {
    const result = [];
    for (const p of room.players) {
      const owned = ownedTerritories(room, p.id, room.era);
      let gain = owned.length * 2;
      if (owned.length >= TERRITORIES_PER_ERA / 2) gain += 1;
      if (room.era === 3 && p.doubleEra3) gain *= 2;
      p.gloria += gain;
      result.push({ name: p.name, territorios: owned.length, ganancia: gain });
    }
    room.simposioResult = result;
    log(room, `Fin de la Era ${room.era}: se reparte la Gloria.`);
    room.phaseEndsAt = null;
    emitRoom(room);
    return;
  }
}

function advanceStep(room) {
  clearTimeout(room.timer);
  // Si la última ronda dejó una victoria instantánea pendiente (dominación/cultura),
  // se ejecuta ahora — así el grupo ve primero el registro de la ronda y después el final.
  if (room.pendingVictory) {
    const v = room.pendingVictory;
    room.pendingVictory = null;
    endGame(room, v.winnerId, v.type);
    return;
  }
  room.stepIdx++;
  if (room.stepIdx >= room.steps.length) {
    if (room.era < 3) {
      room.era++;
      room.steps = buildEraSteps();
      room.stepIdx = 0;
      runStep(room);
    } else {
      const ranking = [...room.players].sort((a, b) => {
        if (b.gloria !== a.gloria) return b.gloria - a.gloria;
        return ownedTerritories(room, b.id).length - ownedTerritories(room, a.id).length;
      });
      endGame(room, ranking[0].id, 'gloria');
    }
    return;
  }
  runStep(room);
}

function allOrdered(room) { return Object.keys(room.orders).length >= room.players.length; }

// ---------- IA de los bots ----------

function botPickOrder(room, bot) {
  const territories = Object.values(room.territories).filter((t) => t.open);
  const mine = territories.filter((t) => t.owner === bot.id);

  const isBootstrapRound = room.round === 1;
  const bootstrapTargets = isBootstrapRound
    ? territories.filter((t) => t.era === room.era && t.owner === null)
    : [];

  // Objetivos "normales": vecinos de un territorio propio con tropas de sobra. Se guarda si la
  // clase del origen tiene ventaja sobre la del objetivo, para preferir esos ataques.
  const regularOptions = [];
  for (const src of mine) {
    if (src.armies <= 1) continue;
    for (const nId of src.neighbors) {
      const n = room.territories[nId];
      if (n && n.open && n.owner !== bot.id) {
        regularOptions.push({ src, target: n, favorable: TROOP_CLASSES[src.unitClass].beats === n.unitClass });
      }
    }
  }
  // Preferencia por los ataques con ventaja de clase.
  regularOptions.sort((a, b) => (b.favorable ? 1 : 0) - (a.favorable ? 1 : 0));

  const r = Math.random();

  if (bot.reserve >= 1 && bootstrapTargets.length && r < 0.4) {
    const target = bootstrapTargets[Math.floor(Math.random() * bootstrapTargets.length)];
    const amount = Math.max(1, Math.min(bot.reserve, 1 + Math.floor(Math.random() * 2)));
    // Al colonizar elige la clase que vence a la guarnición local.
    return { type: 'atacar', mode: 'asalto', to: target.id, amount, unitClass: counterOf(target.unitClass) };
  }
  if (regularOptions.length && r < 0.65) {
    const pick = regularOptions[Math.floor(Math.random() * Math.min(2, regularOptions.length))];
    // Contra un defensor claramente más fuerte, a veces asedia o hace una incursión en vez de asaltar.
    const defenderIsPlayer = !!pick.target.owner;
    const outnumbered = pick.target.armies >= pick.src.armies;
    let mode = 'asalto';
    const mr = Math.random();
    if (outnumbered && mr < 0.4) mode = 'asedio';
    else if (defenderIsPlayer && mr < 0.55) {
      const owner = playerById(room, pick.target.owner);
      if (owner && (owner.resources || 0) >= 3) mode = 'incursion';
    }
    const maxAmount = pick.src.armies - 1;
    const amount = Math.max(1, Math.min(maxAmount, 1 + Math.floor(Math.random() * 2)));
    return { type: 'atacar', mode, to: pick.target.id, from: pick.src.id, amount };
  }
  if (bot.reserve >= 1 && mine.length && r < 0.85) {
    const target = mine[Math.floor(Math.random() * mine.length)];
    const amount = Math.max(1, Math.min(bot.reserve, 1 + Math.floor(Math.random() * 2)));
    return { type: 'reforzar', territoryId: target.id, amount };
  }
  if (r < 0.93) return { type: 'reclutar' };
  const others_ = room.players.filter((p) => p.id !== bot.id);
  if (others_.length) return { type: 'espiar', targetId: others_[Math.floor(Math.random() * others_.length)].id };
  return { type: 'reclutar' };
}

// Los bots también invierten Recursos en mejorar tropas cuando les sobran — con algo de margen
// (no gastan hasta el último Recurso) para que no monopolicen siempre la mejora más barata.
function botMaybeLevelUp(room, bot) {
  if (!bot.troopLevels) return;
  if (Math.random() > 0.5) return;
  const affordable = [];
  for (const cls of TROOP_CLASS_KEYS) {
    const currentLevel = bot.troopLevels[cls] || 1;
    const nextLevelDef = TROOP_CLASSES[cls].levels.find((l) => l.level === currentLevel + 1);
    if (!nextLevelDef) continue;
    const cost = Math.max(1, nextLevelDef.cost - (bot.leader === 'suntzu' ? 2 : 0));
    if ((bot.resources || 0) >= cost + 3) affordable.push(cls);
  }
  if (affordable.length) {
    const cls = affordable[Math.floor(Math.random() * affordable.length)];
    actions.level_up_troop({ cls }, { playerId: bot.id });
  }
}

// Y en construir Maravillas, si van sobrados de Recursos (la vía de victoria cultural).
function botMaybeWonder(room, bot) {
  if ((bot.resources || 0) < WONDER_COST + 4) return;
  if (Math.random() > 0.4) return;
  const candidates = ownedTerritories(room, bot.id).filter((t) => t.open && !t.wonder);
  if (!candidates.length) return;
  const t = candidates[Math.floor(Math.random() * candidates.length)];
  actions.construir_maravilla({ territoryId: t.id }, { playerId: bot.id });
}

function scheduleBots(room) {
  const phase = room.phase;
  const bots = room.players.filter((p) => p.isBot);
  for (const bot of bots) {
    setTimeout(() => {
      const r = rooms[room.code];
      if (!r || r.phase !== phase) return; // la fase ya cambió, no hacer nada
      if (phase === 'orders') {
        const order = botPickOrder(r, bot);
        actions.submit_order({ order }, { playerId: bot.id });
        botMaybeLevelUp(r, bot);
        botMaybeWonder(r, bot);
      } else if (phase === 'desafio') {
        const d = r.currentDesafio;
        let choice;
        if (d.tipo === 'votacion') {
          const others = r.players.filter((p) => p.id !== bot.id);
          choice = others.length ? others[Math.floor(Math.random() * others.length)].id : bot.id;
        } else {
          choice = Math.floor(Math.random() * d.opciones.length);
        }
        actions.submit_desafio_choice({ choice }, { playerId: bot.id });
      }
    }, botDelay());
  }
}

function applyCharacterEffect(room, p, card, resolveLog) {
  switch (card.coded) {
    case 'steal_army': {
      const rivalTerritories = Object.values(room.territories).filter((t) => t.owner && t.owner !== p.id && t.armies > 0);
      if (rivalTerritories.length) {
        const t = rivalTerritories[Math.floor(Math.random() * rivalTerritories.length)];
        t.armies -= 1; p.reserve += 1;
        resolveLog.push(`César le roba 1 tropa a ${t.name}.`);
      }
      break;
    }
    case 'shield_once':
      p.shield = true;
      resolveLog.push(`${p.name} queda protegido por Diógenes hasta su próxima derrota.`);
      break;
    case 'weaken_rivals':
      for (const rival of room.players) {
        if (rival.id === p.id) continue;
        const territs = ownedTerritories(room, rival.id).filter((t) => t.armies > 1);
        if (territs.length) {
          const t = territs.reduce((a, b) => (a.armies < b.armies ? a : b));
          t.armies -= 1;
          resolveLog.push(`El Imperio de Gengis Kan debilita ${t.name} de ${rival.name} (-1 tropa).`);
        }
      }
      break;
    case 'extra_defense_die':
      p.extraDefenseDie = true;
      resolveLog.push(`${p.name} defiende con +1 dado permanente gracias a Avicena.`);
      break;
    case 'order_hidden':
      p.hideOrders = true;
      resolveLog.push(`${p.name} ya no puede ser espiado gracias a Maquiavelo.`);
      break;
    case 'double_era3_score':
      p.doubleEra3 = true;
      resolveLog.push(`${p.name} duplicará la Gloria de sus territorios de la Era III.`);
      break;
    default:
      p.gloria += 1;
      resolveLog.push(`${card.name} es una carta de prestigio: +1 Gloria para ${p.name}.`);
  }
}

function resolveOrders(room) {
  clearTimeout(room.timer);
  const resolveLog = [];
  const notices = {};
  const order = [...room.players].sort(() => Math.random() - 0.5);

  for (const p of order) {
    const o = room.orders[p.id];
    if (o && o.type === 'reforzar') {
      const t = room.territories[o.territoryId];
      if (t && t.owner === p.id) {
        const amt = Math.max(0, Math.min(o.amount || 0, p.reserve));
        t.armies += amt; p.reserve -= amt;
        resolveLog.push(`${p.name} refuerza ${t.name} con ${amt} tropa(s) de ${unitName(t.unitClass, t.era)}.`);
      }
    }
  }

  for (const p of order) {
    const o = room.orders[p.id];
    if (o && o.type === 'espiar') {
      const target = playerById(room, o.targetId);
      if (target) {
        if (target.hideOrders) {
          resolveLog.push(`${p.name} intenta espiar a ${target.name}, pero Maquiavelo lo impide.`);
        } else {
          const info = ownedTerritories(room, target.id).map((t) => `${t.name}(${t.armies} ${unitIcon(t.unitClass, t.era)})`).join(', ') || 'ningún territorio';
          notices[p.id] = { type: 'spy_result', target: target.name, info };
          resolveLog.push(`${p.name} espía a ${target.name}.`);
          if (p.leader === 'anibal') {
            p.reserve += 1;
            resolveLog.push(`${p.name} (El Táctico) gana 1 tropa extra de reserva por espiar.`);
          }
        }
      }
    }
  }

  for (const p of order) {
    const o = room.orders[p.id];
    if (o && o.type === 'reclutar') {
      const deck = CHARACTER_DECKS[room.era].filter((c) => !room.eraDeckTaken.has(c.id));
      if (deck.length === 0) { resolveLog.push(`${p.name} intenta reclutar, pero ya no quedan personajes en esta Era.`); continue; }
      const card = deck[Math.floor(Math.random() * deck.length)];
      room.eraDeckTaken.add(card.id);
      p.characters.push(card);
      resolveLog.push(`${p.name} recluta a ${card.name}.`);
      applyCharacterEffect(room, p, card, resolveLog);
    }
  }

  for (const p of order) {
    const o = room.orders[p.id];
    if (o && o.type === 'atacar') {
      const t = room.territories[o.to];
      if (!t || !t.open || t.owner === p.id) continue;

      const mode = ['asalto', 'asedio', 'incursion'].includes(o.mode) ? o.mode : 'asalto';
      const isBootstrap = room.round === 1 && t.era === room.era && t.owner === null;
      const defenderPlayer = t.owner ? playerById(room, t.owner) : null;

      // ---- ASEDIO: duelo de 1 dado por bando; el perdedor pierde 1 tropa. Nadie se mueve. ----
      if (mode === 'asedio' && !isBootstrap) {
        const source = room.territories[o.from];
        if (!source || source.owner !== p.id || !source.neighbors.includes(t.id) || source.armies < 2) {
          resolveLog.push(`${p.name} no tiene un territorio válido con tropas de sobra para asediar ${t.name}.`);
          continue;
        }
        const aCounter = TROOP_CLASSES[source.unitClass].beats === t.unitClass;
        const dCounter = TROOP_CLASSES[t.unitClass].beats === source.unitClass;
        const aVal = roll(1)[0] + (aCounter ? 1 : 0);
        const dVal = roll(1)[0] + (dCounter ? 1 : 0);
        if (aVal > dVal) {
          t.armies = Math.max(0, t.armies - 1);
          resolveLog.push(`💣 ${p.name} asedia ${t.name} desde ${source.name} (${aVal} vs ${dVal}): la guarnición pierde 1 tropa (quedan ${t.armies}).${defenderPlayer ? ` ${defenderPlayer.name} bebe 1 sorbo.` : ''}`);
        } else {
          source.armies = Math.max(1, source.armies - 1);
          resolveLog.push(`💣 ${p.name} asedia ${t.name} (${aVal} vs ${dVal}) y la defensa aguanta: pierde 1 tropa y bebe 1 sorbo.`);
        }
        continue;
      }

      // ---- INCURSIÓN: si ganas el duelo, robas hasta 3 Recursos al dueño. Nadie conquista. ----
      if (mode === 'incursion' && !isBootstrap) {
        const source = room.territories[o.from];
        if (!source || source.owner !== p.id || !source.neighbors.includes(t.id) || source.armies < 2) {
          resolveLog.push(`${p.name} no tiene un territorio válido con tropas de sobra para una incursión en ${t.name}.`);
          continue;
        }
        if (!defenderPlayer) {
          resolveLog.push(`${p.name} intenta una incursión en ${t.name}, pero es territorio neutral: no hay Recursos que robar.`);
          continue;
        }
        const aCounter = TROOP_CLASSES[source.unitClass].beats === t.unitClass;
        const dCounter = TROOP_CLASSES[t.unitClass].beats === source.unitClass;
        const aVal = roll(1)[0] + (aCounter ? 1 : 0);
        const dVal = roll(1)[0] + (dCounter ? 1 : 0);
        if (aVal > dVal) {
          const steal = Math.min(3, defenderPlayer.resources || 0);
          defenderPlayer.resources = (defenderPlayer.resources || 0) - steal;
          p.resources = (p.resources || 0) + steal;
          resolveLog.push(`🐎 ${p.name} lanza una incursión sobre ${t.name} (${aVal} vs ${dVal}) y roba ${steal} Recurso(s) a ${defenderPlayer.name}, que bebe 1 sorbo.`);
        } else {
          source.armies = Math.max(1, source.armies - 1);
          resolveLog.push(`🐎 La incursión de ${p.name} sobre ${t.name} fracasa (${aVal} vs ${dVal}): pierde 1 tropa y bebe 1 sorbo.`);
        }
        continue;
      }

      // ---- ASALTO (o colonización de territorio libre en la 1ª ronda de la Era) ----
      let source = null;
      let amount;
      let attackClass;

      if (isBootstrap) {
        // Territorio libre en la 1ª ronda de la Era: se desembarca directamente desde la reserva,
        // eligiendo con qué clase de tropa se ocupa.
        amount = Math.max(1, Math.min(o.amount || 0, p.reserve));
        if (amount < 1 || p.reserve < 1) { resolveLog.push(`${p.name} no tiene tropas de reserva para desembarcar en ${t.name}.`); continue; }
        attackClass = TROOP_CLASS_KEYS.includes(o.unitClass) ? o.unitClass : TROOP_CLASS_KEYS[Math.floor(Math.random() * TROOP_CLASS_KEYS.length)];
      } else {
        // Ataque normal: hace falta un territorio propio vecino con tropas de sobra —
        // las unidades que atacan son, literalmente, las que hay estacionadas ahí.
        source = room.territories[o.from];
        if (!source || source.owner !== p.id || !source.neighbors.includes(t.id)) {
          resolveLog.push(`${p.name} no tiene un territorio de origen válido junto a ${t.name}.`);
          continue;
        }
        amount = Math.max(1, Math.min(o.amount || 0, source.armies - 1));
        if (amount < 1 || source.armies < 2) { resolveLog.push(`${p.name} no tiene tropas de sobra en ${source.name} para atacar.`); continue; }
        attackClass = source.unitClass;
      }

      if (isBootstrap) p.reserve -= amount;

      const dBonus = !!(defenderPlayer && (defenderPlayer.leader === 'juana' || defenderPlayer.extraDefenseDie));
      const aBonus = p.leader === 'zhenghe' && isBootstrap;
      // Ventaja de clase (piedra-papel-tijera): +1 dado si tu clase vence a la del rival.
      const aCounter = TROOP_CLASSES[attackClass].beats === t.unitClass;
      const dCounter = TROOP_CLASSES[t.unitClass].beats === attackClass;
      // Nivel de la tropa: se compra por clase y vale toda la partida (+1 dado desde nivel 2;
      // el nivel 3 además gana los empates, que normalmente favorecen a quien defiende).
      const aLevelNum = (p.troopLevels && p.troopLevels[attackClass]) || 1;
      const aLevel = TROOP_CLASSES[attackClass].levels.find((l) => l.level === aLevelNum) || { diceBonus: 0, winsTies: false };
      const dLevelNum = (defenderPlayer && defenderPlayer.troopLevels && defenderPlayer.troopLevels[t.unitClass]) || 1;
      const dLevel = TROOP_CLASSES[t.unitClass].levels.find((l) => l.level === dLevelNum) || { diceBonus: 0, winsTies: false };

      const aDice = roll(Math.min(amount, 3) + (aBonus ? 1 : 0) + (aCounter ? 1 : 0) + aLevel.diceBonus);
      const dDice = roll(Math.min(t.armies, 2) + (dBonus ? 1 : 0) + (dCounter ? 1 : 0) + dLevel.diceBonus);
      let aLoss = 0, dLoss = 0;
      const cmp = Math.min(aDice.length, dDice.length);
      for (let i = 0; i < cmp; i++) {
        if (aDice[i] > dDice[i]) dLoss++;
        else if (aDice[i] < dDice[i]) aLoss++;
        else if (aLevel.winsTies && !dLevel.winsTies) dLoss++; // empate: normalmente gana quien defiende, salvo tropa de élite atacante
        else aLoss++;
      }
      if (p.shield && aLoss > 0) { aLoss = Math.max(0, aLoss - 1); p.shield = false; resolveLog.push(`${p.name} usa el escudo de Diógenes y evita 1 baja.`); }
      if (p.leader === 'alejandro' && aLoss > 0) { aLoss = Math.max(0, aLoss - 1); resolveLog.push(`${p.name} (El Conquistador) evita 1 baja en combate.`); }
      const survivors = amount - aLoss;
      t.armies = Math.max(0, t.armies - dLoss);
      const originTxt = source ? ` desde ${source.name}` : '';
      const classTxt = ` con sus ${unitName(attackClass, source ? source.era : t.era)}${aCounter ? ' (¡ventaja de clase!)' : ''}`;

      if (t.armies <= 0 && survivors > 0) {
        const prevOwnerName = defenderPlayer ? defenderPlayer.name : 'los locales';
        const wasRival = !!defenderPlayer;
        if (source) source.armies -= amount; // todas las tropas comprometidas abandonan el origen (bajas + las que se mudan)
        t.owner = p.id; t.armies = survivors; t.unitClass = attackClass;
        resolveLog.push(`⚔️ ${p.name} conquista ${t.name}${originTxt}${classTxt}, con ${survivors} superviviente(s) (antes de ${prevOwnerName}). ${prevOwnerName} bebe ${dLoss} sorbo(s).`);
        if (t.wonder) resolveLog.push(`🏛️ ¡${t.wonder.name} cambia de manos y ahora es de ${p.name}!`);
        if (wasRival && p.leader === 'bolivar') {
          p.gloria += 1;
          resolveLog.push(`${p.name} (El Libertador) gana +1 Gloria por liberar ${t.name}.`);
        }
      } else {
        if (source) source.armies -= aLoss; // solo se pierden las bajas; el resto vuelve al origen
        t.armies = Math.max(1, t.armies);
        resolveLog.push(`⚔️ ${p.name} ataca ${t.name}${originTxt}${classTxt} y fracasa. ${p.name} bebe ${aLoss} sorbo(s).`);
      }
    }
  }

  // Ingreso de Recursos: 1 por cada territorio que controles al final de la ronda (Mansa Musa
  // gana 1 extra). Sin mensaje en el registro para no saturarlo; el total se ve en tu ficha.
  for (const p of room.players) {
    const owned = ownedTerritories(room, p.id).length;
    let income = owned;
    if (p.leader === 'mansamusa') income += 1;
    if (income) p.resources = (p.resources || 0) + income;
  }

  // ¿Alguien ha ganado ya por Dominación o Cultura? Se anuncia en el registro y, al pulsar
  // "continuar", la partida salta directamente a la pantalla final.
  const victory = checkInstantVictory(room);
  if (victory) {
    room.pendingVictory = victory;
    const vp = playerById(room, victory.winnerId);
    resolveLog.push(victory.type === 'dominacion'
      ? `🗺️ ¡${vp.name} controla ${dominationNeeded(room)} territorios o más! VICTORIA POR DOMINACIÓN.`
      : `🏛️ ¡${vp.name} controla ${WONDERS_TO_WIN} Maravillas! VICTORIA POR CULTURA.`);
  }

  room.resolveLog = resolveLog;
  room.phase = 'resolve';
  room.phaseEndsAt = null;
  emitRoom(room, notices);
}

function resolveDesafio(room) {
  clearTimeout(room.timer);
  const d = room.currentDesafio;
  const resolveLog = [];

  if (d.tipo === 'eleccion_secreta') {
    const traidores = room.players.filter((p) => room.desafioResponses[p.id] === 1);
    if (traidores.length === 0) {
      for (const p of room.players) p.gloria += 1;
      resolveLog.push('Todos fuisteis leales: +1 Gloria para cada uno, nadie bebe.');
    } else {
      for (const p of room.players) {
        if (traidores.find((t) => t.id === p.id)) { p.gloria += 2; resolveLog.push(`${p.name} traicionó: +2 Gloria.`); }
        else resolveLog.push(`${p.name} fue leal y bebe 1 sorbo.`);
      }
    }
  } else if (d.tipo === 'riesgo') {
    for (const p of room.players) {
      const choice = room.desafioResponses[p.id];
      if (choice === 0) {
        const dice = roll(1)[0];
        if (dice >= 4) { p.gloria += 3; resolveLog.push(`${p.name} cruza los Alpes con éxito (${dice}): +3 Gloria.`); }
        else {
          const t = ownedTerritories(room, p.id);
          if (t.length) t[0].armies = Math.max(1, t[0].armies - 1);
          resolveLog.push(`${p.name} fracasa en los Alpes (${dice}): pierde 1 tropa y bebe 2 sorbos.`);
        }
      } else { p.gloria += 1; resolveLog.push(`${p.name} va por mar, seguro: +1 Gloria.`); }
    }
  } else if (d.tipo === 'votacion') {
    const tally = {};
    for (const voted of Object.values(room.desafioResponses)) tally[voted] = (tally[voted] || 0) + 1;
    let winnerId = null, max = 0;
    for (const id in tally) if (tally[id] > max) { max = tally[id]; winnerId = id; }
    // Blindaje: el voto podría llegar con un valor que no sea un id de jugador real (cliente
    // buggeado o manipulado) — sin esta comprobación, winner sería undefined y tumbaría el
    // servidor entero al leer winner.leader.
    const winner = winnerId ? playerById(room, winnerId) : null;
    if (winner) {
      let gain = 2;
      if (winner.leader === 'pericles') gain *= 2;
      winner.gloria += gain;
      resolveLog.push(`${winner.name} gana el debate con ${max} voto(s): +${gain} Gloria. Los demás beben 1 sorbo.`);
    } else resolveLog.push('Nadie votó a un jugador válido, el debate queda en tablas.');
  }

  room.resolveLog = resolveLog;
  room.phase = 'resolve';
  room.phaseEndsAt = null;
  emitRoom(room);
}

// ---------- acciones de la API ----------

const actions = {
  create_room({ name, maxPlayers, botsWanted }, ctx) {
    let total = parseInt(maxPlayers, 10);
    if (!Number.isFinite(total)) total = 3;
    total = Math.max(MIN_PLAYERS, Math.min(MAX_PLAYERS, total));
    let bots = parseInt(botsWanted, 10);
    if (!Number.isFinite(bots)) bots = 0;
    bots = Math.max(0, Math.min(total - 1, bots));

    const code = makeCode();
    const room = {
      code, hostId: ctx.playerId, players: [], phase: 'lobby', era: 1,
      territories: generateBoard(), log: [], desafioCursor: 0, maxPlayers: total,
      wonderDeck: shuffle(WONDERS),
    };
    rooms[code] = room;
    room.players.push(makePlayer(ctx.playerId, name || 'Jugador', false));
    playerRoom[ctx.playerId] = code;
    addBots(room, bots);
    emitRoom(room);
    return { ok: true, code };
  },

  join_room({ code, name }, ctx) {
    code = (code || '').trim().toUpperCase();
    const room = rooms[code];
    if (!room) return { error: 'Esa sala no existe.' };
    if (room.players.length >= room.maxPlayers) return { error: `La sala ya tiene ${room.maxPlayers} jugadores.` };
    if (room.phase !== 'lobby') return { error: 'Esa partida ya ha empezado.' };
    room.players.push(makePlayer(ctx.playerId, name || 'Jugador', false));
    playerRoom[ctx.playerId] = code;
    emitRoom(room);
    return { ok: true, code };
  },

  choose_leader({ leader }, ctx) {
    const room = rooms[playerRoom[ctx.playerId]];
    if (!room || room.phase !== 'lobby' || !LEADERS[leader]) return { error: 'No disponible.' };
    if (room.players.some((p) => p.leader === leader && p.id !== ctx.playerId)) return { error: 'Ese líder ya está cogido.' };
    const p = playerById(room, ctx.playerId);
    if (p) p.leader = leader;
    emitRoom(room);
    return { ok: true };
  },

  start_game(_, ctx) {
    const room = rooms[playerRoom[ctx.playerId]];
    if (!room || room.hostId !== ctx.playerId) return { error: 'Solo el anfitrión puede empezar.' };
    if (room.players.length !== room.maxPlayers) return { error: `Hacen falta ${room.maxPlayers} jugadores.` };
    if (room.players.some((p) => !p.leader)) return { error: 'Falta elegir Líder.' };
    room.steps = buildEraSteps();
    room.stepIdx = 0;
    runStep(room);
    return { ok: true };
  },

  // Reinicia la partida sin tener que crear una sala nueva ni volver a compartir código:
  // vuelve al lobby, genera un mapa nuevo y resetea el progreso, pero conserva jugadores y líderes.
  restart_room(_, ctx) {
    const room = rooms[playerRoom[ctx.playerId]];
    if (!room) return { error: 'Sala no encontrada.' };
    if (room.hostId !== ctx.playerId) return { error: 'Solo el anfitrión puede reiniciar la partida.' };
    clearTimeout(room.timer);
    room.phase = 'lobby';
    room.era = 1;
    room.round = null;
    room.territories = generateBoard();
    room.log = [];
    room.desafioCursor = 0;
    room.eraDeckTaken = new Set();
    room.wonderDeck = shuffle(WONDERS);
    room.pendingVictory = null;
    room.victory = null;
    for (const p of room.players) {
      p.gloria = 0;
      p.reserve = 0;
      p.characters = [];
      p.shield = false;
      p.extraDefenseDie = false;
      p.hideOrders = false;
      p.doubleEra3 = false;
      p.resources = 0;
      p.troopLevels = { inf: 1, cab: 1, arq: 1 };
    }
    log(room, 'El anfitrión ha reiniciado la partida — nuevo mapa, mismos jugadores.');
    emitRoom(room);
    return { ok: true };
  },

  submit_order({ order }, ctx) {
    const room = rooms[playerRoom[ctx.playerId]];
    if (!room || room.phase !== 'orders') return { error: 'No es el momento.' };
    room.orders[ctx.playerId] = order;
    emitRoom(room);
    if (allOrdered(room)) resolveOrders(room);
    return { ok: true };
  },

  // Mejora PARA SIEMPRE (mientras dure la partida) el nivel de una CLASE de tropa: sube el bonus
  // de dados de combate de ESE jugador para todas sus tropas de esa clase, en todas las Épocas,
  // presentes y futuras. Cuesta Recursos (crecientes por nivel; Sun Tzu paga 2 menos). No consume
  // el turno/orden de la ronda — es una decisión aparte, se puede hacer en cualquier momento.
  level_up_troop({ cls }, ctx) {
    const room = rooms[playerRoom[ctx.playerId]];
    if (!room) return { error: 'Sala no encontrada.' };
    if (!TROOP_CLASS_KEYS.includes(cls)) return { error: 'Clase de tropa no válida.' };
    const p = playerById(room, ctx.playerId);
    if (!p) return { error: 'Jugador no encontrado.' };
    if (!p.troopLevels) p.troopLevels = { inf: 1, cab: 1, arq: 1 };
    const currentLevel = p.troopLevels[cls] || 1;
    const nextLevelDef = TROOP_CLASSES[cls].levels.find((l) => l.level === currentLevel + 1);
    if (!nextLevelDef) return { error: 'Esa clase ya está al nivel máximo.' };
    const cost = Math.max(1, nextLevelDef.cost - (p.leader === 'suntzu' ? 2 : 0));
    if ((p.resources || 0) < cost) return { error: `Te faltan Recursos (necesitas ${cost}, tienes ${p.resources || 0}).` };
    p.resources -= cost;
    p.troopLevels[cls] = currentLevel + 1;
    log(room, `${p.name} mejora su ${TROOP_CLASSES[cls].clase} a nivel ${currentLevel + 1} (${nextLevelDef.name}).`);
    emitRoom(room);
    return { ok: true };
  },

  // Construye una Maravilla en un territorio propio (una por territorio). Cuesta Recursos y NO
  // consume la orden de la ronda. La maravilla queda ligada al territorio: si te lo conquistan,
  // cambia de dueño. Controlar 3 a la vez gana la partida por Cultura al instante.
  construir_maravilla({ territoryId }, ctx) {
    const room = rooms[playerRoom[ctx.playerId]];
    if (!room) return { error: 'Sala no encontrada.' };
    const p = playerById(room, ctx.playerId);
    if (!p) return { error: 'Jugador no encontrado.' };
    const t = room.territories[territoryId];
    if (!t || !t.open || t.owner !== p.id) return { error: 'Solo puedes construir en un territorio tuyo.' };
    if (t.wonder) return { error: `${t.name} ya tiene una Maravilla (${t.wonder.name}).` };
    if (!room.wonderDeck || !room.wonderDeck.length) return { error: 'Ya no quedan Maravillas por construir.' };
    if ((p.resources || 0) < WONDER_COST) return { error: `Te faltan Recursos (necesitas ${WONDER_COST}, tienes ${p.resources || 0}).` };
    p.resources -= WONDER_COST;
    t.wonder = room.wonderDeck.pop();
    log(room, `🏛️ ${p.name} construye ${t.wonder.name} en ${t.name} (${ownedWonders(room, p.id).length}/${WONDERS_TO_WIN} Maravillas).`);
    // La victoria cultural puede llegar en el momento mismo de construir la 3ª.
    if (ownedWonders(room, p.id).length >= WONDERS_TO_WIN) {
      endGame(room, p.id, 'cultura');
      return { ok: true };
    }
    emitRoom(room);
    return { ok: true };
  },

  submit_desafio_choice({ choice }, ctx) {
    const room = rooms[playerRoom[ctx.playerId]];
    if (!room || room.phase !== 'desafio') return { error: 'No es el momento.' };
    room.desafioResponses[ctx.playerId] = choice;
    emitRoom(room);
    if (Object.keys(room.desafioResponses).length >= room.players.length) resolveDesafio(room);
    return { ok: true };
  },

  continue(_, ctx) {
    const room = rooms[playerRoom[ctx.playerId]];
    if (!room) return { error: 'Sala no encontrada.' };
    if (['resolve', 'simposio', 'era_intro'].includes(room.phase)) advanceStep(room);
    return { ok: true };
  },
};

// ---------- servidor HTTP ----------

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp' };

function serveStatic(req, res, pathname) {
  let file = pathname === '/' ? '/index.html' : pathname;
  const full = path.join(PUBLIC_DIR, file);
  if (!full.startsWith(PUBLIC_DIR)) { res.writeHead(403); return res.end('Forbidden'); }
  fs.readFile(full, (err, data) => {
    if (err) { res.writeHead(404); return res.end('Not found'); }
    const ext = path.extname(full);
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  });
}

function collectBody(req, cb) {
  let body = '';
  req.on('data', (chunk) => { body += chunk; if (body.length > 1e6) req.destroy(); });
  req.on('end', () => { try { cb(null, body ? JSON.parse(body) : {}); } catch (e) { cb(e); } });
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  const pathname = url.pathname;

  if (pathname === '/events') {
    const playerId = url.searchParams.get('playerId');
    if (!playerId) { res.writeHead(400); return res.end('missing playerId'); }
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*',
    });
    res.write(': ok\n\n');
    sseClients.set(playerId, res);
    const code = playerRoom[playerId];
    if (code && rooms[code]) emitRoom(rooms[code]);
    const keepAlive = setInterval(() => { try { res.write(': ping\n\n'); } catch (e) {} }, 25000);
    req.on('close', () => {
      clearInterval(keepAlive);
      if (sseClients.get(playerId) === res) sseClients.delete(playerId);
      const roomCode = playerRoom[playerId];
      const room = roomCode && rooms[roomCode];
      if (room) { log(room, 'Un jugador se ha desconectado (puede volver a entrar).'); emitRoom(room); }
    });
    return;
  }

  if (pathname.startsWith('/api/') && req.method === 'POST') {
    const action = pathname.slice(5);
    if (!actions[action]) { res.writeHead(404); return res.end(JSON.stringify({ error: 'acción desconocida' })); }
    collectBody(req, (err, body) => {
      if (err) { res.writeHead(400); return res.end(JSON.stringify({ error: 'JSON inválido' })); }
      const playerId = body.playerId || url.searchParams.get('playerId');
      if (!playerId) { res.writeHead(400); return res.end(JSON.stringify({ error: 'falta playerId' })); }
      const result = actions[action](body, { playerId });
      res.writeHead(result && result.error ? 400 : 200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result || { ok: true }));
    });
    return;
  }

  if (pathname === '/api/new_id' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ playerId: newId() }));
  }

  serveStatic(req, res, pathname);
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`El Banquete escuchando en :${PORT}`));

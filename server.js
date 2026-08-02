// El Banquete — servidor sin dependencias externas: Node.js puro (http + Server-Sent Events).
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { REGION_POOLS, TERRITORIES_PER_ERA, ERA_INFO, TROOP_TYPES, ARCHETYPES, CHARACTER_DECKS, DESAFIOS, BOT_NAMES } = require('./data');

// Tamaño del lienzo en el que se calculan las coordenadas x,y de cada territorio (ver
// layoutTerritories). El cliente usa exactamente este mismo tamaño como viewBox del mapa SVG,
// así las coordenadas que manda el servidor encajan sin reescalados raros.
const MAP_W = 320;
const MAP_H = 380;

// Estos tiempos ya NO se muestran al jugador (el contador visible se quitó porque
// se buggeaba) — son solo una red de seguridad interna para que una partida nunca
// se quede colgada del todo si alguien no responde.
const ORDERS_TIME = 180000;
const DESAFIO_TIME = 90000;
const PUBLIC_DIR = path.join(__dirname, 'public');
const ARCHETYPE_KEYS = Object.keys(ARCHETYPES);
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
    id, name: name.slice(0, 20), archetype: null, reserve: 0, gloria: 0, characters: [], shield: false, isBot: !!isBot,
    resources: 0, troopLevels: { 1: 1, 2: 1, 3: 1 },
  };
}

function botDelay() {
  return BOT_MIN_DELAY + Math.random() * (BOT_MAX_DELAY - BOT_MIN_DELAY);
}

function addBots(room, count) {
  const usedNames = new Set(room.players.map((p) => p.name));
  const namePool = [...BOT_NAMES].sort(() => Math.random() - 0.5);
  const archPool = [...ARCHETYPE_KEYS].sort(() => Math.random() - 0.5);
  let archIdx = 0;
  for (let i = 0; i < count; i++) {
    const id = 'bot_' + newId();
    let name = namePool.find((n) => !usedNames.has(n)) || `Bot ${i + 1}`;
    usedNames.add(name);
    const bot = makePlayer(id, name, true);
    bot.archetype = archPool[archIdx % archPool.length];
    archIdx++;
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
// al generar el tablero; el resultado se guarda en cada territorio (t.x, t.y) y viaja tal cual al
// cliente, que solo tiene que pintar, no recalcular nada.
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

// Genera un tablero nuevo y distinto cada partida: elige TERRITORIES_PER_ERA regiones al azar de
// cada pool de Era (data.js tiene el doble de candidatas por Era) y las conecta con un grafo
// aleatorio — conectado dentro de cada Era, más un puente al azar con la Era anterior — y por
// último calcula la disposición orgánica de todo el conjunto (layoutTerritories).
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
  return territories;
}

function openEraTerritories(room, era) {
  const garrison = TROOP_TYPES[era].garrison;
  for (const id in room.territories) {
    if (room.territories[id].era === era) {
      room.territories[id].open = true;
      room.territories[id].armies = garrison;
      room.territories[id].owner = null;
    }
  }
}

function troopName(era, count) {
  const t = TROOP_TYPES[era] || TROOP_TYPES[1];
  return count === 1 ? t.singular : t.plural;
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
function publicPlayer(p) {
  return {
    id: p.id, name: p.name, archetype: p.archetype, gloria: p.gloria, reserve: p.reserve,
    characterCount: p.characters.length, isBot: !!p.isBot,
    resources: p.resources || 0, troopLevels: p.troopLevels || { 1: 1, 2: 1, 3: 1 },
  };
}

function publicState(room) {
  return {
    code: room.code,
    phase: room.phase,
    era: room.era,
    round: room.round || null,
    maxPlayers: room.maxPlayers,
    archetypes: ARCHETYPES,
    troopTypes: TROOP_TYPES,
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
      if (owned.length === 4) gain += 1;
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
  room.stepIdx++;
  if (room.stepIdx >= room.steps.length) {
    if (room.era < 3) {
      room.era++;
      room.steps = buildEraSteps();
      room.stepIdx = 0;
      runStep(room);
    } else {
      room.phase = 'fin';
      const ranking = [...room.players].sort((a, b) => {
        if (b.gloria !== a.gloria) return b.gloria - a.gloria;
        return ownedTerritories(room, b.id).length - ownedTerritories(room, a.id).length;
      });
      room.finalResult = ranking.map((p) => ({ name: p.name, gloria: p.gloria, territorios: ownedTerritories(room, p.id).length }));
      room.phaseEndsAt = null;
      emitRoom(room);
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

  // Objetivos "normales": vecinos de un territorio propio con legiones de sobra.
  const regularOptions = [];
  for (const src of mine) {
    if (src.armies <= 1) continue;
    for (const nId of src.neighbors) {
      const n = room.territories[nId];
      if (n && n.open && n.owner !== bot.id) regularOptions.push({ src, target: n });
    }
  }

  const roll = Math.random();

  if (bot.reserve >= 1 && bootstrapTargets.length && roll < 0.4) {
    const target = bootstrapTargets[Math.floor(Math.random() * bootstrapTargets.length)];
    const amount = Math.max(1, Math.min(bot.reserve, 1 + Math.floor(Math.random() * 2)));
    return { type: 'atacar', to: target.id, amount };
  }
  if (regularOptions.length && roll < 0.65) {
    const pick = regularOptions[Math.floor(Math.random() * regularOptions.length)];
    const maxAmount = pick.src.armies - 1;
    const amount = Math.max(1, Math.min(maxAmount, 1 + Math.floor(Math.random() * 2)));
    return { type: 'atacar', to: pick.target.id, from: pick.src.id, amount };
  }
  if (bot.reserve >= 1 && mine.length && roll < 0.85) {
    const target = mine[Math.floor(Math.random() * mine.length)];
    const amount = Math.max(1, Math.min(bot.reserve, 1 + Math.floor(Math.random() * 2)));
    return { type: 'reforzar', territoryId: target.id, amount };
  }
  if (roll < 0.93) return { type: 'reclutar' };
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
  for (let era = 1; era <= room.era; era++) {
    const troopDef = TROOP_TYPES[era];
    const currentLevel = bot.troopLevels[era] || 1;
    const nextLevelDef = troopDef.levels.find((l) => l.level === currentLevel + 1);
    if (nextLevelDef && (bot.resources || 0) >= nextLevelDef.cost + 3) affordable.push(era);
  }
  if (affordable.length) {
    const era = affordable[Math.floor(Math.random() * affordable.length)];
    actions.level_up_troop({ era }, { playerId: bot.id });
  }
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
        resolveLog.push(`César le roba 1 ${troopName(t.era, 1)} a ${t.name}.`);
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
          resolveLog.push(`El Imperio de Gengis Kan debilita ${t.name} de ${rival.name} (-1 ${troopName(t.era, 1)}).`);
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
        const bonus = p.archetype === 'comerciante' && amt > 0 ? 1 : 0;
        t.armies += amt + bonus; p.reserve -= amt;
        resolveLog.push(`${p.name} refuerza ${t.name} con ${amt} ${troopName(t.era, amt)}.` + (bonus ? ` (+1 ${troopName(t.era, 1)} gratis del Comerciante)` : ''));
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
          const info = ownedTerritories(room, target.id).map((t) => `${t.name}(${t.armies})`).join(', ') || 'ningún territorio';
          notices[p.id] = { type: 'spy_result', target: target.name, info };
          resolveLog.push(`${p.name} espía a ${target.name}.`);
          if (p.archetype === 'estratega') {
            p.reserve += 1;
            resolveLog.push(`${p.name} (Estratega) gana 1 ${troopName(room.era, 1)} extra por espiar.`);
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

      const isBootstrap = room.round === 1 && t.era === room.era && t.owner === null;
      let source = null;
      let amount;

      if (isBootstrap) {
        // Territorio libre en la 1ª ronda de la Era: se desembarca directamente desde la reserva.
        amount = Math.max(1, Math.min(o.amount || 0, p.reserve));
        if (amount < 1 || p.reserve < 1) { resolveLog.push(`${p.name} no tiene ${troopName(t.era, 2)} de reserva para desembarcar en ${t.name}.`); continue; }
      } else {
        // Ataque normal: hace falta un territorio propio vecino con legiones de sobra —
        // las unidades que atacan son, literalmente, las que hay estacionadas ahí.
        source = room.territories[o.from];
        if (!source || source.owner !== p.id || !source.neighbors.includes(t.id)) {
          resolveLog.push(`${p.name} no tiene un territorio de origen válido junto a ${t.name}.`);
          continue;
        }
        amount = Math.max(1, Math.min(o.amount || 0, source.armies - 1));
        if (amount < 1 || source.armies < 2) { resolveLog.push(`${p.name} no tiene ${troopName(source.era, 2)} de sobra en ${source.name} para atacar.`); continue; }
      }

      if (isBootstrap) p.reserve -= amount;

      const defenderPlayer = t.owner ? playerById(room, t.owner) : null;
      const dBonus = !!(defenderPlayer && (defenderPlayer.archetype === 'filosofo' || defenderPlayer.extraDefenseDie));
      const aBonus = p.archetype === 'explorador' && isBootstrap;
      // Nivel de la tropa: source.era es de dónde salen las tropas atacantes (o t.era si vienen
      // directamente de la reserva al desembarcar en un territorio libre); t.era es la tropa que
      // defiende. Cada nivel por encima de 1 añade +1 dado; el nivel 3 además gana los empates.
      const attackEra = source ? source.era : t.era;
      const aTroopDef = TROOP_TYPES[attackEra] || TROOP_TYPES[1];
      const aLevelNum = (p.troopLevels && p.troopLevels[attackEra]) || 1;
      const aLevel = (aTroopDef.levels && aTroopDef.levels.find((l) => l.level === aLevelNum)) || { diceBonus: 0, winsTies: false };
      const dTroopDef = TROOP_TYPES[t.era] || TROOP_TYPES[1];
      const dLevelNum = (defenderPlayer && defenderPlayer.troopLevels && defenderPlayer.troopLevels[t.era]) || 1;
      const dLevel = (dTroopDef.levels && dTroopDef.levels.find((l) => l.level === dLevelNum)) || { diceBonus: 0, winsTies: false };
      const aDice = roll(Math.min(amount, 3) + (aBonus ? 1 : 0) + aLevel.diceBonus);
      const dDice = roll(Math.min(t.armies, 2) + (dBonus ? 1 : 0) + dLevel.diceBonus);
      let aLoss = 0, dLoss = 0;
      const cmp = Math.min(aDice.length, dDice.length);
      for (let i = 0; i < cmp; i++) {
        if (aDice[i] > dDice[i]) dLoss++;
        else if (aDice[i] < dDice[i]) aLoss++;
        else if (aLevel.winsTies && !dLevel.winsTies) dLoss++; // empate: normalmente gana quien defiende, salvo tropa de élite atacante
        else aLoss++;
      }
      if (p.shield && aLoss > 0) { aLoss = Math.max(0, aLoss - 1); p.shield = false; resolveLog.push(`${p.name} usa el escudo de Diógenes y evita 1 baja.`); }
      if (p.archetype === 'guerrero' && aLoss > 0) { aLoss = Math.max(0, aLoss - 1); resolveLog.push(`${p.name} (Guerrero) evita 1 baja en combate.`); }
      const survivors = amount - aLoss;
      t.armies = Math.max(0, t.armies - dLoss);
      const originTxt = source ? ` desde ${source.name}` : '';

      if (t.armies <= 0 && survivors > 0) {
        const prevOwnerName = defenderPlayer ? defenderPlayer.name : 'los locales';
        if (source) source.armies -= amount; // todas las legiones comprometidas abandonan el origen (bajas + las que se mudan)
        t.owner = p.id; t.armies = survivors;
        resolveLog.push(`${p.name} conquista ${t.name}${originTxt} con ${survivors} ${troopName(t.era, survivors)} (antes de ${prevOwnerName}). ${prevOwnerName} bebe ${dLoss} sorbo(s).`);
      } else {
        if (source) source.armies -= aLoss; // solo se pierden las bajas; el resto vuelve al origen
        t.armies = Math.max(1, t.armies);
        resolveLog.push(`${p.name} ataca ${t.name}${originTxt} y fracasa. ${p.name} bebe ${aLoss} sorbo(s).`);
      }
    }
  }

  // Ingreso de Recursos: 1 por cada territorio que controles al final de la ronda — cuanto más
  // mapa controlas, más rápido puedes mejorar tus tropas. Sin mensaje en el registro para no
  // saturarlo; el total se ve siempre en tu propia ficha.
  for (const p of room.players) {
    const owned = ownedTerritories(room, p.id).length;
    if (owned) p.resources = (p.resources || 0) + owned;
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
          resolveLog.push(`${p.name} fracasa en los Alpes (${dice}): pierde 1 ${t.length ? troopName(t[0].era, 1) : 'legión'} y bebe 2 sorbos.`);
        }
      } else { p.gloria += 1; resolveLog.push(`${p.name} va por mar, seguro: +1 Gloria.`); }
    }
  } else if (d.tipo === 'votacion') {
    const tally = {};
    for (const voted of Object.values(room.desafioResponses)) tally[voted] = (tally[voted] || 0) + 1;
    let winnerId = null, max = 0;
    for (const id in tally) if (tally[id] > max) { max = tally[id]; winnerId = id; }
    if (winnerId) {
      const winner = playerById(room, winnerId);
      let gain = 2;
      if (winner.archetype === 'diplomatico') gain *= 2;
      winner.gloria += gain;
      resolveLog.push(`${winner.name} gana el debate con ${max} voto(s): +${gain} Gloria. Los demás beben 1 sorbo.`);
    } else resolveLog.push('Nadie votó a tiempo, el debate queda en tablas.');
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

  choose_archetype({ archetype }, ctx) {
    const room = rooms[playerRoom[ctx.playerId]];
    if (!room || room.phase !== 'lobby' || !ARCHETYPES[archetype]) return { error: 'No disponible.' };
    if (room.players.some((p) => p.archetype === archetype && p.id !== ctx.playerId)) return { error: 'Ese arquetipo ya está cogido.' };
    const p = playerById(room, ctx.playerId);
    if (p) p.archetype = archetype;
    emitRoom(room);
    return { ok: true };
  },

  start_game(_, ctx) {
    const room = rooms[playerRoom[ctx.playerId]];
    if (!room || room.hostId !== ctx.playerId) return { error: 'Solo el anfitrión puede empezar.' };
    if (room.players.length !== room.maxPlayers) return { error: `Hacen falta ${room.maxPlayers} jugadores.` };
    if (room.players.some((p) => !p.archetype)) return { error: 'Falta elegir Arquetipo.' };
    room.steps = buildEraSteps();
    room.stepIdx = 0;
    runStep(room);
    return { ok: true };
  },

  // Reinicia la partida sin tener que crear una sala nueva ni volver a compartir código:
  // vuelve al lobby, genera un mapa nuevo y resetea el progreso, pero conserva jugadores y arquetipos.
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
    for (const p of room.players) {
      p.gloria = 0;
      p.reserve = 0;
      p.characters = [];
      p.shield = false;
      p.extraDefenseDie = false;
      p.hideOrders = false;
      p.doubleEra3 = false;
      p.resources = 0;
      p.troopLevels = { 1: 1, 2: 1, 3: 1 };
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

  // Mejora PARA SIEMPRE (mientras dure la partida) el nivel de un tipo de tropa: sube el bonus de
  // dados de combate de ESE jugador para todas las tropas de esa Era, presentes y futuras. Cuesta
  // Recursos (crecientes por nivel) y solo se puede hacer sobre una Era ya empezada. No consume el
  // turno/orden de la ronda — es una decisión aparte, se puede hacer en cualquier momento.
  level_up_troop({ era }, ctx) {
    const room = rooms[playerRoom[ctx.playerId]];
    if (!room) return { error: 'Sala no encontrada.' };
    const eraNum = parseInt(era, 10);
    const troopDef = TROOP_TYPES[eraNum];
    if (!troopDef) return { error: 'Tipo de tropa no válido.' };
    if (eraNum > room.era) return { error: 'Esa Era todavía no ha empezado.' };
    const p = playerById(room, ctx.playerId);
    if (!p) return { error: 'Jugador no encontrado.' };
    if (!p.troopLevels) p.troopLevels = { 1: 1, 2: 1, 3: 1 };
    const currentLevel = p.troopLevels[eraNum] || 1;
    const nextLevelDef = troopDef.levels.find((l) => l.level === currentLevel + 1);
    if (!nextLevelDef) return { error: 'Esa tropa ya está al nivel máximo.' };
    if ((p.resources || 0) < nextLevelDef.cost) return { error: `Te faltan Recursos (necesitas ${nextLevelDef.cost}, tienes ${p.resources || 0}).` };
    p.resources -= nextLevelDef.cost;
    p.troopLevels[eraNum] = currentLevel + 1;
    log(room, `${p.name} mejora sus ${troopName(eraNum, 2)} a nivel ${currentLevel + 1}: ${nextLevelDef.name}.`);
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

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };

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

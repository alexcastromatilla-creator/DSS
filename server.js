// El Banquete — servidor sin dependencias externas: Node.js puro (http + Server-Sent Events).
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { TERRITORIES, ERA_INFO, ARCHETYPES, CHARACTER_DECKS, TRIVIA, DESAFIOS, BOT_NAMES } = require('./data');

const TRIVIA_TIME = 15000;
const ORDERS_TIME = 60000;
const DESAFIO_TIME = 30000;
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
  return { id, name: name.slice(0, 20), archetype: null, reserve: 0, gloria: 0, characters: [], shield: false, isBot: !!isBot };
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

function freshTerritories() {
  const t = {};
  for (const id in TERRITORIES) t[id] = { ...TERRITORIES[id], id, owner: null, armies: 0, open: false };
  return t;
}

function openEraTerritories(room, era) {
  for (const id in room.territories) {
    if (room.territories[id].era === era) {
      room.territories[id].open = true;
      room.territories[id].armies = 2;
      room.territories[id].owner = null;
    }
  }
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
    { p: 'trivia', round: 1 }, { p: 'orders', round: 1 },
    { p: 'trivia', round: 2 }, { p: 'orders', round: 2 },
    { p: 'desafio' },
    { p: 'trivia', round: 3 }, { p: 'orders', round: 3 },
    { p: 'simposio' },
  ];
}

function playerById(room, id) { return room.players.find((p) => p.id === id); }
function ownedTerritories(room, playerId, era) {
  return Object.values(room.territories).filter((t) => t.owner === playerId && (era ? t.era === era : true));
}
function hasAdjacentOwned(room, playerId, targetId) {
  const target = room.territories[targetId];
  return target.neighbors.some((nId) => room.territories[nId] && room.territories[nId].owner === playerId && room.territories[nId].armies > 0);
}

function publicPlayer(p) {
  return { id: p.id, name: p.name, archetype: p.archetype, gloria: p.gloria, reserve: p.reserve, characterCount: p.characters.length, isBot: !!p.isBot };
}

function publicState(room) {
  return {
    code: room.code,
    phase: room.phase,
    era: room.era,
    round: room.round || null,
    maxPlayers: room.maxPlayers,
    archetypes: ARCHETYPES,
    eraInfo: ERA_INFO[room.era],
    territories: room.territories,
    players: room.players.map(publicPlayer),
    log: room.log,
    question: room.phase === 'trivia' ? { q: room.currentQuestion.q, options: room.currentQuestion.options } : null,
    questionAnswered: room.phase === 'trivia' ? Object.keys(room.questionAnswers) : [],
    ordersSubmitted: room.phase === 'orders' ? Object.keys(room.orders) : [],
    desafio: room.phase === 'desafio' ? room.currentDesafio : null,
    desafioResponses: room.phase === 'desafio' ? Object.keys(room.desafioResponses) : [],
    resolveLog: room.phase === 'resolve' ? room.resolveLog : null,
    simposioResult: room.phase === 'simposio' ? room.simposioResult : null,
    finalResult: room.phase === 'fin' ? room.finalResult : null,
    phaseEndsAt: room.phaseEndsAt || null,
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

  if (step.p === 'trivia') {
    const bank = TRIVIA[room.era];
    room.currentQuestion = bank[Math.floor(Math.random() * bank.length)];
    room.questionAnswers = {};
    room.tacticalBonus = {};
    room.firstCorrect = null;
    room.phaseEndsAt = Date.now() + TRIVIA_TIME;
    emitRoom(room);
    scheduleBots(room);
    room.timer = setTimeout(() => advanceStep(room), TRIVIA_TIME);
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

function allAnswered(room) { return Object.keys(room.questionAnswers).length >= room.players.length; }
function allOrdered(room) { return Object.keys(room.orders).length >= room.players.length; }

// ---------- IA de los bots ----------

function botPickOrder(room, bot) {
  const territories = Object.values(room.territories).filter((t) => t.open);
  const mine = territories.filter((t) => t.owner === bot.id);
  const others = territories.filter((t) => t.owner !== bot.id);
  const reachable = others.filter((t) => {
    const isBootstrap = room.round === 1 && t.era === room.era && t.owner === null;
    return isBootstrap || hasAdjacentOwned(room, bot.id, t.id);
  });
  const roll = Math.random();

  if (bot.reserve >= 1 && reachable.length && roll < 0.45) {
    const target = reachable[Math.floor(Math.random() * reachable.length)];
    const amount = Math.max(1, Math.min(bot.reserve, 1 + Math.floor(Math.random() * 2)));
    return { type: 'atacar', to: target.id, amount };
  }
  if (bot.reserve >= 1 && mine.length && roll < 0.65) {
    const target = mine[Math.floor(Math.random() * mine.length)];
    const amount = Math.max(1, Math.min(bot.reserve, 1 + Math.floor(Math.random() * 2)));
    return { type: 'reforzar', territoryId: target.id, amount };
  }
  if (roll < 0.85) return { type: 'reclutar' };
  const others_ = room.players.filter((p) => p.id !== bot.id);
  if (others_.length) return { type: 'espiar', targetId: others_[Math.floor(Math.random() * others_.length)].id };
  return { type: 'reclutar' };
}

function scheduleBots(room) {
  const phase = room.phase;
  const bots = room.players.filter((p) => p.isBot);
  for (const bot of bots) {
    setTimeout(() => {
      const r = rooms[room.code];
      if (!r || r.phase !== phase) return; // la fase ya cambió, no hacer nada
      if (phase === 'trivia') {
        const idx = Math.floor(Math.random() * r.currentQuestion.options.length);
        actions.submit_answer({ optionIndex: idx }, { playerId: bot.id });
      } else if (phase === 'orders') {
        const order = botPickOrder(r, bot);
        actions.submit_order({ order }, { playerId: bot.id });
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
        resolveLog.push(`César le roba 1 legión a ${t.name}.`);
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
          resolveLog.push(`El Imperio de Gengis Kan debilita ${t.name} de ${rival.name}.`);
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
        resolveLog.push(`${p.name} refuerza ${t.name} con ${amt} legiones.` + (bonus ? ' (+1 legión gratis del Comerciante)' : ''));
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
            resolveLog.push(`${p.name} (Estratega) gana 1 legión extra por espiar.`);
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
      if (!t || !t.open) continue;
      const amount = Math.max(1, Math.min(o.amount || 0, p.reserve));
      if (amount < 1 || p.reserve < 1) continue;

      const isBootstrap = room.round === 1 && t.era === room.era && t.owner === null;
      const canAttack = isBootstrap || hasAdjacentOwned(room, p.id, o.to);
      if (!canAttack) { resolveLog.push(`${p.name} no tiene forma de alcanzar ${t.name} todavía.`); continue; }
      if (t.owner === p.id) continue;

      p.reserve -= amount;
      const defenderPlayer = t.owner ? playerById(room, t.owner) : null;
      const dBonus = !!(defenderPlayer && (defenderPlayer.archetype === 'filosofo' || defenderPlayer.extraDefenseDie));
      const aBonus = p.archetype === 'explorador' && isBootstrap;
      const aDice = roll(Math.min(amount, 3) + (room.tacticalBonus[p.id] ? 1 : 0) + (aBonus ? 1 : 0));
      const dDice = roll(Math.min(t.armies, 2) + (dBonus ? 1 : 0));
      let aLoss = 0, dLoss = 0;
      const cmp = Math.min(aDice.length, dDice.length);
      for (let i = 0; i < cmp; i++) { if (aDice[i] > dDice[i]) dLoss++; else aLoss++; }
      if (p.shield && aLoss > 0) { aLoss = Math.max(0, aLoss - 1); p.shield = false; resolveLog.push(`${p.name} usa el escudo de Diógenes y evita 1 baja.`); }
      if (p.archetype === 'guerrero' && aLoss > 0) { aLoss = Math.max(0, aLoss - 1); resolveLog.push(`${p.name} (Guerrero) evita 1 baja en combate.`); }
      const survivors = amount - aLoss;
      t.armies = Math.max(0, t.armies - dLoss);

      if (t.armies <= 0 && survivors > 0) {
        const prevOwnerName = defenderPlayer ? defenderPlayer.name : 'los locales';
        t.owner = p.id; t.armies = survivors;
        resolveLog.push(`${p.name} conquista ${t.name} (antes de ${prevOwnerName}). ${prevOwnerName} bebe ${dLoss} sorbo(s).`);
      } else {
        t.armies = Math.max(1, t.armies);
        resolveLog.push(`${p.name} ataca ${t.name} y fracasa. ${p.name} bebe ${aLoss} sorbo(s).`);
      }
    }
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
          resolveLog.push(`${p.name} fracasa en los Alpes (${dice}): pierde 1 legión y bebe 2 sorbos.`);
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
      territories: freshTerritories(), log: [], desafioCursor: 0, maxPlayers: total,
    };
    rooms[code] = room;
    room.players.push(makePlayer(ctx.playerId, name || 'Jugador', false));
    playerRoom[ctx.playerId] = code;
    addBots(room, bots);
    emitRoom(room);
    return { ok: true, code };
  },

  join_room({ code, name }, ctx) {
    code = (code || '').toUpperCase();
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

  submit_answer({ optionIndex }, ctx) {
    const room = rooms[playerRoom[ctx.playerId]];
    if (!room || room.phase !== 'trivia') return { error: 'No es el momento.' };
    if (room.questionAnswers[ctx.playerId] !== undefined) return { error: 'Ya has respondido.' };
    room.questionAnswers[ctx.playerId] = optionIndex;
    const notices = {};
    if (optionIndex === room.currentQuestion.correct && !room.firstCorrect) {
      room.firstCorrect = ctx.playerId;
      room.tacticalBonus[ctx.playerId] = true;
      notices[ctx.playerId] = { type: 'trivia_bonus' };
    }
    emitRoom(room, notices);
    if (allAnswered(room)) advanceStep(room);
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

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

// Lienzo del mapa (el cliente usa exactamente este viewBox).
const MAP_W = 360;
const MAP_H = 470;

// Red de seguridad interna (sin contador visible).
const ORDERS_TIME = 240000;
const DESAFIO_TIME = 90000;
const PUBLIC_DIR = path.join(__dirname, 'public');
const LEADER_KEYS = Object.keys(LEADERS);
const MIN_PLAYERS = 2;
const MAX_PLAYERS = 6;
const BOT_MIN_DELAY = 700;
const BOT_MAX_DELAY = 2600;
// Levas: comprar tropas de reserva con Recursos (una de las 8 órdenes).
const LEVAS_COST = 3;
const LEVAS_GAIN = 2;
// Escándalo por atacar a tu cónyuge: divorcio + castigo.
const SCANDAL_GLORIA = 2;

const rooms = {};
const playerRoom = {};
const sseClients = new Map();

// ---------- utilidades ----------

function roll(n) {
  const out = [];
  for (let i = 0; i < n; i++) out.push(1 + Math.floor(Math.random() * 6));
  return out.sort((a, b) => b - a);
}
function makeCode() {
  const letters = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  let code;
  do { code = Array.from({ length: 4 }, () => letters[Math.floor(Math.random() * letters.length)]).join(''); } while (rooms[code]);
  return code;
}
function newId() { return crypto.randomBytes(8).toString('hex'); }
function makePlayer(id, name, isBot) {
  return {
    id, name: name.slice(0, 20), leader: null, reserve: 0, gloria: 0, characters: [], shield: false, isBot: !!isBot,
    resources: 0, troopLevels: { inf: 1, cab: 1, arq: 1 }, married: null, proposal: null,
  };
}
function botDelay() { return BOT_MIN_DELAY + Math.random() * (BOT_MAX_DELAY - BOT_MIN_DELAY); }
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

// =====================================================================
// MAPA CONTINENTAL — nada de manchas circulares: una máscara de continente
// tipo "Europa" (banda principal + penínsulas colgando al sur + islas),
// distinta en cada partida. Los territorios se colocan DENTRO de la máscara
// (Era I en penínsulas e islas del sur, Era II en el centro, Era III al
// norte), y cada provincia es su celda de Voronoi recortada a la máscara.
// Las aristas de vecindad que cruzan mar se marcan como rutas marítimas
// (línea discontinua en el mapa, como en el Risk).
// =====================================================================

function makeMask() {
  const R = (a, b) => a + Math.random() * (b - a);
  const shapes = []; // {x,y,rx,ry,rot,ph1,ph2} elipses con ruido angular en el borde
  function addShape(x, y, rx, ry, rot) {
    shapes.push({
      x: Math.max(rx * 0.5 + 10, Math.min(MAP_W - rx * 0.5 - 10, x)),
      y: Math.max(36, Math.min(MAP_H - 30, y)),
      rx, ry, rot,
      ph1: R(0, Math.PI * 2), ph2: R(0, Math.PI * 2),
    });
  }
  // Banda continental principal (norte/centro), 3 lóbulos encadenados.
  let cx = R(78, 108), cy = R(118, 150);
  const band = [];
  for (let i = 0; i < 3; i++) {
    addShape(cx, cy, R(66, 92), R(50, 66), R(-0.5, 0.5));
    band.push(shapes.length - 1);
    cx += R(78, 104); cy += R(-26, 30);
  }
  // 2-3 penínsulas colgando hacia el sur (como Iberia/Italia/Grecia).
  const peninsulas = []; // arrays de índices de shapes
  const nPen = 2 + (Math.random() < 0.65 ? 1 : 0);
  const usedBases = shuffle(band);
  for (let i = 0; i < nPen; i++) {
    const base = shapes[usedBases[i % usedBases.length]];
    const bx = base.x + R(-base.rx * 0.45, base.rx * 0.45);
    const by = base.y + base.ry * R(0.5, 0.8);
    const ang = Math.PI / 2 + R(-0.5, 0.5);
    const len = R(96, 140), wid = R(34, 46);
    const chain = [];
    for (let k = 0; k < 3; k++) {
      const t = (k + 0.6) / 3;
      addShape(bx + Math.cos(ang) * len * t, by + Math.sin(ang) * len * t,
        wid * (1.15 - t * 0.35), wid * (1.05 - t * 0.2), ang + R(-0.2, 0.2));
      chain.push(shapes.length - 1);
    }
    peninsulas.push(chain);
  }
  // 1-2 islas al sur, separadas del continente.
  const islands = [];
  const nIsl = 1 + (Math.random() < 0.6 ? 1 : 0);
  for (let i = 0; i < nIsl; i++) {
    addShape(R(60, MAP_W - 60), R(MAP_H - 92, MAP_H - 48), R(28, 42), R(22, 32), R(0, Math.PI));
    islands.push(shapes.length - 1);
  }

  // ¿(x,y) es tierra? — dentro de alguna elipse, con el borde ondulado
  // (senos por ángulo: cabos y bahías, nada de circunferencias perfectas).
  function contains(x, y) {
    for (const s of shapes) {
      const dx = x - s.x, dy = y - s.y;
      const c = Math.cos(-s.rot), si = Math.sin(-s.rot);
      const lx = dx * c - dy * si, ly = dx * si + dy * c;
      const th = Math.atan2(ly, lx);
      const wob = 1 + 0.14 * Math.sin(3 * th + s.ph1) + 0.08 * Math.sin(7 * th + s.ph2);
      const d = (lx * lx) / (s.rx * s.rx) + (ly * ly) / (s.ry * s.ry);
      if (d <= wob) return true;
    }
    return false;
  }
  // "Profundidad" tierra adentro (0 = borde, mayor = interior) para trazar ríos hacia el mar.
  function edgeNorm(x, y) {
    let best = Infinity;
    for (const s of shapes) {
      const dx = x - s.x, dy = y - s.y;
      const c = Math.cos(-s.rot), si = Math.sin(-s.rot);
      const lx = dx * c - dy * si, ly = dx * si + dy * c;
      const d = Math.sqrt((lx * lx) / (s.rx * s.rx) + (ly * ly) / (s.ry * s.ry));
      if (d < best) best = d;
    }
    return best; // <1 dentro, 1 en el borde
  }
  function randomPointIn(idx, spread) {
    const s = shapes[idx];
    for (let i = 0; i < 30; i++) {
      const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * spread;
      const lx = Math.cos(a) * s.rx * r, ly = Math.sin(a) * s.ry * r;
      const c = Math.cos(s.rot), si = Math.sin(s.rot);
      const x = s.x + lx * c - ly * si, y = s.y + lx * si + ly * c;
      if (contains(x, y)) return { x, y };
    }
    return { x: s.x, y: s.y };
  }
  return { shapes, band, peninsulas, islands, contains, edgeNorm, randomPointIn };
}

// Coloca los territorios dentro de la máscara respetando el grafo de vecindad:
// muelles por arista + repulsión + tirón hacia su ancla regional, y un tirón
// fuerte de vuelta si un nodo se sale del continente.
function placeSites(territories, mask) {
  const ids = Object.keys(territories);
  const anchors = {};
  // Anclas: Era I → penínsulas e islas del sur; Era II → banda baja; Era III → banda alta.
  const southSpots = [];
  for (const chain of mask.peninsulas) southSpots.push(chain[0], chain[1], chain[2]);
  for (const isl of mask.islands) southSpots.push(isl);
  let southIdx = 0;
  for (const id of ids) {
    const t = territories[id];
    if (t.era === 1) {
      const spot = southSpots[southIdx % southSpots.length]; southIdx++;
      anchors[id] = mask.randomPointIn(spot, 0.55);
    } else if (t.era === 2) {
      const b = mask.band[Math.floor(Math.random() * mask.band.length)];
      const p = mask.randomPointIn(b, 0.6); p.y += 12;
      anchors[id] = p;
    } else {
      const b = mask.band[Math.floor(Math.random() * mask.band.length)];
      const p = mask.randomPointIn(b, 0.55); p.y -= mask.shapes[b].ry * 0.3;
      anchors[id] = p;
    }
  }
  const pos = {}, vel = {};
  ids.forEach((id) => { pos[id] = { x: anchors[id].x, y: anchors[id].y }; vel[id] = { x: 0, y: 0 }; });

  const REP = 950, SPR = 0.022, IDEAL = 44, DAMP = 0.8, ANCH = 0.028, KEEPIN = 0.3;
  for (let iter = 0; iter < 220; iter++) {
    const f = {};
    ids.forEach((id) => { f[id] = { x: 0, y: 0 }; });
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const a = pos[ids[i]], b = pos[ids[j]];
        let dx = a.x - b.x, dy = a.y - b.y;
        let d2 = dx * dx + dy * dy;
        if (d2 < 4) { dx = ((i * 37 + j * 13) % 7) - 3 || 0.5; dy = ((i * 11 + j * 29) % 7) - 3 || 0.5; d2 = dx * dx + dy * dy; }
        const d = Math.sqrt(d2), fo = REP / d2;
        f[ids[i]].x += (dx / d) * fo; f[ids[i]].y += (dy / d) * fo;
        f[ids[j]].x -= (dx / d) * fo; f[ids[j]].y -= (dy / d) * fo;
      }
    }
    ids.forEach((id) => {
      (territories[id].neighbors || []).forEach((nId) => {
        if (nId < id) return;
        const a = pos[id], b = pos[nId];
        const dx = b.x - a.x, dy = b.y - a.y;
        const d = Math.max(1, Math.sqrt(dx * dx + dy * dy));
        const fo = SPR * (d - IDEAL);
        f[id].x += (dx / d) * fo; f[id].y += (dy / d) * fo;
        f[nId].x -= (dx / d) * fo; f[nId].y -= (dy / d) * fo;
      });
    });
    ids.forEach((id) => {
      f[id].x += (anchors[id].x - pos[id].x) * ANCH;
      f[id].y += (anchors[id].y - pos[id].y) * ANCH;
      if (!mask.contains(pos[id].x, pos[id].y)) {
        f[id].x += (anchors[id].x - pos[id].x) * KEEPIN;
        f[id].y += (anchors[id].y - pos[id].y) * KEEPIN;
      }
    });
    ids.forEach((id) => {
      vel[id].x = (vel[id].x + f[id].x) * DAMP;
      vel[id].y = (vel[id].y + f[id].y) * DAMP;
      pos[id].x += vel[id].x; pos[id].y += vel[id].y;
    });
  }
  // Nadie fuera del continente, y separación mínima entre capitales.
  ids.forEach((id) => { if (!mask.contains(pos[id].x, pos[id].y)) pos[id] = { ...anchors[id] }; });
  for (let k = 0; k < 50; k++) {
    let moved = false;
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const a = pos[ids[i]], b = pos[ids[j]];
        const dx = b.x - a.x, dy = b.y - a.y;
        const d = Math.sqrt(dx * dx + dy * dy) || 0.5;
        if (d < 34) {
          const push = (34 - d) / 2, ux = (dx / d) || 0.7, uy = (dy / d) || 0.7;
          const na = { x: a.x - ux * push, y: a.y - uy * push };
          const nb = { x: b.x + ux * push, y: b.y + uy * push };
          if (mask.contains(na.x, na.y)) { pos[ids[i]] = na; moved = true; }
          if (mask.contains(nb.x, nb.y)) { pos[ids[j]] = nb; moved = true; }
        }
      }
    }
    if (!moved) break;
  }
  ids.forEach((id) => {
    territories[id].x = Math.round(Math.max(14, Math.min(MAP_W - 14, pos[id].x)));
    territories[id].y = Math.round(Math.max(14, Math.min(MAP_H - 14, pos[id].y)));
  });
}

// Provincia = celda de Voronoi ∩ continente, muestreada con rayos y suavizada.
function computeShapes(territories, mask) {
  const sites = Object.keys(territories).map((id) => ({ id, x: territories[id].x, y: territories[id].y }));
  function nearestId(px, py) {
    let best = null, bd = Infinity;
    for (const s of sites) { const dx = s.x - px, dy = s.y - py, d = dx * dx + dy * dy; if (d < bd) { bd = d; best = s.id; } }
    return best;
  }
  const RAYS = 44, EDGE = 6;
  let sHashSeed = 0;
  for (const s of sites) {
    sHashSeed++;
    const pts = [];
    for (let k = 0; k < RAYS; k++) {
      const th = (k / RAYS) * Math.PI * 2, ct = Math.cos(th), st = Math.sin(th);
      let lo = 0, hi = 150;
      for (let i = 0; i < 10; i++) {
        const m = (lo + hi) / 2, px = s.x + ct * m, py = s.y + st * m;
        const ok = px >= EDGE && px <= MAP_W - EDGE && py >= EDGE && py <= MAP_H - EDGE
          && mask.contains(px, py) && nearestId(px, py) === s.id;
        if (ok) lo = m; else hi = m;
      }
      // Rugosidad "a mano" directamente en la geometría (ruido por vértice, determinista):
      // así el cliente NO necesita filtros SVG de desplazamiento — que son carísimos de
      // rasterizar y causaban parpadeos/velos en móviles lentos y capturas.
      const wob = Math.sin(k * 2.7 + sHashSeed * 1.7) * 1.6 + Math.sin(k * 6.1 + sHashSeed * 3.1) * 1.1;
      const r = Math.max(0, lo + wob * Math.min(1, lo / 18));
      pts.push([s.x + ct * r, s.y + st * r]);
    }
    const sm = [];
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length];
      sm.push([a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25]);
      sm.push([a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75]);
    }
    territories[s.id].path = 'M' + sm.map((p) => `${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join('L') + 'Z';
  }
}

// Aristas de vecindad que cruzan mar → rutas marítimas (se dibujan discontinuas).
function computeSeaRoutes(territories, mask) {
  const routes = [];
  const seen = new Set();
  for (const id in territories) {
    for (const nId of territories[id].neighbors) {
      const key = id < nId ? id + '|' + nId : nId + '|' + id;
      if (seen.has(key)) continue;
      seen.add(key);
      const a = territories[id], b = territories[nId];
      let sea = false;
      for (let i = 1; i < 11; i++) {
        const t = i / 11;
        if (!mask.contains(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t)) { sea = true; break; }
      }
      if (sea) routes.push({ a: id, b: nId });
    }
  }
  return routes;
}

// Terreno por provincia (pinta el mapa y decide dónde nacen los ríos).
const TERRAIN_KEYS = ['grass', 'plains', 'forest', 'hills', 'mount', 'desert'];
function assignTerrain(territories) {
  const weights = { grass: 22, plains: 22, forest: 18, hills: 16, mount: 12, desert: 10 };
  const total = Object.values(weights).reduce((a, b) => a + b, 0);
  let anyMount = false;
  for (const id in territories) {
    let r = Math.random() * total;
    let chosen = 'grass';
    for (const k of TERRAIN_KEYS) { r -= weights[k]; if (r <= 0) { chosen = k; break; } }
    territories[id].terrain = chosen;
    if (chosen === 'mount') anyMount = true;
  }
  if (!anyMount) {
    const ids = Object.keys(territories);
    territories[ids[Math.floor(Math.random() * ids.length)]].terrain = 'mount';
  }
}

// Ríos: nacen en provincias de montaña y fluyen hacia la costa (bajando la
// "profundidad" de la máscara), con meandros. Como mucho 2 por mapa.
function computeRivers(territories, mask) {
  const rivers = [];
  const mountains = Object.values(territories).filter((t) => t.terrain === 'mount').slice(0, 2);
  for (const m of mountains) {
    let x = m.x, y = m.y;
    let dir = null;
    const pts = [[x, y]];
    for (let step = 0; step < 60; step++) {
      let bestDir = dir, bestScore = -Infinity;
      const candidates = dir === null
        ? Array.from({ length: 16 }, (_, i) => (i / 16) * Math.PI * 2)
        : [dir - 0.5, dir - 0.2, dir, dir + 0.2, dir + 0.5];
      for (const d of candidates) {
        const nx = x + Math.cos(d) * 12, ny = y + Math.sin(d) * 12;
        if (nx < 8 || nx > MAP_W - 8 || ny < 8 || ny > MAP_H - 8) continue;
        const score = mask.edgeNorm(nx, ny) + (Math.random() - 0.5) * 0.06;
        if (score > bestScore) { bestScore = score; bestDir = d; }
      }
      if (bestDir === null) break;
      dir = bestDir;
      x += Math.cos(dir) * 12; y += Math.sin(dir) * 12;
      pts.push([x, y]);
      if (!mask.contains(x, y)) break; // llegó al mar
    }
    if (pts.length < 3) continue; // demasiado corto para verse como río
    const sm = [];
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1];
      sm.push([a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25]);
      sm.push([a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75]);
    }
    rivers.push('M' + sm.map((p) => `${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join('L'));
  }
  // Si las montañas estaban pegadas a la costa y no salió ningún río digno, se intenta
  // desde colinas — así casi todos los mapas tienen al menos un río.
  if (!rivers.length) {
    const hills = Object.values(territories).filter((t) => t.terrain === 'hills').slice(0, 1);
    for (const m of hills) {
      let x = m.x, y = m.y, dir = null;
      const pts = [[x, y]];
      for (let step = 0; step < 60; step++) {
        let bestDir = dir, bestScore = -Infinity;
        const candidates = dir === null
          ? Array.from({ length: 16 }, (_, i) => (i / 16) * Math.PI * 2)
          : [dir - 0.5, dir - 0.2, dir, dir + 0.2, dir + 0.5];
        for (const d of candidates) {
          const nx = x + Math.cos(d) * 12, ny = y + Math.sin(d) * 12;
          if (nx < 8 || nx > MAP_W - 8 || ny < 8 || ny > MAP_H - 8) continue;
          const score = mask.edgeNorm(nx, ny) + (Math.random() - 0.5) * 0.06;
          if (score > bestScore) { bestScore = score; bestDir = d; }
        }
        if (bestDir === null) break;
        dir = bestDir;
        x += Math.cos(dir) * 12; y += Math.sin(dir) * 12;
        pts.push([x, y]);
        if (!mask.contains(x, y)) break;
      }
      if (pts.length >= 3) {
        const sm = [];
        for (let i = 0; i < pts.length - 1; i++) {
          const a = pts[i], b = pts[i + 1];
          sm.push([a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25]);
          sm.push([a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75]);
        }
        rivers.push('M' + sm.map((p) => `${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join('L'));
      }
    }
  }
  return rivers;
}

// Genera tablero completo: grafo aleatorio + continente + provincias + extras.
function generateBoard() {
  const chosenByEra = {};
  for (const era of [1, 2, 3]) {
    chosenByEra[era] = shuffle(REGION_POOLS[era]).slice(0, TERRITORIES_PER_ERA).map((r) => ({ ...r }));
  }
  const territories = {};
  for (const era of [1, 2, 3]) {
    for (const r of chosenByEra[era]) {
      r.era = era; r.neighbors = []; r.owner = null; r.armies = 0; r.open = false; r.wonder = null;
      r.unitClass = TROOP_CLASS_KEYS[Math.floor(Math.random() * TROOP_CLASS_KEYS.length)];
      territories[r.id] = r;
    }
  }
  for (const era of [1, 2, 3]) {
    const ids = chosenByEra[era].map((r) => r.id);
    const order = shuffle(ids);
    for (let i = 1; i < order.length; i++) {
      const b = order[Math.floor(Math.random() * i)];
      connectTerritories(territories, order[i], b);
    }
    const extraEdges = Math.max(1, Math.floor(ids.length / 4));
    for (let k = 0; k < extraEdges; k++) {
      const a = ids[Math.floor(Math.random() * ids.length)];
      const b = ids[Math.floor(Math.random() * ids.length)];
      connectTerritories(territories, a, b);
    }
  }
  for (const era of [2, 3]) {
    const prevIds = chosenByEra[era - 1].map((r) => r.id);
    for (const r of chosenByEra[era]) {
      const bridge = prevIds[Math.floor(Math.random() * prevIds.length)];
      connectTerritories(territories, r.id, bridge);
    }
  }

  const mask = makeMask();
  placeSites(territories, mask);
  computeShapes(territories, mask);
  assignTerrain(territories);
  const seaRoutes = computeSeaRoutes(territories, mask);
  const rivers = computeRivers(territories, mask);
  return { territories, seaRoutes, rivers };
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

function unitName(cls, era) {
  const c = TROOP_CLASSES[cls] || TROOP_CLASSES.inf;
  return (c.byEra[era] || c.byEra[1]).name;
}
function unitIcon(cls, era) {
  const c = TROOP_CLASSES[cls] || TROOP_CLASSES.inf;
  return (c.byEra[era] || c.byEra[1]).icon;
}
function counterOf(cls) {
  return TROOP_CLASS_KEYS.find((k) => TROOP_CLASSES[k].beats === cls) || TROOP_CLASS_KEYS[0];
}
function log(room, msg) {
  room.log.unshift(msg);
  room.log = room.log.slice(0, 12);
}
function pickDesafio(room) {
  const d = DESAFIOS[room.desafioCursor % DESAFIOS.length];
  room.desafioCursor++;
  return d;
}

// 5 rondas por Era, con Desafío tras la 2ª y la 4ª. 'resolve' sigue siendo transitoria.
function buildEraSteps() {
  return [
    { p: 'era_intro' },
    { p: 'orders', round: 1 },
    { p: 'orders', round: 2 },
    { p: 'desafio' },
    { p: 'orders', round: 3 },
    { p: 'orders', round: 4 },
    { p: 'desafio' },
    { p: 'orders', round: 5 },
    { p: 'simposio' },
  ];
}
const ROUNDS_PER_ERA = 5;

function playerById(room, id) { return room.players.find((p) => p.id === id); }
function ownedTerritories(room, playerId, era) {
  return Object.values(room.territories).filter((t) => t.owner === playerId && (era ? t.era === era : true));
}
function ownedWonders(room, playerId) {
  return Object.values(room.territories).filter((t) => t.wonder && t.owner === playerId);
}
function openCount(room) { return Object.values(room.territories).filter((t) => t.open).length; }
function dominationNeeded(room) { return Math.ceil(openCount(room) * DOMINATION_RATIO); }
function publicPlayer(p) {
  return {
    id: p.id, name: p.name, leader: p.leader, gloria: p.gloria, reserve: p.reserve,
    characterCount: p.characters.length, isBot: !!p.isBot,
    resources: p.resources || 0, troopLevels: p.troopLevels || { inf: 1, cab: 1, arq: 1 },
    married: p.married || null,
  };
}

// Resumen corto de una orden (para el espía y para el cónyuge).
function orderSummary(room, order) {
  if (!order) return 'sin orden todavía';
  switch (order.type) {
    case 'atacar': {
      const t = room.territories[order.to];
      const modo = order.mode === 'asedio' ? 'Asedio' : order.mode === 'incursion' ? 'Incursión' : 'Asalto';
      return `${modo} sobre ${t ? t.name : '???'}`;
    }
    case 'reforzar': {
      const t = room.territories[order.territoryId];
      return `Reforzar ${t ? t.name : '???'}`;
    }
    case 'levas': return 'Levas (comprar tropas)';
    case 'matrimonio': {
      const target = playerById(room, order.targetId);
      return `Proponer matrimonio a ${target ? target.name : '???'}`;
    }
    case 'reclutar': return 'Reclutar un Personaje';
    case 'espiar': {
      const target = playerById(room, order.targetId);
      return `Espiar a ${target ? target.name : '???'}`;
    }
    default: return order.type;
  }
}

function publicState(room) {
  return {
    code: room.code,
    phase: room.phase,
    era: room.era,
    round: room.round || null,
    roundsPerEra: ROUNDS_PER_ERA,
    maxPlayers: room.maxPlayers,
    leaders: LEADERS,
    troopClasses: TROOP_CLASSES,
    wonderCost: WONDER_COST,
    wondersToWin: WONDERS_TO_WIN,
    dominationNeeded: dominationNeeded(room),
    levasCost: LEVAS_COST,
    levasGain: LEVAS_GAIN,
    eraInfo: ERA_INFO[room.era],
    territories: room.territories,
    seaRoutes: room.seaRoutes || [],
    rivers: room.rivers || [],
    players: room.players.map(publicPlayer),
    log: room.log,
    ordersSubmitted: room.phase === 'orders' ? Object.keys(room.orders) : [],
    desafio: room.phase === 'desafio' ? room.currentDesafio : null,
    desafioResponses: room.phase === 'desafio' ? Object.keys(room.desafioResponses) : [],
    resolveLog: room.phase === 'resolve' ? room.resolveLog : null,
    battles: room.phase === 'resolve' ? room.battles || [] : [],
    mapFx: room.phase === 'resolve' ? room.mapFx || [] : [],
    simposioResult: room.phase === 'simposio' ? room.simposioResult : null,
    finalResult: room.phase === 'fin' ? room.finalResult : null,
    victory: room.phase === 'fin' ? room.victory || null : null,
  };
}

function pushToPlayer(playerId, payload) {
  const res = sseClients.get(playerId);
  if (res) { try { res.write(`data: ${JSON.stringify(payload)}\n\n`); } catch (e) { /* pipe roto */ } }
}

function emitRoom(room, notices = {}) {
  const state = publicState(room);
  for (const p of room.players) {
    const spouse = p.married ? playerById(room, p.married) : null;
    const you = {
      id: p.id, characters: p.characters, shield: p.shield,
      proposal: p.proposal ? { from: p.proposal.fromId, fromName: p.proposal.fromName } : null,
      spouse: spouse ? spouse.name : null,
      // Cónyuges: veis la orden secreta del otro en cuanto la envía.
      spouseOrder: (room.phase === 'orders' && spouse && room.orders && room.orders[spouse.id])
        ? orderSummary(room, room.orders[spouse.id]) : null,
    };
    pushToPlayer(p.id, { ...state, you, notice: notices[p.id] || null });
  }
}

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
    ? territories.filter((t) => t.era === room.era && t.owner === null) : [];

  const regularOptions = [];
  for (const src of mine) {
    if (src.armies <= 1) continue;
    for (const nId of src.neighbors) {
      const n = room.territories[nId];
      if (n && n.open && n.owner !== bot.id && n.owner !== bot.married) {
        regularOptions.push({ src, target: n, favorable: TROOP_CLASSES[src.unitClass].beats === n.unitClass });
      }
    }
  }
  regularOptions.sort((a, b) => (b.favorable ? 1 : 0) - (a.favorable ? 1 : 0));

  const r = Math.random();

  // Levas: si va corto de reserva y sobrado de Recursos.
  if ((bot.resources || 0) >= LEVAS_COST + 2 && bot.reserve <= 1 && r < 0.25) return { type: 'levas' };
  // Matrimonio: de vez en cuando, un bot soltero se declara.
  if (!bot.married && r < 0.07) {
    const candidates = room.players.filter((p) => p.id !== bot.id && !p.married);
    if (candidates.length) return { type: 'matrimonio', targetId: candidates[Math.floor(Math.random() * candidates.length)].id };
  }
  if (bot.reserve >= 1 && bootstrapTargets.length && r < 0.42) {
    const target = bootstrapTargets[Math.floor(Math.random() * bootstrapTargets.length)];
    const amount = Math.max(1, Math.min(bot.reserve, 1 + Math.floor(Math.random() * 2)));
    return { type: 'atacar', mode: 'asalto', to: target.id, amount, unitClass: counterOf(target.unitClass) };
  }
  if (regularOptions.length && r < 0.68) {
    const pick = regularOptions[Math.floor(Math.random() * Math.min(2, regularOptions.length))];
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
      if (!r || r.phase !== phase) return;
      if (phase === 'orders') {
        // Si tiene una propuesta de boda pendiente, responde antes de dar su orden.
        if (bot.proposal) actions.respond_marriage({ accept: Math.random() < 0.6 }, { playerId: bot.id });
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

// Escándalo por agredir a tu cónyuge: divorcio + castigo (se aplica una vez por agresión).
function maybeScandal(room, p, defenderPlayer, resolveLog) {
  if (defenderPlayer && p.married === defenderPlayer.id) {
    p.married = null;
    defenderPlayer.married = null;
    p.gloria = Math.max(0, p.gloria - SCANDAL_GLORIA);
    resolveLog.push(`💔 ¡ESCÁNDALO en ${defenderPlayer.name && ''}la corte! ${p.name} ataca a su cónyuge ${defenderPlayer.name}: divorcio inmediato, ${p.name} pierde ${SCANDAL_GLORIA} Gloria y bebe 3 sorbos.`);
    return true;
  }
  return false;
}

function resolveOrders(room) {
  clearTimeout(room.timer);
  const resolveLog = [];
  const notices = {};
  const battles = [];
  const mapFx = [];
  const order = [...room.players].sort(() => Math.random() - 0.5);

  // 1) Levas y refuerzos (economía primero).
  for (const p of order) {
    const o = room.orders[p.id];
    if (o && o.type === 'levas') {
      if ((p.resources || 0) >= LEVAS_COST) {
        p.resources -= LEVAS_COST;
        p.reserve += LEVAS_GAIN;
        resolveLog.push(`🪙 ${p.name} recluta levas: paga ${LEVAS_COST} Recursos y suma ${LEVAS_GAIN} tropas a su reserva.`);
      } else {
        resolveLog.push(`${p.name} intenta reclutar levas pero no tiene ${LEVAS_COST} Recursos.`);
      }
    }
    if (o && o.type === 'reforzar') {
      const t = room.territories[o.territoryId];
      if (t && t.owner === p.id) {
        const amt = Math.max(0, Math.min(o.amount || 0, p.reserve));
        t.armies += amt; p.reserve -= amt;
        resolveLog.push(`🛡️ ${p.name} refuerza ${t.name} con ${amt} tropa(s) de ${unitName(t.unitClass, t.era)}.`);
        if (amt > 0) mapFx.push({ type: 'plus', terrId: t.id, n: amt });
      }
    }
  }

  // 2) Matrimonios: la propuesta viaja; el destinatario la acepta/rechaza cuando quiera.
  for (const p of order) {
    const o = room.orders[p.id];
    if (o && o.type === 'matrimonio') {
      const target = playerById(room, o.targetId);
      if (!target || target.id === p.id) { resolveLog.push(`${p.name} propone matrimonio... a nadie en concreto. La corte murmura.`); continue; }
      if (p.married) { resolveLog.push(`${p.name} intenta proponer matrimonio ¡estando ya casado/a! La corte se escandaliza (bebe 1 sorbo).`); continue; }
      if (target.married) { resolveLog.push(`${p.name} propone matrimonio a ${target.name}, pero ya está casado/a con otra casa.`); continue; }
      target.proposal = { fromId: p.id, fromName: p.name };
      resolveLog.push(`💍 ${p.name} envía una propuesta de matrimonio dinástico a ${target.name}.`);
      notices[target.id] = { type: 'marriage_proposal', from: p.name };
    }
  }

  // 3) Espionaje (ahora también revela la orden del rival de esta ronda).
  for (const p of order) {
    const o = room.orders[p.id];
    if (o && o.type === 'espiar') {
      const target = playerById(room, o.targetId);
      if (target) {
        if (target.hideOrders) {
          resolveLog.push(`${p.name} intenta espiar a ${target.name}, pero Maquiavelo lo impide.`);
        } else {
          const info = ownedTerritories(room, target.id).map((t) => `${t.name}(${t.armies} ${unitIcon(t.unitClass, t.era)})`).join(', ') || 'ningún territorio';
          const ordenTxt = orderSummary(room, room.orders[target.id]);
          notices[p.id] = { type: 'spy_result', target: target.name, info, orden: ordenTxt };
          resolveLog.push(`🕵️ ${p.name} espía a ${target.name}.`);
          if (p.leader === 'anibal') {
            p.reserve += 1;
            resolveLog.push(`${p.name} (El Táctico) gana 1 tropa extra de reserva por espiar.`);
          }
        }
      }
    }
  }

  // 4) Reclutamiento de Personajes.
  for (const p of order) {
    const o = room.orders[p.id];
    if (o && o.type === 'reclutar') {
      const deck = CHARACTER_DECKS[room.era].filter((c) => !room.eraDeckTaken.has(c.id));
      if (deck.length === 0) { resolveLog.push(`${p.name} intenta reclutar, pero ya no quedan personajes en esta Era.`); continue; }
      const card = deck[Math.floor(Math.random() * deck.length)];
      room.eraDeckTaken.add(card.id);
      p.characters.push(card);
      resolveLog.push(`👑 ${p.name} recluta a ${card.name}.`);
      applyCharacterEffect(room, p, card, resolveLog);
    }
  }

  // 5) Combates.
  for (const p of order) {
    const o = room.orders[p.id];
    if (o && o.type === 'atacar') {
      const t = room.territories[o.to];
      if (!t || !t.open || t.owner === p.id) continue;

      const mode = ['asalto', 'asedio', 'incursion'].includes(o.mode) ? o.mode : 'asalto';
      const isBootstrap = room.round === 1 && t.era === room.era && t.owner === null;
      const defenderPlayer = t.owner ? playerById(room, t.owner) : null;

      // ---- ASEDIO ----
      if (mode === 'asedio' && !isBootstrap) {
        const source = room.territories[o.from];
        if (!source || source.owner !== p.id || !source.neighbors.includes(t.id) || source.armies < 2) {
          resolveLog.push(`${p.name} no tiene un territorio válido con tropas de sobra para asediar ${t.name}.`);
          continue;
        }
        maybeScandal(room, p, defenderPlayer, resolveLog);
        const aCounter = TROOP_CLASSES[source.unitClass].beats === t.unitClass;
        const dCounter = TROOP_CLASSES[t.unitClass].beats === source.unitClass;
        const aVal = roll(1)[0] + (aCounter ? 1 : 0);
        const dVal = roll(1)[0] + (dCounter ? 1 : 0);
        const win = aVal > dVal;
        if (win) {
          t.armies = Math.max(0, t.armies - 1);
          resolveLog.push(`💣 ${p.name} asedia ${t.name} desde ${source.name} (${aVal} vs ${dVal}): la guarnición pierde 1 tropa (quedan ${t.armies}).${defenderPlayer ? ` ${defenderPlayer.name} bebe 1 sorbo.` : ''}`);
        } else {
          source.armies = Math.max(1, source.armies - 1);
          resolveLog.push(`💣 ${p.name} asedia ${t.name} (${aVal} vs ${dVal}) y la defensa aguanta: pierde 1 tropa y bebe 1 sorbo.`);
        }
        battles.push({
          mode: 'asedio', terrId: t.id, terrName: t.name, srcId: source.id, srcName: source.name,
          attackerId: p.id, attackerName: p.name, defenderId: t.owner, defenderName: defenderPlayer ? defenderPlayer.name : 'Guarnición local',
          aCls: source.unitClass, dCls: t.unitClass, aEra: source.era, dEra: t.era,
          aVal, dVal, aCounter, dCounter, win: win ? 'a' : 'd',
        });
        mapFx.push({ type: 'boom', terrId: t.id });
        continue;
      }

      // ---- INCURSIÓN ----
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
        maybeScandal(room, p, defenderPlayer, resolveLog);
        const aCounter = TROOP_CLASSES[source.unitClass].beats === t.unitClass;
        const dCounter = TROOP_CLASSES[t.unitClass].beats === source.unitClass;
        const aVal = roll(1)[0] + (aCounter ? 1 : 0);
        const dVal = roll(1)[0] + (dCounter ? 1 : 0);
        const win = aVal > dVal;
        let stole = 0;
        if (win) {
          stole = Math.min(3, defenderPlayer.resources || 0);
          defenderPlayer.resources = (defenderPlayer.resources || 0) - stole;
          p.resources = (p.resources || 0) + stole;
          resolveLog.push(`🐎 ${p.name} lanza una incursión sobre ${t.name} (${aVal} vs ${dVal}) y roba ${stole} Recurso(s) a ${defenderPlayer.name}, que bebe 1 sorbo.`);
          mapFx.push({ type: 'coin', fromId: t.id, toId: source.id, n: stole });
        } else {
          source.armies = Math.max(1, source.armies - 1);
          resolveLog.push(`🐎 La incursión de ${p.name} sobre ${t.name} fracasa (${aVal} vs ${dVal}): pierde 1 tropa y bebe 1 sorbo.`);
        }
        battles.push({
          mode: 'incursion', terrId: t.id, terrName: t.name, srcId: source.id, srcName: source.name,
          attackerId: p.id, attackerName: p.name, defenderId: t.owner, defenderName: defenderPlayer.name,
          aCls: source.unitClass, dCls: t.unitClass, aEra: source.era, dEra: t.era,
          aVal, dVal, aCounter, dCounter, win: win ? 'a' : 'd', stole,
        });
        continue;
      }

      // ---- ASALTO / colonización ----
      let source = null;
      let amount;
      let attackClass;
      if (isBootstrap) {
        amount = Math.max(1, Math.min(o.amount || 0, p.reserve));
        if (amount < 1 || p.reserve < 1) { resolveLog.push(`${p.name} no tiene tropas de reserva para desembarcar en ${t.name}.`); continue; }
        attackClass = TROOP_CLASS_KEYS.includes(o.unitClass) ? o.unitClass : TROOP_CLASS_KEYS[Math.floor(Math.random() * TROOP_CLASS_KEYS.length)];
      } else {
        source = room.territories[o.from];
        if (!source || source.owner !== p.id || !source.neighbors.includes(t.id)) {
          resolveLog.push(`${p.name} no tiene un territorio de origen válido junto a ${t.name}.`);
          continue;
        }
        amount = Math.max(1, Math.min(o.amount || 0, source.armies - 1));
        if (amount < 1 || source.armies < 2) { resolveLog.push(`${p.name} no tiene tropas de sobra en ${source.name} para atacar.`); continue; }
        attackClass = source.unitClass;
      }
      maybeScandal(room, p, defenderPlayer, resolveLog);
      if (isBootstrap) p.reserve -= amount;

      const dCountBefore = t.armies;
      // +1 dado al defender por La Guardiana o Avicena; +1 más si el defensor está casado.
      const dLeaderBonus = (defenderPlayer && (defenderPlayer.leader === 'juana' || defenderPlayer.extraDefenseDie)) ? 1 : 0;
      const dMarriedBonus = (defenderPlayer && defenderPlayer.married) ? 1 : 0;
      const aBonus = p.leader === 'zhenghe' && isBootstrap;
      const aCounter = TROOP_CLASSES[attackClass].beats === t.unitClass;
      const dCounter = TROOP_CLASSES[t.unitClass].beats === attackClass;
      const aLevelNum = (p.troopLevels && p.troopLevels[attackClass]) || 1;
      const aLevel = TROOP_CLASSES[attackClass].levels.find((l) => l.level === aLevelNum) || { diceBonus: 0, winsTies: false };
      const dLevelNum = (defenderPlayer && defenderPlayer.troopLevels && defenderPlayer.troopLevels[t.unitClass]) || 1;
      const dLevel = TROOP_CLASSES[t.unitClass].levels.find((l) => l.level === dLevelNum) || { diceBonus: 0, winsTies: false };

      const aDice = roll(Math.min(amount, 3) + (aBonus ? 1 : 0) + (aCounter ? 1 : 0) + aLevel.diceBonus);
      const dDice = roll(Math.min(t.armies, 2) + dLeaderBonus + dMarriedBonus + (dCounter ? 1 : 0) + dLevel.diceBonus);
      let aLoss = 0, dLoss = 0;
      const duels = [];
      const cmp = Math.min(aDice.length, dDice.length);
      for (let i = 0; i < cmp; i++) {
        let win;
        if (aDice[i] > dDice[i]) { dLoss++; win = 'a'; }
        else if (aDice[i] < dDice[i]) { aLoss++; win = 'd'; }
        else if (aLevel.winsTies && !dLevel.winsTies) { dLoss++; win = 'a'; }
        else { aLoss++; win = 'd'; }
        duels.push({ a: aDice[i], d: dDice[i], win });
      }
      if (p.shield && aLoss > 0) { aLoss = Math.max(0, aLoss - 1); p.shield = false; resolveLog.push(`${p.name} usa el escudo de Diógenes y evita 1 baja.`); }
      if (p.leader === 'alejandro' && aLoss > 0) { aLoss = Math.max(0, aLoss - 1); resolveLog.push(`${p.name} (El Conquistador) evita 1 baja en combate.`); }
      const survivors = amount - aLoss;
      t.armies = Math.max(0, t.armies - dLoss);
      const originTxt = source ? ` desde ${source.name}` : '';
      const classTxt = ` con sus ${unitName(attackClass, source ? source.era : t.era)}${aCounter ? ' (¡ventaja de clase!)' : ''}`;

      let conquered = false;
      if (t.armies <= 0 && survivors > 0) {
        conquered = true;
        const prevOwnerName = defenderPlayer ? defenderPlayer.name : 'los locales';
        const wasRival = !!defenderPlayer;
        if (source) source.armies -= amount;
        t.owner = p.id; t.armies = survivors; t.unitClass = attackClass;
        resolveLog.push(`⚔️ ${p.name} conquista ${t.name}${originTxt}${classTxt}, con ${survivors} superviviente(s) (antes de ${prevOwnerName}). ${prevOwnerName} bebe ${dLoss} sorbo(s).`);
        if (t.wonder) resolveLog.push(`🏛️ ¡${t.wonder.name} cambia de manos y ahora es de ${p.name}!`);
        if (wasRival && p.leader === 'bolivar') {
          p.gloria += 1;
          resolveLog.push(`${p.name} (El Libertador) gana +1 Gloria por liberar ${t.name}.`);
        }
        mapFx.push({ type: 'march', fromId: source ? source.id : null, toId: t.id, cls: attackClass, ownerId: p.id, n: survivors });
      } else {
        if (source) source.armies -= aLoss;
        t.armies = Math.max(1, t.armies);
        resolveLog.push(`⚔️ ${p.name} ataca ${t.name}${originTxt}${classTxt} y fracasa. ${p.name} bebe ${aLoss} sorbo(s).`);
      }
      battles.push({
        mode: 'asalto', terrId: t.id, terrName: t.name, srcId: source ? source.id : null, srcName: source ? source.name : null,
        attackerId: p.id, attackerName: p.name, defenderId: defenderPlayer ? defenderPlayer.id : null,
        defenderName: defenderPlayer ? defenderPlayer.name : 'Guarnición local',
        aCls: attackClass, dCls: t.unitClass === attackClass && conquered ? (battles.dCls || t.unitClass) : t.unitClass,
        aEra: source ? source.era : t.era, dEra: t.era,
        aCount: amount, dCount: dCountBefore,
        aDice, dDice, duels, aLoss, dLoss, conquered, survivors: Math.max(0, survivors),
        aCounter, dCounter, isBootstrap,
      });
    }
  }

  // Nota: en los partes de asalto, dCls debe ser la clase que DEFENDÍA (antes de la conquista).
  for (const b of battles) { if (b.mode === 'asalto' && b.conquered) b.dCls = b.dCls; }

  // 6) Ingresos.
  for (const p of room.players) {
    const owned = ownedTerritories(room, p.id).length;
    let income = owned;
    if (p.leader === 'mansamusa') income += 1;
    if (income) p.resources = (p.resources || 0) + income;
  }

  // 7) ¿Victoria instantánea?
  const victory = checkInstantVictory(room);
  if (victory) {
    room.pendingVictory = victory;
    const vp = playerById(room, victory.winnerId);
    resolveLog.push(victory.type === 'dominacion'
      ? `🗺️ ¡${vp.name} controla ${dominationNeeded(room)} territorios o más! VICTORIA POR DOMINACIÓN.`
      : `🏛️ ¡${vp.name} controla ${WONDERS_TO_WIN} Maravillas! VICTORIA POR CULTURA.`);
  }

  room.resolveLog = resolveLog;
  room.battles = battles;
  room.mapFx = mapFx;
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
      resolveLog.push('Todos elegisteis la opción honorable: +1 Gloria para cada uno, nadie bebe.');
    } else {
      for (const p of room.players) {
        if (traidores.find((t) => t.id === p.id)) { p.gloria += 2; resolveLog.push(`${p.name} eligió la traición: +2 Gloria.`); }
        else resolveLog.push(`${p.name} fue honorable y bebe 1 sorbo.`);
      }
    }
  } else if (d.tipo === 'riesgo') {
    for (const p of room.players) {
      const choice = room.desafioResponses[p.id];
      if (choice === 0) {
        const dice = roll(1)[0];
        if (dice >= 4) { p.gloria += 3; resolveLog.push(`${p.name} arriesga y triunfa (${dice}): +3 Gloria.`); }
        else {
          const t = ownedTerritories(room, p.id);
          if (t.length) t[0].armies = Math.max(1, t[0].armies - 1);
          resolveLog.push(`${p.name} arriesga y fracasa (${dice}): pierde 1 tropa y bebe 2 sorbos.`);
        }
      } else { p.gloria += 1; resolveLog.push(`${p.name} va a lo seguro: +1 Gloria.`); }
    }
  } else if (d.tipo === 'votacion') {
    const tally = {};
    for (const voted of Object.values(room.desafioResponses)) tally[voted] = (tally[voted] || 0) + 1;
    let winnerId = null, max = 0;
    for (const id in tally) if (tally[id] > max) { max = tally[id]; winnerId = id; }
    const winner = winnerId ? playerById(room, winnerId) : null;
    if (winner) {
      let gain = 2;
      if (winner.leader === 'pericles') gain *= 2;
      winner.gloria += gain;
      resolveLog.push(`${winner.name} gana el debate con ${max} voto(s): +${gain} Gloria. Los demás beben 1 sorbo.`);
    } else resolveLog.push('Nadie votó a un jugador válido, el debate queda en tablas.');
  }

  room.resolveLog = resolveLog;
  room.battles = [];
  room.mapFx = [];
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
    const board = generateBoard();
    const room = {
      code, hostId: ctx.playerId, players: [], phase: 'lobby', era: 1,
      territories: board.territories, seaRoutes: board.seaRoutes, rivers: board.rivers,
      log: [], desafioCursor: 0, maxPlayers: total,
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

  restart_room(_, ctx) {
    const room = rooms[playerRoom[ctx.playerId]];
    if (!room) return { error: 'Sala no encontrada.' };
    if (room.hostId !== ctx.playerId) return { error: 'Solo el anfitrión puede reiniciar la partida.' };
    clearTimeout(room.timer);
    room.phase = 'lobby';
    room.era = 1;
    room.round = null;
    const board = generateBoard();
    room.territories = board.territories;
    room.seaRoutes = board.seaRoutes;
    room.rivers = board.rivers;
    room.log = [];
    room.desafioCursor = 0;
    room.eraDeckTaken = new Set();
    room.wonderDeck = shuffle(WONDERS);
    room.pendingVictory = null;
    room.victory = null;
    room.battles = [];
    room.mapFx = [];
    for (const p of room.players) {
      p.gloria = 0; p.reserve = 0; p.characters = []; p.shield = false;
      p.extraDefenseDie = false; p.hideOrders = false; p.doubleEra3 = false;
      p.resources = 0; p.troopLevels = { inf: 1, cab: 1, arq: 1 };
      p.married = null; p.proposal = null;
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

  // Responder a una propuesta de matrimonio — NO consume la orden de la ronda.
  respond_marriage({ accept }, ctx) {
    const room = rooms[playerRoom[ctx.playerId]];
    if (!room) return { error: 'Sala no encontrada.' };
    const p = playerById(room, ctx.playerId);
    if (!p || !p.proposal) return { error: 'No tienes ninguna propuesta pendiente.' };
    const from = playerById(room, p.proposal.fromId);
    p.proposal = null;
    if (!from) { emitRoom(room); return { error: 'Quien te propuso ya no está en la partida.' }; }
    if (accept) {
      if (p.married || from.married) {
        log(room, `La boda entre ${from.name} y ${p.name} se cancela: una de las casas ya no está libre.`);
        emitRoom(room);
        return { ok: true };
      }
      p.married = from.id;
      from.married = p.id;
      log(room, `💍🥂 ¡BODA REAL! ${from.name} y ${p.name} unen sus casas. ¡Todo el grupo brinda por los novios!`);
    } else {
      log(room, `💔 ${p.name} rechaza la propuesta de ${from.name}... y bebe 1 sorbo por la vergüenza.`);
    }
    emitRoom(room);
    return { ok: true };
  },

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
    log(room, `⬆️ ${p.name} mejora su ${TROOP_CLASSES[cls].clase} a nivel ${currentLevel + 1} (${nextLevelDef.name}).`);
    emitRoom(room);
    return { ok: true };
  },

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

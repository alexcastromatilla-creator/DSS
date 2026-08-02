// Verifica el camino feliz de las Maravillas: acumular Recursos de verdad (el anfitrión lleva a
// Mansa Musa, +1 Recurso extra por ronda, y expande territorio para subir ingresos), construir
// una Maravilla real pagando su coste, y los rechazos de "segunda Maravilla en el mismo
// territorio" y "sin fondos para otra". Reintenta la colonización inicial en salas nuevas.
const http = require('http');
const BASE = 'http://127.0.0.1:3000';
const WONDER_COST = 15;

function apiPost(action, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = http.request(BASE + '/api/' + action, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) },
    }, (res) => { let buf = ''; res.on('data', c => buf += c); res.on('end', () => { try { resolve(JSON.parse(buf)); } catch (e) { reject(e); } }); });
    req.on('error', reject); req.write(data); req.end();
  });
}
function apiGet(pathname) {
  return new Promise((resolve, reject) => {
    http.get(BASE + pathname, res => { let buf = ''; res.on('data', c => buf += c); res.on('end', () => { try { resolve(JSON.parse(buf)); } catch (e) { reject(e); } }); }).on('error', reject);
  });
}
function openStream(playerId, onState) {
  return new Promise((resolveConn) => {
    const req = http.get(BASE + '/events?playerId=' + playerId, (res) => {
      let buf = '';
      res.on('data', (chunk) => {
        buf += chunk.toString();
        let idx;
        while ((idx = buf.indexOf('\n\n')) >= 0) {
          const raw = buf.slice(0, idx); buf = buf.slice(idx + 2);
          if (raw.startsWith('data: ')) { try { onState(JSON.parse(raw.slice(6))); } catch (e) {} }
        }
      });
      resolveConn(req);
    });
  });
}
function wait(ms) { return new Promise(r => setTimeout(r, ms)); }

async function newPair() {
  const host = { id: null, state: null };
  const guest = { id: null, state: null };
  host.id = (await apiGet('/api/new_id')).playerId;
  guest.id = (await apiGet('/api/new_id')).playerId;
  await openStream(host.id, (s) => { host.state = s; });
  await openStream(guest.id, (s) => { guest.state = s; });
  await wait(150);
  const created = await apiPost('create_room', { playerId: host.id, name: 'Host', maxPlayers: 2, botsWanted: 0 });
  await apiPost('join_room', { playerId: guest.id, name: 'Guest', code: created.code });
  await wait(150);
  await apiPost('choose_leader', { playerId: host.id, leader: 'mansamusa' }); // +1 Recurso/ronda: acelera la economía
  await apiPost('choose_leader', { playerId: guest.id, leader: 'pericles' });
  await wait(150);
  await apiPost('start_game', { playerId: host.id });
  await wait(300);
  if (host.state.phase === 'era_intro') { await apiPost('continue', { playerId: host.id }); await wait(300); }
  return { host, guest };
}

async function playRound(host, guest, hostOrder) {
  await apiPost('submit_order', { playerId: host.id, order: hostOrder });
  await apiPost('submit_order', { playerId: guest.id, order: { type: 'espiar', targetId: host.id } });
  await wait(400);
  if (host.state.phase === 'resolve') { await apiPost('continue', { playerId: host.id }); await wait(300); }
  if (host.state.phase === 'desafio') {
    const d = host.state.desafio;
    const hostChoice = d && d.tipo === 'votacion' ? guest.id : 1;
    const guestChoice = d && d.tipo === 'votacion' ? host.id : 1;
    await apiPost('submit_desafio_choice', { playerId: host.id, choice: hostChoice });
    await apiPost('submit_desafio_choice', { playerId: guest.id, choice: guestChoice });
    await wait(400);
    if (host.state.phase === 'resolve') { await apiPost('continue', { playerId: host.id }); await wait(300); }
  }
  if (host.state.phase === 'era_intro' || host.state.phase === 'simposio') {
    await apiPost('continue', { playerId: host.id });
    await wait(300);
  }
}

// Orden "económica" del host en cada ronda: expandirse a un vecino neutral de la Era I si tiene
// tropas de sobra (más territorios = más ingreso), y si no, reclutar tranquilo.
function pickHostOrder(host) {
  const terrs = Object.values(host.state.territories);
  const mine = terrs.filter(t => t.open && t.owner === host.id);
  for (const src of mine) {
    if (src.armies <= 2) continue;
    const targetId = src.neighbors.find(nId => {
      const n = host.state.territories[nId];
      return n && n.open && n.era === 1 && !n.owner; // solo vecinos neutrales "blandos" (guarnición 2)
    });
    if (targetId) return { type: 'atacar', mode: 'asalto', to: targetId, from: src.id, amount: src.armies - 1 };
  }
  const p = host.state.players.find(pp => pp.id === host.id);
  if (p.reserve >= 1 && mine.length) return { type: 'reforzar', territoryId: mine[0].id, amount: p.reserve };
  return { type: 'reclutar' };
}

async function run() {
  // 1) Conseguir una posición inicial (colonización), reintentando en salas nuevas.
  let ctx = null;
  for (let i = 1; i <= 10 && !ctx; i++) {
    const { host, guest } = await newPair();
    const target = Object.values(host.state.territories).find(t => t.era === 1 && t.open && !t.owner);
    const reserve = host.state.players.find(p => p.id === host.id).reserve;
    await playRound(host, guest, { type: 'atacar', mode: 'asalto', to: target.id, amount: reserve, unitClass: 'inf' });
    const ok = host.state.territories[target.id].owner === host.id;
    console.log(`Colonización intento ${i}:`, ok ? 'CONQUISTADO ' + target.id : 'fallido');
    if (ok) ctx = { host, guest };
  }
  if (!ctx) throw new Error('No se logró colonizar en 10 intentos.');
  const { host, guest } = ctx;

  // 2) Farmear Recursos expandiéndose (Mansa Musa acelera), hasta WONDER_COST o fin de partida.
  for (let i = 0; i < 45; i++) {
    const p = host.state.players.find(pp => pp.id === host.id);
    if (p.resources >= WONDER_COST) break;
    if (host.state.phase === 'fin') break;
    if (host.state.phase !== 'orders') { await playRound(host, guest, { type: 'reclutar' }); continue; }
    await playRound(host, guest, pickHostOrder(host));
  }
  const hostP = host.state.players.find(p => p.id === host.id);
  const myTerrCount = Object.values(host.state.territories).filter(t => t.owner === host.id).length;
  console.log('Recursos del host:', hostP.resources, '| Territorios:', myTerrCount, '| Fase:', host.state.phase);
  if (host.state.phase === 'fin' && hostP.resources < WONDER_COST) {
    throw new Error('La partida terminó antes de acumular ' + WONDER_COST + ' Recursos (' + hostP.resources + ') — con Mansa Musa esto debería ser rarísimo, revisar el ingreso por ronda.');
  }
  if (hostP.resources < WONDER_COST) throw new Error('No se acumularon ' + WONDER_COST + ' Recursos en 45 rondas (' + hostP.resources + ').');

  // 3) Construir la Maravilla de verdad y comprobar coste y estado.
  const myTerr = Object.values(host.state.territories).find(t => t.owner === host.id && !t.wonder);
  const resourcesBefore = hostP.resources;
  const built = await apiPost('construir_maravilla', { playerId: host.id, territoryId: myTerr.id });
  if (built.error) throw new Error('FALLO al construir con fondos suficientes: ' + built.error);
  await wait(300);
  const tNow = host.state.territories[myTerr.id];
  const hostNow = host.state.players.find(p => p.id === host.id);
  console.log('Maravilla construida:', tNow.wonder && (tNow.wonder.icon + ' ' + tNow.wonder.name), 'en', tNow.name);
  console.log('Recursos: antes', resourcesBefore, '→ después', hostNow.resources, '(esperado -' + WONDER_COST + ')');
  if (!tNow.wonder || !tNow.wonder.name) throw new Error('FALLO: el territorio no registra la Maravilla');
  if (hostNow.resources !== resourcesBefore - WONDER_COST) throw new Error('FALLO: el coste de la Maravilla no se descontó exactamente');
  const guestSees = guest.state.territories[myTerr.id].wonder;
  if (!guestSees || guestSees.name !== tNow.wonder.name) throw new Error('FALLO: el invitado no ve la Maravilla construida');

  // 4) Rechazos: segunda Maravilla en el mismo territorio, y sin fondos en otro territorio.
  const dup = await apiPost('construir_maravilla', { playerId: host.id, territoryId: myTerr.id });
  console.log('Segunda Maravilla en el mismo territorio ->', dup.error);
  if (!dup.error) throw new Error('FALLO: se permitió una segunda Maravilla en el mismo territorio');
  const other = Object.values(host.state.territories).find(t => t.owner === host.id && !t.wonder);
  if (other && hostNow.resources < WONDER_COST) {
    const broke = await apiPost('construir_maravilla', { playerId: host.id, territoryId: other.id });
    console.log('Otra Maravilla sin fondos ->', broke.error);
    if (!broke.error) throw new Error('FALLO: se permitió construir sin fondos');
  }

  console.log('TEST OK: Maravilla construida con su coste exacto, visible para todos, y con sus rechazos correctos.');
  process.exit(0);
}
run().catch(e => { console.error('EXCEPCION', e.message); process.exit(1); });

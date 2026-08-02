// Simula 1 humano + 2 bots jugando una partida completa, para validar la IA de los bots.
const http = require('http');
const BASE = 'http://127.0.0.1:3000';

function apiPost(action, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = http.request(BASE + '/api/' + action, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) },
    }, (res) => {
      let buf = '';
      res.on('data', (c) => (buf += c));
      res.on('end', () => { try { resolve(JSON.parse(buf)); } catch (e) { reject(e); } });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}
function apiGet(pathname) {
  return new Promise((resolve, reject) => {
    http.get(BASE + pathname, (res) => {
      let buf = '';
      res.on('data', (c) => (buf += c));
      res.on('end', () => { try { resolve(JSON.parse(buf)); } catch (e) { reject(e); } });
    }).on('error', reject);
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
          const raw = buf.slice(0, idx);
          buf = buf.slice(idx + 2);
          if (raw.startsWith('data: ')) { try { onState(JSON.parse(raw.slice(6))); } catch (e) { console.error('parse error', e); } }
        }
      });
      resolveConn(req);
    });
  });
}
function wait(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function run() {
  const human = { id: null, name: 'Alex', state: null };
  const r = await apiGet('/api/new_id');
  human.id = r.playerId;
  await openStream(human.id, (s) => { human.state = s; });
  await wait(300);

  console.log('--- Crear sala: 3 jugadores totales, 2 bots ---');
  const created = await apiPost('create_room', { playerId: human.id, name: human.name, maxPlayers: 3, botsWanted: 2 });
  console.log('create_room ->', created);
  await wait(300);
  console.log('Jugadores en la sala:', human.state.players.map(p => `${p.name}${p.isBot ? ' [BOT]' : ''} (${p.archetype})`));

  if (human.state.players.length !== 3) throw new Error('Los bots no se añadieron correctamente');

  console.log('--- Elegir arquetipo humano ---');
  const freeArch = Object.keys(human.state.archetypes).find(a => !human.state.players.some(p => p.archetype === a));
  const archRes = await apiPost('choose_archetype', { playerId: human.id, archetype: freeArch });
  if (archRes.error) throw new Error('Error eligiendo arquetipo: ' + archRes.error);
  await wait(200);

  console.log('--- Empezar partida (debería aceptar con 1 humano + 2 bots) ---');
  const startRes = await apiPost('start_game', { playerId: human.id });
  console.log('start_game ->', startRes);
  if (startRes.error) throw new Error('start_game falló: ' + startRes.error);
  await wait(300);

  let iterations = 0;
  let lastPhaseKey = '';
  while (human.state.phase !== 'fin' && iterations < 400) {
    iterations++;
    const phase = human.state.phase;
    const phaseKey = `${phase}|${human.state.era}|${human.state.round}`;
    if (phaseKey !== lastPhaseKey) { console.log(`>>> iter ${iterations}: ${phaseKey}`); lastPhaseKey = phaseKey; }

    if (phase === 'era_intro') {
      await apiPost('continue', { playerId: human.id });
    } else if (phase === 'orders') {
      const territories = Object.values(human.state.territories).filter(t => t.open);
      const mine = territories.filter(t => t.owner === human.id);
      const isBootstrapRound = human.state.round === 1;
      const bootstrapTargets = isBootstrapRound
        ? territories.filter(t => t.era === human.state.era && !t.owner)
        : [];
      const regularOptions = [];
      for (const src of mine) {
        if (src.armies <= 1) continue;
        for (const nId of src.neighbors) {
          const n = human.state.territories[nId];
          if (n && n.open && n.owner !== human.id) regularOptions.push({ src, target: n });
        }
      }
      let order;
      if (bootstrapTargets.length && Math.random() < 0.5) {
        const target = bootstrapTargets[Math.floor(Math.random() * bootstrapTargets.length)];
        order = { type: 'atacar', to: target.id, amount: 1 };
      } else if (regularOptions.length && Math.random() < 0.5) {
        const pick = regularOptions[Math.floor(Math.random() * regularOptions.length)];
        const amount = Math.max(1, Math.min(pick.src.armies - 1, 1 + Math.floor(Math.random() * 2)));
        order = { type: 'atacar', to: pick.target.id, from: pick.src.id, amount };
      } else order = { type: 'reclutar' };
      const or = await apiPost('submit_order', { playerId: human.id, order });
      if (or.error) console.log('ERROR submit_order humano', or);
    } else if (phase === 'resolve' || phase === 'simposio') {
      console.log(`[${phase}]`, human.state.resolveLog || human.state.simposioResult);
      await apiPost('continue', { playerId: human.id });
    } else if (phase === 'desafio') {
      const d = human.state.desafio;
      let choice;
      if (d.tipo === 'votacion') {
        const other = human.state.players.find(p => p.id !== human.id);
        choice = other.id;
      } else choice = Math.floor(Math.random() * d.opciones.length);
      await apiPost('submit_desafio_choice', { playerId: human.id, choice });
    }
    await wait(400); // dejamos tiempo a los bots (700-2600ms) para que respondan por su cuenta
  }

  console.log('--- FIN ---');
  console.log('iteraciones:', iterations);
  console.log('fase final:', human.state.phase);
  console.log('resultado final:', JSON.stringify(human.state.finalResult, null, 2));

  if (human.state.phase !== 'fin') { console.error('FALLO: no llegó a "fin" (posible bot colgado)'); process.exit(1); }
  console.log('TEST OK: partida en solitario contra 2 bots completada sin errores.');
  process.exit(0);
}
run().catch((e) => { console.error('EXCEPCION', e); process.exit(1); });

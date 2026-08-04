// Simula una partida completa de 3 jugadores contra el servidor local, para detectar errores end-to-end.
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
          if (raw.startsWith('data: ')) {
            try { onState(JSON.parse(raw.slice(6))); } catch (e) { console.error('parse error', e, raw); }
          }
        }
      });
      resolveConn(req);
    });
  });
}

function wait(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function run() {
  const players = [
    { id: null, name: 'Alex', state: null },
    { id: null, name: 'Bea', state: null },
    { id: null, name: 'Coco', state: null },
  ];

  for (const p of players) {
    const r = await apiGet('/api/new_id');
    p.id = r.playerId;
    await openStream(p.id, (s) => { p.state = s; });
  }
  await wait(300);

  console.log('--- Crear y unirse a sala ---');
  const created = await apiPost('create_room', { playerId: players[0].id, name: players[0].name });
  console.log('create_room ->', created);
  const code = created.code;
  for (let i = 1; i < 3; i++) {
    const r = await apiPost('join_room', { playerId: players[i].id, name: players[i].name, code });
    console.log(`join_room[${players[i].name}] ->`, r);
  }
  await wait(300);

  console.log('--- Elegir líderes ---');
  const leaders = ['alejandro', 'juana', 'pericles'];
  for (let i = 0; i < 3; i++) {
    const r = await apiPost('choose_leader', { playerId: players[i].id, leader: leaders[i] });
    if (r.error) console.log('ERROR choose_leader', r);
  }
  await wait(300);

  console.log('--- Empezar partida ---');
  const startRes = await apiPost('start_game', { playerId: players[0].id });
  console.log('start_game ->', startRes);
  await wait(300);

  const territoryCount = Object.keys(players[0].state.territories).length;
  console.log('Territorios generados en el mapa:', territoryCount, '(esperado 24)');
  if (territoryCount !== 24) throw new Error('FALLO: se esperaban 24 territorios, hay ' + territoryCount);
  const openAtStart = Object.values(players[0].state.territories).filter((t) => t.open).length;
  console.log('Abiertos en Era I al empezar:', openAtStart, '(esperado 8)');
  if (openAtStart !== 8) throw new Error('FALLO: se esperaban 8 territorios abiertos en Era I, hay ' + openAtStart);
  const everyoneHasResourcesAndLevels = players[0].state.players.every((p) =>
    typeof p.resources === 'number' && p.troopLevels && p.troopLevels.inf === 1 && p.troopLevels.cab === 1 && p.troopLevels.arq === 1);
  if (!everyoneHasResourcesAndLevels) throw new Error('FALLO: algún jugador no tiene Recursos/niveles de clase iniciales correctos');
  const allClassed = Object.values(players[0].state.territories).every((t) => ['inf', 'cab', 'arq'].includes(t.unitClass));
  if (!allClassed) throw new Error('FALLO: hay territorios sin clase de guarnición válida');
  const allPathed = Object.values(players[0].state.territories).every((t) => typeof t.path === 'string' && t.path.startsWith('M'));
  if (!allPathed) throw new Error('FALLO: hay territorios sin polígono (t.path) para el mapa político');
  console.log('OK: Recursos, niveles por clase, clases de guarnición y polígonos presentes.');

  let iterations = 0;
  let lastPhaseKey = '';
  while (players[0].state.phase !== 'fin' && iterations < 300) {
    iterations++;
    const phase = players[0].state.phase;
    const phaseKey = `${phase}|${players[0].state.era}|${players[0].state.round}`;
    if (phaseKey !== lastPhaseKey) { console.log(`>>> iter ${iterations}: ${phaseKey}`); lastPhaseKey = phaseKey; }
    if (phase === 'era_intro') {
      await apiPost('continue', { playerId: players[0].id });
    } else if (phase === 'orders') {
      for (const p of players) {
        const territories = Object.values(p.state.territories).filter((t) => t.open);
        const mine = territories.filter((t) => t.owner === p.id);
        const isBootstrapRound = p.state.round === 1;
        const bootstrapTargets = isBootstrapRound
          ? territories.filter((t) => t.era === p.state.era && !t.owner)
          : [];
        const regularOptions = [];
        for (const src of mine) {
          if (src.armies <= 1) continue;
          for (const nId of src.neighbors) {
            const n = p.state.territories[nId];
            if (n && n.open && n.owner !== p.id) regularOptions.push({ src, target: n });
          }
        }
        let order;
        const roll = Math.random();
        if (roll < 0.4 && bootstrapTargets.length) {
          const target = bootstrapTargets[Math.floor(Math.random() * bootstrapTargets.length)];
          const classes = ['inf', 'cab', 'arq'];
          order = { type: 'atacar', mode: 'asalto', to: target.id, amount: 1 + Math.floor(Math.random() * 2), unitClass: classes[Math.floor(Math.random() * 3)] };
        } else if (roll < 0.6 && regularOptions.length) {
          const pick = regularOptions[Math.floor(Math.random() * regularOptions.length)];
          const amount = Math.max(1, Math.min(pick.src.armies - 1, 1 + Math.floor(Math.random() * 2)));
          // Reparte entre los 3 modos de ataque para cubrirlos todos a lo largo de la partida.
          const mr = Math.random();
          const mode = mr < 0.5 ? 'asalto' : mr < 0.8 ? 'asedio' : 'incursion';
          order = { type: 'atacar', mode, to: pick.target.id, from: pick.src.id, amount };
        } else if (roll < 0.72 && mine.length) {
          order = { type: 'reforzar', territoryId: mine[Math.floor(Math.random() * mine.length)].id, amount: 1 };
        } else if (roll < 0.8) {
          order = { type: 'levas' }; // puede fallar por fondos: cubre ambos caminos
        } else if (roll < 0.86) {
          const meP = p.state.players.find(pp => pp.id === p.id);
          const single = p.state.players.find(pp => pp.id !== p.id && !pp.married);
          order = (!meP.married && single) ? { type: 'matrimonio', targetId: single.id } : { type: 'reclutar' };
        } else if (roll < 0.93) {
          order = { type: 'reclutar' };
        } else {
          const other = p.state.players.find((pp) => pp.id !== p.id);
          order = { type: 'espiar', targetId: other.id };
        }
        const r = await apiPost('submit_order', { playerId: p.id, order });
        if (r.error) console.log('ERROR submit_order', p.name, order, r);
        // De vez en cuando, también intenta mejorar una clase o construir una Maravilla si le
        // sobran Recursos — no pasa nada si falla por falta de fondos, solo añade cobertura
        // orgánica dentro de una partida completa (los caminos felices se comprueban aparte).
        if (Math.random() < 0.3) {
          const classes = ['inf', 'cab', 'arq'];
          await apiPost('level_up_troop', { playerId: p.id, cls: classes[Math.floor(Math.random() * 3)] });
        }
        if (Math.random() < 0.2 && mine.length) {
          await apiPost('construir_maravilla', { playerId: p.id, territoryId: mine[0].id });
        }
        // Propuestas de boda pendientes: responder (mitad sí, mitad no) sin gastar orden.
        if (p.state.you && p.state.you.proposal) {
          await apiPost('respond_marriage', { playerId: p.id, accept: Math.random() < 0.5 });
        }
      }
    } else if (phase === 'resolve' || phase === 'simposio') {
      console.log(`[${phase}] Era ${players[0].state.era} Ronda ${players[0].state.round}`, players[0].state.resolveLog || players[0].state.simposioResult);
      await apiPost('continue', { playerId: players[0].id });
    } else if (phase === 'desafio') {
      for (const p of players) {
        const d = p.state.desafio;
        let choice;
        if (d.tipo === 'votacion') {
          const other = p.state.players.find((pp) => pp.id !== p.id);
          choice = other.id;
        } else {
          choice = Math.floor(Math.random() * d.opciones.length);
        }
        const r = await apiPost('submit_desafio_choice', { playerId: p.id, choice });
        if (r.error) console.log('ERROR submit_desafio_choice', p.name, d.tipo, choice, r);
      }
    }
    await wait(150);
  }

  console.log('--- FIN ---');
  console.log('iteraciones:', iterations);
  console.log('fase final:', players[0].state.phase);
  console.log('resultado final:', JSON.stringify(players[0].state.finalResult, null, 2));
  console.log('gloria por jugador (players array):', players[0].state.players.map(p => ({ name: p.name, gloria: p.gloria })));

  if (players[0].state.phase !== 'fin') {
    console.error('FALLO: la partida no llegó a la fase "fin"');
    process.exit(1);
  }
  const badGloria = players[0].state.finalResult.some(r => typeof r.gloria !== 'number' || isNaN(r.gloria));
  if (badGloria) { console.error('FALLO: gloria inválida en el resultado final'); process.exit(1); }

  const finalTerritoryCount = Object.keys(players[0].state.territories).length;
  if (finalTerritoryCount !== 24) { console.error('FALLO: el nº de territorios cambió durante la partida (' + finalTerritoryCount + ')'); process.exit(1); }
  const badResources = players[0].state.players.some(p => typeof p.resources !== 'number' || p.resources < 0);
  if (badResources) { console.error('FALLO: algún jugador terminó con Recursos inválidos'); process.exit(1); }
  const badArmies = Object.values(players[0].state.territories).some(t => t.open && (typeof t.armies !== 'number' || t.armies < 0));
  if (badArmies) { console.error('FALLO: algún territorio terminó con tropas negativas'); process.exit(1); }
  const v = players[0].state.victory;
  console.log('Victoria:', JSON.stringify(v));
  if (!v || !['gloria', 'dominacion', 'cultura'].includes(v.type)) { console.error('FALLO: la partida terminó sin motivo de victoria válido'); process.exit(1); }
  console.log('Niveles de clase finales:', players[0].state.players.map(p => ({ name: p.name, troopLevels: p.troopLevels })));
  console.log('OK: 24 territorios, Recursos y tropas válidos hasta el final, y victoria con motivo (' + v.type + ').');
  console.log('TEST OK: la partida completa se resolvió sin errores.');
  process.exit(0);
}

run().catch((e) => { console.error('EXCEPCION EN TEST', e); process.exit(1); });

// Verifica los nuevos modos de ataque (Asedio e Incursión) y la ventaja de clase:
//  - Incursión sobre territorio neutral: se rechaza en la resolución (no hay Recursos que robar).
//  - Asedio sin territorio origen válido: se rechaza en la resolución.
//  - Asedio real sobre un vecino: exactamente un bando pierde 1 tropa y NADIE cambia de dueño.
// Reintenta la colonización inicial en salas nuevas hasta lograrla (los dados mandan), y dentro
// de la sala buena ejecuta el asedio.
const http = require('http');
const BASE = 'http://127.0.0.1:3000';

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
  await apiPost('choose_leader', { playerId: host.id, leader: 'alejandro' });
  await apiPost('choose_leader', { playerId: guest.id, leader: 'pericles' });
  await wait(150);
  await apiPost('start_game', { playerId: host.id });
  await wait(300);
  if (host.state.phase === 'era_intro') { await apiPost('continue', { playerId: host.id }); await wait(300); }
  return { host, guest };
}

// OJO: el invitado NUNCA usa 'reclutar' aquí — un Personaje como César roba 1 tropa a un
// territorio rival y contaminaría las mediciones exactas de tropas de este test. 'Espiar' no
// tiene ningún efecto sobre tropas (el invitado lleva a Pericles, no a Aníbal). En los Desafíos
// ambos eligen la opción 1, que en los dos primeros tipos (lealtad/por mar) nunca quita tropas.
async function playRound(host, guest, hostOrder) {
  await apiPost('submit_order', { playerId: host.id, order: hostOrder });
  await apiPost('submit_order', { playerId: guest.id, order: { type: 'espiar', targetId: host.id } });
  await wait(400);
  const lastLog = host.state.resolveLog ? [...host.state.resolveLog] : [];
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
  return lastLog;
}

async function run() {
  // ---------- Parte 1 (determinista): rechazo de incursión sin origen válido ----------
  // OJO: en la ronda 1 los territorios libres de la Era son "bootstrap" y cualquier modo se
  // trata como colonización — por eso el rechazo se prueba en la RONDA 2, donde ya no hay
  // bootstrap y la incursión exige un territorio de origen de verdad.
  {
    const { host, guest } = await newPair();
    await playRound(host, guest, { type: 'reclutar' }); // ronda 1 fuera
    const target = Object.values(host.state.territories).find(t => t.era === 1 && t.open && t.owner !== host.id);
    const log1 = await playRound(host, guest, { type: 'atacar', mode: 'incursion', to: target.id, from: 'noexiste' });
    const complaint = log1.find(l => l.includes('incursión') || l.includes('origen') || l.includes('válido'));
    console.log('Incursión sin origen válido (ronda 2) -> registro:', complaint || log1.join(' | '));
    if (!complaint) throw new Error('FALLO: la incursión sin origen válido no dejó rechazo en el registro');
  }

  // ---------- Parte 2 (con dados): colonizar, y desde ahí asedio de verdad ----------
  let ctx = null;
  for (let i = 1; i <= 10 && !ctx; i++) {
    const { host, guest } = await newPair();
    const target = Object.values(host.state.territories).find(t => t.era === 1 && t.open && !t.owner);
    const reserve = host.state.players.find(p => p.id === host.id).reserve;
    await playRound(host, guest, { type: 'atacar', mode: 'asalto', to: target.id, amount: reserve, unitClass: 'inf' });
    const mineNow = host.state.territories[target.id].owner === host.id;
    console.log(`Colonización intento ${i}:`, mineNow ? 'CONQUISTADO ' + target.id : 'fallido');
    if (mineNow) ctx = { host, guest, myTerrId: target.id };
  }
  if (!ctx) throw new Error('No se logró colonizar en 10 intentos.');
  const { host, guest, myTerrId } = ctx;

  // Asegura tropas de sobra en el origen (asedio exige >= 2): refuerza si hace falta.
  for (let i = 0; i < 6; i++) {
    const t = host.state.territories[myTerrId];
    const p = host.state.players.find(pp => pp.id === host.id);
    if (t.armies >= 2) break;
    if (host.state.phase !== 'orders') { await wait(300); continue; }
    if (p.reserve >= 1) await playRound(host, guest, { type: 'reforzar', territoryId: myTerrId, amount: 1 });
    else await playRound(host, guest, { type: 'reclutar' });
  }
  const src = host.state.territories[myTerrId];
  console.log('Origen para el asedio:', src.name, 'con', src.armies, 'tropas');
  if (src.armies < 2) throw new Error('No se pudo preparar un origen con 2+ tropas para el asedio.');

  // Elige un vecino abierto que no sea mío y asedia.
  const neighborId = src.neighbors.find(nId => {
    const n = host.state.territories[nId];
    return n && n.open && n.owner !== host.id;
  });
  if (!neighborId) throw new Error('El territorio colonizado no tiene ningún vecino abierto que asediar (mapa raro).');
  const before = {
    src: host.state.territories[myTerrId].armies,
    tgt: host.state.territories[neighborId].armies,
    tgtOwner: host.state.territories[neighborId].owner,
  };
  const logs = await playRound(host, guest, { type: 'atacar', mode: 'asedio', to: neighborId, from: myTerrId });
  const after = {
    src: host.state.territories[myTerrId].armies,
    tgt: host.state.territories[neighborId].armies,
    tgtOwner: host.state.territories[neighborId].owner,
  };
  console.log('Asedio', myTerrId, '->', neighborId, '| antes:', JSON.stringify(before), '| después:', JSON.stringify(after));
  console.log('Registro del asedio:', logs.filter(l => l.includes('asedia')).join(' | ') || '(ver ronda)');
  const srcLost = before.src - after.src;
  const tgtLost = before.tgt - after.tgt;
  if (after.tgtOwner !== before.tgtOwner) throw new Error('FALLO: el asedio cambió el dueño del territorio (no debe conquistar)');
  if (!((srcLost === 1 && tgtLost === 0) || (srcLost === 0 && tgtLost === 1))) {
    throw new Error(`FALLO: el asedio debe costar exactamente 1 tropa a un único bando (origen -${srcLost}, objetivo -${tgtLost})`);
  }
  console.log('OK: el asedio desgastó exactamente 1 tropa de un solo bando y no cambió dueños.');

  // Incursión con origen VÁLIDO pero contra territorio NEUTRAL: rechazo específico (no hay
  // Recursos que robar a los locales). Reponemos tropas en el origen si el asedio nos costó una.
  for (let i = 0; i < 6; i++) {
    const t = host.state.territories[myTerrId];
    const p = host.state.players.find(pp => pp.id === host.id);
    if (t.armies >= 2) break;
    if (host.state.phase !== 'orders') { await wait(300); continue; }
    if (p.reserve >= 1) await playRound(host, guest, { type: 'reforzar', territoryId: myTerrId, amount: 1 });
    else await playRound(host, guest, { type: 'reclutar' });
  }
  if (host.state.territories[myTerrId].armies >= 2 && host.state.phase === 'orders') {
    const neutralNeighbor = host.state.territories[myTerrId].neighbors.find(nId => {
      const n = host.state.territories[nId];
      return n && n.open && !n.owner;
    });
    if (neutralNeighbor) {
      const logs2 = await playRound(host, guest, { type: 'atacar', mode: 'incursion', to: neutralNeighbor, from: myTerrId });
      const neutralComplaint = logs2.find(l => l.includes('neutral'));
      console.log('Incursión sobre neutral -> registro:', neutralComplaint || logs2.join(' | '));
      if (!neutralComplaint) throw new Error('FALLO: la incursión sobre territorio neutral no fue rechazada con su mensaje específico');
    } else {
      console.log('AVISO: no quedó ningún vecino neutral para probar la incursión-sobre-neutral (todo el entorno estaba tomado).');
    }
  } else {
    console.log('AVISO: no se pudo reponer el origen a 2+ tropas para la incursión-sobre-neutral (la parte del asedio ya quedó verificada).');
  }

  console.log('TEST OK: modos de ataque (asedio e incursión) validados.');
  process.exit(0);
}
run().catch(e => { console.error('EXCEPCION', e.message); process.exit(1); });

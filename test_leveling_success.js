// Verifica los caminos "felices" que dependen de dados, sin depender de la suerte de una sola
// tirada: reintenta la colonización inicial (eligiendo la clase con ventaja sobre la guarnición)
// en salas nuevas hasta que una tenga éxito; comprueba que el territorio conquistado adopta la
// clase elegida; deja avanzar la partida acumulando Recursos y verifica la mejora de clase
// (1->2), su aislamiento por jugador, y — si el ritmo de la partida lo permite — la construcción
// de una Maravilla real con su coste.
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
const COUNTER = { inf: 'arq', cab: 'inf', arq: 'cab' }; // clase que vence a cada clase (arq>inf, inf>cab, cab>arq)

async function advanceOnce(host, guest) {
  const phase = host.state.phase;
  if (phase === 'orders') {
    await apiPost('submit_order', { playerId: host.id, order: { type: 'reclutar' } });
    await apiPost('submit_order', { playerId: guest.id, order: { type: 'reclutar' } });
    await wait(400);
  } else if (phase === 'desafio') {
    // En el desafío de votación hay que votar a un JUGADOR (id), no un índice.
    const d = host.state.desafio;
    const hostChoice = d && d.tipo === 'votacion' ? guest.id : 0;
    const guestChoice = d && d.tipo === 'votacion' ? host.id : 0;
    await apiPost('submit_desafio_choice', { playerId: host.id, choice: hostChoice });
    await apiPost('submit_desafio_choice', { playerId: guest.id, choice: guestChoice });
    await wait(400);
  } else if (phase === 'resolve' || phase === 'simposio' || phase === 'era_intro') {
    await apiPost('continue', { playerId: host.id });
    await wait(300);
  } else {
    await wait(300);
  }
}
async function playUntilResources(host, target, maxSteps, guest) {
  for (let i = 0; i < maxSteps; i++) {
    const hostP = host.state.players.find(p => p.id === host.id);
    if (hostP.resources >= target) return true;
    if (host.state.phase === 'fin') return false;
    await advanceOnce(host, guest);
  }
  return host.state.players.find(p => p.id === host.id).resources >= target;
}

async function attemptOnce(attemptNum) {
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
  await apiPost('choose_leader', { playerId: host.id, leader: 'alejandro' }); // -1 baja en combate: ayuda a colonizar
  await apiPost('choose_leader', { playerId: guest.id, leader: 'pericles' });
  await wait(150);
  await apiPost('start_game', { playerId: host.id });
  await wait(300);
  // start_game entra en 'era_intro'; hace falta 'continue' para llegar a la ronda 1 de verdad.
  if (host.state.phase === 'era_intro') { await apiPost('continue', { playerId: host.id }); await wait(300); }

  const target = Object.values(host.state.territories).find(t => t.era === 1 && t.open && !t.owner);
  const chosenClass = COUNTER[target.unitClass]; // colonizamos con la clase que vence a la guarnición
  const fullReserve = host.state.players.find(p => p.id === host.id).reserve;
  const orderResult = await apiPost('submit_order', { playerId: host.id, order: { type: 'atacar', mode: 'asalto', to: target.id, amount: fullReserve, unitClass: chosenClass } });
  if (orderResult.error) throw new Error('FALLO inesperado al enviar la orden: ' + orderResult.error);
  await apiPost('submit_order', { playerId: guest.id, order: { type: 'reclutar' } });
  await wait(400);
  if (host.state.phase === 'resolve') { await apiPost('continue', { playerId: host.id }); await wait(300); }

  const conquered = host.state.territories[target.id].owner === host.id;
  console.log(`Intento ${attemptNum}: colonizar ${target.id} (guarnición ${target.unitClass}) con clase ${chosenClass} ->`, conquered ? 'CONQUISTADO' : 'fallido');
  if (conquered) {
    const t = host.state.territories[target.id];
    console.log('Clase del territorio tras la conquista:', t.unitClass, '(esperada', chosenClass + ')');
    if (t.unitClass !== chosenClass) throw new Error('FALLO: el territorio conquistado no adoptó la clase elegida al colonizar');
  }
  return conquered ? { host, guest } : null;
}

async function run() {
  let result = null;
  for (let i = 1; i <= 10 && !result; i++) {
    result = await attemptOnce(i);
  }
  if (!result) throw new Error('No se logró ninguna colonización en 10 intentos (posible regresión en las probabilidades de combate).');

  const { host, guest } = result;

  // Mejora de clase 1 -> 2 (coste 8, sin descuento: el host lleva a Alejandro, no a Sun Tzu).
  const got8 = await playUntilResources(host, 8, 40, guest);
  const hostResources = host.state.players.find(p => p.id === host.id).resources;
  console.log('Recursos acumulados por el host:', hostResources, '(fase actual:', host.state.phase + ')');
  if (!got8) throw new Error('FALLO: no se acumularon 8 Recursos para probar la mejora (' + hostResources + ')');

  const up1 = await apiPost('level_up_troop', { playerId: host.id, cls: 'cab' });
  if (up1.error) throw new Error('FALLO al mejorar cab 1->2: ' + up1.error);
  await wait(300);
  let hostP = host.state.players.find(p => p.id === host.id);
  console.log('Nivel de Caballería tras mejorar:', hostP.troopLevels.cab, '(esperado 2) · Recursos restantes:', hostP.resources);
  if (hostP.troopLevels.cab !== 2) throw new Error('FALLO: el nivel de cab no subió a 2');
  if (hostP.troopLevels.inf !== 1 || hostP.troopLevels.arq !== 1) throw new Error('FALLO: la mejora de cab tocó otras clases');

  const guestLevels = guest.state.players.find(p => p.id === guest.id).troopLevels;
  console.log('Niveles del invitado (no deberían haber cambiado):', JSON.stringify(guestLevels));
  if (guestLevels.cab !== 1) throw new Error('FALLO: el nivel del invitado cambió sin que él mejorara nada');

  // Maravilla real: acumular WONDER_COST (15) y construir en el territorio del host.
  const got15 = await playUntilResources(host, 15, 60, guest);
  hostP = host.state.players.find(p => p.id === host.id);
  console.log('Recursos antes de la Maravilla:', hostP.resources, '(fase actual:', host.state.phase + ')');
  if (got15) {
    const myTerr = Object.values(host.state.territories).find(t => t.owner === host.id && !t.wonder);
    if (!myTerr) throw new Error('FALLO: el host no tiene territorio donde construir');
    const built = await apiPost('construir_maravilla', { playerId: host.id, territoryId: myTerr.id });
    if (built.error) throw new Error('FALLO al construir Maravilla con fondos: ' + built.error);
    await wait(300);
    const tNow = host.state.territories[myTerr.id];
    console.log('Maravilla construida:', tNow.wonder && tNow.wonder.name, 'en', tNow.name);
    if (!tNow.wonder || !tNow.wonder.name) throw new Error('FALLO: el territorio no tiene la Maravilla construida');
    const dup = await apiPost('construir_maravilla', { playerId: host.id, territoryId: myTerr.id });
    console.log('Segunda Maravilla en el mismo territorio ->', dup.error);
    if (!dup.error) throw new Error('FALLO: se permitió construir 2 Maravillas en el mismo territorio');
  } else {
    console.log('AVISO: la partida no dio para acumular 15 Recursos (' + hostP.resources + '/15, fase ' + host.state.phase + ') — la mejora de clase 1->2 ya quedó verificada arriba, que era el objetivo principal.');
  }

  console.log('TEST OK: colonización con clase elegida, mejora de clase con aislamiento por jugador' + (got15 ? ', y Maravilla real construida.' : '.'));
  process.exit(0);
}
run().catch(e => { console.error('EXCEPCION', e.message); process.exit(1); });

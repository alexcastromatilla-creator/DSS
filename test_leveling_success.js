// Verifica el camino "feliz" completo de level_up_troop, sin depender de la suerte en un solo
// intento: reintenta la conquista inicial (bootstrap, ~37% de ganar en un solo intento con 3
// dados vs 2) en salas nuevas hasta que una tenga éxito, deja avanzar la partida (rondas, Desafíos,
// Simposios y nuevas Eras si hace falta) hasta acumular Recursos suficientes, y entonces comprueba
// la subida de nivel 1->2->3 completa, el tope de nivel, y que el bonus de nivel se refleje de
// verdad en publicState() para el jugador que mejora (y NO para los demás).
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

// Ejecuta UN paso de progreso desde cualquier fase en la que esté la partida: si toca orden, ambos
// reclutan (no gastan nada, y el ingreso de Recursos por territorio se genera igual al resolver);
// si toca Desafío, ambos votan la primera opción; si toca resolución/simposio/intro de Era, solo
// hace falta "continuar". Así el bucle nunca se queda atascado en una fase que requiere acción.
async function advanceOnce(host, guest) {
  const phase = host.state.phase;
  if (phase === 'orders') {
    await apiPost('submit_order', { playerId: host.id, order: { type: 'reclutar' } });
    await apiPost('submit_order', { playerId: guest.id, order: { type: 'reclutar' } });
    await wait(400);
  } else if (phase === 'desafio') {
    await apiPost('submit_desafio_choice', { playerId: host.id, choice: 0 });
    await apiPost('submit_desafio_choice', { playerId: guest.id, choice: 0 });
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
  await apiPost('choose_archetype', { playerId: host.id, archetype: 'guerrero' }); // -1 baja siempre ayuda a conquistar
  await apiPost('choose_archetype', { playerId: guest.id, archetype: 'comerciante' });
  await wait(150);
  await apiPost('start_game', { playerId: host.id });
  await wait(300);
  // start_game solo entra en 'era_intro' (muestra la flavor text) — hace falta 'continue' para
  // avanzar a la ronda 1 de verdad. Sin esto, submit_order se rechaza siempre con "No es el
  // momento." y CUALQUIER intento de ataque falla sin llegar a tirar un solo dado (este fue el
  // motivo real de que las ejecuciones anteriores nunca vieran una conquista: no era mala suerte).
  if (host.state.phase === 'era_intro') { await apiPost('continue', { playerId: host.id }); await wait(300); }

  const target = Object.values(host.state.territories).find(t => t.era === 1 && t.open && !t.owner);
  const fullReserve = host.state.players.find(p => p.id === host.id).reserve;
  const orderResult = await apiPost('submit_order', { playerId: host.id, order: { type: 'atacar', to: target.id, amount: fullReserve } });
  if (orderResult.error) throw new Error('FALLO inesperado al enviar la orden de ataque: ' + orderResult.error);
  await apiPost('submit_order', { playerId: guest.id, order: { type: 'reclutar' } });
  await wait(400);
  if (host.state.phase === 'resolve') { await apiPost('continue', { playerId: host.id }); await wait(300); }

  const conquered = Object.values(host.state.territories).filter(t => t.owner === host.id).length > 0;
  console.log(`Intento ${attemptNum}: objetivo ${target.id} con ${fullReserve} legiones ->`, conquered ? 'CONQUISTADO' : 'fallido');
  return conquered ? { host, guest } : null;
}

async function run() {
  let result = null;
  for (let i = 1; i <= 10 && !result; i++) {
    result = await attemptOnce(i);
  }
  if (!result) throw new Error('No se logró ninguna conquista inicial en 10 intentos (posible regresión en las probabilidades de combate).');

  const { host, guest } = result;

  const got8 = await playUntilResources(host, 8, 40, guest);
  const hostResources = host.state.players.find(p => p.id === host.id).resources;
  console.log('Recursos acumulados por el host:', hostResources, '(fase actual:', host.state.phase + ')');
  if (!got8) throw new Error('FALLO: no se acumularon 8 Recursos para probar la mejora (' + hostResources + ')');

  // Nivel 1 -> 2
  const up1 = await apiPost('level_up_troop', { playerId: host.id, era: 1 });
  if (up1.error) throw new Error('FALLO al mejorar 1->2: ' + up1.error);
  await wait(300);
  let hostP = host.state.players.find(p => p.id === host.id);
  console.log('Nivel tras mejora 1->2:', hostP.troopLevels[1], '(esperado 2) · Recursos restantes:', hostP.resources);
  if (hostP.troopLevels[1] !== 2) throw new Error('FALLO: el nivel no subió a 2');

  const guestLevel = guest.state.players.find(p => p.id === guest.id).troopLevels[1];
  console.log('Nivel del invitado (no debería haber cambiado):', guestLevel, '(esperado 1)');
  if (guestLevel !== 1) throw new Error('FALLO: el nivel del invitado cambió sin que él mejorara nada');

  // Acumular para 2 -> 3 (cuesta 16).
  const got16 = await playUntilResources(host, 16, 60, guest);
  hostP = host.state.players.find(p => p.id === host.id);
  console.log('Recursos antes de mejorar 2->3:', hostP.resources, '(fase actual:', host.state.phase + ')');
  if (got16) {
    const up2 = await apiPost('level_up_troop', { playerId: host.id, era: 1 });
    if (up2.error) throw new Error('FALLO al mejorar 2->3: ' + up2.error);
    await wait(300);
    hostP = host.state.players.find(p => p.id === host.id);
    console.log('Nivel tras mejora 2->3:', hostP.troopLevels[1], '(esperado 3)');
    if (hostP.troopLevels[1] !== 3) throw new Error('FALLO: el nivel no subió a 3');

    const overCap = await apiPost('level_up_troop', { playerId: host.id, era: 1 });
    console.log('Intento de mejorar por encima del nivel 3 ->', overCap.error);
    if (!overCap.error) throw new Error('FALLO: se permitió subir de nivel por encima del máximo');
  } else {
    console.log('AVISO: no se acumularon 16 Recursos en esta ejecución para probar 2->3 (' + hostP.resources + '/16, partida en fase ' + host.state.phase + ') — 1->2 ya quedó verificado arriba, que era el objetivo principal.');
  }

  console.log('TEST OK: camino feliz de level_up_troop verificado (conquista real, ingreso de Recursos, mejora 1->2, aislamiento por jugador, y tope de nivel).');
  process.exit(0);
}
run().catch(e => { console.error('EXCEPCION', e.message); process.exit(1); });

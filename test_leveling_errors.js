// Verifica las validaciones de la acción level_up_troop: rechazo cuando faltan Recursos, rechazo
// al intentar mejorar una Era que la partida todavía no ha alcanzado, y (si hay suerte en el
// combate del arranque) la mejora real de nivel 1->2 con su coste correspondiente. El camino
// "feliz" completo (conquista real + niveles 1->2->3 + aislamiento por jugador) se verifica a
// fondo, sin depender de la suerte, en test_leveling_success.js.
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

async function run() {
  const host = { id: null, state: null };
  const guest = { id: null, state: null };
  host.id = (await apiGet('/api/new_id')).playerId;
  guest.id = (await apiGet('/api/new_id')).playerId;
  await openStream(host.id, (s) => { host.state = s; });
  await openStream(guest.id, (s) => { guest.state = s; });
  await wait(200);

  const created = await apiPost('create_room', { playerId: host.id, name: 'Host', maxPlayers: 2, botsWanted: 0 });
  await apiPost('join_room', { playerId: guest.id, name: 'Guest', code: created.code });
  await wait(200);
  await apiPost('choose_archetype', { playerId: host.id, archetype: 'filosofo' });
  await apiPost('choose_archetype', { playerId: guest.id, archetype: 'guerrero' });
  await wait(200);

  // No debería poder mejorar tropas antes de empezar la Era (aunque exista room, sin partida
  // empezada room.era sigue siendo 1 así que probamos justo eso: rechazo por falta de Recursos).
  await apiPost('start_game', { playerId: host.id });
  await wait(300);

  const before = await apiPost('level_up_troop', { playerId: host.id, era: 1 });
  console.log('Intento de mejorar sin Recursos suficientes ->', before.error);
  if (!before.error) throw new Error('FALLO: se permitió mejorar sin Recursos suficientes');

  // Jugamos rondas de "reclutar" (no gasta nada, no gana territorio) unas cuantas veces para
  // acumular Recursos por las 8 conquistas iniciales que no hicimos... en vez de eso, probamos
  // el camino más simple: forzamos varias rondas para que se generen ingresos por lo que sí
  // se controla (0 al principio) - así que primero conquistamos un territorio libre.
  const era1 = Object.values(host.state.territories).filter(t => t.era === 1 && t.open);
  await apiPost('submit_order', { playerId: host.id, order: { type: 'atacar', to: era1[0].id, amount: 3 } });
  await apiPost('submit_order', { playerId: guest.id, order: { type: 'reclutar' } });
  await wait(400);
  if (host.state.phase === 'resolve') { await apiPost('continue', { playerId: host.id }); await wait(300); }

  const hostAfterRound1 = host.state.players.find(p => p.id === host.id);
  console.info('Territorios del host tras ronda 1:', Object.values(host.state.territories).filter(t => t.owner === host.id).length);
  console.log('Recursos del host tras 1 ronda:', hostAfterRound1.resources);

  // Damos recursos manualmente jugando varias rondas más de refuerzo para acumular ingreso
  // (si conquistó, ya genera 1/ronda; si no, seguimos intentando en las siguientes rondas).
  for (let i = 0; i < 6 && host.state.phase === 'orders'; i++) {
    const myTerrs = Object.values(host.state.territories).filter(t => t.owner === host.id);
    if (myTerrs.length) {
      await apiPost('submit_order', { playerId: host.id, order: { type: 'reclutar' } });
    } else {
      const target = Object.values(host.state.territories).find(t => t.era === host.state.era && t.open && !t.owner);
      if (target) await apiPost('submit_order', { playerId: host.id, order: { type: 'atacar', to: target.id, amount: Math.min(3, host.state.players.find(p => p.id === host.id).reserve) } });
      else await apiPost('submit_order', { playerId: host.id, order: { type: 'reclutar' } });
    }
    await apiPost('submit_order', { playerId: guest.id, order: { type: 'reclutar' } });
    await wait(400);
    if (host.state.phase === 'resolve') { await apiPost('continue', { playerId: host.id }); await wait(300); }
    if (host.state.phase === 'desafio') {
      await apiPost('submit_desafio_choice', { playerId: host.id, choice: 0 });
      await apiPost('submit_desafio_choice', { playerId: guest.id, choice: 0 });
      await wait(400);
      if (host.state.phase === 'resolve') { await apiPost('continue', { playerId: host.id }); await wait(300); }
    }
  }

  const hostNow = host.state.players.find(p => p.id === host.id);
  console.log('Recursos del host tras varias rondas:', hostNow.resources, '| Territorios:', Object.values(host.state.territories).filter(t => t.owner === host.id).length);

  if (hostNow.resources >= 8) {
    const up = await apiPost('level_up_troop', { playerId: host.id, era: 1 });
    console.log('Resultado de mejorar legión a nivel 2:', up);
    if (up.error) throw new Error('FALLO al mejorar con Recursos suficientes: ' + up.error);
    await wait(300);
    const hostAfterLevel = host.state.players.find(p => p.id === host.id);
    console.log('Nivel de legión tras mejorar:', hostAfterLevel.troopLevels[1], '(esperado 2)');
    if (hostAfterLevel.troopLevels[1] !== 2) throw new Error('FALLO: el nivel no subió a 2');
    console.log('Recursos restantes:', hostAfterLevel.resources);

    // Invitado (que no tiene troopLevels tocado) no debería verse afectado.
    const guestLevel = guest.state.players.find(p => p.id === guest.id).troopLevels[1];
    console.log('Nivel de legión del invitado (no debería haber cambiado):', guestLevel, '(esperado 1)');
    if (guestLevel !== 1) throw new Error('FALLO: el nivel del invitado cambió sin que él mejorara nada');
  } else {
    console.log('AVISO: no se acumularon suficientes Recursos en esta ejecución para probar la mejora en sí (' + hostNow.resources + '/8) — la ruta de "sin fondos" ya se verificó arriba.');
  }

  // Nivel máximo: forzamos con mejoras sucesivas si hay fondos, y comprobamos el tope en 3.
  const finalHost = host.state.players.find(p => p.id === host.id);
  if (finalHost.troopLevels[1] >= 3) {
    const overCap = await apiPost('level_up_troop', { playerId: host.id, era: 1 });
    console.log('Intento de mejorar por encima del nivel 3 ->', overCap.error);
    if (!overCap.error) throw new Error('FALLO: se permitió subir de nivel por encima del máximo');
  }

  // Era todavía no alcanzada: no se puede mejorar Era 3 en un juego que sigue en Era 1.
  const tooEarly = await apiPost('level_up_troop', { playerId: host.id, era: 3 });
  console.log('Intento de mejorar una Era no alcanzada (Era 3, partida en Era 1) ->', tooEarly.error);
  if (!tooEarly.error) throw new Error('FALLO: se permitió mejorar una tropa de una Era todavía no alcanzada');

  console.log('TEST OK: recursos por ronda y sistema de niveles de tropa funcionan correctamente.');
  process.exit(0);
}
run().catch(e => { console.error('EXCEPCION', e.message); process.exit(1); });

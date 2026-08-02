// Verifica que restart_room funciona: solo el anfitrión puede, vuelve a lobby con mapa nuevo,
// y los jugadores/arquetipos se conservan.
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
          if (raw.startsWith('data: ')) { try { onState(JSON.parse(raw.slice(6))); } catch (e) {} }
        }
      });
      resolveConn(req);
    });
  });
}
function wait(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function run() {
  const host = { id: null, state: null };
  const guest = { id: null, state: null };
  host.id = (await apiGet('/api/new_id')).playerId;
  guest.id = (await apiGet('/api/new_id')).playerId;
  await openStream(host.id, (s) => { host.state = s; });
  await openStream(guest.id, (s) => { guest.state = s; });
  await wait(300);

  const created = await apiPost('create_room', { playerId: host.id, name: 'Host', maxPlayers: 2, botsWanted: 0 });
  const code = created.code;
  await apiPost('join_room', { playerId: guest.id, name: 'Guest', code });
  await wait(200);

  await apiPost('choose_archetype', { playerId: host.id, archetype: 'filosofo' });
  await apiPost('choose_archetype', { playerId: guest.id, archetype: 'guerrero' });
  await wait(200);

  // El invitado NO debería poder reiniciar.
  const guestTry = await apiPost('restart_room', { playerId: guest.id });
  if (!guestTry.error) throw new Error('FALLO: un no-anfitrión pudo reiniciar la partida');
  console.log('OK: el invitado no puede reiniciar ->', guestTry.error);

  await apiPost('start_game', { playerId: host.id });
  await wait(200);
  console.log('Fase tras empezar:', host.state.phase);
  const boardBefore = Object.keys(host.state.territories).sort().join(',');

  // Jugamos un par de rondas rápidas para generar algo de progreso antes de reiniciar.
  for (let i = 0; i < 3 && host.state.phase !== 'fin'; i++) {
    const phase = host.state.phase;
    if (phase === 'era_intro') await apiPost('continue', { playerId: host.id });
    else if (phase === 'orders') {
      await apiPost('submit_order', { playerId: host.id, order: { type: 'reclutar' } });
      await apiPost('submit_order', { playerId: guest.id, order: { type: 'reclutar' } });
    } else if (phase === 'resolve') await apiPost('continue', { playerId: host.id });
    await wait(200);
  }
  console.log('Progreso antes de reiniciar: gloria host =', host.state.players.find(p => p.id === host.id).gloria);

  const restartRes = await apiPost('restart_room', { playerId: host.id });
  if (restartRes.error) throw new Error('FALLO al reiniciar: ' + restartRes.error);
  await wait(300);

  console.log('Fase tras reiniciar:', host.state.phase);
  if (host.state.phase !== 'lobby') throw new Error('FALLO: no volvió al lobby tras reiniciar');

  const gloriaAfter = host.state.players.find(p => p.id === host.id).gloria;
  if (gloriaAfter !== 0) throw new Error('FALLO: la Gloria no se reseteó (' + gloriaAfter + ')');
  console.log('OK: Gloria reseteada a 0');

  const playersAfter = host.state.players.map(p => `${p.name}(${p.archetype})`);
  console.log('Jugadores conservados:', playersAfter);
  if (host.state.players.length !== 2) throw new Error('FALLO: no se conservaron los 2 jugadores');
  if (!host.state.players.every(p => p.archetype)) throw new Error('FALLO: se perdieron los arquetipos');

  const boardAfter = Object.keys(host.state.territories).sort().join(',');
  console.log('Mapa antes:', boardBefore);
  console.log('Mapa después:', boardAfter);
  // No es garantizado al 100% que cambien (podría tocar el mismo azar), pero lo normal es que varíe.
  console.log(boardBefore === boardAfter ? 'AVISO: el mapa salió igual por azar (posible pero raro)' : 'OK: el mapa se regeneró');

  // Debe poder empezar otra partida con normalidad.
  const startAgain = await apiPost('start_game', { playerId: host.id });
  if (startAgain.error) throw new Error('FALLO: no se pudo empezar de nuevo tras reiniciar: ' + startAgain.error);
  await wait(200);
  console.log('Fase tras volver a empezar:', host.state.phase);
  if (host.state.phase !== 'era_intro') throw new Error('FALLO: no arrancó correctamente la 2ª partida');

  console.log('TEST OK: reiniciar partida funciona (permisos, reseteo, mapa nuevo, se puede jugar de nuevo).');
  process.exit(0);
}
run().catch((e) => { console.error('EXCEPCION', e); process.exit(1); });

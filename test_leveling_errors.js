// Verifica las validaciones de level_up_troop (por CLASE) y construir_maravilla: rechazo cuando
// faltan Recursos, clase inválida, construir en territorio ajeno... Todos estos caminos son
// deterministas (no dependen de dados). El camino "feliz" completo se verifica aparte, sin
// depender de la suerte, en test_leveling_success.js.
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
  await apiPost('choose_leader', { playerId: host.id, leader: 'juana' });
  await apiPost('choose_leader', { playerId: guest.id, leader: 'alejandro' });
  await wait(200);
  await apiPost('start_game', { playerId: host.id });
  await wait(300);

  // 1) Mejorar sin Recursos suficientes (coste base de nivel 2: 8).
  const noFunds = await apiPost('level_up_troop', { playerId: host.id, cls: 'inf' });
  console.log('Mejorar inf sin Recursos ->', noFunds.error);
  if (!noFunds.error) throw new Error('FALLO: se permitió mejorar sin Recursos suficientes');

  // 2) Clase inválida.
  const badCls = await apiPost('level_up_troop', { playerId: host.id, cls: 'elefantes' });
  console.log('Clase inválida ->', badCls.error);
  if (!badCls.error) throw new Error('FALLO: se aceptó una clase de tropa inexistente');

  // 3) Maravilla en territorio que no es tuyo.
  const anyTerr = Object.values(host.state.territories).find(t => t.open);
  const notMine = await apiPost('construir_maravilla', { playerId: host.id, territoryId: anyTerr.id });
  console.log('Maravilla en territorio ajeno/neutral ->', notMine.error);
  if (!notMine.error) throw new Error('FALLO: se permitió construir una Maravilla en territorio ajeno');

  // 4) Maravilla en territorio inexistente.
  const ghost = await apiPost('construir_maravilla', { playerId: host.id, territoryId: 'atlantida' });
  console.log('Maravilla en territorio inexistente ->', ghost.error);
  if (!ghost.error) throw new Error('FALLO: se aceptó un territorio inexistente');

  // 5) El coste con el descuento de Sun Tzu se aplica solo a Sun Tzu (aquí nadie lo lleva:
  //    el mensaje de error debe pedir el coste completo, 8).
  if (!/necesitas 8/.test(noFunds.error)) throw new Error('FALLO: el coste sin descuento debería ser 8, el error dice: ' + noFunds.error);
  console.log('OK: coste sin descuento verificado (8).');

  console.log('TEST OK: validaciones de mejora de clase y de Maravillas correctas.');
  process.exit(0);
}
run().catch(e => { console.error('EXCEPCION', e.message); process.exit(1); });

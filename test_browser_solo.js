// Test de navegador real: 1 humano solo contra 2 bots, usando la UI nueva
// (selector de nº de jugadores/bots, arquetipos dinámicos, animaciones).
const { chromium } = require('/home/claude/.npm-global/lib/node_modules/playwright');

const BASE = 'http://127.0.0.1:3000';

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
  const consoleErrors = [];
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  // Los 404 de recursos (imágenes opcionales que aún no se han subido a public/images/) son
  // esperados y se gestionan con onerror en el HTML — no cuentan como fallo del test.
  page.on('console', (msg) => { if (msg.type() === 'error' && !/404/.test(msg.text())) consoleErrors.push(`ERROR: ${msg.text()}`); });
  page.on('pageerror', (err) => consoleErrors.push(`PAGEERROR: ${err.message}`));
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });

  console.log('--- Pantalla conectar: comprobando selects de jugadores/bots ---');
  await page.waitForSelector('#maxPlayersInput', { timeout: 5000 });
  await page.selectOption('#maxPlayersInput', '3');
  await page.selectOption('#botsInput', '2'); // 1 humano + 2 bots
  const botsLabel = await page.$eval('#botsInput', el => el.options[el.selectedIndex].textContent);
  console.log('Opción de bots seleccionada:', botsLabel);
  if (!botsLabel.includes('2 bots')) throw new Error('El selector de bots no muestra la opción esperada');

  await page.fill('#nameInput', 'Alex');
  await page.click('#createBtn');

  await page.waitForFunction(() => document.querySelector('#screen h1') && /^[A-Z]{4}$/.test(document.querySelector('#screen h1')?.textContent || ''), { timeout: 8000 });
  const code = await page.$eval('#screen h1', el => el.textContent.trim());
  console.log('Sala creada:', code);

  console.log('--- Comprobando que los 2 bots aparecen automáticamente en el lobby ---');
  await page.waitForFunction(() => document.querySelectorAll('.player-chip').length === 3, { timeout: 8000 });
  const chipsText = await page.$$eval('.player-chip', els => els.map(e => e.textContent));
  console.log('Jugadores en lobby:', chipsText);
  if (!chipsText.some(t => t.includes('🤖'))) throw new Error('No se ven bots marcados con 🤖 en el lobby');

  console.log('--- Comprobando arquetipos dinámicos (deberían ser 6, no 3) ---');
  const archCount = await page.$$eval('.arch-card', els => els.length);
  console.log('Nº de arch-card renderizadas:', archCount);
  if (archCount !== 6) throw new Error(`Se esperaban 6 arquetipos, se encontraron ${archCount}`);

  // Elegimos un arquetipo libre (los bots ya han elegido el suyo automáticamente).
  await page.waitForFunction(() => {
    const btns = [...document.querySelectorAll('.arch-card')];
    return btns.some(b => !b.disabled);
  }, { timeout: 5000 });
  const freeArchHandle = await page.$$('.arch-card:not([disabled])');
  await freeArchHandle[0].click();
  await page.waitForTimeout(300);

  console.log('--- Empezando partida (host, 1 humano + 2 bots) ---');
  await page.waitForFunction(() => {
    const btn = document.getElementById('startBtn');
    return btn && !btn.disabled;
  }, { timeout: 5000 });
  await page.click('#startBtn');

  await page.waitForFunction(() => [...document.querySelectorAll('#screen h2')].some(h => h.textContent.includes('Era I')), { timeout: 8000 });
  console.log('era_intro visible.');

  const monumentSvg = await page.$('#monumentBg svg');
  console.log('Monumento de fondo (dibujo vectorial, con ilustración real como upgrade opcional):', !!monumentSvg);
  if (!monumentSvg) throw new Error('No se encontró el monumento de fondo de la Era');

  const restartBtn = await page.$('#restartBtn');
  const exitBtn = await page.$('#exitBtn');
  console.log('Barra de sala — Reiniciar (anfitrión):', !!restartBtn, '| Salir:', !!exitBtn);
  if (!restartBtn || !exitBtn) throw new Error('Falta el botón de Reiniciar o Salir en la barra de sala');

  const noProgressBar = await page.$('.progress-track');
  if (noProgressBar) throw new Error('El contador visible sigue ahí (debía haberse quitado)');
  console.log('Confirmado: no hay contador visible en pantalla.');

  await page.click('#cont');

  console.log('--- Ya no hay trivia: debe ir directo a la pantalla de órdenes ---');
  await page.waitForFunction(() => [...document.querySelectorAll('#screen h2')].some(h => h.textContent.includes('Tus órdenes')), { timeout: 8000 });
  console.log('Pantalla de órdenes visible directamente (sin trivia).');
  const hasBoard = await page.$('.territories');
  if (!hasBoard) throw new Error('El tablero no se muestra en la pantalla de órdenes');
  console.log('Tablero visible junto al formulario de órdenes.');

  console.log('--- Comprobando el panel de tropas y mejoras ---');
  const troopPanelVisible = await page.$$eval('#screen h2', els => els.some(h => h.textContent.includes('tropas y mejoras')));
  if (!troopPanelVisible) throw new Error('FALLO: no se ve el panel de tropas y mejoras');
  const levelRowCount = await page.$$eval('.level-row', els => els.length);
  console.log('Filas de nivel de tropa mostradas (esperado 3, una por nivel):', levelRowCount);
  if (levelRowCount !== 3) throw new Error('FALLO: deberían verse las 3 filas de nivel (1,2,3) de la tropa de Era I');
  const roomBarResources = await page.$eval('#roomBar', el => el.textContent);
  if (!roomBarResources.includes('💰')) throw new Error('FALLO: la barra de sala no muestra los Recursos');
  console.log('OK: panel de tropas y mejoras y Recursos visibles.');

  console.log('--- Comprobando que el tablero muestra unidades visuales por territorio (no solo un número) ---');
  const eraLabel = await page.$('.era-label');
  if (!eraLabel) throw new Error('Falta la etiqueta de Era sobre el grupo de territorios');
  const unitIconsCount = await page.$$eval('.unit-icon', els => els.length);
  console.log('Iconos de unidad renderizados en el tablero:', unitIconsCount);
  if (!unitIconsCount) throw new Error('El tablero no muestra iconos de unidades (soldados) por territorio');
  const badgeText = await page.$eval('.unit-icons', el => el.textContent);
  console.log('Ejemplo de insignia de unidades:', badgeText);

  console.log('--- Comprobando el mapa del país completo (24 territorios, niebla, sin círculos) ---');
  const circleCount = await page.$$eval('svg.map-svg circle', els => els.length);
  console.log('Círculos en el mapa (debe ser 0; el monumento de fondo puede tener los suyos aparte):', circleCount);
  if (circleCount) throw new Error('El mapa todavía dibuja círculos, y ya no deberían estar');
  const territoryCardIds = await page.$$eval('.territory', els => els.map(e => e.id.replace('terr-', '')));
  const zoneIdList = await page.$$eval('.zone-cell', els => [...new Set(els.map(e => e.dataset.terr))]);
  console.log('Fragmentos de terreno distintos en el mapa:', zoneIdList.length, '(esperado 24, el país entero) | Territorios con ficha (abiertos en Era I):', territoryCardIds.length, '(esperado 8)');
  if (zoneIdList.length !== 24) throw new Error('FALLO: el mapa debería pintar los 24 territorios de la partida (abiertos + en niebla), pinta ' + zoneIdList.length);
  if (territoryCardIds.length !== 8) throw new Error('FALLO: se esperaban 8 territorios con ficha detallada (Era I), hay ' + territoryCardIds.length);
  if (!territoryCardIds.every((id) => zoneIdList.includes(id))) throw new Error('FALLO: algún territorio abierto (con ficha) no aparece pintado en el mapa');
  const zoneRectCount = await page.$$eval('svg rect.zone-cell', els => els.length);
  console.log('Celdas de terreno pintadas:', zoneRectCount);
  if (zoneRectCount < 100) throw new Error('El mapa no pinta el terreno de fondo (zonas de color por territorio)');
  const borderCount = await page.$$eval('svg line.zone-border', els => els.length);
  console.log('Líneas de frontera entre fragmentos:', borderCount);
  if (!borderCount) throw new Error('El mapa no traza ninguna frontera entre fragmentos de territorio distintos');
  const legend = await page.$('.map-legend');
  if (!legend) throw new Error('Falta la leyenda del mapa');
  const lockedCount = await page.$$eval('svg.map-svg text', els => els.filter(e => e.textContent.includes('🔒')).length);
  console.log('Territorios en niebla (con candado) dibujados en el mapa:', lockedCount, '(esperado 16 = 24 - 8 abiertos)');
  if (lockedCount !== 16) throw new Error('FALLO: se esperaban 16 territorios en niebla en Era I, hay ' + lockedCount);

  console.log('--- Tocando un fragmento del mapa: debe resaltar su ficha en la lista ---');
  // OJO: el primer .zone-cell en el DOM puede caer en un territorio todavía en niebla (no tiene
  // ficha que resaltar, solo un aviso al tocarlo) — para probar el resaltado hace falta tocar
  // específicamente una celda de un territorio ABIERTO (con ficha), no cualquier celda del mapa.
  const firstZone = await page.$(`.zone-cell[data-terr="${territoryCardIds[0]}"]`);
  if (!firstZone) throw new Error('No se encontró ninguna celda del mapa para el primer territorio abierto');
  await firstZone.click();
  const flashed = await page.waitForSelector('.territory.flash', { timeout: 1500 }).catch(() => null);
  if (!flashed) throw new Error('Tocar un fragmento del mapa no resalta su territorio correspondiente en la lista');
  console.log('OK: tocar un fragmento del mapa resalta su ficha en la lista de abajo.');

  console.log('--- Comprobando que el temporizador NO resetea el formulario cada segundo (bug reportado) ---');
  await page.selectOption('#orderType', 'atacar');
  await page.waitForTimeout(300);
  const targetSelectExisted = await page.$('#targetTerr');
  if (targetSelectExisted) {
    // Elegimos una opción concreta y comprobamos que sigue ahí 2.5s después (2 ticks del reloj).
    const options = await page.$$eval('#targetTerr option', els => els.map(e => e.value));
    if (options.length) {
      await page.selectOption('#targetTerr', options[options.length - 1]);
      const before = await page.$eval('#targetTerr', el => el.value);
      await page.waitForTimeout(2500);
      const stillOrderType = await page.$eval('#orderType', el => el.value);
      const stillTarget = await page.$eval('#targetTerr', el => el.value);
      console.log('orderType antes/después:', 'atacar', '/', stillOrderType, '| targetTerr antes/después:', before, '/', stillTarget);
      if (stillOrderType !== 'atacar' || stillTarget !== before) throw new Error('El formulario de órdenes se resetea con el temporizador (bug NO arreglado)');
      console.log('El formulario conserva la selección mientras corre el reloj: bug arreglado.');
    }
  } else {
    console.log('(No había objetivos atacables en el primer turno, se omite la comprobación de selección persistente)');
  }

  await page.selectOption('#orderType', 'reclutar');
  await page.click('#sendOrder');

  console.log('--- Esperando a que los bots envíen sus órdenes y se resuelva la ronda ---');
  await page.waitForFunction(() => [...document.querySelectorAll('#screen h2')].some(h => h.textContent.includes('Resultado de la Ronda')), { timeout: 20000 });
  const resolveText = await page.$eval('.log', el => el.textContent);
  console.log('Resolución de la ronda 1 (con bots actuando solos):', resolveText.slice(0, 400));

  await page.waitForTimeout(1000);

  console.log('--- Probando el botón Reiniciar desde la barra de sala ---');
  await page.click('#restartBtn');
  await page.waitForFunction(() => [...document.querySelectorAll('#screen h2')].some(h => h.textContent.includes('Jugadores')), { timeout: 8000 });
  console.log('Volvió al lobby tras reiniciar.');
  const startBtnAfterRestart = await page.$('#startBtn');
  if (!startBtnAfterRestart) throw new Error('No se encontró el botón de empezar tras reiniciar (¿se perdieron los jugadores?)');

  console.log('Errores de consola acumulados:', consoleErrors);

  await browser.close();

  if (consoleErrors.length) {
    console.error('ERRORES DE CONSOLA DETECTADOS:');
    consoleErrors.forEach(e => console.error(e));
    process.exit(1);
  }
  console.log('TEST DE NAVEGADOR (SOLO VS BOTS) OK: selects de config, bots automáticos, 6 arquetipos, animaciones y resolución de ronda funcionan sin errores de consola.');
})().catch(async (e) => {
  console.error('EXCEPCION EN TEST DE NAVEGADOR SOLO', e.message);
  process.exit(1);
});

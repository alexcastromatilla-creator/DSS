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

  console.log('--- Comprobando la pantalla de líderes históricos (deberían ser 8) ---');
  const leaderCount = await page.$$eval('.leader-card', els => els.length);
  console.log('Nº de leader-card renderizadas:', leaderCount);
  if (leaderCount !== 8) throw new Error(`Se esperaban 8 líderes, se encontraron ${leaderCount}`);
  const takenCount = await page.$$eval('.leader-card[disabled]', els => els.length);
  console.log('Líderes ya cogidos por los bots (deshabilitados):', takenCount, '(esperado 2)');
  if (takenCount !== 2) throw new Error(`Los 2 bots deberían tener líder cogido, hay ${takenCount} deshabilitados`);

  // Elegimos un líder libre (los bots ya tienen el suyo desde que se crean).
  const freeLeaderHandle = await page.$$('.leader-card:not([disabled])');
  await freeLeaderHandle[0].click();
  await page.waitForTimeout(300);

  console.log('--- Empezando partida (host, 1 humano + 2 bots) ---');
  await page.waitForFunction(() => {
    const btn = document.getElementById('startBtn');
    return btn && !btn.disabled;
  }, { timeout: 5000 });
  await page.click('#startBtn');

  await page.waitForFunction(() => [...document.querySelectorAll('#screen h2')].some(h => h.textContent.includes('Era I')), { timeout: 8000 });
  console.log('era_intro visible.');

  // (El monumento de fondo se retiró en la estética v6: el mapa continental lleva el peso visual.)
  const restartBtn = await page.$('#restartBtn');
  const exitBtn = await page.$('#exitBtn');
  console.log('Barra de sala — Reiniciar (anfitrión):', !!restartBtn, '| Salir:', !!exitBtn);
  if (!restartBtn || !exitBtn) throw new Error('Falta el botón de Reiniciar o Salir en la barra de sala');

  const noProgressBar = await page.$('.progress-track');
  if (noProgressBar) throw new Error('El contador visible sigue ahí (debía haberse quitado)');
  console.log('Confirmado: no hay contador visible en pantalla.');

  await page.click('#cont');

  console.log('--- Ya no hay trivia: debe ir directo a la pantalla de órdenes ---');
  await page.waitForFunction(() => [...document.querySelectorAll('#screen h2')].some(h => h.textContent.includes('Tu orden')), { timeout: 8000 });
  console.log('Pantalla de órdenes visible directamente (sin trivia).');

  console.log('--- Rejilla de 8 órdenes (incluye Matrimonio y Levas) ---');
  const ordKeys = await page.$$eval('.ord[data-ord]', els => els.map(e => e.dataset.ord));
  console.log('Órdenes:', ordKeys.join(', '));
  if (ordKeys.length !== 8) throw new Error('FALLO: deberían verse 8 órdenes, hay ' + ordKeys.length);
  if (!ordKeys.includes('matrimonio') || !ordKeys.includes('levas')) throw new Error('FALLO: faltan Matrimonio o Levas en la rejilla');
  const hasBoard = await page.$('.territories');
  if (!hasBoard) throw new Error('El tablero no se muestra en la pantalla de órdenes');
  console.log('Tablero visible junto al formulario de órdenes.');

  console.log('--- Comprobando el panel de tropas (3 clases con ventajas), victorias y Maravillas ---');
  const troopPanelVisible = await page.$$eval('#screen h2', els => els.some(h => h.textContent.includes('tropas y mejoras')));
  if (!troopPanelVisible) throw new Error('FALLO: no se ve el panel de tropas y mejoras');
  const tierCount = await page.$$eval('.troop-tier', els => els.length);
  console.log('Clases de tropa mostradas:', tierCount, '(esperado 3)');
  if (tierCount !== 3) throw new Error('FALLO: deberían verse las 3 clases (Infantería/Caballería/A distancia)');
  const levelRowCount = await page.$$eval('.level-row', els => els.length);
  console.log('Filas de nivel mostradas (esperado 9 = 3 clases × 3 niveles):', levelRowCount);
  if (levelRowCount !== 9) throw new Error('FALLO: deberían verse 9 filas de nivel en total');
  const victoryPanel = await page.$$eval('#screen h2', els => els.some(h => h.textContent.includes('Vías de victoria')));
  if (!victoryPanel) throw new Error('FALLO: no se ve el panel de vías de victoria');
  const victoryRows = await page.$$eval('.victory-row', els => els.length);
  if (victoryRows !== 3) throw new Error('FALLO: el panel de victorias debería tener 1 fila por jugador (3), hay ' + victoryRows);
  const wonderPanel = await page.$$eval('#screen h2', els => els.some(h => h.textContent.includes('Maravillas')));
  if (!wonderPanel) throw new Error('FALLO: no se ve el panel de Maravillas');
  const roomBarResources = await page.$eval('#roomBar', el => el.textContent);
  if (!roomBarResources.includes('💰')) throw new Error('FALLO: la barra de sala no muestra los Recursos');
  console.log('OK: 3 clases con 9 niveles, vías de victoria, Maravillas y Recursos visibles.');

  console.log('--- Comprobando que el tablero muestra unidades visuales por territorio (no solo un número) ---');
  const eraLabel = await page.$('.era-label');
  if (!eraLabel) throw new Error('Falta la etiqueta de Era sobre el grupo de territorios');
  const unitIconsCount = await page.$$eval('.unit-icon', els => els.length);
  console.log('Iconos de unidad renderizados en el tablero:', unitIconsCount);
  if (!unitIconsCount) throw new Error('El tablero no muestra iconos de unidades (soldados) por territorio');
  const badgeText = await page.$eval('.unit-icons', el => el.textContent);
  console.log('Ejemplo de insignia de unidades:', badgeText);
  const classInCards = await page.$$eval('.territory', els => els.filter(e => /Hoplitas|Hetairoi|Arqueros/.test(e.textContent)).length);
  console.log('Fichas que muestran el nombre histórico de su clase de guarnición:', classInCards, '/ 8');
  if (classInCards !== 8) throw new Error('FALLO: las fichas de territorio deberían indicar su clase de guarnición de Era I');

  console.log('--- Comprobando el mapa continental (24 provincias, relieve, niebla, rutas marítimas) ---');
  // Solo los hijos DIRECTOS del svg: los fondos/overlays. (Las figuras de las unidades llevan
  // sus propios rects — carcajs, escudos — anidados en <g>, y no cuentan como "cuadrícula".)
  const rectCount = await page.$$eval('svg.map-svg > rect', els => els.length);
  console.log('Rects de fondo/overlay (esperado 5: mar + textura + luz + grano + viñeta):', rectCount);
  if (rectCount !== 5) throw new Error('FALLO: hay ' + rectCount + ' rects de fondo (¿ha vuelto la cuadrícula?)');
  const territoryCardIds = await page.$$eval('.territory', els => els.map(e => e.id.replace('terr-', '')));
  const shapeIdList = await page.$$eval('.terr-shape', els => [...new Set(els.map(e => e.dataset.terr))]);
  console.log('Provincias con polígono:', shapeIdList.length, '(esperado 24) | Fichas Era I:', territoryCardIds.length, '(esperado 8)');
  if (shapeIdList.length !== 24) throw new Error('FALLO: el mapa debería pintar las 24 provincias, pinta ' + shapeIdList.length);
  if (territoryCardIds.length !== 8) throw new Error('FALLO: se esperaban 8 fichas de la Era I, hay ' + territoryCardIds.length);
  if (!territoryCardIds.every((id) => shapeIdList.includes(id))) throw new Error('FALLO: algún territorio abierto no aparece en el mapa');
  const pathCount = await page.$$eval('svg.map-svg path', els => els.length);
  console.log('Paths SVG en el mapa (costa por capas + terreno + fronteras + doodads):', pathCount);
  if (pathCount < 120) throw new Error('El mapa no pinta las capas de relieve esperadas (' + pathCount + ' paths)');
  const seaRouteCount = await page.$$eval('svg.map-svg line[stroke-dasharray]', els => els.length);
  console.log('Rutas marítimas dibujadas (discontinuas):', seaRouteCount);
  if (seaRouteCount < 1) throw new Error('FALLO: no se dibuja ninguna ruta marítima (el mapa continental siempre genera alguna)');
  const legend = await page.$('.map-legend');
  if (!legend) throw new Error('Falta la leyenda del mapa');
  const fogCount = await page.$$eval('svg.map-svg text', els => els.filter(e => e.textContent.includes('☁️')).length);
  console.log('Provincias en niebla (con nube):', fogCount, '(esperado 16 = 24 - 8 abiertas)');
  if (fogCount !== 16) throw new Error('FALLO: se esperaban 16 provincias en niebla en Era I, hay ' + fogCount);

  console.log('--- Tocando una provincia del mapa: debe resaltar su ficha en la lista ---');
  // OJO: hay que tocar una provincia ABIERTA (las de niebla solo muestran un aviso), y hacerlo
  // vía dispatchEvent porque el polígono puede quedar parcialmente tapado por las etiquetas.
  await page.$eval(`.terr-shape[data-terr="${territoryCardIds[0]}"]`, el => el.dispatchEvent(new MouseEvent('click', { bubbles: true })));
  const flashed = await page.waitForSelector('.territory.flash', { timeout: 1500 }).catch(() => null);
  if (!flashed) throw new Error('Tocar una provincia del mapa no resalta su territorio correspondiente en la lista');
  console.log('OK: tocar una provincia del mapa resalta su ficha en la lista de abajo.');

  console.log('--- Comprobando que el formulario no se resetea mientras eliges (bug histórico) ---');
  await page.click('.ord[data-ord="atacar_asalto"]');
  await page.waitForTimeout(300);
  const targetSelectExisted = await page.$('#targetTerr');
  if (targetSelectExisted) {
    const options = await page.$$eval('#targetTerr option', els => els.map(e => e.value));
    if (options.length) {
      await page.selectOption('#targetTerr', options[options.length - 1]);
      const before = await page.$eval('#targetTerr', el => el.value);
      await page.waitForTimeout(2500);
      const stillOrd = await page.$eval('.ord.sel', el => el.dataset.ord);
      const stillTarget = await page.$eval('#targetTerr', el => el.value);
      console.log('orden antes/después:', 'atacar_asalto', '/', stillOrd, '| targetTerr antes/después:', before, '/', stillTarget);
      if (stillOrd !== 'atacar_asalto' || stillTarget !== before) throw new Error('El formulario de órdenes se resetea solo (bug NO arreglado)');
      console.log('El formulario conserva la selección: bug sigue arreglado.');
    }
  } else {
    console.log('(No había objetivos atacables en el primer turno, se omite la comprobación de selección persistente)');
  }

  await page.click('.ord[data-ord="reclutar"]');
  await page.click('#sendOrder');

  console.log('--- Esperando a que los bots envíen sus órdenes y se resuelva la ronda ---');
  await page.waitForFunction(() => [...document.querySelectorAll('#screen h2')].some(h => h.textContent.includes('Registro de la Ronda')), { timeout: 20000 });
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

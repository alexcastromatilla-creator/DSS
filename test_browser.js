const { chromium } = require('/home/claude/.npm-global/lib/node_modules/playwright');

const BASE = 'http://127.0.0.1:3000';

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
  const names = ['Alex', 'Bea', 'Coco'];
  const consoleErrors = [];
  const contexts = [];
  const pages = [];

  for (let i = 0; i < 3; i++) {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    // Los 404 de recursos (imágenes opcionales que aún no se han subido a public/images/) son
    // esperados y se gestionan con onerror en el HTML — no cuentan como fallo del test.
    page.on('console', (msg) => { if (msg.type() === 'error' && !/404/.test(msg.text())) consoleErrors.push(`[${names[i]}] ${msg.text()}`); });
    page.on('pageerror', (err) => consoleErrors.push(`[${names[i]}] PAGEERROR: ${err.message}`));
    contexts.push(ctx);
    pages.push(page);
    await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  }

  const [p1, p2, p3] = pages;

  // Host crea sala
  await p1.fill('#nameInput', names[0]);
  await p1.click('#createBtn');
  await p1.waitForSelector('h1:has-text("")', { timeout: 5000 }).catch(() => {});
  await p1.waitForFunction(() => document.querySelector('h1') && /^[A-Z]{4}$/.test(document.querySelector('#screen h1')?.textContent || ''), { timeout: 8000 });
  const code = await p1.$eval('#screen h1', (el) => el.textContent.trim());
  console.log('Código de sala obtenido en el navegador:', code);

  for (const p of [p2, p3]) {
    await p.fill('#nameInput', names[pages.indexOf(p)]);
    await p.fill('#codeInput', code);
    await p.click('#joinBtn');
  }

  await p1.waitForFunction(() => document.querySelectorAll('.player-chip').length === 3, { timeout: 8000 });
  console.log('Los 3 jugadores aparecen en el lobby.');

  const leaders = ['alejandro', 'juana', 'pericles'];
  for (let i = 0; i < 3; i++) {
    await pages[i].click(`[data-leader="${leaders[i]}"]`);
  }
  await p1.waitForFunction(() => {
    const chips = [...document.querySelectorAll('.player-chip')];
    return chips.every((c) => !c.textContent.includes('eligiendo'));
  }, { timeout: 8000 });
  console.log('Los 3 líderes elegidos correctamente.');

  await p1.click('#startBtn');

  await p1.waitForFunction(() => [...document.querySelectorAll('#screen h2')].some(h => h.textContent.includes('Era I')), { timeout: 8000 });
  console.log('era_intro visible en el host.');
  await p1.click('#cont');

  for (const p of pages) {
    await p.waitForFunction(() => [...document.querySelectorAll('#screen h2')].some(h => h.textContent.includes('Tus órdenes')), { timeout: 8000 });
  }
  console.log('Los 3 ven la pantalla de órdenes directamente (sin trivia).');

  await p1.waitForTimeout(500);

  const troopPanelVisible = await p1.$$eval('#screen h2', els => els.some(h => h.textContent.includes('tropas y mejoras')));
  console.log('Panel de tropas y mejoras visible:', troopPanelVisible);
  if (!troopPanelVisible) throw new Error('FALLO: no se ve el panel de tropas y mejoras en la pantalla de órdenes');
  const roomBarText = await p1.$eval('#roomBar', el => el.textContent);
  console.log('Barra de sala (debe incluir Recursos):', roomBarText);
  if (!roomBarText.includes('💰')) throw new Error('FALLO: la barra de sala no muestra los Recursos');

  console.log('errores de consola hasta ahora:', consoleErrors);

  for (const p of pages) {
    await p.selectOption('#orderType', 'reclutar');
    await p.click('#sendOrder');
  }

  await p1.waitForFunction(() => [...document.querySelectorAll('#screen h2')].some(h => h.textContent.includes('Resultado de la Ronda')), { timeout: 8000 });
  const resolveText = await p1.$eval('.log', (el) => el.textContent);
  console.log('Resolución de la ronda 1 (host):', resolveText);

  await browser.close();

  if (consoleErrors.length) {
    console.error('ERRORES DE CONSOLA DETECTADOS:');
    consoleErrors.forEach((e) => console.error(e));
    process.exit(1);
  }
  console.log('TEST DE NAVEGADOR OK: lobby, arquetipos y órdenes funcionan sin errores de consola.');
})().catch(async (e) => {
  console.error('EXCEPCION EN TEST DE NAVEGADOR', e.message);
  process.exit(1);
});

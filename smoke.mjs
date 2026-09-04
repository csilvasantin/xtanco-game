// Smoke test: carga game.html en Chromium headless via Playwright y falla si
// hay errores de consola o page-errors en los primeros 6 segundos. No valida
// gameplay — solo que el bundle no esté roto.

import { chromium } from 'playwright';

const URL = process.env.SMOKE_URL || 'http://127.0.0.1:5050/game.html';

const browser = await chromium.launch();
const context = await browser.newContext();
const page = await context.newPage();

const errors = [];
const warnings = [];

// En CI servimos el game desde http://127.0.0.1:5050, pero el bundle hace
// fetch a Cloudflare Workers (admira-telegram-bridge, admira-loyalty,
// pixer-eleven, admira-marketplace) que solo aceptan origin csilvasantin.github.io.
// Estos errores CORS / ERR_FAILED / ERR_CONNECTION_REFUSED son ruido ambiental
// del CI — no rompen el bundle. El smoke valida que game.html carga y que
// XTANCO_APP + xtAPI estan expuestos, no la conectividad de los workers.
function isEnvironmentalNoise(text) {
  if (!text) return false;
  return /CORS policy/i.test(text)
      || /ERR_FAILED/i.test(text)
      || /ERR_CONNECTION_REFUSED/i.test(text)
      || /Failed to load resource/i.test(text)
      || /workers\.dev/i.test(text)
      || /admira-telegram-bridge|admira-loyalty|admira-marketplace|pixer-eleven|elgato/i.test(text)
      // dominio propio: LaLiga bloquea workers.dev en horas de fútbol, FLT-1633
      || /admira\.store|yokup\.com|digitalavatar\.ai|admira\.live/i.test(text);
}

page.on('console', (msg) => {
  const type = msg.type();
  const text = msg.text();
  if (type === 'error') {
    if (isEnvironmentalNoise(text)) return; // ignora ruido CI
    errors.push('[console.error] ' + text);
  } else if (type === 'warning') {
    if (isEnvironmentalNoise(text)) return;
    warnings.push('[console.warn] ' + text);
  }
});

page.on('pageerror', (err) => {
  errors.push('[pageerror] ' + (err && err.message ? err.message : String(err)));
});

console.log('→ Cargando ' + URL);
await page.goto(URL, { waitUntil: 'networkidle', timeout: 30_000 });

// Dejamos correr 6s para capturar errores diferidos del IIFE de game.html
await page.waitForTimeout(6_000);

// Verificación mínima: el game state está disponible
const ok = await page.evaluate(() => {
  return !!(window.XTANCO_APP && window.xtAPI);
});

await browser.close();

console.log('Errores: ' + errors.length + ' · Warnings: ' + warnings.length);
if (warnings.length) console.log(warnings.slice(0, 5).join('\n'));
if (errors.length) {
  console.error('--- ERRORES DETECTADOS ---');
  console.error(errors.join('\n'));
  process.exit(1);
}
if (!ok) {
  console.error('XTANCO_APP / xtAPI no disponibles tras la carga. El bundle no se inicializó.');
  process.exit(1);
}
console.log('✓ Página carga sin errores y window.XTANCO_APP + window.xtAPI están disponibles.');
process.exit(0);

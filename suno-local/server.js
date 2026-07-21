#!/usr/bin/env node
// suno-local · proxy minimo a la API privada de Suno usando cookie de sesion (Clerk).
// Tres endpoints (los que consume PixerIA → playSunoLocal):
//   GET  /healthz           → { ok, total_credits_left, monthly_limit }
//   POST /generate          → { clips: [...] }
//   GET  /status?ids=a,b    → [ {id, status, audio_url, ...} ]
//
// Auth: cookie Clerk pegada en .env (SUNO_COOKIE). Cada ~50s refrescamos el JWT
// via https://auth.suno.com/v1/client/sessions/<sid>/tokens y lo cacheamos.
//
// Suno no expone API publica — esto es reverse engineering: fragil, puede romperse,
// y violar TOS si se abusa. Util solo para uso personal con cuenta loginada.

const http = require('http');
const url = require('url');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { execSync } = require('child_process');

// ─── .env loader (sin dependencias) ─────────────────────────────────
(function loadEnv() {
  const envPath = path.join(__dirname, '.env');
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/);
    if (m) {
      let val = m[2].trim();
      if (/^['"].*['"]$/.test(val)) val = val.slice(1, -1);
      if (val) process.env[m[1]] = val;
    }
  }
})();

const PORT = parseInt(process.env.SUNO_LOCAL_PORT || '3777', 10);
let SUNO_COOKIE = process.env.SUNO_COOKIE || '';
const CLERK_HOST = process.env.SUNO_CLERK_HOST || 'auth.suno.com';
const CLERK_VER = process.env.SUNO_CLERK_JS_VERSION || '5.117.0';
const CLERK_API_VER = process.env.SUNO_CLERK_API_VERSION || '2025-11-10';
const CLERK_QS = `__clerk_api_version=${encodeURIComponent(CLERK_API_VER)}&_clerk_js_version=${encodeURIComponent(CLERK_VER)}`;
const SUNO_API = process.env.SUNO_API_BASE || 'https://studio-api-prod.suno.com';
const ALLOWED_ORIGINS = (process.env.SUNO_ALLOWED_ORIGINS
  || 'https://csilvasantin.github.io,http://localhost,http://127.0.0.1')
  .split(',').map(s => s.trim()).filter(Boolean);
const UA = process.env.SUNO_UA
  || 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36';

// ─── Estado de auth (compartido entre Chrome refresh y Clerk flow) ──
let cachedSid = null;
let cachedJwt = null;
let cachedJwtExp = 0;
let DIRECT_JWT_MODE = false;

// ─── Auto-refresh desde Chrome (macOS) ───────────────────────────────
// Lee las cookies de Suno directamente del SQLite de Chrome y las
// descifra con la clave del Keychain. Esto incluye __client (HttpOnly,
// no accesible por JS) que es lo que permite que Clerk auto-refresque
// el JWT cada hora sin recopiar nada a mano.
//
// Requisitos:
//   - macOS, Chrome instalado en ~/Library/Application Support/Google/Chrome.
//   - Sesión iniciada en suno.com en el profile "Default".
//   - Keychain accesible (pedirá permiso la primera vez al leer "Chrome Safe Storage").
//
// Si no estamos en macOS o Chrome no está, no hace nada y se respeta
// el SUNO_COOKIE del .env.
const CHROME_PROFILE = process.env.SUNO_CHROME_PROFILE || 'Default';
const CHROME_COOKIES_PATH = path.join(
  os.homedir(), 'Library/Application Support/Google/Chrome', CHROME_PROFILE, 'Cookies'
);
let CHROME_REFRESH_OK = false;

function refreshCookieFromChrome() {
  if (process.platform !== 'darwin') return false;
  if (!fs.existsSync(CHROME_COOKIES_PATH)) return false;
  try {
    const tmp = path.join(os.tmpdir(), `suno-local-chrome-cookies-${process.pid}.sqlite`);
    fs.copyFileSync(CHROME_COOKIES_PATH, tmp);
    const pw = execSync('security find-generic-password -wa "Chrome" -s "Chrome Safe Storage"',
      { encoding: 'utf8' }).trim();
    const key = crypto.pbkdf2Sync(pw, 'saltysalt', 1003, 16, 'sha1');
    const iv = Buffer.alloc(16, ' ');

    function decrypt(blob, hostKey) {
      if (!blob || blob.length < 4) return '';
      if (blob.slice(0, 3).toString() !== 'v10') return blob.toString();
      const ct = blob.slice(3);
      const dec = crypto.createDecipheriv('aes-128-cbc', key, iv);
      let pt = Buffer.concat([dec.update(ct), dec.final()]);
      // Chrome ≥v24 prepende sha256(host_key) (32 bytes) al plaintext.
      if (hostKey && pt.length > 32) {
        const expected = crypto.createHash('sha256').update(hostKey).digest();
        if (pt.slice(0, 32).equals(expected)) pt = pt.slice(32);
      }
      return pt.toString('utf8');
    }

    const out = execSync(
      `/usr/bin/sqlite3 -separator $'\\t' "${tmp}" ` +
      `"SELECT name, host_key, hex(encrypted_value) FROM cookies ` +
      `WHERE host_key LIKE '%suno.com' AND name IN ('__client','__session','__client_uat','_cfuvid');"`,
      { encoding: 'utf8' }
    ).trim();
    try { fs.unlinkSync(tmp); } catch (_) {}

    const wanted = ['__client', '__session', '__client_uat', '_cfuvid'];
    const found = {};
    for (const row of out.split('\n')) {
      if (!row) continue;
      const [name, host, hex] = row.split('\t');
      if (!wanted.includes(name)) continue;
      const val = decrypt(Buffer.from(hex, 'hex'), host);
      // __session aparece duplicado (suno.com + .suno.com); el de suno.com es el último escrito.
      // Si ya tenemos uno, nos quedamos con el JWT con mayor exp (parsed).
      if (found[name]) {
        try {
          const expOf = (jwt) => {
            const p = jwt.split('.');
            if (p.length !== 3) return 0;
            const pad = (s) => s + '='.repeat((4 - s.length % 4) % 4);
            const j = JSON.parse(Buffer.from(pad(p[1]).replace(/-/g,'+').replace(/_/g,'/'),'base64').toString('utf8'));
            return j.exp || 0;
          };
          if (expOf(val) > expOf(found[name])) found[name] = val;
        } catch (_) {}
      } else {
        found[name] = val;
      }
    }
    if (!found['__client'] || !found['__session']) {
      console.log('⚠ Chrome cookies sin __client/__session — ¿estás logueado en suno.com en Chrome?');
      return false;
    }
    const cookie = Object.entries(found).map(([n,v]) => `${n}=${v}`).join('; ');
    SUNO_COOKIE = cookie;
    cachedSid = null; cachedJwt = null; cachedJwtExp = 0;
    DIRECT_JWT_MODE = false;
    CHROME_REFRESH_OK = true;
    return true;
  } catch (e) {
    console.log('⚠ refreshCookieFromChrome:', e.message);
    return false;
  }
}

// Intento de auto-refresh al arranque. Si funciona, ignoramos lo que
// hubiera en .env (Chrome siempre es más fresco). Si no, caemos al
// .env como antes.
if (refreshCookieFromChrome()) {
  console.log('✓ Cookie de Suno leída de Chrome (auto-refresh activado)');
} else if (!SUNO_COOKIE) {
  // SIN salir: el proxy tiene su PROPIO Chrome headful persistente
  // (.suno-chrome-profile); el usuario inicia sesión en suno.com EN ESA ventana
  // una sola vez y la sesión persiste (la página refresca el JWT sola). No
  // dependemos de leer las cookies de los perfiles de Chrome del usuario.
  console.log('ℹ Sin cookies de Chrome/.env — usa la sesión del Chrome propio del proxy.');
  console.log('  Inicia sesión en suno.com en la ventana de Chrome que abre el proxy (una vez).');
}

// Reintento periódico cada 10 min: Chrome actualiza __session cada
// hora; con esto el server siempre tiene el JWT fresco sin que la
// página haga nada.
setInterval(() => {
  if (refreshCookieFromChrome()) {
    // silencio en consola para no spamear; solo log si algo cambia.
  }
}, 10 * 60 * 1000).unref();

// Cuando Clerk dice 401/403 (cookies caducadas o usuario deslogueado),
// abrimos Chrome en /sign-in y avisamos por Telegram. Throttle de 15 min
// para que un /healthz polling no spamee aperturas.
let LAST_REAUTH_PROMPT = 0;
const TELEGRAM_BOT = process.env.TELEGRAM_BOT_TOKEN || '';
const TELEGRAM_CHAT = process.env.TELEGRAM_CHAT_ID || '';

// abrirVentana=false → avisa por Telegram pero NO abre nada. Se usa desde ensurePage(),
// que se dispara en cada intento: abrir allí una ventana convertiría un fallo silencioso
// en ventanas saltando cada 15 min (Carlos, 21-jul-2026: «abre solo suno.com de vez en
// cuando»). La ventana de login solo la abre quien la pide a propósito.
function promptUserToReauth(reason, abrirVentana) {
  if (abrirVentana === undefined) abrirVentana = true;
  if (Date.now() - LAST_REAUTH_PROMPT < 15 * 60 * 1000) return;
  LAST_REAUTH_PROMPT = Date.now();
  // 1) Reintenta refrescar desde Chrome — quizá el usuario ya se logueó.
  if (refreshCookieFromChrome()) {
    console.log('↻ Re-leído de Chrome tras error Clerk — JWT debería volver a funcionar.');
    return;
  }
  console.log('⚠ Sesión Suno caducada en Chrome.' + (abrirVentana ? ' Abriendo /sign-in…' : ' (no abro ventana)') + '  motivo:', reason);
  if (abrirVentana) { try { execSync(`open -a "Google Chrome" "https://suno.com/sign-in"`); } catch (_) {} }
  if (TELEGRAM_BOT && TELEGRAM_CHAT) {
    const text = `⚠️ Admira DJ: sesión caducada (${reason}). Te he abierto la ventana de login para que vuelvas a entrar. Una vez logueado, el servicio retoma solo en ≤10 min (o reinícialo).`;
    const body = `chat_id=${encodeURIComponent(TELEGRAM_CHAT)}&text=${encodeURIComponent(text)}`;
    fetch(`https://api.telegram.org/bot${TELEGRAM_BOT}/sendMessage`, {
      method: 'POST', headers: {'Content-Type':'application/x-www-form-urlencoded'}, body,
    }).catch(()=>{});
  }
}

// ─── Clerk auth ─────────────────────────────────────────────────────
// Modo directo (fallback): extraer el JWT directamente del cookie
// __session cuando solo tenemos cookies accesibles por JS (sin
// __client HttpOnly). Si Chrome refresh funcionó, este bloque no
// hace nada y usamos el flujo Clerk normal (con auto-refresh).
if (!CHROME_REFRESH_OK) (function extractDirectJwt() {
  const m = SUNO_COOKIE.match(/(?:^|;\s*)__session=([^;]+)/);
  if (!m) return;
  const jwt = m[1].trim();
  try {
    const parts = jwt.split('.');
    if (parts.length !== 3) return;
    const pad = (s) => s + '='.repeat((4 - s.length % 4) % 4);
    const payload = JSON.parse(Buffer.from(pad(parts[1]).replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
    const expMs = payload.exp ? payload.exp * 1000 : 0;
    if (expMs && expMs > Date.now()) {
      cachedJwt = jwt;
      cachedJwtExp = expMs;
      DIRECT_JWT_MODE = true;
      const mins = Math.round((expMs - Date.now()) / 60000);
      console.log(`✓ JWT extraído del cookie __session (modo directo, caduca en ${mins} min — sin auto-refresh)`);
    } else {
      console.log(`⚠ JWT del cookie __session ${expMs ? 'YA CADUCÓ' : 'no tiene exp legible'} — intentaré refrescar vía Clerk`);
    }
  } catch (e) {
    console.log('⚠ no pude parsear el JWT del cookie __session:', e.message);
  }
})();

async function getSessionId() {
  if (cachedSid) return cachedSid;
  const r = await fetch(`https://${CLERK_HOST}/v1/client?${CLERK_QS}`, {
    headers: {
      cookie: SUNO_COOKIE, 'user-agent': UA, accept: 'application/json',
      origin: 'https://suno.com', referer: 'https://suno.com/',
    },
  });
  if (!r.ok) {
    if (r.status === 401 || r.status === 403) promptUserToReauth(`clerk client list ${r.status}`);
    throw new Error(`clerk client list failed ${r.status}: ${(await r.text()).slice(0, 200)}`);
  }
  const data = await r.json();
  const sessions = data?.response?.sessions || [];
  const active = sessions.find(s => s.status === 'active') || sessions[0];
  if (!active?.id) {
    promptUserToReauth('no active session');
    throw new Error('no active suno session in cookie · reloguea en la ventana de Chrome que acabo de abrir');
  }
  cachedSid = active.id;
  return cachedSid;
}

async function getJwt() {
  if (cachedJwt && Date.now() < cachedJwtExp - 30_000) return cachedJwt;
  if (DIRECT_JWT_MODE) {
    throw new Error('JWT directo caducó · recopia la cookie __session desde suno.com (vía JS de la página) — sin __client no podemos refrescar vía Clerk');
  }
  const sid = await getSessionId();
  const r = await fetch(
    `https://${CLERK_HOST}/v1/client/sessions/${sid}/tokens?${CLERK_QS}`,
    { method: 'POST', headers: {
      cookie: SUNO_COOKIE, 'user-agent': UA, accept: 'application/json',
      origin: 'https://suno.com', referer: 'https://suno.com/',
    } }
  );
  if (!r.ok) {
    cachedSid = null; // forzar redescubrimiento
    if (r.status === 401 || r.status === 403) promptUserToReauth(`clerk token ${r.status}`);
    throw new Error(`clerk token refresh failed ${r.status}: ${(await r.text()).slice(0, 200)}`);
  }
  const data = await r.json();
  if (!data?.jwt) throw new Error('clerk response missing jwt');
  cachedJwt = data.jwt;
  cachedJwtExp = Date.now() + 50_000;
  return cachedJwt;
}

// ─── Puppeteer (Chromium invisible para puentear Turnstile) ──────────
// Suno ha endurecido Cloudflare Turnstile en /api/generate/v2/ y similar:
// rechaza 422 'token_validation_failed' aunque el JWT sea válido si la
// request no viene de un contexto de navegador "limpio" (cf_clearance,
// challenge cookies). Solución: lanzamos un Chromium headless al
// arrancar, le inyectamos las cookies decifradas de tu Chrome, lo
// dejamos en https://suno.com/create, y todos los fetch a la API se
// ejecutan DENTRO de esa página via page.evaluate. El navegador
// resuelve Turnstile solo en el primer navigate y reutilizamos.
let puppeteer = null;
try {
  // puppeteer-extra + stealth disfraza marcadores de automation que Cloudflare/Clerk
  // usan para detectar headless. Sigue habiendo casos (Clerk Turnstile en endpoints
  // como /api/generate/v2/) donde Suno rechaza igual; el bypass completo requiere
  // que el widget Turnstile renderice — fuera de alcance hoy.
  puppeteer = require('puppeteer-extra');
  const stealth = require('puppeteer-extra-plugin-stealth');
  puppeteer.use(stealth());
} catch (e) {
  try { puppeteer = require('puppeteer'); } catch (e2) {
    console.log('⚠ puppeteer no instalado — /generate y /status no funcionarán (solo /healthz)');
  }
}
let browser = null;
let page = null;
let pageReadyPromise = null;

function buildPuppeteerCookies() {
  if (process.platform !== 'darwin' || !fs.existsSync(CHROME_COOKIES_PATH)) return [];
  try {
    const tmp = path.join(os.tmpdir(), `suno-local-pup-${process.pid}.sqlite`);
    fs.copyFileSync(CHROME_COOKIES_PATH, tmp);
    const pw = execSync('security find-generic-password -wa "Chrome" -s "Chrome Safe Storage"', {encoding:'utf8'}).trim();
    const key = crypto.pbkdf2Sync(pw, 'saltysalt', 1003, 16, 'sha1');
    const iv = Buffer.alloc(16, ' ');
    function dec(b, h){
      if(!b||b.length<4)return'';
      if(b.slice(0,3).toString()!=='v10')return b.toString();
      const d=crypto.createDecipheriv('aes-128-cbc',key,iv);
      let p=Buffer.concat([d.update(b.slice(3)),d.final()]);
      if(h&&p.length>32){const e=crypto.createHash('sha256').update(h).digest();if(p.slice(0,32).equals(e))p=p.slice(32);}
      return p.toString('utf8');
    }
    const rows = execSync(
      `/usr/bin/sqlite3 -separator $'\\t' "${tmp}" "SELECT name, host_key, hex(encrypted_value), is_secure, is_httponly, path FROM cookies WHERE host_key LIKE '%suno.com';"`,
      {encoding:'utf8'}
    ).trim().split('\n');
    try { fs.unlinkSync(tmp); } catch(_) {}
    const out = [];
    for (const r of rows) {
      if (!r) continue;
      const [name, host, hex, sec, http, cpath] = r.split('\t');
      out.push({name, value: dec(Buffer.from(hex,'hex'), host), domain: host, path: cpath||'/', secure: sec==='1', httpOnly: http==='1', sameSite:'Lax'});
    }
    return out;
  } catch (e) {
    console.log('⚠ buildPuppeteerCookies:', e.message);
    return [];
  }
}

// Mata los Chrome que tengan tomado este perfil y borra los ficheros Singleton*
// (el lock que provoca "browser is already running"). Best-effort, síncrono.
function cleanProfileLocks(profileDir) {
  try { execSync(`pkill -9 -f '${profileDir}' 2>/dev/null || true`); } catch (_) {}
  try { execSync('sleep 1'); } catch (_) {}
  for (const f of ['SingletonLock', 'SingletonCookie', 'SingletonSocket']) {
    try { fs.unlinkSync(path.join(profileDir, f)); } catch (_) {}
  }
}

// Reengancha el Chrome que ya esté corriendo con ESTE perfil, en vez de abrir otro.
// Puppeteer deja su endpoint en <perfil>/DevToolsActivePort; si responde, nos conectamos.
// Si el fichero está pero el Chrome ya murió, no pasa nada: seguimos al lanzamiento normal.
async function adoptarChromeVivo() {
  const profileDir = process.env.SUNO_BROWSER_PROFILE_DIR || path.join(__dirname, '.suno-chrome-profile');
  const f = path.join(profileDir, 'DevToolsActivePort');
  if (!fs.existsSync(f)) return false;
  const [puerto, ruta] = fs.readFileSync(f, 'utf8').split('\n');
  if (!puerto) return false;
  const ws = `ws://127.0.0.1:${puerto.trim()}${(ruta || '').trim()}`;
  browser = await puppeteer.connect({ browserWSEndpoint: ws, defaultViewport: null });
  browser.on('disconnected', () => { browser = null; page = null; pageReadyPromise = null; });
  console.log('↺ Reenganchado al Chrome que ya estaba abierto (no abro ventana nueva)');
  return true;
}

// Al morir el proxy (KeepAlive lo reinicia a menudo), cerrar SU Chrome. Sin esto cada
// reinicio deja un Chrome huérfano: así se llegó a 11 vivos, uno de 8 horas.
let cerrando = false;
function cerrarChrome() {
  if (cerrando) return; cerrando = true;
  try { if (browser && browser.process()) browser.process().kill('SIGTERM'); } catch (_) {}
}
['SIGTERM','SIGINT','SIGHUP'].forEach(s => process.on(s, () => { cerrarChrome(); process.exit(0); }));
process.on('exit', cerrarChrome);

async function ensurePage() {
  if (page && !page.isClosed()) return page;
  if (pageReadyPromise) return pageReadyPromise;
  if (!puppeteer) throw new Error('puppeteer no instalado');
  // ── UN SOLO CHROME, NO UNA VENTANA POR INTENTO ──────────────────────────────────────
  // Carlos, 21-jul-2026: «abre solo suno.com de vez en cuando». El navegador va HEADFUL a
  // propósito (Turnstile lo exige), así que cada arranque es una VENTANA que salta encima
  // de lo que estés haciendo. Medido hoy: 7 arranques con UN solo reinicio del proxy y
  // **11 Chrome huérfanos vivos** (el más viejo, de 8 horas).
  //
  // La causa: `browser` se pierde (crash, 'disconnected', reinicio por KeepAlive) pero el
  // proceso Chrome NO muere — nadie lo cierra. Al siguiente intento se lanza otro y el
  // anterior se queda ahí. Se arregla en dos sitios: aquí, adoptando el Chrome que ya
  // esté vivo en este perfil en vez de abrir otro; y al salir (ver el handler de cierre).
  if (!browser) { try { await adoptarChromeVivo(); } catch (_) {} }
  pageReadyPromise = (async () => {
    if (!browser) {
      // HEADFUL + perfil PERSISTENTE: Suno protege /generate con Turnstile/browser-token
      // que solo produce su JS en un navegador "real". Un Chromium headless efímero
      // choca (422). Headful + userDataDir persistente conserva cf_clearance y el
      // reto Turnstile entre arranques (se resuelve, como mucho, una vez a mano).
      const profileDir = process.env.SUNO_BROWSER_PROFILE_DIR || path.join(__dirname, '.suno-chrome-profile');
      const headless = process.env.SUNO_HEADLESS === '1';
      const launchOpts = {
        headless,
        userDataDir: profileDir,
        // Lens*/ContextMenuSearch* OFF: el overlay "Buscar imagen con Google Lens"
        // saltaba ENCIMA de la página y tapaba el botón Create → 502 intermitente.
        args: ['--no-sandbox','--disable-blink-features=AutomationControlled','--disable-features=IsolateOrigins,site-per-process,LensOverlay,LensStandalone,LensImageTranslate,ContextMenuSearchByImage,ContextMenuGoogleLensChip'],
        defaultViewport: null,
      };
      try {
        browser = await puppeteer.launch(launchOpts);
      } catch (e) {
        // Bug recurrente: un Chrome huérfano de un arranque anterior mantiene el
        // SingletonLock del perfil → "browser is already running / Use a different
        // userDataDir". Auto-cura: matar esos Chrome, borrar el lock y reintentar.
        if (/already running|SingletonLock|ProcessSingleton|user data dir/i.test(String(e && e.message))) {
          console.log('⚠ perfil bloqueado por Chrome huérfano — limpiando lock y reintentando…');
          cleanProfileLocks(profileDir);
          browser = await puppeteer.launch(launchOpts);
        } else throw e;
      }
      console.log(`✓ Chrome puppeteer ${headless?'headless':'headful'} · perfil ${profileDir}`);
      browser.on('disconnected', () => { browser = null; page = null; pageReadyPromise = null; });
    }
    const pages = await browser.pages();
    const p = pages.find(pg => { try { return pg.url().includes('suno.com'); } catch(_) { return false; } }) || await browser.newPage();
    try { await p.bringToFront(); } catch(_) {}   // para que el usuario vea la ventana y pueda loguearse
    await p.setUserAgent(UA);
    const cookies = buildPuppeteerCookies();
    if (cookies.length) { try { await p.setCookie(...cookies); } catch(_) {} }
    if (!p.url().includes('suno.com/create')) {
      console.log(`↻ Puppeteer: navegando a suno.com/create (${cookies.length} cookies inyectadas)…`);
      await p.goto('https://suno.com/create', {waitUntil:'networkidle2', timeout:60000});
    }
    // Esperar a que el composer (textareas de React) renderice de verdad —
    // sin esto, /generate y /dryrun a veces ven el DOM vacío (timing).
    try { await p.waitForFunction(() => document.querySelectorAll('textarea').length >= 2, { timeout: 25000 }); } catch(_) {}
    console.log('✓ Puppeteer: página suno.com lista');
    page = p;
    return p;
  })();
  try { return await pageReadyPromise; }
  finally { pageReadyPromise = null; }
}

// Cada 30 min refrescamos la sesión del navegador re-inyectando cookies
// frescas de tu Chrome (que rota __session vía Clerk en la web visible).
setInterval(async () => {
  if (!page || page.isClosed()) return;
  const cookies = buildPuppeteerCookies();
  if (cookies.length) {
    try { await page.setCookie(...cookies); } catch(_) {}
  }
}, 30 * 60 * 1000).unref();

async function sunoFetch(p, opts = {}) {
  const pg = await ensurePage();
  const jwt = await getJwt().catch(() => '');
  const result = await pg.evaluate(async (url, payload, jwt) => {
    const headers = {
      'Content-Type': 'application/json',
      'accept': 'application/json',
      ...(payload.headers || {}),
    };
    if (jwt) headers['Authorization'] = 'Bearer ' + jwt;
    // Suno requires these on most studio-api endpoints. Sniffed 2026-05-28.
    headers['browser-token'] = JSON.stringify({ token: btoa(JSON.stringify({ timestamp: Date.now() })) });
    const did = document.cookie.match(/suno_device_id=([^;]+)/);
    if (did && !headers['device-id']) headers['device-id'] = did[1];
    const r = await fetch(url, {
      method: payload.method || 'GET',
      headers,
      body: payload.body || undefined,
      credentials: 'include',
    });
    return { status: r.status, ok: r.ok, text: await r.text() };
  }, SUNO_API + p, { method: opts.method, body: opts.body, headers: opts.headers || {} }, jwt);
  // Devolvemos un objeto compatible con la Response usada antes por los handlers.
  return {
    ok: result.ok,
    status: result.status,
    text: async () => result.text,
    json: async () => JSON.parse(result.text),
  };
}

// ─── Generación CONDUCIENDO LA UI real (esquiva Turnstile) ───────────
// Suno valida /api/generate con un browser-token que solo produce su JS al
// pulsar Create de verdad. En vez de fabricarlo (imposible), tecleamos la
// descripción y pulsamos Create en la página real; luego recogemos los clips
// nuevos del feed (que SÍ se lee solo con el JWT).
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function getFeedIds(pg) {
  return pg.evaluate(async () => {
    try {
      const jwt = await window.Clerk.session.getToken();
      const r = await fetch('https://studio-api-prod.suno.com/api/feed/v2?page=0',
        { headers: { Authorization: 'Bearer ' + jwt }, credentials: 'include' });
      const d = await r.json();
      const clips = d.clips || d || [];
      return (Array.isArray(clips) ? clips : []).map(c => c.id);
    } catch (e) { return []; }
  });
}

async function getFeedClips(pg, ids) {
  return pg.evaluate(async (wantIds) => {
    try {
      const jwt = await window.Clerk.session.getToken();
      const want = new Set(wantIds);
      // El feed devuelve los más recientes; basta page 0 para clips recién creados.
      const r = await fetch('https://studio-api-prod.suno.com/api/feed/v2?page=0',
        { headers: { Authorization: 'Bearer ' + jwt }, credentials: 'include' });
      const d = await r.json();
      const clips = d.clips || d || [];
      return (Array.isArray(clips) ? clips : []).filter(c => want.has(c.id)).map(c => ({
        id: c.id, title: c.title, status: c.status,
        audio_url: c.audio_url, video_url: c.video_url, image_url: c.image_url,
        metadata: { duration: c.metadata && c.metadata.duration, prompt: (c.metadata && c.metadata.prompt) ? String(c.metadata.prompt).slice(0, 120) : '', tags: (c.metadata && c.metadata.tags) ? String(c.metadata.tags).slice(0, 80) : '' },
      }));
    } catch (e) { return []; }
  }, ids);
}

// Selecciona la versión del modelo en el dropdown de Suno: chirp-v5 → "v5",
// el resto → "v4.5-all". Best=Suno5.0, Better/Gemini=Suno4.5.
async function selectSunoModel(pg, model) {
  // BEST-EFFORT y NO bloqueante: si no consigue cambiar el modelo, deja el actual
  // y sigue (nunca rompe la generación). Cierra el dropdown con Escape al acabar.
  // Mapeo de 3 niveles (cuenta Pro csilva@admira.com): Good→"v4.5", Better→"v5",
  // Best→"v5.5". El frontend manda chirp-v4-5 / chirp-v5 / chirp-v5-5.
  const m = String(model || '');
  let want = 'v4.5';
  if (/v5-?5|v5\.5/i.test(m)) want = 'v5.5';
  else if (/v5/i.test(m) && !/v4/i.test(m)) want = 'v5';
  const trigger = () => pg.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find(x => /^v\d/i.test((x.innerText || '').trim().split('\n')[0]) && (x.innerText || '').trim().length < 16);
    return b ? (b.innerText || '').trim().split('\n')[0].trim().toLowerCase() : null;
  });
  try {
    if ((await trigger()) === want) return want;                 // ya está
    await pg.evaluate(() => { const b = [...document.querySelectorAll('button')].find(x => /^v\d/i.test((x.innerText || '').trim().split('\n')[0]) && (x.innerText || '').trim().length < 16); if (b) b.click(); });
    await sleep(900);
    await pg.evaluate((w) => {
      const norm = s => (s || '').trim().split('\n')[0].trim().toLowerCase();
      const t = [...document.querySelectorAll('button,[role=menuitem],div.context-menu-item')].find(e => norm(e.innerText) === w);
      if (t) t.click();
    }, want);
    await sleep(500);
    try { await pg.keyboard.press('Escape'); } catch (_) {}       // cerrar el menú si quedó abierto
    await sleep(200);
    return await trigger();
  } catch (e) { try { await pg.keyboard.press('Escape'); } catch (_) {} return false; }
}

// Cierra cualquier overlay que se cuele ENCIMA de la UI (Google Lens "Buscar
// imagen", hints de Suno, diálogos sueltos). Si tapa el botón Create, el click
// falla y la generación devuelve 502. Estrategia: pulsar Escape un par de veces
// y, si hay un botón tipo "Omitir/Skip/Dismiss/Cerrar", clicarlo. Nunca rompe.
async function dismissOverlays(pg) {
  try {
    for (let k = 0; k < 2; k++) { await pg.keyboard.press('Escape'); await sleep(120); }
    await pg.evaluate(() => {
      const txt = el => (el.innerText || el.getAttribute('aria-label') || '').trim();
      const all = [...document.querySelectorAll('button,[role="button"],a')].filter(el => el.offsetParent !== null);
      // 1) Banner de CONSENTIMIENTO de cookies — preferimos rechazar lo no esencial
      //    (privacidad). Si no hay botón de rechazo, aceptamos para que el banner no
      //    tape el CTA Create (el click nativo respeta el z-order y chocaría con él).
      const REJECT = /^(reject all|reject non.?essential|only necessary|necessary only|decline|rechazar(\s+todo)?|solo (las )?necesarias)$/i;
      const ACCEPT = /^(accept all( cookies)?|aceptar(\s+(todo|todas))?)$/i;
      const consent = all.find(el => REJECT.test(txt(el))) || all.find(el => ACCEPT.test(txt(el)));
      if (consent) consent.click();
      // 2) Otros overlays (Google Lens, hints, diálogos sueltos).
      const RE = /^(omitir|skip|dismiss|cerrar|close|no gracias|no, thanks|got it|entendido|x)$/i;
      const b = all.find(el => RE.test(txt(el)));
      if (b) b.click();
    });
    await sleep(150);
  } catch (_) {}
}

// Pulsa el botón Create REAL (el CTA grande del compositor), NO el ítem "Create"
// del menú lateral de Suno (que solo navega → 0 clips → 502). Estrategia: entre
// los botones habilitados con texto create/crear, descartar los que están en
// nav/aside/header y quedarse con el de mayor ancho (el CTA naranja). Devuelve
// {ok, n, w, txt} para diagnóstico.
async function clickCreate(pg) {
  // Marca el CTA Create real (más ancho, no-nav, habilitado; por texto o por
  // aria-label "Create song") y lo pulsa con un click NATIVO de puppeteer
  // (CDP → isTrusted=true). CLAVE: Suno emite el browser-token de /generate solo
  // ante un gesto REAL; un .click() in-page (isTrusted=false) ya NO dispara la
  // generación (endurecimiento anti-bot). El click CDP además funciona aunque la
  // ventana del proxy esté en 2º plano (se inyecta a nivel navegador, no SO).
  const sel = await pg.evaluate(() => {
    let cands = [...document.querySelectorAll('button')].filter(b => {
      const t = (b.innerText || '').trim().toLowerCase();
      const al = (b.getAttribute('aria-label') || '').trim().toLowerCase();
      return (t === 'create' || t === 'crear' || al === 'create song' || al === 'crear canción') && !b.disabled && b.offsetParent !== null;
    }).filter(b => !b.closest('nav,aside,header'));
    if (!cands.length) return null;
    cands.sort((a, b) => b.getBoundingClientRect().width - a.getBoundingClientRect().width);
    const b = cands[0];
    if (!b.id) b.id = '__suno_create_cta';
    try { b.scrollIntoView({ block: 'center' }); } catch (_) {}
    return '#' + b.id;
  });
  if (!sel) return { ok: false, n: 0 };
  try {
    const h = await pg.$(sel);
    if (!h) return { ok: false, n: 0, why: 'handle null' };
    const box = await h.boundingBox();
    await h.click({ delay: 35 });                 // click nativo CDP → isTrusted=true
    return { ok: true, n: 1, native: true, w: box ? Math.round(box.width) : 0 };
  } catch (e) {
    // Fallback in-page por si el nativo falla (fuera de viewport, etc.).
    const ok = await pg.evaluate((s) => { const b = document.querySelector(s); if (!b) return false; b.click(); return true; }, sel);
    return { ok: !!ok, n: 1, native: false, why: String(e.message || e).slice(0, 60) };
  }
}

async function uiGenerate(pg, { prompt, lyrics, title, instrumental, model }) {
  // Una canción CON letra nunca es instrumental: resuelve el conflicto cuando la
  // UI manda instrumental=true (p.ej. versión "Loop") pero hay letra escrita.
  if (lyrics && String(lyrics).trim()) instrumental = false;
  if (!pg.url().includes('suno.com/create')) {
    await pg.goto('https://suno.com/create', { waitUntil: 'networkidle2', timeout: 60000 });
  }
  // Confirmar sesión — Clerk hidrata async tras cargar la página, así que esperamos.
  const logged = await pg.evaluate(async () => {
    for (let i = 0; i < 24; i++) { if (window.Clerk && window.Clerk.session) return true; await new Promise(r => setTimeout(r, 500)); }
    return false;
  });
  if (!logged) { promptUserToReauth('puppeteer page sin sesión Clerk'); throw new Error('no logueado en suno.com en el Chrome del proxy'); }

  const before = new Set(await getFeedIds(pg));

  // Helper de relleno que React registra (valueTracker) → habilita Create.
  // (NO depende del foco de la ventana, a diferencia del tecleo CDP, que no
  // aterriza si el Chrome del proxy está en 2º plano.)
  const fillField = (s, txt) => pg.evaluate((sel, t) => {
    const el = document.querySelector(sel); if (!el) return; el.focus();
    const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value').set;
    const last = el.value; setter.call(el, t);
    if (el._valueTracker) el._valueTracker.setValue(last);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }, s, txt);

  // ── Estado DETERMINISTA por EFECTO (no por atributo: el toggle Instrumental
  //    de Suno no expone un estado fiable). NO confiar en lo que dejó la
  //    generación anterior: si quedó Instrumental ON, Suno OCULTA el campo
  //    Lyrics y la siguiente canción con letra falla. Estrategia: forzar
  //    Advanced y luego clicar Instrumental HASTA que la presencia del campo
  //    Lyrics coincida con lo pedido (visible para canción, oculto para
  //    instrumental). ──
  await pg.evaluate(() => { const adv = [...document.querySelectorAll('button')].find(b => /^advanced$|^custom$|^avanzado$/i.test((b.innerText || '').trim())); if (adv) adv.click(); });
  await sleep(500);
  const hasLyricsField = () => pg.evaluate(() => [...document.querySelectorAll('textarea')].some(x => x.offsetParent !== null && /\[|verse|chorus|estrofa|lyric|letra/i.test(x.placeholder || '')));
  for (let k = 0; k < 3; k++) {
    if ((await hasLyricsField()) === !instrumental) break;   // estado correcto ya
    await pg.evaluate(() => { const inst = [...document.querySelectorAll('button')].find(b => /^instrumental$/i.test((b.innerText || '').trim())); if (inst) inst.click(); });
    await sleep(700);
  }

  // Styles (lista por comas): el prompt SIEMPRE va aquí, sea canción o
  // instrumental. En Advanced, Create se habilita cuando Styles tiene contenido.
  const fillStyles = async (txt) => {
    if (!txt) return;
    const styleSel = await pg.evaluate(() => {
      const tas = [...document.querySelectorAll('textarea')].filter(x => x.offsetParent !== null && x.id !== '__suno_lyrics');
      const t = tas.find(x => { const p = (x.placeholder || '').trim(); return p.includes(',') && !/describe the sound|^una |^canci|^a |^an |^epic|^épica/i.test(p); })
             || tas.find(x => { const p = (x.placeholder || '').trim(); return /style|estilo|genre|género|sound|percusion|raga/i.test(p); });
      if (!t) return null; if (!t.id) t.id = '__suno_styles'; return '#' + t.id;
    });
    if (styleSel) await fillField(styleSel, String(txt).slice(0, 200));
  };

  if (lyrics) {
    // Canción: Instrumental ya quedó OFF arriba → la sección Lyrics está visible.
    // El cuadro de Letra tiene un sub-modo "Write | Prompt": en "Prompt" Suno
    // trata el texto como DESCRIPCIÓN y reescribe la letra; para letra LITERAL
    // ([Verse]…) hay que estar en "Write". Lo forzamos.
    await pg.evaluate(() => { const w = [...document.querySelectorAll('button')].find(b => /^write$|^escribir$/i.test((b.innerText || '').trim())); if (w) w.click(); });
    await sleep(500);
    const lyrSel = await pg.evaluate(() => {
      const tas = [...document.querySelectorAll('textarea')].filter(x => x.offsetParent !== null);
      // 1º el que parece letra por placeholder; si no, el que NO es Styles (sin
      // comas) ni "Describe the sound".
      let t = tas.find(x => /\[|verse|chorus|estrofa|lyric|letra|escribe/i.test(x.placeholder || ''));
      if (!t) t = tas.find(x => { const p = (x.placeholder || '').trim(); return !p.includes(',') && !/describe the sound/i.test(p); });
      if (!t) return null; if (!t.id) t.id = '__suno_lyrics'; return '#' + t.id;
    });
    if (!lyrSel) {
      const dom = await pg.evaluate(() => ({
        tas: [...document.querySelectorAll('textarea')].map(t => ({ ph: (t.placeholder || '').slice(0, 50), vis: t.offsetParent !== null })),
        btns: [...document.querySelectorAll('button')].map(b => (b.innerText || '').trim()).filter(t => t && t.length < 22).slice(0, 40),
      }));
      throw new Error('no encuentro el campo de Letra · dom=' + JSON.stringify(dom));
    }
    await fillField(lyrSel, String(lyrics).slice(0, 2900));
    await fillStyles(prompt);
    await sleep(800);
  } else {
    // Instrumental: Styles obligatorio para habilitar Create.
    await fillStyles(prompt || 'instrumental ambient bed, calm, soft');
    await sleep(700);
  }

  // Seleccionar el modelo AHORA (con los campos ya rellenos): abre/cierra el
  // dropdown sin estorbar al relleno con tecleo confiable de arriba.
  if (model) { try { await selectSunoModel(pg, model); } catch(_) {} }
  await sleep(300);

  // Espanta-overlays: cualquier popup (Google Lens, hints, dialog, banner de
  // cookies) que se cuele ENCIMA tapa el botón Create y rompe el click → 502.
  await dismissOverlays(pg);

  // Esperar a que Create quede ESTABLEMENTE habilitado antes de pulsar: clicar
  // durante un re-render transitorio (el botón aún habilitándose tras rellenar)
  // es una causa de "click que no envía". Hasta ~6s.
  for (let s = 0; s < 12; s++) {
    const ready = await pg.evaluate(() => [...document.querySelectorAll('button')].some(b => {
      const t = (b.innerText || '').trim().toLowerCase(); const al = (b.getAttribute('aria-label') || '').toLowerCase();
      return (t === 'create' || t === 'crear' || al === 'create song') && !b.disabled && b.offsetParent !== null && !b.closest('nav,aside,header');
    }));
    if (ready) break;
    await sleep(500);
  }

  const clk = await clickCreate(pg);
  if (!clk.ok) {
    const diag = await pg.evaluate(() => ({
      textareas: [...document.querySelectorAll('textarea')].filter(t => t.offsetParent !== null).map(t => ({ ph: (t.placeholder || '').slice(0, 28), val: (t.value || '').slice(0, 40), len: (t.value || '').length })),
      createBtns: [...document.querySelectorAll('button')].filter(b => /create|crear/i.test((b.innerText || '').trim())).map(b => ({ t: (b.innerText || '').trim().slice(0, 20), dis: b.disabled })),
      toggles: [...document.querySelectorAll('button')].map(b => (b.innerText || '').trim()).filter(t => /simple|advanced|custom|lyrics|instrumental|auto|write/i.test(t)).slice(0, 12),
    }));
    throw new Error('Create no disponible · diag=' + JSON.stringify(diag));
  }

  // Poll del feed (hasta ~90s). Reintenta Create a los ~16s y ~32s si AÚN no hay
  // clips: un envío que SÍ prendió aparece en el feed en pocos segundos, así que a
  // los 16s/32s sin nada el click anterior NO envió → reclicar cubre el fallo
  // (click flaky) SIN duplicar generación. El click de clickCreate es nativo (CDP,
  // isTrusted) y cada reintento espanta overlays primero.
  let fresh = [];
  for (let i = 0; i < 45; i++) {
    await sleep(2000);
    const ids = await getFeedIds(pg);
    fresh = ids.filter(id => !before.has(id));
    if (fresh.length) break;
    if (i === 8 || i === 16) {
      await dismissOverlays(pg);
      await clickCreate(pg);
    }
  }
  if (!fresh.length) {
    const diag = await pg.evaluate(async () => {
      let feedTop = [], feedErr = '';
      try { const jwt = await window.Clerk.session.getToken(); const r = await fetch('https://studio-api-prod.suno.com/api/feed/v2?page=0', { headers: { Authorization: 'Bearer ' + jwt }, credentials: 'include' }); const d = await r.json(); const c = d.clips || d || []; feedTop = (Array.isArray(c) ? c : []).slice(0, 5).map(x => ({ id: (x.id || '').slice(0, 8), st: x.status, t: (x.title || '').slice(0, 18) })); } catch (e) { feedErr = String(e.message || e); }
      return {
        turnstile: [...document.querySelectorAll('iframe')].some(f => /turnstile|challenges\.cloudflare/.test(f.src || '')),
        logged: !!(window.Clerk && window.Clerk.session),
        url: location.pathname,
        createBtns: [...document.querySelectorAll('button')].filter(b => { const t = (b.innerText || '').trim().toLowerCase(); const al = (b.getAttribute('aria-label') || '').toLowerCase(); return t === 'create' || t === 'crear' || al === 'create song'; }).map(b => ({ w: Math.round(b.getBoundingClientRect().width), dis: b.disabled, nav: !!b.closest('nav,aside,header') })),
        // longitudes de los campos rellenos: si 0, el fill no prendió y Create no envía
        fields: [...document.querySelectorAll('textarea')].filter(t => t.offsetParent !== null).map(t => ({ ph: (t.placeholder || '').slice(0, 22), len: (t.value || '').length })),
        toasts: [...document.querySelectorAll('[role="alert"],[role="status"],[class*="toast"],[class*="Toast"],[class*="sonner"]')].filter(el => el.offsetParent !== null).map(el => (el.innerText || '').replace(/\s+/g, ' ').slice(0, 120)).filter(Boolean).slice(0, 6),
        bodyHint: (document.body.innerText || '').replace(/\s+/g, ' ').slice(0, 140),
        dialogs: [...document.querySelectorAll('[role="dialog"],[aria-modal="true"],.modal')].filter(el => el.offsetParent !== null).map(el => (el.innerText || '').replace(/\s+/g, ' ').slice(0, 120)),
        feedTop, feedErr,
      };
    });
    throw new Error('no aparecieron clips nuevos tras Create · clic=' + JSON.stringify(clk) + ' · ' + JSON.stringify(diag));
  }
  return fresh.slice(0, 4);
}

// ─── Helpers HTTP ──────────────────────────────────────────────────
const rl = new Map();
function rateLimit(ip, key, limit, windowMs) {
  const now = Date.now();
  const k = `${ip}|${key}`;
  let entry = rl.get(k);
  if (!entry || now > entry.reset) entry = { count: 0, reset: now + windowMs };
  entry.count++;
  rl.set(k, entry);
  return entry.count <= limit;
}

function originAllowed(origin) {
  if (!origin) return true; // permite curl/healthz/server-to-server
  return ALLOWED_ORIGINS.some(a => origin === a || origin.startsWith(a + '/') || origin.startsWith(a));
}

function setCors(req, res) {
  const origin = req.headers.origin;
  res.setHeader('Access-Control-Allow-Origin', originAllowed(origin) ? (origin || '*') : 'null');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Vary', 'Origin');
}

function sendJson(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(obj));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let buf = '';
    req.on('data', d => {
      buf += d;
      if (buf.length > 1e6) { reject(new Error('body too large')); req.destroy(); }
    });
    req.on('end', () => {
      if (!buf) return resolve({});
      try { resolve(JSON.parse(buf)); }
      catch { reject(new Error('invalid json')); }
    });
    req.on('error', reject);
  });
}

// ─── Handlers ──────────────────────────────────────────────────────
async function handleHealthz(req, res) {
  // Usa la sesión de la PROPIA página del proxy (window.Clerk), no cookies del
  // servidor. Si no hay sesión → avisa de que hay que loguearse en su ventana.
  //
  // ⚠️ NO ABRE NAVEGADOR (Carlos, 21-jul-2026: «abre solo suno.com de vez en cuando»).
  // Este endpoint es un SONDEO: game.html y pixeria lo llaman al cargar la página, solo
  // para saber si el proxy está disponible. Como el Chrome del proxy va HEADFUL (Turnstile
  // lo exige), llamar a ensurePage() aquí significaba que **cada visita a esas páginas
  // abría una ventana de Suno encima de lo que estuvieras haciendo**. Verificado en vivo
  // hoy: con 0 navegadores, un solo `curl /healthz` abría uno.
  // Un chequeo de salud no debe tener efectos secundarios. Si el navegador ya está
  // levantado, informamos de verdad; si no, decimos que está dormido — que es la verdad —
  // y lo despierta /generate, que es quien sí necesita el navegador.
  if (!page || page.isClosed()) {
    return sendJson(res, 200, {
      ok: false, sleeping: true,
      error: 'proxy vivo, navegador dormido — se abre al generar (no lo levanto en un healthz)'
    });
  }
  try {
    const pg = await ensurePage();
    const info = await pg.evaluate(async () => {
      try {
        if (!(window.Clerk && window.Clerk.session)) return { ok: false, error: 'sin sesión · inicia sesión en suno.com en la ventana de Chrome del proxy' };
        const u = window.Clerk.user;
        const email = u ? ((u.primaryEmailAddress && u.primaryEmailAddress.emailAddress) || (u.emailAddresses && u.emailAddresses[0] && u.emailAddresses[0].emailAddress) || null) : null;
        const jwt = await window.Clerk.session.getToken();
        const r = await fetch('https://studio-api-prod.suno.com/api/billing/info/', { headers: { Authorization: 'Bearer ' + jwt }, credentials: 'include' });
        if (!r.ok) return { ok: false, account: email, error: 'billing http ' + r.status };
        const d = await r.json();
        return { ok: true, account: email, total_credits_left: d.total_credits_left ?? d.credits_left ?? 0, monthly_limit: d.monthly_limit ?? null, monthly_usage: d.monthly_usage ?? null };
      } catch (e) { return { ok: false, error: String((e && e.message) || e) }; }
    });
    sendJson(res, 200, info);
  } catch (e) {
    sendJson(res, 200, { ok: false, error: String(e.message || e) });
  }
}

async function handleGenerate(req, res) {
  const origin = req.headers.origin;
  if (!originAllowed(origin)) {
    sendJson(res, 403, { error: 'origin not allowed', origin, allowed: ALLOWED_ORIGINS });
    return;
  }
  const ip = req.socket.remoteAddress || 'unknown';
  if (!rateLimit(ip, 'generate', 3, 60_000)) {
    sendJson(res, 429, { error: 'rate limit · 3 generate por minuto por IP' });
    return;
  }
  try {
    const body = await readBody(req);
    // Token compartido = password PRO de pixeria, validado por su SHA-256 (el
    // secreto NO viaja en el JS público, solo su hash). Evita que el endpoint
    // público se abuse desde clientes no-navegador y gaste créditos.
    const expHash = process.env.SUNO_GEN_HASH || '';
    if (expHash) {
      const tok = String(body.token || '');
      const h = crypto.createHash('sha256').update(tok).digest('hex');
      if (h !== expHash) { sendJson(res, 403, { error: 'token inválido · desbloquea PRO en pixeria' }); return; }
    }
    const prompt = String(body.prompt || '').slice(0, 1500);
    const lyrics = String(body.lyrics || '').slice(0, 3000).trim();
    const title = String(body.title || '').slice(0, 80).trim();
    if (!prompt && !lyrics) { sendJson(res, 400, { error: 'missing prompt or lyrics' }); return; }
    // Generamos CONDUCIENDO la UI real (no raw API): es la única forma que pasa
    // el Turnstile/browser-token de Suno. Devolvemos los ids de los clips nuevos;
    // el frontend hace polling a /status para recoger audio_url cuando estén listos.
    const pg = await ensurePage();
    const newIds = await uiGenerate(pg, { prompt, lyrics, title, instrumental: !!body.instrumental, model: String(body.model || '') });
    const clips = newIds.map(id => ({ id, title: title || '', status: 'submitted' }));
    sendJson(res, 200, { clips, ids: newIds, mode: lyrics ? 'custom' : 'auto' });
  } catch (e) {
    sendJson(res, 502, { error: String(e.message || e), hint: 'driveUI' });
  }
}

async function handleStatus(req, res, query) {
  const ip = req.socket.remoteAddress || 'unknown';
  if (!rateLimit(ip, 'status', 60, 60_000)) {
    sendJson(res, 429, { error: 'rate limit · 60 status por minuto por IP' });
    return;
  }
  const ids = String(query.ids || '').split(',').map(s => s.trim()).filter(Boolean).slice(0, 10);
  if (!ids.length) { sendJson(res, 400, { error: 'missing ids' }); return; }
  try {
    // Leemos el feed DENTRO de la página real con el JWT (no necesita Turnstile).
    const pg = await ensurePage();
    const clips = await getFeedClips(pg, ids);
    sendJson(res, 200, clips);
  } catch (e) {
    sendJson(res, 500, { error: String(e.message || e) });
  }
}

// DIAGNÓSTICO read-only del compositor (NO genera): vuelca botones, textareas,
// modales y estado del feed para depurar por qué Create no envía. Temporal.
async function handleDiag(req, res) {
  const ip = req.socket.remoteAddress || '';
  if (!/^(127\.0\.0\.1|::1|::ffff:127\.0\.0\.1)$/.test(ip)) { sendJson(res, 403, { error: 'loopback only', ip }); return; }
  try {
    const pg = await ensurePage();
    if (!pg.url().includes('suno.com/create')) {
      try { await pg.goto('https://suno.com/create', { waitUntil: 'networkidle2', timeout: 60000 }); } catch (_) {}
    }
    const info = await pg.evaluate(async () => {
      const vis = el => el && el.offsetParent !== null;
      const btns = [...document.querySelectorAll('button')].filter(vis).map(b => ({
        t: (b.innerText || '').trim().replace(/\s+/g, ' ').slice(0, 28),
        w: Math.round(b.getBoundingClientRect().width),
        dis: b.disabled,
        nav: !!b.closest('nav,aside,header'),
        al: (b.getAttribute('aria-label') || '').slice(0, 28),
      })).filter(b => b.t || b.al);
      const tas = [...document.querySelectorAll('textarea')].map(t => ({
        ph: (t.placeholder || '').slice(0, 44), vis: vis(t), len: (t.value || '').length, id: t.id || '',
      }));
      const dialogs = [...document.querySelectorAll('[role="dialog"],[aria-modal="true"],.modal')].filter(vis).map(d => (d.innerText || '').replace(/\s+/g, ' ').slice(0, 200));
      let feedN = -1, feedErr = '';
      try { const jwt = await window.Clerk.session.getToken(); const r = await fetch('https://studio-api-prod.suno.com/api/feed/v2?page=0', { headers: { Authorization: 'Bearer ' + jwt }, credentials: 'include' }); const d = await r.json(); const c = d.clips || d || []; feedN = Array.isArray(c) ? c.length : -2; } catch (e) { feedErr = String(e.message || e); }
      return {
        url: location.pathname,
        turnstile: [...document.querySelectorAll('iframe')].some(f => /turnstile|challenges\.cloudflare/.test(f.src || '')),
        createBtns: btns.filter(b => /^create$|^crear$/i.test(b.t)),
        modelBtn: (([...document.querySelectorAll('button')].find(x => /^v\d/i.test((x.innerText || '').trim().split('\n')[0]) && (x.innerText || '').trim().length < 16) || {}).innerText || null),
        dialogs,
        textareas: tas,
        feedN, feedErr,
        allBtns: btns.slice(0, 60),
      };
    });
    sendJson(res, 200, info);
  } catch (e) {
    sendJson(res, 200, { ok: false, error: String(e.message || e) });
  }
}

// SELFTEST loopback-only (NO requiere token): dispara UNA generación real para
// verificar el click nativo de Create. Solo acepta conexiones de 127.0.0.1. Temporal.
async function handleSelftest(req, res, query) {
  const ip = req.socket.remoteAddress || '';
  if (!/^(127\.0\.0\.1|::1|::ffff:127\.0\.0\.1)$/.test(ip)) { sendJson(res, 403, { error: 'loopback only', ip }); return; }
  let shot = '';
  try {
    const pg = await ensurePage();
    const lyrics = query.lyrics != null ? String(query.lyrics) : '[Verse]\nHumo de prueba del proxy\n[Chorus]\nVuelve a cantar';
    const prompt = query.prompt != null ? String(query.prompt) : 'blues, slow, warm, acoustic';
    let result;
    try { const ids = await uiGenerate(pg, { prompt, lyrics, title: 'Selftest', instrumental: false, model: '' }); result = { ok: true, ids }; }
    catch (e) { result = { ok: false, error: String(e.message || e) }; }
    try { await pg.screenshot({ path: '/tmp/suno-selftest.png' }); shot = '/tmp/suno-selftest.png'; } catch (_) {}
    sendJson(res, 200, { ...result, shot });
  } catch (e) {
    sendJson(res, 200, { ok: false, error: String(e.message || e) });
  }
}

// ─── Server ────────────────────────────────────────────────────────
const server = http.createServer(async (req, res) => {
  const u = url.parse(req.url, true);
  setCors(req, res);
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  if (u.pathname === '/healthz' && req.method === 'GET') return handleHealthz(req, res);
  if (u.pathname === '/generate' && req.method === 'POST') return handleGenerate(req, res);
  if (u.pathname === '/status' && req.method === 'GET') return handleStatus(req, res, u.query);
  if (u.pathname === '/diag' && req.method === 'GET') return handleDiag(req, res);
  if (u.pathname === '/selftest' && req.method === 'GET') return handleSelftest(req, res, u.query);

  sendJson(res, 404, { error: 'not found', allowed: ['GET /healthz', 'POST /generate', 'GET /status?ids=...'] });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`✓ suno-local listening on http://127.0.0.1:${PORT}`);
  console.log(`  endpoints: GET /healthz · POST /generate · GET /status?ids=...`);
  console.log(`  allowed origins: ${ALLOWED_ORIGINS.join(', ')}`);
});

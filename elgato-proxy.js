const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { spawn, execFile } = require('child_process');

const GAME_DIR = __dirname;
const LOCAL_CONFIG_PATH = path.join(GAME_DIR, 'xtanco.config.local.json');
const STREAMDECK_MANIFEST_PATH = path.join(GAME_DIR, 'streamdeck-manifest.json');

const YT_DLP_CANDIDATES = ['/opt/homebrew/bin/yt-dlp', '/usr/local/bin/yt-dlp', 'yt-dlp'];
function resolveYtDlpBin() {
  for (const c of YT_DLP_CANDIDATES) {
    if (c.startsWith('/')) {
      try { fs.accessSync(c, fs.constants.X_OK); return c; } catch (e) {}
    }
  }
  return 'yt-dlp'; // rely on PATH
}
const YT_DLP_BIN = resolveYtDlpBin();

const DEFAULT_CONFIG = {
  port: 9124,
  elgato: {
    ip: '',
    port: 9123,
  },
  hue: {
    bridgeIP: '',
    apiKey: '',
    mode: 'ambiente',
    primaryLightKey: '',
    lights: {
      despacho: 9,
      comedor: 8,
    },
    enabled: true,
  },
  telegram: {
    botToken: '',
    chatId: '',
    allowedChatIds: [],
    polling: true,
    proxyUrl: 'https://admira-telegram-bridge.csilvasantin.workers.dev',
  },
  grok: {
    apiKey: '',
    baseUrl: 'https://api.x.ai/v1',
    model: 'grok-4-latest',
    proxyUrl: 'https://admira-grok-proxy.csilvasantin.workers.dev',
    systemPrompt: 'Eres AdmiraXPBot dentro del juego Admira XP. Responde de forma útil y breve en el idioma indicado por el contexto o por el usuario. Si recibes estado del juego, úsalo como contexto. No antepongas nombres de rol ni estados internos como "Unitree Bot:" o "Scan in progress".',
  },
};

function loadFileConfig() {
  try {
    return JSON.parse(fs.readFileSync(LOCAL_CONFIG_PATH, 'utf8'));
  } catch (error) {
    if (error.code !== 'ENOENT') {
      console.warn(`[config] Cannot read ${path.basename(LOCAL_CONFIG_PATH)}: ${error.message}`);
    }
    return {};
  }
}

function resolveString(envName, fileValue, fallback = '') {
  const envValue = process.env[envName];
  if (envValue !== undefined) return String(envValue).trim();
  if (typeof fileValue === 'string') return fileValue.trim();
  return fallback;
}

function resolveNumber(envName, fileValue, fallback) {
  const envValue = process.env[envName];
  if (envValue !== undefined && envValue !== '') {
    const parsed = Number(envValue);
    if (Number.isFinite(parsed)) return parsed;
  }
  const parsedFile = Number(fileValue);
  return Number.isFinite(parsedFile) ? parsedFile : fallback;
}

function resolveBoolean(envName, fileValue, fallback) {
  const envValue = process.env[envName];
  if (envValue !== undefined) {
    return !['0', 'false', 'no', 'off'].includes(String(envValue).toLowerCase());
  }
  if (typeof fileValue === 'boolean') return fileValue;
  return fallback;
}

function normalizeLights(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { ...DEFAULT_CONFIG.hue.lights };
  }
  const entries = Object.entries(value)
    .filter(([key, id]) => key && Number.isFinite(Number(id)))
    .map(([key, id]) => [String(key), Number(id)]);
  return entries.length ? Object.fromEntries(entries) : { ...DEFAULT_CONFIG.hue.lights };
}

function normalizeHueMode(value) {
  const mode = String(value || '').trim().toLowerCase();
  return ['evento', 'event'].includes(mode) ? 'evento' : 'ambiente';
}

function normalizeStringList(value) {
  if (Array.isArray(value)) return value.map(v => String(v).trim()).filter(Boolean);
  if (typeof value === 'string') return value.split(',').map(v => v.trim()).filter(Boolean);
  return [];
}

const FILE_CONFIG = loadFileConfig();
const CONFIG = {
  port: resolveNumber('XTANCO_PORT', FILE_CONFIG.port, DEFAULT_CONFIG.port),
  elgatoIp: resolveString('XTANCO_ELGATO_IP', FILE_CONFIG.elgato && FILE_CONFIG.elgato.ip, DEFAULT_CONFIG.elgato.ip),
  elgatoPort: resolveNumber('XTANCO_ELGATO_PORT', FILE_CONFIG.elgato && FILE_CONFIG.elgato.port, DEFAULT_CONFIG.elgato.port),
  hueBridgeIp: resolveString('XTANCO_HUE_BRIDGE_IP', FILE_CONFIG.hue && FILE_CONFIG.hue.bridgeIP, DEFAULT_CONFIG.hue.bridgeIP),
  hueApiKey: resolveString('XTANCO_HUE_API_KEY', FILE_CONFIG.hue && FILE_CONFIG.hue.apiKey, DEFAULT_CONFIG.hue.apiKey),
  hueMode: normalizeHueMode(resolveString('XTANCO_HUE_MODE', FILE_CONFIG.hue && FILE_CONFIG.hue.mode, DEFAULT_CONFIG.hue.mode)),
  huePrimaryLightKey: resolveString('XTANCO_HUE_PRIMARY_LIGHT', FILE_CONFIG.hue && FILE_CONFIG.hue.primaryLightKey, DEFAULT_CONFIG.hue.primaryLightKey),
  hueLights: normalizeLights(FILE_CONFIG.hue && FILE_CONFIG.hue.lights),
  hueEnabled: resolveBoolean('XTANCO_HUE_ENABLED', FILE_CONFIG.hue && FILE_CONFIG.hue.enabled, DEFAULT_CONFIG.hue.enabled),
  telegramBotToken: resolveString('XTANCO_TELEGRAM_BOT_TOKEN', FILE_CONFIG.telegram && FILE_CONFIG.telegram.botToken, DEFAULT_CONFIG.telegram.botToken),
  telegramChatId: resolveString('XTANCO_TELEGRAM_CHAT_ID', FILE_CONFIG.telegram && FILE_CONFIG.telegram.chatId, DEFAULT_CONFIG.telegram.chatId),
  telegramAllowedChatIds: normalizeStringList(
    process.env.XTANCO_TELEGRAM_ALLOWED_CHAT_IDS !== undefined
      ? process.env.XTANCO_TELEGRAM_ALLOWED_CHAT_IDS
      : FILE_CONFIG.telegram && FILE_CONFIG.telegram.allowedChatIds
  ),
  telegramPolling: resolveBoolean('XTANCO_TELEGRAM_POLLING', FILE_CONFIG.telegram && FILE_CONFIG.telegram.polling, DEFAULT_CONFIG.telegram.polling),
  telegramProxyUrl: resolveString('XTANCO_TELEGRAM_PROXY_URL', FILE_CONFIG.telegram && FILE_CONFIG.telegram.proxyUrl, DEFAULT_CONFIG.telegram.proxyUrl).replace(/\/+$/, ''),
  grokApiKey: resolveString('XAI_API_KEY', FILE_CONFIG.grok && FILE_CONFIG.grok.apiKey, DEFAULT_CONFIG.grok.apiKey),
  grokBaseUrl: resolveString('XTANCO_GROK_BASE_URL', FILE_CONFIG.grok && FILE_CONFIG.grok.baseUrl, DEFAULT_CONFIG.grok.baseUrl).replace(/\/+$/, ''),
  grokModel: resolveString('XTANCO_GROK_MODEL', FILE_CONFIG.grok && FILE_CONFIG.grok.model, DEFAULT_CONFIG.grok.model),
  grokProxyUrl: resolveString('XTANCO_GROK_PROXY_URL', FILE_CONFIG.grok && FILE_CONFIG.grok.proxyUrl, DEFAULT_CONFIG.grok.proxyUrl).replace(/\/+$/, ''),
  // Gemini (free tier). Same env var name the user already uses in Yarig.Telegram/.env.
  geminiApiKey: resolveString('GEMINI_API_KEY', FILE_CONFIG.gemini && FILE_CONFIG.gemini.apiKey, ''),
  geminiModel: resolveString('GEMINI_MODEL', FILE_CONFIG.gemini && FILE_CONFIG.gemini.model, 'gemini-2.5-flash'),
  geminiBaseUrl: resolveString('GEMINI_BASE_URL', FILE_CONFIG.gemini && FILE_CONFIG.gemini.baseUrl, 'https://generativelanguage.googleapis.com/v1beta').replace(/\/+$/, ''),
  tubeProxyUrl: resolveString('XTANCO_TUBE_PROXY_URL', FILE_CONFIG.tube && FILE_CONFIG.tube.proxyUrl, 'https://macmini.tail48b61c.ts.net/admira').replace(/\/+$/, ''),
  grokSystemPrompt: resolveString('XTANCO_GROK_SYSTEM_PROMPT', FILE_CONFIG.grok && FILE_CONFIG.grok.systemPrompt, DEFAULT_CONFIG.grok.systemPrompt),
  gameDir: GAME_DIR,
};

if (CONFIG.telegramChatId && !CONFIG.telegramAllowedChatIds.includes(CONFIG.telegramChatId)) {
  CONFIG.telegramAllowedChatIds.push(CONFIG.telegramChatId);
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function mergeDeep(base, patch) {
  if (!isPlainObject(base) || !isPlainObject(patch)) return patch;
  const out = { ...base };
  for (const [key, value] of Object.entries(patch)) {
    if (isPlainObject(value) && isPlainObject(out[key])) out[key] = mergeDeep(out[key], value);
    else out[key] = value;
  }
  return out;
}

function applyHueConfig(nextHue) {
  if (!isPlainObject(nextHue)) return;
  if (typeof nextHue.bridgeIP === 'string') CONFIG.hueBridgeIp = nextHue.bridgeIP.trim();
  if (typeof nextHue.apiKey === 'string') CONFIG.hueApiKey = nextHue.apiKey.trim();
  if (nextHue.mode !== undefined) CONFIG.hueMode = normalizeHueMode(nextHue.mode);
  if (typeof nextHue.primaryLightKey === 'string') CONFIG.huePrimaryLightKey = nextHue.primaryLightKey.trim();
  if (typeof nextHue.enabled === 'boolean') CONFIG.hueEnabled = nextHue.enabled;
  if (nextHue.lights !== undefined) CONFIG.hueLights = normalizeLights(nextHue.lights);
}

function persistConfigPatch(patch) {
  const current = loadFileConfig();
  const next = mergeDeep(current, patch);
  fs.writeFileSync(LOCAL_CONFIG_PATH, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
  if (patch && patch.hue) applyHueConfig(next.hue);
  return next;
}

function normalizeHueLightName(name, fallbackId, usedKeys) {
  let key = String(name || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  if (!key) key = `light_${fallbackId}`;
  let finalKey = key;
  let suffix = 2;
  while (usedKeys.has(finalKey)) {
    finalKey = `${key}_${suffix++}`;
  }
  usedKeys.add(finalKey);
  return finalKey;
}

function buildHueLightsMap(lightsPayload) {
  const usedKeys = new Set();
  const lightsMap = {};
  const lightsList = [];
  for (const [id, light] of Object.entries(lightsPayload || {})) {
    const safeId = Number(id);
    if (!Number.isFinite(safeId)) continue;
    const name = light && light.name ? light.name : `Light ${id}`;
    const key = normalizeHueLightName(name, id, usedKeys);
    lightsMap[key] = safeId;
    lightsList.push({
      id: safeId,
      key,
      name,
      reachable: Boolean(light && light.state && light.state.reachable),
      on: Boolean(light && light.state && light.state.on),
      type: light && light.type ? light.type : '',
      productname: light && light.productname ? light.productname : '',
    });
  }
  lightsList.sort((a, b) => a.id - b.id);
  return { lightsMap, lightsList };
}

function hueBridgeRequest({ bridgeIp, requestPath, method = 'GET', body = null, timeout = 3000 }) {
  return new Promise((resolve, reject) => {
    if (!bridgeIp) {
      reject(new Error('Hue bridge IP not configured'));
      return;
    }

    const payload = body == null
      ? ''
      : typeof body === 'string'
        ? body
        : JSON.stringify(body);

    const options = {
      hostname: bridgeIp,
      port: 80,
      path: requestPath,
      method,
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
      },
      timeout,
    };

    const proxyReq = http.request(options, proxyRes => {
      let raw = '';
      proxyRes.on('data', chunk => raw += chunk);
      proxyRes.on('end', () => {
        let parsed = raw;
        try {
          parsed = JSON.parse(raw);
        } catch (error) {
          // keep raw text for XML or plain responses
        }
        resolve({ statusCode: proxyRes.statusCode || 0, body: parsed, raw });
      });
    });

    proxyReq.on('error', reject);
    proxyReq.on('timeout', () => {
      proxyReq.destroy();
      reject(new Error('Hue timeout'));
    });

    if (payload && (method === 'POST' || method === 'PUT')) proxyReq.write(payload);
    proxyReq.end();
  });
}

function hueApiRequest(requestPath, method = 'GET', body = null, bridgeIp = CONFIG.hueBridgeIp, apiKey = CONFIG.hueApiKey) {
  if (!bridgeIp || !apiKey) {
    return Promise.reject(new Error('Hue bridge or API key not configured'));
  }
  return hueBridgeRequest({
    bridgeIp,
    requestPath: `/api/${apiKey}${requestPath}`,
    method,
    body,
  });
}

function elgatoRequest(requestPath, method = 'GET', body = null, timeout = 3000) {
  return new Promise((resolve, reject) => {
    if (!CONFIG.elgatoIp) {
      reject(new Error('Elgato IP not configured'));
      return;
    }

    const payload = body == null
      ? ''
      : typeof body === 'string'
        ? body
        : JSON.stringify(body);

    const options = {
      hostname: CONFIG.elgatoIp,
      port: CONFIG.elgatoPort,
      path: requestPath,
      method,
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
      },
      timeout,
    };

    const proxyReq = http.request(options, proxyRes => {
      let raw = '';
      proxyRes.on('data', chunk => raw += chunk);
      proxyRes.on('end', () => {
        let parsed = raw;
        try {
          parsed = JSON.parse(raw);
        } catch (error) {
          // keep raw response
        }
        resolve({ statusCode: proxyRes.statusCode || 0, body: parsed, raw });
      });
    });

    proxyReq.on('error', reject);
    proxyReq.on('timeout', () => {
      proxyReq.destroy();
      reject(new Error('Elgato timeout'));
    });

    if (payload && (method === 'POST' || method === 'PUT')) proxyReq.write(payload);
    proxyReq.end();
  });
}

function discoverHueBridges() {
  return new Promise(resolve => {
    const knownIps = new Set();
    if (CONFIG.hueBridgeIp) knownIps.add(CONFIG.hueBridgeIp);

    const req = https.request({
      hostname: 'discovery.meethue.com',
      port: 443,
      path: '/',
      method: 'GET',
      timeout: 3000,
    }, apiRes => {
      let raw = '';
      apiRes.on('data', chunk => raw += chunk);
      apiRes.on('end', async () => {
        let bridges = [];
        try {
          const discovered = JSON.parse(raw || '[]');
          if (Array.isArray(discovered)) {
            for (const entry of discovered) {
              if (entry && typeof entry.internalipaddress === 'string') {
                knownIps.add(entry.internalipaddress.trim());
              }
            }
          }
        } catch (error) {
          // ignore malformed response; we'll still return configured bridge if any
        }

        for (const bridgeIp of knownIps) {
          try {
            const info = await hueBridgeRequest({ bridgeIp, requestPath: '/api/config', method: 'GET', timeout: 1500 });
            if (info && info.body && typeof info.body === 'object') {
              bridges.push({
                internalipaddress: bridgeIp,
                name: info.body.name || 'Hue Bridge',
                apiversion: info.body.apiversion || '',
                modelid: info.body.modelid || '',
                bridgeid: info.body.bridgeid || '',
                configured: bridgeIp === CONFIG.hueBridgeIp,
              });
              continue;
            }
          } catch (error) {
            // fall through and still include the bridge candidate
          }
          bridges.push({
            internalipaddress: bridgeIp,
            name: 'Hue Bridge',
            configured: bridgeIp === CONFIG.hueBridgeIp,
          });
        }

        bridges = bridges.filter((bridge, index, arr) =>
          arr.findIndex(other => other.internalipaddress === bridge.internalipaddress) === index
        );
        resolve(bridges);
      });
    });

    req.on('error', () => resolve(Array.from(knownIps).map(bridgeIp => ({
      internalipaddress: bridgeIp,
      name: 'Hue Bridge',
      configured: bridgeIp === CONFIG.hueBridgeIp,
    }))));
    req.on('timeout', () => {
      req.destroy();
      resolve(Array.from(knownIps).map(bridgeIp => ({
        internalipaddress: bridgeIp,
        name: 'Hue Bridge',
        configured: bridgeIp === CONFIG.hueBridgeIp,
      })));
    });
    req.end();
  });
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.md': 'text/markdown; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.wav': 'audio/wav',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
};

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, PUT, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(payload));
}

function maskSecret(value) {
  if (!value) return 'not configured';
  if (value.length <= 8) return value;
  return `${value.slice(0, 6)}...${value.slice(-4)}`;
}

function runtimeConfigScript() {
  return `(() => {
  const root = typeof self !== 'undefined' ? self : window;
  root.XTANCO_RUNTIME_CONFIG = ${JSON.stringify({
    elgato: {
      proxyPort: CONFIG.port,
      directIp: CONFIG.elgatoIp,
      directPort: CONFIG.elgatoPort,
    },
    hue: {
      bridgeIP: CONFIG.hueBridgeIp,
      apiKey: CONFIG.hueApiKey,
      mode: CONFIG.hueMode,
      primaryLightKey: CONFIG.huePrimaryLightKey,
      lights: CONFIG.hueLights,
      enabled: CONFIG.hueEnabled,
    },
    telegram: {
      proxyPort: CONFIG.port,
      enabled: Boolean(CONFIG.telegramBotToken),
      proxyUrl: CONFIG.telegramProxyUrl,
      polling: CONFIG.telegramPolling,
      defaultChatId: CONFIG.telegramChatId,
    },
    grok: {
      proxyPort: CONFIG.port,
      enabled: Boolean(CONFIG.grokApiKey) || Boolean(CONFIG.geminiApiKey),
      proxyUrl: CONFIG.grokProxyUrl,
      // Reflect the actually-active model so the UI shows the right name.
      model: CONFIG.geminiApiKey ? CONFIG.geminiModel : CONFIG.grokModel,
    },
    tube: {
      // /tube/* is served by this proxy on CONFIG.port; the public URL is the Funnel pass-through.
      proxyUrl: CONFIG.tubeProxyUrl || '',
      enabled: true,
    },
  })};
})();`;
}

function cacheControlFor(ext) {
  if (ext === '.html' || ext === '.js' || ext === '.json') {
    return 'no-cache, must-revalidate';
  }
  return 'public, max-age=3600';
}

function safeFilePath(pathname) {
  const decoded = decodeURIComponent(pathname);
  const normalized = path.normalize(decoded);
  const rootDir = path.resolve(GAME_DIR);
  const relativePath = normalized.replace(/^([/\\])+/, '') || 'index.html';
  const filePath = path.resolve(rootDir, relativePath);
  const relativeToRoot = path.relative(rootDir, filePath);
  if (relativeToRoot.startsWith('..') || path.isAbsolute(relativeToRoot)) return null;
  return filePath;
}

function collectRequestBody(req, callback) {
  let reqBody = '';
  req.on('data', chunk => reqBody += chunk);
  req.on('end', () => {
    let cleanBody = reqBody;
    if (reqBody && (req.method === 'PUT' || req.method === 'POST')) {
      try {
        cleanBody = JSON.stringify(JSON.parse(reqBody));
      } catch (error) {
        cleanBody = reqBody;
      }
    }
    callback(cleanBody);
  });
}

function collectJsonBody(req, callback) {
  let reqBody = '';
  req.on('data', chunk => {
    reqBody += chunk;
    if (reqBody.length > 1024 * 1024) req.destroy();
  });
  req.on('end', () => {
    if (!reqBody) {
      callback(null, {});
      return;
    }
    try {
      callback(null, JSON.parse(reqBody));
    } catch (error) {
      callback(error);
    }
  });
}

const TELEGRAM = {
  updateOffset: 0,
  commands: [],
  nextCommandId: 1,
  pollingActive: false,
  pollingBlocked: false,
  bot: null,
  webhookInfo: null,
  lastQueuedCommand: null,
  lastSentMessageId: 0,
  lastReplyMessageId: 0,
  lastOutboundChatId: '',
  lastActivityAt: '',
  lastError: '',
};

function isTelegramConfigured() {
  return Boolean(CONFIG.telegramBotToken);
}

function isAllowedTelegramChat(chatId) {
  if (!chatId) return false;
  if (!CONFIG.telegramAllowedChatIds.length) return true;
  return CONFIG.telegramAllowedChatIds.includes(String(chatId));
}

async function refreshTelegramWebhookInfo() {
  if (!isTelegramConfigured()) {
    TELEGRAM.webhookInfo = null;
    return null;
  }
  try {
    const info = await telegramApi('getWebhookInfo');
    TELEGRAM.webhookInfo = {
      url: info.url || '',
      hasCustomCertificate: Boolean(info.has_custom_certificate),
      pendingUpdateCount: Number(info.pending_update_count || 0),
      lastErrorDate: Number(info.last_error_date || 0),
      lastErrorMessage: info.last_error_message || '',
      maxConnections: Number(info.max_connections || 0),
      ipAddress: info.ip_address || '',
    };
    return TELEGRAM.webhookInfo;
  } catch (error) {
    TELEGRAM.webhookInfo = null;
    return null;
  }
}

function telegramApi(method, payload = {}) {
  return new Promise((resolve, reject) => {
    if (!isTelegramConfigured()) {
      reject(new Error('Telegram not configured'));
      return;
    }

    const body = JSON.stringify(payload);
    const req = https.request({
      hostname: 'api.telegram.org',
      port: 443,
      path: `/bot${CONFIG.telegramBotToken}/${method}`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
      timeout: 10000,
    }, apiRes => {
      let data = '';
      apiRes.on('data', chunk => data += chunk);
      apiRes.on('end', () => {
        let json;
        try {
          json = JSON.parse(data || '{}');
        } catch (error) {
          reject(new Error(`Telegram invalid JSON: ${data.slice(0, 120)}`));
          return;
        }
        if (!json.ok) {
          reject(new Error(json.description || `Telegram HTTP ${apiRes.statusCode}`));
          return;
        }
        resolve(json.result);
      });
    });

    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Telegram timeout'));
    });
    req.write(body);
    req.end();
  });
}

function queueTelegramCommand(message) {
  const chatId = message.chat && message.chat.id;
  const text = typeof message.text === 'string' ? message.text.trim() : '';
  if (!text || !isAllowedTelegramChat(chatId)) return;

  const from = message.from || {};
  const command = {
    id: TELEGRAM.nextCommandId++,
    telegramMessageId: message.message_id,
    chatId: String(chatId),
    from: [from.first_name, from.last_name].filter(Boolean).join(' ') || from.username || 'Telegram',
    username: from.username || '',
    text,
    receivedAt: new Date((message.date || Math.floor(Date.now() / 1000)) * 1000).toISOString(),
  };
  TELEGRAM.commands.push(command);
  TELEGRAM.commands = TELEGRAM.commands.slice(-100);
  TELEGRAM.lastQueuedCommand = command;
  TELEGRAM.lastActivityAt = command.receivedAt;
  console.log(`[Telegram] queued #${command.id} from ${command.chatId}: ${command.text}`);
}

async function pollTelegramOnce() {
  if (!isTelegramConfigured() || TELEGRAM.pollingActive || TELEGRAM.pollingBlocked) return;
  TELEGRAM.pollingActive = true;
  try {
    const updates = await telegramApi('getUpdates', {
      offset: TELEGRAM.updateOffset || undefined,
      timeout: 0,
      limit: 20,
      allowed_updates: ['message'],
    });
    for (const update of updates) {
      TELEGRAM.updateOffset = Math.max(TELEGRAM.updateOffset, update.update_id + 1);
      if (update.message) queueTelegramCommand(update.message);
    }
    TELEGRAM.lastError = '';
  } catch (error) {
    if (/can't use getUpdates method while webhook is active/i.test(error.message)) {
      const webhookInfo = await refreshTelegramWebhookInfo();
      TELEGRAM.pollingBlocked = true;
      TELEGRAM.lastError = webhookInfo && webhookInfo.url
        ? `Webhook activo en ${webhookInfo.url}; desactivalo o usa el bridge publico para entrada Telegram.`
        : 'Webhook activo; desactivalo antes de usar polling local.';
      console.warn(`[Telegram] polling disabled: ${TELEGRAM.lastError}`);
    } else {
      TELEGRAM.lastError = error.message;
      console.warn(`[Telegram] poll failed: ${error.message}`);
    }
  } finally {
    TELEGRAM.pollingActive = false;
  }
}

async function initTelegram() {
  if (!isTelegramConfigured()) return;
  try {
    TELEGRAM.bot = await telegramApi('getMe');
    console.log(`[Telegram] Bot ready: @${TELEGRAM.bot.username || TELEGRAM.bot.first_name}`);
  } catch (error) {
    TELEGRAM.lastError = error.message;
    console.warn(`[Telegram] getMe failed: ${error.message}`);
  }
  await refreshTelegramWebhookInfo();
  if (CONFIG.telegramPolling) {
    if (TELEGRAM.webhookInfo && TELEGRAM.webhookInfo.url) {
      TELEGRAM.pollingBlocked = true;
      TELEGRAM.lastError = `Webhook activo en ${TELEGRAM.webhookInfo.url}; el polling local queda desactivado para evitar conflicto.`;
      console.warn(`[Telegram] polling disabled: ${TELEGRAM.lastError}`);
      return;
    }
    setInterval(pollTelegramOnce, 2500);
    pollTelegramOnce();
  }
}

function isGrokConfigured() {
  return Boolean(CONFIG.grokApiKey);
}

function isGrokProxyConfigured() {
  return Boolean(CONFIG.grokProxyUrl);
}

function isGeminiConfigured() {
  return Boolean(CONFIG.geminiApiKey);
}

function grokConfigLabel() {
  if (isGeminiConfigured()) return `configured local (${CONFIG.geminiModel})`;
  if (isGrokConfigured()) return `configured local (${CONFIG.grokModel})`;
  if (isGrokProxyConfigured()) return `configured proxy (${CONFIG.grokModel})`;
  return 'not configured';
}

// Free-tier provider: Google Gemini. Same response shape as Grok so the rest of
// the pipeline stays untouched. Requires GEMINI_API_KEY.
function geminiChat(prompt, context = '') {
  return new Promise((resolve, reject) => {
    if (!isGeminiConfigured()) {
      reject(new Error('Gemini not configured'));
      return;
    }
    const model = CONFIG.geminiModel;
    const baseUrl = (CONFIG.geminiBaseUrl || 'https://generativelanguage.googleapis.com/v1beta').replace(/\/+$/, '');
    const u = new URL(`${baseUrl}/models/${encodeURIComponent(model)}:generateContent`);
    u.searchParams.set('key', CONFIG.geminiApiKey);
    const userText = String(prompt || '').slice(0, 4000);
    const ctxText = context ? `\n\nContexto del juego:\n${String(context).slice(0, 2400)}` : '';
    const payload = {
      system_instruction: { parts: [{ text: CONFIG.grokSystemPrompt || '' }] },
      contents: [{ role: 'user', parts: [{ text: userText + ctxText }] }],
      generationConfig: { temperature: 0.7, maxOutputTokens: 700 },
    };
    const body = JSON.stringify(payload);
    const req = https.request({
      hostname: u.hostname,
      port: u.port || 443,
      path: u.pathname + u.search,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
      timeout: 35000,
    }, apiRes => {
      let data = '';
      apiRes.on('data', c => data += c);
      apiRes.on('end', () => {
        let json;
        try { json = JSON.parse(data || '{}'); }
        catch (e) { reject(new Error(`Gemini invalid JSON: ${data.slice(0, 160)}`)); return; }
        if (apiRes.statusCode < 200 || apiRes.statusCode >= 300) {
          const m = json.error && (json.error.message || json.error.code) || `Gemini HTTP ${apiRes.statusCode}`;
          reject(new Error(m));
          return;
        }
        const cand = json.candidates && json.candidates[0];
        const parts = cand && cand.content && cand.content.parts;
        const text = parts ? parts.map(p => String(p.text || '')).join('').trim() : '';
        if (!text) { reject(new Error(`Gemini empty (finish=${cand && cand.finishReason})`)); return; }
        resolve({ text, model, id: '', provider: 'gemini' });
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Gemini timeout')); });
    req.write(body);
    req.end();
  });
}

function grokApiPath(endpoint) {
  const base = new URL(CONFIG.grokBaseUrl || DEFAULT_CONFIG.grok.baseUrl);
  const cleanEndpoint = String(endpoint || '').replace(/^\/+/, '');
  const basePath = base.pathname.replace(/\/+$/, '');
  base.pathname = `${basePath}/${cleanEndpoint}`.replace(/\/{2,}/g, '/');
  return base;
}

async function grokWorkerAsk(body) {
  if (!isGrokProxyConfigured()) {
    throw new Error('Grok proxy URL not configured');
  }
  const target = `${CONFIG.grokProxyUrl}/grok/ask`;
  const response = await fetch(target, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {}),
  });
  const text = await response.text();
  let json;
  try {
    json = JSON.parse(text || '{}');
  } catch (error) {
    throw new Error(`Grok worker invalid JSON: ${text.slice(0, 160)}`);
  }
  if (!response.ok || json.error || json.ok === false) {
    throw new Error(json.message || json.error || `Grok worker HTTP ${response.status}`);
  }
  return json;
}

function grokChat(prompt, context = '') {
  return new Promise((resolve, reject) => {
    if (!isGrokConfigured()) {
      reject(new Error('Grok not configured'));
      return;
    }

    const messages = [
      { role: 'system', content: CONFIG.grokSystemPrompt },
    ];
    if (context) {
      messages.push({ role: 'system', content: `Estado actual del juego:\n${String(context).slice(0, 2400)}` });
    }
    messages.push({ role: 'user', content: String(prompt || '').slice(0, 4000) });

    const body = JSON.stringify({
      model: CONFIG.grokModel,
      messages,
      max_tokens: 700,
    });
    const target = grokApiPath('/chat/completions');
    const req = https.request({
      hostname: target.hostname,
      port: target.port || 443,
      path: target.pathname + target.search,
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${CONFIG.grokApiKey}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
      timeout: 35000,
    }, apiRes => {
      let data = '';
      apiRes.on('data', chunk => data += chunk);
      apiRes.on('end', () => {
        let json;
        try {
          json = JSON.parse(data || '{}');
        } catch (error) {
          reject(new Error(`Grok invalid JSON: ${data.slice(0, 160)}`));
          return;
        }
        if (apiRes.statusCode < 200 || apiRes.statusCode >= 300) {
          const message = json.error && (json.error.message || json.error.code) || json.message || `Grok HTTP ${apiRes.statusCode}`;
          reject(new Error(message));
          return;
        }
        const text = json.choices && json.choices[0] && json.choices[0].message && json.choices[0].message.content;
        if (!text) {
          reject(new Error('Grok response without text'));
          return;
        }
        resolve({
          text: String(text).trim(),
          model: json.model || CONFIG.grokModel,
          id: json.id || '',
        });
      });
    });

    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Grok timeout'));
    });
    req.write(body);
    req.end();
  });
}

// ─── Tube jobs: descarga asíncrona con polling (start → status → get) ─────
// El proxy se publica por Tailscale Funnel, que corta conexiones que tardan en
// empezar a responder. El antiguo /tube/download retiene la respuesta hasta que
// yt-dlp termina del todo (vídeo: descarga 2 flujos + remux → largo) y el Funnel
// la mata por inactividad → el navegador ve "Failed to fetch". El audio termina
// antes y por eso sí funciona. Solución: trocear en peticiones cortas.
const TUBE_JOBS = new Map();
const SD_QUEUE = [];
const SD_RESULTS = new Map();
const SD_MAX_QUEUE = 80;
const SD_MAX_RESULTS = 120;

function readStreamDeckManifest() {
  return JSON.parse(fs.readFileSync(STREAMDECK_MANIFEST_PATH, 'utf8'));
}

function findStreamDeckButton(manifest, pageId, buttonRef) {
  const pages = Array.isArray(manifest && manifest.pages) ? manifest.pages : [];
  const page = pages.find(p => p && p.id === pageId) || pages[0];
  if (!page || !Array.isArray(page.buttons)) return { page: null, button: null, index: -1 };
  let index = -1;
  if (Number.isFinite(Number(buttonRef))) {
    index = Number(buttonRef);
  } else if (typeof buttonRef === 'string') {
    index = page.buttons.findIndex(b => b && b.id === buttonRef);
  }
  const button = index >= 0 ? page.buttons[index] : null;
  return { page, button, index };
}

function pruneStreamDeckResults() {
  while (SD_RESULTS.size > SD_MAX_RESULTS) {
    const firstKey = SD_RESULTS.keys().next().value;
    if (!firstKey) break;
    SD_RESULTS.delete(firstKey);
  }
}

function recordStreamDeckResult(result) {
  if (!result || !result.requestId) return;
  SD_RESULTS.set(result.requestId, { ...result, receivedAt: new Date().toISOString() });
  pruneStreamDeckResults();
}

function tubeHostAllowed(host) {
  host = String(host || '').toLowerCase();
  return host === 'youtu.be' || host === 'm.youtube.com' || host.endsWith('youtube.com') || host.endsWith('youtube-nocookie.com')
    || host === 'vimeo.com' || host.endsWith('.vimeo.com') || host === 'player.vimeo.com'
    || host === 'twitter.com' || host === 'x.com' || host === 'mobile.twitter.com' || host === 't.co'
    || host === 'tiktok.com' || host.endsWith('.tiktok.com') || host === 'vm.tiktok.com'
    || host === 'instagram.com' || host.endsWith('.instagram.com')
    || host === 'linkedin.com' || host.endsWith('.linkedin.com') || host === 'lnkd.in'
    || host === 'suno.com' || host.endsWith('.suno.com');
}

// ─── Suno: yt-dlp no soporta suno.com (baja un silencio de ~30s, ver yt-dlp#10368).
// Resolvemos el share link `/s/...` (redirige a /song/<uuid>), leemos audio_url/video_url
// del JSON embebido en la página y descargamos el medio real del CDN. Para vídeo usamos
// el mp4 si existe y si no caemos al audio. SSRF acotado a suno.com y cdn*.suno.ai.
function sunoSafeHost(host) {
  host = String(host || '').toLowerCase();
  return host === 'suno.com' || host.endsWith('.suno.com') || host.endsWith('.suno.ai');
}

// GET con seguimiento de redirecciones (máx 5) y host acotado a Suno.
// onText(err, { body }) si toFile es null; si no, descarga a fichero y onText(err, { bytes }).
function sunoFetch(urlStr, toFile, cb, redirectsLeft = 5, maxBytes = 50 * 1024 * 1024) {
  let u;
  try { u = new URL(urlStr); } catch (e) { return cb(new Error('bad url')); }
  if (!sunoSafeHost(u.hostname)) return cb(new Error('host fuera de Suno: ' + u.hostname));
  const lib = u.protocol === 'http:' ? http : https;
  const req = lib.get(u, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
      'Accept': '*/*',
    },
  }, (resp) => {
    const sc = resp.statusCode || 0;
    if (sc >= 300 && sc < 400 && resp.headers.location) {
      resp.resume();
      if (redirectsLeft <= 0) return cb(new Error('demasiadas redirecciones'));
      const next = new URL(resp.headers.location, u).toString();
      return sunoFetch(next, toFile, cb, redirectsLeft - 1, maxBytes);
    }
    if (sc !== 200) { resp.resume(); return cb(new Error('http ' + sc)); }
    if (toFile) {
      let bytes = 0, aborted = false;
      const ws = fs.createWriteStream(toFile);
      resp.on('data', (d) => {
        bytes += d.length;
        if (bytes > maxBytes && !aborted) { aborted = true; resp.destroy(); ws.destroy(); cb(new Error('excede tamaño máximo')); }
      });
      resp.pipe(ws);
      ws.on('finish', () => { if (!aborted) cb(null, { bytes }); });
      ws.on('error', (e) => { if (!aborted) { aborted = true; cb(e); } });
    } else {
      let buf = '', aborted = false;
      const finalUrl = u.toString();
      resp.setEncoding('utf8');
      resp.on('data', (d) => {
        buf += d;
        if (buf.length > maxBytes && !aborted) { aborted = true; resp.destroy(); cb(null, { body: buf, finalUrl }); }
      });
      resp.on('end', () => { if (!aborted) cb(null, { body: buf, finalUrl }); });
    }
  });
  req.on('error', (e) => cb(e));
  req.setTimeout(30000, () => { req.destroy(new Error('timeout')); });
}

function sunoMeta(html, prop) {
  // <meta property="og:audio" content="..."> en cualquier orden de atributos
  const re = new RegExp('<meta[^>]+(?:property|name)=["\\\']' + prop.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '["\\\'][^>]*>', 'i');
  const tag = html.match(re);
  if (!tag) return null;
  const c = tag[0].match(/content=["\']([^"\']+)["\']/i);
  return c ? c[1] : null;
}

const SUNO_UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

// Lee un campo URL del JSON embebido en la página (payload RSC de Next.js), tolerando
// las comillas escapadas (\"). Devuelve null si el campo está vacío o ausente —p.ej.
// video_url viene "" en canciones sin vídeo.
function sunoJsonUrl(html, field) {
  const re = new RegExp(field + '\\\\?"\\s*:\\s*\\\\?"(https?:[^"\\\\]+)', 'i');
  const m = String(html || '').match(re);
  return m && m[1] ? m[1] : null;
}

// Resuelve un share/song link de Suno a { mediaUrl, title, ext, mime } según formato.
// El share corto /s/<code> redirige a /song/<uuid>?sh=...; el HTML ya NO trae og:audio
// (sólo referencia el silencio sil-100.mp3, por eso yt-dlp falla), pero sí lleva un JSON
// embebido con audio_url/video_url reales. Leemos esos campos; para vídeo usamos el mp4
// si existe y si no caemos al audio para no fallar nunca. Fallback final por UUID si el
// JSON no se pudiera parsear.
function sunoResolveMedia(pageUrl, fmt, cb) {
  const fromInput = (pageUrl.match(SUNO_UUID_RE) || [])[0];
  sunoFetch(pageUrl, null, (err, r) => {
    if (err) return cb(err);
    const html = (r && r.body) || '';
    const finalUrl = (r && r.finalUrl) || pageUrl;
    const uuid = (finalUrl.match(SUNO_UUID_RE) || [])[0] || fromInput || (html.match(SUNO_UUID_RE) || [])[0];
    const audioUrl = sunoJsonUrl(html, 'audio_url') || (uuid ? `https://cdn1.suno.ai/${uuid}.mp3` : null);
    const videoUrl = sunoJsonUrl(html, 'video_url'); // null en canciones sin vídeo
    const mediaUrl = (fmt === 'video') ? (videoUrl || audioUrl) : audioUrl;
    if (!mediaUrl) return cb(new Error('no se encontró media en la página de Suno'));
    const isMp4 = /\.mp4(\?|$)/i.test(mediaUrl);
    const ext = isMp4 ? '.mp4' : '.mp3';
    const mime = isMp4 ? 'video/mp4' : 'audio/mpeg';
    const title = sunoMeta(html, 'og:title') || '';
    if (fmt === 'video' && !videoUrl) console.log('[suno] sin video_url; sirvo audio para', finalUrl);
    cb(null, { mediaUrl, title, ext, mime });
  });
}

// Handler completo del caso Suno para /tube/download: resuelve, descarga y hace stream
// con las mismas cabeceras X-Tube-* que la rama yt-dlp.
function sunoTubeDownload(res, url, host, fmt) {
  sunoResolveMedia(url, fmt, (err, media) => {
    if (err) { sendJson(res, 502, { ok: false, error: 'Suno: ' + err.message }); return; }
    const id = crypto.randomBytes(8).toString('hex');
    const outFile = path.join(os.tmpdir(), `admira-tube-${id}${media.ext}`);
    sunoFetch(media.mediaUrl, outFile, (dErr) => {
      if (dErr) { fs.unlink(outFile, () => {}); sendJson(res, 502, { ok: false, error: 'Suno descarga: ' + dErr.message }); return; }
      let st;
      try { st = fs.statSync(outFile); } catch (e) { fs.unlink(outFile, () => {}); sendJson(res, 500, { ok: false, error: 'stat failed' }); return; }
      const title = media.title || 'suno';
      res.writeHead(200, {
        'Content-Type': media.mime,
        'Content-Length': String(st.size),
        'Content-Disposition': `inline; filename="${title.replace(/[^\w\-. ]+/g, '_').slice(0, 120)}${media.ext}"`,
        'X-Tube-Title': encodeURIComponent(title),
        'X-Tube-Source-Url': encodeURIComponent(url),
        'X-Tube-Format': media.ext === '.mp4' ? 'video' : 'audio',
        'X-Tube-Host': host,
        'Access-Control-Expose-Headers': 'X-Tube-Title, X-Tube-Source-Url, X-Tube-Format, X-Tube-Host',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'no-store',
      });
      const rs = fs.createReadStream(outFile);
      rs.pipe(res);
      const finish = () => fs.unlink(outFile, () => {});
      rs.on('end', finish);
      rs.on('error', finish);
      res.on('close', finish);
    });
  });
}

function tubeCleanupFiles(id, extra) {
  const paths = [
    path.join(os.tmpdir(), `admira-tube-${id}.path`),
    path.join(os.tmpdir(), `admira-tube-${id}.title`),
  ];
  if (extra) paths.push(extra);
  for (const p of paths) { try { fs.unlink(p, () => {}); } catch (e) {} }
}

function tubeDisposeJob(id) {
  const job = TUBE_JOBS.get(id);
  if (!job) return;
  if (job.timer) clearTimeout(job.timer);
  if (job.expiry) clearTimeout(job.expiry);
  tubeCleanupFiles(id, job.file);
  TUBE_JOBS.delete(id);
}

function tubePartialSize(id) {
  let total = 0;
  try {
    const files = fs.readdirSync(os.tmpdir())
      .filter(f => f.startsWith(`admira-tube-${id}.`) && !/\.(path|title)$/.test(f));
    for (const f of files) { try { total += fs.statSync(path.join(os.tmpdir(), f)).size; } catch (e) {} }
  } catch (e) {}
  return total;
}

// Versión por job del caso Suno (ver sunoTubeDownload). Resuelve + descarga directo del
// CDN en vez de yt-dlp, y rellena el job igual que la rama yt-dlp para que /tube/status,
// /tube/get y /tube/import-to-stock funcionen sin cambios.
function tubeStartSunoJob(job, url, fmt) {
  sunoResolveMedia(url, fmt, (err, media) => {
    if (err) {
      job.status = 'error'; job.error = 'Suno: ' + err.message;
      job.expiry = setTimeout(() => tubeDisposeJob(job.id), 60 * 1000);
      return;
    }
    const outFile = path.join(os.tmpdir(), `admira-tube-${job.id}${media.ext}`);
    job.timedOut = false;
    job.timer = setTimeout(() => { job.timedOut = true; }, 180000);
    sunoFetch(media.mediaUrl, outFile, (dErr) => {
      clearTimeout(job.timer); job.timer = null;
      if (dErr || job.timedOut) {
        job.status = 'error'; job.error = 'Suno descarga: ' + (job.timedOut ? 'timeout' : dErr.message);
        try { fs.unlinkSync(outFile); } catch (e) {}
        job.expiry = setTimeout(() => tubeDisposeJob(job.id), 60 * 1000);
        return;
      }
      let size = 0; try { size = fs.statSync(outFile).size; } catch (e) {}
      job.status = 'done'; job.file = outFile; job.size = size; job.title = media.title || 'suno';
      job.expiry = setTimeout(() => tubeDisposeJob(job.id), 10 * 60 * 1000);
    });
  });
}

function tubeStartJob(url, fmt) {
  const id = crypto.randomBytes(8).toString('hex');
  const job = { id, fmt, status: 'running', file: '', size: 0, title: '', error: null, code: null, createdAt: Date.now(), timedOut: false, timer: null, expiry: null };
  TUBE_JOBS.set(id, job);

  let jobHost = '';
  try { jobHost = new URL(url).hostname.toLowerCase(); } catch (e) {}
  if (jobHost === 'suno.com' || jobHost.endsWith('.suno.com')) { tubeStartSunoJob(job, url, fmt); return id; }

  const outTpl = path.join(os.tmpdir(), `admira-tube-${id}.%(ext)s`);
  const baseArgs = [
    '--no-playlist', '--max-filesize', '300M', '--no-mtime', '--no-warnings', '--quiet',
    '--print-to-file', 'after_move:filepath', path.join(os.tmpdir(), `admira-tube-${id}.path`),
    '--print-to-file', 'before_dl:%(title)s', path.join(os.tmpdir(), `admira-tube-${id}.title`),
    '-o', outTpl,
  ];
  const formatArgs = (fmt === 'audio')
    ? ['-f', 'bestaudio/best', '-x', '--audio-format', 'mp3', '--audio-quality', '0']
    : ['-f', 'bv*[height<=720][ext=mp4]+ba[ext=m4a]/b[height<=720][ext=mp4]/b[ext=mp4]/b[height<=720]/b', '--remux-video', 'mp4'];
  const args = [...formatArgs, ...baseArgs, url];

  const yt = spawn(YT_DLP_BIN, args, { stdio: ['ignore', 'pipe', 'pipe'] });
  let stderrBuf = '';
  yt.stderr.on('data', (d) => { stderrBuf += d.toString(); if (stderrBuf.length > 16384) stderrBuf = stderrBuf.slice(-16384); });
  yt.stdout.on('data', () => {});
  job.timer = setTimeout(() => { job.timedOut = true; try { yt.kill('SIGTERM'); } catch (e) {} }, 180000);

  yt.on('close', (code) => {
    clearTimeout(job.timer); job.timer = null; job.code = code;
    if (code !== 0) {
      job.status = 'error';
      job.error = job.timedOut ? 'yt-dlp timeout' : `yt-dlp failed (code ${code})`;
      job.stderr = stderrBuf.slice(-800);
      tubeCleanupFiles(id);
    } else {
      let outFile = '';
      try { outFile = fs.readFileSync(path.join(os.tmpdir(), `admira-tube-${id}.path`), 'utf8').trim().split('\n').pop() || ''; } catch (e) {}
      let title = '';
      try { title = fs.readFileSync(path.join(os.tmpdir(), `admira-tube-${id}.title`), 'utf8').trim().split('\n').pop() || ''; } catch (e) {}
      if (!outFile || !fs.existsSync(outFile)) {
        const allowExt = (fmt === 'audio') ? /\.(mp3|m4a|opus|webm|aac|wav|ogg)$/i : /\.(mp4|webm|mkv|mov)$/i;
        try {
          const files = fs.readdirSync(os.tmpdir()).filter(f => f.startsWith(`admira-tube-${id}.`) && allowExt.test(f));
          if (files.length) outFile = path.join(os.tmpdir(), files[0]);
        } catch (e) {}
      }
      if (!outFile || !fs.existsSync(outFile)) {
        job.status = 'error'; job.error = 'yt-dlp produced no file'; job.stderr = stderrBuf.slice(-400);
      } else {
        let size = 0; try { size = fs.statSync(outFile).size; } catch (e) {}
        job.status = 'done'; job.file = outFile; job.size = size; job.title = title;
      }
    }
    // Si nadie recoge el fichero en 10 min, se descarta (y se borra del disco).
    job.expiry = setTimeout(() => tubeDisposeJob(id), 10 * 60 * 1000);
  });

  yt.on('error', (err) => {
    clearTimeout(job.timer); job.timer = null;
    job.status = 'error'; job.error = `yt-dlp spawn failed: ${err.message}`;
    job.expiry = setTimeout(() => tubeDisposeJob(id), 60 * 1000);
  });

  return id;
}

// ─── Import vía Telegram: descarga un job y lo publica en el Stock de admira.studio ──
// Lo usa el webhook del worker (POST /tube/import-to-stock). El worker ya notifica al
// chat cuando /stock/publish recibe el asset, así que aquí solo descargamos y subimos.
const STOCK_PUBLISH_URL = process.env.STOCK_PUBLISH_URL || 'https://pixer-eleven.csilvasantin.workers.dev/stock/publish';
function tubeYtThumb(u) {
  const m = String(u).match(/(?:youtube\.com\/.*[?&]v=|youtu\.be\/|youtube\.com\/embed\/|youtube\.com\/shorts\/)([A-Za-z0-9_-]{11})/);
  return m ? `https://img.youtube.com/vi/${m[1]}/hqdefault.jpg` : null;
}
async function tubePublishToStockWhenReady(jobId, url, fmt, comment) {
  const MAX_MS = 8 * 60 * 1000;
  const t0 = Date.now();
  try {
    while (true) {
      await new Promise(r => setTimeout(r, 1500));
      const job = TUBE_JOBS.get(jobId);
      if (!job) throw new Error('job desaparecido');
      if (job.status === 'done') break;
      if (job.status === 'error') throw new Error(job.error || 'descarga fallida');
      if (Date.now() - t0 > MAX_MS) throw new Error('timeout descarga (>8min)');
    }
    const job = TUBE_JOBS.get(jobId);
    if (!job || !job.file || !fs.existsSync(job.file)) throw new Error('fichero no disponible');
    const buf = fs.readFileSync(job.file);
    let importHost = '';
    try { importHost = new URL(url).hostname.toLowerCase(); } catch (e) {}
    const isSunoImport = importHost === 'suno.com' || importHost.endsWith('.suno.com');
    const payload = {
      type: fmt === 'audio' ? 'audio' : 'video',
      motor: isSunoImport ? 'suno' : 'yt-dlp',
      prompt: url,
      title: job.title || null,
      comment: comment || null,
      costEst: `gratis · ${(buf.length / 1024 / 1024).toFixed(2)}MB · Telegram`,
      thumbnail: tubeYtThumb(url),
      mime: fmt === 'audio' ? 'audio/mpeg' : 'video/mp4',
      base64: buf.toString('base64'),
    };
    const r = await fetch(STOCK_PUBLISH_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    const txt = await r.text().catch(() => '');
    console.log(`[import-to-stock] ${jobId} → publish ${r.status} ${txt.slice(0, 160)}`);
    // El worker espera state:'published' para dar la importación por buena. Si el job se
    // borra aquí mismo, su sondeo (cada 3 s) recibe 404 y canta "quedó sin estado final en
    // el proxy" AUNQUE el vídeo se haya publicado bien: falsa alarma + Enlace basura en el
    // Stock en CADA importación correcta. Se marca el estado final y se limpia con retardo.
    const jok = TUBE_JOBS.get(jobId);
    if (jok) {
      if (r.ok) jok.status = 'published';
      else { jok.status = 'error'; jok.error = `publish ${r.status}: ${txt.slice(0, 160)}`; }
    }
    setTimeout(() => { try { tubeDisposeJob(jobId); } catch (_) {} }, 90000);
    return;
  } catch (e) {
    const msg = (e && e.message) || String(e);
    console.error(`[import-to-stock] ${jobId} ERROR: ${msg}`);
    // NO borrar el job aquí. El worker pregunta por /tube/status cada 3 s y, si el job ya
    // no existe, solo puede decir "quedó sin estado final en el proxy": el error REAL
    // (p.ej. "yt-dlp failed (code 1)" por un post sin vídeo) se perdía en este log y nunca
    // llegaba a Telegram. Se marca como error y se limpia con retardo, dándole tiempo a
    // leerlo — el worker ya sabe reportar state:'error' con su mensaje.
    const j = TUBE_JOBS.get(jobId);
    if (j) { j.status = 'error'; j.error = msg.slice(0, 300); }
    setTimeout(() => { try { tubeDisposeJob(jobId); } catch (_) {} }, 90000);
    return;
  }
}

const server = http.createServer((req, res) => {
  const requestUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const requestPath = requestUrl.pathname;

  if (requestPath === '/health') {
    sendJson(res, 200, {
      ok: true,
      port: CONFIG.port,
      elgatoConfigured: Boolean(CONFIG.elgatoIp),
      hueConfigured: Boolean(CONFIG.hueBridgeIp && CONFIG.hueApiKey),
      hueBridgeIp: CONFIG.hueBridgeIp || '',
      hueMode: CONFIG.hueMode,
      huePrimaryLightKey: CONFIG.huePrimaryLightKey || '',
      hueLightsCount: Object.keys(CONFIG.hueLights || {}).length,
      telegramConfigured: Boolean(CONFIG.telegramBotToken),
      telegramCommandsQueued: TELEGRAM.commands.length,
      grokConfigured: Boolean(CONFIG.grokApiKey),
      grokModel: CONFIG.grokModel,
    });
    return;
  }

  if (requestPath === '/xtanco-runtime-config.js') {
    res.writeHead(200, {
      'Content-Type': 'application/javascript; charset=utf-8',
      'Cache-Control': 'no-cache, no-store, must-revalidate',
    });
    res.end(runtimeConfigScript());
    return;
  }

  if (requestPath.startsWith('/sd/')) {
    setCors(res);
    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    if (requestPath === '/sd/manifest' && req.method === 'GET') {
      try {
        sendJson(res, 200, { ok: true, manifest: readStreamDeckManifest() });
      } catch (error) {
        sendJson(res, 500, { ok: false, error: 'manifest unavailable', message: error.message });
      }
      return;
    }

    if (requestPath === '/sd/press' && req.method === 'POST') {
      collectJsonBody(req, (error, body = {}) => {
        if (error) {
          sendJson(res, 400, { ok: false, error: 'Invalid JSON', message: error.message });
          return;
        }
        let manifest;
        try {
          manifest = readStreamDeckManifest();
        } catch (manifestError) {
          sendJson(res, 500, { ok: false, error: 'manifest unavailable', message: manifestError.message });
          return;
        }
        const pageId = typeof body.pageId === 'string' && body.pageId.trim()
          ? body.pageId.trim()
          : manifest.pages && manifest.pages[0] && manifest.pages[0].id;
        const buttonRef = body.buttonId != null ? body.buttonId : body.btnIdx;
        const found = findStreamDeckButton(manifest, pageId, buttonRef);
        if (!found.page || !found.button) {
          sendJson(res, 404, { ok: false, error: 'button not found', pageId, buttonRef });
          return;
        }
        const requestId = typeof body.requestId === 'string' && body.requestId.trim()
          ? body.requestId.trim()
          : crypto.randomUUID();
        const item = {
          requestId,
          pageId: found.page.id,
          btnIdx: found.index,
          buttonId: found.button.id,
          cmd: found.button.cmd,
          queuedAt: new Date().toISOString(),
        };
        SD_QUEUE.push(item);
        while (SD_QUEUE.length > SD_MAX_QUEUE) SD_QUEUE.shift();
        sendJson(res, 202, { ok: true, queued: item, queueLength: SD_QUEUE.length });
      });
      return;
    }

    if (requestPath === '/sd/pending' && req.method === 'GET') {
      const item = SD_QUEUE.shift() || null;
      sendJson(res, 200, { ok: true, item, queueLength: SD_QUEUE.length });
      return;
    }

    if (requestPath === '/sd/result' && req.method === 'POST') {
      collectJsonBody(req, (error, body = {}) => {
        if (error) {
          sendJson(res, 400, { ok: false, error: 'Invalid JSON', message: error.message });
          return;
        }
        if (!body || typeof body.requestId !== 'string' || !body.requestId.trim()) {
          sendJson(res, 400, { ok: false, error: 'Missing requestId' });
          return;
        }
        recordStreamDeckResult(body);
        sendJson(res, 200, { ok: true });
      });
      return;
    }

    if (requestPath === '/sd/result' && req.method === 'GET') {
      const requestId = requestUrl.searchParams.get('requestId') || '';
      if (!requestId) {
        sendJson(res, 400, { ok: false, error: 'Missing requestId' });
        return;
      }
      const result = SD_RESULTS.get(requestId) || null;
      sendJson(res, result ? 200 : 404, { ok: Boolean(result), result });
      return;
    }

    sendJson(res, 404, { ok: false, error: 'Unknown Stream Deck endpoint' });
    return;
  }

  if (requestPath === '/tube/health' && req.method === 'GET') {
    setCors(res);
    execFile(YT_DLP_BIN, ['--version'], { timeout: 5000 }, (err, stdout) => {
      if (err) {
        sendJson(res, 200, { ok: false, available: false, bin: YT_DLP_BIN, error: err.code || err.message });
        return;
      }
      sendJson(res, 200, { ok: true, available: true, bin: YT_DLP_BIN, version: String(stdout).trim() });
    });
    return;
  }
  if (requestPath === '/tube/health' && req.method === 'OPTIONS') { setCors(res); res.writeHead(204); res.end(); return; }

  // ─── /layout/save ─ persiste un layout en disco (repo) ──────────
  // Body: { path: 'layouts/<nombre>.{json,xml}', payload?: {...}, content?: '<xml…>' }
  //   - JSON: body.payload (objeto) o body.content (string) — se serializa con JSON.stringify si es payload.
  //   - XML:  body.content (string) — se escribe tal cual.
  // Restricción: path debe empezar por 'layouts/' y terminar en '.json' o '.xml'.
  if (requestPath === '/layout/save' && req.method === 'OPTIONS') { setCors(res); res.writeHead(204); res.end(); return; }
  if (requestPath === '/layout/save' && req.method === 'POST') {
    setCors(res);
    collectJsonBody(req, (err, body) => {
      if (err || !body || typeof body.path !== 'string') {
        sendJson(res, 400, { ok: false, message: 'Body invalido: { path, payload | content } requeridos' });
        return;
      }
      const rel = body.path.replace(/^\/+/, '');
      const m = rel.match(/^layouts\/[a-z0-9_.-]+\.(json|xml)$/i);
      if (!m) {
        sendJson(res, 400, { ok: false, message: 'Path debe ser layouts/<nombre>.{json,xml}' });
        return;
      }
      const ext = m[1].toLowerCase();
      let toWrite;
      if (ext === 'json') {
        if (body.payload && typeof body.payload === 'object') {
          toWrite = JSON.stringify(body.payload, null, 2) + '\n';
        } else if (typeof body.content === 'string') {
          toWrite = body.content;
        } else {
          sendJson(res, 400, { ok: false, message: 'JSON: necesita body.payload (objeto) o body.content (string)' });
          return;
        }
      } else {
        // xml
        if (typeof body.content !== 'string' || !body.content.trim()) {
          sendJson(res, 400, { ok: false, message: 'XML: necesita body.content (string)' });
          return;
        }
        toWrite = body.content;
      }
      const target = path.join(__dirname, rel);
      const dir = path.dirname(target);
      try {
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(target, toWrite, 'utf8');
        const bytes = fs.statSync(target).size;
        // Auto git commit + push para que el layout viaje a GitHub Pages
        // y cualquier dispositivo lo cargue al recargar (1-2 min).
        const autoPush = body.autoPush !== false; // default true
        if (autoPush) {
          const { spawn } = require('child_process');
          const repo = __dirname;
          const msg = 'layout: actualizar ' + rel + ' (auto desde gemelo digital)';
          const cmd = `cd "${repo}" && git add "${rel}" && git diff --cached --quiet "${rel}" && echo nochange || (git commit -m "${msg.replace(/"/g, '\\"')}" && git push)`;
          const proc = spawn('/bin/sh', ['-c', cmd], { stdio: ['ignore', 'pipe', 'pipe'] });
          let out = '', err = '';
          proc.stdout.on('data', d => out += d);
          proc.stderr.on('data', d => err += d);
          proc.on('close', code => {
            const pushed = code === 0 && /main ->|->\smain/.test(out + err);
            const noChange = /nochange/.test(out);
            sendJson(res, 200, {
              ok: true, path: rel, bytes,
              git: { exitCode: code, pushed, noChange, log: (out + err).trim().split('\n').slice(-4).join('\n') },
            });
          });
        } else {
          sendJson(res, 200, { ok: true, path: rel, bytes, git: { skipped: true } });
        }
      } catch (e) {
        sendJson(res, 500, { ok: false, message: 'Error escribiendo: ' + (e.message || String(e)) });
      }
    });
    return;
  }

  if (requestPath === '/tube/download' && req.method === 'OPTIONS') { setCors(res); res.writeHead(204); res.end(); return; }
  if (requestPath === '/tube/download' && req.method === 'POST') {
    setCors(res);
    collectJsonBody(req, (err, body) => {
      if (err || !body || typeof body.url !== 'string' || !body.url.trim()) {
        sendJson(res, 400, { ok: false, error: 'Missing url' });
        return;
      }
      const url = body.url.trim();
      const fmt = (body.format === 'audio') ? 'audio' : 'video';
      // Whitelist por host. Evita SSRF a servicios internos.
      let host;
      try { host = new URL(url).hostname.toLowerCase(); }
      catch (e) { sendJson(res, 400, { ok: false, error: 'Invalid URL' }); return; }
      const isYouTube  = host === 'youtu.be' || host === 'm.youtube.com' || host.endsWith('youtube.com') || host.endsWith('youtube-nocookie.com');
      const isVimeo    = host === 'vimeo.com' || host.endsWith('.vimeo.com') || host === 'player.vimeo.com';
      const isTwitter  = host === 'twitter.com' || host === 'x.com' || host === 'mobile.twitter.com' || host === 't.co';
      const isTikTok   = host === 'tiktok.com' || host.endsWith('.tiktok.com') || host === 'vm.tiktok.com';
      const isInstagram= host === 'instagram.com' || host.endsWith('.instagram.com');
      const isLinkedIn = host === 'linkedin.com' || host.endsWith('.linkedin.com') || host === 'lnkd.in';
      const isSuno     = host === 'suno.com' || host.endsWith('.suno.com');
      if (!(isYouTube || isVimeo || isTwitter || isTikTok || isInstagram || isLinkedIn || isSuno)) {
        sendJson(res, 400, { ok: false, error: 'Host not allowed', host, allowed: ['youtube','vimeo','twitter/x','tiktok','instagram','linkedin','suno'] });
        return;
      }
      if (isSuno) { sunoTubeDownload(res, url, host, fmt); return; }
      const id = crypto.randomBytes(8).toString('hex');
      const outTpl = path.join(os.tmpdir(), `admira-tube-${id}.%(ext)s`);
      // Args base comunes
      const baseArgs = [
        '--no-playlist',
        '--max-filesize', '300M',
        '--no-mtime',
        '--no-warnings',
        '--quiet',
        '--print-to-file', 'after_move:filepath', path.join(os.tmpdir(), `admira-tube-${id}.path`),
        '--print-to-file', 'before_dl:%(title)s', path.join(os.tmpdir(), `admira-tube-${id}.title`),
        '-o', outTpl,
      ];
      // Selector de formato: video mp4 720p preferente con fallback robusto para hosts que no tienen mp4 directo.
      // Audio: bestaudio extraido a mp3 (requiere ffmpeg en PATH).
      const formatArgs = (fmt === 'audio')
        ? ['-f', 'bestaudio/best', '-x', '--audio-format', 'mp3', '--audio-quality', '0']
        : ['-f', 'bv*[height<=720][ext=mp4]+ba[ext=m4a]/b[height<=720][ext=mp4]/b[ext=mp4]/b[height<=720]/b', '--remux-video', 'mp4'];
      const args = [...formatArgs, ...baseArgs, url];
      const yt = spawn(YT_DLP_BIN, args, { stdio: ['ignore', 'pipe', 'pipe'] });
      let stderrBuf = '';
      yt.stderr.on('data', (d) => { stderrBuf += d.toString(); if (stderrBuf.length > 16384) stderrBuf = stderrBuf.slice(-16384); });
      yt.stdout.on('data', () => {}); // drain
      const cleanup = (extraPath) => {
        const paths = [
          path.join(os.tmpdir(), `admira-tube-${id}.path`),
          path.join(os.tmpdir(), `admira-tube-${id}.title`),
        ];
        if (extraPath) paths.push(extraPath);
        for (const p of paths) fs.unlink(p, () => {});
      };
      let timedOut = false;
      const killer = setTimeout(() => { timedOut = true; try { yt.kill('SIGTERM'); } catch (e) {} }, 180000);
      yt.on('close', (code) => {
        clearTimeout(killer);
        if (code !== 0) {
          cleanup();
          sendJson(res, 500, { ok: false, error: timedOut ? 'yt-dlp timeout' : 'yt-dlp failed', code, stderr: stderrBuf.slice(-800) });
          return;
        }
        let outFile = '';
        try { outFile = fs.readFileSync(path.join(os.tmpdir(), `admira-tube-${id}.path`), 'utf8').trim().split('\n').pop() || ''; } catch (e) {}
        let title = '';
        try { title = fs.readFileSync(path.join(os.tmpdir(), `admira-tube-${id}.title`), 'utf8').trim().split('\n').pop() || ''; } catch (e) {}
        if (!outFile || !fs.existsSync(outFile)) {
          // Fallback: scan tmpdir for the matching prefix
          const allowExt = (fmt === 'audio') ? /\.(mp3|m4a|opus|webm|aac|wav|ogg)$/i : /\.(mp4|webm|mkv|mov)$/i;
          try {
            const files = fs.readdirSync(os.tmpdir()).filter(f => f.startsWith(`admira-tube-${id}.`) && allowExt.test(f));
            if (files.length) outFile = path.join(os.tmpdir(), files[0]);
          } catch (e) {}
        }
        if (!outFile || !fs.existsSync(outFile)) {
          cleanup();
          sendJson(res, 500, { ok: false, error: 'yt-dlp produced no file', stderr: stderrBuf.slice(-400) });
          return;
        }
        let st;
        try { st = fs.statSync(outFile); } catch (e) { cleanup(outFile); sendJson(res, 500, { ok: false, error: 'stat failed' }); return; }
        const ext = path.extname(outFile).toLowerCase();
        const mimeByExt = {
          '.mp4': 'video/mp4', '.webm': 'video/webm', '.mkv': 'video/x-matroska', '.mov': 'video/quicktime',
          '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.opus': 'audio/ogg', '.aac': 'audio/aac', '.wav': 'audio/wav', '.ogg': 'audio/ogg',
        };
        const mime = mimeByExt[ext] || (fmt === 'audio' ? 'audio/mpeg' : 'video/mp4');
        res.writeHead(200, {
          'Content-Type': mime,
          'Content-Length': String(st.size),
          'Content-Disposition': `inline; filename="${(title || host || 'tube').replace(/[^\w\-. ]+/g, '_').slice(0, 120)}${ext}"`,
          'X-Tube-Title': encodeURIComponent(title || ''),
          'X-Tube-Source-Url': encodeURIComponent(url),
          'X-Tube-Format': fmt,
          'X-Tube-Host': host,
          'Access-Control-Expose-Headers': 'X-Tube-Title, X-Tube-Source-Url, X-Tube-Format, X-Tube-Host',
          'Access-Control-Allow-Origin': '*',
          'Cache-Control': 'no-store',
        });
        const rs = fs.createReadStream(outFile);
        rs.pipe(res);
        const finish = () => cleanup(outFile);
        rs.on('end', finish);
        rs.on('error', finish);
        res.on('close', finish);
      });
      yt.on('error', (err) => {
        clearTimeout(killer);
        cleanup();
        sendJson(res, 500, { ok: false, error: 'yt-dlp spawn failed', message: err.message });
      });
    });
    return;
  }

  // ─── /tube/start ─ lanza la descarga y responde al instante (no bloquea) ─
  if (requestPath === '/tube/start' && req.method === 'OPTIONS') { setCors(res); res.writeHead(204); res.end(); return; }
  if (requestPath === '/tube/start' && req.method === 'POST') {
    setCors(res);
    collectJsonBody(req, (err, body) => {
      if (err || !body || typeof body.url !== 'string' || !body.url.trim()) { sendJson(res, 400, { ok: false, error: 'Missing url' }); return; }
      const url = body.url.trim();
      const fmt = (body.format === 'audio') ? 'audio' : 'video';
      let host;
      try { host = new URL(url).hostname.toLowerCase(); } catch (e) { sendJson(res, 400, { ok: false, error: 'Invalid URL' }); return; }
      if (!tubeHostAllowed(host)) { sendJson(res, 400, { ok: false, error: 'Host not allowed', host, allowed: ['youtube','vimeo','twitter/x','tiktok','instagram','linkedin','suno'] }); return; }
      const jobId = tubeStartJob(url, fmt);
      sendJson(res, 202, { ok: true, jobId, state: 'running' });
    });
    return;
  }

  // ─── /tube/status?id= ─ estado/progreso del job (petición corta) ─────────
  if (requestPath === '/tube/status' && req.method === 'OPTIONS') { setCors(res); res.writeHead(204); res.end(); return; }
  if (requestPath === '/tube/status' && req.method === 'GET') {
    setCors(res);
    const id = requestUrl.searchParams.get('id') || '';
    const job = TUBE_JOBS.get(id);
    if (!job) { sendJson(res, 404, { ok: false, state: 'notfound' }); return; }
    const size = job.status === 'running' ? tubePartialSize(id) : job.size;
    sendJson(res, 200, { ok: job.status !== 'error', state: job.status, size: size || 0, title: job.title || '', error: job.error || null });
    return;
  }

  // ─── /tube/get?id= ─ entrega el fichero ya listo y descarta el job ───────
  if (requestPath === '/tube/get' && req.method === 'OPTIONS') { setCors(res); res.writeHead(204); res.end(); return; }
  if (requestPath === '/tube/get' && req.method === 'GET') {
    setCors(res);
    const id = requestUrl.searchParams.get('id') || '';
    const job = TUBE_JOBS.get(id);
    if (!job) { sendJson(res, 404, { ok: false, error: 'job not found' }); return; }
    if (job.status === 'running') { sendJson(res, 425, { ok: false, error: 'still running' }); return; }
    if (job.status !== 'done' || !job.file || !fs.existsSync(job.file)) { sendJson(res, 500, { ok: false, error: job.error || 'no file', stderr: job.stderr }); return; }
    if (job.expiry) { clearTimeout(job.expiry); job.expiry = null; }
    const ext = path.extname(job.file).toLowerCase();
    const mimeByExt = {
      '.mp4': 'video/mp4', '.webm': 'video/webm', '.mkv': 'video/x-matroska', '.mov': 'video/quicktime',
      '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.opus': 'audio/ogg', '.aac': 'audio/aac', '.wav': 'audio/wav', '.ogg': 'audio/ogg',
    };
    const mime = mimeByExt[ext] || (job.fmt === 'audio' ? 'audio/mpeg' : 'video/mp4');
    let size = job.size;
    try { size = fs.statSync(job.file).size; } catch (e) {}
    res.writeHead(200, {
      'Content-Type': mime,
      'Content-Length': String(size),
      'Content-Disposition': `inline; filename="${(job.title || 'tube').replace(/[^\w\-. ]+/g, '_').slice(0, 120)}${ext}"`,
      'X-Tube-Title': encodeURIComponent(job.title || ''),
      'X-Tube-Format': job.fmt,
      'Access-Control-Expose-Headers': 'X-Tube-Title, X-Tube-Format',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'no-store',
    });
    const rs = fs.createReadStream(job.file);
    rs.pipe(res);
    rs.on('end', () => tubeDisposeJob(id));
    rs.on('error', () => { job.expiry = setTimeout(() => tubeDisposeJob(id), 60 * 1000); });
    return;
  }

  // ─── /tube/import-to-stock ─ descarga + publica en Stock (bot de Telegram) ──
  if (requestPath === '/tube/import-to-stock' && req.method === 'OPTIONS') { setCors(res); res.writeHead(204); res.end(); return; }
  if (requestPath === '/tube/import-to-stock' && req.method === 'POST') {
    setCors(res);
    collectJsonBody(req, (err, body) => {
      if (err || !body || typeof body.url !== 'string' || !body.url.trim()) { sendJson(res, 400, { ok: false, error: 'Missing url' }); return; }
      const url = body.url.trim();
      const fmt = (body.format === 'audio') ? 'audio' : 'video';
      const comment = (typeof body.comment === 'string' && body.comment.trim()) ? body.comment.trim().slice(0, 500) : null;
      let host;
      try { host = new URL(url).hostname.toLowerCase(); } catch (e) { sendJson(res, 400, { ok: false, error: 'Invalid URL' }); return; }
      if (!tubeHostAllowed(host)) { sendJson(res, 400, { ok: false, error: 'Host not allowed', host }); return; }
      const jobId = tubeStartJob(url, fmt);
      sendJson(res, 202, { ok: true, jobId, state: 'running' }); // responde ya; descarga+publica en segundo plano
      tubePublishToStockWhenReady(jobId, url, fmt, comment);
    });
    return;
  }

  if (requestPath === '/hue/discover' && req.method === 'GET') {
    setCors(res);
    discoverHueBridges()
      .then(bridges => {
        sendJson(res, 200, {
          ok: true,
          bridgeIP: CONFIG.hueBridgeIp || '',
          bridges,
        });
      })
      .catch(error => {
        sendJson(res, 500, { ok: false, error: 'Hue discovery failed', message: error.message });
      });
    return;
  }

  if (requestPath === '/hue/status' && req.method === 'GET') {
    setCors(res);
    if (!CONFIG.hueBridgeIp) {
      sendJson(res, 200, {
        ok: true,
        configured: false,
        bridgeIP: '',
        mode: CONFIG.hueMode,
        primaryLightKey: CONFIG.huePrimaryLightKey || '',
        apiKeyPresent: Boolean(CONFIG.hueApiKey),
        lightsConfigured: CONFIG.hueLights,
      });
      return;
    }
    const hasKey = Boolean(CONFIG.hueApiKey);
    const request = hasKey
      ? hueApiRequest('/lights')
      : hueBridgeRequest({ bridgeIp: CONFIG.hueBridgeIp, requestPath: '/api/config', method: 'GET' });
    request
      .then(result => {
        const lightsPayload = hasKey && result && result.body && typeof result.body === 'object' ? result.body : null;
        const normalized = lightsPayload ? buildHueLightsMap(lightsPayload) : { lightsMap: CONFIG.hueLights, lightsList: [] };
        sendJson(res, 200, {
          ok: true,
          configured: hasKey,
          bridgeIP: CONFIG.hueBridgeIp,
          mode: CONFIG.hueMode,
          primaryLightKey: CONFIG.huePrimaryLightKey || '',
          apiKeyPresent: hasKey,
          lightsConfigured: CONFIG.hueLights,
          lightsDetected: normalized.lightsList,
          lightsSuggested: normalized.lightsMap,
        });
      })
      .catch(error => {
        sendJson(res, 502, {
          ok: false,
          error: 'Hue bridge unreachable',
          message: error.message,
          bridgeIP: CONFIG.hueBridgeIp,
          mode: CONFIG.hueMode,
          primaryLightKey: CONFIG.huePrimaryLightKey || '',
          apiKeyPresent: hasKey,
          lightsConfigured: CONFIG.hueLights,
        });
      });
    return;
  }

  if (requestPath === '/hue/link' && req.method === 'POST') {
    setCors(res);
    collectJsonBody(req, async (error, payload = {}) => {
      if (error) {
        sendJson(res, 400, { ok: false, error: 'Invalid JSON', message: error.message });
        return;
      }

      const requestedBridgeIp = typeof payload.bridgeIP === 'string' && payload.bridgeIP.trim()
        ? payload.bridgeIP.trim()
        : CONFIG.hueBridgeIp;
      const deviceType = typeof payload.deviceType === 'string' && payload.deviceType.trim()
        ? payload.deviceType.trim()
        : 'admira_xp#xpaceos';

      if (!requestedBridgeIp) {
        sendJson(res, 400, { ok: false, error: 'Hue bridge missing', message: 'Bridge IP is required before pairing.' });
        return;
      }

      try {
        const created = await hueBridgeRequest({
          bridgeIp: requestedBridgeIp,
          requestPath: '/api',
          method: 'POST',
          body: { devicetype: deviceType },
        });
        const body = created.body;
        if (!Array.isArray(body) || !body[0]) {
          sendJson(res, 502, { ok: false, error: 'Hue pairing failed', message: 'Unexpected bridge response.' });
          return;
        }
        if (body[0].error) {
          sendJson(res, body[0].error.type === 101 ? 409 : 400, {
            ok: false,
            error: 'Hue pairing failed',
            message: body[0].error.description || 'Unknown bridge error',
            bridgeIP: requestedBridgeIp,
          });
          return;
        }
        const apiKey = body[0].success && body[0].success.username;
        if (!apiKey) {
          sendJson(res, 502, { ok: false, error: 'Hue pairing failed', message: 'Bridge did not return an API key.' });
          return;
        }

        const lightsResult = await hueBridgeRequest({
          bridgeIp: requestedBridgeIp,
          requestPath: `/api/${apiKey}/lights`,
          method: 'GET',
        });
        const normalized = buildHueLightsMap(lightsResult.body);
        persistConfigPatch({
          hue: {
            bridgeIP: requestedBridgeIp,
            apiKey,
            mode: CONFIG.hueMode,
            enabled: true,
            lights: normalized.lightsMap,
          },
        });
        sendJson(res, 200, {
          ok: true,
          message: 'Hue bridge linked',
          bridgeIP: requestedBridgeIp,
          mode: CONFIG.hueMode,
          apiKey,
          lightsMap: normalized.lightsMap,
          lights: normalized.lightsList,
        });
      } catch (requestError) {
        sendJson(res, 502, { ok: false, error: 'Hue pairing failed', message: requestError.message, bridgeIP: requestedBridgeIp });
      }
    });
    return;
  }

  if (requestPath === '/hue/sync-lights' && req.method === 'POST') {
    setCors(res);
    if (!CONFIG.hueBridgeIp || !CONFIG.hueApiKey) {
      sendJson(res, 503, {
        ok: false,
        error: 'Hue not configured',
        message: 'Set or pair the Hue bridge first.',
      });
      return;
    }
    hueApiRequest('/lights')
      .then(result => {
        const normalized = buildHueLightsMap(result.body);
        persistConfigPatch({
          hue: {
            bridgeIP: CONFIG.hueBridgeIp,
            apiKey: CONFIG.hueApiKey,
            mode: CONFIG.hueMode,
            enabled: CONFIG.hueEnabled,
            lights: normalized.lightsMap,
          },
        });
        sendJson(res, 200, {
          ok: true,
          message: `Hue lights synced (${normalized.lightsList.length})`,
          bridgeIP: CONFIG.hueBridgeIp,
          mode: CONFIG.hueMode,
          apiKey: CONFIG.hueApiKey,
          lightsMap: normalized.lightsMap,
          lights: normalized.lightsList,
        });
      })
      .catch(error => {
        sendJson(res, 502, { ok: false, error: 'Hue sync failed', message: error.message });
      });
    return;
  }

  if (requestPath === '/power/off' && req.method === 'POST') {
    setCors(res);
    collectJsonBody(req, async (_error, payload = {}) => {
      const result = {
        ok: true,
        reason: typeof payload.reason === 'string' ? payload.reason : 'shutdown',
        elgato: { attempted: Boolean(CONFIG.elgatoIp), ok: !CONFIG.elgatoIp },
        hue: { attempted: Boolean(CONFIG.hueBridgeIp && CONFIG.hueApiKey), ok: !(CONFIG.hueBridgeIp && CONFIG.hueApiKey) },
      };

      if (CONFIG.elgatoIp) {
        try {
          await elgatoRequest('/elgato/lights', 'PUT', { numberOfLights: 1, lights: [{ on: 0 }] }, 2000);
          result.elgato.ok = true;
        } catch (error) {
          result.ok = false;
          result.elgato.ok = false;
          result.elgato.message = error.message;
        }
      }

      if (CONFIG.hueBridgeIp && CONFIG.hueApiKey) {
        const hueIds = Array.from(new Set(Object.values(CONFIG.hueLights || {}).map(Number).filter(Number.isFinite)));
        try {
          if (hueIds.length) {
            await Promise.allSettled(hueIds.map(lightId => hueApiRequest(`/lights/${lightId}/state`, 'PUT', { on: false })));
          } else {
            await hueApiRequest('/groups/0/action', 'PUT', { on: false });
          }
          result.hue.ok = true;
          result.hue.count = hueIds.length;
        } catch (error) {
          result.ok = false;
          result.hue.ok = false;
          result.hue.message = error.message;
        }
      }

      sendJson(res, result.ok ? 200 : 502, result);
    });
    return;
  }

  if (requestPath.startsWith('/grok/')) {
    setCors(res);
    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    if (requestPath === '/grok/status' && req.method === 'GET') {
      sendJson(res, 200, {
        ok: true,
        configured: isGrokConfigured() || isGrokProxyConfigured(),
        localConfigured: isGrokConfigured(),
        proxyConfigured: isGrokProxyConfigured(),
        proxyUrl: CONFIG.grokProxyUrl,
        model: CONFIG.grokModel,
        baseUrl: CONFIG.grokBaseUrl,
      });
      return;
    }

    if (requestPath === '/grok/ask' && req.method === 'POST') {
      collectJsonBody(req, async (error, body = {}) => {
        if (error) {
          sendJson(res, 400, { error: 'Invalid JSON', message: error.message });
          return;
        }
        const prompt = typeof body.prompt === 'string' ? body.prompt.trim() : '';
        const context = typeof body.context === 'string' ? body.context.trim() : '';
        if (!prompt) {
          sendJson(res, 400, { error: 'Missing prompt' });
          return;
        }
        try {
          // Prefer free Gemini if available; fall back to local xAI; then to the
          // remote worker proxy. The frontend always calls /grok/ask, but the
          // underlying provider is whichever is configured here.
          if (isGeminiConfigured()) {
            const answer = await geminiChat(prompt, context);
            sendJson(res, 200, { ok: true, source: 'local-gemini', ...answer });
            return;
          }
          if (isGrokConfigured()) {
            const answer = await grokChat(prompt, context);
            sendJson(res, 200, { ok: true, source: 'local-xai', ...answer });
            return;
          }
          if (isGrokProxyConfigured()) {
            const answer = await grokWorkerAsk(body);
            sendJson(res, 200, { source: 'worker-proxy', ...answer });
            return;
          }
          sendJson(res, 503, {
            error: 'LLM not configured',
            message: 'Set GEMINI_API_KEY (free) or XAI_API_KEY in xtanco.config.local.json, or configure grok.proxyUrl',
          });
        } catch (grokError) {
          sendJson(res, 502, { error: 'LLM request failed', message: grokError.message });
        }
      });
      return;
    }

    sendJson(res, 404, { error: 'Unknown Grok endpoint' });
    return;
  }

  if (requestPath.startsWith('/telegram/')) {
    setCors(res);
    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    if (requestPath === '/telegram/status' && req.method === 'GET') {
      sendJson(res, 200, {
        ok: true,
        configured: isTelegramConfigured(),
        polling: CONFIG.telegramPolling,
        pollingBlocked: TELEGRAM.pollingBlocked,
        bot: TELEGRAM.bot ? {
          id: TELEGRAM.bot.id,
          username: TELEGRAM.bot.username,
          firstName: TELEGRAM.bot.first_name,
        } : null,
        defaultChatId: CONFIG.telegramChatId || '',
        allowedChatIds: CONFIG.telegramAllowedChatIds,
        queued: TELEGRAM.commands.length,
        lastCommandId: TELEGRAM.nextCommandId - 1,
        lastQueuedCommand: TELEGRAM.lastQueuedCommand,
        lastSentMessageId: TELEGRAM.lastSentMessageId,
        lastReplyMessageId: TELEGRAM.lastReplyMessageId,
        lastOutboundChatId: TELEGRAM.lastOutboundChatId,
        lastActivityAt: TELEGRAM.lastActivityAt,
        lastError: TELEGRAM.lastError,
        webhook: TELEGRAM.webhookInfo,
      });
      return;
    }

    if (!isTelegramConfigured()) {
      sendJson(res, 503, {
        error: 'Telegram not configured',
        message: 'Set XTANCO_TELEGRAM_BOT_TOKEN or telegram.botToken in xtanco.config.local.json',
      });
      return;
    }

    if (requestPath === '/telegram/send' && req.method === 'POST') {
      collectJsonBody(req, async (error, body = {}) => {
        if (error) {
          sendJson(res, 400, { error: 'Invalid JSON', message: error.message });
          return;
        }
        const chatId = body.chatId || CONFIG.telegramChatId;
        const text = typeof body.text === 'string' ? body.text.trim() : '';
        if (!chatId) {
          sendJson(res, 400, { error: 'Missing chatId', message: 'Set XTANCO_TELEGRAM_CHAT_ID or pass chatId' });
          return;
        }
        if (!isAllowedTelegramChat(chatId)) {
          sendJson(res, 403, { error: 'Chat not allowed' });
          return;
        }
        if (!text) {
          sendJson(res, 400, { error: 'Missing text' });
          return;
        }
        try {
          const result = await telegramApi('sendMessage', {
            chat_id: chatId,
            text,
            parse_mode: body.parseMode || undefined,
            disable_web_page_preview: true,
          });
          TELEGRAM.lastSentMessageId = Number(result.message_id || 0);
          TELEGRAM.lastOutboundChatId = String(result.chat.id);
          TELEGRAM.lastActivityAt = new Date().toISOString();
          sendJson(res, 200, { ok: true, messageId: result.message_id, chatId: String(result.chat.id) });
        } catch (sendError) {
          TELEGRAM.lastError = sendError.message;
          sendJson(res, 502, { error: 'Telegram send failed', message: sendError.message });
        }
      });
      return;
    }

    if (requestPath === '/telegram/commands' && req.method === 'GET') {
      const since = Number(requestUrl.searchParams.get('since') || 0);
      const limit = Math.min(50, Math.max(1, Number(requestUrl.searchParams.get('limit') || 10)));
      const commands = TELEGRAM.commands.filter(cmd => cmd.id > since).slice(0, limit);
      sendJson(res, 200, {
        ok: true,
        commands,
        lastCommandId: TELEGRAM.nextCommandId - 1,
      });
      return;
    }

    if (requestPath === '/telegram/reply' && req.method === 'POST') {
      collectJsonBody(req, async (error, body = {}) => {
        if (error) {
          sendJson(res, 400, { error: 'Invalid JSON', message: error.message });
          return;
        }
        const chatId = body.chatId || CONFIG.telegramChatId;
        const text = typeof body.text === 'string' ? body.text.trim() : '';
        if (!chatId || !text) {
          sendJson(res, 400, { error: 'Missing chatId or text' });
          return;
        }
        if (!isAllowedTelegramChat(chatId)) {
          sendJson(res, 403, { error: 'Chat not allowed' });
          return;
        }
        try {
          const result = await telegramApi('sendMessage', {
            chat_id: chatId,
            text,
            reply_to_message_id: body.replyToMessageId || undefined,
            disable_web_page_preview: true,
          });
          TELEGRAM.lastReplyMessageId = Number(result.message_id || 0);
          TELEGRAM.lastOutboundChatId = String(result.chat.id);
          TELEGRAM.lastActivityAt = new Date().toISOString();
          sendJson(res, 200, { ok: true, messageId: result.message_id, chatId: String(result.chat.id) });
        } catch (sendError) {
          TELEGRAM.lastError = sendError.message;
          sendJson(res, 502, { error: 'Telegram reply failed', message: sendError.message });
        }
      });
      return;
    }

    sendJson(res, 404, { error: 'Unknown Telegram endpoint' });
    return;
  }

  if (requestPath.startsWith('/elgato/')) {
    setCors(res);
    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }
    if (!CONFIG.elgatoIp) {
      sendJson(res, 503, {
        error: 'Elgato not configured',
        message: 'Set XTANCO_ELGATO_IP or xtanco.config.local.json',
      });
      return;
    }

    collectRequestBody(req, cleanBody => {
      const options = {
        hostname: CONFIG.elgatoIp,
        port: CONFIG.elgatoPort,
        path: requestPath + requestUrl.search,
        method: req.method,
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(cleanBody || ''),
        },
        timeout: 3000,
      };
      let responded = false;
      const sendProxyJson = (statusCode, payload) => {
        if (responded || res.writableEnded) return;
        responded = true;
        sendJson(res, statusCode, payload);
      };

      const proxyReq = http.request(options, proxyRes => {
        let body = '';
        proxyRes.on('data', chunk => body += chunk);
        proxyRes.on('end', () => {
          if (responded || res.writableEnded) return;
          responded = true;
          res.writeHead(proxyRes.statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(body);
          const action = req.method === 'PUT' ? 'LIGHT TOGGLE' : 'LIGHT STATUS';
          console.log(`[${new Date().toLocaleTimeString()}] ${action} -> ${body.trim()}`);
        });
      });

      proxyReq.on('error', error => {
        console.error(`[ERROR] Cannot reach light: ${error.message}`);
        sendProxyJson(502, { error: 'Light unreachable', message: error.message });
      });

      proxyReq.on('timeout', () => {
        proxyReq.destroy();
        sendProxyJson(504, { error: 'Timeout' });
      });

      if (cleanBody && (req.method === 'PUT' || req.method === 'POST')) {
        proxyReq.write(cleanBody);
      }
      proxyReq.end();
    });
    return;
  }

  if (requestPath.startsWith('/hue/')) {
    setCors(res);
    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }
    if (!CONFIG.hueBridgeIp || !CONFIG.hueApiKey) {
      sendJson(res, 503, {
        error: 'Hue not configured',
        message: 'Set XTANCO_HUE_BRIDGE_IP and XTANCO_HUE_API_KEY or xtanco.config.local.json',
      });
      return;
    }

    collectRequestBody(req, cleanBody => {
      const huePath = '/api/' + CONFIG.hueApiKey + requestPath.slice(4) + requestUrl.search;
      const options = {
        hostname: CONFIG.hueBridgeIp,
        port: 80,
        path: huePath,
        method: req.method,
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(cleanBody || ''),
        },
        timeout: 3000,
      };
      let responded = false;
      const sendProxyJson = (statusCode, payload) => {
        if (responded || res.writableEnded) return;
        responded = true;
        sendJson(res, statusCode, payload);
      };

      const proxyReq = http.request(options, proxyRes => {
        let body = '';
        proxyRes.on('data', chunk => body += chunk);
        proxyRes.on('end', () => {
          if (responded || res.writableEnded) return;
          responded = true;
          res.writeHead(proxyRes.statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(body);
          const isError = body.includes('"error"');
          console.log(`[${new Date().toLocaleTimeString()}] HUE ${req.method} ${huePath} ${isError ? 'FAIL' : 'OK'} ${cleanBody ? '<- ' + cleanBody.substring(0, 50) : ''} -> ${body.substring(0, 100)}`);
        });
      });

      proxyReq.on('error', error => {
        console.error(`[ERROR] Cannot reach Hue bridge: ${error.message}`);
        sendProxyJson(502, { error: 'Hue bridge unreachable', message: error.message });
      });

      proxyReq.on('timeout', () => {
        proxyReq.destroy();
        sendProxyJson(504, { error: 'Hue timeout' });
      });

      if (cleanBody && (req.method === 'PUT' || req.method === 'POST')) {
        proxyReq.write(cleanBody);
      }
      proxyReq.end();
    });
    return;
  }

  const filePath = safeFilePath(requestPath === '/' ? '/index.html' : requestPath);
  if (!filePath) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  const ext = path.extname(filePath).toLowerCase();
  const contentType = MIME[ext] || 'application/octet-stream';
  fs.readFile(filePath, (error, data) => {
    if (error) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    res.writeHead(200, {
      'Content-Type': contentType,
      'Cache-Control': cacheControlFor(ext),
    });
    res.end(data);
  });
});

server.listen(CONFIG.port, () => {
  console.log('');
  console.log('===================================================');
  console.log('  XTANCO GAME + ELGATO + HUE PROXY');
  console.log('===================================================');
  console.log(`  Game:    http://localhost:${CONFIG.port}`);
  console.log(`  Config:  ${fs.existsSync(LOCAL_CONFIG_PATH) ? path.basename(LOCAL_CONFIG_PATH) : 'env/defaults only'}`);
  console.log(`  Health:  http://localhost:${CONFIG.port}/health`);
  console.log(`  Runtime: http://localhost:${CONFIG.port}/xtanco-runtime-config.js`);
  console.log(`  Elgato:  ${CONFIG.elgatoIp ? `http://${CONFIG.elgatoIp}:${CONFIG.elgatoPort}` : 'not configured'}`);
  console.log(`  Hue:     ${CONFIG.hueBridgeIp ? `http://${CONFIG.hueBridgeIp} (${maskSecret(CONFIG.hueApiKey)})` : 'not configured'}`);
  console.log(`  Telegram:${CONFIG.telegramBotToken ? ` configured (${CONFIG.telegramChatId || 'no default chat'})` : ' not configured'}`);
  console.log(`  Grok:    ${grokConfigLabel()}`);
  console.log('');
  console.log('  Copy xtanco.config.example.json to xtanco.config.local.json');
  console.log('  if you want local Elgato/Hue/Telegram/Grok control without exposing keys.');
  console.log('===================================================');
  console.log('');
  initTelegram();
});

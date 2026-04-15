const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');

const GAME_DIR = __dirname;
const LOCAL_CONFIG_PATH = path.join(GAME_DIR, 'xtanco.config.local.json');

const DEFAULT_CONFIG = {
  port: 9124,
  elgato: {
    ip: '',
    port: 9123,
  },
  hue: {
    bridgeIP: '',
    apiKey: '',
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
    systemPrompt: 'Eres AdmiraXPBot dentro del juego Admira XP. Responde en español, de forma útil y breve. Si recibes estado del juego, úsalo como contexto.',
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
  grokSystemPrompt: resolveString('XTANCO_GROK_SYSTEM_PROMPT', FILE_CONFIG.grok && FILE_CONFIG.grok.systemPrompt, DEFAULT_CONFIG.grok.systemPrompt),
  gameDir: GAME_DIR,
};

if (CONFIG.telegramChatId && !CONFIG.telegramAllowedChatIds.includes(CONFIG.telegramChatId)) {
  CONFIG.telegramAllowedChatIds.push(CONFIG.telegramChatId);
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
      enabled: Boolean(CONFIG.grokApiKey),
      proxyUrl: CONFIG.grokProxyUrl,
      model: CONFIG.grokModel,
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
  const relativePath = normalized.replace(/^([/\\])+/, '') || 'index.html';
  const filePath = path.join(GAME_DIR, relativePath);
  if (!filePath.startsWith(GAME_DIR)) return null;
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

function grokApiPath(endpoint) {
  const base = new URL(CONFIG.grokBaseUrl || DEFAULT_CONFIG.grok.baseUrl);
  const cleanEndpoint = String(endpoint || '').replace(/^\/+/, '');
  const basePath = base.pathname.replace(/\/+$/, '');
  base.pathname = `${basePath}/${cleanEndpoint}`.replace(/\/{2,}/g, '/');
  return base;
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

const server = http.createServer((req, res) => {
  const requestUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const requestPath = requestUrl.pathname;

  if (requestPath === '/health') {
    sendJson(res, 200, {
      ok: true,
      port: CONFIG.port,
      elgatoConfigured: Boolean(CONFIG.elgatoIp),
      hueConfigured: Boolean(CONFIG.hueBridgeIp && CONFIG.hueApiKey),
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
        configured: isGrokConfigured(),
        model: CONFIG.grokModel,
        baseUrl: CONFIG.grokBaseUrl,
      });
      return;
    }

    if (!isGrokConfigured()) {
      sendJson(res, 503, {
        error: 'Grok not configured',
        message: 'Set XAI_API_KEY or grok.apiKey in xtanco.config.local.json',
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
          const answer = await grokChat(prompt, context);
          sendJson(res, 200, { ok: true, ...answer });
        } catch (grokError) {
          sendJson(res, 502, { error: 'Grok request failed', message: grokError.message });
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

      const proxyReq = http.request(options, proxyRes => {
        let body = '';
        proxyRes.on('data', chunk => body += chunk);
        proxyRes.on('end', () => {
          res.writeHead(proxyRes.statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(body);
          const action = req.method === 'PUT' ? 'LIGHT TOGGLE' : 'LIGHT STATUS';
          console.log(`[${new Date().toLocaleTimeString()}] ${action} -> ${body.trim()}`);
        });
      });

      proxyReq.on('error', error => {
        console.error(`[ERROR] Cannot reach light: ${error.message}`);
        sendJson(res, 502, { error: 'Light unreachable', message: error.message });
      });

      proxyReq.on('timeout', () => {
        proxyReq.destroy();
        sendJson(res, 504, { error: 'Timeout' });
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

      const proxyReq = http.request(options, proxyRes => {
        let body = '';
        proxyRes.on('data', chunk => body += chunk);
        proxyRes.on('end', () => {
          res.writeHead(proxyRes.statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(body);
          const isError = body.includes('"error"');
          console.log(`[${new Date().toLocaleTimeString()}] HUE ${req.method} ${huePath} ${isError ? 'FAIL' : 'OK'} ${cleanBody ? '<- ' + cleanBody.substring(0, 50) : ''} -> ${body.substring(0, 100)}`);
        });
      });

      proxyReq.on('error', error => {
        console.error(`[ERROR] Cannot reach Hue bridge: ${error.message}`);
        sendJson(res, 502, { error: 'Hue bridge unreachable', message: error.message });
      });

      proxyReq.on('timeout', () => {
        proxyReq.destroy();
        sendJson(res, 504, { error: 'Hue timeout' });
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
  console.log(`  Grok:    ${CONFIG.grokApiKey ? `configured (${CONFIG.grokModel})` : 'not configured'}`);
  console.log('');
  console.log('  Copy xtanco.config.example.json to xtanco.config.local.json');
  console.log('  if you want local Elgato/Hue/Telegram/Grok control without exposing keys.');
  console.log('===================================================');
  console.log('');
  initTelegram();
});

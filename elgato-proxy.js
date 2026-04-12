const http = require('http');
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

const FILE_CONFIG = loadFileConfig();
const CONFIG = {
  port: resolveNumber('XTANCO_PORT', FILE_CONFIG.port, DEFAULT_CONFIG.port),
  elgatoIp: resolveString('XTANCO_ELGATO_IP', FILE_CONFIG.elgato && FILE_CONFIG.elgato.ip, DEFAULT_CONFIG.elgato.ip),
  elgatoPort: resolveNumber('XTANCO_ELGATO_PORT', FILE_CONFIG.elgato && FILE_CONFIG.elgato.port, DEFAULT_CONFIG.elgato.port),
  hueBridgeIp: resolveString('XTANCO_HUE_BRIDGE_IP', FILE_CONFIG.hue && FILE_CONFIG.hue.bridgeIP, DEFAULT_CONFIG.hue.bridgeIP),
  hueApiKey: resolveString('XTANCO_HUE_API_KEY', FILE_CONFIG.hue && FILE_CONFIG.hue.apiKey, DEFAULT_CONFIG.hue.apiKey),
  hueLights: normalizeLights(FILE_CONFIG.hue && FILE_CONFIG.hue.lights),
  hueEnabled: resolveBoolean('XTANCO_HUE_ENABLED', FILE_CONFIG.hue && FILE_CONFIG.hue.enabled, DEFAULT_CONFIG.hue.enabled),
  gameDir: GAME_DIR,
};

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

const server = http.createServer((req, res) => {
  const requestUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const requestPath = requestUrl.pathname;

  if (requestPath === '/health') {
    sendJson(res, 200, {
      ok: true,
      port: CONFIG.port,
      elgatoConfigured: Boolean(CONFIG.elgatoIp),
      hueConfigured: Boolean(CONFIG.hueBridgeIp && CONFIG.hueApiKey),
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
  console.log('');
  console.log('  Copy xtanco.config.example.json to xtanco.config.local.json');
  console.log('  if you want local Elgato/Hue control without exposing keys.');
  console.log('===================================================');
  console.log('');
});

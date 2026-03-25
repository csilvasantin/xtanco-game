// ═══════════════════════════════════════════════════════════════
//  ELGATO + HUE LIGHT PROXY + GAME SERVER
//  Run: node elgato-proxy.js
//  Serves game at http://localhost:9124
//  Proxies /elgato/* to Elgato Key Light (192.168.0.109:9123)
//  Proxies /hue/*   to Philips Hue Bridge (192.168.1.37)
//  Everything on same origin = no CORS/mixed-content issues
// ═══════════════════════════════════════════════════════════════

const http = require('http');
const fs = require('fs');
const path = require('path');

const CONFIG = {
  port: 9124,
  elgatoIp: '192.168.0.109',
  elgatoPort: 9123,
  hueBridgeIp: '192.168.1.37',
  hueApiKey: 'fsj2dkVBF0wOtDUvdMnisfdyBZHSqPHULmQ3ehQ0',
  gameDir: __dirname,
};

const MIME = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.md': 'text/markdown',
};

const server = http.createServer((req, res) => {
  // ── ELGATO API PROXY (/elgato/*) ──
  if (req.url.startsWith('/elgato/')) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, PUT, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    // Collect body first, then forward
    let reqBody = '';
    req.on('data', chunk => reqBody += chunk);
    req.on('end', () => {
      // Parse and re-stringify to ensure clean JSON
      let cleanBody = reqBody;
      if (reqBody && (req.method === 'PUT' || req.method === 'POST')) {
        try {
          cleanBody = JSON.stringify(JSON.parse(reqBody));
        } catch (e) {
          cleanBody = reqBody;
        }
      }

      const options = {
        hostname: CONFIG.elgatoIp,
        port: CONFIG.elgatoPort,
        path: req.url,
        method: req.method,
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(cleanBody || ''),
        },
        timeout: 3000,
      };

      const proxyReq = http.request(options, (proxyRes) => {
        let body = '';
        proxyRes.on('data', chunk => body += chunk);
        proxyRes.on('end', () => {
          res.writeHead(proxyRes.statusCode, { 'Content-Type': 'application/json' });
          res.end(body);
          const action = req.method === 'PUT' ? '💡 TOGGLE' : '📊 STATUS';
          console.log(`[${new Date().toLocaleTimeString()}] ${action} → ${body.trim()}`);
        });
      });

      proxyReq.on('error', (err) => {
        console.error(`[ERROR] Cannot reach light: ${err.message}`);
        res.writeHead(502, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Light unreachable', message: err.message }));
      });

      proxyReq.on('timeout', () => {
        proxyReq.destroy();
        res.writeHead(504, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Timeout' }));
      });

      if (cleanBody && (req.method === 'PUT' || req.method === 'POST')) {
        proxyReq.write(cleanBody);
      }
      proxyReq.end();
    });
    return;
  }

  // ── HUE BRIDGE PROXY (/hue/*) ──
  if (req.url.startsWith('/hue/')) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, PUT, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    let reqBody = '';
    req.on('data', chunk => reqBody += chunk);
    req.on('end', () => {
      let cleanBody = reqBody;
      if (reqBody && (req.method === 'PUT' || req.method === 'POST')) {
        try { cleanBody = JSON.stringify(JSON.parse(reqBody)); } catch (e) { cleanBody = reqBody; }
      }

      // Map /hue/lights/9/state → /api/<key>/lights/9/state
      const huePath = '/api/' + CONFIG.hueApiKey + req.url.slice(4);

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

      const proxyReq = http.request(options, (proxyRes) => {
        let body = '';
        proxyRes.on('data', chunk => body += chunk);
        proxyRes.on('end', () => {
          res.writeHead(proxyRes.statusCode, { 'Content-Type': 'application/json' });
          res.end(body);
          console.log(`[${new Date().toLocaleTimeString()}] 🟣 HUE ${req.method} ${req.url} → ${body.substring(0, 80)}`);
        });
      });

      proxyReq.on('error', (err) => {
        console.error(`[ERROR] Cannot reach Hue bridge: ${err.message}`);
        res.writeHead(502, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Hue bridge unreachable', message: err.message }));
      });

      proxyReq.on('timeout', () => {
        proxyReq.destroy();
        res.writeHead(504, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Hue timeout' }));
      });

      if (cleanBody && (req.method === 'PUT' || req.method === 'POST')) {
        proxyReq.write(cleanBody);
      }
      proxyReq.end();
    });
    return;
  }

  // ── STATIC FILE SERVER (game files) ──
  let filePath = path.join(CONFIG.gameDir, req.url === '/' ? 'index.html' : req.url);
  const ext = path.extname(filePath).toLowerCase();
  const contentType = MIME[ext] || 'application/octet-stream';

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    res.writeHead(200, {
      'Content-Type': contentType,
      'Cache-Control': 'no-cache, no-store, must-revalidate',
    });
    res.end(data);
  });
});

server.listen(CONFIG.port, () => {
  console.log('');
  console.log('═══════════════════════════════════════════════════');
  console.log('  🎮 XTANCO GAME + 💡 ELGATO + 🟣 HUE PROXY');
  console.log('═══════════════════════════════════════════════════');
  console.log(`  Game:    http://localhost:${CONFIG.port}`);
  console.log(`  Elgato:  http://${CONFIG.elgatoIp}:${CONFIG.elgatoPort}`);
  console.log(`  Hue:     http://${CONFIG.hueBridgeIp} (API key: ${CONFIG.hueApiKey.slice(0,8)}...)`);
  console.log('');
  console.log('  Open the game URL above in your browser.');
  console.log('  Press L in the game to toggle all lights.');
  console.log('═══════════════════════════════════════════════════');
  console.log('');
});

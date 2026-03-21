// ═══════════════════════════════════════════════════════════════
//  ELGATO KEY LIGHT PROXY + GAME SERVER
//  Run: node elgato-proxy.js
//  Serves game at http://localhost:9124
//  Proxies /elgato/* to 192.168.0.109:9123
//  Everything on same origin = no CORS/mixed-content issues
// ═══════════════════════════════════════════════════════════════

const http = require('http');
const fs = require('fs');
const path = require('path');

const CONFIG = {
  port: 9124,
  elgatoIp: '192.168.0.109',
  elgatoPort: 9123,
  gameDir: __dirname, // serve files from same directory
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
  console.log('  🎮 XTANCO GAME + 💡 ELGATO PROXY');
  console.log('═══════════════════════════════════════════════════');
  console.log(`  Game:   http://localhost:${CONFIG.port}`);
  console.log(`  Light:  http://${CONFIG.elgatoIp}:${CONFIG.elgatoPort}`);
  console.log('');
  console.log('  Open the game URL above in your browser.');
  console.log('  Press L in the game to toggle the light.');
  console.log('═══════════════════════════════════════════════════');
  console.log('');
});

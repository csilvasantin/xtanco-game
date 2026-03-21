// ═══════════════════════════════════════════════════════════════
//  ELGATO KEY LIGHT PROXY — Local CORS proxy for browser access
//  Run: node elgato-proxy.js
//  Proxies requests from localhost:9124 → 192.168.0.109:9123
// ═══════════════════════════════════════════════════════════════

const http = require('http');

const CONFIG = {
  proxyPort: 9124,
  elgatoIp: '192.168.0.109',
  elgatoPort: 9123,
};

const server = http.createServer((req, res) => {
  // CORS headers — allow browser to call this proxy
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, PUT, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  // Handle preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // Forward request to Elgato light
  const options = {
    hostname: CONFIG.elgatoIp,
    port: CONFIG.elgatoPort,
    path: req.url,
    method: req.method,
    headers: { 'Content-Type': 'application/json' },
    timeout: 3000,
  };

  const proxyReq = http.request(options, (proxyRes) => {
    let body = '';
    proxyRes.on('data', chunk => body += chunk);
    proxyRes.on('end', () => {
      res.writeHead(proxyRes.statusCode, { 'Content-Type': 'application/json' });
      res.end(body);
      const action = req.method === 'PUT' ? 'TOGGLE' : 'STATUS';
      console.log(`[${new Date().toLocaleTimeString()}] ${action} → ${body.trim()}`);
    });
  });

  proxyReq.on('error', (err) => {
    console.error(`[ERROR] Cannot reach Elgato light: ${err.message}`);
    res.writeHead(502, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Light unreachable', message: err.message }));
  });

  proxyReq.on('timeout', () => {
    proxyReq.destroy();
    res.writeHead(504, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Timeout' }));
  });

  // Forward body for PUT requests
  if (req.method === 'PUT' || req.method === 'POST') {
    let reqBody = '';
    req.on('data', chunk => reqBody += chunk);
    req.on('end', () => {
      proxyReq.write(reqBody);
      proxyReq.end();
    });
  } else {
    proxyReq.end();
  }
});

server.listen(CONFIG.proxyPort, () => {
  console.log('═══════════════════════════════════════════════');
  console.log('  ELGATO KEY LIGHT PROXY');
  console.log(`  Proxy:  http://localhost:${CONFIG.proxyPort}`);
  console.log(`  Light:  http://${CONFIG.elgatoIp}:${CONFIG.elgatoPort}`);
  console.log('  Press L in the game to toggle the light');
  console.log('═══════════════════════════════════════════════');
});

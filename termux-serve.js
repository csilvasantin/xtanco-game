#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// termux-serve.js — servidor estático mínimo y sin dependencias para servir el
// gemelo AdmiraXperience desde Termux (o cualquier Node) en local.
//
// No requiere `npm install`: usa solo módulos nativos de Node. Sirve los
// archivos de la carpeta donde se ejecuta. Pensado para mover poco y romper
// poco — no es un servidor de producción.
//
// Uso:  node termux-serve.js [puerto]   (por defecto 8080)
// ─────────────────────────────────────────────────────────────────────────────
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = process.cwd();
const PORT = Number(process.argv[2] || process.env.ADMIRA_PORT || 8080);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'text/javascript; charset=utf-8',
  '.mjs':  'text/javascript; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg':  'image/svg+xml',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif':  'image/gif',
  '.webp': 'image/webp',
  '.ico':  'image/x-icon',
  '.mp3':  'audio/mpeg',
  '.mp4':  'video/mp4',
  '.woff': 'font/woff',
  '.woff2':'font/woff2',
  '.ttf':  'font/ttf',
  '.map':  'application/json; charset=utf-8',
};

const server = http.createServer((req, res) => {
  // Descartamos querystring y hash; resolvemos la ruta dentro de ROOT.
  let urlPath = decodeURIComponent((req.url || '/').split('?')[0].split('#')[0]);
  if (urlPath === '/') urlPath = '/index.html';

  const filePath = path.normalize(path.join(ROOT, urlPath));

  // Anti path-traversal: nunca servimos fuera de ROOT.
  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403); res.end('403 Forbidden'); return;
  }

  fs.stat(filePath, (err, stat) => {
    if (err || !stat.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('404 Not Found: ' + urlPath);
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
    });
    fs.createReadStream(filePath).pipe(res);
  });
});

server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') {
    console.error(`✗ El puerto ${PORT} ya está en uso. Prueba: node termux-serve.js ${PORT + 1}`);
  } else {
    console.error('✗ Error del servidor:', e.message);
  }
  process.exit(1);
});

server.listen(PORT, () => {
  console.log(`✓ AdmiraXperience sirviéndose en http://localhost:${PORT}/  (raíz: ${ROOT})`);
  console.log('  Ctrl+C para parar.');
});

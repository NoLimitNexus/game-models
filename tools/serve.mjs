// Tiny static server for the Model Lab. Browsers will not run a page like this from file://
// (modules and model loading are blocked), so "Open Model Lab.cmd" starts this and opens the page.
//   node tools/serve.mjs [port] [--no-open]
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { exec } from 'node:child_process';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const port = Number(process.argv.find((a) => /^\d+$/.test(a))) || 5190;
const noOpen = process.argv.includes('--no-open');

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json', '.css': 'text/css; charset=utf-8', '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp',
  '.txt': 'text/plain; charset=utf-8', '.md': 'text/plain; charset=utf-8',
};

const server = http.createServer((req, res) => {
  let rel = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (rel.endsWith('/')) rel += 'index.html';
  const file = path.join(root, rel);
  if (!file.startsWith(root + path.sep) && file !== root) { res.writeHead(403).end('no'); return; }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404).end('not found'); return; }
    res.writeHead(200, {
      'Content-Type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
    });
    res.end(data);
  });
});

server.on('error', (e) => {
  console.error(e.code === 'EADDRINUSE'
    ? `Port ${port} is already in use. The Model Lab may already be running: open http://localhost:${port}/`
    : e.message);
  process.exit(1);
});

server.listen(port, '127.0.0.1', () => {
  const url = `http://localhost:${port}/`;
  console.log(`Model Lab is running at ${url}`);
  console.log('Close this window to stop it.');
  if (!noOpen) exec(`start "" "${url}"`);
});

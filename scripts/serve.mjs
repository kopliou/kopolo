// Zero-dependency static server for local play: `npm run dev`, then open the printed address.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const port = Number(process.env.PORT) || 5173;
const host = process.env.HOST || '0.0.0.0';
const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
};

// Only the game's own files are served, never the rest of the checkout.
const allowed = (path) => path === 'index.html' || path === 'styles.css' || path === 'favicon.svg' || /^src\/[\w-]+\.js$/.test(path);

createServer(async (req, res) => {
  let path = '';
  try {
    path = decodeURIComponent(new URL(req.url, 'http://localhost').pathname).replace(/^\/+/, '') || 'index.html';
  } catch {
    path = '';
  }
  if ((req.method !== 'GET' && req.method !== 'HEAD') || !allowed(path)) {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('Not found');
    return;
  }
  try {
    const body = await readFile(join(root, path));
    res.writeHead(200, { 'content-type': types[extname(path)], 'cache-control': 'no-cache' });
    res.end(req.method === 'HEAD' ? undefined : body);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('Not found');
  }
}).listen(port, host, () => {
  console.log(`KOPOLO: http://localhost:${port}`);
});

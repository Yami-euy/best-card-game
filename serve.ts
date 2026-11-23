// serve.ts — a tiny static server for local play-testing (Node 22+,
// standard library only). Serves game/ at http://localhost:8080 so the
// game loads exactly as a static host would serve it: no build, no network.
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(fileURLToPath(new URL('.', import.meta.url)), 'game');
const port = Number(process.env.PORT || '8080');

const MIME = {
  '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript',
  '.mjs': 'text/javascript', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.json': 'application/json',
};

const server = createServer((req, res) => {
  const path = decodeURIComponent(new URL(req.url || '/', 'http://localhost').pathname);
  const file = join(root, path === '/' ? 'index.html' : path);
  if (!file.startsWith(root) || !existsSync(file) || !statSync(file).isFile()) {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('not found');
    return;
  }
  res.writeHead(200, { 'Content-Type': MIME[extname(file)] || 'application/octet-stream' });
  createReadStream(file).pipe(res);
});

server.listen(port, () => {
  console.log('STAR OF MERDEKA serves at http://localhost:' + port);
});

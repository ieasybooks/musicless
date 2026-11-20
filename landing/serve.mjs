// Local preview only. Production needs only the files in dist/landing.
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, join, extname } from 'node:path';

const root = fileURLToPath(new URL('../dist/landing/', import.meta.url));
const port = Number(process.env.PORT || 8840);
const types = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.wasm': 'application/wasm',
  '.md': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
  '.xml': 'application/xml',
  '.txt': 'text/plain; charset=utf-8',
};

createServer(async (req, res) => {
  if (!['GET', 'HEAD'].includes(req.method)) return res.writeHead(405, { Allow: 'GET, HEAD' }).end();
  try {
    const url = new URL(req.url, 'http://localhost');
    let file = resolve(root, '.' + decodeURIComponent(url.pathname));
    if (file !== resolve(root) && !file.startsWith(root)) return res.writeHead(403).end();
    // As on the host, /en/privacy serves en/privacy.html.
    if (!extname(file) && !url.pathname.endsWith('/') && await stat(file + '.html').then(info => info.isFile(), () => false)) file += '.html';
    else if ((await stat(file)).isDirectory()) {
      if (!url.pathname.endsWith('/')) {
        return res.writeHead(301, { Location: url.pathname + '/' + url.search }).end();
      }
      file = join(file, 'index.html');
    }
    const body = await readFile(file);
    res.writeHead(200, {
      'Content-Type': types[extname(file)] || 'application/octet-stream',
      'Content-Length': body.length,
      'Cache-Control': 'no-cache',
      'X-Content-Type-Options': 'nosniff',
    });
    res.end(req.method === 'HEAD' ? undefined : body);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Not found');
  }
}).listen(port, '127.0.0.1', () => console.log(`Musicless landing preview: http://127.0.0.1:${port}/`));

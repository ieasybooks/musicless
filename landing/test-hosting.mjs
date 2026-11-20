// Exercise Cloudflare's actual static routing locally; no cloud credentials.
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import { checkSite, release } from './check.mjs';

const directory = fileURLToPath(new URL('.', import.meta.url));
const socket = createServer();
await new Promise(resolve => socket.listen(0, '127.0.0.1', resolve));
const port = socket.address().port;
await new Promise(resolve => socket.close(resolve));
const site = 'http://127.0.0.1:' + port;
const server = spawn('./node_modules/.bin/wrangler', ['dev', '--local', '--ip', '127.0.0.1',
  '--port', String(port), '--inspector-port', '0'], {
  cwd: directory, env: { ...process.env, WRANGLER_SEND_METRICS: 'false' }, stdio: ['ignore', 'pipe', 'pipe'],
});
let logs = '', launchError;
server.stdout.on('data', chunk => { logs += chunk; });
server.stderr.on('data', chunk => { logs += chunk; });
server.on('error', error => { launchError = error; });
const stopped = new Promise(resolve => server.on('close', resolve));
try {
  let ready = false;
  for (let i = 0; i < 120; i++) {
    if (launchError) throw launchError;
    if (server.exitCode !== null) throw new Error('Wrangler exited: ' + logs);
    try {
      const response = await fetch(site + '/release.json', { signal: AbortSignal.timeout(500) });
      await response.arrayBuffer();
      if (response.ok) { ready = true; break; }
    } catch { /* Server is starting. */ }
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  if (!ready) throw new Error('Wrangler did not start: ' + logs);
  await checkSite(site, await release());
} finally {
  server.kill('SIGTERM');
  const force = setTimeout(() => server.kill('SIGKILL'), 5000);
  await stopped;
  clearTimeout(force);
}

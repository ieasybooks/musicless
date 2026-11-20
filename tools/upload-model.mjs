// Run with a scoped Cloudflare API token in CLOUDFLARE_API_TOKEN, never argv.
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { MODEL_SHA256, MODEL_URL } from '../landing/audio/config.js';

if (!process.env.CLOUDFLARE_API_TOKEN) throw new Error('CLOUDFLARE_API_TOKEN is required');
const path = fileURLToPath(new URL('../extension/model/spleeter-2stems.onnx', import.meta.url));
const bytes = await readFile(path);
const sha = value => createHash('sha256').update(value).digest('hex');
if (sha(bytes) !== MODEL_SHA256) throw new Error('Local model does not match the pinned hash');
execFileSync('npx', ['--yes', 'wrangler@4.76.0', 'r2', 'object', 'put',
  'ieasybooks' + new URL(MODEL_URL).pathname, '--remote', '--file', path,
  '--content-type', 'application/octet-stream', '--cache-control', 'public, max-age=31536000, immutable'], {
  stdio: 'inherit',
  env: { ...process.env, WRANGLER_SEND_METRICS: 'false', CLOUDFLARE_ACCOUNT_ID: 'aaed7434338705aa46de5e4e3575e02b' },
});
const response = await fetch(MODEL_URL, { headers: { Origin: 'http://127.0.0.1:8840', 'User-Agent': 'Mozilla/5.0' } });
if (!response.ok) throw new Error(`Published model returned HTTP ${response.status}`);
if (sha(Buffer.from(await response.arrayBuffer())) !== MODEL_SHA256) throw new Error('Published model checksum mismatch');
if (response.headers.get('access-control-allow-origin') !== '*') throw new Error('Published model CORS is missing');
console.log('Verified published model bytes and local-preview CORS:', MODEL_URL);

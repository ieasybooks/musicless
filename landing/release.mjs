// Wrap the normal landing build without changing the extension's build/release.
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const out = join(root, 'dist/landing');
const commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
if (!/^[a-f0-9]{40}$/.test(commit)) throw new Error('Build must have a Git commit');
await import('./build.mjs');
await writeFile(join(out, '404.html'), '<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Page not found — Musicless</title><link rel="stylesheet" href="/assets/site.css"><main class="shell"><h1>Page not found</h1><p><a href="/en/">Musicless</a> · <a href="/ar/" lang="ar" dir="rtl">بلا موسيقى</a></p></main></html>\n');
// Stable asset names must revalidate after a deployment. Cloudflare still
// caches and serves static assets at the edge without running Worker code.
// no-transform prevents the zone's automatic HTML injections from changing
// these pages (including its Web Analytics beacon).
await writeFile(join(out, '_headers'), '/*\n  Cache-Control: public, max-age=0, must-revalidate, no-transform\n  X-Content-Type-Options: nosniff\n  Referrer-Policy: strict-origin-when-cross-origin\n');

const files = [];
async function walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) await walk(path);
    else if (entry.isFile() && entry.name !== '_headers') {
      const bytes = await readFile(path);
      if (bytes.length > 25 * 1024 * 1024) throw new Error('Static asset exceeds 25 MiB: ' + path);
      if (path.endsWith('.onnx')) throw new Error('Models belong in R2, not the website deployment');
      files.push({ path: '/' + path.slice(out.length + 1), bytes: bytes.length,
        sha256: createHash('sha256').update(bytes).digest('hex') });
    } else if (!entry.isFile()) throw new Error('Unexpected build entry: ' + path);
  }
}
await walk(out);
files.sort((a, b) => a.path.localeCompare(b.path));
// The deployment works before and after the separately reviewed audio tool.
let model;
try {
  await readFile(new URL('./audio/config.js', import.meta.url));
  const { MODEL_URL, MODEL_SHA256 } = await import('./audio/config.js');
  model = { url: MODEL_URL, sha256: MODEL_SHA256 };
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}
await writeFile(join(out, 'release.json'), JSON.stringify({ commit, files, ...(model ? { model } : {}) }, null, 2) + '\n');
console.log('Prepared static deployment for ' + commit + ': ' + files.length + ' files.');

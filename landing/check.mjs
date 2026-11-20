import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { extname } from 'node:path';
import { pathToFileURL } from 'node:url';

export const SITE = 'https://musicless.ieasybooks.com';
const releaseURL = new URL('../dist/landing/release.json', import.meta.url);
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const get = (url, options = {}) => fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(30000), ...options });
export async function release() { return JSON.parse(await readFile(releaseURL, 'utf8')); }

export async function checkModel(model) {
  if (!model) return;
  const response = await get(model.url, { headers: { Origin: SITE } });
  assert.equal(response.status, 200, 'R2 model must be available before deployment');
  assert.ok(['*', SITE].includes(response.headers.get('access-control-allow-origin')), 'R2 model CORS');
  assert.match(response.headers.get('cache-control') || '', /immutable/, 'R2 model caching');
  const bytes = Buffer.from(await response.arrayBuffer());
  assert.equal(sha(bytes), model.sha256, 'R2 model integrity');
  console.log('PASS R2 model: integrity, CORS and immutable caching');
}

function mime(path) {
  return ({
    '.html': /text\/html/, '.js': /(?:text|application)\/javascript/,
    '.mjs': /(?:text|application)\/javascript/, '.wasm': /application\/wasm/,
    '.css': /text\/css/, '.json': /application\/json/, '.svg': /image\/svg\+xml/,
    '.png': /image\/png/, '.woff2': /font\/woff2/, '.xml': /(?:text|application)\/xml/,
  })[extname(path)];
}

export async function checkSite(site, expected) {
  const manifest = await get(site + '/release.json');
  assert.equal(manifest.status, 200, 'release.json status');
  assert.deepEqual(await manifest.json(), expected, 'The deployed build must match this checkout');
  assert.match(manifest.headers.get('cache-control') || '', /max-age=0/, 'Release identity must revalidate');

  async function checkFile(file) {
    const path = file.path === '/index.html' ? '/' : file.path.replace(/\/index\.html$/, '/').replace(/\.html$/, '');
    const response = await get(site + path);
    assert.equal(response.status, 200, path + ' status (no redirects)');
    if (mime(file.path)) assert.match(response.headers.get('content-type') || '', mime(file.path), path + ' MIME type');
    assert.match(response.headers.get('cache-control') || '', /max-age=0/, path + ' caching');
    assert.match(response.headers.get('cache-control') || '', /no-transform/, path + ' must preserve the published bytes');
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff', path + ' nosniff');
    const bytes = Buffer.from(await response.arrayBuffer());
    assert.equal(bytes.length, file.bytes, path + ' byte length');
    assert.equal(sha(bytes), file.sha256, path + ' content');
    if (path === '/en/') assert.match(bytes.toString(), /<html lang="en" dir="ltr">/);
    if (path === '/ar/') assert.match(bytes.toString(), /<html lang="ar" dir="rtl">/);
  }
  for (let start = 0; start < expected.files.length; start += 6) {
    await Promise.all(expected.files.slice(start, start + 6).map(checkFile));
  }
  for (const path of ['/missing-page', '/assets/missing.js', '/assets/missing.wasm']) {
    const response = await get(site + path);
    assert.equal(response.status, 404, path + ' must not return an application page');
    assert.doesNotMatch(response.headers.get('cache-control') || '', /immutable/, 'Missing assets must not be cached forever');
  }
  for (const language of ['en', 'ar']) {
    const response = await get(site + '/' + language + '?check=1');
    assert.ok([301, 307, 308].includes(response.status), 'Canonical language redirect');
    const to = new URL(response.headers.get('location'), site);
    assert.equal(to.pathname, '/' + language + '/');
    assert.equal(to.search, '?check=1');
  }
  console.log('PASS ' + site + ': ' + expected.files.length + ' files, exact build, MIME types, caching, language routes and 404s');
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const expected = await release();
  if (args.includes('--model-only')) await checkModel(expected.model);
  else {
    const site = (args.find(arg => /^https?:\/\//.test(arg)) || SITE).replace(/\/$/, '');
    const attempts = args.includes('--retry') ? 12 : 1;
    for (let attempt = 1; ; attempt++) {
      try { await checkSite(site, expected); break; }
      catch (error) {
        if (attempt === attempts) throw error;
        console.log('Waiting for deployment propagation: ' + error.message);
        await new Promise(resolve => setTimeout(resolve, 5000));
      }
    }
  }
}

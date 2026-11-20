// End-to-end tests of the shipped static site, real workers, WASM model and
// downloaded files. Synthetic fixtures only. Requires ./setup.sh --dev + FFmpeg.
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import puppeteer from 'puppeteer-core';
import { chromePath } from '../tools/chrome.mjs';
import { MODEL_URL, CACHE_NAME } from '../landing/audio/config.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const work = join(root, 'tests/.work/landing');
const python = join(root, 'tests/.venv/bin/python');
mkdirSync(work, { recursive: true });
const ffmpeg = args => execFileSync('ffmpeg', ['-v', 'error', '-y', ...args]);
const probe = path => JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', path], { encoding: 'utf8' }));
execFileSync(process.execPath, ['landing/build.mjs'], { cwd: root, stdio: 'inherit' });
execFileSync(python, [join(root, 'tests/synth.py'), join(work, 'voice-and-music.wav'), '30', '--music-db', '0']);
ffmpeg(['-i', join(work, 'voice-and-music.wav'), '-c:a', 'libmp3lame', '-b:a', '192k', join(work, 'voice-and-music.mp3')]);
ffmpeg(['-i', join(work, 'voice-and-music.wav'), '-ar', '48000', '-c:a', 'aac', '-b:a', '192k', join(work, 'voice-and-music.m4a')]);
ffmpeg(['-i', join(work, 'voice-and-music.wav'), '-t', '3', '-ar', '22050', '-ac', '1', '-c:a', 'libmp3lame', join(work, 'mono.mp3')]);
ffmpeg(['-i', join(work, 'voice-and-music.wav'), '-t', '1', '-c:a', 'alac', join(work, 'lossless.m4a')]);
ffmpeg(['-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=mono', '-t', '601', '-c:a', 'libmp3lame', '-b:a', '32k', join(work, 'too-long.mp3')]);
writeFileSync(join(work, 'broken.mp3'), 'Not an MP3');

const port = Number(process.env.LANDING_TEST_PORT || 8841);
const server = spawn(process.execPath, ['landing/serve.mjs'], { cwd: root, env: { ...process.env, PORT: String(port) }, stdio: ['ignore', 'pipe', 'inherit'] });
await new Promise((resolve, reject) => { server.stdout.once('data', resolve); server.once('error', reject); server.once('exit', code => reject(new Error(`Server exit ${code}`))); });
const firefox = process.env.FIREFOX;
const browser = await puppeteer.launch({
  ...(firefox ? {
    browser: 'firefox', executablePath: firefox,
    extraPrefsFirefox: {
      'browser.download.folderList': 2, 'browser.download.dir': work,
      'browser.download.useDownloadDir': true, 'browser.download.alwaysOpenPanel': false,
      'browser.helperApps.neverAsk.saveToDisk': 'audio/mpeg,audio/mp4',
      'media.volume_scale': '0.0',
    },
  } : { executablePath: chromePath() }), headless: true,
  args: ['--mute-audio', ...(process.env.MUSICLESS_NO_SANDBOX === '1' ? ['--no-sandbox'] : [])],
  defaultViewport: { width: 1280, height: 900 } });
const page = await browser.newPage();
const errors = [];
page.on('pageerror', error => errors.push(error.message));
page.on('console', message => { if (message.type() === 'error') console.log('Browser:', message.text()); });
if (!firefox) {
  const client = await page.createCDPSession();
  await client.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: work });
}
console.log('Browser:', await browser.version());

// Test-only instrumentation wraps workers without modifying production code.
// It observes actual fetches and can simulate blocked codecs/network/storage.
await page.evaluateOnNewDocument(() => {
  window.testEvents = [];
  window.testMode = {};
  const NativeWorker = Worker;
  window.Worker = class extends NativeWorker {
    constructor(url, options) {
      const mode = JSON.stringify(window.testMode);
      const script = `
        const mode = ${mode};
        if (mode.bootstrapFail) throw new Error('Test: worker module failed to load');
        if (mode.noDecoder) self.AudioDecoder = undefined;
        if (mode.noEncoder) self.AudioEncoder = undefined;
        if (mode.noCache) Object.defineProperty(self, 'caches', {value: {open: async () => {throw new Error('Storage blocked')}}});
        if (mode.holdDone) {
          const realPost = self.postMessage;
          self.postMessage = (...args) => { if (args[0].type !== 'done') realPost(...args); };
        }
        const realFetch = self.fetch;
        self.fetch = async (...args) => {
          const url = String(args[0]);
          self.postMessage({type: 'test-fetch', url});
          if (url.endsWith('.onnx') && mode.holdModel) return new Promise(() => {});
          if (url.endsWith('.onnx') && mode.failModel) return new Response('Network failure', {status: 503});
          if (url.endsWith('.onnx') && mode.badModel) return new Response('Damaged bytes');
          return realFetch(...args);
        };
        await import(${JSON.stringify(String(url))});`;
      const blob = URL.createObjectURL(new Blob([script], { type: 'text/javascript' }));
      super(blob, options);
      this.addEventListener('message', event => {
        window.testEvents.push(event.data.type === 'done' ? { type: 'done' } : event.data);
        if (event.data.type === 'capability') URL.revokeObjectURL(blob);
      });
    }
  };
});

async function state(expected, timeout = 90000) {
  await page.waitForFunction(expected => expected.includes(document.querySelector('#audio-workspace').dataset.state), { timeout }, expected).catch(async error => {
    console.log('Timed out:', await page.$eval('#audio-workspace', element => element.innerText), (await events()).slice(-8));
    throw error;
  });
  return page.$eval('#audio-workspace', element => ({ state: element.dataset.state, text: element.innerText }));
}
async function choose(name) {
  await page.$eval('#audio-file', element => { element.value = ''; });
  await (await page.$('#audio-file')).uploadFile(join(work, name));
  return state(['ready', 'error', 'unsupported']);
}
async function clearEvents() { await page.evaluate(() => { window.testEvents = []; }); }
async function events() { return page.evaluate(() => window.testEvents); }
async function submit() {
  await page.click('[data-action=run]');
  const result = await state(['done', 'error']);
  assert.equal(result.state, 'done', result.text);
}
async function download(name, codec, channels = 2, duration = 30) {
  const path = join(work, name);
  rmSync(path, { force: true });
  await page.click('a[download]');
  for (let i = 0; i < 200 && !existsSync(path); i++) await new Promise(resolve => setTimeout(resolve, 50));
  assert.ok(existsSync(path), 'Download completed');
  const metadata = probe(path);
  assert.equal(metadata.streams.length, 1);
  assert.equal(metadata.streams[0].codec_name, codec);
  assert.equal(metadata.streams[0].channels, channels);
  assert.equal(metadata.streams[0].sample_rate, '44100');
  if (codec === 'aac') assert.equal(metadata.streams[0].profile, 'LC');
  assert.ok(Math.abs(Number(metadata.format.duration) - duration) < .15, metadata.format.duration);
  console.log(`PASS ${name}: ${codec}, ${channels} channel(s), ${metadata.format.duration}s`);
  return path;
}
async function mode(value) { await page.evaluate(value => { window.testMode = value; }, value); }
async function clearCache() { await page.evaluate(name => caches.delete(name), CACHE_NAME); }

// About, Privacy policy, Terms of use and Contact & support, in both languages.
// Their text must stay word for word the approved text in the fixture, whose
// blocks are "===== Musicless / <page> / <language>", with links as [label](href).
const site = join(root, 'dist/landing');
const origin = 'https://musicless.ieasybooks.com';
const textPages = ['about', 'privacy', 'terms', 'support'];
const dated = { privacy: true, terms: true };
const updated = { en: 'Last updated: November 20, 2026', ar: 'آخر تحديث: 20 نوفمبر 2026' };
const footerLinks = {
  en: [['About', '/en/about'], ['Privacy policy', '/en/privacy'], ['Terms of use', '/en/terms'],
    ['Contact & support', '/en/support'], ['Source code', 'https://github.com/ieasybooks/musicless']],
  ar: [['عن الإضافة', '/ar/about'], ['سياسة الخصوصية', '/ar/privacy'], ['شروط الاستخدام', '/ar/terms'],
    ['التواصل والدعم', '/ar/support'], ['الشيفرة المصدرية', 'https://github.com/ieasybooks/musicless']],
};
const approved = {};
for (const block of readFileSync(join(root, 'tests/fixtures/landing-pages.txt'), 'utf8').split(/^===== Musicless \/ /m).slice(1)) {
  const [header, ...lines] = block.trimEnd().split('\n');
  const [name, language] = header.split(' / ');
  approved[`${language}/${name}`] = lines.join('\n').replace(/\(tab:(\w+)\)/g, `(/${language}/$1)`);
}

async function checkTextPages() {
  const pagePaths = ['en', 'ar'].flatMap(language => textPages.map(name => `${language}/${name}`));
  assert.deepEqual(Object.keys(approved).sort(), [...pagePaths].sort(), 'The fixture has every page in both languages');
  // en/privacy.html answers at /en/privacy. A en/privacy/index.html would redirect to /en/privacy/.
  assert.deepEqual(readdirSync(site, { recursive: true }).filter(path => path.endsWith('.html')).sort(),
    ['index.html', 'en/index.html', 'ar/index.html', ...pagePaths.map(path => path + '.html')].sort());
  assert.deepEqual([...readFileSync(join(site, 'sitemap.xml'), 'utf8').matchAll(/<loc>([^<]+)<\/loc>/g)].map(match => match[1]).sort(),
    ['en/', 'ar/', ...pagePaths].map(path => `${origin}/${path}`).sort());

  const requests = [];
  const record = request => requests.push(request.url());
  page.on('request', record);
  for (const language of ['en', 'ar']) for (const name of textPages) for (const width of [390, 1280]) {
    const path = `${language}/${name}`;
    await page.setViewport({ width, height: 900 });
    const response = await page.goto(`http://127.0.0.1:${port}/${path}`, { waitUntil: 'networkidle0' });
    assert.equal(response.status(), 200, path);
    const facts = await page.evaluate(() => {
      const main = document.querySelector('main');
      const blocks = [...main.children];
      const text = element => [...element.childNodes].map(node => node.nodeName === 'A'
        ? `[${node.textContent}](${node.getAttribute('href')})`
        : node.nodeType === Node.TEXT_NODE ? node.textContent : `<${node.nodeName}>`).join('');
      return {
        lang: document.documentElement.lang, dir: document.documentElement.dir, title: document.title,
        description: document.querySelector('meta[name=description]').content,
        canonical: document.querySelector('link[rel=canonical]').href,
        alternates: [...document.querySelectorAll('link[rel=alternate]')].map(link => [link.hreflang, link.href]),
        tags: blocks.map(element => element.tagName + (element.className ? '.' + element.className : '')),
        text: blocks.filter(element => !element.matches('.updated'))
          .map(element => (element.tagName === 'H2' ? '## ' : '') + text(element)).join('\n'),
        updated: main.querySelector('.updated')?.textContent ?? null,
        visible: blocks.every(element => element.checkVisibility()),
        languages: [...document.querySelectorAll('.language-options a')].map(link => [link.getAttribute('href'), link.hasAttribute('aria-current')]),
        footer: [...document.querySelectorAll('footer nav a')].map(link => [link.textContent, link.getAttribute('href')]),
        current: [...document.querySelectorAll('footer nav a[aria-current=page]')].map(link => link.getAttribute('href')),
        headingFont: getComputedStyle(main.querySelector('h1')).fontFamily,
        fits: document.documentElement.scrollWidth <= innerWidth,
      };
    });
    const [title, lead] = approved[path].split('\n');
    assert.equal(facts.text, approved[path], path + ' must match the approved text');
    assert.equal(facts.lang, language);
    assert.equal(facts.dir, language === 'ar' ? 'rtl' : 'ltr');
    assert.ok(facts.title.startsWith(title), facts.title);
    assert.equal(facts.description, lead.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1'));
    assert.equal(facts.canonical, `${origin}/${path}`);
    assert.deepEqual(facts.alternates, [['en', `${origin}/en/${name}`], ['ar', `${origin}/ar/${name}`]]);
    assert.deepEqual(facts.tags.slice(0, 2), ['H1', 'P.lead']);
    assert.ok(facts.tags.slice(dated[name] ? 3 : 2).every(tag => ['H2', 'P'].includes(tag)), facts.tags.join());
    assert.equal(facts.updated, dated[name] ? updated[language] : null, path + ' last updated');
    if (dated[name]) assert.equal(facts.tags[2], 'P.updated');
    assert.ok(facts.visible, path + ' shows all its text');
    assert.deepEqual(facts.languages, [[`/en/${name}`, language === 'en'], [`/ar/${name}`, language === 'ar']], path + ' language switcher');
    assert.deepEqual(facts.footer, footerLinks[language], path + ' footer');
    assert.deepEqual(facts.current, [`/${path}`]);
    if (language === 'ar') assert.match(facts.headingFont, /^Alexandria/);
    assert.ok(facts.fits, `${path} fits ${width}px without scrolling sideways`);
    await page.screenshot({ path: join(work, `${language}-${name}-${width}.png`), fullPage: true });
  }
  page.off('request', record);
  assert.deepEqual(requests.filter(url => !url.startsWith(`http://127.0.0.1:${port}/`)), [], 'The pages make no third-party requests');

  for (const path of ['', 'en/', 'ar/']) {
    await page.goto(`http://127.0.0.1:${port}/${path}`);
    const { lang, footer, eyebrow } = await page.evaluate(() => ({ lang: document.documentElement.lang,
      footer: [...document.querySelectorAll('footer nav a')].map(link => [link.textContent, link.getAttribute('href')]),
      eyebrow: document.querySelector('.eyebrow').textContent }));
    assert.deepEqual(footer, footerLinks[lang], `/${path} footer`);
    assert.equal(eyebrow, { en: 'Made by EasyBooks↗', ar: 'من الكتب المُيسّرة↗' }[lang]);
  }
  console.log('PASS About, Privacy policy, Terms of use and Contact & support: approved text, both languages, links, sitemap and layout');
}

try {
  await checkTextPages();
  await page.goto(`http://127.0.0.1:${port}/en/#files`);
  await state(['empty']);
  await page.waitForFunction(() => window.testEvents.some(event => event.type === 'capability'));
  assert.ok(!(await events()).some(event => event.type === 'test-fetch'));
  assert.equal((await choose('voice-and-music.mp3')).state, 'ready');
  assert.ok(!(await events()).some(event => event.type === 'test-fetch'), 'Selection does not download processing tools');
  for (const worker of firefox ? [] : page.workers()) {
    assert.ok(!(await worker.evaluate(() => performance.getEntriesByType('resource').map(entry => entry.name)))
      .some(url => /onnx|encoder|engine\//.test(url)), 'No model, runtime or encoder modules before Submit');
  }
  await submit();
  assert.ok((await events()).some(event => event.type === 'test-fetch' && event.url === MODEL_URL), 'First submit fetches R2');
  const mp3 = await download('voice-and-music-musicless.mp3', 'mp3');
  assert.equal(await page.$eval('.audio-play', element => element.getAttribute('aria-label')), 'Play preview', 'No autoplay');
  await page.click('.audio-play');
  await page.waitForFunction(() => document.querySelector('#audio-elapsed').textContent !== '0:00');
  await page.click('[data-action=original]');
  assert.equal(await page.$eval('[data-action=original]', element => element.getAttribute('aria-pressed')), 'true');
  await page.click('[data-action=reset]');
  await clearEvents();
  assert.equal((await choose('voice-and-music.m4a')).state, 'ready');
  await submit();
  assert.ok((await events()).some(event => event.phase === 'cached'));
  assert.ok(!(await events()).some(event => event.type === 'test-fetch' && event.url === MODEL_URL), 'Warm run uses CacheStorage');
  const m4a = await download('voice-and-music-musicless.m4a', 'aac');
  await page.click('[data-action=reset]');

  // Compare the actual lossy browser exports with the trusted model reference,
  // after decoding the input with FFmpeg. This catches seam/timestamp/mux bugs.
  for (const [input, output] of [['voice-and-music.mp3', mp3], ['voice-and-music.m4a', m4a]]) {
    const pcmIn = join(work, input + '.f32');
    const pcmOut = join(work, input + '.out.f32');
    ffmpeg(['-i', join(work, input), '-ar', '44100', '-ac', '2', '-f', 'f32le', pcmIn]);
    ffmpeg(['-i', output, '-ar', '44100', '-ac', '2', '-f', 'f32le', pcmOut]);
    const metrics = execFileSync(python, ['-c', `
import sys, numpy as np
sys.path.insert(0, ${JSON.stringify(join(root, 'tests'))})
import reference
x=np.fromfile(${JSON.stringify(pcmIn)}, '<f4').reshape(-1,2)
y=np.fromfile(${JSON.stringify(pcmOut)}, '<f4').reshape(-1,2)
ref=reference.vocals(x)
n=min(len(ref),len(y)); ref=ref[:n]; y=y[:n]
assert np.isfinite(y).all()
score=10*np.log10(np.sum(ref**2)/(np.sum((ref-y)**2)+1e-20))
print(f'Browser export/reference agreement: {score:.1f} dB')
assert score > 20, score
`], { encoding: 'utf8' });
    console.log('PASS', input, metrics.trim());
  }

  await mode({ noEncoder: true });
  assert.equal((await choose('voice-and-music.m4a')).state, 'ready');
  await submit();
  await download('voice-and-music-musicless.m4a', 'aac');
  console.log('PASS official AAC WASM fallback with native AudioEncoder disabled');
  await page.click('[data-action=reset]');
  await mode({});
  assert.equal((await choose('mono.mp3')).state, 'ready');
  await submit();
  await download('mono-musicless.mp3', 'mp3', 1, 3);
  await page.click('[data-action=reset]');

  if (process.env.LANDING_LONG === '1') {
    ffmpeg(['-stream_loop', '19', '-i', join(work, 'voice-and-music.mp3'), '-t', '600', '-c:a', 'copy', join(work, 'ten-minutes.mp3')]);
    assert.equal((await choose('ten-minutes.mp3')).state, 'ready');
    const started = Date.now();
    await submit();
    await download('ten-minutes-musicless.mp3', 'mp3', 2, 600);
    console.log(`PASS 10-minute file processed in ${((Date.now() - started) / 1000).toFixed(1)}s`);
    await page.click('[data-action=reset]');
  }

  for (const [name, text] of [['lossless.m4a', 'Apple Lossless'], ['broken.mp3', 'couldn’t be read'], ['too-long.mp3', '10 minutes'], ['voice-and-music.wav', 'Choose an MP3']]) {
    await clearEvents();
    const result = await choose(name);
    assert.equal(result.state, 'error', result.text);
    assert.ok(result.text.includes(text), result.text);
    assert.ok(!(await events()).some(event => event.type === 'test-fetch'));
    console.log('PASS rejects', name, 'before model download');
  }

  await clearEvents();
  await page.evaluate(() => {
    const input = document.querySelector('#audio-file');
    const transfer = new DataTransfer();
    transfer.items.add(new File([new Uint8Array(100 * 1024 * 1024 + 1)], 'oversized.mp3'));
    input.files = transfer.files;
    input.dispatchEvent(new Event('change'));
  });
  assert.ok((await state(['error'])).text.includes('smaller than 100 MB'));
  assert.ok(!(await events()).some(event => event.type === 'test-fetch'));
  console.log('PASS size limit before decoding or model download');

  await clearCache();
  await mode({ failModel: true });
  assert.equal((await choose('mono.mp3')).state, 'ready');
  await page.click('[data-action=run]');
  assert.ok((await state(['error'])).text.includes('couldn’t be downloaded'));
  await mode({});
  await page.click('[data-action=retry]');
  assert.equal((await state(['done', 'error'])).state, 'done');
  console.log('PASS network failure and Retry');
  await page.click('[data-action=reset]');
  await clearCache();
  await mode({ badModel: true });
  assert.equal((await choose('mono.mp3')).state, 'ready');
  await page.click('[data-action=run]');
  assert.ok((await state(['error'])).text.includes('incomplete or damaged'));
  console.log('PASS model integrity rejection');

  await mode({ holdModel: true });
  await choose('mono.mp3');
  await page.click('[data-action=run]');
  await page.waitForFunction(() => document.querySelector('.audio-status-heading')?.textContent.includes('Downloading'));
  await mode({});
  await page.click('[data-action=cancel]');
  assert.equal((await state(['ready', 'error'])).state, 'ready');
  console.log('PASS cancellation during model download');
  await submit();
  await page.click('[data-action=reset]');
  await choose('voice-and-music.mp3');
  await page.click('[data-action=run]');
  await page.waitForFunction(() => document.querySelector('.audio-status-heading')?.textContent.includes('Removing music'));
  await page.click('[data-action=cancel]');
  assert.equal((await state(['ready', 'error'])).state, 'ready');
  console.log('PASS cancellation during inference');

  await mode({ holdDone: true });
  await choose('mono.mp3');
  await page.click('[data-action=run]');
  await page.waitForFunction(() => document.querySelector('.audio-status-heading')?.textContent.includes('Saving'));
  await mode({});
  await page.click('[data-action=cancel]');
  assert.equal((await state(['ready', 'error'])).state, 'ready');
  assert.equal(await page.$('a[download]'), null);
  console.log('PASS cancellation while finishing export');

  await clearCache();
  await mode({ noCache: true });
  await choose('mono.mp3');
  await submit();
  console.log('PASS processing when CacheStorage is unavailable');
  await page.click('[data-action=reset]');
  await mode({});
  await page.evaluate(async ({ name, url }) => {
    const cache = await caches.open(name);
    await cache.put(url, new Response('Corrupt cached model'));
  }, { name: CACHE_NAME, url: MODEL_URL });
  await clearEvents();
  await choose('mono.mp3');
  await submit();
  assert.ok((await events()).some(event => event.type === 'test-fetch' && event.url === MODEL_URL));
  console.log('PASS automatic recovery from a corrupt cached model');
  await page.click('[data-action=reset]');

  // Capability gating runs inside the same worker used for real processing.
  await mode({ noDecoder: true });
  await choose('mono.mp3');
  assert.equal((await state(['unsupported'])).state, 'unsupported');
  assert.equal(await page.$eval('[data-action=choose]', element => element.disabled), true);
  console.log('PASS unsupported-browser gating');

  await page.goto(`http://127.0.0.1:${port}/en/?startup-test#youtube`);
  await mode({ bootstrapFail: true });
  await page.click('#files-tab');
  assert.ok((await state(['error'])).text.includes('couldn’t start'));
  await mode({});
  await page.click('[data-action=retry]');
  await state(['empty']);
  assert.equal((await choose('mono.mp3')).state, 'ready');
  console.log('PASS retry after an initial worker-loading failure');

  // Reload for responsive/RTL checks and a genuinely clean empty state.
  for (const language of ['en', 'ar']) for (const width of [390, 1280]) {
    await page.setViewport({ width, height: 900 });
    await page.goto(`http://127.0.0.1:${port}/${language}/?layout=${width}#files`);
    await state(['empty']);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    assert.equal(await page.$eval('#files-tab', element => element.getAttribute('aria-selected')), 'true');
    assert.equal(await page.$eval('html', element => element.dir), language === 'ar' ? 'rtl' : 'ltr');
    await choose('voice-and-music.m4a');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.screenshot({ path: join(work, `ready-${language}-${width}.png`), fullPage: true });
  }
  assert.deepEqual(errors, []);
  console.log('PASS English/Arabic, desktop/mobile, and no uncaught page errors');
  console.log('All landing tests passed. Outputs:', work);
} finally {
  await browser.close();
  server.kill();
}

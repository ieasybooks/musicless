import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, join } from 'node:path';
import manifest from '../extension/manifest.json' with { type: 'json' };
import { firefoxManifest } from '../tools/firefox-manifest.mjs';
import { content, stores } from './content.mjs';
import { pages, slugs, dated, pageBody, plain } from './pages.mjs';
import { audioCopy } from './audio/copy.js';
import { MODEL_SHA256 } from './audio/config.js';
import pins from '../tools/dependencies.json' with { type: 'json' };
import { build } from 'esbuild';
import { copyOrt } from '../tools/fetch-ort.mjs';

const here = fileURLToPath(new URL('.', import.meta.url));
const repo = resolve(here, '..');
const out = join(repo, 'dist/landing');
const origin = 'https://musicless.ieasybooks.com';
const firefoxMinimum = firefoxManifest(manifest).browser_specific_settings.gecko.strict_min_version;
const escape = s => s.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
const arrow = '<svg class="arrow" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14m-6-6 6 6-6 6"/></svg>';
const play = '<svg class="play-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5 20 12 8 19Z"/></svg>';
const globe = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><ellipse cx="12" cy="12" rx="4" ry="9"/><path d="M3 12h18"/></svg>';
// The root already contains the English page. Only Arabic needs another navigation.
const rootLanguageScript = `
  <script>
    if (location.pathname === '/') {
      const suffix = location.search + location.hash;
      if (navigator.language.toLowerCase().startsWith('ar')) {
        location.replace('/ar/' + suffix);
      } else {
        history.replaceState(history.state, '', '/en/' + suffix);
      }
    }
  </script>`;

await rm(out, { recursive: true, force: true });
await mkdir(join(out, 'assets'), { recursive: true });
for (const file of ['site.css', 'site.js']) await cp(join(here, file), join(out, 'assets', file));
for (const file of ['musicless-logo-ink.svg', 'musicless-logo-ar-ink.svg', 'musicless-icon.svg']) {
  await cp(join(repo, 'assets/brand', file), join(out, 'assets', file));
}
await cp(join(repo, 'extension/fonts/alexandria-arabic.woff2'), join(out, 'assets/alexandria-arabic.woff2'));
await cp(join(repo, 'extension/licenses/alexandria-OFL.txt'), join(out, 'assets/alexandria-OFL.txt'));
await cp(join(repo, 'extension/icons/player-on.svg'), join(out, 'assets/player-on.svg'));
await cp(join(repo, 'docs/store/github-social-1280x640.png'), join(out, 'assets/social.png'));
await cp(join(here, 'assets'), join(out, 'assets'), { recursive: true });
if (MODEL_SHA256 !== pins.model_sha256) throw new Error('Update the website model URL to match the extension weights');
await build({
  entryPoints: [join(here, 'audio/app.js'), join(here, 'audio/worker.js')],
  outdir: join(out, 'assets/audio'), bundle: true, splitting: true, format: 'esm',
  platform: 'browser', target: 'es2022', minify: true, chunkNames: 'chunks/[name]-[hash]',
});
for (const file of ['model.js', 'grid.js']) {
  await mkdir(join(out, 'assets/engine'), { recursive: true });
  await cp(join(repo, 'extension', file), join(out, 'assets/engine', file));
}
await copyOrt(join(out, 'assets/engine/vendor'));
await cp(join(here, 'audio/audio.css'), join(out, 'assets/audio.css'));
await cp(join(repo, 'extension/licenses'), join(out, 'licenses'), { recursive: true });
for (const [name, source] of Object.entries({
  'mediabunny-MPL-2.0.txt': 'mediabunny/LICENSE',
  'mp3-encoder-MPL-2.0.txt': '@mediabunny/mp3-encoder/LICENSE',
  'aac-encoder-MPL-2.0.txt': '@mediabunny/aac-encoder/LICENSE',
  'lame-LICENSE.txt': '@mediabunny/mp3-encoder/licenses/lame/LICENSE',
  'lame-COPYING.txt': '@mediabunny/mp3-encoder/licenses/lame/COPYING',
  'ffmpeg-LICENSE.md': '@mediabunny/aac-encoder/licenses/ffmpeg/LICENSE.md',
  'ffmpeg-LGPL-2.1.txt': '@mediabunny/aac-encoder/licenses/ffmpeg/COPYING.LGPLv2.1',
  'mp3-encoder-build.md': '@mediabunny/mp3-encoder/README.md',
  'aac-encoder-build.md': '@mediabunny/aac-encoder/README.md',
})) await cp(join(repo, 'node_modules', source), join(out, 'licenses', name));
await cp(join(here, 'THIRD_PARTY.md'), join(out, 'licenses/THIRD_PARTY.md'));

for (const [lang, c] of Object.entries(content)) {
  const a = audioCopy[lang];
  const videoUrl = `https://youtu.be/${c.videoId}`;
  const logo = lang === 'ar' ? 'musicless-logo-ar' : 'musicless-logo';
  const paperLogo = await readFile(join(repo, 'assets/brand', logo + '-paper.svg'), 'base64');
  const poster = `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720" viewBox="0 0 1280 720">
  <rect width="1280" height="720" fill="#1f1d1a"/>
  <path d="M0 292h210m860 0h210M0 306h178m924 0h178M0 320h144m992 0h144" stroke="#4b453b" stroke-width="1"/>
  <image href="data:image/svg+xml;base64,${paperLogo}" x="345" y="230" width="590" height="125"/>
</svg>`;
  await writeFile(join(out, 'assets', `poster-${lang}.svg`), poster);
  // The landing (page '') and the text pages share the head, header and footer.
  const pageUrl = (page, code = lang) => `${origin}/${code}/${page}`;
  const head = ({ page, title, description, assets, rootScript = '', xDefault = '' }) => `<head>
  <meta charset="utf-8">${rootScript}
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escape(title)}</title>
  <meta name="description" content="${escape(description)}">
  <meta name="theme-color" content="#f4ede0">
  <link rel="canonical" href="${pageUrl(page)}">
  <link rel="alternate" hreflang="en" href="${pageUrl(page, 'en')}">
  <link rel="alternate" hreflang="ar" href="${pageUrl(page, 'ar')}">${xDefault && `
  <link rel="alternate" hreflang="x-default" href="${xDefault}">`}
  <meta property="og:type" content="website">
  <meta property="og:title" content="${escape(title)}">
  <meta property="og:description" content="${escape(description)}">
  <meta property="og:url" content="${pageUrl(page)}">
  <meta property="og:locale" content="${lang === 'ar' ? 'ar_AR' : 'en_US'}">
  <meta property="og:image" content="${origin}/assets/social.png">
  <meta name="twitter:card" content="summary_large_image">
  <link rel="icon" type="image/svg+xml" href="/assets/musicless-icon.svg">
  ${lang === 'ar' ? '<link rel="preload" href="/assets/alexandria-arabic.woff2" as="font" type="font/woff2" crossorigin>' : ''}
  ${assets}
</head>`;
  const header = page => `<a class="skip" href="#main">${c.skip}</a>
  <header class="header shell">
    <a class="logo" href="/${lang}/" aria-label="${c.home}"><img src="/assets/${logo}-ink.svg" width="170" height="36" alt="${c.name}"></a>
    <nav aria-label="${c.nav}">
      <a class="section-link" href="${page && `/${lang}/`}#how">${c.how}</a>
      <a class="section-link" href="${page && `/${lang}/`}#questions">${c.questions}</a>
      <details class="language">
        <summary aria-label="${c.chooseLanguage}" title="${c.chooseLanguage}">${globe}</summary>
        <div class="language-options">${Object.entries(content).map(([code, choice]) =>
          `<a href="/${code}/${page}" hreflang="${code}" lang="${code}" dir="${choice.dir}"${code === lang ? ' aria-current="page"' : ''}>${choice.language}</a>`
        ).join('')}</div>
      </details>
    </nav>
  </header>`;
  const footer = page => `<footer class="footer shell">
    <p>${c.footer} <a href="https://ieasybooks.com/${lang}/">${c.parent}</a>.</p>
    <nav aria-label="${c.footerNav}">${slugs.map(slug =>
      `<a href="/${lang}/${slug}"${slug === page ? ' aria-current="page"' : ''}>${c[slug]}</a>`
    ).join('')}<a href="https://github.com/ieasybooks/musicless">${c.source}</a></nav>
  </footer>`;
  const renderPage = (rootScript = '') => `<!doctype html>
<html lang="${lang}" dir="${c.dir}">
${head({ page: '', title: c.title, description: c.description, rootScript, xDefault: `${origin}/`, assets: `<link rel="stylesheet" href="/assets/site.css">
  <link rel="stylesheet" href="/assets/audio.css">
  <script src="/assets/site.js" defer></script>
  <script src="/assets/audio/app.js" type="module"></script>` })}
<body>
  ${header('')}
  <main id="main" class="main" tabindex="-1">
    <section class="hero" aria-labelledby="headline">
      <a class="eyebrow" href="https://ieasybooks.com/${lang}/">${c.initiative}<span aria-hidden="true">↗</span></a>
      <h1 id="headline">${c.headline}</h1>
      <div class="audio-modes" role="tablist" aria-label="${a.modes}">
        <button type="button" id="youtube-tab" role="tab" data-mode="youtube" aria-controls="youtube-panel" aria-selected="true">${a.youtube}</button>
        <button type="button" id="files-tab" role="tab" data-mode="files" aria-controls="files-panel" aria-selected="false" tabindex="-1">${a.files}</button>
      </div>
      <div id="youtube-panel" role="tabpanel" aria-labelledby="youtube-tab">
      <p class="intro">${c.intro}</p>
      <div class="actions">
        <div class="stores">
          <a class="button" data-store="chrome" data-min-version="${manifest.minimum_chrome_version}" data-install-label="${c.install.replace('{browser}', 'Chrome')}" href="${stores.chrome}">
            <svg aria-hidden="true" viewBox="0 0 24 24"><use href="/assets/store-icons.svg#chrome"/></svg>
            <span>${c.chromeStore}</span>${arrow}
          </a>
          <a class="button" data-store="firefox" data-min-version="${firefoxMinimum}" data-install-label="${c.install.replace('{browser}', 'Firefox')}" href="${stores.firefox}">
            <svg aria-hidden="true" viewBox="0 0 24 24"><use href="/assets/store-icons.svg#firefox"/></svg>
            <span>${c.firefoxStore}</span>${arrow}
          </a>
        </div>
        <a class="watch-link" href="#film">${play}${c.watch}</a>
      </div>
      <p class="free">${c.free}</p>
      </div>
      <section id="files-panel" role="tabpanel" aria-labelledby="files-tab" hidden>
        <p class="intro audio-intro">${a.intro}</p>
        <input type="file" id="audio-file" accept=".mp3,.m4a,audio/mpeg,audio/mp4" hidden aria-label="${a.choose}">
        <div id="audio-workspace" class="audio-workspace" tabindex="-1"><p>${a.noScript}</p></div>
        <p class="audio-privacy"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></svg>${a.local}</p>
        <div class="visually-hidden" id="audio-announcement" role="status" aria-live="polite"></div>
      </section>
    </section>

    <section id="film" class="film-section" aria-labelledby="film-title" data-youtube-section>
      <h2 id="film-title">${c.film}</h2>
      <div class="film">
        <a class="film-play" href="${videoUrl}" data-video-id="${c.videoId}">
          <img src="/assets/poster-${lang}.svg" alt="" width="1280" height="720">
          <span class="play-circle">${play}</span><span>${c.watch}</span>
        </a>
      </div>
      <a class="youtube-link" href="${videoUrl}">${c.youtube}</a>
    </section>

    <section id="how" class="how" aria-labelledby="how-title" data-youtube-section>
      <h2 id="how-title">${c.stepsTitle}</h2>
      <ol class="steps">${c.steps.map(([title, body], i) => `
        <li><span class="step-number" aria-hidden="true">${i + 1}</span><div><h3>${title}</h3><p>${body}</p></div></li>`).join('')}
      </ol>
      <div class="control-note"><span class="player-glyph" aria-hidden="true"><img src="/assets/player-on.svg" width="21" height="21" alt=""></span><p><strong>${c.control}</strong> ${c.controlBody}</p></div>
    </section>

    <section id="questions" class="questions" aria-labelledby="questions-title">
      <h2 id="questions-title">${c.faqTitle}</h2>
      <div class="faq-list" data-youtube-questions>${c.faqs.map(([q, a]) => `
        <details><summary>${q}<span class="plus" aria-hidden="true"></span></summary><p>${a}</p></details>`).join('')}
      </div>
      <div class="faq-list" data-files-questions hidden>${a.faqs.map(([q, answer]) => `
        <details><summary>${q}<span class="plus" aria-hidden="true"></span></summary><p>${answer}</p></details>`).join('')}
      </div>
    </section>
  </main>
  ${footer('')}
</body>
</html>
`;
  await mkdir(join(out, lang), { recursive: true });
  await writeFile(join(out, lang, 'index.html'), renderPage());
  if (lang === 'en') await writeFile(join(out, 'index.html'), renderPage(rootLanguageScript));

  // en/privacy.html is served at /en/privacy. A en/privacy/index.html file
  // would make the static host redirect /en/privacy to /en/privacy/.
  for (const slug of slugs) {
    const page = pages[lang][slug];
    const title = plain(page.title).includes(c.name) ? plain(page.title) : `${plain(page.title)} — ${c.name}`;
    await writeFile(join(out, lang, slug + '.html'), `<!doctype html>
<html lang="${lang}" dir="${c.dir}">
${head({ page: slug, title, description: plain(page.lead), assets: `<link rel="stylesheet" href="/assets/site.css">
  <script src="/assets/site.js" defer></script>` })}
<body>
  ${header(slug)}
  <main id="main" class="main page" tabindex="-1">
    ${pageBody(page, lang, dated.includes(slug) && c.updated)}
  </main>
  ${footer(slug)}
</body>
</html>
`);
  }
}
const urls = Object.keys(content).flatMap(lang => ['', ...slugs].map(page => `${origin}/${lang}/${page}`));
await writeFile(join(out, 'robots.txt'), `User-agent: *\nAllow: /\nSitemap: ${origin}/sitemap.xml\n`);
await writeFile(join(out, 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls.map(url => `<url><loc>${url}</loc></url>`).join('')}</urlset>\n`);
console.log('Built dist/landing (static site and browser audio workers; model fetched from R2 on Submit).');

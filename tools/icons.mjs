// Render Musicless's supplied brand artwork in ink and paper. The mark is a
// snapped eighth note with a gap in its stem. The 16 and 32 px toolbar icons
// each have their own drawing so the gap stays clear at those sizes.
// The logo is outlined artwork: no font is needed to render any brand image.
// YouTube's player glyphs stay separate and keep their original geometry.
//
// Usage (from the repository root): node tools/icons.mjs
// Needs the test tools (./setup.sh --dev) and a Chromium browser (CHROME, as
// for the tests).
import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import puppeteer from "../tests/node_modules/puppeteer-core/lib/esm/puppeteer/puppeteer-core.js";

const ROOT = new URL("../", import.meta.url).pathname;
const BRAND = join(ROOT, "assets/brand");
const INK = "#1f1d1a";

// Set only the displayed size; the supplied paths and viewBox are unchanged.
function sized(name, width) {
  const source = readFileSync(join(BRAND, name), "utf8").trim();
  const [, , w, h] = source.match(/viewBox="([^"]+)"/)[1].split(" ").map(Number);
  return source.replace(/ width="[^"]*" height="[^"]*"/, ` width="${width}" height="${+(width * h / w).toFixed(2)}"`);
}

// The player button's note on its 24-unit grid, as in button.js: a round
// head, a straight stem and a square flag, in YouTube's icon weight; struck
// through corner to corner while the music is removed, the strike cutting a
// gap of `gap` units above it and `low` below it.
let masks = 0;
function note({ color = "#fff", stroke = 2, gap = 1.2, low = 0.7 } = {}) {
  const id = `cut${++masks}`;
  const shift = ((gap - low) / 2) * Math.SQRT1_2; // the cut's centre, up and to the right of the strike's
  const at = (x, y) => `${+(x + shift).toFixed(2)} ${+(y - shift).toFixed(2)}`;
  return `<mask id="${id}" maskUnits="userSpaceOnUse"><rect x="-4" y="-4" width="32" height="32" fill="#fff"/>` +
    `<path d="M${at(3.4, 2.3)} ${at(21.4, 20.3)}" stroke="#000" stroke-width="${+(stroke + gap + low).toFixed(2)}" stroke-linecap="round"/></mask>` +
    `<g mask="url(#${id})" fill="${color}">${PLAIN}</g>` +
    `<path d="M3.4 2.3 21.4 20.3" stroke="${color}" stroke-width="${stroke}" stroke-linecap="round"/>`;
}
const PLAIN = `<circle cx="9.2" cy="17.9" r="4.2"/><rect x="11.4" y="1.9" width="2" height="16"/><rect x="11.4" y="1.9" width="6.4" height="4.4"/>`;

async function render(page, html, width, height, file) {
  await page.setViewport({ width, height, deviceScaleFactor: 1 });
  await page.setContent(`<!doctype html><body style="margin:0;background:transparent">${html}</body>`, { waitUntil: "load" });
  await page.screenshot({ path: file, omitBackground: true, clip: { x: 0, y: 0, width, height } });
}

const chrome = process.env.CHROME ?? ["/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"].find((path) => existsSync(path));
if (!chrome) throw new Error("No browser found: set CHROME to a Chromium browser.");
const profile = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), "musicless-icons-"));
const browser = await puppeteer.launch({
  executablePath: chrome, headless: true, pipe: true, userDataDir: profile,
  args: ["--no-first-run", "--mute-audio", "--disable-gpu", ...(process.env.MUSICLESS_NO_SANDBOX === "1" ? ["--no-sandbox"] : [])],
});
try {
  const page = await browser.newPage();
  for (const size of [16, 32, 48]) {
    const file = size < 48 ? `musicless-icon-${size}.svg` : "musicless-icon.svg";
    await render(page, sized(file, size), size, size, join(ROOT, `extension/icons/icon-${size}.png`));
  }
  // 96 px of art inside a 16 px transparent margin, as Chrome asks.
  const large = `<div style="padding:16px;line-height:0">${sized("musicless-icon.svg", 96)}</div>`;
  await render(page, large, 128, 128, join(ROOT, "extension/icons/icon-128.png"));
  copyFileSync(join(ROOT, "extension/icons/icon-128.png"), join(ROOT, "docs/store/store-icon-128.png"));
  const promo = `<div style="width:440px;height:280px;background:${INK};display:grid;place-items:center;line-height:0">${sized("musicless-logo-paper.svg", 320)}</div>`;
  await render(page, promo, 440, 280, join(ROOT, "docs/store/promo-tile-440x280.png"));
  copyFileSync(join(BRAND, "musicless-icon.svg"), join(ROOT, "extension/icons/icon.svg"));
  // The player button's two glyphs, for sentences that point at it.
  writeFileSync(join(ROOT, "extension/icons/player-on.svg"), `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">${note()}</svg>\n`);
  writeFileSync(join(ROOT, "extension/icons/player-off.svg"), `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><g fill="#fff">${PLAIN}</g></svg>\n`);
  console.log("wrote extension/icons/icon-{16,32,48,128}.png, extension/icons/{icon,player-on,player-off}.svg, docs/store/store-icon-128.png, docs/store/promo-tile-440x280.png");
} finally {
  await browser.close();
  rmSync(profile, { recursive: true, force: true });
}

// Draws nomusic's mark and writes every image made from it: the toolbar and
// extension icons (16, 32, 48 and 128 px), the white mark the first-run page
// sets on its own tile, the store icon and promo tile, and the README logo;
// and the player button's two glyphs, for the sentences that point at it.
//
// The mark is a closing speech mark, white on an amber tile: what nomusic
// keeps is speech. (The other extensions that do this job all show a
// struck-through note.) The player button keeps the note, struck through while
// the music is removed, as YouTube draws mute; button.js draws the same note.
// The 16 px icon is set pixel by pixel, since a scaled-down drawing turns to
// mush at that size; the others are vectors. Only the promo tile's name needs a
// font: Roboto.
//
// Usage (from the repository root): node tools/icons.mjs
// Needs the test tools (./setup.sh --dev) and a Chromium browser (CHROME, as
// for the tests).
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import puppeteer from "../tests/node_modules/puppeteer-core/lib/esm/puppeteer/puppeteer-core.js";

const ROOT = new URL("../", import.meta.url).pathname;
// The tile stands apart from every toolbar at 3:1 or more (white 3.6:1,
// #3c3c3c 3.1:1, #1f1f1f 4.6:1), and the white mark on it is 3.6:1. The pages
// set their white text on a deeper amber (pages.css).
const AMBER = "#bc7800";

// The speech mark: a pair of closing quotation marks, each a round bowl whose
// tail sweeps from its right side down to a point under its left, as a
// typeface draws ” (so it reads as speech, not as the digits 99). `r` is the
// bowl's radius; the tail falls TAIL radii below the bowl; the marks stand GAP
// bowl widths apart. Drawn from (x, y), `width` wide.
const n = (v) => +v.toFixed(3);
const TAIL = 2;
const GAP = 0.65;
function quote(cx, cy, r) {
  const X = (x) => n(cx + x * r);
  const Y = (y) => n(cy + y * r);
  const tip = [-0.75, 1 + TAIL];
  const foot = [0.25, Math.sqrt(1 - 0.25 ** 2)];
  return `M${X(0)} ${Y(-1)}A${n(r)} ${n(r)} 0 0 1 ${X(1)} ${Y(0)}` +
    `C${X(1)} ${Y(1 + TAIL * 0.55)} ${X(tip[0] + 0.9)} ${Y(tip[1] - 0.35)} ${X(tip[0])} ${Y(tip[1])}` +
    `C${X(tip[0] + 0.55)} ${Y(tip[1] - 0.75)} ${X(foot[0] + 0.12)} ${Y(foot[1] + 0.45)} ${X(foot[0])} ${Y(foot[1])}` +
    `A${n(r)} ${n(r)} 0 0 1 ${X(-1)} ${Y(0)}A${n(r)} ${n(r)} 0 0 1 ${X(0)} ${Y(-1)}Z`;
}
function mark(x, y, width, color = "#fff") {
  const r = width / (4 + 4 * GAP);
  return `<path fill="${color}" d="${quote(x + r, y + r, r)}${quote(x + 3 * r + 2 * GAP * r, y + r, r)}"/>`;
}
const HEIGHT = (2 + TAIL) / (4 + 4 * GAP); // the pair's height for its width

// The tile with the mark in it, as an SVG of `size` px. `inset` is the
// transparent margin; `share` the mark's width as a share of the tile. The
// pair is centred on its bowls and tails together.
function tile(size, { inset = 0, radius = 0.25, share = 0.56, color = AMBER } = {}) {
  const side = size - 2 * inset;
  const width = side * share;
  const x = inset + (side - width) / 2;
  const y = inset + (side - width * HEIGHT) / 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">` +
    `<rect x="${inset}" y="${inset}" width="${side}" height="${side}" rx="${n(side * radius)}" fill="${color}"/>${mark(x, y, width)}</svg>`;
}

// 16 px, pixel by pixel and in whole pixels: two bowls of five with their
// corners cut, 2 px apart and 2 px from the edges, each tail a 2 px step down
// to the left that ends in one pixel.
const PIXELS = [
  "................",
  "................",
  "................",
  "................",
  "...###....###...",
  "..#####..#####..",
  "..#####..#####..",
  "..#####..#####..",
  "...####...####..",
  ".....##.....##..",
  "....##.....##...",
  "...#......#.....",
  "................",
  "................",
  "................",
  "................",
];
const PIXEL_ICON = `<canvas id="c" width="16" height="16"></canvas><script>
  const c = document.getElementById("c").getContext("2d");
  c.fillStyle = "${AMBER}";
  c.beginPath(); c.roundRect(0, 0, 16, 16, 4); c.fill();
  c.fillStyle = "#fff";
  ${JSON.stringify(PIXELS)}.forEach((row, y) => [...row].forEach((p, x) => p === "#" && c.fillRect(x, y, 1, 1)));
</script>`;

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

async function render(page, html, width, height, file, { script = false } = {}) {
  await page.setViewport({ width, height, deviceScaleFactor: 1 });
  await page.setContent(`<!doctype html><body style="margin:0;background:transparent">${html}</body>`, { waitUntil: "load" });
  if (script) await new Promise((resolve) => setTimeout(resolve, 100));
  await page.screenshot({ path: file, omitBackground: true, clip: { x: 0, y: 0, width, height } });
}

const chrome = process.env.CHROME ?? ["/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"].find((path) => existsSync(path));
if (!chrome) throw new Error("No browser found: set CHROME to a Chromium browser.");
const profile = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), "nomusic-icons-"));
const browser = await puppeteer.launch({
  executablePath: chrome, headless: true, pipe: true, userDataDir: profile,
  args: ["--no-first-run", ...(process.env.NOMUSIC_NO_SANDBOX === "1" ? ["--no-sandbox"] : [])],
});
try {
  const page = await browser.newPage();
  await render(page, PIXEL_ICON, 16, 16, join(ROOT, "extension/icons/icon-16.png"), { script: true });
  // The 128 px icon (also the store's) fills 112 px of it: a flat tile needs
  // no more margin, and the other listings fill all 128.
  const ICONS = {
    32: tile(32, { inset: 1, share: 0.62 }),
    48: tile(48, { inset: 2, share: 0.6 }),
    128: tile(128, { inset: 8 }),
  };
  for (const [size, svg] of Object.entries(ICONS)) await render(page, svg, +size, +size, join(ROOT, `extension/icons/icon-${size}.png`));
  await render(page, ICONS[128], 128, 128, join(ROOT, "docs/store/store-icon-128.png"));
  // The README logo: the tile alone, large.
  await render(page, tile(512), 512, 512, join(ROOT, "assets/logo.png"));
  // The promo tile: the white mark over the name on the amber, one lockup,
  // nothing else (beside a word the mark would read as a quotation). The name
  // is set in Roboto Medium, YouTube's face, near the mark's weight.
  if (!(await page.evaluate(() => document.fonts.check("500 40px Roboto")))) {
    throw new Error("Roboto is needed for the promo tile's name: install it (or point FONTCONFIG_FILE at a folder that has it).");
  }
  await render(page, `<div style="width:440px;height:280px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:18px;background:${AMBER}">
      <svg width="76" height="${n(76 * HEIGHT)}" viewBox="0 0 76 ${n(76 * HEIGHT)}">${mark(0, 0, 76)}</svg>
      <span style="font:500 44px/1 Roboto;letter-spacing:-0.5px;color:#fff;margin-bottom:4px">nomusic</span></div>`, 440, 280, join(ROOT, "docs/store/promo-tile-440x280.png"));
  // The white mark of the first-run page, which draws the tile itself.
  writeFileSync(join(ROOT, "extension/icons/mark.svg"),
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">${mark(3, 12 - (18 * HEIGHT) / 2, 18)}</svg>\n`);
  // The player button's two glyphs, for sentences that point at it.
  writeFileSync(join(ROOT, "extension/icons/player-on.svg"), `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">${note()}</svg>\n`);
  writeFileSync(join(ROOT, "extension/icons/player-off.svg"), `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><g fill="#fff">${PLAIN}</g></svg>\n`);
  console.log("wrote extension/icons/icon-{16,32,48,128}.png, extension/icons/{mark,player-on,player-off}.svg, docs/store/store-icon-128.png, docs/store/promo-tile-440x280.png, assets/logo.png");
} finally {
  await browser.close();
  rmSync(profile, { recursive: true, force: true });
}

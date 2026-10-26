// Draws nomusic's mark and writes every image made from it: the toolbar and
// extension icons (16, 32, 48 and 128 px), the white note the first-run page
// sets on its own tile, the store icon and promo tile, and the README logo.
//
// The mark is the player button's struck-through note (button.js draws the
// same note) in white on a green tile. The 16 px icon is drawn pixel by pixel,
// since a scaled-down drawing turns to grey mush at that size; the others are
// drawn as vectors with their own stroke widths. No font is needed.
//
// Usage (from the repository root): node tools/icons.mjs
// Needs the test tools (./setup.sh --dev) and a Chromium browser (CHROME, as
// for the tests).
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import puppeteer from "../tests/node_modules/puppeteer-core/lib/esm/puppeteer/puppeteer-core.js";

const ROOT = new URL("../", import.meta.url).pathname;
// White on it is 4.5:1; the tile stands apart from light toolbars, and from
// dark pages and toolbars at 3.6:1 and 2.4:1.
const GREEN = "#288563";

// The note on a 24-unit grid, as in button.js: a round head, a straight stem
// and a square flag, in YouTube's icon weight, and the strike corner to corner
// (a little above the diagonal, clear of the head), which cuts a gap of `gap`
// units on its upper side only.
let masks = 0;
function note({ color = "#fff", stroke = 2, gap = 1.3 } = {}) {
  const id = `cut${++masks}`;
  const shift = (gap / 2) * Math.SQRT1_2; // half the gap, up and to the right
  const at = (x, y) => `${+(x + shift).toFixed(2)} ${+(y - shift).toFixed(2)}`;
  return `<mask id="${id}" maskUnits="userSpaceOnUse"><rect x="-4" y="-4" width="32" height="32" fill="#fff"/>` +
    `<path d="M${at(3.4, 2.6)} ${at(21.4, 20.6)}" stroke="#000" stroke-width="${+(stroke + gap).toFixed(2)}" stroke-linecap="round"/></mask>` +
    `<g mask="url(#${id})" fill="${color}"><circle cx="9.4" cy="17.4" r="4.4"/>` +
    `<rect x="11.3" y="2.8" width="2.5" height="14.6"/><rect x="11.3" y="2.8" width="7" height="4.7"/></g>` +
    `<path d="M3.4 2.6 21.4 20.6" stroke="${color}" stroke-width="${stroke}" stroke-linecap="round"/>`;
}

// The tile with the note in it, as an SVG of `size` px. `inset` is the
// transparent margin (the store wants 16 of 128), `scale` the note's share of
// the tile.
function tile(size, { inset = 0, radius = 0.25, scale = 0.7, stroke = 2, gap = 1.3, color = GREEN } = {}) {
  const side = size - 2 * inset;
  const g = side * scale;
  const at = inset + (side - g) / 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">` +
    `<rect x="${inset}" y="${inset}" width="${side}" height="${side}" rx="${side * radius}" fill="${color}"/>` +
    `<g transform="translate(${at} ${at}) scale(${g / 24})">${note({ stroke, gap })}</g></svg>`;
}

// 16 px, pixel by pixel: at this size a gap would cut the note in two, so the
// stem runs unbroken from the head to the flag and a one-pixel strike crosses
// it.
const PIXELS = [
  "................",
  "................",
  "..#.............",
  "...#...#####....",
  "....#..#####....",
  ".....#.##.......",
  "......###.......",
  ".......##.......",
  ".......###......",
  ".......##.#.....",
  ".....####..#....",
  "....######..#...",
  "....######...#..",
  ".....####.......",
  "................",
  "................",
];
const PIXEL_ICON = `<canvas id="c" width="16" height="16"></canvas><script>
  const c = document.getElementById("c").getContext("2d");
  c.fillStyle = "${GREEN}";
  c.beginPath(); c.roundRect(0, 0, 16, 16, 3.5); c.fill();
  c.fillStyle = "#fff";
  ${JSON.stringify(PIXELS)}.forEach((row, y) => [...row].forEach((p, x) => p === "#" && c.fillRect(x, y, 1, 1)));
</script>`;

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
  const ICONS = {
    32: tile(32, { inset: 1, scale: 0.76, stroke: 2.4, gap: 1.4 }),
    48: tile(48, { inset: 2, scale: 0.72, stroke: 2.2, gap: 1.3 }),
    128: tile(128, { inset: 16, scale: 0.7 }),
  };
  for (const [size, svg] of Object.entries(ICONS)) await render(page, svg, +size, +size, join(ROOT, `extension/icons/icon-${size}.png`));
  await render(page, ICONS[128], 128, 128, join(ROOT, "docs/store/store-icon-128.png"));
  // The README logo: the tile alone, large.
  await render(page, tile(512), 512, 512, join(ROOT, "assets/logo.png"));
  // The promo tile: the white note on the mark's green filling the tile,
  // without text, as the store asks (its name shows under the tile); centred
  // on its weight, a little right of its box.
  await render(page, `<div style="width:440px;height:280px;display:grid;place-items:center;background:${GREEN}">
      <svg width="96" height="96" viewBox="0 0 24 24" style="margin-left:3px">${note()}</svg></div>`, 440, 280, join(ROOT, "docs/store/promo-tile-440x280.png"));
  // The white note of the first-run page, which draws the tile itself (it is
  // lighter in the dark).
  writeFileSync(join(ROOT, "extension/icons/note.svg"), `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">${note()}</svg>\n`);
  console.log("wrote extension/icons/icon-{16,32,48,128}.png, extension/icons/note.svg, docs/store/store-icon-128.png, docs/store/promo-tile-440x280.png, assets/logo.png");
} finally {
  await browser.close();
  rmSync(profile, { recursive: true, force: true });
}

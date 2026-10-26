// Draws nomusic's mark and writes every image made from it: the toolbar and
// extension icons (16, 32, 48 and 128 px), the vector mark of the extension's
// pages, the store icon and promo tile, and the README logo.
//
// The mark is the player button's struck-through note (button.js draws the
// same note) in white on a green tile. The 16 px icon is drawn pixel by pixel,
// since a scaled-down drawing turns to grey mush at that size; the others are
// drawn as vectors with their own stroke widths. The wordmark is drawn from
// strokes too, so no font is needed to make these images.
//
// Usage (from the repository root): node tools/icons.mjs
// Needs the test tools (./setup.sh --dev) and a Chromium browser (CHROME, as
// for the tests).
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import puppeteer from "../tests/node_modules/puppeteer-core/lib/esm/puppeteer/puppeteer-core.js";

const ROOT = new URL("../", import.meta.url).pathname;
const GREEN = "#1f7556"; // white on it is 5.6:1; the tile stands out on light and grey toolbars
const INK = "#1f2a24";

// The note on a 24-unit grid, as in button.js: stem and flag in one stroke
// width, a solid head, and the strike from corner to corner with a gap cut
// through the stem (`gap` units each side).
let masks = 0;
function note({ color = "#fff", stroke = 2.6, gap = 1.2 } = {}) {
  const id = `cut${++masks}`;
  return `<mask id="${id}" maskUnits="userSpaceOnUse"><rect x="-4" y="-4" width="32" height="32" fill="#fff"/>` +
    `<path d="M4 4 20 20" stroke="#000" stroke-width="${stroke + 2 * gap}" stroke-linecap="round"/></mask>` +
    `<g mask="url(#${id})" fill="${color}" stroke="${color}" stroke-width="${stroke}" stroke-linecap="round">` +
    `<path d="M12 16.4V4.2"/><path d="M12 4.2c0 2.2 1.8 3.1 3.4 4.1 1.4.9 2.2 2 2.2 3.7" fill="none"/>` +
    `<ellipse cx="9.1" cy="16.9" rx="3.4" ry="2.6" transform="rotate(-22 9.1 16.9)" stroke="none"/></g>` +
    `<path d="M4 4 20 20" stroke="${color}" stroke-width="${stroke}" stroke-linecap="round"/>`;
}

// The tile with the note in it, as an SVG of `size` px. `inset` is the
// transparent margin (the store wants 16 of 128), `scale` the note's share of
// the tile.
function tile(size, { inset = 0, radius = 0.25, scale = 0.72, stroke = 2.6, gap = 1.2, color = GREEN } = {}) {
  const side = size - 2 * inset;
  const g = side * scale;
  const at = inset + (side - g) / 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">` +
    `<rect x="${inset}" y="${inset}" width="${side}" height="${side}" rx="${side * radius}" fill="${color}"/>` +
    `<g transform="translate(${at} ${at}) scale(${g / 24})">${note({ stroke, gap })}</g></svg>`;
}

// 16 px, pixel by pixel: the strike two pixels wide, the stem cut where it
// crosses, a solid head and a short flag.
const PIXELS = [
  "................",
  "................",
  "..##....##......",
  "...##...###.....",
  "....##..####....",
  ".....##..#.##...",
  "......##....#...",
  ".......##...#...",
  "........##......",
  ".........##.....",
  ".....###..##....",
  "....#####..##...",
  "....#####...##..",
  ".....###........",
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

// The wordmark, "nomusic", from round-capped strokes 4.4 units wide on a
// 24-unit x-height (the i's dot rises above it). Returns its width and a
// function that draws it at a given height.
function wordmark(color = INK) {
  const w = 4.4, h = w / 2, top = h, base = 24 - h;
  const parts = [];
  let x = 0;
  const add = (advance, d) => { parts.push(`<path transform="translate(${x.toFixed(2)} 0)" d="${d}"/>`); x += advance; };
  const r = 7.6, ro = 12 - h, rm = 6.6, gap = 5.4;
  add(2 * r + gap, `M0 ${base}V${top + r}A${r} ${r} 0 0 1 ${2 * r} ${top + r}V${base}`); // n
  add(2 * ro + gap, `M${ro} ${top}A${ro} ${ro} 0 1 1 ${ro} ${24 - h}A${ro} ${ro} 0 1 1 ${ro} ${top}`); // o
  add(4 * rm + gap, `M0 ${base}V${top + rm}A${rm} ${rm} 0 0 1 ${2 * rm} ${top + rm}V${base}M${2 * rm} ${top + rm}A${rm} ${rm} 0 0 1 ${4 * rm} ${top + rm}V${base}`); // m
  add(2 * r + gap, `M0 ${top}V${base - r}A${r} ${r} 0 0 0 ${2 * r} ${base - r}V${top}M${2 * r} ${top}V${base}`); // u
  add(14.2 + gap, `M12.9 ${top + 2.6}C11.6 ${top + 0.6} 9.6 ${top} 7.2 ${top}C4.2 ${top} ${h} ${top + 1.8} ${h} ${top + 4.6}C${h} ${top + 7.6} 4.6 ${top + 9} 7.2 ${top + 9.8}C10.2 ${top + 10.8} 13.4 12.4 13.4 15.4C13.4 ${base - 1.8} 10.4 ${base} 7 ${base}C4.2 ${base} 2 ${base - 1} 0.6 ${base - 3}`); // s
  add(w + gap - 1.4, `M${h} ${top}V${base}M${h} -6.6V-6.5`); // i
  add(2 * ro, `M${2 * ro - 1.2} ${top + 3.6}A${ro} ${ro} 0 1 0 ${2 * ro - 1.2} ${24 - h - 3.6}`); // c
  const width = x + w;
  return { width, svg: (height) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${-h} -10 ${width} 36" height="${height}" width="${height * width / 36}">` +
    `<g fill="none" stroke="${color}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round">${parts.join("")}</g></svg>` };
}

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
    32: tile(32, { inset: 1, scale: 0.74, stroke: 2.9, gap: 1.2 }),
    48: tile(48, { inset: 2, scale: 0.72, stroke: 2.7, gap: 1.2 }),
    128: tile(128, { inset: 16, scale: 0.72 }),
  };
  for (const [size, svg] of Object.entries(ICONS)) await render(page, svg, +size, +size, join(ROOT, `extension/icons/icon-${size}.png`));
  await render(page, ICONS[128], 128, 128, join(ROOT, "docs/store/store-icon-128.png"));
  // The README logo: the tile alone, large.
  await render(page, tile(512), 512, 512, join(ROOT, "assets/logo.png"));
  // The promo tile: the mark and the name, nothing to translate.
  const mark = wordmark();
  await render(page, `<div style="width:440px;height:280px;display:flex;align-items:center;justify-content:center;gap:20px;background:#f3f5f2">
      ${tile(96)}${mark.svg(54)}</div>`, 440, 280, join(ROOT, "docs/store/promo-tile-440x280.png"));
  // The vector mark of the extension's pages (popup, first run).
  writeFileSync(join(ROOT, "extension/icons/mark.svg"), `${tile(96)}\n`);
  console.log("wrote extension/icons/icon-{16,32,48,128}.png, extension/icons/mark.svg, docs/store/store-icon-128.png, docs/store/promo-tile-440x280.png, assets/logo.png");
} finally {
  await browser.close();
  rmSync(profile, { recursive: true, force: true });
}

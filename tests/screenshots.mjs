// Store images (docs/store/): the button on a playing video, the recovery
// panel, the toolbar popup, the welcome page and a small promo tile. Uses the
// synthetic test media (build_media.py synthetic), so no third-party content
// appears in them.
// Usage: node screenshots.mjs [media dir]
import { mkdirSync, readFileSync } from "node:fs";
import { launch, newPage, sleep, waitFor, WORK } from "./harness.mjs";
import { serve } from "./serve.mjs";

const OUT = new URL("../docs/store/", import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
const server = await serve(process.argv[2] ?? `${WORK}/media`, 8819);
const { browser, extensionId } = await launch();
const size = { width: 1280, height: 800 };

// Frames a page or image on a dark background with a caption, at 1280x800.
async function showcase(name, caption, inner) {
  const page = await browser.newPage();
  await page.setViewport(size);
  await page.setContent(`<!doctype html><html><body style="margin:0;width:1280px;height:800px;background:#0d1015;
    display:flex;flex-direction:column;align-items:center;justify-content:center;gap:28px;font:600 30px system-ui,sans-serif;color:#f3f4f7">
    <div>${caption}</div>${inner}</body></html>`);
  await page.screenshot({ path: `${OUT}${name}.png` });
  await page.close();
}
const embed = (file) => `<img src="data:image/png;base64,${readFileSync(file).toString("base64")}"
  style="border-radius:14px;box-shadow:0 18px 50px rgba(0,0,0,.6);max-width:1100px;max-height:620px">`;

// 1. The button on a playing video.
const player = await newPage(browser);
await player.setViewport({ width: 900, height: 520 });
await player.goto("http://127.0.0.1:8819/player.html?media=synth&variant=webm-opus");
await player.waitForFunction("window.playerReady === true", { timeout: 30000 });
await player.evaluate(() => { document.querySelector("video").play().catch(() => {}); });
await waitFor(player, (s) => s.status === "on" && !s.holding, { timeout: 60000, label: "on" });
await sleep(3000);
await player.hover(".nomusic-btn");
await sleep(400);
await player.screenshot({ path: `${OUT}raw-player.png`, clip: { x: 20, y: 20, width: 854, height: 480 } });
await showcase("1-removes-music", "Plays YouTube without the music. The voices stay.", embed(`${OUT}raw-player.png`));

// 2. The recovery panel on a copy-protected stream.
const drm = await newPage(browser);
await drm.setViewport({ width: 900, height: 520 });
await drm.goto("http://127.0.0.1:8819/player.html?media=synth&variant=drm");
await drm.waitForFunction("window.playerReady === true", { timeout: 30000 });
await drm.evaluate(() => { document.querySelector("video").play().catch(() => {}); });
await waitFor(drm, (s) => s.status === "failed", { timeout: 30000, label: "failure" });
await sleep(800);
await drm.screenshot({ path: `${OUT}raw-recovery.png`, clip: { x: 20, y: 20, width: 854, height: 480 } });
await showcase("2-never-plays-music", "If it can't remove the music, you decide what plays.", embed(`${OUT}raw-recovery.png`));

// 3. The toolbar popup.
const popup = await browser.newPage();
await popup.setViewport({ width: 332, height: 400, deviceScaleFactor: 2 });
await popup.goto(`chrome-extension://${extensionId}/popup.html`);
await sleep(500);
const box = await popup.evaluate(() => ({ width: document.body.scrollWidth, height: document.body.scrollHeight }));
await popup.screenshot({ path: `${OUT}raw-popup.png`, clip: { x: 0, y: 0, ...box } });
await showcase("3-one-setting", "One setting. Everything stays on your computer.",
  embed(`${OUT}raw-popup.png`).replace("max-width:1100px", "width:" + box.width * 1.6 + "px"));

// 4. The welcome page.
const welcome = await browser.newPage();
await welcome.setViewport(size);
await welcome.goto(`chrome-extension://${extensionId}/welcome.html`);
await sleep(500);
await welcome.screenshot({ path: `${OUT}4-welcome.png` });

// Small promo tile (440x280).
const tile = await browser.newPage();
await tile.setViewport({ width: 440, height: 280 });
const logo = readFileSync(new URL("../assets/logo.png", import.meta.url)).toString("base64");
await tile.setContent(`<!doctype html><html><body style="margin:0;width:440px;height:280px;background:#0d1015;display:flex;
  flex-direction:column;align-items:center;justify-content:center;gap:16px;font:600 18px system-ui,sans-serif;color:#f3f4f7">
  <img src="data:image/png;base64,${logo}" style="width:120px"><div>Removes the music. Keeps the voices.</div></body></html>`);
await tile.screenshot({ path: `${OUT}promo-tile-440x280.png` });

await browser.close();
server.close();
console.log(`wrote ${OUT}`);

// Safari's manifest (tools/safari-manifest.mjs) from the extension's own.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { safariManifest } from "../../tools/safari-manifest.mjs";

const chrome = JSON.parse(readFileSync(new URL("../../extension/manifest.json", import.meta.url), "utf8"));

test("Safari's manifest is Chrome's with a non-persistent classic event page and no minimum_chrome_version", () => {
  const safari = safariManifest(chrome);
  const { background, ...rest } = safari;
  const { background: chromeBackground, minimum_chrome_version: _, ...shared } = chrome;
  assert.deepEqual(rest, shared, "everything else as it is");
  assert.deepEqual(background, { scripts: [chromeBackground.service_worker], persistent: false });
  assert.equal("minimum_chrome_version" in safari, false);
  assert.equal("type" in background, false);
});

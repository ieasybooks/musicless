// Firefox's manifest (tools/firefox-manifest.mjs) from the extension's own.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { firefoxManifest } from "../../tools/firefox-manifest.mjs";

const chrome = JSON.parse(readFileSync(new URL("../../extension/manifest.json", import.meta.url), "utf8"));

test("Firefox's manifest is Chrome's with an event page, its add-on ID and its minimum version", () => {
  const firefox = firefoxManifest(chrome);
  const { background, browser_specific_settings: settings, ...rest } = firefox;
  const { background: chromeBackground, minimum_chrome_version: _, ...shared } = chrome;
  assert.deepEqual(rest, shared, "everything else as it is");
  assert.deepEqual(background, { scripts: [chromeBackground.service_worker], type: chromeBackground.type });
  assert.deepEqual(settings, { gecko: { id: "musicless@ieasybooks", strict_min_version: "153.0", data_collection_permissions: { required: ["none"] } }, gecko_android: {} });
});

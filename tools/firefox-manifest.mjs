// Firefox's manifest for Musicless: Chrome's, with what Firefox needs instead.
// scripts/package.sh writes it into the Firefox zip, and the browser tests
// install the extension with it in Firefox.
//
// Firefox runs background.scripts (an event page) where Chrome runs the
// service worker. It needs an add-on ID, which can never change once on Firefox
// Add-ons, and new add-ons declare what data they collect: none. 153 is the
// oldest Firefox Mozilla supports.
//
// Usage: node tools/firefox-manifest.mjs <manifest.json>  prints it
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export const GECKO_ID = "musicless@ieasybooks";

export function firefoxManifest(chrome) {
  const firefox = {};
  for (const [key, value] of Object.entries(chrome)) {
    if (key === "minimum_chrome_version") continue;
    firefox[key] = key === "background" ? { scripts: [value.service_worker], type: value.type } : value;
  }
  firefox.browser_specific_settings = { gecko: {
    id: GECKO_ID,
    strict_min_version: "153.0",
    data_collection_permissions: { required: ["none"] },
  }, gecko_android: {} };
  return firefox;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const chrome = JSON.parse(readFileSync(process.argv[2], "utf8"));
  process.stdout.write(`${JSON.stringify(firefoxManifest(chrome), null, 2)}\n`);
}

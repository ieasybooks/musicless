// Safari's manifest for Musicless: Chrome's, with what Safari needs instead.
// scripts/package-safari.sh writes it into the staged Safari Web Extension
// resources directory used by the Xcode project (macOS, iOS, and iPadOS).
//
// Safari runs a classic non-persistent background event page ("scripts" +
// "persistent": false) reliably; waking an idle MV3 module service worker can
// hang chrome.runtime.sendMessage (WKWebExtensionContextErrorDomain Code=6).
//
// Usage: node tools/safari-manifest.mjs <manifest.json>  prints it
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export function safariManifest(chrome) {
  const safari = {};
  for (const [key, value] of Object.entries(chrome)) {
    if (key === "minimum_chrome_version") continue;
    safari[key] = key === "background"
      ? { scripts: [value.service_worker], persistent: false }
      : value;
  }
  return safari;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const chrome = JSON.parse(readFileSync(process.argv[2], "utf8"));
  process.stdout.write(`${JSON.stringify(safariManifest(chrome), null, 2)}\n`);
}

// MV3 content scripts are classic scripts. Bundle the module graph so Chrome
// loads it directly, without cross-origin module requests from a YouTube page.
import { buildSync } from "esbuild";
import { resolve, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export function buildContent(directory = fileURLToPath(new URL("../extension/", import.meta.url))) {
  buildSync({
    entryPoints: [join(directory, "content.js")],
    outfile: join(directory, "content.bundle.js"),
    bundle: true,
    format: "iife",
    platform: "browser",
    target: "chrome111",
    legalComments: "inline",
    banner: { js: `/*
 * Includes SoundTouch JS (Mozilla Public License 2.0).
 * Copyright Olli Parviainen, Ryan Berdeen, Jakub Fiala, Steve 'Cutter' Blades.
 * Source and license: third_party/soundtouch/ (https://mozilla.org/MPL/2.0/).
 */` },
  });
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) buildContent();

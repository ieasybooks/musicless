// Static server for the local test pages and media on 127.0.0.1.
// Usage (from tests/): node serve.mjs <media dir> [port]
import { createServer } from "node:http";
import { createReadStream, statSync } from "node:fs";
import { extname, join, normalize } from "node:path";

const [mediaDir, port = "8811"] = process.argv.slice(2);
const siteDir = new URL("./site/", import.meta.url).pathname;
const types = {
  ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".json": "application/json",
  ".mp4": "video/mp4", ".m4s": "video/mp4", ".webm": "video/webm", ".mpd": "application/dash+xml",
};

export function serve(dir = mediaDir, listenPort = Number(port)) {
  const server = createServer((req, res) => {
    const path = normalize(decodeURIComponent(new URL(req.url, "http://x").pathname));
    const file = path.startsWith("/media/") ? join(dir, path.slice(7)) : join(siteDir, path.slice(1));
    let size;
    try {
      size = statSync(file).size;
    } catch {
      res.writeHead(404).end();
      return;
    }
    const headers = { "content-type": types[extname(file)] ?? "application/octet-stream", "accept-ranges": "bytes" };
    const range = /bytes=(\d+)-(\d*)/.exec(req.headers.range ?? "");
    if (range) {
      const start = Number(range[1]);
      const end = range[2] ? Number(range[2]) : size - 1;
      res.writeHead(206, { ...headers, "content-range": `bytes ${start}-${end}/${size}`, "content-length": end - start + 1 });
      createReadStream(file, { start, end }).pipe(res);
    } else {
      res.writeHead(200, { ...headers, "content-length": size });
      createReadStream(file).pipe(res);
    }
  });
  return new Promise((resolve) => server.listen(listenPort, "127.0.0.1", () => resolve(server)));
}

if (import.meta.url === `file://${process.argv[1]}`) serve().then(() => console.log(`serving on ${port}`));

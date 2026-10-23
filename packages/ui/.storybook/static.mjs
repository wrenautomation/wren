/** A built Storybook (or any folder), served on a free local port for one run. */
import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, resolve } from "node:path";

const TYPES = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
  ".png": "image/png",
  ".mjs": "text/javascript",
};

/** A built Storybook, served on a free port for this run. */
export async function serve(dir, { need = "index.json" } = {}) {
  const root = resolve(dir);
  if (need && !existsSync(join(root, need)))
    throw new Error(`${dir}: no Storybook build (stories:build)`);
  const server = createServer((req, res) => {
    const path = join(root, decodeURIComponent(new URL(req.url, "http://x").pathname));
    const file = path.startsWith(root) && existsSync(path) && statSync(path).isFile() ? path : null;
    if (!file) return res.writeHead(404).end();
    res.writeHead(200, { "content-type": TYPES[extname(file)] ?? "application/octet-stream" });
    createReadStream(file).pipe(res);
  });
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  return { server, base: `http://127.0.0.1:${server.address().port}` };
}

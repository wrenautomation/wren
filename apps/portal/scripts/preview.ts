/**
 * The portal on your machine, against your local databases: the built app plus
 * the same API, called in-process instead of through Restate and sign-in.
 *
 *   pnpm --filter @wren/portal preview          # as an operator: every client
 *   pnpm --filter @wren/portal preview --demo   # as a demo visitor: masked
 *   pnpm --filter @wren/portal preview --as amy@acme.example   # as a client's person
 */
import { createReadStream, existsSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";
import { loadEnvFile, loadSettings } from "@wren/config";
import { clientUrl } from "@wren/core/clients";
import { PortalRefusal, type Viewer } from "@wren/core/portal";
import { cachedDb, createDb } from "@wren/db";
import { type FileStore, fileNameOf } from "@wren/delivery/files";
import { DELIVERY_ROUTES, deliveryApi } from "@wren/delivery/restate";
import { DEMO_NAME, PORTAL_ROUTES, portalApi } from "@wren/reactivation/restate";

const demo = process.argv.includes("--demo");
const port = Number(process.env.PORT ?? 8788);
const rootDir = loadEnvFile(process.cwd(), process.env.WREN_ROOT);
const settings = loadSettings(process.env, { rootDir });
const main = createDb(settings.databaseUrl, { max: 2 }).db;
/** Client files in memory, PUT and GET at /files/<key>: the bucket's part, minus the signing. */
const stored = new Map<string, { type: string; bytes: Buffer }>();
const files: FileStore = {
  putUrl: async (key) => `http://localhost:${port}/files/${key}`,
  getUrl: async (key) => `http://localhost:${port}/files/${key}`,
  put: async (key, bytes, type) => void stored.set(key, { type, bytes: Buffer.from(bytes) }),
};
/** The same services as the Worker's `/api/<service>/<route>`, called in-process. */
const SERVICES: Record<string, { routes: readonly string[]; api: object }> = {
  delivery: { routes: DELIVERY_ROUTES, api: deliveryApi({ main, demoName: DEMO_NAME, files }) },
  reactivation: {
    routes: PORTAL_ROUTES,
    api: portalApi({ main, open: (c) => cachedDb(clientUrl(settings.databaseUrl, c)) }),
  },
};
const as = process.argv[process.argv.indexOf("--as") + 1];
const viewer: Viewer = demo
  ? { demo: true }
  : process.argv.includes("--as") && as
    ? { email: as }
    : { email: "preview@localhost", operator: true };
const dist = join(import.meta.dirname, "..", "dist");
const TYPES: Record<string, string> = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".svg": "image/svg+xml",
  ".png": "image/png",
};

createServer(async (req, res) => {
  const path = new URL(req.url ?? "/", "http://x").pathname;
  if (path.startsWith("/files/")) {
    const key = path.slice(7);
    if (req.method === "PUT") {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(chunk as Buffer);
      stored.set(key, { type: req.headers["content-type"] ?? "", bytes: Buffer.concat(chunks) });
      return res.writeHead(200).end();
    }
    const f = stored.get(key);
    if (!f) return res.writeHead(404).end();
    res.writeHead(200, {
      "content-type": f.type,
      "content-disposition": `attachment; filename="${fileNameOf(key)}"`,
    });
    return res.end(f.bytes);
  }
  const route = path.startsWith("/api/") ? path.slice(5) : null;
  if (route !== null) {
    const send = (status: number, body: unknown) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    };
    const [name = "", call = ""] = route.split("/");
    const svc = SERVICES[name];
    if (!svc?.routes.includes(call)) return send(404, { error: "not found" });
    let raw = "";
    for await (const chunk of req) raw += chunk;
    try {
      const input = { ...(raw ? JSON.parse(raw) : {}), viewer };
      const handler = (svc.api as Record<string, (i: unknown) => Promise<unknown>>)[call];
      if (!handler) return send(404, { error: "not found" });
      return send(200, await handler(input));
    } catch (err) {
      if (err instanceof PortalRefusal) return send(err.status, { message: err.message });
      console.error(err);
      return send(500, { message: err instanceof Error ? err.message : String(err) });
    }
  }
  const file = normalize(join(dist, path === "/" ? "index.html" : path));
  const found =
    file.startsWith(dist) && existsSync(file) && extname(file) ? file : join(dist, "index.html");
  res.writeHead(200, { "content-type": TYPES[extname(found)] ?? "application/octet-stream" });
  createReadStream(found).pipe(res);
}).listen(port, () =>
  console.log(`portal preview${demo ? " (demo)" : ""}: http://localhost:${port}`),
);

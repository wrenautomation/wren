/**
 * The portal on your machine, against your local databases: the built app plus
 * the same API, called in-process instead of through Restate and sign-in.
 *
 *   pnpm --filter @wren/portal preview          # as an operator: every client
 *   pnpm --filter @wren/portal preview --demo   # as a demo visitor: masked
 */
import { createReadStream, existsSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";
import { loadEnvFile, loadSettings } from "@wren/config";
import { clientUrl } from "@wren/core/clients";
import { PortalRefusal, type Viewer } from "@wren/core/portal";
import { cachedDb, createDb } from "@wren/db";
import { DELIVERY_ROUTES, deliveryApi } from "@wren/delivery/restate";
import { DEMO_NAME, PORTAL_ROUTES, portalApi } from "@wren/reactivation/restate";

const demo = process.argv.includes("--demo");
const port = Number(process.env.PORT ?? 8788);
const rootDir = loadEnvFile(process.cwd(), process.env.WREN_ROOT);
const settings = loadSettings(process.env, { rootDir });
const main = createDb(settings.databaseUrl, { max: 2 }).db;
/** The same services as the Worker's `/api/<service>/<route>`, called in-process. */
const SERVICES: Record<string, { routes: readonly string[]; api: object }> = {
  delivery: { routes: DELIVERY_ROUTES, api: deliveryApi({ main, demoName: DEMO_NAME }) },
  reactivation: {
    routes: PORTAL_ROUTES,
    api: portalApi({ main, open: (c) => cachedDb(clientUrl(settings.databaseUrl, c)) }),
  },
};
const viewer: Viewer = demo ? { demo: true } : { email: "preview@localhost", operator: true };
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

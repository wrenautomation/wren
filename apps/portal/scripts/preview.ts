/**
 * The portal on your machine, against your local databases: the built app plus
 * the same API, called in-process instead of through Restate and sign-in.
 *
 *   pnpm --filter @wren/portal preview          # as an operator: every client
 *   pnpm --filter @wren/portal preview --demo   # as a demo visitor: masked
 *   pnpm --filter @wren/portal preview --as amy@acme.example   # as that person, guarded
 *
 * With `--as`, each call runs the access guard first, as the edge's services do, so a custom
 * role, extra grants and View as answer here as they would live.
 */
import { createReadStream, existsSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";
import { callRecord } from "@wren/channel-email/records";
import { EMAIL_CONSOLE_VIEWS } from "@wren/channel-email/views";
import { loadEnvFile, loadSettings } from "@wren/config";
import { type Need, type RouteApps, routeAt } from "@wren/core/access";
import { accountsApi } from "@wren/core/accounts/console";
import { ACCOUNTS_CONSOLE_APPS, ACCOUNTS_CONSOLE_ROUTES } from "@wren/core/accounts/console-routes";
import { askRecord } from "@wren/core/ask";
import { clientRecord, clientUrl } from "@wren/core/clients";
import { consoleApi } from "@wren/core/console";
import { CONSOLE_APPS, CONSOLE_ROUTES } from "@wren/core/console-routes";
import {
  MARKETING_CONSOLE_APPS,
  MARKETING_CONSOLE_ROUTES,
} from "@wren/core/marketing/console-routes";
import { guard, PortalRefusal, teamSeat, type Unnamed, type Viewer } from "@wren/core/portal";
import { templatesApi } from "@wren/core/templates/console";
import {
  TEMPLATES_CONSOLE_APPS,
  TEMPLATES_CONSOLE_ROUTES,
} from "@wren/core/templates/console-routes";
import { cachedDb, createDb } from "@wren/db";
import { type FileStore, fileNameOf } from "@wren/delivery/files";
import { DELIVERY_ROUTES, deliveryApi } from "@wren/delivery/restate";
import { DELIVERY_APPS } from "@wren/delivery/routes";
import { DEMO_NAME, PORTAL_ROUTES, portalApi } from "@wren/reactivation/restate";
import { mediaRecord, sopRecord } from "../../../packages/content/src/library.js";
import { marketingConsoleApi } from "../../../packages/content/src/restate/marketing-console.js";
import { PORTAL_APPS } from "../../../packages/reactivation/src/portal/routes.js";
import { COMPONENTS } from "../../worker/src/components.js";
import { CLIENT_MARKETING } from "../../worker/src/marketing.js";
import { copyRecords } from "../../worker/src/record-edits.js";
import { SETUPS } from "../../worker/src/setups.js";
import { WORKFLOWS } from "../../worker/src/workflows.js";

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
/** The checks the Worker runs (services.ts `setupChecks`): the rest say "in development". */
const LIVE_CHECKS = new Set([
  "dns.answers",
  "dns.mail_records",
  "dns.postmaster_txt",
  "telnyx.campaign",
  "telnyx.number",
  "inbox.warmup",
  "inbox.placement",
]);
/** The same services as the Worker's `/api/<service>/<route>`, called in-process. */
const SERVICES: Record<
  string,
  {
    routes: readonly string[];
    api: object;
    guard: { needs: object; apps: RouteApps<object>; unnamed: Unnamed };
  }
> = {
  delivery: {
    routes: Object.keys(DELIVERY_ROUTES),
    guard: { needs: DELIVERY_ROUTES, apps: DELIVERY_APPS, unnamed: "first" },
    api: deliveryApi({ main, demoName: DEMO_NAME, files, app: `http://localhost:${port}` }),
  },
  reactivation: {
    routes: Object.keys(PORTAL_ROUTES),
    guard: { needs: PORTAL_ROUTES, apps: PORTAL_APPS, unnamed: "first" },
    api: portalApi({ main, open: (c) => cachedDb(clientUrl(settings.databaseUrl, c)) }),
  },
  console: {
    routes: Object.keys(CONSOLE_ROUTES),
    guard: { needs: CONSOLE_ROUTES, apps: CONSOLE_APPS, unnamed: "wren" },
    api: consoleApi({
      main,
      views: EMAIL_CONSOLE_VIEWS,
      components: COMPONENTS,
      workflows: WORKFLOWS,
      setups: SETUPS,
      records: [
        askRecord,
        // The Clients app's list, with each client's Templates, Components and Accounts.
        clientRecord,
        // The copy pages edit in place: History, Undo, Ask Claude (whose answer nothing writes here).
        ...copyRecords(settings.smsSenderName),
        // The Library's Media (no bucket here: listed, not played) and SOPs.
        mediaRecord(),
        sopRecord,
        // Inbox > Calls, and a client's page (/clients/all/<id>), as the worker registers them.
        callRecord,
        clientRecord,
      ],
    }),
  },
  // Accounts and vendors. Steps move on the spine, which isn't here: a write saves, nothing runs.
  // No key store: an own key is refused, as in prod until the IAM grant.
  accounts: {
    routes: Object.keys(ACCOUNTS_CONSOLE_ROUTES),
    guard: { needs: ACCOUNTS_CONSOLE_ROUTES, apps: ACCOUNTS_CONSOLE_APPS, unnamed: "first" },
    api: accountsApi({ db: main, setups: SETUPS, checks: LIVE_CHECKS, keys: null, env: "dev" }),
  },
  // A client's Marketing, from its own database. A verdict goes to its desk on Restate: not here.
  marketing: {
    routes: Object.keys(MARKETING_CONSOLE_ROUTES),
    guard: { needs: MARKETING_CONSOLE_ROUTES, apps: MARKETING_CONSOLE_APPS, unnamed: "first" },
    api: marketingConsoleApi({
      db: main,
      open: (c) => cachedDb(clientUrl(settings.databaseUrl, c)),
      records: CLIENT_MARKETING,
    }),
  },
  // The Library's templates, in Wren's own database.
  templates: {
    routes: Object.keys(TEMPLATES_CONSOLE_ROUTES),
    guard: { needs: TEMPLATES_CONSOLE_ROUTES, apps: TEMPLATES_CONSOLE_APPS, unnamed: "wren" },
    api: templatesApi({ db: main }),
  },
};
/** Ask Claude's handler is Restate's (it opens a run, then the desk answers): here, only the run. */
const local = SERVICES.console?.api as Record<string, (i: unknown) => Promise<unknown>>;
local.recordsAsk = async (i) => ({ id: await local.recordsAskOpen?.(i) });
local.workflowAsk = async (i) => ({ id: await local.workflowAskOpen?.(i) });
const as = process.argv[process.argv.indexOf("--as") + 1];
const guarded = !demo && process.argv.includes("--as") && !!as;
const viewer: Viewer = demo
  ? { demo: true }
  : guarded
    ? { email: as, ...((await teamSeat(main, as)) ? { operator: true } : {}) }
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
      if (!guarded) return send(200, await handler(input));
      const g = svc.guard;
      const need = (g.needs as Record<string, Need>)[call] as Need;
      return send(
        200,
        await handler(await guard(main, need, input, g.unnamed, routeAt(g.apps, call))),
      );
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

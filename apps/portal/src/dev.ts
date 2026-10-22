/**
 * The portal on this Mac against prod (designs/2026-10-21-dev-loop.md): `pnpm dev` runs this
 * Worker in Vite (`@cloudflare/vite-plugin`) and reads prod through Restate. Only when WREN_DEV
 * is "1" and the host is this machine; prod's Worker never has WREN_DEV.
 *
 * Writes are off unless WREN_DEV_WRITES is "1". The guard lets through a known list only: a page,
 * a read route, a batch of reads, a media grant, a write's status. Anything else is refused.
 */
import { LIVE_PREFIX } from "@wren/notes/room";
import { AGENT_PATH } from "./agent.js";
import { json } from "./edge.js";
import type { Env } from "./env.js";
import { MEDIA_GRANT_PATH } from "./media.js";
import { PULSE_PATH } from "./pulse.js";
import { SERVICES, WRITE_STATUS_PATH } from "./services.js";
import { WRITES_LIVE_PATH } from "./watch.js";

const LOCAL = /^(localhost|127\.0\.0\.1|\[::1\])$/;

/** This request is local dev. */
export const isDev = (req: Request, env: Env) =>
  env.WREN_DEV === "1" && LOCAL.test(new URL(req.url).hostname);

/** The viewer in dev: the operator WREN_DEV_EMAIL names, no sign-in. */
export const devViewer = (env: Env) => ({
  email: env.WREN_DEV_EMAIL ?? "",
  operator: true as const,
});

/** Reads that go by POST. A read route of a service is checked on its own. */
const POST_READS = new Set([PULSE_PATH, MEDIA_GRANT_PATH, WRITE_STATUS_PATH]);
/**
 * Paths that change things, or reach out, by GET or a socket: off whatever their method. A Sites
 * page counts its visit (`/o/`).
 */
const NEVER = [LIVE_PREFIX, AGENT_PATH, "/oauth/", "/o/", "/api/keys/", "/api/dictate"];

/** The refusal of a write in dev with writes off; null lets the request through. */
export function devRefusal(req: Request, env: Env): Response | null {
  if (env.WREN_DEV_WRITES === "1") return null;
  const { pathname } = new URL(req.url);
  const off = json({ error: "Dev: writes are off. WREN_DEV_WRITES=1 turns them on." }, 403);
  if (NEVER.some((p) => pathname.startsWith(p))) return off;
  if (pathname === WRITES_LIVE_PATH) return null;
  if (["GET", "HEAD"].includes(req.method)) return null;
  if (POST_READS.has(pathname)) return null;
  const [name = "", route = "", ...rest] = pathname.replace(/^\/api\//, "").split("/");
  const svc = pathname.startsWith("/api/") && Object.hasOwn(SERVICES, name) ? SERVICES[name] : null;
  return svc && !rest.length && svc.routes.has(route) && !svc.writes.has(route) ? null : off;
}

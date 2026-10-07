/**
 * A pasted key's way in (designs/2026-10-07-key-store.md): `POST /api/keys/stage` here, then the
 * sign-in Lambda, which seals it and answers a ref. Restate never sees it: a handler gets the ref.
 * This Worker checks the sign-in and says who it is; the Lambda checks that person may save keys
 * for the client.
 */
import { readBody } from "@wren/core/http";
import {
  KEY_MAX,
  KEY_STAGE_PATH,
  KEY_VIEWER_HEADER,
  REF_ROUTES,
  rawKeyAt,
} from "@wren/core/key-refs";
import { json } from "./edge.js";
import type { Env } from "./env.js";
import type { Site } from "./hosts.js";

type Viewer = { email: string; operator?: boolean } | { demo: true };

/** The browser's key, passed on to the sign-in Lambda; its answer back. */
export async function keyStage(
  req: Request,
  env: Env,
  site: Site,
  viewerOf: (req: Request) => Promise<Viewer | Response>,
): Promise<Response> {
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  if (site.kind === "demo") return json({ error: "Sign in." }, 401);
  if (!(req.headers.get("content-type") ?? "").startsWith("application/json"))
    return json({ error: "json only" }, 415);
  const raw = await readBody(req, KEY_MAX + 1024);
  if (raw === null) return json({ error: "too large" }, 413);
  let input: { client?: unknown; name?: unknown; value?: unknown };
  try {
    input = raw ? JSON.parse(raw) : {};
  } catch {
    return json({ error: "not json" }, 400);
  }
  if (!input || typeof input !== "object" || Array.isArray(input))
    return json({ error: "an object only" }, 400);
  const viewer = await viewerOf(req);
  if (viewer instanceof Response) return viewer;
  if ("demo" in viewer) return json({ error: "Sign in." }, 401);
  if (!env.LAMBDA_URL || !env.EDGE_SECRET)
    return json({ error: "Saving keys isn't set up here yet" }, 503);
  // A client's host saves for that client only.
  const client = site.kind === "client" ? site.client : input.client;
  let res: Response;
  try {
    res = await fetch(new URL(KEY_STAGE_PATH, env.LAMBDA_URL), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-wren-edge": env.EDGE_SECRET,
        "x-wren-ip": req.headers.get("cf-connecting-ip") ?? "",
        [KEY_VIEWER_HEADER]: viewer.email,
      },
      body: JSON.stringify({ client, name: input.name, value: input.value }),
    });
  } catch {
    return json({ error: "Couldn't save the key. Try again." }, 502);
  }
  return new Response(res.body, {
    status: res.status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

/**
 * A route that takes a key's ref, called with a raw key: refused here, before Restate journals
 * it. Null when the call may go on. Never says the key.
 */
export function rawKeyRefusal(route: string, input: unknown): Response | null {
  if (!REF_ROUTES.includes(route)) return null;
  const at = rawKeyAt(input);
  return at ? json({ error: `Send a saved key's reference, never the key (${at})` }, 400) : null;
}

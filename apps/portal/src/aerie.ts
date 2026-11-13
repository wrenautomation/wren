/**
 * `/api/aerie`: the Aerie CLI's store and coord over HTTP (aerie designs D20 B). A `wren_` token as
 * `/api/agent` reads it, then `AerieConsole/remote` runs Aerie's `remoteServer` as that person under the
 * guard (`wren:team`). Aerie's answer (status + superjson text) passes through; an edge refusal is
 * superjson too, so the CLI reads it as an `AerieError`.
 */
import { readBody } from "@wren/core/http";
import { whoOf } from "./agent.js";
import { forward } from "./edge.js";
import type { Env } from "./env.js";
import type { Site } from "./hosts.js";

export const AERIE_PATH = "/api/aerie";
// Aerie's own cap: a batch holds ≤100 calls
const MAX_BODY = 1 << 20;

/** superjson's text for a plain object: `{json}` with no meta */
const refuse = (error: string, status: number, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify({ json: { error } }), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store", ...headers },
  });

export async function aerieRoute(req: Request, env: Env, site: Site): Promise<Response> {
  if (site.kind !== "app") return refuse("Wren's app host only.", 404);
  if (req.method !== "POST") return refuse("POST only.", 405, { allow: "POST" });
  const who = await whoOf(req, env, site);
  if (who instanceof Response) {
    const body = (await who.json().catch(() => null)) as { error?: string } | null;
    return refuse(body?.error ?? "Refused.", who.status, {
      ...(who.headers.get("www-authenticate")
        ? { "www-authenticate": who.headers.get("www-authenticate") as string }
        : {}),
    });
  }
  // a client's own Aerie database: WA-1364.9
  if (who.pin.client) return refuse("Aerie runs on Wren's own database only for now.", 403);
  if (who.viewer.cap && !who.viewer.cap.verbs.some((v) => v === "run" || v === "effect"))
    return refuse("This token only reads. Make one that can run handlers.", 403);
  const raw = await readBody(req, MAX_BODY);
  if (raw === null) return refuse("Too large.", 413);
  const res = await forward(
    env,
    "AerieConsole/remote",
    JSON.stringify({ body: raw, viewer: who.viewer, origin: who.origin }),
  );
  const out = (await res.json().catch(() => null)) as {
    status?: number;
    body?: string;
    message?: string;
    error?: string;
  } | null;
  if (!res.ok) return refuse(out?.message ?? out?.error ?? `Refused (${res.status}).`, res.status);
  if (typeof out?.status !== "number" || typeof out.body !== "string")
    return refuse("The portal's server sent no answer.", 502);
  return new Response(out.body, {
    status: out.status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

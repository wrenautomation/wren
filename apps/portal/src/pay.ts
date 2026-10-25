/**
 * Stripe's webhook for pay links (designs/2026-10-07-forms-and-pay.md): `POST
 * /__pay/stripe/<client>` on the app host. The body goes on byte for byte with its
 * `Stripe-Signature` to `Payments/stripe`, which checks it with that client's signing secret.
 * Stripe gets the status the service answers: 2xx kept, 400 a bad signature, 5xx retried.
 *
 * The call carries an idempotency key from the body and its signature, so one delivery posted
 * twice is one invocation. Never the event id alone: the body isn't checked yet here, and a
 * forged one must not take a real event's key.
 */
import { readBody } from "@wren/core/http";
import type { Env } from "./env.js";
import type { Site } from "./hosts.js";

const PAY_PATH = /^\/__pay\/stripe\/([a-z0-9][a-z0-9_-]{0,39})$/;
/** Stripe's events are small; a checkout session is a few KB. */
const MAX_BODY = 256 * 1024;

const answer = (body: unknown, status: number) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });

/** One delivery's key: the client and a hash of exactly what came, signature included. */
export async function deliveryKey(client: string, raw: string, signature: string | null) {
  const bytes = new TextEncoder().encode(`${raw}\n${signature ?? ""}`);
  const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return `stripe:${client}:${Array.from(hash, (b) => b.toString(16).padStart(2, "0")).join("")}`;
}

/** The answer for a pay path, or null when the path isn't one. */
export async function payRoute(req: Request, env: Env, site: Site): Promise<Response | null> {
  const m = PAY_PATH.exec(new URL(req.url).pathname);
  if (!m?.[1] || site.kind !== "app") return null;
  if (req.method !== "POST") return answer({ error: "POST only" }, 405);
  const raw = await readBody(req, MAX_BODY);
  if (raw === null) return answer({ error: "too large" }, 413);
  const signature = req.headers.get("stripe-signature");
  let res: Response;
  try {
    res = await fetch(`${env.RESTATE_INGRESS_URL.replace(/\/+$/, "")}/Payments/stripe`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "idempotency-key": await deliveryKey(m[1], raw, signature),
        ...(env.RESTATE_AUTH_TOKEN ? { authorization: `Bearer ${env.RESTATE_AUTH_TOKEN}` } : {}),
      },
      body: JSON.stringify({
        client: m[1],
        raw,
        signature,
      }),
    });
  } catch {
    return answer({ error: "try again" }, 502);
  }
  if (!res.ok) return answer({ error: "try again" }, 502);
  const out = (await res.json().catch(() => ({}))) as { status?: number; result?: string };
  const status = typeof out.status === "number" && out.status >= 200 ? out.status : 502;
  return answer({ result: out.result ?? null }, status);
}

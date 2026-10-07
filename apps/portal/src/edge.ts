/** The Worker's small shared parts: JSON answers and calls to Restate's ingress. */
import type { Env } from "./env.js";

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

const ingress = (env: Env, path: string) =>
  `${env.RESTATE_INGRESS_URL.replace(/\/+$/, "")}/${path}`;

/** A POST to `<service>/<handler>` on the ingress, its answer passed through. */
export async function forward(env: Env, path: string, body: string): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(ingress(env, path), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(env.RESTATE_AUTH_TOKEN ? { authorization: `Bearer ${env.RESTATE_AUTH_TOKEN}` } : {}),
      },
      body,
    });
  } catch {
    return json({ error: "The portal's server is unreachable." }, 502);
  }
  // Restate's status and body: a refusal (no client for this login) reads as its message.
  return new Response(res.body, {
    status: res.status,
    headers: {
      "content-type": res.headers.get("content-type") ?? "application/json",
      "cache-control": "no-store",
    },
  });
}

/**
 * One chat completion through the chain: a key with room from the ledger, the next key on
 * a 429 or a dead key, the next model when a model's keys are spent. Kept apart from the
 * Worker so tests run without the Cloudflare runtime.
 */
import { ALIASES, PROVIDERS, type Provider, resolve, type Target } from "./catalog.js";
import { classify, describe, type Outcome } from "./ledger.js";

export interface Env {
  GATEWAY_TOKEN: string;
  GEMINI_KEYS?: string;
  OPENROUTER_KEYS?: string;
  COHERE_KEYS?: string;
}

/** Tries per model before moving down the chain. */
const TRIES_PER_MODEL = 6;

/** One key per line; after the first space a line is a note, and `#` lines are comments. */
export function keysOf(env: Env, p: Provider): string[] {
  return (env[PROVIDERS[p].secret] ?? "")
    .split("\n")
    .map((line) => line.trim().split(/\s/)[0] ?? "")
    .filter((k) => k && !k.startsWith("#"));
}

export function keyCounts(env: Env): Record<Provider, number> {
  return {
    gemini: keysOf(env, "gemini").length,
    openrouter: keysOf(env, "openrouter").length,
    cohere: keysOf(env, "cohere").length,
  };
}

export function json(status: number, body: unknown, headers: HeadersInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

export const error = (status: number, message: string, headers?: HeadersInit) =>
  json(status, { error: { message, type: "gateway_error" } }, headers);

export function authorized(req: Request, env: Env): boolean {
  const got = new TextEncoder().encode(req.headers.get("authorization") ?? "");
  const want = new TextEncoder().encode(`Bearer ${env.GATEWAY_TOKEN}`);
  if (!env.GATEWAY_TOKEN || got.byteLength !== want.byteLength) return false;
  return crypto.subtle.timingSafeEqual(got, want);
}

/** The ledger as the Worker sees it: the Durable Object's stub, or a test double. */
export interface LedgerApi {
  acquire(t: Target): Promise<number | null> | number | null;
  report(t: Target, idx: number, outcome: Outcome, detail?: string): Promise<void> | void;
}

export async function complete(
  body: Record<string, unknown>,
  env: Env,
  ledger: LedgerApi,
  fetcher: typeof fetch = fetch,
): Promise<Response> {
  const chain = resolve(typeof body.model === "string" ? body.model : undefined);
  if (!chain)
    return error(
      400,
      `unknown model '${String(body.model)}': use an alias (${Object.keys(ALIASES).join(", ")}) or <provider>/<model>`,
    );
  const tried: string[] = [];
  for (const t of chain) {
    const keys = keysOf(env, t.provider);
    if (!keys.length) continue;
    for (let n = 0; n < TRIES_PER_MODEL; n++) {
      const idx = await ledger.acquire(t);
      if (idx === null) break;
      const res = await fetcher(`${PROVIDERS[t.provider].baseURL}/chat/completions`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${keys[idx]}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ ...body, model: t.model }),
      });
      if (res.ok) {
        await ledger.report(t, idx, "ok");
        const headers = new Headers(res.headers);
        headers.set("x-gateway-model", `${t.provider}/${t.model}`);
        headers.set("x-gateway-key", `${t.provider}#${idx}`);
        if (body.stream === true) return new Response(res.body, { status: res.status, headers });
        headers.delete("content-length");
        headers.delete("content-encoding");
        return new Response(splitThought(await res.text()), { status: res.status, headers });
      }
      const text = await res.text();
      const outcome = classify(res.status, text);
      tried.push(`${t.provider}/${t.model}#${idx}:${res.status}`);
      if (outcome) {
        await ledger.report(t, idx, outcome, describe(res.status, text));
        if (outcome === "model") break;
        continue;
      }
      // Not the key's fault. A model the provider doesn't serve moves down the chain;
      // anything else is the request's own problem and goes back as it came.
      if (res.status === 404) break;
      return new Response(text, {
        status: res.status,
        headers: { "content-type": "application/json" },
      });
    }
  }
  return error(
    429,
    `every free key is spent or cooling for '${String(body.model ?? "free")}' (tried ${tried.length ? tried.join(", ") : "none with room"})`,
    { "retry-after": "60" },
  );
}

/**
 * Gemma on Gemini writes its reasoning into the reply as `<thought>…</thought>` and won't
 * turn it off. Move it to `reasoning_content`, where OpenAI-style clients look for it.
 * Streams pass through untouched.
 */
export function splitThought(text: string): string {
  if (!text.includes("<thought>")) return text;
  try {
    const j = JSON.parse(text) as {
      choices?: { message?: { content?: unknown; reasoning_content?: string } }[];
    };
    for (const c of j.choices ?? []) {
      const m = c.message;
      if (typeof m?.content !== "string") continue;
      const hit = /^\s*<thought>([\s\S]*?)<\/thought>\s*/.exec(m.content);
      if (!hit) continue;
      m.reasoning_content = (hit[1] ?? "").trim();
      m.content = m.content.slice(hit[0].length);
    }
    return JSON.stringify(j);
  } catch {
    return text;
  }
}

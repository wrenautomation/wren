/**
 * One chat completion through the chain: a key with room from the ledger, the next key on
 * a 429 or a dead key, the next model when a model's keys are spent. Kept apart from the
 * Worker so tests run without the Cloudflare runtime.
 */
import { ALIASES, PROVIDERS, type Provider, resolve, type Target } from "./catalog.js";
import { classify, describe, type Outcome } from "./ledger.js";

export interface Env {
  /** "name sha256hex" per line, one per caller in guard.ts CALLERS. */
  GATEWAY_CALLERS?: string;
  GEMINI_KEYS?: string;
  OPENROUTER_KEYS?: string;
  COHERE_KEYS?: string;
}

/** Tries per model before moving down the chain. */
const TRIES_PER_MODEL = 6;
/** One upstream try: until the reply is read, or for a stream until its headers. */
export const ATTEMPT_MS = 20_000;
/** The whole request, every try included. */
export const DEADLINE_MS = 100_000;

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

/** The ledger as the Worker sees it: the Durable Object's stub, or a test double. */
export interface LedgerApi {
  acquire(t: Target): Promise<number | null> | number | null;
  report(t: Target, idx: number, outcome: Outcome, detail?: string): Promise<void> | void;
}

/** Which model answered (null: none did) and the reply's total tokens when it said. */
export type OnDone = (winner: Target | null, totalTokens: number | null) => Promise<void> | void;

export async function complete(
  body: Record<string, unknown>,
  env: Env,
  ledger: LedgerApi,
  fetcher: typeof fetch = fetch,
  onDone: OnDone = () => {},
): Promise<Response> {
  const chain = resolve(typeof body.model === "string" ? body.model : undefined);
  if (!chain)
    return error(
      400,
      `unknown model '${String(body.model)}': use an alias (${Object.keys(ALIASES).join(", ")}) or <provider>/<model>`,
    );
  const tried: string[] = [];
  const started = Date.now();
  models: for (const t of chain) {
    const keys = keysOf(env, t.provider);
    if (!keys.length) continue;
    for (let n = 0; n < TRIES_PER_MODEL; n++) {
      if (Date.now() - started > DEADLINE_MS) break models;
      const idx = await ledger.acquire(t);
      if (idx === null) break;
      const abort = new AbortController();
      const timer = setTimeout(() => abort.abort(), ATTEMPT_MS);
      let res: Response;
      let text: string | null = null;
      try {
        res = await fetcher(`${PROVIDERS[t.provider].baseURL}/chat/completions`, {
          method: "POST",
          headers: {
            authorization: `Bearer ${keys[idx]}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({ ...body, model: t.model }),
          signal: abort.signal,
        });
        if (!(res.ok && body.stream === true)) text = await res.text();
      } catch {
        // Too slow (or the connection dropped): the model's trouble, not the key's.
        tried.push(`${t.provider}/${t.model}#${idx}:timeout`);
        await ledger.report(t, idx, "model", `timeout after ${ATTEMPT_MS / 1000}s`);
        break;
      } finally {
        clearTimeout(timer);
      }
      if (res.ok) {
        await ledger.report(t, idx, "ok");
        const headers = new Headers(res.headers);
        headers.set("x-gateway-model", `${t.provider}/${t.model}`);
        headers.set("x-gateway-key", `${t.provider}#${idx}`);
        if (text === null) {
          await onDone(t, null);
          return new Response(res.body, { status: res.status, headers });
        }
        headers.delete("content-length");
        headers.delete("content-encoding");
        await onDone(t, totalTokens(text));
        return new Response(splitThought(text), { status: res.status, headers });
      }
      text ??= "";
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
      await onDone(null, null);
      return new Response(text, {
        status: res.status,
        headers: { "content-type": "application/json" },
      });
    }
  }
  await onDone(null, null);
  if (Date.now() - started > DEADLINE_MS)
    return error(
      504,
      `no model answered within ${DEADLINE_MS / 1000}s (tried ${tried.join(", ")})`,
    );
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

function totalTokens(text: string): number | null {
  try {
    const t = (JSON.parse(text) as { usage?: { total_tokens?: unknown } }).usage?.total_tokens;
    return typeof t === "number" ? t : null;
  } catch {
    return null;
  }
}

/** Gemini's own API, for what the OpenAI shape can't say: a YouTube URL to read, embeddings. */
export const NATIVE_BASE = "https://generativelanguage.googleapis.com/v1beta/models";
export const NATIVE_METHODS = ["generateContent", "embedContent", "batchEmbedContents"] as const;
export type NativeMethod = (typeof NATIVE_METHODS)[number];
/** A video read takes minutes: one try waits this long. */
export const NATIVE_ATTEMPT_MS = 240_000;

/**
 * `POST /v1beta/models/<model>:<method>` passed through to Gemini on a key with room: the same
 * ledger, the next key on a 429 or a dead key. One model, no chain: the caller named it.
 */
export async function native(
  model: string,
  method: NativeMethod,
  body: string,
  env: Env,
  ledger: LedgerApi,
  fetcher: typeof fetch = fetch,
): Promise<Response> {
  const t: Target = { provider: "gemini", model };
  const keys = keysOf(env, "gemini");
  const tried: string[] = [];
  for (let n = 0; n < TRIES_PER_MODEL; n++) {
    const idx = await ledger.acquire(t);
    if (idx === null) break;
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), NATIVE_ATTEMPT_MS);
    let res: Response;
    let text: string;
    try {
      res = await fetcher(`${NATIVE_BASE}/${model}:${method}`, {
        method: "POST",
        headers: { "x-goog-api-key": keys[idx] as string, "content-type": "application/json" },
        body,
        signal: abort.signal,
      });
      text = await res.text();
    } catch {
      tried.push(`#${idx}:timeout`);
      await ledger.report(t, idx, "model", `timeout after ${NATIVE_ATTEMPT_MS / 1000}s`);
      break;
    } finally {
      clearTimeout(timer);
    }
    if (res.ok) {
      await ledger.report(t, idx, "ok");
      return new Response(text, {
        status: 200,
        headers: { "content-type": "application/json", "x-gateway-key": `gemini#${idx}` },
      });
    }
    const outcome = classify(res.status, text);
    tried.push(`#${idx}:${res.status}`);
    if (outcome) {
      await ledger.report(t, idx, outcome, describe(res.status, text));
      if (outcome === "model") break;
      continue;
    }
    return new Response(text, {
      status: res.status,
      headers: { "content-type": "application/json" },
    });
  }
  return error(
    429,
    `every Gemini key is spent or cooling for '${model}' (tried ${tried.length ? tried.join(", ") : "none with room"})`,
    { "retry-after": "60" },
  );
}

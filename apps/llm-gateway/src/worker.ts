/**
 * llm.wrenautomation.com: one OpenAI-compatible endpoint over every free LLM key we hold.
 * `POST /v1/chat/completions` takes an alias ("free", "free-bulk", "cohere") or
 * "<provider>/<model>", asks the ledger for a key with room, and on a 429 or a dead key
 * moves to the next key, then the next model. `GET /v1/models` lists what it routes;
 * `GET /usage` shows each model's keys and each caller's use today; `POST /reset` (admin
 * callers) clears the key ledger after the keys change. Every route but /health takes a
 * caller's bearer token, and every request passes the caller's limits (guard.ts) first.
 * Lives on Cloudflare so it costs no memory on the box or the Mac.
 */
import { DurableObject } from "cloudflare:workers";
import { ALIASES, PROVIDERS, type Provider, resolve, type Target } from "./catalog.js";
import {
  type Admission,
  CALLERS,
  callerOf,
  GUARD_PREFIX,
  Guard,
  type GuardSaved,
  MAX_BODY_BYTES,
  sanitize,
} from "./guard.js";
import { Ledger, type Outcome, type Saved } from "./ledger.js";
import { complete, error, json, keyCounts, type Env as RouteEnv } from "./route.js";

export interface Env extends RouteEnv {
  LEDGER: DurableObjectNamespace<KeyLedger>;
}

/** The one ledger: callers' limits and every key's use, kept in its storage. */
export class KeyLedger extends DurableObject<Env> {
  private ledger = this.freshLedger();
  private readonly guard = new Guard((s) => {
    void this.ctx.storage.put(s.id, s);
  });

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    void ctx.blockConcurrencyWhile(async () => {
      for (const s of (await ctx.storage.list<Saved | GuardSaved>()).values()) {
        if (s.kind === "faucet" || s.kind === "day") this.guard.load(s);
        else this.ledger.load(s);
      }
    });
  }

  admit(caller: string, paidReserve: number): Admission {
    return this.guard.admit(caller, Date.now(), paidReserve);
  }

  settle(caller: string, delta: number): void {
    this.guard.settle(caller, Date.now(), delta);
  }

  acquire(t: Target): number | null {
    return this.ledger.acquire(t, keyCounts(this.env)[t.provider], Date.now());
  }

  report(t: Target, idx: number, outcome: Outcome, detail?: string): void {
    this.ledger.report(t, idx, outcome, Date.now(), detail);
  }

  /** Forget key state (an index may name a different key now); callers' caps stay. */
  async reset(): Promise<void> {
    const ids = [...(await this.ctx.storage.list()).keys()].filter(
      (k) => !k.startsWith(GUARD_PREFIX),
    );
    for (let i = 0; i < ids.length; i += 128) await this.ctx.storage.delete(ids.slice(i, i + 128));
    this.ledger = this.freshLedger();
  }

  private freshLedger(): Ledger {
    return new Ledger((s) => {
      void this.ctx.storage.put(s.id, s);
    });
  }

  usage() {
    const seen = new Set<string>();
    const targets: Target[] = [];
    for (const chain of Object.values(ALIASES))
      for (const t of chain)
        if (!seen.has(`${t.provider}/${t.model}`)) {
          seen.add(`${t.provider}/${t.model}`);
          targets.push(t);
        }
    for (const [p, spec] of Object.entries(PROVIDERS))
      for (const model of Object.keys(spec.models))
        if (!seen.has(`${p}/${model}`)) {
          seen.add(`${p}/${model}`);
          targets.push({ provider: p as Provider, model });
        }
    const now = Date.now();
    return {
      callers: this.guard.usage(now),
      models: this.ledger.usage(targets, keyCounts(this.env), now),
    };
  }
}

type Stub = DurableObjectStub<KeyLedger>;

async function chat(req: Request, env: Env, ledger: Stub, caller: string): Promise<Response> {
  if (Number(req.headers.get("content-length") ?? 0) > MAX_BODY_BYTES)
    return error(413, `body over ${MAX_BODY_BYTES} bytes`);
  const raw = await req.text();
  if (raw.length > MAX_BODY_BYTES) return error(413, `body over ${MAX_BODY_BYTES} bytes`);
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return error(400, "body is not JSON");
  }
  const clean = sanitize(parsed, raw.length);
  if ("error" in clean) return error(400, clean.error);
  const chain = resolve(typeof clean.body.model === "string" ? clean.body.model : undefined);
  if (!chain)
    return error(
      400,
      `unknown model '${String(clean.body.model)}': use an alias (${Object.keys(ALIASES).join(", ")}) or <provider>/<model>`,
    );
  const reserve = chain.some((t) => PROVIDERS[t.provider].paid) ? clean.reserve : 0;
  const admission = await ledger.admit(caller, reserve);
  if (!admission.ok) return error(429, admission.reason, admission.headers);
  const started = Date.now();
  let winner: Target | null = null;
  const res = await complete(clean.body, env, ledger, fetch, async (t, total) => {
    winner = t;
    const used = t && PROVIDERS[t.provider].paid ? (total ?? reserve) : 0;
    if (reserve) await ledger.settle(caller, used - reserve);
  });
  const w = winner as Target | null;
  console.log(
    JSON.stringify({
      caller,
      model: clean.body.model ?? "free",
      winner: w ? `${w.provider}/${w.model}` : null,
      status: res.status,
      ms: Date.now() - started,
      stream: clean.body.stream === true,
    }),
  );
  const headers = new Headers(res.headers);
  for (const [k, v] of Object.entries(admission.headers)) headers.set(k, v);
  return new Response(res.body, { status: res.status, headers });
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname === "/health") return new Response("ok");
    const caller = await callerOf(req.headers.get("authorization"), env.GATEWAY_CALLERS ?? "");
    if (!caller) return error(401, "bad or missing bearer token");
    const ledger = env.LEDGER.get(env.LEDGER.idFromName("all"));
    if (req.method === "POST" && url.pathname === "/v1/chat/completions")
      return chat(req, env, ledger, caller);
    if (req.method === "GET" && url.pathname === "/v1/models") {
      const ids = [
        ...Object.keys(ALIASES),
        ...Object.entries(PROVIDERS).flatMap(([p, s]) =>
          Object.keys(s.models).map((m) => `${p}/${m}`),
        ),
      ];
      return json(200, {
        object: "list",
        data: ids.map((id) => ({ id, object: "model", owned_by: "wren" })),
      });
    }
    if (req.method === "GET" && url.pathname === "/usage") return json(200, await ledger.usage());
    if (req.method === "POST" && url.pathname === "/reset") {
      if (!CALLERS[caller]?.admin) return error(403, `${caller} may not reset`);
      await ledger.reset();
      return json(200, { reset: true });
    }
    return error(404, "not found");
  },
} satisfies ExportedHandler<Env>;

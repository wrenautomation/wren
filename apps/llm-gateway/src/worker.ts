/**
 * llm.wrenautomation.com: one OpenAI-compatible endpoint over every free LLM key we hold.
 * `POST /v1/chat/completions` takes an alias ("free", "free-bulk") or "<provider>/<model>",
 * asks the ledger for a key with room, and on a 429 or a dead key moves to the next key,
 * then the next model. `GET /v1/models` lists what it routes; `GET /usage` shows each
 * model's keys (ready, cooling, spent for the day, dead) and recent errors; `POST /reset`
 * clears the ledger after the keys change. Bearer `GATEWAY_TOKEN` on all
 * of them. Lives on Cloudflare so it costs no memory on the box or the Mac.
 */
import { DurableObject } from "cloudflare:workers";
import { ALIASES, PROVIDERS, type Provider, type Target } from "./catalog.js";
import { Ledger, type Outcome, type Saved } from "./ledger.js";
import { authorized, complete, error, json, keyCounts, type Env as RouteEnv } from "./route.js";

export interface Env extends RouteEnv {
  LEDGER: DurableObjectNamespace<KeyLedger>;
}

/** The one ledger: every request's key choice and outcome, kept in its storage. */
export class KeyLedger extends DurableObject<Env> {
  private ledger = this.fresh();

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    void ctx.blockConcurrencyWhile(async () => {
      for (const s of (await ctx.storage.list<Saved>()).values()) this.ledger.load(s);
    });
  }

  acquire(t: Target): number | null {
    return this.ledger.acquire(t, keyCounts(this.env)[t.provider], Date.now());
  }

  report(t: Target, idx: number, outcome: Outcome, detail?: string): void {
    this.ledger.report(t, idx, outcome, Date.now(), detail);
  }

  /** Forget everything: after the keys change, an index names a different key. */
  async reset(): Promise<void> {
    await this.ctx.storage.deleteAll();
    this.ledger = this.fresh();
  }

  private fresh(): Ledger {
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
    return this.ledger.usage(targets, keyCounts(this.env), Date.now());
  }
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname === "/health") return new Response("ok");
    if (!authorized(req, env)) return error(401, "bad or missing bearer token");
    const ledger = env.LEDGER.get(env.LEDGER.idFromName("all"));
    if (req.method === "POST" && url.pathname === "/v1/chat/completions") {
      let body: Record<string, unknown>;
      try {
        body = (await req.json()) as Record<string, unknown>;
      } catch {
        return error(400, "body is not JSON");
      }
      return complete(body, env, ledger);
    }
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
      await ledger.reset();
      return json(200, { reset: true });
    }
    return error(404, "not found");
  },
} satisfies ExportedHandler<Env>;

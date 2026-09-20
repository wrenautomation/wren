/**
 * `Domain/{domain}`: one virtual object per sending domain, the whole
 * provision as its state. `provision` starts (or restarts after a reset),
 * `resume` continues after an answer or a fix, `approve`/`reject` answer
 * the open gate and resume, `status` reads, `reset` forgets.
 *
 * API effects are `ctx.run`; waits are `ctx.sleep`; the browser legs are
 * calls to autobrowse's `browser` service, registered with the same
 * Restate. Its terminal errors 460 (a person needed) and 461 (the flow
 * broke) become `NeedsHuman`, so the person sees the reason and the
 * artifacts on the open gate.
 */
import * as restate from "@restatedev/restate-sdk";
import type { InboxScheduler, SendScheduler } from "@wren/channel-email/restate";
import type { BrowserLegs, Deps, Loops } from "../deps.js";
import { type Gate, type GateAnswer, type Host, NeedsHuman } from "../host.js";
import { type Plan, parsePlan } from "../plan.js";
import { emptyState, provisionOnce, type RunState, type RunStatus, statusOf } from "../run.js";

export const DOMAIN_OBJECT = "Domain";
const PLAN = "plan";
const STATE = "state";
const BROWSER = { name: "browser" } as const;
/** autobrowse's codes: 460 = needs a person, 461 = the flow failed for good. */
const HUMAN_CODES: ReadonlySet<number> = new Set([460, 461]);

/** The `browser` service's handlers as autobrowse serves them; no import from that repo. */
type BrowserService = {
  buy: (ctx: restate.Context, input: { domain: string }) => Promise<{ priceText: string | null }>;
  dkimGenerate: (
    ctx: restate.Context,
    input: { domain: string },
  ) => Promise<{ name: string; value: string }>;
  dkimStart: (ctx: restate.Context, input: { domain: string }) => Promise<"started" | "already">;
  warmup: (ctx: restate.Context, input: { email: string }) => Promise<"enrolled" | "already">;
};

export interface DomainStatus {
  key: string;
  status: RunStatus;
  plan: Plan | null;
  state: RunState;
}

/** Everything but the two Restate-backed pieces (browser legs, loops), which each invocation builds from its context. */
export type DomainDeps = Omit<Deps, "browser" | "loops">;

/** A browser leg's terminal error carries `{reason, artifacts}` as JSON; anything else is its message. */
export function needsHumanFrom(err: unknown): NeedsHuman | null {
  if (!(err instanceof restate.TerminalError)) return null;
  const code = (err as { code?: number }).code;
  if (code === undefined || !HUMAN_CODES.has(code)) return null;
  try {
    const parsed = JSON.parse(err.message) as {
      reason?: string;
      artifacts?: Record<string, string>;
    };
    return new NeedsHuman(parsed.reason ?? err.message, parsed.artifacts ?? {});
  } catch {
    return new NeedsHuman(err.message);
  }
}

function browserFrom(ctx: restate.ObjectContext): BrowserLegs {
  const client = ctx.serviceClient<BrowserService>(BROWSER);
  const leg =
    <I, O>(call: (input: I) => Promise<O>) =>
    async (input: I): Promise<O> => {
      try {
        return await call(input);
      } catch (err) {
        throw needsHumanFrom(err) ?? err;
      }
    };
  return {
    buy: leg((i) => client.buy(i)),
    dkimGenerate: leg((i) => client.dkimGenerate(i)),
    dkimStart: leg((i) => client.dkimStart(i)),
    warmup: leg((i) => client.warmup(i)),
  };
}

function loopsFrom(ctx: restate.ObjectContext): Loops {
  return {
    async start(address) {
      const send = await ctx
        .objectClient<SendScheduler>({ name: "SendScheduler" }, address)
        .start();
      const inbox = await ctx
        .objectClient<InboxScheduler>({ name: "InboxScheduler" }, address)
        .start();
      return { send: send.running, inbox: inbox.running };
    },
  };
}

function hostFrom(ctx: restate.ObjectContext): Host {
  return {
    run: (name, fn) => ctx.run(name, fn),
    sleep: (ms) => ctx.sleep(ms),
    now: async () => new Date(await ctx.date.now()),
  };
}

export function makeDomain(deps: DomainDeps) {
  const load = async (ctx: restate.ObjectContext) => ({
    plan: await ctx.get<Plan>(PLAN),
    state: (await ctx.get<RunState>(STATE)) ?? emptyState(),
  });
  const status = async (ctx: restate.ObjectSharedContext | restate.ObjectContext) => {
    const state = (await ctx.get<RunState>(STATE)) ?? emptyState();
    return { key: ctx.key, status: statusOf(state), plan: await ctx.get<Plan>(PLAN), state };
  };

  /** One pass over the steps; the state is written back however the pass ends. */
  const pass = async (ctx: restate.ObjectContext, plan: Plan, state: RunState) => {
    const all: Deps = { ...deps, browser: browserFrom(ctx), loops: loopsFrom(ctx) };
    try {
      await provisionOnce(hostFrom(ctx), all, plan, state);
    } finally {
      ctx.set(STATE, state);
    }
    return status(ctx);
  };

  const answer = async (ctx: restate.ObjectContext, approved: boolean, note: string | null) => {
    const { plan, state } = await load(ctx);
    if (!plan) throw new restate.TerminalError(`Domain/${ctx.key} has no plan`, { errorCode: 404 });
    const gate = state.gate;
    if (!gate) throw new restate.TerminalError("no gate is open", { errorCode: 409 });
    const at = new Date(await ctx.date.now()).toISOString();
    const reply: GateAnswer = { approved, note, at };
    state.answers = { ...state.answers, [gate.name satisfies Gate]: reply };
    return pass(ctx, plan, state);
  };

  return restate.object({
    name: DOMAIN_OBJECT,
    handlers: {
      /** Start from the plan; an object with a plan already keeps its progress and resumes. */
      provision: async (ctx: restate.ObjectContext, raw: unknown): Promise<DomainStatus> => {
        const plan = parsePlan(raw);
        if (plan.domain !== ctx.key)
          throw new restate.TerminalError(
            `plan.domain ${plan.domain} must equal the object key ${ctx.key}`,
            { errorCode: 400 },
          );
        const { state } = await load(ctx);
        ctx.set(PLAN, plan);
        return pass(ctx, plan, state);
      },
      /** Continue after a fix by hand or a gate answered elsewhere. */
      resume: async (ctx: restate.ObjectContext): Promise<DomainStatus> => {
        const { plan, state } = await load(ctx);
        if (!plan)
          throw new restate.TerminalError(`Domain/${ctx.key} has no plan`, { errorCode: 404 });
        return pass(ctx, plan, state);
      },
      approve: (ctx: restate.ObjectContext, input?: { note?: string }) =>
        answer(ctx, true, input?.note ?? null),
      reject: (ctx: restate.ObjectContext, input?: { note?: string }) =>
        answer(ctx, false, input?.note ?? null),
      status: restate.handlers.object.shared(
        async (ctx: restate.ObjectSharedContext): Promise<DomainStatus> => status(ctx),
      ),
      /** Forget the run. The domain, zone, users stay as they are; a new provision finds them. */
      reset: async (ctx: restate.ObjectContext): Promise<DomainStatus> => {
        ctx.clear(STATE);
        ctx.clear(PLAN);
        return status(ctx);
      },
    },
  });
}

export type Domain = ReturnType<typeof makeDomain>;

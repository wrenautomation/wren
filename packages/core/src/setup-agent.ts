/**
 * `SetupAgent/run`: one done-for-you setup step, handed over by `setup.step` on its first round.
 * It calls autobrowse `do` in the account owner's autobrowse (`do` for Wren's, `do_<client>` for
 * a client's) and waits suspended, so a long goal holds no Lambda. A step with a `find` runs its
 * finder instead: a fixed read (a Place ID off Google Maps) whose answer becomes the account's
 * ref. Its answer goes back through `agentDone`: done moves the run on; anything else says why and
 * waits on Wren's team.
 */
import * as restate from "@restatedev/restate-sdk";
import type { Db } from "@wren/db";
import { z } from "zod";
import { DoFailed, restateDo } from "./content/do.js";
import type { Wake } from "./content/restate.js";
import { serviceHandler } from "./restate/form.js";
import { type AgentAnswer, type AgentJob, accountRow, agentDone, type Setup } from "./setup.js";
import type { AlertPart } from "./setup-alerts.js";
import type { AccountRow } from "./setup-schema.js";
import { spineEmit } from "./spine.js";

export const SETUP_AGENT = "SetupAgent";

/** `AgentJob`'s shape: the step queues it through the ingress, so the ingress checks it. */
const JOB = z.looseObject({
  accountId: z.number().int(),
  gen: z.number().int(),
  setup: z.string(),
  step: z.string(),
  owner: z.string(),
  request: z.looseObject({ goal: z.string(), owner: z.string().nullable().optional() }),
});

/**
 * A done-for-you step's fixed read, by name (`SetupStep.find`): the account's ref from now on, or
 * null with why not. Its calls go through `ctx`, so each is a journaled step.
 */
export type SetupFinder = (
  ctx: restate.Context,
  a: { account: FinderAccount },
) => Promise<{ ref: string | null; why: string }>;

/** What a finder reads of the account: plain fields, so the journal keeps them as they are. */
export type FinderAccount = Pick<AccountRow, "id" | "client" | "site" | "ref">;

/** A goal still unanswered after this is said to have failed; the run waits on Wren's team. */
export const SETUP_AGENT_TIMEOUT_MS = 2 * 3_600_000;

export function makeSetupAgent(deps: {
  main: Db;
  setups: readonly Setup[];
  wake?: Wake | undefined;
  timeoutMs?: number;
  /** Parts that need facts: a fact back resumes them. */
  parts?: readonly AlertPart[];
  /** Finders by name, for steps with a `find`. */
  finders?: Readonly<Record<string, SetupFinder>>;
}) {
  const byId = new Map(deps.setups.map((s) => [s.id, s]));
  return restate.service({
    name: SETUP_AGENT,
    handlers: {
      // It may buy: a step that does waits on the client's `buys_ok` before it is queued.
      run: serviceHandler(
        { input: JOB, effect: "spends" },
        async (ctx: restate.Context, job: AgentJob) => {
          const s = byId.get(job.setup);
          if (!s) throw new restate.TerminalError(`no setup ${job.setup}`, { errorCode: 400 });
          const find = s.steps.find((x) => x.id === job.step)?.find;
          let out: AgentAnswer;
          if (find) {
            const finder = deps.finders?.[find];
            const account = await ctx.run("account", async (): Promise<FinderAccount | null> => {
              const a = await accountRow(deps.main, job.accountId);
              return a && { id: a.id, client: a.client, site: a.site, ref: a.ref };
            });
            if (!finder) out = { done: false, why: `No finder ${find} here` };
            else if (!account) out = { done: false, why: "No such account" };
            else {
              const got = await finder(ctx, { account });
              out = got.ref
                ? { done: true, why: got.why, ref: got.ref }
                : { done: false, why: got.why };
            }
          } else {
            const run = restateDo(ctx, deps.wake, {
              owner: job.owner,
              timeoutMs: deps.timeoutMs ?? SETUP_AGENT_TIMEOUT_MS,
            });
            try {
              const r = await run(job.request);
              out = { done: r.status === "done", why: r.summary || r.status };
            } catch (err) {
              if (!(err instanceof DoFailed)) throw err;
              out = { done: false, why: err.message };
            }
          }
          const now = new Date(await ctx.date.now());
          const emit = await ctx.run("record", () =>
            agentDone(deps.main, s, job, out, now, deps.parts),
          );
          if (emit) spineEmit(ctx, emit);
          return out;
        },
      ),
    },
  });
}

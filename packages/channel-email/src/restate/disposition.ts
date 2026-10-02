/**
 * Reply disposition as a Virtual Object with one key: `classify` runs one
 * pass of `runDisposition` over every pending human reply. One key = one
 * pass at a time, so two inbox syncs finding replies in the same minute queue
 * rather than paying for the same event twice. Wren's replies are key
 * "fleet"; a client's are `<client>/replies`, in its own database.
 *
 * After the labels, Wren's own key proposes an answer to each warm one
 * (`runInvites`): a time on Wren's calendar and a drafted reply. `approve` and
 * `drop` are William's: only his approve books or sends. A client's replies
 * never get Wren's calendar.
 */
import * as restate from "@restatedev/restate-sdk";
import { recordedRun } from "@wren/core";
import type { Calendar } from "@wren/core/calendar";
import type { Notifier } from "@wren/core/notify";
import { errorText } from "@wren/core/restate";
import type { Db } from "@wren/db";
import type { LlmClient, Tracer } from "@wren/llm";
import { type DispositionStats, runDisposition } from "../inbox/disposition.js";
import {
  type ApproveOutcome,
  approveInvite,
  dropInvite,
  type InviteStats,
  runInvites,
} from "../inbox/invite.js";
import type { ReplyCopy, SendReplyOptions } from "../inbox/reply.js";

export const DISPOSITION_KEY = "fleet";
export const DISPOSITION_COMMAND = "outreach inbox classify";
export const INVITE_COMMAND = "outreach inbox invite";

export interface DispositionDeps {
  /** The database a key's replies are in. */
  dbOf: (key: string) => Db;
  llm: LlmClient;
  tracer?: Tracer | null;
  /** Named on the ledger row's argv, never the key. */
  tracing?: string;
  /** Proposes answers to the fleet's warm replies; absent, a warm reply waits for William. */
  invites?: {
    calendar: Calendar;
    notifier?: Notifier | null;
    /** Each niche's reply copy, for the drafts. */
    copies?: ReadonlyMap<string, ReplyCopy> | null;
    /** How an approved reply goes out; absent, approve refuses. */
    send?: Omit<SendReplyOptions, "now"> | null;
  } | null;
}

export interface ClassifyOutcome {
  stats: DispositionStats | null;
  error: string | null;
  invites?: { stats: InviteStats | null; error: string | null } | null;
  now: string;
}

const LAST = "last";

export function makeDisposition(deps: DispositionDeps) {
  return restate.object({
    name: "Disposition",
    handlers: {
      classify: async (ctx: restate.ObjectContext): Promise<ClassifyOutcome> => {
        const now = new Date(await ctx.date.now());
        const db = deps.dbOf(ctx.key);
        const result = await ctx.run("reply disposition", async () => {
          try {
            const { stats } = await recordedRun(
              db,
              {
                command: DISPOSITION_COMMAND,
                argv: { daemon: true, llm: deps.llm.name, tracing: deps.tracing ?? "none" },
                model: deps.llm.name,
              },
              (run) =>
                runDisposition(db, deps.llm, {
                  runId: run.id,
                  tracer: deps.tracer ?? null,
                  now,
                }),
            );
            return { stats, error: null };
          } catch (err) {
            return { stats: null, error: errorText(err) };
          }
        });
        const invites = deps.invites;
        const booked =
          invites && ctx.key === DISPOSITION_KEY
            ? await ctx.run("call invites", async () => {
                try {
                  const { stats } = await recordedRun(
                    db,
                    {
                      command: INVITE_COMMAND,
                      argv: { daemon: true, llm: deps.llm.name, calendar: invites.calendar.name },
                      model: deps.llm.name,
                    },
                    (run) =>
                      runInvites(db, deps.llm, {
                        calendar: invites.calendar,
                        notifier: invites.notifier ?? null,
                        copies: invites.copies ?? null,
                        runId: run.id,
                        tracer: deps.tracer ?? null,
                        now,
                      }),
                  );
                  return { stats, error: null };
                } catch (err) {
                  return { stats: null, error: errorText(err) };
                }
              })
            : null;
        const outcome: ClassifyOutcome = { ...result, invites: booked, now: now.toISOString() };
        ctx.set(LAST, outcome);
        return outcome;
      },

      /** William's yes on one invite: book its time if it has one, send the reply. */
      approve: async (
        ctx: restate.ObjectContext,
        req: { id: number; body?: string | null },
      ): Promise<ApproveOutcome> => {
        const invites = deps.invites;
        if (!invites?.send || ctx.key !== DISPOSITION_KEY) {
          throw new restate.TerminalError("replies are not wired on this worker");
        }
        const send = invites.send;
        const now = new Date(await ctx.date.now());
        // A retry after a crash finds the rows moved on (booking, booked, sent) and refuses.
        return ctx.run("approve invite", async () => {
          try {
            return await approveInvite(deps.dbOf(ctx.key), req.id, {
              calendar: invites.calendar,
              transport: send.transport,
              fleet: send.fleet,
              body: req.body ?? null,
              now,
            });
          } catch (err) {
            throw new restate.TerminalError(errorText(err));
          }
        });
      },

      /** William passes on one invite: nothing books, nothing sends. */
      drop: async (ctx: restate.ObjectContext, req: { id: number }): Promise<{ state: string }> => {
        const state = await ctx.run("drop invite", async () => {
          try {
            return await dropInvite(deps.dbOf(ctx.key), req.id);
          } catch (err) {
            throw new restate.TerminalError(errorText(err));
          }
        });
        return { state };
      },

      status: restate.handlers.object.shared(
        async (ctx: restate.ObjectSharedContext): Promise<ClassifyOutcome | null> =>
          (await ctx.get<ClassifyOutcome>(LAST)) ?? null,
      ),
    },
  });
}

export type Disposition = ReturnType<typeof makeDisposition>;

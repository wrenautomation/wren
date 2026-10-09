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
import {
  clientOfKey,
  errorText,
  exclusiveHandler,
  NO_INPUT,
  sharedHandler,
} from "@wren/core/restate";
import type { Db } from "@wren/db";
import type { LlmClient, Tracer } from "@wren/llm";
import { z } from "zod";
import { type DispositionStats, runDisposition } from "../inbox/disposition.js";
import {
  type ApproveOutcome,
  approveInvite,
  dropInvite,
  followUpByHand,
  type InviteStats,
  replyByHand,
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
  invites?: Invites | null;
  /**
   * A client's (`<client>/replies`): its invites while it has email replies, else null.
   * Read inside the step; absent, a client's replies are labelled and nothing more.
   */
  clientInvites?: ((client: string) => Promise<Invites | null>) | null;
  /**
   * A client's model for one invocation: its own key or Wren's, metered on its share
   * (designs/2026-10-07-vendor-keys.md). Absent, a client's replies run on `llm`.
   */
  clientLlm?: ((client: string, part: string) => LlmClient) | null;
}

export interface Invites {
  calendar: Calendar;
  notifier?: Notifier | null;
  /** Each niche's reply copy, for the drafts. */
  copies?: ReadonlyMap<string, ReplyCopy> | null;
  /** How an approved reply goes out; absent, approve refuses. */
  send?: Omit<SendReplyOptions, "now"> | null;
  /** Only these niches' replies get answers (a client's sequences, not its other mail); null = all. */
  niches?: readonly string[] | null;
}

export interface ClassifyOutcome {
  stats: DispositionStats | null;
  error: string | null;
  invites?: { stats: InviteStats | null; error: string | null } | null;
  now: string;
}

const LAST = "last";

const INVITE = z.looseObject({ id: z.number().describe("The invite's id") });
const BODY = z.string().nullish().describe("The reply as edited; empty sends the draft as written");

export function makeDisposition(deps: DispositionDeps) {
  const wired = (key: string) =>
    key === DISPOSITION_KEY
      ? Boolean(deps.invites)
      : Boolean(clientOfKey(key) && deps.clientInvites);
  const invitesFor = async (key: string): Promise<Invites | null> => {
    if (key === DISPOSITION_KEY) return deps.invites ?? null;
    const owner = clientOfKey(key);
    return owner && deps.clientInvites ? deps.clientInvites(owner.client) : null;
  };
  return restate.object({
    name: "Disposition",
    handlers: {
      /** Only InboxScheduler fires it, when a pass finds human replies. */
      classify: exclusiveHandler(
        { ingressPrivate: true },
        async (ctx: restate.ObjectContext): Promise<ClassifyOutcome> => {
          const now = new Date(await ctx.date.now());
          const db = deps.dbOf(ctx.key);
          const owner = clientOfKey(ctx.key)?.client ?? null;
          const llmFor = (part: string) =>
            owner && deps.clientLlm ? deps.clientLlm(owner, part) : deps.llm;
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
                  runDisposition(db, llmFor("email.disposition"), {
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
          const booked = wired(ctx.key)
            ? await ctx.run("call invites", async () => {
                const invites = await invitesFor(ctx.key);
                if (!invites) return null;
                try {
                  const { stats } = await recordedRun(
                    db,
                    {
                      command: INVITE_COMMAND,
                      argv: { daemon: true, llm: deps.llm.name, calendar: invites.calendar.name },
                      model: deps.llm.name,
                    },
                    (run) =>
                      runInvites(db, llmFor("email.invites"), {
                        calendar: invites.calendar,
                        notifier: invites.notifier ?? null,
                        copies: invites.copies ?? null,
                        niches: invites.niches ?? null,
                        client: clientOfKey(ctx.key)?.client ?? null,
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
      ),

      /** William's yes on one invite: book its time if it has one, send the reply. */
      approve: exclusiveHandler(
        { input: INVITE.extend({ body: BODY }), effect: "sends" },
        async (
          ctx: restate.ObjectContext,
          req: { id: number; body?: string | null },
        ): Promise<ApproveOutcome> => {
          if (!wired(ctx.key)) {
            throw new restate.TerminalError("replies are not wired on this worker");
          }
          const now = new Date(await ctx.date.now());
          // A retry after a crash finds the rows moved on (booking, booked, sent) and refuses.
          return ctx.run("approve invite", async () => {
            const invites = await invitesFor(ctx.key);
            const send = invites?.send;
            if (!invites || !send)
              throw new restate.TerminalError("replies are not on for this key");
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
      ),

      /**
       * The Inbox's reply to an email with no call invite: his words, sent in that thread. A
       * suppressed address is refused (designs/2026-10-07-inbox-reply.md).
       */
      reply: exclusiveHandler(
        {
          input: z.looseObject({
            threadEventId: z.number().describe("The email reply's id"),
            body: z.string().describe("The words to send"),
          }),
          effect: "sends",
        },
        async (
          ctx: restate.ObjectContext,
          req: { threadEventId: number; body: string },
        ): Promise<{ ok: boolean; reason: string | null }> => {
          if (!wired(ctx.key)) {
            throw new restate.TerminalError("replies are not wired on this worker");
          }
          const now = new Date(await ctx.date.now());
          return ctx.run("reply by hand", async () => {
            const invites = await invitesFor(ctx.key);
            const send = invites?.send;
            if (!send) throw new restate.TerminalError("replies are not on for this key");
            const owner = ctx.key === DISPOSITION_KEY ? null : clientOfKey(ctx.key);
            try {
              const out = await replyByHand(deps.dbOf(ctx.key), req.threadEventId, {
                transport: send.transport,
                fleet: send.fleet,
                body: req.body,
                now,
                shared: owner ? { main: deps.dbOf(DISPOSITION_KEY), client: owner.client } : null,
              });
              return out.ok ? { ok: true, reason: null } : { ok: false, reason: out.reason };
            } catch (err) {
              throw new restate.TerminalError(errorText(err));
            }
          });
        },
      ),

      /**
       * Our next email in a thread they never answered: a Follow-up's draft once approved, or
       * words typed in the Inbox (`followUpByHand`).
       */
      followUp: exclusiveHandler(
        {
          input: z.looseObject({
            enrollmentId: z.number().describe("The email thread's id"),
            body: z.string().describe("The words to send"),
          }),
          effect: "sends",
        },
        async (
          ctx: restate.ObjectContext,
          req: { enrollmentId: number; body: string },
        ): Promise<{ ok: boolean; reason: string | null }> => {
          if (!wired(ctx.key)) {
            throw new restate.TerminalError("follow-ups are not wired on this worker");
          }
          const now = new Date(await ctx.date.now());
          return ctx.run("follow up by hand", async () => {
            const send = (await invitesFor(ctx.key))?.send;
            if (!send) throw new restate.TerminalError("follow-ups are not on for this key");
            const owner = ctx.key === DISPOSITION_KEY ? null : clientOfKey(ctx.key);
            try {
              const out = await followUpByHand(deps.dbOf(ctx.key), req.enrollmentId, {
                transport: send.transport,
                fleet: send.fleet,
                body: req.body,
                now,
                shared: owner ? { main: deps.dbOf(DISPOSITION_KEY), client: owner.client } : null,
              });
              return out.ok ? { ok: true, reason: null } : { ok: false, reason: out.reason };
            } catch (err) {
              throw new restate.TerminalError(errorText(err));
            }
          });
        },
      ),

      /** William passes on one invite: nothing books, nothing sends. */
      drop: exclusiveHandler(
        { input: INVITE },
        async (ctx: restate.ObjectContext, req: { id: number }): Promise<{ state: string }> => {
          const state = await ctx.run("drop invite", async () => {
            try {
              return await dropInvite(deps.dbOf(ctx.key), req.id);
            } catch (err) {
              throw new restate.TerminalError(errorText(err));
            }
          });
          return { state };
        },
      ),

      status: sharedHandler(
        { input: NO_INPUT },
        async (ctx: restate.ObjectSharedContext): Promise<ClassifyOutcome | null> =>
          (await ctx.get<ClassifyOutcome>(LAST)) ?? null,
      ),
    },
  });
}

export type Disposition = ReturnType<typeof makeDisposition>;

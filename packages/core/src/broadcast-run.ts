/**
 * `Broadcast` (designs/2026-10-14-customerio-audit.md, B6): one broadcast's sending, keyed by its
 * id (`<id>` for Wren's, `<client>/<id>` for a client's). `schedule` sets its next run; `run`
 * starts it on its time (the segment read into recipients) and then sends the people due, a
 * batch per run, waking itself for the next batch or the next person's time. A held person comes
 * due when their cap lifts. Each person is one journaled step, so a retry never sends twice.
 *
 * Only the newest `schedule` counts: each bumps a generation, and a run from an older one ends.
 * All the logic is in `./broadcasts.ts`.
 */
import * as restate from "@restatedev/restate-sdk";
import type { Db } from "@wren/db";
import { z } from "zod";
import {
  broadcastById,
  dueRecipients,
  EMAIL_BATCH,
  EMAIL_DAILY,
  EMAIL_PAUSE_MS,
  emailsToday,
  isUnset,
  type MailOf,
  nextOrFinish,
  type Outcome,
  sendRecipient,
  startBroadcast,
  startOf,
  TEXT_BATCH,
} from "./broadcasts.js";
import { exclusiveHandler, NO_INPUT, sharedHandler } from "./restate/form.js";
import { clientKey, clientOfKey } from "./restate/keys.js";

export const BROADCAST = { name: "Broadcast" } as const;
const GEN = "gen";
const LAST = "last";
/** The least wait between two runs. */
const MIN_MS = 1000;
/** When the day's email ceiling is reached, the next look. */
const CEILING_MS = 3_600_000;

interface BroadcastDeps {
  main: Db;
  clientDb(id: string): Db;
  /** How a workspace's email broadcasts leave, or why they can't yet. */
  mail: MailOf;
}

/** A broadcast's key: Wren's is its id. */
export const broadcastKey = (client: string | null, id: number) =>
  client ? clientKey(client, String(id)) : String(id);

type Self = {
  run: (ctx: restate.ObjectContext, input: { gen: number }) => Promise<unknown>;
};

const SCHEDULE = z.looseObject({
  at: z.string().describe("When to run, ISO; now or earlier runs at once"),
});
const RUN = z.looseObject({ gen: z.number().int() });

interface RunStats {
  started?: number;
  sent: number;
  queued: number;
  held: number;
  skipped: number;
  failed: number;
  next: string | null;
  note?: string;
}

export function makeBroadcast(d: BroadcastDeps) {
  const where = (key: string): { db: Db; client: string | null; id: number } | null => {
    const c = clientOfKey(key);
    const id = Number(c ? c.unit : key);
    if (!Number.isSafeInteger(id) || id < 1) return null;
    return { db: c ? d.clientDb(c.client) : d.main, client: c?.client ?? null, id };
  };
  const later = (ctx: restate.ObjectContext, gen: number, ms: number) =>
    ctx
      .objectSendClient<Self>(BROADCAST, ctx.key)
      .run({ gen }, restate.rpc.sendOpts({ delay: Math.max(MIN_MS, ms) }));

  return restate.object({
    name: BROADCAST.name,
    handlers: {
      /** Its next run at `at`; any earlier schedule is dropped. Approve and Restore call it. */
      schedule: exclusiveHandler(
        { input: SCHEDULE, ingressPrivate: true },
        async (ctx: restate.ObjectContext, input: { at: string }) => {
          const gen = ((await ctx.get<number>(GEN)) ?? 0) + 1;
          ctx.set(GEN, gen);
          const now = await ctx.date.now();
          const at = Date.parse(input.at);
          later(ctx, gen, Number.isNaN(at) ? 0 : at - now);
          return { gen, at: input.at };
        },
      ),
      /** Start it if its time came, then a batch of the people due; wakes itself for more. */
      run: exclusiveHandler(
        { input: RUN, ingressPrivate: true },
        async (ctx: restate.ObjectContext, input: { gen: number }) => {
          if (input.gen !== ((await ctx.get<number>(GEN)) ?? 0)) return { skipped: "superseded" };
          const w = where(ctx.key);
          if (!w) return { skipped: "no such broadcast" };
          const now = new Date(await ctx.date.now());
          const b = await ctx.run("read", async () => {
            const got = await broadcastById(w.db, w.id);
            return got
              ? {
                  state: got.state,
                  channel: got.channel,
                  start: startOf(got, now).toISOString(),
                }
              : null;
          });
          if (!b) return { skipped: "no such broadcast" };
          const stats: RunStats = {
            sent: 0,
            queued: 0,
            held: 0,
            skipped: 0,
            failed: 0,
            next: null,
          };
          if (b.state === "scheduled") {
            const start = Date.parse(b.start);
            if (start > now.getTime()) {
              later(ctx, input.gen, start - now.getTime());
              return { waiting: b.start };
            }
            stats.started = await ctx.run("start", () => startBroadcast(w.db, w.id, now));
          } else if (b.state !== "sending") {
            return { skipped: b.state };
          }
          let batch = b.channel === "email" ? EMAIL_BATCH : TEXT_BATCH;
          if (b.channel === "email") {
            const today = await ctx.run("today", () => emailsToday(w.db, now));
            const daily = await ctx.run("daily", async () => {
              const m = await d.mail(w.client, w.db);
              return isUnset(m) ? EMAIL_DAILY : m.daily;
            });
            batch = Math.max(0, Math.min(batch, daily - today));
          }
          const due = batch
            ? await ctx.run("due", () => dueRecipients(w.db, w.id, now, batch))
            : [];
          for (const id of due) {
            const out: Outcome = await ctx.run(`to ${id}`, async () =>
              sendRecipient(w.db, id, {
                mail:
                  b.channel === "email" ? await d.mail(w.client, w.db) : { unset: "texts only" },
                now,
              }),
            );
            if (out.state !== "gone") stats[out.state] += 1;
          }
          const next = await ctx.run(
            "next",
            async () => ((await nextOrFinish(w.db, w.id, now)) ?? null)?.toISOString() ?? null,
          );
          stats.next = next;
          if (next) {
            const full = due.length > 0 && due.length === batch;
            const wait = !batch
              ? CEILING_MS
              : full
                ? b.channel === "email"
                  ? EMAIL_PAUSE_MS
                  : MIN_MS
                : Date.parse(next) - now.getTime();
            if (!batch) stats.note = "Today's email ceiling reached; the rest go tomorrow";
            later(ctx, input.gen, wait);
          }
          ctx.set(LAST, { at: now.toISOString(), ...stats });
          return stats;
        },
      ),
      status: sharedHandler({ input: NO_INPUT }, async (ctx: restate.ObjectSharedContext) => ({
        key: ctx.key,
        gen: (await ctx.get<number>(GEN)) ?? 0,
        last: (await ctx.get(LAST)) ?? null,
      })),
    },
  });
}

export type BroadcastObject = ReturnType<typeof makeBroadcast>;

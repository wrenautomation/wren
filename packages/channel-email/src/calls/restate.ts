/**
 * The brief on the spine and before the call (designs/2026-10-07-close-brief-outcome.md). A booked
 * call enters `close` at `in.calls`; the `calls.brief` step builds and keeps its brief, then asks
 * `CallBriefs/send` to run `leadMinutes` before the start. That send rebuilds it and pings the
 * team's channel with a link, never the lead's words. A moved or cancelled call's old send skips.
 */
import * as restate from "@restatedev/restate-sdk";
import type { MeetingOutcome } from "@wren/core/calls";
import { aboutOf } from "@wren/core/logic";
import type { Notifier } from "@wren/core/notify";
import { serviceHandler } from "@wren/core/restate";
import { type Fired, type SpineEvent, type Step, spineEmit } from "@wren/core/spine";
import { atomic, type Db, setAuditActor } from "@wren/db";
import type { LlmClient } from "@wren/llm";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { callBookings } from "../schema.js";
import { buildBrief, markSent, saveBrief } from "./brief.js";
import { callSubject, outcomeEmits, setCallOutcome } from "./outcome.js";
import type { BriefSettings } from "./settings.js";

/** A booked call as it enters `close`: one arrival per call and start, so a moved call is new. */
export const bookedCall = (id: number, start: Date | string | null): SpineEvent => {
  const at = start ? new Date(start).toISOString() : null;
  return {
    subject: `${callSubject(id)}${at ? `:${at}` : ""}`,
    kind: "call",
    data: { call: id, start: at },
  };
};

/** The `close` emit for a booking just written; none for a cancel. */
export const bookingEmit = (o: { id: number; state: string; start: Date | string | null }) =>
  o.state === "booked"
    ? { workflow: "close", from: "in.calls", events: [bookedCall(o.id, o.start)] }
    : null;

/**
 * A booking as a Booking trigger hears it: a booked or moved call as `close` takes it, a cancel
 * as its own arrival. Who booked rides along, for the steps after. It is about the call, the
 * email thread it came from and who booked, so a Wait until a booking holding any of them ends.
 */
export const bookingFired = (
  client: string | null,
  o: { id: number; state: "booked" | "cancelled"; enrollmentId?: number | null },
  b: {
    start: Date | string | null;
    email: string | null;
    name: string | null;
    offer: string | null;
  },
): Fired => {
  const call = bookedCall(o.id, b.start);
  const who = { email: b.email, name: b.name, offer: b.offer };
  const about = [
    aboutOf(call.subject),
    ...(o.enrollmentId != null ? [`email:${o.enrollmentId}`] : []),
    ...(b.email ? [b.email] : []),
  ];
  return {
    client,
    facts: { trigger: "trigger.booking", change: o.state },
    about,
    event:
      o.state === "booked"
        ? { ...call, data: { ...call.data, ...who, change: "booked" } }
        : {
            subject: `${callSubject(o.id)}:cancelled`,
            kind: "call",
            data: { ...call.data, ...who, change: "cancelled" },
          },
  };
};

/**
 * Mark calls' outcome as one person, in one transaction, then move them on the spine
 * (`outcomeEmits`). The answer's `done` are the call ids it changed.
 */
export async function markOutcome(
  ctx: restate.Context,
  db: Db,
  client: string | null,
  ask: {
    ids: readonly number[];
    outcome: MeetingOutcome | null;
    reason?: string | null;
    by: string;
  },
): Promise<{ changed: number; done: number[] }> {
  const now = new Date(await ctx.date.now());
  const marked = await ctx.run(`outcome ${ask.outcome ?? "clear"}`, () =>
    atomic(db, async (tx) => {
      await setAuditActor(tx, ask.by);
      return setCallOutcome(tx, { ...ask, now });
    }),
  );
  for (const e of outcomeEmits(marked)) spineEmit(ctx, { client, ...e });
  return { changed: marked.length, done: marked.map((m) => m.id) };
}

export interface BriefDeps {
  /** Wren's database, or the client's. */
  dbFor(client: string | null): Db;
  /** The part's settings for this client (Wren's block when null). */
  settingsFor(client: string | null): Promise<BriefSettings>;
  /** The worker's model, through the gateway; null for code alone. */
  llm: LlmClient | null;
  /** A client's model: its own key or Wren's, metered on its share. Unset: `llm`. */
  llmFor?: ((client: string) => LlmClient) | null;
}

/** The model a brief's questions run on: the client's own, else Wren's; null when off. */
const modelOf = (deps: BriefDeps, client: string | null, on: boolean) =>
  !on || !deps.llm ? null : client && deps.llmFor ? deps.llmFor(client) : deps.llm;

export interface SendAsk {
  client: string | null;
  id: number;
  /** The call time the send was queued for. */
  start: string;
}

/**
 * `calls.brief` on the spine: build and keep the brief, then queue its send before the call.
 * `queue` is a delayed one-way call (the worker's ingress); it runs inside the step's `ctx.run`.
 */
export const briefStep =
  (
    deps: BriefDeps & {
      queue(ask: SendAsk, delayMs: number, key: string): Promise<void>;
      now?: () => Date;
    },
  ): Step =>
  async (_port, e, at) => {
    const id = Number(e.data.call);
    if (!Number.isSafeInteger(id) || id <= 0) throw new Error(`${e.subject} has no call`);
    const db = deps.dbFor(at.client);
    const settings = await deps.settingsFor(at.client);
    const now = deps.now?.() ?? new Date();
    const brief = await buildBrief(db, id, {
      now,
      llm: modelOf(deps, at.client, settings.questions),
    });
    if (!brief) return [];
    await saveBrief(db, brief);
    const start = brief.call.start;
    if (start && settings.ping) {
      const due = new Date(start).getTime() - settings.leadMinutes * 60_000;
      if (new Date(start).getTime() > now.getTime())
        await deps.queue(
          { client: at.client, id, start },
          Math.max(0, due - now.getTime()),
          `brief:${at.client ?? "wren"}:${id}:${start}`,
        );
    }
    return [
      { port: "ready", event: { subject: e.subject, kind: "call", data: { call: id, start } } },
    ];
  };

export interface CallBriefsDeps extends BriefDeps {
  /** The team's channel for this client (named for it); null sends no ping. */
  notifierFor(client: string | null): Notifier | null;
  /** The portal's origin, for the link; null leaves it out. */
  portal: string | null;
}

const BUILD = z.object({
  client: z.string().nullish().describe("The client; none for Wren's own"),
  id: z.number().int().positive().describe("The call, as call_bookings keys it"),
});
const SEND = BUILD.extend({
  start: z.string().describe("The call time the send was queued for"),
});

/** The call's page: Wren's Inbox, or the client's Calls app. */
export const briefPath = (client: string | null, id: number) =>
  client ? `/calls/calls/${id}` : `/inbox/calls/${id}`;

export function makeCallBriefs(deps: CallBriefsDeps) {
  /** Build the brief again now and keep it; null when the call is gone. */
  const rebuild = async (ctx: restate.Context, client: string | null, id: number) => {
    const db = deps.dbFor(client);
    const settings = await ctx.run("settings", () => deps.settingsFor(client));
    const now = new Date(await ctx.date.now());
    const built = await ctx.run(
      "brief",
      async () => {
        const b = await buildBrief(db, id, {
          now,
          llm: modelOf(deps, client, settings.questions),
        });
        if (b) await saveBrief(db, b);
        return b ? { lines: b.facts.length + b.signals.length + b.thread.length } : null;
      },
      { maxRetryAttempts: 3 },
    );
    return { db, settings, now, built };
  };
  const idOf = (req: { id?: unknown } | null) => {
    const id = Number(req?.id);
    if (!Number.isSafeInteger(id) || id <= 0) throw new restate.TerminalError("no call");
    return id;
  };
  return restate.service({
    name: "CallBriefs",
    handlers: {
      /** Rebuild on a person's ask (the call page's Rebuild, through EmailConsole); never pings. */
      build: serviceHandler(
        { input: BUILD, ingressPrivate: true },
        async (ctx: restate.Context, req: { client?: string | null; id: number }) => {
          const { built } = await rebuild(ctx, req.client ?? null, idOf(req));
          return { built: built !== null };
        },
      ),
      /** Before the call: rebuild and ping, if it's still booked for that time. */
      send: serviceHandler({ input: SEND }, async (ctx: restate.Context, req: SendAsk) => {
        const id = idOf(req);
        const client = req.client ?? null;
        const call = await ctx.run("call", async () => {
          const [c] = await deps
            .dbFor(client)
            .select({ state: callBookings.state, start: callBookings.start })
            .from(callBookings)
            .where(eq(callBookings.id, id));
          return c ? { state: c.state, start: c.start?.toISOString() ?? null } : null;
        });
        if (!call?.start || call.state !== "booked" || call.start !== req.start)
          return {
            sent: false,
            why: !call ? "gone" : call.state !== "booked" ? "cancelled" : "moved",
          };
        const { db, settings, now, built } = await rebuild(ctx, client, id);
        if (!built) return { sent: false, why: "gone" };
        const notifier = settings.ping ? deps.notifierFor(client) : null;
        if (notifier) {
          const mins = Math.max(
            0,
            Math.round((new Date(call.start).getTime() - now.getTime()) / 60_000),
          );
          const link = deps.portal
            ? `${deps.portal.replace(/\/+$/, "")}${briefPath(client, id)}`
            : null;
          await ctx.run("ping", () =>
            notifier.notify(
              `Call in ${mins} min: brief ready`,
              `${built.lines} cited lines.${link ? ` ${link}` : ""}`,
              "action",
            ),
          );
        }
        await ctx.run("sent", () => markSent(db, id, now));
        return { sent: notifier !== null };
      }),
    },
  });
}

export type CallBriefs = ReturnType<typeof makeCallBriefs>;

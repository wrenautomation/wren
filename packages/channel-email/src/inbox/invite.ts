/**
 * Speed to lead, with William's yes: a warm reply gets a proposal minutes after
 * it lands, and only his approve books the call or sends a word.
 *
 *     warm reply ─┬─ times offered ─→ read (LLM) ─→ ground ─┬─ proposed: the time + a drafted reply
 *                 │                                         └─ needs_you: their words, no draft
 *                 └─ no times (demo arm) ─────────────────────→ proposed: a drafted reply
 *     William ─→ approve: book (if a time) + send the reply in the thread (his words or the draft)
 *             └→ drop: nothing goes out
 *
 * Replies are unpredictable ("this time works better", "skip the demo, just
 * call me"), so code never answers one alone (William, 10-02). Every ping
 * carries their words, so he sees what code could not.
 *
 * `read` is the one paid step; `ground` is deterministic. It holds the
 * reading to the reply's own words (a verbatim quote), to an offered time
 * when the reply took one, and to a time the calendar has open right now.
 * Approve reads the calendar again: a slot taken since is his to answer.
 *
 * Only fresh replies (FRESH_MS) are read, so turning this on never proposes
 * last month's yes. One `call_invites` row per reply; `booking` is written
 * before the calendar is called, so a crash between the two is never retried
 * and nobody is booked twice.
 */
import { companies, people } from "@wren/core";
import type { Calendar } from "@wren/core/calendar";
import type { Notifier } from "@wren/core/notify";
import { canonicalZone, wallClock, zonedInstant } from "@wren/core/time";
import type { Db } from "@wren/db";
import { completeAndParse, type Envelope, type LlmClient, LlmError, type Tracer } from "@wren/llm";
import { and, desc, eq, gte, inArray, isNotNull, isNull } from "drizzle-orm";
import { z } from "zod";
import {
  type CallInviteState,
  callInvites,
  type Enrollment,
  enrollments,
  messages,
  type ReplyDisposition,
  threadEvents,
} from "../schema.js";
import { FLEET_ZONE, sayTimes } from "../send/call-times.js";
import { transitionMessage } from "../state.js";
import {
  draftByHand,
  draftReply,
  type ReplyCopy,
  type ReplyOutcome,
  type SendReplyOptions,
  sendReply,
} from "./reply.js";

// v1 (2026-10-01): first prompt. Bump when the prompt or the grounding changes.
export const INVITE_VERSION = "v1";
/** `llm_calls.kind` for these calls. */
export const STAGE_NAME = "call_time";
export const MIN_CONFIDENCE = 0.6;
/** Replies older than this are William's to answer, never proposed by code. */
export const FRESH_MS = 48 * 3600 * 1000;
const WARM: readonly ReplyDisposition[] = ["interested", "meeting_booked"];
const MAX_TOKENS = 2000;
const SNIPPET = 400;

export const readingSchema = z.object({
  pick: z.string(),
  start: z.string().nullable().optional(),
  time_zone: z.string().nullable().optional(),
  evidence: z.string().nullable().optional(),
  confidence: z.number().nullable().optional(),
});
export type Reading = z.infer<typeof readingSchema>;

/** What the read sees: their words, the times we offered, their clock. */
export interface InviteState {
  reply: string;
  offered: readonly Date[];
  /** The lead's zone as we know it (their company's), else Wren's. */
  zone: string;
  now: Date;
}

export type Verdict = { ok: true; start: Date; timeZone: string } | { ok: false; reason: string };

const pad = (n: number) => String(n).padStart(2, "0");

/** `2026-10-06T11:00` in `zone`. */
export function localStamp(at: Date, zone: string): string {
  const w = wallClock(zone, at);
  return `${w.year}-${pad(w.month)}-${pad(w.day)}T${pad(w.hour)}:${pad(w.minute)}`;
}

export function buildPrompt(state: InviteState): string {
  const offered = state.offered.length
    ? state.offered
        .map((t) => `- ${sayTimes([t], state.zone)} = ${localStamp(t, state.zone)}`)
        .join("\n")
    : "- (none)";
  const w = wallClock(state.zone, state.now);
  const today = new Intl.DateTimeFormat("en-US", {
    timeZone: state.zone,
    weekday: "long",
  }).format(state.now);
  return `We emailed someone offering a call at these times (their clock, ${state.zone}):
${offered}

Today is ${today} ${w.year}-${pad(w.month)}-${pad(w.day)} in ${state.zone}.

Their reply:
${state.reply}

Did they accept a time for the call?
- "offered": they accept one of our times. start = that time's stamp exactly as listed.
- "own": they name a specific day AND hour of their own. start = that local time as YYYY-MM-DDTHH:mm.
  time_zone = the IANA zone they state (e.g. a reply saying "PT" means America/Los_Angeles), else null.
- "none": no specific time (a plain yes, "next week", a question, or a no).

Return ONLY a JSON object, no prose:
{"pick": "offered" | "own" | "none", "start": "<YYYY-MM-DDTHH:mm>" or null, "time_zone": "<IANA>" or null,
"evidence": "<a short quote copied verbatim from their reply>", "confidence": <0.0 to 1.0>}

Rules:
- evidence must be copied exactly from their reply, never paraphrased.
- If the day or the hour is unclear, answer "none".
`;
}

function fold(text: string): string {
  return text.toLowerCase().split(/\s+/).filter(Boolean).join(" ");
}

const STAMP = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;

/**
 * The gate: the quote is theirs, confidence clears the floor, the time parses
 * in a real zone, an "offered" pick is one we offered, and the calendar has
 * that start open now.
 */
export function ground(
  state: InviteState,
  reading: Reading | null,
  open: readonly Date[],
): Verdict {
  if (reading === null) return { ok: false, reason: "the time reading failed" };
  const pick = reading.pick.trim().toLowerCase();
  if (pick !== "offered" && pick !== "own") return { ok: false, reason: "no time in the reply" };
  const evidence = fold(reading.evidence ?? "");
  if (!evidence || !fold(state.reply).includes(evidence)) {
    return { ok: false, reason: "the quoted time is not in the reply" };
  }
  if ((reading.confidence ?? 0) < MIN_CONFIDENCE) {
    return {
      ok: false,
      reason: `confidence ${reading.confidence ?? "none"} below ${MIN_CONFIDENCE}`,
    };
  }
  const m = STAMP.exec((reading.start ?? "").trim());
  if (!m) return { ok: false, reason: `no readable start (${reading.start ?? "none"})` };
  const stated = pick === "own" && reading.time_zone ? canonicalZone(reading.time_zone) : null;
  const timeZone = stated ?? state.zone;
  const [, y, mo, d, h, mi] = m.map(Number) as number[];
  const start = zonedInstant(
    timeZone,
    y as number,
    mo as number,
    d as number,
    h as number,
    mi as number,
  );
  if (pick === "offered" && !state.offered.some((t) => t.getTime() === start.getTime())) {
    return { ok: false, reason: "the picked time is not one we offered" };
  }
  if (start <= state.now) return { ok: false, reason: "the time has passed" };
  if (!open.some((t) => t.getTime() === start.getTime())) {
    return { ok: false, reason: `${sayTimes([start], timeZone)} is not open on the calendar` };
  }
  return { ok: true, start, timeZone };
}

export interface InviteStats {
  selected: number;
  proposed: number;
  already_booked: number;
  needs_you: number;
  aborted: string | null;
}

export interface RunInvitesOptions {
  calendar: Calendar;
  notifier?: Notifier | null;
  /** Each niche's reply copy; a niche without one proposes the time with no draft. */
  copies?: ReadonlyMap<string, ReplyCopy> | null;
  runId?: string | null;
  tracer?: Tracer | null;
  now?: Date;
}

/** Warm replies the model labelled, fresh, with no invite row yet, oldest first. */
async function pending(db: Db, now: Date) {
  return db
    .select({ event: threadEvents, enrollment: enrollments })
    .from(threadEvents)
    .innerJoin(enrollments, eq(enrollments.id, threadEvents.enrollmentId))
    .leftJoin(callInvites, eq(callInvites.threadEventId, threadEvents.id))
    .where(
      and(
        eq(threadEvents.kind, "reply"),
        inArray(threadEvents.disposition, [...WARM]),
        // A label William set means he has the thread; code proposes only on its own reads.
        eq(threadEvents.dispositionSource, "llm"),
        gte(threadEvents.receivedAt, new Date(now.getTime() - FRESH_MS)),
        isNull(callInvites.id),
      ),
    )
    .orderBy(threadEvents.receivedAt, threadEvents.id);
}

/** The times the thread's latest sent email offered. */
async function offeredIn(db: Db, enrollmentId: number): Promise<Date[]> {
  const [row] = await db
    .select({ offered: messages.offeredTimes })
    .from(messages)
    .where(
      and(
        eq(messages.enrollmentId, enrollmentId),
        eq(messages.state, "sent"),
        isNotNull(messages.offeredTimes),
      ),
    )
    .orderBy(desc(messages.step))
    .limit(1);
  return (row?.offered ?? []).map((s) => new Date(s));
}

/** "Dana Reyes at Tulsa Nurse Partners", else their address. */
async function whoWrote(db: Db, enrollment: Enrollment, email: string) {
  const [company] = await db
    .select({ name: companies.name, timezone: companies.timezone })
    .from(companies)
    .where(eq(companies.id, enrollment.companyId));
  const [person] = enrollment.personId
    ? await db
        .select({ fullName: people.fullName })
        .from(people)
        .where(eq(people.id, enrollment.personId))
    : [];
  return {
    who: `${person?.fullName ?? email}${company?.name ? ` at ${company.name}` : ""}`,
    name: person?.fullName ?? null,
    zone: (company?.timezone && canonicalZone(company.timezone)) || FLEET_ZONE,
  };
}

/** The two commands a ping ends on. */
export const approveLine = (id: number, drafted: boolean) =>
  `${drafted ? `Send as drafted: wren email answers approve ${id}\nIn your words: ` : "Answer: "}` +
  `wren email answers approve ${id} --body "..."\nDrop: wren email answers drop ${id}`;

/**
 * One pass: every fresh warm reply gets one row, proposed or handed to William.
 * Nothing is booked and nothing is sent here. A provider failure stops the pass
 * with what it finished (the rest wait for the next pass); a calendar error on
 * one reply becomes that reply's ping.
 */
export async function runInvites(
  db: Db,
  llm: LlmClient,
  opts: RunInvitesOptions,
): Promise<InviteStats> {
  const now = opts.now ?? new Date();
  const rows = await pending(db, now);
  const stats: InviteStats = {
    selected: rows.length,
    proposed: 0,
    already_booked: 0,
    needs_you: 0,
    aborted: null,
  };
  const tell = async (title: string, body: string, level: "info" | "warning") => {
    await opts.notifier?.notify(title, body, level);
  };

  for (const { event, enrollment } of rows) {
    const email = event.fromAddress ?? enrollment.toEmail;
    const { who, zone } = await whoWrote(db, enrollment, email);
    const words = (event.bodyText || event.snippet || "").trim();
    const theyWrote = `They wrote:\n${words.slice(0, SNIPPET) || "(no text)"}`;
    const record = async (
      state: CallInviteState,
      fields: Partial<typeof callInvites.$inferInsert>,
    ) => {
      const [row] = await db
        .insert(callInvites)
        .values({
          threadEventId: event.id,
          enrollmentId: enrollment.id,
          state,
          email,
          runId: opts.runId ?? null,
          ...fields,
        })
        .onConflictDoNothing()
        .returning();
      return row ?? null;
    };
    const handOver = async (reason: string, reading: unknown) => {
      const row = await record("needs_you", { detail: reason, reading });
      if (!row) return;
      stats.needs_you += 1;
      await tell(
        `Warm reply: answer ${who} now`,
        `${reason}. ${theyWrote}\n\n${approveLine(row.id, false)}`,
        "warning",
      );
    };
    /** The row first (one per reply), then the draft hung on it, as one write. */
    const propose = async (
      fields: Partial<typeof callInvites.$inferInsert>,
      extra: Record<string, string>,
    ) => {
      const copy = opts.copies?.get(enrollment.niche) ?? null;
      return db.transaction(async (tx) => {
        const [row] = await tx
          .insert(callInvites)
          .values({
            threadEventId: event.id,
            enrollmentId: enrollment.id,
            state: "proposed",
            email,
            runId: opts.runId ?? null,
            ...fields,
          })
          .onConflictDoNothing()
          .returning();
        if (!row) return null;
        const draft = copy ? await draftReply(tx, copy, enrollment, event, extra) : null;
        if (draft) {
          await tx
            .update(callInvites)
            .set({ replyMessageId: draft.id })
            .where(eq(callInvites.id, row.id));
        }
        return { id: row.id, draft };
      });
    };

    try {
      if (await opts.calendar.booked(email)) {
        if (await record("already_booked", { detail: "they already hold a booking" })) {
          stats.already_booked += 1;
          await tell(`Call already booked: ${who}`, "They booked on cal.com themselves.", "info");
        }
        continue;
      }
    } catch (err) {
      await handOver(`the calendar could not say (${String(err)})`, null);
      continue;
    }

    const offered = await offeredIn(db, enrollment.id);
    if (offered.length === 0) {
      // No times on the thread (the demo arm): the answer is the arm's reply, if it has one.
      const made = await propose({ detail: "warm reply, no times offered" }, {});
      if (!made) continue;
      if (!made.draft) {
        await db
          .update(callInvites)
          .set({ state: "needs_you", detail: "no reply copy for this arm", updatedAt: new Date() })
          .where(eq(callInvites.id, made.id));
        stats.needs_you += 1;
        await tell(
          `Warm reply: answer ${who} now`,
          `No reply copy for this arm. ${theyWrote}\n\n${approveLine(made.id, false)}`,
          "warning",
        );
        continue;
      }
      stats.proposed += 1;
      await tell(
        `Warm reply from ${who}: approve the answer`,
        `${theyWrote}\n\nDraft:\n${made.draft.body}\n\n${approveLine(made.id, true)}`,
        "warning",
      );
      continue;
    }

    const state: InviteState = { reply: words, offered, zone, now };
    let reading: Reading | null = null;
    let envelope: Envelope | null = null;
    if (words) {
      try {
        const outcome = await completeAndParse(llm, buildPrompt(state), readingSchema, {
          maxTokens: MAX_TOKENS,
          runId: opts.runId ?? null,
          tracer: opts.tracer ?? null,
          name: STAGE_NAME,
          metadata: { thread_event_id: event.id },
        });
        reading = outcome.parsed;
        envelope = outcome.envelope();
      } catch (err) {
        if (!(err instanceof LlmError)) throw err;
        stats.aborted = err.message;
        break;
      }
    }
    const audit = { model: llm.name, prompt_version: INVITE_VERSION, reading, llm: envelope };

    let open: Date[] = [];
    const m = STAMP.exec((reading?.start ?? "").trim());
    if (m) {
      try {
        open = await openAround(opts.calendar, zone, Number(m[1]), Number(m[2]), Number(m[3]));
      } catch (err) {
        await handOver(`the calendar could not say (${String(err)})`, audit);
        continue;
      }
    }
    const verdict = ground(state, reading, open);
    if (!verdict.ok) {
      await handOver(verdict.reason, { ...audit, verdict });
      continue;
    }

    const said = sayTimes([verdict.start], verdict.timeZone);
    const made = await propose(
      { start: verdict.start, timeZone: verdict.timeZone, reading: { ...audit, verdict } },
      { "call.booked": said },
    );
    if (!made) continue;
    stats.proposed += 1;
    await tell(
      `Warm reply from ${who}: approve ${said}`,
      `${theyWrote}\n\nApprove books ${said} on cal.com (it emails the invite)` +
        (made.draft ? ` and sends:\n${made.draft.body}` : ". No reply drafted.") +
        `\n\n${approveLine(made.id, made.draft !== null)}`,
      "warning",
    );
  }
  return stats;
}

/** The calendar around the day named, read now: an offered time may since be taken. */
async function openAround(calendar: Calendar, zone: string, y: number, mo: number, d: number) {
  const day = zonedInstant(zone, y, mo, d);
  return calendar.open(
    new Date(day.getTime() - 24 * 3600 * 1000),
    new Date(day.getTime() + 48 * 3600 * 1000),
  );
}

export interface ApproveOptions extends SendReplyOptions {
  calendar: Calendar;
  /** William's own words in place of the draft; required when there is no draft. */
  body?: string | null;
}

export type ApproveOutcome =
  | { ok: true; state: CallInviteState; said: string | null; reply: ReplyOutcome | null }
  | { ok: false; state: CallInviteState; reason: string };

/**
 * William's yes on one invite: book the proposed time (read open again first),
 * then send the reply in the thread, his `body` or the draft. A slot taken since
 * the proposal books nothing, sends nothing, and turns the row to `needs_you`.
 * A `needs_you` row takes only his own words.
 */
export async function approveInvite(
  db: Db,
  id: number,
  opts: ApproveOptions,
): Promise<ApproveOutcome> {
  const [invite] = await db.select().from(callInvites).where(eq(callInvites.id, id));
  if (!invite) throw new Error(`no call invite ${id}`);
  const refuse = (reason: string): ApproveOutcome => ({ ok: false, state: invite.state, reason });
  if (invite.state !== "proposed" && invite.state !== "needs_you") {
    return refuse(`invite ${id} is ${invite.state}; only proposed or needs_you can be approved`);
  }
  const body = opts.body?.trim() || null;
  if (invite.replyMessageId === null && body === null) {
    return refuse(`invite ${id} has no draft; pass --body with your reply`);
  }
  if (invite.state === "needs_you" && body === null) {
    return refuse(`invite ${id} needs your words; pass --body`);
  }
  const [event] = await db
    .select()
    .from(threadEvents)
    .where(eq(threadEvents.id, invite.threadEventId));
  const [enrollment] = await db
    .select()
    .from(enrollments)
    .where(eq(enrollments.id, invite.enrollmentId));
  if (!event || !enrollment) throw new Error(`invite ${id} lost its reply or enrollment`);
  const now = opts.now ?? new Date();
  const set = async (fields: Partial<typeof callInvites.$inferInsert>) =>
    db
      .update(callInvites)
      .set({ ...fields, updatedAt: new Date() })
      .where(eq(callInvites.id, id));

  let state: CallInviteState = "sent";
  let said: string | null = null;
  if (invite.state === "proposed" && invite.start !== null) {
    const start = invite.start;
    const zone = invite.timeZone ?? FLEET_ZONE;
    said = sayTimes([start], zone);
    const w = wallClock(zone, start);
    let open: Date[];
    try {
      open = await openAround(opts.calendar, zone, w.year, w.month, w.day);
    } catch (err) {
      return refuse(`the calendar could not say (${String(err)}); try again`);
    }
    if (!open.some((t) => t.getTime() === start.getTime())) {
      const reason = `${said} is no longer open`;
      await set({ state: "needs_you", detail: reason });
      return { ok: false, state: "needs_you", reason: `${reason}; answer with --body` };
    }
    // Claimed before the calendar is called: a second approve finds `booking` and stops.
    const [claimed] = await db
      .update(callInvites)
      .set({ state: "booking", updatedAt: new Date() })
      .where(and(eq(callInvites.id, id), eq(callInvites.state, "proposed")))
      .returning();
    if (!claimed) return refuse(`invite ${id} was approved already`);
    const { name } = await whoWrote(db, enrollment, invite.email);
    try {
      const uid = await opts.calendar.book(
        start,
        {
          name: name ?? invite.email.split("@")[0] ?? invite.email,
          email: invite.email,
          timeZone: zone,
        },
        { enrollment: String(enrollment.id), reply: String(event.id) },
      );
      await set({ state: "booked", bookingUid: uid });
      state = "booked";
    } catch (err) {
      const reason = `booking failed: ${String(err)}`;
      await set({ state: "needs_you", detail: reason });
      return { ok: false, state: "needs_you", reason: `${reason}; answer with --body` };
    }
  }

  let messageId = invite.replyMessageId;
  if (body !== null && messageId === null) {
    messageId = (await draftByHand(db, enrollment, event, body)).id;
    await set({ replyMessageId: messageId });
  }
  const reply = await sendReply(db, messageId as number, event, enrollment, {
    transport: opts.transport,
    fleet: opts.fleet,
    now,
    body,
  });
  if (state === "sent") {
    await set(
      reply.sent
        ? { state: "sent" }
        : { state: "needs_you", detail: `reply not sent: ${reply.reason}` },
    );
    if (!reply.sent)
      return { ok: false, state: "needs_you", reason: `reply not sent: ${reply.reason}` };
  }
  return { ok: true, state, said, reply };
}

/** William passes: nothing books, nothing sends, the draft is rejected. */
export async function dropInvite(db: Db, id: number): Promise<CallInviteState> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .update(callInvites)
      .set({ state: "dropped", updatedAt: new Date() })
      .where(and(eq(callInvites.id, id), inArray(callInvites.state, ["proposed", "needs_you"])))
      .returning();
    if (!row) {
      const [now] = await tx
        .select({ state: callInvites.state })
        .from(callInvites)
        .where(eq(callInvites.id, id));
      throw new Error(now ? `invite ${id} is ${now.state}, not open` : `no call invite ${id}`);
    }
    if (row.replyMessageId !== null) {
      await tx
        .update(messages)
        .set({ state: transitionMessage("draft", "rejected") })
        .where(and(eq(messages.id, row.replyMessageId), eq(messages.state, "draft")));
    }
    return row.state;
  });
}

/** Open invites (proposed or needs_you), newest first, with their words and the draft. */
export async function openInvites(db: Db) {
  return db
    .select({
      id: callInvites.id,
      state: callInvites.state,
      email: callInvites.email,
      start: callInvites.start,
      timeZone: callInvites.timeZone,
      detail: callInvites.detail,
      createdAt: callInvites.createdAt,
      words: threadEvents.bodyText,
      snippet: threadEvents.snippet,
      draft: messages.body,
    })
    .from(callInvites)
    .innerJoin(threadEvents, eq(threadEvents.id, callInvites.threadEventId))
    .leftJoin(messages, eq(messages.id, callInvites.replyMessageId))
    .where(inArray(callInvites.state, ["proposed", "needs_you"]))
    .orderBy(desc(callInvites.createdAt));
}

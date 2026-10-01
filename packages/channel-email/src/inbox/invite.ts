/**
 * Speed to lead: a warm reply gets its call booked minutes after it lands.
 *
 *     warm reply ─→ read (LLM) ─→ ground ─┬─ book on the calendar (it emails the invite)
 *                                         └─ needs_you: William is pinged with their words
 *
 * The cold email offered two times (`{call.times}`, kept on the message). A
 * reply that takes one, or names its own day and hour, is booked on cal.com,
 * which sends the invite. Anything else (a yes with no time, a time that is
 * taken, a calendar error) pings William at once instead: a person answers
 * every reply the code can't close.
 *
 * `read` is the one paid step; `ground` is deterministic. It holds the
 * reading to the reply's own words (a verbatim quote), to an offered time
 * when the reply took one, and to a time the calendar has open right now.
 *
 * Only fresh replies (FRESH_MS) are read, so turning this on never books
 * last month's yes. One `call_invites` row per reply, written before the
 * calendar is called: a crash between the two leaves a `booking` row that is
 * never retried, so nobody is booked twice.
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
  enrollments,
  messages,
  type ReplyDisposition,
  threadEvents,
} from "../schema.js";
import { FLEET_ZONE, sayTimes } from "../send/call-times.js";

// v1 (2026-10-01): first prompt. Bump when the prompt or the grounding changes.
export const INVITE_VERSION = "v1";
/** `llm_calls.kind` for these calls. */
export const STAGE_NAME = "call_time";
export const MIN_CONFIDENCE = 0.6;
/** Replies older than this are William's to answer, never booked by code. */
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
  booked: number;
  already_booked: number;
  needs_you: number;
  aborted: string | null;
}

export interface RunInvitesOptions {
  calendar: Calendar;
  notifier?: Notifier | null;
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
        // A label William set means he has the thread; code books only its own reads.
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

/**
 * One pass: every fresh warm reply gets one row, booked or handed to William.
 * A provider failure stops the pass with what it finished (the rest wait for
 * the next pass); a calendar error on one reply becomes that reply's ping.
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
    booked: 0,
    already_booked: 0,
    needs_you: 0,
    aborted: null,
  };
  const tell = async (title: string, body: string, level: "info" | "warning") => {
    await opts.notifier?.notify(title, body, level);
  };

  for (const { event, enrollment } of rows) {
    const email = event.fromAddress ?? enrollment.toEmail;
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
    const who = `${person?.fullName ?? email}${company?.name ? ` at ${company.name}` : ""}`;
    const words = (event.bodyText || event.snippet || "").trim();
    const zone = (company?.timezone && canonicalZone(company.timezone)) || FLEET_ZONE;
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
      if (!(await record("needs_you", { detail: reason, reading }))) return;
      stats.needs_you += 1;
      await tell(
        `Warm reply: answer ${who} now`,
        `${reason}. They wrote:\n${words.slice(0, SNIPPET) || "(no text)"}`,
        "warning",
      );
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

    const state: InviteState = {
      reply: words,
      offered: await offeredIn(db, enrollment.id),
      zone,
      now,
    };
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
      // The calendar around the day they named, read now: an offered time may since be taken.
      const day = zonedInstant(zone, Number(m[1]), Number(m[2]), Number(m[3]));
      try {
        open = await opts.calendar.open(
          new Date(day.getTime() - 24 * 3600 * 1000),
          new Date(day.getTime() + 48 * 3600 * 1000),
        );
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

    const row = await record("booking", {
      start: verdict.start,
      timeZone: verdict.timeZone,
      reading: { ...audit, verdict },
    });
    if (!row) continue;
    const said = sayTimes([verdict.start], verdict.timeZone);
    try {
      const uid = await opts.calendar.book(
        verdict.start,
        {
          name: person?.fullName ?? email.split("@")[0] ?? email,
          email,
          timeZone: verdict.timeZone,
        },
        { enrollment: String(enrollment.id), reply: String(event.id) },
      );
      await db
        .update(callInvites)
        .set({ state: "booked", bookingUid: uid, updatedAt: new Date() })
        .where(eq(callInvites.id, row.id));
      stats.booked += 1;
      await tell(`Call booked: ${who}, ${said}`, "cal.com sent them the invite.", "info");
    } catch (err) {
      await db
        .update(callInvites)
        .set({
          state: "needs_you",
          detail: `booking failed: ${String(err)}`,
          updatedAt: new Date(),
        })
        .where(eq(callInvites.id, row.id));
      stats.needs_you += 1;
      await tell(
        `Warm reply: answer ${who} now`,
        `They picked ${said} but booking failed (${String(err)}). They wrote:\n${words.slice(0, SNIPPET)}`,
        "warning",
      );
    }
  }
  return stats;
}

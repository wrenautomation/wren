/**
 * Recorded calls (designs/2026-10-16-call-recording.md): what the Mac's desk asks for (the calls
 * coming up), and what `wren calls add` keeps once a recording is transcribed: its row, its notes
 * from the model, and one line on the person's timeline.
 */
import { type ElsewhereLine, noteElsewhere, type ProfileKey } from "@wren/core/profiles";
import type { Queryable } from "@wren/db";
import { completeAndParse, type LlmClient } from "@wren/llm";
import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import { callRecordings } from "../schema.js";

const rows = async <T>(db: Queryable, q: ReturnType<typeof sql>) =>
  (await db.execute(q)) as unknown as T[];

/** A booked call's length when the booking doesn't say (cal.com's): our calls are 30 minutes. */
export const DEFAULT_CALL_MIN = 30;

/** A booked call the desk arms for: start to end, and who, for the banner. */
export interface UpcomingCall {
  id: number;
  start: string;
  end: string;
  who: string;
}

/**
 * Booked calls that end after `now` and start within `aheadH` hours: the desk records each one
 * from 5 minutes before its start while a call window is open. Ours carry their end (the
 * calendar's mirror is `wren-<id>`); cal.com's take `DEFAULT_CALL_MIN`.
 */
export async function upcomingCalls(
  db: Queryable,
  now = new Date(),
  aheadH = 24,
): Promise<UpcomingCall[]> {
  const until = new Date(now.getTime() + aheadH * 3_600_000);
  const got = await rows<{ id: number; start: Date | string; end: Date | string; who: string }>(
    db,
    sql`
    select cb.id, cb.start,
      coalesce(b."end", cb.start + make_interval(mins => ${DEFAULT_CALL_MIN})) "end",
      coalesce(nullif(cb.name, ''), cb.email, 'a booked call')::text who
    from call_bookings cb
    left join calendar.bookings b on cb.uid = 'wren-' || b.id::text
    where cb.state = 'booked' and cb.start is not null and cb.start < ${until.toISOString()}::timestamptz
      and coalesce(b."end", cb.start + make_interval(mins => ${DEFAULT_CALL_MIN})) > ${now.toISOString()}::timestamptz
    order by cb.start`,
  );
  const iso = (v: Date | string) => new Date(v).toISOString();
  return got.map((r) => ({
    id: Number(r.id),
    start: iso(r.start),
    end: iso(r.end),
    who: String(r.who),
  }));
}

/**
 * The booked call a manual recording was: the one whose start is 15 minutes after to 60 minutes
 * before the recording's start, nearest first. Null when none is.
 */
export async function matchBooking(db: Queryable, startedAt: Date): Promise<number | null> {
  const [row] = await rows<{ id: number }>(
    db,
    sql`
    select id from call_bookings
    where state = 'booked' and start between ${new Date(startedAt.getTime() - 3_600_000).toISOString()}::timestamptz
      and ${new Date(startedAt.getTime() + 15 * 60_000).toISOString()}::timestamptz
    order by abs(extract(epoch from start - ${startedAt.toISOString()}::timestamptz)) limit 1`,
  );
  return row ? Number(row.id) : null;
}

/** One timed line of a transcript, in seconds from the recording's start. */
export interface Segment {
  start: number;
  end: number;
  text: string;
}

/** "83" as "1:23", "3723" as "1:02:03". */
export function clock(s: number): string {
  const t = Math.max(0, Math.floor(s));
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const ss = String(t % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}

/** The transcript as text: one timed line per segment, empty ones dropped. */
export const transcriptOf = (segments: readonly Segment[]) =>
  segments
    .filter((s) => s.text.trim())
    .map((s) => `[${clock(s.start)}] ${s.text.trim()}`)
    .join("\n");

/** What the model writes from a call: code checks the shape, every item a short line. */
export const CALL_NOTES = z.object({
  summary: z.string().min(1).max(1200),
  needs: z.array(z.string().min(1).max(300)).max(8),
  objections: z.array(z.string().min(1).max(300)).max(8),
  next: z.array(z.string().min(1).max(300)).max(8),
});
export type CallNotes = z.infer<typeof CALL_NOTES>;

const NOTES_SYSTEM = `You write notes on a recorded sales call for the person who took it.
The transcript is one mixed track: tell who spoke from what they say. Use only what was said.
Answer with JSON only: {"summary": string, "needs": string[], "objections": string[], "next": string[]}.
summary: 2 to 4 plain sentences on what the call was and where it ended.
needs: what they said they need or want, in their terms.
objections: worries, pushback, reasons to wait.
next: steps either side agreed to, with any date said.
Each item one short line. An empty list when the call had none.`;

/** The most of a transcript the model reads: about two hours of talk. */
const TRANSCRIPT_MAX = 120_000;

/** Notes on a call from its transcript; null when the model fails or answers out of shape. */
export async function writeNotes(
  llm: LlmClient,
  transcript: string,
  who: string | null,
): Promise<{ notes: CallNotes; model: string } | null> {
  if (!transcript.trim()) return null;
  const prompt = `${who ? `The call was with ${who}.\n\n` : ""}Transcript:\n${transcript.slice(0, TRANSCRIPT_MAX)}`;
  try {
    const out = await completeAndParse(llm, prompt, CALL_NOTES, {
      maxTokens: 1500,
      system: NOTES_SYSTEM,
      name: "call_notes",
    });
    return out.parsed ? { notes: out.parsed, model: llm.name.slice(0, 64) } : null;
  } catch (err) {
    console.error(`call notes: ${(err as Error).message}`);
    return null;
  }
}

/** A recording as `wren calls add` saves it. */
export interface NewRecording {
  callBookingId: number | null;
  fileKey: string;
  bytes: number;
  durationS: number;
  startedAt: Date;
  endedAt: Date;
  segments: Segment[];
  notes: CallNotes | null;
  model: string | null;
  by: "desk" | "manual";
}

/** Its line on the person's timeline: the summary, with the notes in full under it. */
export function recordingLine(
  id: number,
  r: Pick<NewRecording, "startedAt" | "durationS" | "notes">,
): ElsewhereLine {
  const mins = Math.max(1, Math.round(r.durationS / 60));
  const n = r.notes;
  const list = (title: string, items: string[] | undefined) =>
    items?.length ? `${title}\n${items.map((i) => `- ${i}`).join("\n")}` : null;
  const body = n
    ? [n.summary, list("Needs", n.needs), list("Objections", n.objections), list("Next", n.next)]
        .filter(Boolean)
        .join("\n\n")
    : null;
  return {
    kind: "call",
    channel: "calendar",
    at: r.startedAt,
    summary: `Call recorded, ${mins} min${n ? `: ${n.summary}` : ""}`,
    body,
    link: `/calendar/recordings/${id}`,
    source: "call_recordings",
    sourceId: String(id),
  };
}

/**
 * Keeps a recording: its row, then its line on the person's timeline when it was a booked call
 * (the booking's email and its enrollment's person find them). The row's id.
 */
export async function saveRecording(db: Queryable, r: NewRecording): Promise<number> {
  const [row] = await db
    .insert(callRecordings)
    .values({
      callBookingId: r.callBookingId,
      fileKey: r.fileKey,
      bytes: r.bytes,
      durationS: r.durationS,
      startedAt: r.startedAt,
      endedAt: r.endedAt,
      transcript: transcriptOf(r.segments),
      segments: r.segments,
      notes: r.notes,
      model: r.model,
      by: r.by,
    })
    .returning({ id: callRecordings.id });
  const id = row!.id;
  if (r.callBookingId !== null) {
    const [b] = await rows<{ email: string | null; name: string | null; person: number | null }>(
      db,
      sql`
      select cb.email::text email, cb.name, e.person_id person
      from call_bookings cb left join enrollments e on e.id = cb.enrollment_id
      where cb.id = ${r.callBookingId}`,
    );
    if (b) {
      const keys: ProfileKey[] = [];
      if (b.email) keys.push({ kind: "email", value: b.email });
      if (b.person != null) keys.push({ kind: "person", value: Number(b.person) });
      await noteElsewhere(
        db,
        keys,
        "calendar",
        { name: b.name, at: r.startedAt },
        recordingLine(id, r),
      );
    }
  }
  return id;
}

/** What a booked call's page shows of its recording: the newest one. */
export interface RecordingNote {
  id: number;
  startedAt: string;
  durationS: number;
  notes: CallNotes | null;
}

/** A booked call's newest recording, or null. */
export async function recordingOf(
  db: Queryable,
  callBookingId: number,
): Promise<RecordingNote | null> {
  const [r] = await db
    .select({
      id: callRecordings.id,
      startedAt: callRecordings.startedAt,
      durationS: callRecordings.durationS,
      notes: callRecordings.notes,
    })
    .from(callRecordings)
    .where(eq(callRecordings.callBookingId, callBookingId))
    .orderBy(sql`${callRecordings.startedAt} desc`)
    .limit(1);
  return r
    ? {
        id: r.id,
        startedAt: r.startedAt.toISOString(),
        durationS: r.durationS,
        notes: (r.notes as CallNotes | null) ?? null,
      }
    : null;
}

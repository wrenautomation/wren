/**
 * A finished call into `voice_calls`, its turns into `voice_turns`, in one transaction. The box
 * saves live calls; the portal's test calls come through `VoiceConsole.saveTest`. Node only.
 */
import { smsContacts } from "@wren/channel-sms/schema";
import { atomic, type Queryable } from "@wren/db";
import { desc, eq } from "drizzle-orm";
import type { CallResult, Turn } from "./call.js";
import { voiceCalls, voiceTurns } from "./schema.js";

const MAX_TURNS = 400;
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

export async function saveCall(
  db: Queryable,
  r: CallResult,
  o: { whose: string; by: string | null },
): Promise<number> {
  const number = r.call.direction === "outbound" ? r.call.to : r.call.from;
  return atomic(db, async (tx) => {
    const [contact] = number
      ? await tx
          .select({ id: smsContacts.id })
          .from(smsContacts)
          .where(eq(smsContacts.e164, number))
          .orderBy(desc(smsContacts.createdAt))
          .limit(1)
      : [];
    const [row] = await tx
      .insert(voiceCalls)
      .values({
        whose: o.whose,
        direction: r.call.direction,
        pipeline: clip(r.pipeline, 200),
        ref: clip(r.call.id, 200),
        fromNumber: clip(r.call.from, 32),
        toNumber: clip(r.call.to, 32),
        smsContactId: contact?.id ?? null,
        leadName: r.lead?.name ?? null,
        outcome: r.outcome,
        transcript: r.transcript.map((l) => ({ ...l, text: clip(l.text, 4000) })),
        bookingId: r.booking?.id ?? null,
        message: r.message,
        by: o.by,
        startedAt: r.startedAt,
        endedAt: r.endedAt,
      })
      .returning({ id: voiceCalls.id });
    if (!row) throw new Error("voice call insert returned no row");
    const turns = r.turns.slice(0, MAX_TURNS);
    if (turns.length)
      await tx
        .insert(voiceTurns)
        .values(turns.map((t) => turnRow(row.id, r.pipeline, t, r.endedAt)));
    return row.id;
  });
}

const ms = (x: number | null) =>
  x === null ? null : Math.min(600_000, Math.max(0, Math.round(x)));

function turnRow(callId: number, pipeline: string, t: Turn, at: Date) {
  return {
    callId,
    n: t.n,
    pipeline: clip(pipeline, 200),
    caller: clip(t.caller, 4000),
    agent: clip(t.agent, 4000),
    tools: t.tools.slice(0, 20),
    speculative: t.speculative,
    barged: t.barged,
    finalMs: ms(t.ms.final),
    endMs: ms(t.ms.end),
    tokenMs: ms(t.ms.token),
    audioMs: ms(t.ms.audio),
    heardMs: ms(t.ms.heard),
    at,
  };
}

/**
 * The Voice app's records: calls (each with its transcript and timed turns) and latency (p50 and
 * p95 per stage per pipeline). Test calls land here from the portal; real ones at setup.
 */

import { date, defineRecord, name, number, prose, status, text } from "@wren/core/records";
import type { Queryable } from "@wren/db";
import { asc, eq } from "drizzle-orm";
import { STAGES } from "./call.js";
import { voiceCalls, voiceTurns } from "./schema.js";

export const OUTCOME_STATUS = {
  booked: { label: "Booked", tone: "good" },
  transferred: { label: "Put through", tone: "good" },
  message: { label: "Message", tone: "warn" },
  ended: { label: "Ended", tone: "neutral" },
  hung_up: { label: "Hung up", tone: "neutral" },
  timed_out: { label: "Ran long", tone: "warn" },
  failed: { label: "Failed", tone: "bad" },
} as const;

export const DIRECTION_STATUS = {
  inbound: { label: "Inbound", tone: "neutral" },
  outbound: { label: "Outbound", tone: "neutral" },
  test: { label: "Test", tone: "neutral" },
} as const;

/** What a call's detail adds: its transcript and turns. */
export interface CallDetail {
  transcript: { who: string; text: string; tool?: string }[];
  turns: {
    n: number;
    caller: string;
    agent: string;
    tools: string[];
    speculative: boolean;
    barged: boolean;
    ms: Record<keyof typeof STAGES, number | null>;
  }[];
}

async function callDetail(db: Queryable, id: string): Promise<CallDetail | null> {
  const n = Number(id);
  if (!Number.isInteger(n)) return null;
  const [call] = await db
    .select({ transcript: voiceCalls.transcript })
    .from(voiceCalls)
    .where(eq(voiceCalls.id, n));
  if (!call) return null;
  const turns = await db
    .select()
    .from(voiceTurns)
    .where(eq(voiceTurns.callId, n))
    .orderBy(asc(voiceTurns.n));
  return {
    transcript: call.transcript,
    turns: turns.map((t) => ({
      n: t.n,
      caller: t.caller,
      agent: t.agent,
      tools: t.tools,
      speculative: t.speculative,
      barged: t.barged,
      ms: { final: t.finalMs, end: t.endMs, token: t.tokenMs, audio: t.audioMs, heard: t.heardMs },
    })),
  };
}

export const callRecord = defineRecord({
  id: "voice.call",
  name: { one: "call", many: "calls" },
  view: "voice_call_records",
  key: "id",
  title: "who",
  subtitle: "pipeline",
  fields: {
    who: name("Who"),
    number: text("Number"),
    direction: status(DIRECTION_STATUS, "Kind"),
    outcome: status(OUTCOME_STATUS),
    pipeline: text("Pipeline"),
    turns: number("Turns"),
    heard: number("Heard, p50 ms"),
    seconds: number("Length, s"),
    started: date("When"),
    message: prose("Message"),
    by: text("Tested by"),
  },
  views: [
    { id: "all", label: "All", sort: "-started", at: "started" },
    {
      id: "live",
      label: "Real calls",
      where: { direction: ["inbound", "outbound"] },
      sort: "-started",
      at: "started",
    },
    { id: "tests", label: "Tests", where: { direction: "test" }, sort: "-started", at: "started" },
    {
      id: "booked",
      label: "Booked",
      where: { outcome: "booked" },
      sort: "-started",
      at: "started",
    },
    {
      id: "messages",
      label: "Messages",
      where: { outcome: "message" },
      sort: "-started",
      at: "started",
    },
  ],
  load: callDetail,
});

export const STAGE_STATUS = Object.fromEntries(
  Object.entries(STAGES).map(([k, label]) => [k, { label, tone: "neutral" as const }]),
);

export const latencyRecord = defineRecord({
  id: "voice.latency",
  name: { one: "stage", many: "stages" },
  view: "voice_latency",
  key: "id",
  title: "pipeline",
  subtitle: "stage",
  fields: {
    pipeline: text("Pipeline"),
    stage: status(STAGE_STATUS, "Stage"),
    rank: number("Order"),
    p50: number("p50 ms"),
    p95: number("p95 ms"),
    turns: number("Turns"),
    last: date("Last turn"),
  },
  views: [{ id: "all", label: "Last 30 days", sort: "rank", at: "last" }],
});

export const VOICE_RECORDS = [callRecord, latencyRecord];

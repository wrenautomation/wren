/**
 * The agent: the `voice.agent` part's settings block, so the Shop edits it (Wren's in
 * `wren_settings`, a client's in `clients.products`). Every field has a default, so `{}` is a
 * working agent. The rules the code enforces whatever the settings say live here too: the first
 * line says it's an AI assistant, and a recording is asked for where the state needs both sides.
 */
import { canonicalZone, wallClock } from "@wren/core/time";
import { z } from "zod";

export const VOICE_AGENT = "voice.agent";

export const TOOL_NAMES = [
  "lookUpLead",
  "offerTimes",
  "book",
  "transfer",
  "takeMessage",
  "endCall",
] as const;
export type ToolName = (typeof TOOL_NAMES)[number];

/** Days as the settings name them, Sunday first, as `getUTCDay` counts. */
const DAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;
const STRETCH = /^\s*([01]?\d|2[0-4]):([0-5]\d)\s*-\s*([01]?\d|2[0-4]):([0-5]\d)\s*$/;

/** "09:00-12:00, 13:00-17:00" as [from, to) minute pairs; null when it doesn't read. */
export function stretchesOf(text: string): [number, number][] | null {
  const out: [number, number][] = [];
  for (const part of text.split(",")) {
    if (!part.trim()) continue;
    const m = STRETCH.exec(part);
    if (!m) return null;
    const from = Number(m[1]) * 60 + Number(m[2]);
    const to = Number(m[3]) * 60 + Number(m[4]);
    if (to <= from || to > 24 * 60) return null;
    out.push([from, to]);
  }
  return out;
}

const hours = (fallback: string) =>
  z
    .string()
    .default(fallback)
    .refine((s) => stretchesOf(s) !== null, "hours read like 09:00-12:00, 13:00-17:00")
    .describe("When it puts calls through to a person, like 09:00-17:00; blank is never");

export const DEFAULT_PROMPT = [
  "You answer the phone for a small business.",
  "Be brief: one or two short sentences a turn, the way people talk on the phone.",
  "Find out what the caller needs. If they want to talk to someone, offer times and book a call.",
  "Never make up prices, promises or facts. If you don't know, offer to take a message.",
].join(" ");

export const agentSettingsSchema = z
  .object({
    name: z.string().min(1).max(60).default("Wren").describe("Who the agent says it works for"),
    firstLine: z
      .string()
      .max(300)
      .default("Hi, this is Wren's AI assistant. How can I help?")
      .describe("The first thing it says. It must say it's an AI; the code adds that if not"),
    prompt: z.string().max(4000).default(DEFAULT_PROMPT).describe("How it talks and what it's for"),
    voice: z.string().max(80).default("default").describe("The voice, picked at setup"),
    tools: z
      .array(z.enum(TOOL_NAMES))
      .default([...TOOL_NAMES])
      .describe(
        "What it may do: look up the lead, offer times, book, transfer, take a message, end",
      ),
    turn: z
      .object({
        pauseMs: z
          .number()
          .int()
          .min(200)
          .max(3000)
          .default(700)
          .describe("How long a pause ends the caller's turn, in milliseconds"),
        bargeIn: z.boolean().default(true).describe("Whether the caller can talk over it"),
      })
      .prefault({}),
    zone: z
      .string()
      .default("America/Toronto")
      .refine((name) => canonicalZone(name) !== null, "an IANA time zone, like America/Toronto")
      .describe("The hours' time zone"),
    hours: z
      .object({
        mon: hours("09:00-17:00"),
        tue: hours("09:00-17:00"),
        wed: hours("09:00-17:00"),
        thu: hours("09:00-17:00"),
        fri: hours("09:00-17:00"),
        sat: hours(""),
        sun: hours(""),
      })
      .prefault({}),
    transferTo: z
      .string()
      .regex(/^\+[1-9]\d{6,14}$/, "an E.164 number, like +15555550100")
      .optional()
      .describe("Who it puts callers through to, in hours"),
    fillers: z
      .array(z.string().min(1).max(60))
      .default(["One moment.", "Let me check."])
      .describe("What it says while a tool runs, cached as audio"),
    maxMinutes: z.number().int().min(1).max(30).default(10).describe("It ends any call this long"),
    record: z.boolean().default(false).describe("Record calls, asking first where the law says"),
    outbound: z
      .boolean()
      .default(false)
      .describe("William's yes for this agent to dial out; only to numbers with written consent"),
  })
  .strict();
export type AgentSettings = z.infer<typeof agentSettingsSchema>;

/** A settings block (`{}` and missing fields take defaults) as an agent. Throws on a bad one. */
export const agentOf = (settings: unknown): AgentSettings =>
  agentSettingsSchema.parse(settings ?? {});

const SAYS_AI = /\b(ai|a\.i\.|artificial|automated)\b/i;

/**
 * States where every side must agree to a recording. A call to or from one asks first.
 * Area codes map to states at setup; until then a recording agent asks every caller.
 */
export const TWO_PARTY_STATES = [
  "CA",
  "CT",
  "DE",
  "FL",
  "IL",
  "MD",
  "MA",
  "MI",
  "MT",
  "NV",
  "NH",
  "OR",
  "PA",
  "WA",
] as const;

/**
 * The first line as said: the agent's own, with "AI assistant" put first when it doesn't say
 * so (an AI voice is an artificial voice under the TCPA), then the recording ask when it records
 * and the caller's state needs both sides (unknown state: asks).
 */
export function openingLine(agent: AgentSettings, callerState: string | null = null): string {
  const own = agent.firstLine.trim() || `Hi, this is ${agent.name}.`;
  const said = SAYS_AI.test(own) ? own : `This is ${agent.name}'s AI assistant. ${own}`;
  const asks =
    agent.record &&
    (callerState === null || (TWO_PARTY_STATES as readonly string[]).includes(callerState));
  return asks ? `${said} This call may be recorded. Is that OK?` : said;
}

/** Whether `at` is inside the agent's hours on its clock: when transfer may ring a person. */
export function inHours(agent: AgentSettings, at: Date): boolean {
  const zone = canonicalZone(agent.zone) ?? "America/Toronto";
  const w = wallClock(zone, at);
  const day = DAYS[new Date(Date.UTC(w.year, w.month - 1, w.day)).getUTCDay()] ?? "sun";
  const minute = w.hour * 60 + w.minute;
  return (stretchesOf(agent.hours[day]) ?? []).some(([a, b]) => minute >= a && minute < b);
}

/** The brain's standing instructions: the agent's prompt, its name and the rules. */
export function systemOf(agent: AgentSettings): string {
  return [
    `You are ${agent.name}'s AI assistant on a phone call.`,
    agent.prompt,
    "Say you are an AI if asked. Never claim to be a person.",
    "If the caller asks for a person, transfer them. If they ask you to stop calling, end the call politely.",
  ].join("\n");
}

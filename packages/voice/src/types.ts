/**
 * The voice agent's one interface (designs/2026-10-06-voice-agent.md). A call is a session: a
 * transport carries the caller in and our voice out, and three stages sit between: ears (speech
 * to words), brain (words to a reply and tool calls) and mouth (text to speech). A transport
 * that carries text (a typed test call, the browser's own speech) skips ears and mouth. Each
 * piece has a fake here and real adapters at setup; the session never knows which it has.
 *
 * Isomorphic: no Node or DOM imports, so the portal runs the same loop in the browser.
 */

/** One slice of sound. */
export interface Frame {
  /** `pcmu` 8 kHz from the phone network, `pcm16` from a vendor, `fake` UTF-8 words in tests. */
  encoding: "pcmu" | "pcm16" | "fake";
  rate: number;
  data: Uint8Array;
}

export const DIRECTIONS = ["inbound", "outbound", "test"] as const;
export type Direction = (typeof DIRECTIONS)[number];

/** How a call ended, best first: a booking beats a hang-up on the same call. */
export const OUTCOMES = [
  "booked",
  "transferred",
  "message",
  "ended",
  "hung_up",
  "timed_out",
  "failed",
] as const;
export type Outcome = (typeof OUTCOMES)[number];

export interface CallStart {
  /** The transport's own id for the call (Telnyx's call control id, a test's uuid). */
  id: string;
  /** E.164, or "" when the transport has none. */
  from: string;
  to: string;
  direction: Direction;
}

/** What the caller's side sends, in order. */
export type Incoming =
  | { kind: "start"; call: CallStart }
  | { kind: "audio"; frame: Frame }
  /** A transport that carries text: typed, or the browser's own speech, interim then final. */
  | { kind: "words"; text: string; final: boolean }
  | { kind: "key"; digit: string }
  /** Our first audio (or text) of turn `turn` reached the caller. */
  | { kind: "played"; turn: number }
  /** Everything we sent has played. */
  | { kind: "idle" }
  | { kind: "hangup" };

/** What we send. `turn` ties it to its turn's timing. */
export type Outgoing =
  | { kind: "audio"; frame: Frame; turn: number }
  | { kind: "text"; text: string; turn: number };

export interface Transport {
  /** "fake", "text", "browser", "telnyx". */
  readonly name: string;
  readonly carries: "audio" | "text";
  /**
   * Who says a turn is over. "theirs": a final from the transport ends it (Enter on a typed
   * line, the browser's own end of speech). "ours": the session waits the agent's pause.
   */
  readonly endpointing: "ours" | "theirs";
  /** Start: every caller event goes to `on`, in order, beginning with `start`. */
  open(on: (e: Incoming) => void): Promise<void>;
  send(out: Outgoing): void;
  /** Barge-in: drop whatever of ours hasn't played yet. */
  clear(): void;
  transfer(to: string): Promise<void>;
  hangup(): Promise<void>;
}

/** What the ears heard. */
export type Heard =
  /** Voice activity began: the caller is talking (barge-in fires on this). */
  | { kind: "speech" }
  | { kind: "partial"; text: string }
  /** These words won't change. Not yet the end of the turn: the caller may go on. */
  | { kind: "final"; text: string }
  /** Voice activity stopped: the end of speech every turn is timed from. */
  | { kind: "silence" };

export interface EarStream {
  push(frame: Frame): void;
  close(): void;
}

export interface Ears {
  readonly name: string;
  open(on: (h: Heard) => void): EarStream;
}

export interface Mouth {
  readonly name: string;
  /** Frames for one sentence, streamed; stops when `signal` aborts. */
  speak(text: string, signal: AbortSignal): AsyncIterable<Frame>;
}

/** One line of the transcript. */
export interface Line {
  who: "caller" | "agent" | "tool";
  text: string;
  /** On a tool line: which tool. */
  tool?: string;
}

/** Who the lead is, when we know: what the brain is told before the first word. */
export interface LeadContext {
  name: string | null;
  company: string | null;
  email: string | null;
  /** Their IANA zone, when known. */
  zone: string | null;
  /** A line or two the brain may use: where they came from, what they asked. */
  notes: string | null;
}

export interface ToolSpec {
  name: string;
  /** One line for the brain: when to call it. */
  says: string;
  /** Argument name to what it holds. */
  args: Readonly<Record<string, string>>;
}

export interface BrainInput {
  /** The agent's prompt and name. */
  system: string;
  lead: LeadContext | null;
  transcript: readonly Line[];
  tools: readonly ToolSpec[];
}

/** What the brain streams: words to say, or a tool to run. */
export type Thought =
  | { kind: "text"; text: string }
  | { kind: "tool"; name: string; args: Record<string, unknown> };

export interface Brain {
  readonly name: string;
  think(input: BrainInput, signal: AbortSignal): AsyncIterable<Thought>;
}

/**
 * A whole call through a vendor's platform (Retell, Vapi), for comparison only: it gets the
 * agent and the call, and gives back what our own loop would record, so the Latency page sets
 * both side by side. None is wired; a fake runs in tests.
 */
export interface Hosted {
  readonly name: string;
  run(o: {
    /** The agent's settings, as the vendor's agent definition is built from them. */
    agent: unknown;
    call: CallStart;
    signal: AbortSignal;
  }): Promise<{ transcript: Line[]; outcome: string; turnsMs: { heard: number | null }[] }>;
}

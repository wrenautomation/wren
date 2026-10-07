/**
 * A fake for every piece, so a whole call runs with no vendor: a scripted caller on a fake
 * phone line, ears that read the fake audio as words, a mouth that turns words into fake audio,
 * a brain that follows simple rules, and fake lead, calendar and message ports. `fake` frames
 * carry their words as UTF-8, so the test reads what was said. Each fake can be slowed, so the
 * timing and barge-in paths run as they would on a real call. $0, and the portal's test call
 * uses the brain and ports.
 */

import { type LeadPort, type MessagePort, TimeTaken, type VoiceCalendar } from "./tools.js";
import type {
  Brain,
  BrainInput,
  CallStart,
  Ears,
  Frame,
  Heard,
  Hosted,
  Incoming,
  LeadContext,
  Line,
  Mouth,
  Outgoing,
  Thought,
  Transport,
} from "./types.js";

const enc = new TextEncoder();
const dec = new TextDecoder();
const sleep = (ms: number) => new Promise<void>((ok) => setTimeout(ok, ms));
export const fakeFrame = (text: string): Frame => ({
  encoding: "fake",
  rate: 0,
  data: enc.encode(text),
});
export const wordsOf = (f: Frame) => dec.decode(f.data);

/** One line of the scripted caller. */
export interface CallerLine {
  say: string;
  /** Talk over our reply once this many of its frames arrived, instead of waiting for quiet. */
  over?: number;
}

/**
 * A phone line with a scripted caller: each line is spoken as fake audio, one frame a word and
 * an empty frame for the pause, once we go quiet (or over us). The caller hangs up after the last
 * line once we're quiet, unless we end first.
 */
export class FakeTransport implements Transport {
  readonly name = "fake";
  readonly carries = "audio" as const;
  readonly endpointing = "ours" as const;
  /** What we said, a sentence per entry once each turn's frames are joined. */
  readonly heard: string[] = [];
  cleared = 0;
  transferredTo: string | null = null;
  hungUp = false;
  private on: (e: Incoming) => void = () => {};
  private next = 0;
  private framesThisTurn = 0;
  private turn = -1;
  private idle: ReturnType<typeof setTimeout> | null = null;
  private talk: ReturnType<typeof setTimeout> | null = null;
  private speaking = false;

  constructor(
    private readonly script: readonly CallerLine[],
    private readonly o: {
      call?: Partial<CallStart>;
      /** How long a frame takes to play. */
      playMs?: number;
      /** How long the caller waits after we go quiet before talking. */
      gapMs?: number;
      wordMs?: number;
    } = {},
  ) {}

  async open(on: (e: Incoming) => void): Promise<void> {
    this.on = on;
    on({
      kind: "start",
      call: {
        id: "fake-call",
        from: "+15555550123",
        to: "+15555550100",
        direction: "inbound",
        ...this.o.call,
      },
    });
  }

  send(out: Outgoing): void {
    if (this.hungUp || out.kind !== "audio") return;
    if (out.turn !== this.turn) {
      this.turn = out.turn;
      this.framesThisTurn = 0;
      this.heard.push("");
      queueMicrotask(() => this.on({ kind: "played", turn: out.turn }));
    }
    const at = this.heard.length - 1;
    this.heard[at] = `${this.heard[at]} ${wordsOf(out.frame)}`.trim();
    this.framesThisTurn++;
    this.speaking = true;
    const line = this.script[this.next];
    if (line?.over !== undefined && this.framesThisTurn === line.over) {
      this.next++;
      void this.speak(line.say);
    }
    if (this.idle) clearTimeout(this.idle);
    if (this.talk) clearTimeout(this.talk);
    this.idle = setTimeout(() => this.quiet(), this.o.playMs ?? 5);
  }

  clear(): void {
    this.cleared++;
    this.speaking = false;
    if (this.idle) clearTimeout(this.idle);
    this.idle = null;
  }

  async transfer(to: string): Promise<void> {
    this.transferredTo = to;
    this.hungUp = true;
  }

  async hangup(): Promise<void> {
    this.hungUp = true;
    if (this.idle) clearTimeout(this.idle);
    if (this.talk) clearTimeout(this.talk);
  }

  private quiet(): void {
    this.idle = null;
    this.speaking = false;
    this.on({ kind: "idle" });
    this.talk = setTimeout(() => this.turnTaken(), this.o.gapMs ?? 30);
  }

  /** We stayed quiet: the caller says the next line, or hangs up after the last. */
  private turnTaken(): void {
    this.talk = null;
    const line = this.script[this.next];
    if (this.hungUp) return;
    if (!line) {
      this.hungUp = true;
      this.on({ kind: "hangup" });
      return;
    }
    if (line.over !== undefined) return;
    this.next++;
    void this.speak(line.say);
  }

  private async speak(text: string): Promise<void> {
    for (const w of text.split(/\s+/).filter(Boolean)) {
      await sleep(this.o.wordMs ?? 1);
      if (this.hungUp) return;
      this.on({ kind: "audio", frame: fakeFrame(w) });
    }
    await sleep(this.o.wordMs ?? 1);
    if (!this.hungUp) this.on({ kind: "audio", frame: fakeFrame("") });
  }

  get talking(): boolean {
    return this.speaking;
  }
}

/** Reads fake audio: a word frame is speech and a partial; an empty frame, silence then final. */
export class FakeEars implements Ears {
  readonly name = "fake-ears";
  constructor(private readonly o: { finalMs?: number } = {}) {}
  open(on: (h: Heard) => void) {
    let words: string[] = [];
    let closed = false;
    return {
      push: (frame: Frame) => {
        if (closed) return;
        const w = wordsOf(frame);
        if (w) {
          if (!words.length) on({ kind: "speech" });
          words.push(w);
          on({ kind: "partial", text: words.join(" ") });
          return;
        }
        if (!words.length) return;
        const text = words.join(" ");
        words = [];
        on({ kind: "silence" });
        setTimeout(() => !closed && on({ kind: "final", text }), this.o.finalMs ?? 1);
      },
      close: () => {
        closed = true;
      },
    };
  }
}

/** Speaks a frame a word. */
export class FakeMouth implements Mouth {
  readonly name = "fake-mouth";
  constructor(private readonly o: { firstMs?: number; wordMs?: number } = {}) {}
  async *speak(text: string, signal: AbortSignal): AsyncIterable<Frame> {
    await sleep(this.o.firstMs ?? 1);
    for (const w of text.split(/\s+/).filter(Boolean)) {
      if (signal.aborted) return;
      yield fakeFrame(w);
      if (this.o.wordMs) await sleep(this.o.wordMs);
    }
  }
}

const EMAIL = /[^\s@]+@[^\s@]+\.[a-z]{2,}/i;
const ISO = /\((\d{4}-\d\d-\d\dT[^)]+)\)/g;
const lastOf = <T>(xs: readonly T[], pick: (x: T) => boolean): T | undefined =>
  [...xs].reverse().find(pick);

/** "1st", "the second", "tuesday", "10" against the offered times: which one, or null. */
function pickOf(text: string, offered: string[]): string | null {
  const t = text.toLowerCase();
  const nth = [
    /\b(first|1st|earliest|that one|yes|sure|works)\b/,
    /\b(second|2nd)\b/,
    /\b(third|3rd|last)\b/,
  ];
  for (let i = nth.length - 1; i >= 0; i--)
    if (nth[i]?.test(t) && offered[i]) return offered[i] ?? null;
  return null;
}

/** "I'm Sam Example", "my name is Sam", "this is Sam": the name, or null. */
function nameOf(text: string): string | null {
  const m = /\b(?:i'm|i am|my name is|this is|it's)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/.exec(text);
  return m?.[1] ?? null;
}

/**
 * A brain that follows rules: books when asked for a call (offer times, take the pick, ask for
 * what's missing), takes messages, puts people through, says goodbye. It streams its words a
 * few at a time like a model does. For tests and the portal's test call, at $0.
 */
export class ScriptedBrain implements Brain {
  readonly name: string = "scripted";
  constructor(private readonly o: { tokenMs?: number; firstMs?: number } = {}) {}

  async *think(input: BrainInput, signal: AbortSignal): AsyncIterable<Thought> {
    const { say, tool } = this.decide(input);
    await sleep(this.o.firstMs ?? 1);
    const words = say.split(" ");
    for (let i = 0; i < words.length; i += 3) {
      if (signal.aborted) return;
      yield { kind: "text", text: `${i ? " " : ""}${words.slice(i, i + 3).join(" ")}` };
      if (this.o.tokenMs) await sleep(this.o.tokenMs);
    }
    if (tool && !signal.aborted) yield { kind: "tool", ...tool };
  }

  decide(input: BrainInput): {
    say: string;
    tool?: { name: string; args: Record<string, unknown> };
  } {
    const { transcript, lead } = input;
    const may = (name: string) => input.tools.some((t) => t.name === name);
    const last = transcript[transcript.length - 1];
    const callers = transcript.filter((l) => l.who === "caller").map((l) => l.text);
    const offer = lastOf(transcript, (l) => l.tool === "offerTimes");
    const offered = offer ? [...offer.text.matchAll(ISO)].map((m) => m[1] as string) : [];
    const sinceOffer = offer ? transcript.slice(transcript.lastIndexOf(offer) + 1) : [];

    if (last?.who === "tool") {
      if (last.tool === "offerTimes")
        return offered.length
          ? { say: `I have ${spokenList(last.text)}. Which works best?` }
          : { say: "I don't have any open times soon. Can I take a message instead?" };
      if (last.tool === "book")
        return {
          say: last.text.startsWith("Booked")
            ? `${last.text} Anything else?`
            : "Sorry, that time just went. Let me find another.",
        };
      if (last.tool === "takeMessage") return { say: "Got it, I'll pass that on. Anything else?" };
      if (last.tool === "transfer")
        return { say: `${last.text.replace("Offer to take", "I can take")}` };
      return { say: "OK." };
    }
    const said = (last?.text ?? "").toLowerCase();
    if (/\b(bye|goodbye|that's all|that's it|nothing else|no thanks|stop calling)\b/.test(said))
      return may("endCall")
        ? { say: "Thanks for calling. Goodbye.", tool: { name: "endCall", args: {} } }
        : { say: "Thanks for calling." };
    if (
      /\b(person|human|someone|representative|real person|transfer|operator)\b/.test(said) &&
      may("transfer")
    )
      return { say: "Sure, one moment.", tool: { name: "transfer", args: {} } };
    const askedMessage = lastOf(transcript, (l) => l.who === "agent")?.text.includes(
      "What's the message",
    );
    if (askedMessage && may("takeMessage"))
      return { say: "Thanks.", tool: { name: "takeMessage", args: { text: last?.text ?? "" } } };
    if (/\bmessage\b/.test(said) && may("takeMessage")) return { say: "Sure. What's the message?" };
    const picked = lastOf(
      sinceOffer,
      (l) => l.who === "caller" && pickOf(l.text, offered) !== null,
    );
    if (picked && may("book")) {
      const start = pickOf(picked.text, offered) as string;
      const email = lastOf(callers, (c) => EMAIL.test(c))?.match(EMAIL)?.[0] ?? lead?.email ?? null;
      const name = lastOf(callers.map(nameOf), (n) => n !== null) ?? lead?.name ?? null;
      if (!name) return { say: "Great. Who should I put it under?" };
      if (!email) return { say: "And what email should the invite go to?" };
      return { say: "Booking that now.", tool: { name: "book", args: { start, name, email } } };
    }
    if (
      /\b(book|call|meet|meeting|time|schedule|appointment|demo|talk|available)\b/.test(said) &&
      may("offerTimes")
    )
      return { say: "Let me find a time.", tool: { name: "offerTimes", args: {} } };
    const hi = lead?.name && callers.length === 1 ? `Thanks, ${lead.name.split(" ")[0]}. ` : "";
    return {
      say: `${hi}I can book you a call with the team, or take a message. Which would you like?`,
    };
  }
}

/** "Tue, Oct 7, 10:00 AM (iso); Wed, ..." as "Tue, Oct 7, 10:00 AM or Wed, ...". */
function spokenList(toolText: string): string {
  const times = toolText
    .replace(/^Open times:\s*/, "")
    .replace(/\.$/, "")
    .split(";")
    .map((s) => s.replace(ISO, "").trim());
  return times.length > 1
    ? `${times.slice(0, -1).join(", ")} or ${times.at(-1)}`
    : (times[0] ?? "");
}

/** Synthetic leads by number. */
export class FakeLeads implements LeadPort {
  constructor(private readonly leads: Readonly<Record<string, LeadContext>> = SAMPLE_LEADS) {}
  async byPhone(e164: string) {
    return this.leads[e164] ?? null;
  }
}

export const SAMPLE_LEADS: Readonly<Record<string, LeadContext>> = {
  "+15555550123": {
    name: "Sam Example",
    company: "Example Plumbing",
    email: "sam@example.com",
    zone: "America/Toronto",
    notes: "Filled the site's form asking about follow-up texts.",
  },
};

/** Open on the hour, three a day from tomorrow; a booked time is gone. */
export class FakeCalendar implements VoiceCalendar {
  readonly booked: { id: number; start: Date; name: string; email: string }[] = [];
  async open({ now, max }: { now: Date; max: number }) {
    const day = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) + 86_400_000;
    const out: Date[] = [];
    for (let d = 0; out.length < max && d < 14; d++)
      for (const h of [14, 16, 19]) {
        const t = new Date(day + d * 86_400_000 + h * 3_600_000);
        if (!this.booked.some((b) => b.start.getTime() === t.getTime())) out.push(t);
      }
    return out.slice(0, max);
  }
  async book(o: { start: Date; name: string; email: string }) {
    if (this.booked.some((b) => b.start.getTime() === o.start.getTime())) throw new TimeTaken();
    const b = { id: this.booked.length + 1, start: o.start, name: o.name, email: o.email };
    this.booked.push(b);
    return { id: b.id, start: b.start };
  }
}

export class FakeMessages implements MessagePort {
  readonly taken: { text: string; callback: string | null; from: string }[] = [];
  async take(o: { call: CallStart; text: string; callback: string | null }) {
    this.taken.push({ text: o.text, callback: o.callback, from: o.call.from });
  }
}

/** The fake ports together. */
export const fakePorts = () => ({
  leads: new FakeLeads(),
  calendar: new FakeCalendar(),
  messages: new FakeMessages(),
});

/** The transcript as plain lines, for tests and logs. */
export const transcriptText = (lines: readonly Line[]) =>
  lines.map((l) => `${l.who === "tool" ? `[${l.tool}]` : l.who}: ${l.text}`).join("\n");

/** A vendor platform that answers every call with the first line and hangs up. */
export class FakeHosted implements Hosted {
  readonly name = "fake-hosted";
  async run(o: { agent: unknown; call: CallStart; signal: AbortSignal }) {
    const first = (o.agent as { firstLine?: string }).firstLine ?? "Hello.";
    return {
      transcript: [{ who: "agent" as const, text: first }],
      outcome: "ended",
      turnsMs: [{ heard: 0 }],
    };
  }
}

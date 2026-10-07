/**
 * The call loop: one session per call, the same on every pipeline. Everything streams:
 *
 * - The brain starts on a final transcript before the turn is over (speculative), and its
 *   answer is held, sentence by sentence and already spoken by the mouth, until the pause says
 *   the turn ended. If the caller goes on, that answer is dropped.
 * - Each sentence goes to the mouth as soon as it's whole, so the first plays before the reply
 *   ends.
 * - Barge-in: the caller talking over us clears our audio at once and drops the reply.
 * - A tool waits for the turn to be committed (it may book), says a filler line cached as audio,
 *   then the brain goes on with the tool's answer.
 *
 * Every turn is timed from the end of the caller's speech: words final, turn over, first reply
 * token, first audio out, audio heard. Isomorphic: runs in the browser for the portal's test call.
 */
import { type AgentSettings, openingLine, systemOf } from "./agent.js";
import { SentenceCutter } from "./sentences.js";
import { type Effect, runTool, type ToolPorts, toolsOf } from "./tools.js";
import type {
  Brain,
  CallStart,
  EarStream,
  Ears,
  Frame,
  Heard,
  Incoming,
  LeadContext,
  Line,
  Mouth,
  Outcome,
  Outgoing,
  Transport,
} from "./types.js";

export { OUTCOMES, type Outcome } from "./types.js";

export interface Pipeline {
  transport: Transport;
  /** Needed when the transport carries audio. */
  ears?: Ears | null;
  brain: Brain;
  /** Needed when the transport carries audio. */
  mouth?: Mouth | null;
}

/** "text · scripted", "telnyx · deepgram · llm:claude · cartesia": what latency is grouped by. */
export function pipelineName(p: Pipeline): string {
  return p.transport.carries === "text"
    ? `${p.transport.name} · ${p.brain.name}`
    : [p.transport.name, p.ears?.name ?? "?", p.brain.name, p.mouth?.name ?? "?"].join(" · ");
}

/** The stages a turn is timed by, in order. */
export const STAGES = {
  final: "Words final",
  end: "Turn over",
  token: "First token",
  audio: "First audio out",
  heard: "Heard",
} as const;
export type Stage = keyof typeof STAGES;

/** One turn: what was said, and when each stage came, in ms after the caller stopped talking. */
export interface Turn {
  n: number;
  /** "" on the opener. */
  caller: string;
  agent: string;
  /** The tools it ran, in order. */
  tools: string[];
  /** Its answer started before the turn was over. */
  speculative: boolean;
  /** The caller talked over it. */
  barged: boolean;
  ms: Record<Stage, number | null>;
}

export interface CallResult {
  call: CallStart;
  pipeline: string;
  outcome: Outcome;
  lead: LeadContext | null;
  transcript: Line[];
  turns: Turn[];
  booking: { id: number; start: Date } | null;
  message: string | null;
  startedAt: Date;
  endedAt: Date;
}

export interface CallOptions {
  pipeline: Pipeline;
  agent: AgentSettings;
  ports: ToolPorts;
  /** A monotonic clock in ms; tests bring their own. */
  clock?: () => number;
  /** The wall clock, for tools and the record. */
  date?: () => Date;
  /** The caller's state, for the recording ask; null asks. */
  callerState?: string | null;
  /** Each line as it's said, and each turn as it settles: the portal draws them live. */
  onLine?: (line: Line) => void;
  onTurn?: (turn: Turn) => void;
}

const MAX_HOPS = 4;

interface Reply {
  n: number;
  /** The caller's words it answers; "" on the opener. */
  input: string;
  abort: AbortController;
  committed: boolean;
  /** Resolves when committed; never, once aborted. */
  gate: Promise<void>;
  open: () => void;
  held: Outgoing[];
  /** Sentences spoken in order: each waits on the one before. */
  voice: Promise<void>;
  marks: Record<Stage | "speechEnd", number | null>;
  said: string[];
  tools: string[];
  speculative: boolean;
  barged: boolean;
  generated: boolean;
  /** Pushed to the transcript as the reply goes, so tool lines sit after their words. */
  linedTo: number;
  /** Its last line in the transcript: marked when the caller cuts in after it. */
  lastLine: Line | null;
}

/** Run one call to its end. Resolves when the call is over, however it ended. */
export function runCall(o: CallOptions): Promise<CallResult> {
  return new Session(o).run();
}

class Session {
  private readonly t: Transport;
  private readonly clock: () => number;
  private readonly date: () => Date;
  private readonly agent: AgentSettings;
  private call: CallStart | null = null;
  private startedAt = new Date(0);
  private lead: LeadContext | null = null;
  private leadAsked: Promise<void> = Promise.resolve();
  private readonly transcript: Line[] = [];
  private readonly turns: Turn[] = [];
  private ear: EarStream | null = null;
  private readonly fillers = new Map<string, Frame[]>();
  private fillerAt = 0;
  private n = 0;
  // The caller's turn in progress.
  private heard: string[] = [];
  private lastVoiceAt: number | null = null;
  private silenceAt: number | null = null;
  private finalAt: number | null = null;
  private pause: ReturnType<typeof setTimeout> | null = null;
  private commitWhenFree = false;
  // Ours.
  private spec: Reply | null = null;
  private reply: Reply | null = null;
  private speaking = false;
  private booking: CallResult["booking"] = null;
  private message: string | null = null;
  private transferred = false;
  private ended: Outcome | null = null;
  private limit: ReturnType<typeof setTimeout> | null = null;
  private finish: (r: CallResult) => void = () => {};
  private over = false;

  constructor(private readonly o: CallOptions) {
    this.t = o.pipeline.transport;
    this.clock = o.clock ?? (() => performance.now());
    this.date = o.date ?? (() => new Date());
    this.agent = o.agent;
    if (this.t.carries === "audio" && (!o.pipeline.ears || !o.pipeline.mouth))
      throw new Error(`${this.t.name} carries audio: it needs ears and a mouth`);
  }

  run(): Promise<CallResult> {
    const done = new Promise<CallResult>((ok) => {
      this.finish = ok;
    });
    this.t.open((e) => this.on(e)).catch(() => this.end("failed"));
    return done;
  }

  private on(e: Incoming): void {
    if (this.over) return;
    const now = this.clock();
    switch (e.kind) {
      case "start":
        this.start(e.call);
        return;
      case "audio":
        this.ear?.push(e.frame);
        return;
      case "words":
        if (e.final) this.finalHeard(e.text, now);
        else this.voiceHeard(now);
        return;
      case "key":
        this.line({ who: "caller", text: `(pressed ${e.digit})` });
        return;
      case "played":
        for (const r of [this.reply, this.spec])
          if (r?.n === e.turn && r.marks.heard === null) r.marks.heard = now;
        return;
      case "idle":
        this.speaking = false;
        if (this.reply?.generated) this.settle(this.reply);
        return;
      case "hangup":
        this.end(this.ended ?? "hung_up");
        return;
    }
  }

  private start(call: CallStart): void {
    if (this.call) return;
    this.call = call;
    this.startedAt = this.date();
    this.limit = setTimeout(() => void this.hangUp("timed_out"), this.agent.maxMinutes * 60_000);
    const { ears, mouth } = this.o.pipeline;
    if (this.t.carries === "audio" && ears) this.ear = ears.open((h) => this.onHeard(h));
    if (this.agent.tools.includes("lookUpLead"))
      this.leadAsked = runTool("lookUpLead", {}, this.o.ports, this.ctx())
        .then((r) => {
          if (r.effect?.kind === "lead") this.lead = r.effect.lead;
        })
        .catch(() => {});
    // Filler lines rendered once, while the opener plays.
    if (this.t.carries === "audio" && mouth)
      for (const f of this.agent.fillers)
        void collect(mouth.speak(f, new AbortController().signal)).then((frames) =>
          this.fillers.set(f, frames),
        );
    this.opener();
  }

  private ctx() {
    return {
      agent: this.agent,
      call: this.call as CallStart,
      lead: this.lead,
      now: this.date(),
    };
  }

  // The caller.

  private onHeard(h: Heard): void {
    const now = this.clock();
    if (h.kind === "silence") {
      this.silenceAt = now;
      return;
    }
    if (h.kind === "final") this.finalHeard(h.text, now);
    else this.voiceHeard(now);
  }

  /** They're talking: barge in on us, drop a held answer, wait for the pause again. */
  private voiceHeard(now: number): void {
    this.lastVoiceAt = now;
    this.silenceAt = null;
    if (this.pause) clearTimeout(this.pause);
    this.pause = null;
    if (this.spec) this.drop(this.spec);
    this.spec = null;
    const r = this.reply;
    if (r && this.agent.turn.bargeIn && (!r.generated || this.speaking)) {
      this.t.clear();
      this.speaking = false;
      r.barged = true;
      r.abort.abort();
      this.settle(r);
    }
  }

  /** Words that won't change. Not voice: the silence before it still marks the end of speech. */
  private finalHeard(text: string, now: number): void {
    const words = text.trim();
    if (this.pause) clearTimeout(this.pause);
    this.pause = null;
    if (this.spec) this.drop(this.spec);
    this.spec = null;
    if (!words) return;
    this.heard.push(words);
    this.finalAt = now;
    if (this.t.endpointing === "theirs") {
      this.commit();
      return;
    }
    // Start answering now; the answer is held until the pause says the turn is over.
    if (!this.reply) this.spec = this.answer(this.heard.join(" "), false);
    this.pause = setTimeout(() => this.commit(), this.agent.turn.pauseMs);
  }

  /** The caller's turn is over. */
  private commit(): void {
    this.pause = null;
    const input = this.heard.join(" ").trim();
    if (!input || this.over) return;
    if (this.reply) {
      // Not barged (it's off): answer once ours is done.
      this.commitWhenFree = true;
      return;
    }
    const now = this.clock();
    const speechEnd = this.silenceAt ?? this.lastVoiceAt ?? now;
    const finalAt = this.finalAt ?? now;
    this.heard = [];
    this.silenceAt = this.lastVoiceAt = this.finalAt = null;
    this.line({ who: "caller", text: input });
    let r = this.spec;
    this.spec = null;
    if (r && r.input !== input) {
      this.drop(r);
      r = null;
    }
    r ??= this.answer(input, true);
    r.marks.speechEnd = speechEnd;
    r.marks.final = finalAt;
    r.marks.end = now;
    this.reply = r;
    if (!r.committed) {
      r.committed = true;
      for (const out of r.held.splice(0)) this.send(r, out);
      r.open();
      if (r.generated) this.lineSaid(r);
    }
    if (r.generated && !this.speaking) this.settle(r);
  }

  // Ours.

  private newReply(input: string, committed: boolean, speculative: boolean): Reply {
    let open = () => {};
    const gate = new Promise<void>((ok) => {
      open = ok;
    });
    if (committed) open();
    return {
      n: this.n++,
      input,
      abort: new AbortController(),
      committed,
      gate,
      open,
      held: [],
      voice: Promise.resolve(),
      marks: { speechEnd: null, final: null, end: null, token: null, audio: null, heard: null },
      said: [],
      tools: [],
      speculative,
      barged: false,
      generated: false,
      linedTo: 0,
      lastLine: null,
    };
  }

  private opener(): void {
    const r = this.newReply("", true, false);
    const now = this.clock();
    r.marks = { speechEnd: now, final: now, end: now, token: now, audio: null, heard: null };
    this.reply = r;
    this.say(r, openingLine(this.agent, this.o.callerState ?? null));
    void r.voice.then(() => {
      r.generated = true;
      this.lineSaid(r);
      if (!this.speaking) this.settle(r);
    });
  }

  /** Start the brain on `input`: committed, or speculative (held until the turn is over). */
  private answer(input: string, committed: boolean): Reply {
    const r = this.newReply(input, committed, !committed);
    void this.think(r).catch((err: unknown) => {
      if (r.abort.signal.aborted) return;
      this.o.onLine?.({ who: "tool", tool: "error", text: String(err) });
      void this.hangUp("failed", "Sorry, something went wrong on my end. Please call back.");
    });
    return r;
  }

  private async think(r: Reply): Promise<void> {
    await this.leadAsked;
    const { brain } = this.o.pipeline;
    const tools = toolsOf(this.agent);
    let effect: Effect | undefined;
    for (let hop = 0; hop < MAX_HOPS; hop++) {
      const transcript = r.committed
        ? [...this.transcript]
        : [...this.transcript, { who: "caller" as const, text: r.input }];
      const cut = new SentenceCutter();
      let tool: { name: string; args: Record<string, unknown> } | null = null;
      for await (const thought of brain.think(
        { system: systemOf(this.agent), lead: this.lead, transcript, tools },
        r.abort.signal,
      )) {
        if (r.abort.signal.aborted) return;
        if (thought.kind === "tool") {
          tool = thought;
          break;
        }
        r.marks.token ??= this.clock();
        for (const s of cut.push(thought.text)) this.say(r, s);
      }
      if (r.abort.signal.aborted) return;
      const rest = cut.flush();
      if (rest) this.say(r, rest);
      if (!tool) break;
      // A tool may book: never on a turn the caller might still take back.
      await r.gate;
      if (r.abort.signal.aborted) return;
      r.tools.push(tool.name);
      if (tool.name !== "endCall" && tool.name !== "lookUpLead") this.filler(r);
      this.lineSaid(r);
      // A port that fails (the calendar unreachable) is words for the brain, not a dead call.
      const result = await runTool(tool.name, tool.args, this.o.ports, this.ctx()).catch(() => ({
        says: `${tool.name} didn't work just now. Offer to take a message.`,
        effect: undefined,
      }));
      // What it did stands even if the caller cut in meanwhile: a booking made is made.
      this.line({ who: "tool", tool: tool.name, text: result.says });
      effect = result.effect;
      if (effect?.kind === "lead") this.lead = effect.lead;
      if (effect?.kind === "booked") this.booking = { id: effect.id, start: effect.start };
      if (effect?.kind === "message") this.message = effect.text;
      if (r.abort.signal.aborted) return;
      if (effect?.kind === "end" || effect?.kind === "transfer") break;
    }
    await r.voice;
    if (r.abort.signal.aborted) return;
    r.generated = true;
    // A held answer's words go in after the caller's line, when the turn commits.
    if (r.committed) this.lineSaid(r);
    if (effect?.kind === "transfer") {
      await this.drained();
      this.transferred = true;
      await this.t.transfer(effect.to);
      return this.end("transferred");
    }
    if (effect?.kind === "end") {
      await this.drained();
      return this.hangUp("ended");
    }
    if (r.committed && !this.speaking) this.settle(r);
  }

  /** Queue one sentence: text as is, or the mouth's frames as they come. */
  private say(r: Reply, text: string): void {
    r.said.push(text);
    const { mouth } = this.o.pipeline;
    r.voice = r.voice
      .then(async () => {
        if (r.abort.signal.aborted) return;
        if (this.t.carries === "text" || !mouth)
          return this.emit(r, { kind: "text", text, turn: r.n });
        for await (const frame of mouth.speak(text, r.abort.signal)) {
          if (r.abort.signal.aborted) return;
          this.emit(r, { kind: "audio", frame, turn: r.n });
        }
      })
      .catch((err: unknown) => this.broke(err));
  }

  /** The mouth or the line failed: nothing more can be said, so the call ends. */
  private broke(err: unknown): void {
    if (this.over) return;
    this.o.onLine?.({ who: "tool", tool: "error", text: String(err) });
    void this.hangUp("failed");
  }

  /** A filler while a tool runs: the cached audio, rotating through the agent's lines. */
  private filler(r: Reply): void {
    const lines = this.agent.fillers;
    const line = lines[this.fillerAt++ % Math.max(1, lines.length)];
    if (!line) return;
    const cached = this.fillers.get(line);
    if (!cached || this.t.carries === "text") {
      this.say(r, line);
      return;
    }
    r.said.push(line);
    r.voice = r.voice
      .then(() => {
        for (const frame of cached) this.emit(r, { kind: "audio", frame, turn: r.n });
      })
      .catch((err: unknown) => this.broke(err));
  }

  private emit(r: Reply, out: Outgoing): void {
    if (r.abort.signal.aborted) return;
    if (!r.committed) {
      r.held.push(out);
      return;
    }
    this.send(r, out);
  }

  private send(r: Reply, out: Outgoing): void {
    r.marks.audio ??= this.clock();
    this.speaking = true;
    this.t.send(out);
  }

  /** Waits until what we sent has played, at most 15 s. */
  private async drained(): Promise<void> {
    for (let i = 0; i < 150 && this.speaking && !this.over; i++) await sleep(100);
  }

  private drop(r: Reply): void {
    r.abort.abort();
  }

  /** A reply is done (or barged): its turn is recorded, and a waiting turn goes next. */
  private settle(r: Reply): void {
    if (this.reply !== r) return;
    this.reply = null;
    this.lineSaid(r);
    const end = r.marks.speechEnd ?? 0;
    const rel = (x: number | null) => (x === null ? null : Math.max(0, Math.round(x - end)));
    const turn: Turn = {
      // Dropped answers took numbers too: turns count from the opener, 0.
      n: this.turns.length,
      caller: r.input,
      agent: r.said.join(" "),
      tools: r.tools,
      speculative: r.speculative,
      barged: r.barged,
      ms: {
        final: rel(r.marks.final),
        end: rel(r.marks.end),
        token: rel(r.marks.token),
        audio: rel(r.marks.audio),
        heard: rel(r.marks.heard),
      },
    };
    this.turns.push(turn);
    this.o.onTurn?.(turn);
    if (this.commitWhenFree) {
      this.commitWhenFree = false;
      this.commit();
    }
  }

  /** What the reply said since its last line, as one agent line. */
  private lineSaid(r: Reply): void {
    const text = r.said.slice(r.linedTo).join(" ").trim();
    r.linedTo = r.said.length;
    if (text) {
      r.lastLine = { who: "agent", text: r.barged ? `${text} (cut off)` : text };
      this.line(r.lastLine);
    } else if (r.barged && r.lastLine && !r.lastLine.text.endsWith("(cut off)"))
      r.lastLine.text += " (cut off)";
  }

  private line(l: Line): void {
    this.transcript.push(l);
    this.o.onLine?.(l);
  }

  private async hangUp(outcome: Outcome, goodbye?: string): Promise<void> {
    if (this.over) return;
    this.ended = outcome;
    if (goodbye && this.call) {
      const r = this.newReply("", true, false);
      r.marks.speechEnd = this.clock();
      this.say(r, goodbye);
      await r.voice;
      this.lineSaid(r);
      await this.drained();
    }
    await this.t.hangup().catch(() => {});
    this.end(outcome);
  }

  private end(outcome: Outcome): void {
    if (this.over) return;
    this.over = true;
    for (const t of [this.pause, this.limit]) if (t) clearTimeout(t);
    this.spec?.abort.abort();
    if (this.reply) {
      this.reply.abort.abort();
      this.settle(this.reply);
    }
    this.ear?.close();
    const best: Outcome = this.booking
      ? "booked"
      : this.transferred
        ? "transferred"
        : this.message
          ? "message"
          : outcome;
    this.finish({
      call: this.call ?? { id: "", from: "", to: "", direction: "test" },
      pipeline: pipelineName(this.o.pipeline),
      outcome: best,
      lead: this.lead,
      transcript: this.transcript,
      turns: this.turns,
      booking: this.booking,
      message: this.message,
      startedAt: this.startedAt,
      endedAt: this.date(),
    });
  }
}

const sleep = (ms: number) => new Promise<void>((ok) => setTimeout(ok, ms));

async function collect(frames: AsyncIterable<Frame>): Promise<Frame[]> {
  const out: Frame[] = [];
  for await (const f of frames) out.push(f);
  return out;
}

/**
 * A spoken test call in the browser at $0: the browser's own speech recognition is the ears and
 * its speech synthesis the mouth, so the session sees text, as on a typed call. The browser says
 * when a phrase is final (its own end of speech), and each utterance's start and end are the
 * played and idle marks, so the turn timing reads true.
 *
 * The page hands in `SpeechApi` (the portal builds it from `window`), so this file needs no DOM.
 * Our own voice coming back through the mic would cut us off: while we speak, words that are
 * part of what we're saying are dropped. Headphones avoid it altogether.
 */
import type { CallStart, Incoming, Outgoing, Transport } from "../types.js";

export interface SpeechApi {
  /** Start listening, continuously, interim results on. */
  listen(on: {
    partial(text: string): void;
    final(text: string): void;
    /** Stopped by itself (silence, a network blip): the transport starts it again. */
    stopped(): void;
    error(why: string): void;
  }): { stop(): void };
  /** Say one utterance. */
  speak(text: string, on: { start(): void; end(): void }): void;
  /** Stop speaking and drop the queue. */
  cancel(): void;
}

const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, "")
    .replace(/\s+/g, " ")
    .trim();

export class BrowserTransport implements Transport {
  readonly name: string = "browser";
  readonly carries = "text" as const;
  readonly endpointing = "theirs" as const;
  private on: (e: Incoming) => void = () => {};
  private ear: { stop(): void } | null = null;
  private live = false;
  private pending = 0;
  private saying = "";
  private lastTurn = -1;

  constructor(
    private readonly call: CallStart,
    private readonly api: SpeechApi,
    private readonly callee: {
      said?(text: string, turn: number): void;
      ended(how: { transferredTo: string | null }): void;
      error?(why: string): void;
    },
  ) {}

  async open(on: (e: Incoming) => void): Promise<void> {
    this.on = on;
    this.live = true;
    on({ kind: "start", call: this.call });
    this.listen();
  }

  private listen(): void {
    this.ear = this.api.listen({
      partial: (text) => {
        if (!this.echo(text)) this.on({ kind: "words", text, final: false });
      },
      final: (text) => {
        if (!this.echo(text)) this.on({ kind: "words", text, final: true });
      },
      stopped: () => {
        if (this.live) this.listen();
      },
      error: (why) => this.callee.error?.(why),
    });
  }

  /** Our own words heard back through the mic. */
  private echo(text: string): boolean {
    const t = norm(text);
    return this.pending > 0 && t.length > 0 && norm(this.saying).includes(t);
  }

  send(out: Outgoing): void {
    if (!this.live || out.kind !== "text") return;
    const first = out.turn !== this.lastTurn;
    this.lastTurn = out.turn;
    this.callee.said?.(out.text, out.turn);
    this.pending++;
    this.saying = `${this.saying} ${out.text}`.slice(-600);
    this.api.speak(out.text, {
      start: () => {
        if (first) this.on({ kind: "played", turn: out.turn });
      },
      end: () => {
        this.pending = Math.max(0, this.pending - 1);
        if (this.pending === 0) {
          this.saying = "";
          this.on({ kind: "idle" });
        }
      },
    });
  }

  clear(): void {
    this.pending = 0;
    this.saying = "";
    this.api.cancel();
  }

  /** The caller hangs up. */
  leave(): void {
    if (!this.live) return;
    this.stop();
    this.on({ kind: "hangup" });
  }

  async transfer(to: string): Promise<void> {
    this.stop();
    this.callee.ended({ transferredTo: to });
  }

  async hangup(): Promise<void> {
    this.stop();
    this.callee.ended({ transferredTo: null });
  }

  private stop(): void {
    this.live = false;
    this.ear?.stop();
    this.ear = null;
  }
}

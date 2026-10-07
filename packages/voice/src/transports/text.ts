/**
 * A typed call: the caller's lines in, ours out as text. The portal's test call, and a quick way
 * to talk to an agent from a test. No ears or mouth: the words are the words. A line sent is a
 * turn over (Enter ends a turn); typing while the agent answers cuts it off, like talking over it.
 */
import type { CallStart, Incoming, Outgoing, Transport } from "../types.js";

export interface TextCallee {
  /** One of our sentences, as it's sent. */
  said(text: string, turn: number): void;
  /** The agent put the call through, or hung up. */
  ended(how: { transferredTo: string | null }): void;
}

export class TextTransport implements Transport {
  readonly name: string = "text";
  readonly carries = "text" as const;
  readonly endpointing = "theirs" as const;
  private on: (e: Incoming) => void = () => {};
  private lastTurn = -1;
  private open_ = false;

  constructor(
    private readonly call: CallStart,
    private readonly callee: TextCallee,
  ) {}

  async open(on: (e: Incoming) => void): Promise<void> {
    this.on = on;
    this.open_ = true;
    on({ kind: "start", call: this.call });
  }

  /** The caller sends a line. */
  type(text: string): void {
    if (this.open_ && text.trim()) this.on({ kind: "words", text, final: true });
  }

  /** The caller started typing: cuts us off when the agent allows it. */
  typing(): void {
    if (this.open_) this.on({ kind: "words", text: "", final: false });
  }

  /** The caller hangs up. */
  leave(): void {
    if (!this.open_) return;
    this.open_ = false;
    this.on({ kind: "hangup" });
  }

  send(out: Outgoing): void {
    if (!this.open_ || out.kind !== "text") return;
    this.callee.said(out.text, out.turn);
    const first = out.turn !== this.lastTurn;
    this.lastTurn = out.turn;
    // After the send returns: the session is mid-send when these arrive otherwise.
    queueMicrotask(() => {
      if (first) this.on({ kind: "played", turn: out.turn });
      this.on({ kind: "idle" });
    });
  }

  clear(): void {}

  async transfer(to: string): Promise<void> {
    this.open_ = false;
    this.callee.ended({ transferredTo: to });
  }

  async hangup(): Promise<void> {
    this.open_ = false;
    this.callee.ended({ transferredTo: null });
  }
}

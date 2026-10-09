/** The page's speakers for reading aloud: Web Audio, one sentence after another. */
import type { Frame } from "@wren/voice";
import { type Speakers, samples } from "@wren/voice/reading";

export class PageSpeakers implements Speakers {
  #ctx: AudioContext | null = null;

  /** Call inside the press: a browser only lets sound start from one. */
  wake(): void {
    this.#ctx ??= new AudioContext();
    if (this.#ctx.state === "suspended") void this.#ctx.resume();
  }

  play(frames: Frame[], signal: AbortSignal): Promise<void> {
    this.wake();
    const ctx = this.#ctx as AudioContext;
    const parts = frames.map(samples);
    const length = parts.reduce((n, p) => n + p.length, 0);
    if (!length || signal.aborted) return Promise.resolve();
    const buf = ctx.createBuffer(1, length, frames[0]?.rate ?? 24_000);
    let at = 0;
    for (const p of parts) {
      buf.copyToChannel(p as Float32Array<ArrayBuffer>, 0, at);
      at += p.length;
    }
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(ctx.destination);
    return new Promise((ok) => {
      const stop = () => {
        try {
          src.stop();
        } catch {}
        ok();
      };
      signal.addEventListener("abort", stop, { once: true });
      src.onended = () => {
        signal.removeEventListener("abort", stop);
        ok();
      };
      src.start();
    });
  }
}

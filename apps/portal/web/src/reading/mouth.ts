/**
 * The reading voice as the voice agent's `Mouth`: Kokoro in its worker (voice.worker.ts), loaded
 * on the first press. One sentence in, one 24 kHz `pcm16` frame out. The page keeps one.
 */
import type { Frame, Mouth } from "@wren/voice";
import { pcm16 } from "@wren/voice/reading";
import { type FromVoice, READ_RATE, type ToVoice, type Voice } from "./protocol.js";

export class KokoroMouth implements Mouth {
  readonly name = "kokoro";
  #worker: Worker | null = null;
  #ready: Promise<"webgpu" | "wasm"> | null = null;
  #next = 1;
  #waiting = new Map<number, { ok: (a: Float32Array) => void; no: (e: Error) => void }>();
  #progress = new Set<(n: number) => void>();
  voice: Voice = "af_heart";
  speed = 1;
  /** Where it runs, once loaded. */
  device: "webgpu" | "wasm" | null = null;

  #start(): Worker {
    if (this.#worker) return this.#worker;
    const w = new Worker(new URL("./voice.worker.ts", import.meta.url), {
      type: "module",
      name: "reading",
    });
    w.onmessage = (e: MessageEvent<FromVoice>) => {
      const m = e.data;
      if (m.type === "progress") for (const f of this.#progress) f(m.progress);
      else if (m.type === "audio" || (m.type === "fail" && m.id !== undefined)) {
        const job = this.#waiting.get(m.id as number);
        this.#waiting.delete(m.id as number);
        if (m.type === "audio") job?.ok(m.audio);
        else job?.no(new Error(m.message));
      }
    };
    w.onerror = (e) => {
      for (const job of this.#waiting.values())
        job.no(new Error(e.message || "The reading voice stopped."));
      this.#waiting.clear();
    };
    this.#worker = w;
    return w;
  }

  get loaded(): boolean {
    return this.device !== null;
  }

  /** Loads the voice once; `progress` hears 0..1 while the weights download. */
  load(progress?: (n: number) => void): Promise<"webgpu" | "wasm"> {
    if (progress) this.#progress.add(progress);
    this.#ready ??= new Promise((ok, no) => {
      const w = this.#start();
      const hear = (e: MessageEvent<FromVoice>) => {
        if (e.data.type === "ready") {
          w.removeEventListener("message", hear);
          this.device = e.data.device;
          ok(e.data.device);
        } else if (e.data.type === "fail" && e.data.id === undefined) {
          w.removeEventListener("message", hear);
          no(new Error(e.data.message));
        }
      };
      w.addEventListener("message", hear);
      w.postMessage({ type: "load" } satisfies ToVoice);
    });
    this.#ready.catch(() => {
      this.#ready = null;
    });
    return this.#ready.finally(() => {
      if (progress) this.#progress.delete(progress);
    });
  }

  async *speak(text: string, signal: AbortSignal): AsyncIterable<Frame> {
    await this.load();
    if (signal.aborted) return;
    const id = this.#next++;
    const audio = await new Promise<Float32Array>((ok, no) => {
      this.#waiting.set(id, { ok, no });
      this.#start().postMessage({
        type: "run",
        id,
        text,
        voice: this.voice,
        speed: this.speed,
      } satisfies ToVoice);
    });
    if (signal.aborted) return;
    yield pcm16(audio, READ_RATE);
  }
}

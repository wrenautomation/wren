/**
 * The browser adapter's `Transcriber`: the speech model in its worker (model.worker.ts), loaded
 * on the first mic press. The page keeps one.
 */
import type { Transcriber } from "@wren/voice/dictation";
import { BROWSER_MODEL, type FromModel, type ToModel } from "./protocol.js";

export { BROWSER_MODEL, BROWSER_REVISION } from "./protocol.js";

export class BrowserModel implements Transcriber {
  readonly name = "browser";
  readonly model = BROWSER_MODEL;
  #worker: Worker | null = null;
  #ready: Promise<void> | null = null;
  #next = 1;
  #waiting = new Map<number, { ok: (t: string) => void; no: (e: Error) => void }>();
  #progress = new Set<(n: number) => void>();
  loaded = false;

  #start(): Worker {
    if (this.#worker) return this.#worker;
    const w = new Worker(new URL("./model.worker.ts", import.meta.url), {
      type: "module",
      name: "dictation",
    });
    w.onmessage = (e: MessageEvent<FromModel>) => {
      const m = e.data;
      if (m.type === "progress") for (const f of this.#progress) f(m.progress);
      else if (m.type === "text" || (m.type === "fail" && m.id !== undefined)) {
        const job = this.#waiting.get(m.id as number);
        this.#waiting.delete(m.id as number);
        if (m.type === "text") job?.ok(m.text);
        else job?.no(new Error(m.message));
      }
    };
    w.onerror = (e) => {
      for (const job of this.#waiting.values())
        job.no(new Error(e.message || "The speech model stopped."));
      this.#waiting.clear();
    };
    this.#worker = w;
    return w;
  }

  /** Loads the model once; `progress` hears 0..1 while the weights download. */
  load(progress?: (n: number) => void): Promise<void> {
    if (progress) this.#progress.add(progress);
    const done = () => {
      if (progress) this.#progress.delete(progress);
    };
    this.#ready ??= new Promise<void>((ok, no) => {
      const w = this.#start();
      const hear = (e: MessageEvent<FromModel>) => {
        if (e.data.type === "ready") {
          w.removeEventListener("message", hear);
          this.loaded = true;
          ok();
        } else if (e.data.type === "fail" && e.data.id === undefined) {
          w.removeEventListener("message", hear);
          no(new Error(e.data.message));
        }
      };
      w.addEventListener("message", hear);
      w.postMessage({ type: "load" } satisfies ToModel);
    });
    this.#ready.catch(() => {
      this.#ready = null;
    });
    return this.#ready.finally(done);
  }

  async transcribe(
    audio: Float32Array,
    o: { final: boolean; signal?: AbortSignal },
  ): Promise<string> {
    await this.load();
    if (o.signal?.aborted) throw new DOMException("dropped", "AbortError");
    const id = this.#next++;
    const copy = audio.slice();
    return new Promise<string>((ok, no) => {
      this.#waiting.set(id, { ok, no });
      this.#start().postMessage(
        { type: "run", id, audio: copy, final: o.final } satisfies ToModel,
        [copy.buffer],
      );
    });
  }
}

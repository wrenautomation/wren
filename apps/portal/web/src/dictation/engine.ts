/**
 * The portal's dictation (designs/2026-10-07-dictation.md): routes each press to the browser's
 * model, our server or the browser's own speech, runs the mic through `startDictation`, and
 * hands the kit's `Dictate` its words. One per page.
 */
import type { DictateEvents, DictateHandle, DictateStatus, DictationEngine } from "@wren/ui";
import type { Ears } from "@wren/voice";
import {
  type Adapter,
  type Can,
  CHOICES,
  type Choice,
  type DictationRun,
  pcmFrame,
  pickAdapter,
  startDictation,
  TranscriberEars,
} from "@wren/voice/dictation";
import { recognitionClass } from "../modules/voice/speech.js";
import { micError, openMic } from "./mic.js";
import { BrowserModel } from "./model.js";
import { ServerModel, serverDictation } from "./server.js";
import { SpeechEars } from "./speech.js";

export interface DictateSettings {
  choice: Choice;
  /** The browser's own speech when nothing else runs: audio goes to Google or Apple. */
  fallback: boolean;
}

const KEY = "wren.dictate";
const DEFAULTS: DictateSettings = { choice: "auto", fallback: false };

export function readSettings(): DictateSettings {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "null") as Partial<DictateSettings> | null;
    return {
      choice: CHOICES.includes(raw?.choice as Choice) ? (raw?.choice as Choice) : DEFAULTS.choice,
      fallback: raw?.fallback === true,
    };
  } catch {
    return DEFAULTS;
  }
}

/** A server run needs this much new audio for a partial: each one is a request. */
const SERVER_PARTIAL_MS = 1500;

/** One finished dictation, for the latency panel: timings only, never the words. */
export interface DictationReport extends DictationRun {
  adapter: Adapter;
  model: string;
  /** Press to model ready, when this press loaded it. */
  loadMs: number | null;
}

const hasWebGpu = async (): Promise<boolean> => {
  const gpu = (navigator as { gpu?: { requestAdapter(): Promise<unknown> } }).gpu;
  if (!gpu) return false;
  try {
    return !!(await gpu.requestAdapter());
  } catch {
    return false;
  }
};

export class PortalDictation implements DictationEngine {
  #settings = readSettings();
  #can: Can | null = null;
  #failed = new Set<Adapter>();
  #status: DictateStatus = { state: "off" };
  #subs = new Set<() => void>();
  #browser = new BrowserModel();
  #server: ServerModel | null = null;
  /** Where finished dictations' timings go; the app sets it for Wren's team. */
  report: ((r: DictationReport) => void) | null = null;

  constructor() {
    void this.#probe();
  }

  async #probe() {
    const [webgpu, server] = await Promise.all([hasWebGpu(), serverDictation()]);
    this.#server = server.on ? new ServerModel(server.model ?? "server") : null;
    this.#can = { webgpu, server: server.on, speech: !!recognitionClass(), fallback: false };
    this.#route();
  }

  #route() {
    if (!this.#can) return;
    const r = pickAdapter(this.#settings.choice, {
      ...this.#can,
      fallback: this.#settings.fallback,
      failed: [...this.#failed],
    });
    this.#status =
      this.#settings.choice === "off"
        ? { state: "off" }
        : r.adapter
          ? { state: "ready", adapter: r.adapter }
          : { state: "unavailable", why: r.why };
    for (const f of this.#subs) f();
  }

  status = () => this.#status;
  subscribe = (fn: () => void) => {
    this.#subs.add(fn);
    return () => {
      this.#subs.delete(fn);
    };
  };

  settings(): DictateSettings {
    return this.#settings;
  }
  set(next: DictateSettings) {
    this.#settings = next;
    try {
      localStorage.setItem(KEY, JSON.stringify(next));
    } catch {
      // No storage here: the pick lasts this visit.
    }
    this.#route();
  }

  start = (on: DictateEvents): DictateHandle => {
    const status = this.#status;
    let state: "starting" | "live" | "stopping" | "over" = "starting";
    let stopAsked = false;
    let close: (() => void) | null = null;
    let finish: (() => Promise<void>) | null = null;
    // A function, so checks after an await read the state now.
    const over = () => state === "over";
    const end = () => {
      state = "over";
      close?.();
    };
    const go = async () => {
      if (status.state !== "ready") throw new Error("Dictation isn't available here.");
      const adapter = status.adapter as Adapter;
      let failure: unknown = null;
      const onError = (e: unknown) => {
        failure = e;
      };
      let loadMs: number | null = null;
      let ears: Ears;
      let model: string;
      if (adapter === "browser") {
        const t0 = performance.now();
        const cold = !this.#browser.loaded;
        on.phase({ kind: "loading", progress: cold ? 0 : null });
        try {
          await this.#browser.load(
            (n) => state === "starting" && on.phase({ kind: "loading", progress: n }),
          );
        } catch {
          this.#failed.add("browser");
          this.#route();
          throw new Error("The speech model didn't load. Reload to try again.");
        }
        loadMs = cold ? Math.round(performance.now() - t0) : null;
        ears = new TranscriberEars(this.#browser, { onError });
        model = this.#browser.model;
      } else if (adapter === "server" && this.#server) {
        ears = new TranscriberEars(this.#server, { onError, partialEveryMs: SERVER_PARTIAL_MS });
        model = this.#server.model;
      } else if (adapter === "speech") {
        ears = new SpeechEars({ onError });
        model = "web-speech";
      } else throw new Error("Dictation isn't available here.");
      if (over()) return;
      if (stopAsked) {
        // Let go while it loaded: nothing to hear, the model is ready for next time.
        end();
        on.done();
        return;
      }
      const session = startDictation({ ears, on: { partial: on.partial, final: on.final } });
      let mic: Awaited<ReturnType<typeof openMic>>;
      try {
        mic = await openMic((s, level) => {
          session.push(pcmFrame(s));
          on.level(level);
        });
      } catch (err) {
        session.cancel();
        throw new Error(micError(err));
      }
      if (over()) {
        mic.close();
        session.cancel();
        return;
      }
      close = () => {
        mic.close();
        session.cancel();
      };
      state = "live";
      on.phase({ kind: "listening" });
      finish = async () => {
        mic.close();
        const run = await session.stop();
        if (over()) return;
        state = "over";
        if (!run.words && failure) {
          on.error("Couldn't turn that into words. Try again.");
          return;
        }
        on.done();
        this.report?.({ ...run, adapter, model, loadMs });
      };
      if (stopAsked) await finish();
    };
    go().catch((err) => {
      if (over()) return;
      end();
      on.error(err instanceof Error ? err.message : String(err));
    });
    return {
      stop: () => {
        stopAsked = true;
        if (state === "live" && finish) {
          state = "stopping";
          finish().catch(() => {
            if (!over()) {
              end();
              on.error("Couldn't turn that into words. Try again.");
            }
          });
        }
      },
      cancel: end,
    };
  };
}

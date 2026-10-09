/**
 * The portal's reading aloud (designs/2026-10-07-dictation.md, Reading aloud): Kokoro in the
 * browser as the `Mouth`, the page's speakers, one reading at a time. Settings are per device.
 */
import type { ReadEvents, ReadHandle, ReadingEngine, ReadStatus } from "@wren/ui";
import { readAloud } from "@wren/voice/reading";
import { KokoroMouth } from "./mouth.js";
import { VOICES, type Voice } from "./protocol.js";
import { PageSpeakers } from "./speakers.js";

export interface ReadSettings {
  on: boolean;
  voice: Voice;
  /** 0.8 to 1.4. */
  speed: number;
}

const KEY = "wren.read";
const DEFAULTS: ReadSettings = { on: true, voice: "af_heart", speed: 1 };

export function readSettings(): ReadSettings {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "null") as Partial<ReadSettings> | null;
    const speed = Number(raw?.speed);
    return {
      on: raw?.on !== false,
      voice: VOICES.some(([v]) => v === raw?.voice) ? (raw?.voice as Voice) : DEFAULTS.voice,
      speed: speed >= 0.8 && speed <= 1.4 ? speed : DEFAULTS.speed,
    };
  } catch {
    return DEFAULTS;
  }
}

export class PortalReading implements ReadingEngine {
  #settings = readSettings();
  #subs = new Set<() => void>();
  #mouth = new KokoroMouth();
  #speakers = new PageSpeakers();
  #current: { ctl: AbortController; on: ReadEvents } | null = null;
  #status: ReadStatus;

  constructor() {
    this.#status = this.#statusNow();
    this.#apply();
  }

  #statusNow(): ReadStatus {
    if (!this.#settings.on) return { state: "off" };
    if (typeof Worker === "undefined" || typeof AudioContext === "undefined")
      return { state: "unavailable", why: "This browser can't play the reading voice." };
    return { state: "ready" };
  }

  #apply() {
    this.#mouth.voice = this.#settings.voice;
    this.#mouth.speed = this.#settings.speed;
  }

  status = (): ReadStatus => this.#status;

  subscribe = (fn: () => void): (() => void) => {
    this.#subs.add(fn);
    return () => this.#subs.delete(fn);
  };

  settings(): ReadSettings {
    return this.#settings;
  }

  /** Where the voice runs once loaded: "webgpu", "wasm", or null before the first reading. */
  device(): "webgpu" | "wasm" | null {
    return this.#mouth.device;
  }

  set(next: ReadSettings) {
    this.#settings = next;
    try {
      localStorage.setItem(KEY, JSON.stringify(next));
    } catch {}
    this.#apply();
    if (!next.on) this.#current?.ctl.abort();
    this.#status = this.#statusNow();
    for (const f of this.#subs) f();
  }

  read = (text: string, on: ReadEvents): ReadHandle => {
    this.#stopCurrent();
    // Inside the press: a browser only lets sound start from one.
    this.#speakers.wake();
    const ctl = new AbortController();
    const mine = { ctl, on };
    this.#current = mine;
    void (async () => {
      try {
        if (!this.#mouth.loaded) {
          on.phase({ kind: "loading", progress: null });
          await this.#mouth.load(
            (n) => !ctl.signal.aborted && on.phase({ kind: "loading", progress: n }),
          );
        }
        if (ctl.signal.aborted) return;
        await readAloud(this.#mouth, this.#speakers, text, ctl.signal, {
          sentence: (at, of) => on.phase({ kind: "reading", at, of }),
        });
        if (this.#current === mine) this.#current = null;
        on.done();
      } catch (err) {
        if (this.#current === mine) this.#current = null;
        if (ctl.signal.aborted) return on.done();
        on.error(`Couldn't read it: ${err instanceof Error ? err.message : String(err)}`);
      }
    })();
    return {
      stop: () => {
        if (this.#current !== mine) return;
        this.#current = null;
        ctl.abort();
        on.done();
      },
    };
  };

  #stopCurrent() {
    const c = this.#current;
    if (!c) return;
    this.#current = null;
    c.ctl.abort();
    c.on.done();
  }
}

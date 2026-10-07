/**
 * The fallback adapter: the browser's own speech recognition as `Ears`. Off unless he turns it
 * on, since Chrome sends the audio to Google and Safari to Apple. It opens its own mic; the
 * frames pushed in only time the dictation.
 */
import type { EarStream, Ears, Heard } from "@wren/voice";
import { recognitionClass } from "../modules/voice/speech.js";

/** How long a release waits for the last words before it lets go. */
const LAST_WORDS_MS = 3000;

export class SpeechEars implements Ears {
  readonly name = "speech";
  constructor(private readonly o: { lang?: string; onError?: (err: unknown) => void } = {}) {}

  open(on: (h: Heard) => void): EarStream {
    const Rec = recognitionClass();
    if (!Rec) throw new Error("This browser has no speech recognition.");
    const rec = new Rec();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = this.o.lang ?? "en-US";
    let ended!: () => void;
    const end = new Promise<void>((ok) => {
      ended = ok;
    });
    rec.onresult = (e) => {
      let partial = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (!r) continue;
        const text = r[0].transcript.trim();
        if (r.isFinal) {
          if (text) on({ kind: "final", text });
        } else partial += `${partial ? " " : ""}${text}`;
      }
      if (partial) on({ kind: "partial", text: partial });
    };
    rec.onend = () => ended();
    rec.onerror = (e) => {
      if (e.error !== "no-speech" && e.error !== "aborted") this.o.onError?.(new Error(e.error));
    };
    rec.start();
    return {
      push() {},
      close() {
        rec.abort();
        ended();
      },
      async finish() {
        rec.stop();
        await Promise.race([end, new Promise((ok) => setTimeout(ok, LAST_WORDS_MS))]);
      },
    };
  }
}

/**
 * The browser's own speech, as `@wren/voice`'s `SpeechApi`: recognition for the ears, synthesis
 * for the mouth. Free and on this machine; Chrome and Safari have both, Firefox only the mouth.
 */
import type { SpeechApi } from "@wren/voice";

interface Alternative {
  transcript: string;
}
interface Result {
  isFinal: boolean;
  0: Alternative;
}
interface ResultEvent {
  resultIndex: number;
  results: { length: number; [i: number]: Result };
}
interface Recognition {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((e: ResultEvent) => void) | null;
  onend: (() => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}
type RecognitionClass = new () => Recognition;

const recognitionClass = (): RecognitionClass | null => {
  const w = globalThis as unknown as {
    SpeechRecognition?: RecognitionClass;
    webkitSpeechRecognition?: RecognitionClass;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
};

/** Whether this browser can hold a spoken test call, or why not. */
export function speechSupport(): { ok: true } | { ok: false; why: string } {
  if (!recognitionClass()) return { ok: false, why: "This browser can't hear you. Try Chrome." };
  if (!("speechSynthesis" in globalThis)) return { ok: false, why: "This browser can't speak." };
  return { ok: true };
}

const QUIET_ERRORS = new Set(["no-speech", "aborted"]);

const ERRORS: Record<string, string> = {
  "not-allowed": "The microphone is blocked. Allow it in the address bar and start again.",
  "audio-capture": "No microphone found.",
  network: "Speech recognition lost its connection.",
};

/** One instance per call; `cancel` drops what was queued and its late callbacks. */
export function browserSpeech(lang = "en-US"): SpeechApi {
  const Rec = recognitionClass();
  let generation = 0;
  return {
    listen(on) {
      if (!Rec) {
        on.error("This browser can't hear you.");
        return { stop() {} };
      }
      const rec = new Rec();
      rec.continuous = true;
      rec.interimResults = true;
      rec.lang = lang;
      let stopped = false;
      rec.onresult = (e) => {
        let partial = "";
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const r = e.results[i];
          if (!r) continue;
          const text = r[0].transcript.trim();
          if (r.isFinal) {
            if (text) on.final(text);
          } else partial += `${partial ? " " : ""}${text}`;
        }
        if (partial) on.partial(partial);
      };
      rec.onend = () => {
        if (!stopped) on.stopped();
      };
      rec.onerror = (e) => {
        if (QUIET_ERRORS.has(e.error)) return;
        stopped = e.error === "not-allowed" || e.error === "audio-capture";
        on.error(ERRORS[e.error] ?? `Speech recognition failed (${e.error}).`);
      };
      rec.start();
      return {
        stop() {
          stopped = true;
          rec.abort();
        },
      };
    },
    speak(text, on) {
      const mine = generation;
      const u = new SpeechSynthesisUtterance(text);
      u.lang = lang;
      let done = false;
      const end = () => {
        if (done || mine !== generation) return;
        done = true;
        on.end();
      };
      u.onstart = () => {
        if (mine === generation) on.start();
      };
      u.onend = end;
      u.onerror = end;
      speechSynthesis.speak(u);
    },
    cancel() {
      generation++;
      speechSynthesis.cancel();
    },
  };
}

/**
 * A batch speech model, under the `Ears` seam: 16 kHz mono audio in, words out. The browser's
 * own model, our server and a GPU box later all fit it; `TranscriberEars` turns any of them into
 * ears with partial and final words. Isomorphic.
 */
import type { Frame } from "../types.js";

/** Every transcriber hears 16 kHz mono. */
export const DICTATION_RATE = 16_000;

export interface Transcriber {
  /** The adapter: "browser", "server", "fake". */
  readonly name: string;
  /** The model it runs, as the ledger records it. */
  readonly model: string;
  /** The words in `audio` (16 kHz, -1..1). `final` is the segment's last run, not a partial. */
  transcribe(audio: Float32Array, o: { final: boolean; signal?: AbortSignal }): Promise<string>;
}

/** Microphone samples (-1..1) as a `pcm16` frame. */
export function pcmFrame(samples: Float32Array, rate = DICTATION_RATE): Frame {
  const out = new Int16Array(samples.length);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i] ?? 0));
    out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return { encoding: "pcm16", rate, data: new Uint8Array(out.buffer) };
}

/** A `pcm16` frame back to samples. */
export function samplesOf(frame: Frame): Float32Array {
  const view = new DataView(frame.data.buffer, frame.data.byteOffset, frame.data.byteLength);
  const out = new Float32Array(frame.data.byteLength >> 1);
  for (let i = 0; i < out.length; i++) out[i] = view.getInt16(i * 2, true) / 0x8000;
  return out;
}

/** Linear resampling, for a microphone that won't run at 16 kHz. */
export function resample(samples: Float32Array, from: number, to = DICTATION_RATE): Float32Array {
  if (from === to) return samples;
  const n = Math.floor((samples.length * to) / from);
  const out = new Float32Array(n);
  const step = from / to;
  for (let i = 0; i < n; i++) {
    const x = i * step;
    const j = Math.floor(x);
    const a = samples[j] ?? 0;
    const b = samples[j + 1] ?? a;
    out[i] = a + (b - a) * (x - j);
  }
  return out;
}

/** Root mean square: how loud a slice is, 0..1. */
export function levelOf(samples: Float32Array): number {
  let sum = 0;
  for (const s of samples) sum += s * s;
  return samples.length ? Math.sqrt(sum / samples.length) : 0;
}

/** A 16-bit mono WAV, what `/audio/transcriptions` takes. */
export function wavOf(samples: Float32Array, rate = DICTATION_RATE): Uint8Array {
  const pcm = pcmFrame(samples, rate).data;
  const out = new Uint8Array(44 + pcm.byteLength);
  const v = new DataView(out.buffer);
  const tag = (at: number, s: string) => {
    for (let i = 0; i < 4; i++) v.setUint8(at + i, s.charCodeAt(i));
  };
  tag(0, "RIFF");
  v.setUint32(4, 36 + pcm.byteLength, true);
  tag(8, "WAVE");
  tag(12, "fmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, rate, true);
  v.setUint32(28, rate * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  tag(36, "data");
  v.setUint32(40, pcm.byteLength, true);
  out.set(pcm, 44);
  return out;
}

/** A WAV's samples, when it is 16-bit mono PCM at 16 kHz; null otherwise. */
export function samplesOfWav(bytes: Uint8Array): Float32Array | null {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const str = (at: number) =>
    String.fromCharCode(...bytes.subarray(at, Math.min(at + 4, bytes.length)));
  if (bytes.length < 12 || str(0) !== "RIFF" || str(8) !== "WAVE") return null;
  let at = 12;
  let ok = false;
  while (at + 8 <= bytes.length) {
    const id = str(at);
    const len = v.getUint32(at + 4, true);
    if (id === "fmt ") {
      ok =
        v.getUint16(at + 8, true) === 1 &&
        v.getUint16(at + 10, true) === 1 &&
        v.getUint32(at + 12, true) === DICTATION_RATE &&
        v.getUint16(at + 22, true) === 16;
    } else if (id === "data") {
      if (!ok) return null;
      const end = Math.min(bytes.length, at + 8 + len) & ~1;
      return samplesOf({
        encoding: "pcm16",
        rate: DICTATION_RATE,
        data: bytes.subarray(at + 8, end),
      });
    }
    at += 8 + len + (len & 1);
  }
  return null;
}

/**
 * For tests: answers with `script` one segment at a time (each final takes the next line), and a
 * partial with the words its share of the audio would hold.
 */
export class FakeTranscriber implements Transcriber {
  readonly name = "fake";
  readonly model = "fake";
  /** Every run, in order: how much audio and whether it was a final. */
  readonly runs: { samples: number; final: boolean }[] = [];
  private next = 0;
  constructor(
    private readonly script: readonly string[],
    private readonly o: { ms?: number } = {},
  ) {}
  async transcribe(audio: Float32Array, o: { final: boolean }): Promise<string> {
    this.runs.push({ samples: audio.length, final: o.final });
    if (this.o.ms) await new Promise((ok) => setTimeout(ok, this.o.ms));
    const line = this.script[this.next] ?? "";
    if (o.final) this.next++;
    if (o.final) return line;
    const words = line.split(" ");
    return words.slice(0, Math.max(1, Math.ceil(words.length / 2))).join(" ");
  }
}

/**
 * An OpenAI-compatible `/audio/transcriptions` server: Groq, a faster-whisper or Parakeet box,
 * our own GPU later. `url` is the endpoint itself. Runs where `fetch` does (the portal Worker).
 */
export function openAiTranscriber(o: {
  url: string;
  model: string;
  key?: string | undefined;
  fetch?: typeof fetch;
  language?: string;
}): Transcriber {
  const go = o.fetch ?? fetch;
  return {
    name: "server",
    model: o.model,
    async transcribe(audio, { signal }) {
      const form = new FormData();
      form.append(
        "file",
        new Blob([wavOf(audio) as Uint8Array<ArrayBuffer>], { type: "audio/wav" }),
        "a.wav",
      );
      form.append("model", o.model);
      form.append("response_format", "json");
      form.append("language", o.language ?? "en");
      const res = await go(o.url, {
        method: "POST",
        headers: o.key ? { authorization: `Bearer ${o.key}` } : {},
        body: form,
        ...(signal ? { signal } : {}),
      });
      if (!res.ok) throw new Error(`The speech server answered ${res.status}.`);
      const body = (await res.json()) as { text?: unknown };
      return typeof body.text === "string" ? body.text.trim() : "";
    },
  };
}

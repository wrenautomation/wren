/** What the page and the reading voice's worker say to each other. */

/** Kokoro 82M (Apache 2.0) at a pinned revision: designs/2026-10-07-dictation.md, Reading aloud. */
export const READ_MODEL = "onnx-community/Kokoro-82M-v1.0-ONNX";
export const READ_REVISION = "1939ad2a8e416c0acfeecc08a694d14ef25f2231";
export const READ_RATE = 24_000;

/** The voices worth offering: Kokoro's best graded, US and UK. */
export const VOICES = [
  ["af_heart", "Heart", "US"],
  ["af_bella", "Bella", "US"],
  ["af_nicole", "Nicole", "US, soft"],
  ["am_michael", "Michael", "US"],
  ["am_fenrir", "Fenrir", "US"],
  ["bf_emma", "Emma", "UK"],
  ["bm_george", "George", "UK"],
] as const;
export type Voice = (typeof VOICES)[number][0];

export type ToVoice =
  | { type: "load" }
  | { type: "run"; id: number; text: string; voice: Voice; speed: number };
export type FromVoice =
  | { type: "progress"; progress: number }
  | { type: "ready"; device: "webgpu" | "wasm" }
  | { type: "audio"; id: number; audio: Float32Array }
  | { type: "fail"; id?: number; message: string };

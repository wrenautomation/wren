/** What the page and the speech model's worker say to each other. */

/** Picked by measure (designs/2026-10-07-dictation.md): fast first words, small, MIT. */
export const BROWSER_MODEL = "onnx-community/moonshine-base-ONNX";
export const BROWSER_REVISION = "b1e9b6aae3c3c7298f10c3798393fdf38e8fbbad";

export type ToModel =
  | { type: "load" }
  | { type: "run"; id: number; audio: Float32Array; final: boolean };
export type FromModel =
  | { type: "progress"; progress: number }
  | { type: "ready" }
  | { type: "text"; id: number; text: string }
  | { type: "fail"; id?: number; message: string };

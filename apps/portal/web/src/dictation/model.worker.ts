/**
 * The browser's speech model (designs/2026-10-07-dictation.md), off the page's thread: Moonshine
 * base on WebGPU through transformers.js. Weights come from Hugging Face at a pinned revision and
 * stay in Cache Storage; onnxruntime's wasm comes gzipped from our own origin (vite.config.ts) and
 * is kept there too. Its loader is in this bundle, so no blob script is needed.
 */
import { env, pipeline } from "@huggingface/transformers";
import { BROWSER_MODEL, BROWSER_REVISION, type FromModel, type ToModel } from "./protocol.js";

const ctx = self as unknown as {
  postMessage(m: FromModel): void;
  onmessage: ((e: MessageEvent<ToModel>) => void) | null;
};

env.allowLocalModels = false;
env.useWasmCache = false;
const ort = env.backends.onnx;
const WASM = `/ort/${ort.versions?.web}/ort-wasm-simd-threaded.asyncify.wasm.gz`;
// The bundled loader, not one fetched from the CDN.
if (ort.wasm) ort.wasm.wasmPaths = undefined as never;

/** The wasm, unzipped unless something on the way already did. */
async function unzip(res: Response): Promise<ArrayBuffer> {
  const raw = await res.arrayBuffer();
  const head = new Uint8Array(raw, 0, 2);
  if (head[0] !== 0x1f || head[1] !== 0x8b) return raw;
  const out = new Blob([raw]).stream().pipeThrough(new DecompressionStream("gzip"));
  return new Response(out).arrayBuffer();
}

/** A file kept in Cache Storage after the first fetch, as it came (gzipped). */
async function kept(url: string): Promise<ArrayBuffer> {
  try {
    const box = await caches.open("wren-dictate");
    const hit = await box.match(url);
    if (hit) return await unzip(hit);
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${res.status} for ${url}`);
    await box.put(url, res.clone());
    return await unzip(res);
  } catch (err) {
    if (err instanceof Error && /^\d{3} for /.test(err.message)) throw err;
    // No Cache Storage (a private window): fetch it plain.
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${res.status} for ${url}`);
    return await unzip(res);
  }
}

type Asr = (
  audio: Float32Array,
  o: { max_new_tokens: number },
) => Promise<{ text: string } | { text: string }[]>;
let asr: Promise<Asr> | null = null;

function load(): Promise<Asr> {
  asr ??= (async () => {
    const files = new Map<string, { loaded: number; total: number }>();
    if (ort.wasm) ort.wasm.wasmBinary = await kept(WASM);
    const p = await pipeline("automatic-speech-recognition", BROWSER_MODEL, {
      revision: BROWSER_REVISION,
      device: "webgpu",
      dtype: { encoder_model: "fp32", decoder_model_merged: "q4" },
      progress_callback: (e: {
        status: string;
        file?: string;
        loaded?: number;
        total?: number;
      }) => {
        if (e.status !== "progress" || !e.file || !e.total) return;
        files.set(e.file, { loaded: e.loaded ?? 0, total: e.total });
        let loaded = 0;
        let total = 0;
        for (const f of files.values()) {
          loaded += f.loaded;
          total += f.total;
        }
        ctx.postMessage({ type: "progress", progress: total ? loaded / total : 0 });
      },
    });
    return p as unknown as Asr;
  })();
  asr.catch(() => {
    asr = null;
  });
  return asr;
}

ctx.onmessage = async (e) => {
  const m = e.data;
  if (m.type === "load") {
    try {
      await load();
      ctx.postMessage({ type: "ready" });
    } catch (err) {
      ctx.postMessage({ type: "fail", message: err instanceof Error ? err.message : String(err) });
    }
    return;
  }
  try {
    const run = await load();
    // Moonshine's own bound: about 6.5 tokens a second of audio, so silence can't run on.
    const max_new_tokens = Math.ceil((m.audio.length / 16_000) * 6.5) + 4;
    const out = await run(m.audio, { max_new_tokens });
    const text = (Array.isArray(out) ? out[0]?.text : out.text) ?? "";
    ctx.postMessage({ type: "text", id: m.id, text });
  } catch (err) {
    ctx.postMessage({
      type: "fail",
      id: m.id,
      message: err instanceof Error ? err.message : String(err),
    });
  }
};

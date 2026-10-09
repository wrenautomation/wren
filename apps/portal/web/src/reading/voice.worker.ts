/**
 * The reading voice (designs/2026-10-07-dictation.md, Reading aloud), off the page's thread:
 * Kokoro 82M through transformers.js, WebGPU when there is one, else wasm. Weights come from
 * Hugging Face at a pinned revision; voices and onnxruntime's wasm stay in Cache Storage.
 */
import { AutoTokenizer, env, StyleTextToSpeech2Model, Tensor } from "@huggingface/transformers";
import { kept } from "../dictation/kept.js";
import { phonemesOf } from "./phonemes.js";
import { type FromVoice, READ_MODEL, READ_REVISION, type ToVoice, type Voice } from "./protocol.js";

const ctx = self as unknown as {
  postMessage(m: FromVoice, transfer?: Transferable[]): void;
  onmessage: ((e: MessageEvent<ToVoice>) => void) | null;
};

env.allowLocalModels = false;
env.useWasmCache = false;
const ort = env.backends.onnx;
const WASM = `/ort/${ort.versions?.web}/ort-wasm-simd-threaded.asyncify.wasm.gz`;
if (ort.wasm) ort.wasm.wasmPaths = undefined as never;
const CACHE = "wren-read";

type Tokenizer = (t: string, o: { truncation: boolean }) => { input_ids: Tensor };
type Model = (i: Record<string, Tensor>) => Promise<{ waveform: Tensor }>;
interface Loaded {
  tokenizer: Tokenizer;
  model: Model;
  device: "webgpu" | "wasm";
}
let loaded: Promise<Loaded> | null = null;

async function webGpu(): Promise<boolean> {
  const gpu = (navigator as { gpu?: { requestAdapter(): Promise<unknown> } }).gpu;
  try {
    return !!(await gpu?.requestAdapter());
  } catch {
    return false;
  }
}

function load(): Promise<Loaded> {
  loaded ??= (async () => {
    const files = new Map<string, { loaded: number; total: number }>();
    const progress_callback = (e: {
      status: string;
      file?: string;
      loaded?: number;
      total?: number;
    }) => {
      if (e.status !== "progress" || !e.file || !e.total) return;
      files.set(e.file, { loaded: e.loaded ?? 0, total: e.total });
      let got = 0;
      let total = 0;
      for (const f of files.values()) {
        got += f.loaded;
        total += f.total;
      }
      ctx.postMessage({ type: "progress", progress: total ? got / total : 0 });
    };
    if (ort.wasm) ort.wasm.wasmBinary = await kept(WASM, CACHE);
    // Kokoro's quantized weights sound wrong on WebGPU: full size there, 8-bit on the CPU.
    const device = (await webGpu()) ? "webgpu" : "wasm";
    const [tokenizer, model] = await Promise.all([
      AutoTokenizer.from_pretrained(READ_MODEL, { revision: READ_REVISION, progress_callback }),
      StyleTextToSpeech2Model.from_pretrained(READ_MODEL, {
        revision: READ_REVISION,
        device,
        dtype: device === "webgpu" ? "fp32" : "q8",
        progress_callback,
      }),
    ]);
    return {
      tokenizer: tokenizer as unknown as Tokenizer,
      model: model as unknown as Model,
      device,
    };
  })();
  loaded.catch(() => {
    loaded = null;
  });
  return loaded;
}

const voices = new Map<Voice, Promise<Float32Array>>();
function voiceOf(v: Voice): Promise<Float32Array> {
  let got = voices.get(v);
  if (!got) {
    const url = `https://huggingface.co/${READ_MODEL}/resolve/${READ_REVISION}/voices/${v}.bin`;
    got = kept(url, CACHE).then((b) => new Float32Array(b));
    got.catch(() => voices.delete(v));
    voices.set(v, got);
  }
  return got;
}

async function speak(text: string, voice: Voice, speed: number): Promise<Float32Array> {
  const [{ tokenizer, model }, style] = await Promise.all([load(), voiceOf(voice)]);
  const phonemes = await phonemesOf(text, voice.startsWith("a"));
  const { input_ids } = tokenizer(phonemes, { truncation: true });
  // The voice keeps one 256-wide style per length: pick the one for this many tokens.
  const at = 256 * Math.min(Math.max((input_ids.dims.at(-1) ?? 2) - 2, 0), 509);
  const { waveform } = await model({
    input_ids,
    style: new Tensor("float32", style.slice(at, at + 256), [1, 256]),
    speed: new Tensor("float32", [speed], [1]),
  });
  return new Float32Array(waveform.data as Float32Array);
}

ctx.onmessage = async (e) => {
  const m = e.data;
  if (m.type === "load") {
    try {
      const { device } = await load();
      ctx.postMessage({ type: "ready", device });
    } catch (err) {
      ctx.postMessage({ type: "fail", message: err instanceof Error ? err.message : String(err) });
    }
    return;
  }
  try {
    const audio = await speak(m.text, m.voice, m.speed);
    ctx.postMessage({ type: "audio", id: m.id, audio }, [audio.buffer]);
  } catch (err) {
    ctx.postMessage({
      type: "fail",
      id: m.id,
      message: err instanceof Error ? err.message : String(err),
    });
  }
};

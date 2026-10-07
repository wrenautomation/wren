/**
 * whisper.cpp on this Mac's GPU (Metal): `brew install whisper-cpp`, the large-v3-turbo model in a
 * cache outside the repo. One word per segment (`-ml 1 -sow`), so each word keeps its own times.
 * Silero VAD splits on pauses first, which keeps words from smearing across the long ones.
 */
import { execFile } from "node:child_process";
import { access, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import type { Word } from "./schema.js";

const run = promisify(execFile);

export const WHISPER_BIN = "whisper-cli";
export const WHISPER_MODEL = join(homedir(), ".cache/wren/whisper/ggml-large-v3-turbo.bin");
const MODEL_URL =
  "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo.bin";
export const VAD_MODEL = join(homedir(), ".cache/wren/whisper/ggml-silero-v5.1.2.bin");
const VAD_URL = "https://huggingface.co/ggml-org/whisper-vad/resolve/main/ggml-silero-v5.1.2.bin";

/** whisper-cli's `-oj` output; only what we read. */
interface WhisperJson {
  transcription: { offsets: { from: number; to: number }; text: string }[];
}

export function wordsOf(json: WhisperJson): Word[] {
  return json.transcription
    .map((t) => ({ w: t.text.trim(), s: t.offsets.from / 1000, e: t.offsets.to / 1000 }))
    .filter((w) => w.w && !/^\[.*\]$/.test(w.w));
}

export async function transcribe(
  wav: string,
  opts: { model?: string; bin?: string; language?: string; prompt?: string } = {},
): Promise<Word[]> {
  const model = opts.model ?? WHISPER_MODEL;
  await access(model).catch(() => {
    throw new Error(`no whisper model at ${model}: curl -L -o ${model} ${MODEL_URL}`);
  });
  await access(VAD_MODEL).catch(() => {
    throw new Error(`no VAD model at ${VAD_MODEL}: curl -L -o ${VAD_MODEL} ${VAD_URL}`);
  });
  const out = wav.replace(/\.wav$/, "");
  await run(
    opts.bin ?? WHISPER_BIN,
    [
      "-m",
      model,
      "-f",
      wav,
      "--vad",
      "-vm",
      VAD_MODEL,
      "-ml",
      "1",
      "-sow",
      "-oj",
      "-of",
      out,
      "-np",
      "-l",
      opts.language ?? "en",
      // Names and jargon it would mishear (`studio.words`), as its starting context.
      ...(opts.prompt ? ["--prompt", opts.prompt] : []),
    ],
    { maxBuffer: 256 * 1024 * 1024 },
  ).catch((e: Error & { code?: string }) => {
    throw e.code === "ENOENT" ? new Error("whisper-cli not found: brew install whisper-cpp") : e;
  });
  return wordsOf(JSON.parse(await readFile(`${out}.json`, "utf8")) as WhisperJson);
}

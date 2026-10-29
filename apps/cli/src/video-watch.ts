/**
 * `wren video watch <url|file>`: read a video with the shared core (`watch` in
 * @wren/research/sops): ffmpeg's cuts and frames, Cohere's speech and on-screen text, Gemini's
 * screen read when a key still works. Prints the Speech, On screen and Cuts sections, or `--json`.
 * `sop add` and `learn` use the same core through `watchModels`.
 * The command itself is registered in ./studio.ts: bare `wren video watch` was already the
 * recordings loop the desk runs every minute, so one command does both (an input picks this).
 */
import type { Settings } from "@wren/config";
import { fleetKeys, loadLlmEnv } from "@wren/llm";
import type { Model } from "@wrenautomation/models";
import {
  cohereEye,
  cohereSpeech,
  frameCounts,
  geminiVideo,
  renderWatched,
  type WatchOptions,
  watch,
} from "@wrenautomation/read/video";
import type { Command } from "commander";

/** Cohere's eye and ear on llm.env's keys (never logged), and the ffmpeg path. */
export function watchEyes(
  settings: Settings,
  rootDir: string,
): Pick<WatchOptions, "eye" | "ear" | "ffmpeg"> {
  loadLlmEnv(settings.llmEnvPath, rootDir);
  const keys = fleetKeys(process.env, "cohere");
  return { eye: cohereEye(keys), ear: cohereSpeech(keys), ffmpeg: settings.ffmpeg };
}

/** A Gemini model that reads video on llm.env's keys; null when no key works. */
export function geminiModel(settings: Settings, rootDir: string): Promise<Model | null> {
  loadLlmEnv(settings.llmEnvPath, rootDir);
  return geminiVideo(fleetKeys(process.env, "gemini"));
}

/** The model, or a throw: for a caller with no other reader. */
export function needGemini(m: Model | null): Model {
  if (!m) throw new Error("no working GEMINI key in llm.env");
  return m;
}

/** What every caller of the core passes: the eye, the ear, Gemini's screen read and ffmpeg. */
export async function watchModels(
  settings: Settings,
  rootDir: string,
): Promise<Pick<WatchOptions, "eye" | "ear" | "video" | "ffmpeg">> {
  return { ...watchEyes(settings, rootDir), video: await geminiModel(settings, rootDir) };
}

/** The flags `wren video watch <input>` takes; the command (./studio.ts) adds them beside the recordings loop's own. */
export function withWatchOptions(cmd: Command): Command {
  return cmd
    .option("--json", "with a video: print the result as JSON")
    .option("--no-speech", "with a video: skip the transcription")
    .option("--language <code>", "with a video: spoken language, ISO 639-1", "en")
    .option("--every <s>", "with a video: seconds between frames", Number, 2);
}

export interface WatchFlags {
  json?: boolean;
  speech: boolean;
  language: string;
  every: number;
}

/** Read one video and print it; the counts go to stderr so `--json` stays clean. */
export async function watchVideo(
  input: string,
  o: WatchFlags,
  settings: Settings,
  rootDir: string,
): Promise<void> {
  const watched = await watch(input, {
    ...(await watchModels(settings, rootDir)),
    ytDlp: settings.ytDlp,
    speech: o.speech,
    language: o.language,
    everyS: o.every,
  });
  if (o.json) console.log(JSON.stringify(watched, null, 2));
  else console.log(renderWatched(watched));
  const { read, unread } = frameCounts(watched);
  console.error(
    `${watched.durationS}s, ${read} frames read, ${unread} not read, ${watched.cuts.length} cuts, ${watched.speech.length} chars of speech`,
  );
}

/**
 * `wren video watch <url|file>`: read a video with the shared core (`watch` in
 * @wren/research/sops): ffmpeg's cuts and frames, Cohere's speech and on-screen text, Gemini's
 * screen read when a key still works. Prints the Speech, On screen and Cuts sections, or `--json`.
 * `sop add`, `learn` and `video look --with cohere` use the same core through `watchKeys`.
 * The command itself is registered in ./studio.ts: bare `wren video watch` was already the
 * recordings loop the desk runs every minute, so one command does both (an input picks this).
 */
import type { Settings } from "@wren/config";
import { fleetKeys, loadLlmEnv } from "@wren/llm";
import { frameCounts, renderWatched, type WatchOptions } from "@wrenautomation/falcon/video";
import { watch } from "@wrenautomation/weaver/video";
import type { Command } from "commander";

/** Keys from llm.env (never logged) and the ffmpeg path: what every caller of the core passes. */
export function watchKeys(
  settings: Settings,
  rootDir: string,
): Pick<WatchOptions, "cohereKeys" | "geminiKeys" | "ffmpeg"> {
  loadLlmEnv(settings.llmEnvPath, rootDir);
  return {
    cohereKeys: fleetKeys(process.env, "cohere"),
    geminiKeys: fleetKeys(process.env, "gemini"),
    ffmpeg: settings.ffmpeg,
  };
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
    ...watchKeys(settings, rootDir),
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

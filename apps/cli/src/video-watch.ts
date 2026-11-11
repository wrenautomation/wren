/**
 * `wren video watch <url|file>`: read a video with the shared core (`watch` in
 * @wren/research/sops): ffmpeg's cuts and frames picked where the picture changes, the ear's speech,
 * Claude's read of the frames (Cohere when Claude fails). Prints the Speech, On screen and Cuts
 * sections, or `--json`. One path for every read (WA-904): no whole-video model.
 * `sop add`, `learn` and studio use the same core through `watchEyes`.
 * The command itself is registered in ./studio.ts: bare `wren video watch` was already the
 * recordings loop the desk runs every minute, so one command does both (an input picks this).
 */
import type { Settings } from "@wren/config";
import { fleetKeys, loadLlmEnv } from "@wren/llm";
import { anthropic, fallback, type Model } from "@wrenautomation/models";
import {
  cohereEye,
  frameCounts,
  renderWatched,
  speechHere,
  type WatchOptions,
  watch,
} from "@wrenautomation/read/video";
import type { Command } from "commander";

/** The model that reads frames: weaver's (engine-cli SEE_MODEL), so a video reads the same anywhere. */
const SEE_MODEL = "sonnet";

/**
 * The eye: Claude, then Cohere past a busy or failed call (Cohere refuses frames that show a
 * person, so it is never first). The ear: local whisper when its model is on this machine, else
 * Cohere (`speechHere`). Keys from llm.env, never logged.
 */
export function watchEyes(
  settings: Settings,
  rootDir: string,
): Pick<WatchOptions, "ear" | "ffmpeg"> & { eye: Model } {
  loadLlmEnv(settings.llmEnvPath, rootDir);
  const claude = fleetKeys(process.env, "anthropic");
  const cohere = fleetKeys(process.env, "cohere");
  const eyes = [
    ...(claude.length ? [anthropic({ key: claude, model: SEE_MODEL })] : []),
    ...(cohere.length ? [cohereEye(cohere)] : []),
  ];
  if (!eyes.length) throw new Error("no ANTHROPIC or COHERE key in llm.env: nothing reads frames");
  const ear = speechHere(cohere);
  return {
    eye: eyes.length > 1 ? fallback(eyes) : (eyes[0] as Model),
    ...(ear ? { ear } : {}),
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
    ...watchEyes(settings, rootDir),
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

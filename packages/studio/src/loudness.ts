/**
 * Every render's audio to YouTube's level: -14 LUFS integrated, true peak -1.5 dB. YouTube turns
 * loud audio down but never quiet audio up, and a laptop mic records near -27. Two passes of
 * ffmpeg's loudnorm: measure, then apply with what it measured (linear when it can), the video
 * stream copied. No `offset=`: this ffmpeg build refuses it. When the true-peak cap forces its
 * dynamic mode, it lands about 1 dB short; then the apply runs once more from the original,
 * aimed past -14 by the shortfall.
 */
import { execFile } from "node:child_process";
import { rename, rm } from "node:fs/promises";
import { promisify } from "node:util";

const run = promisify(execFile);

export const LOUDNESS = { i: -14, tp: -1.5, lra: 11 } as const;

export interface Loudness {
  i: number;
  tp: number;
  lra: number;
  thresh: number;
}

/** Close enough to the target to keep. */
const NEAR_DB = 0.5;

const target = (i: number) =>
  `I=${Math.round(i * 100) / 100}:TP=${LOUDNESS.tp}:LRA=${LOUDNESS.lra}`;

/** Pass one: measure only, its numbers as JSON on stderr. */
export const measureFilter = () => `loudnorm=${target(LOUDNESS.i)}:print_format=json`;

/** Pass two: the measured numbers in, so the gain is one steady step. `i` aims elsewhere. */
export const applyFilter = (m: Loudness, i: number = LOUDNESS.i) =>
  `loudnorm=${target(i)}:measured_I=${m.i}:measured_TP=${m.tp}:measured_LRA=${m.lra}` +
  `:measured_thresh=${m.thresh}:linear=true:print_format=summary`;

/** loudnorm's JSON block at the end of stderr; null when there is none. Silence measures -inf. */
export function parseLoudnorm(stderr: string): Loudness | null {
  const at = stderr.lastIndexOf("{");
  const end = stderr.lastIndexOf("}");
  if (at < 0 || end < at) return null;
  const j = JSON.parse(stderr.slice(at, end + 1)) as Record<string, string>;
  const n = (k: string) => Number(j[k]);
  const m = { i: n("input_i"), tp: n("input_tp"), lra: n("input_lra"), thresh: n("input_thresh") };
  return Object.values(m).every(Number.isFinite) ? m : null;
}

/** The file's integrated loudness and true peak; null without audio or when it is silent. */
export async function measureLoudness(file: string, ffmpeg: string): Promise<Loudness | null> {
  const args = ["-hide_banner", "-nostats", "-i", file, "-map", "0:a:0", "-af", measureFilter()];
  try {
    const { stderr } = await run(ffmpeg, [...args, "-f", "null", "-"], {
      maxBuffer: 64 * 1024 * 1024,
    });
    return parseLoudnorm(stderr);
  } catch (err) {
    // No audio stream: nothing to level.
    if (/matches no streams/i.test(String((err as { stderr?: string }).stderr ?? err))) return null;
    throw err;
  }
}

/**
 * Normalize `file` in place. Answers what it measured before; null when there was nothing to
 * level (no audio, or silence), and the file is left as it was.
 */
export async function normalizeLoudness(file: string, ffmpeg: string): Promise<Loudness | null> {
  const m = await measureLoudness(file, ffmpeg);
  if (!m) return null;
  const tmp = [1, 2].map((n) => file.replace(/(\.\w+)$/, `.loudnorm${n}$1`)) as [string, string];
  const apply = (out: string, i: number) =>
    run(ffmpeg, [
      ...["-v", "error", "-y", "-i", file, "-map", "0:v:0?", "-map", "0:a:0"],
      ...["-c:v", "copy", "-af", applyFilter(m, i), "-ar", "48000", "-c:a", "aac", "-b:a", "192k"],
      ...["-movflags", "+faststart", out],
    ]);
  try {
    await apply(tmp[0], LOUDNESS.i);
    let best = tmp[0];
    const got = await measureLoudness(tmp[0], ffmpeg);
    if (got && Math.abs(got.i - LOUDNESS.i) > NEAR_DB) {
      await apply(tmp[1], LOUDNESS.i + (LOUDNESS.i - got.i));
      const again = await measureLoudness(tmp[1], ffmpeg);
      if (again && Math.abs(again.i - LOUDNESS.i) < Math.abs(got.i - LOUDNESS.i)) best = tmp[1];
    }
    await rename(best, file);
  } finally {
    for (const t of tmp) await rm(t, { force: true });
  }
  return m;
}

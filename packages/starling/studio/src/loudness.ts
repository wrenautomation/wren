/**
 * Every render's audio to YouTube's level: -14 LUFS integrated, true peak -1.5 dB. YouTube turns
 * loud audio down but never quiet audio up, and a laptop mic records near -27. Measure (loudnorm,
 * print only), then one steady gain and a limiter, the video stream copied. Then measure the file
 * that came out and correct: the limiter takes some loudness, and aac puts peaks back. loudnorm's
 * own apply is not used: on a wide take (LRA over 11) it turns dynamic and lands 3 LU short with
 * the peak over the cap (WA-1284).
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
/** The limiter's first ceiling sits this far under the cap: aac's overshoot. */
const CODEC_ROOM_DB = 0.5;
const LEVEL_TRIES = 4;

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Pass one: measure only, its numbers as JSON on stderr. */
export const measureFilter = () =>
  `loudnorm=I=${LOUDNESS.i}:TP=${LOUDNESS.tp}:LRA=${LOUDNESS.lra}:print_format=json`;

/**
 * Pass two: one gain, then a limiter at `ceilingDb`. The limiter reads sample peaks, so it runs at
 * 192 kHz, where a sample peak is close to the true peak.
 */
export const levelFilter = (gainDb: number, ceilingDb: number) =>
  `volume=${round2(gainDb)}dB,aresample=192000,` +
  `alimiter=limit=${(10 ** (ceilingDb / 20)).toFixed(4)}:attack=5:release=50:level=false,` +
  "aresample=48000";

/** How far a measure is outside the target: 0 = inside (I within 0.5, peak under the cap). */
export const levelMiss = (got: Pick<Loudness, "i" | "tp">, want: number) =>
  Math.max(0, Math.abs(got.i - want) - NEAR_DB) + Math.max(0, got.tp - LOUDNESS.tp);

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
 * Normalize `file` in place, to `i` (default -14): a video (aac audio, the picture copied), or a
 * wav (`wav`, kept PCM). Answers what it measured before; null when there was nothing to level
 * (no audio, or silence), and the file is left as it was. Throws, the file as it was, when the
 * result still misses the target: a render with wrong audio does not go out.
 */
export async function normalizeLoudness(
  file: string,
  ffmpeg: string,
  o: { wav?: boolean; i?: number } = {},
): Promise<Loudness | null> {
  const m = await measureLoudness(file, ffmpeg);
  if (!m) return null;
  const tmp = [1, 2].map((n) => file.replace(/(\.\w+)$/, `.level${n}$1`)) as [string, string];
  const apply = (out: string, gain: number, ceiling: number) =>
    run(ffmpeg, [
      ...["-v", "error", "-y", "-i", file, "-map", "0:v:0?", "-map", "0:a:0"],
      ...["-c:v", "copy", "-af", levelFilter(gain, ceiling), "-ar", "48000"],
      ...(o.wav
        ? ["-c:a", "pcm_s24le", out]
        : ["-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", out]),
    ]);
  const want = o.i ?? LOUDNESS.i;
  let gain = want - m.i;
  let ceiling = LOUDNESS.tp - CODEC_ROOM_DB;
  // tmp[0] = the best so far, tmp[1] = the try
  let best: Loudness | null = null;
  try {
    for (let n = 0; n < LEVEL_TRIES; n++) {
      await apply(tmp[1], gain, ceiling);
      const got = await measureLoudness(tmp[1], ffmpeg);
      if (!got) break;
      if (!best || levelMiss(got, want) < levelMiss(best, want)) {
        await rename(tmp[1], tmp[0]);
        best = got;
      }
      if (levelMiss(got, want) === 0) break;
      gain += want - got.i;
      if (got.tp > LOUDNESS.tp) ceiling -= got.tp - LOUDNESS.tp + 0.1;
    }
    if (!best || levelMiss(best, want) > 0)
      throw new Error(
        best
          ? `The audio came out at ${best.i} LUFS with a true peak of ${best.tp} dB. The target is ${want} LUFS and ${LOUDNESS.tp} dB.`
          : "The audio could not be measured after it was levelled.",
      );
    await rename(tmp[0], file);
  } finally {
    for (const t of tmp) await rm(t, { force: true });
  }
  return m;
}

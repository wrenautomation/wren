/**
 * ffmpeg work on his Mac: probe, pull audio, hear silence, line up two tracks, apply cuts.
 * `ffmpeg` is the binary (settings.ffmpeg); ffprobe sits beside it.
 */
import { execFile, spawn } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import {
  type CutKnobs,
  fitWords,
  noiseThresholdDb,
  type Pcm,
  type Span,
  silenceCuts,
} from "./cuts.js";
import type { Cut, Track, Tracks, Word } from "./schema.js";

const run = promisify(execFile);

const ffprobeOf = (ffmpeg: string) =>
  ffmpeg.includes("/") ? join(dirname(ffmpeg), "ffprobe") : "ffprobe";

/** Every output frame rate; the Long composition runs at the same. */
export const FPS = 30;
/** Audio fade at each cut, so no click. */
const FADE_S = 0.01;

export async function probe(path: string, ffmpeg: string): Promise<Track & { audio: boolean }> {
  const { stdout } = await run(ffprobeOf(ffmpeg), [
    ...["-v", "error", "-print_format", "json", "-show_streams", "-show_format", path],
  ]);
  const j = JSON.parse(stdout) as {
    format: { duration?: string };
    streams: { codec_type: string; width?: number; height?: number; avg_frame_rate?: string }[];
  };
  const v = j.streams.find((s) => s.codec_type === "video");
  if (!v) throw new Error(`${path}: no video stream`);
  const [num, den] = (v.avg_frame_rate ?? "30/1").split("/").map(Number) as [number, number];
  return {
    path,
    durationS: Number(j.format.duration ?? 0),
    width: v.width ?? 0,
    height: v.height ?? 0,
    fps: den ? Math.round((num / den) * 100) / 100 : FPS,
    audio: j.streams.some((s) => s.codec_type === "audio"),
  };
}

/** The first audio track, mono, as floats; `limitS` reads only the start. */
export function pcm(path: string, ffmpeg: string, rate = 16000, limitS?: number): Promise<Pcm> {
  const args = ["-v", "error", "-i", path, "-map", "0:a:0", "-ac", "1", "-ar", String(rate)];
  if (limitS) args.push("-t", String(limitS));
  args.push("-f", "f32le", "-");
  return new Promise((resolve, reject) => {
    const p = spawn(ffmpeg, args);
    const chunks: Buffer[] = [];
    let err = "";
    p.stdout.on("data", (c: Buffer) => chunks.push(c));
    p.stderr.on("data", (c: Buffer) => {
      err += c.toString();
    });
    p.on("error", reject);
    p.on("close", (code) => {
      if (code !== 0) return reject(new Error(`ffmpeg audio ${path}: ${err.trim()}`));
      const buf = Buffer.concat(chunks);
      const samples = new Float32Array(buf.length / 4);
      for (let i = 0; i < samples.length; i++) samples[i] = buf.readFloatLE(i * 4);
      resolve({ samples, rate });
    });
  });
}

/** 16 kHz mono 16-bit wav, what whisper.cpp reads. */
export async function wav16k(path: string, out: string, ffmpeg: string): Promise<void> {
  await run(ffmpeg, [
    ...["-v", "error", "-y", "-i", path, "-map", "0:a:0", "-ac", "1", "-ar", "16000"],
    ...["-c:a", "pcm_s16le", out],
  ]);
}

/** ffmpeg silencedetect at `thresholdDb`, silences of at least `minS`. */
export async function silences(
  path: string,
  ffmpeg: string,
  thresholdDb: number,
  minS: number,
  durationS: number,
): Promise<Span[]> {
  const { stderr } = await run(
    ffmpeg,
    [
      ...["-hide_banner", "-nostats", "-i", path, "-map", "0:a:0"],
      ...["-af", `silencedetect=noise=${thresholdDb.toFixed(1)}dB:d=${minS}`, "-f", "null", "-"],
    ],
    { maxBuffer: 64 * 1024 * 1024 },
  );
  const out: Span[] = [];
  let open: number | null = null;
  for (const m of stderr.matchAll(/silence_(start|end): (-?[\d.]+)/g)) {
    const t = Number(m[2]);
    if (m[1] === "start") open = Math.max(0, t);
    else if (open !== null) {
      out.push({ s: open, e: t });
      open = null;
    }
  }
  if (open !== null) out.push({ s: open, e: durationS });
  return out;
}

/** Both signals, the knobs, the samples for snapping: the silence cuts of one track. */
export async function silencePass(
  path: string,
  words: readonly Word[],
  durationS: number,
  ffmpeg: string,
  knobs: CutKnobs,
): Promise<{ words: Word[]; cuts: Cut[] }> {
  const samples = await pcm(path, ffmpeg);
  const threshold = noiseThresholdDb(samples, knobs.noiseMarginDb);
  const quiet = await silences(path, ffmpeg, threshold, knobs.minGapS, durationS);
  const fitted = fitWords(words, quiet);
  return { words: fitted, cuts: silenceCuts(fitted, quiet, samples, durationS, knobs) };
}

/** Mean |x| per frame of `n` samples, mean removed. */
const envelope = (x: Float32Array, n: number): Float64Array => {
  const out = new Float64Array(Math.floor(x.length / n));
  for (let i = 0; i < out.length; i++) {
    let s = 0;
    for (let j = i * n; j < (i + 1) * n; j++) s += Math.abs(x[j] as number);
    out[i] = s / n;
  }
  const mean = out.reduce((a, b) => a + b, 0) / (out.length || 1);
  for (let i = 0; i < out.length; i++) out[i] = (out[i] as number) - mean;
  return out;
};

const bestLag = (a: ArrayLike<number>, b: ArrayLike<number>, from: number, to: number): number => {
  let best = from;
  let bestC = Number.NEGATIVE_INFINITY;
  for (let lag = from; lag <= to; lag++) {
    let c = 0;
    let n = 0;
    for (let i = Math.max(0, -lag); i < a.length && i + lag < b.length; i++) {
      c += (a[i] as number) * (b[i + lag] as number);
      n++;
    }
    if (n && c / n > bestC) {
      bestC = c / n;
      best = lag;
    }
  }
  return best;
};

/**
 * Camera time minus main time for the same sound: a 10 ms envelope finds the lag within
 * `maxS`, then the raw samples refine it to one sample.
 */
export function syncOffset(main: Pcm, cam: Pcm, maxS = 30): number {
  const n = Math.round(main.rate / 100);
  const coarse = bestLag(
    envelope(main.samples, n),
    envelope(cam.samples, n),
    -maxS * 100,
    maxS * 100,
  );
  const at = coarse * n;
  // ponytail: 20 s of raw samples refine it; a recording silent for its first 20 s keeps the 10 ms answer.
  const win = Math.min(main.samples.length, 20 * main.rate);
  const fine = bestLag(main.samples.subarray(0, win), cam.samples, at - n, at + n);
  return Math.round((fine / main.rate) * 10000) / 10000;
}

const f = (x: number) => x.toFixed(4);

/**
 * The filter graph that keeps `keep` of one input, scaled to 1080p at 30 fps; audio (main only)
 * fades 10 ms in and out at every join. `shiftS` moves the input onto main's clock first.
 */
export function cutGraph(keep: readonly Span[], audio: boolean, shiftS = 0, padS = 0): string {
  const n = keep.length;
  const shift =
    shiftS > 0
      ? `trim=start=${f(shiftS)},setpts=PTS-STARTPTS,`
      : shiftS < 0
        ? `tpad=start_duration=${f(-shiftS)}:start_mode=clone,`
        : "";
  const pad = padS > 0 ? `tpad=stop_duration=${f(padS)}:stop_mode=clone,` : "";
  const lines = [
    `[0:v]${shift}${pad}fps=${FPS},scale=-2:1080:flags=lanczos,format=yuv420p,split=${n}${keep.map((_, i) => `[sv${i}]`).join("")}`,
  ];
  if (audio)
    lines.push(`[0:a]aresample=48000,asplit=${n}${keep.map((_, i) => `[sa${i}]`).join("")}`);
  keep.forEach((k, i) => {
    lines.push(`[sv${i}]trim=start=${f(k.s)}:end=${f(k.e)},setpts=PTS-STARTPTS[v${i}]`);
    if (audio) {
      const len = k.e - k.s;
      lines.push(
        `[sa${i}]atrim=start=${f(k.s)}:end=${f(k.e)},asetpts=PTS-STARTPTS,afade=t=in:st=0:d=${FADE_S},afade=t=out:st=${f(Math.max(0, len - FADE_S))}:d=${FADE_S}[a${i}]`,
      );
    }
  });
  const ins = keep.map((_, i) => (audio ? `[v${i}][a${i}]` : `[v${i}]`)).join("");
  lines.push(`${ins}concat=n=${n}:v=1:a=${audio ? 1 : 0}${audio ? "[v][a]" : "[v]"}`);
  return lines.join(";\n");
}

const ENCODE = ["-c:v", "h264_videotoolbox", "-b:v", "12M", "-movflags", "+faststart"];

/** Apply the kept segments to both tracks: cut-main.mp4 (with audio), cut-cam.mp4 (picture only). */
export async function cutTracks(
  tracks: Tracks,
  keep: readonly Span[],
  dir: string,
  ffmpeg: string,
): Promise<Record<string, string>> {
  const one = async (
    input: string,
    out: string,
    audio: boolean,
    shiftS: number,
    padS: number,
  ): Promise<string> => {
    const script = `${out}.filter.txt`;
    await writeFile(script, cutGraph(keep, audio, shiftS, padS));
    await run(
      ffmpeg,
      [
        ...["-v", "error", "-y", "-i", input, "-/filter_complex", script, "-map", "[v]"],
        ...(audio ? ["-map", "[a]", "-c:a", "aac", "-b:a", "192k"] : ["-an"]),
        ...ENCODE,
        out,
      ],
      { maxBuffer: 64 * 1024 * 1024 },
    );
    return out;
  };
  const files: Record<string, string> = {
    cutMain: await one(tracks.main.path, join(dir, "cut-main.mp4"), true, 0, 0),
  };
  if (tracks.cam) {
    const { offsetS, durationS } = tracks.cam;
    // Main time t is camera time t + offset; clone the edge frame where the camera ran short.
    const padS = Math.max(0, tracks.main.durationS + offsetS - durationS) + 1;
    files.cutCam = await one(tracks.cam.path, join(dir, "cut-cam.mp4"), false, offsetS, padS);
  }
  return files;
}

/** A 360p copy for a look pass, the cam in the corner when there is one. */
export async function proxy360(
  main: string,
  cam: string | undefined,
  out: string,
  ffmpeg: string,
): Promise<string> {
  const graph = cam
    ? "[0:v]scale=-2:360[m];[1:v]scale=-2:120[c];[m][c]overlay=W-w-12:H-h-12[v]"
    : "[0:v]scale=-2:360[v]";
  await run(ffmpeg, [
    ...["-v", "error", "-y", "-i", main, ...(cam ? ["-i", cam] : [])],
    ...["-filter_complex", graph, "-map", "[v]", "-map", "0:a:0"],
    ...["-c:v", "h264_videotoolbox", "-b:v", "700k", "-c:a", "aac", "-b:a", "64k", out],
  ]);
  return out;
}

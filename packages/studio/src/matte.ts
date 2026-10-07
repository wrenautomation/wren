/**
 * Adapted from heygen-com/hyperframes `packages/cli/src/background-removal/inference.ts`,
 * `manager.ts` and `pipeline.ts` @5c7f631 (Apache-2.0); changed: ffmpeg does both resizes and
 * merges the mask as alpha (no sharp); CPU execution provider only (their note: CoreML leaks alpha
 * inside the face); the model checked by sha256 and cached under ~/.cache/wren/models; a window
 * planner on the cut timeline. See packages/studio/NOTICE.
 *
 * Words behind the speaker (designs/2026-10-06-video-editor.md, step 6): the speaker cut out of the
 * cut file for a short window around each stressed word, as a VP9 WebM with alpha that the render
 * lays over the big word. Only those windows are matted, never the whole video.
 */
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream, createWriteStream, existsSync } from "node:fs";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { InferenceSession, Tensor } from "onnxruntime-node";
import { keepSegments, onCut, toCutTime } from "./cuts.js";
import { cutSize, FPS } from "./media.js";
import type { Matte } from "./props.js";
import type { LayoutRange, VideoEdit } from "./schema.js";
import { STRESS } from "./stress.js";

export const MODEL = {
  name: "u2net_human_seg",
  url: "https://github.com/danielgatis/rembg/releases/download/v0.0.0/u2net_human_seg.onnx",
  /** Pinned from the first download (its md5 matches rembg's registry, c09ddc2e…). */
  sha256: "01eb6a29a5c4d8edb30b56adad9bb3a2a0535338e480724a213e0acfd2d1c73c",
  bytes: 175_997_641,
} as const;

export const MODELS_DIR = join(homedir(), ".cache", "wren", "models");

export const MATTE = {
  /** The model's square input. */
  size: 320,
  /** Longest window, whatever the word. */
  maxS: 3,
  /** Windows closer than this (same source) become one file. */
  mergeS: 0.5,
  /** Most windows one video mattes. */
  max: 40,
  /** Where the files go, inside the edit's folder (Remotion's public dir). */
  dir: "matte",
} as const;

/** rembg's u2net_human_seg normalisation: ImageNet mean and std, over the frame's max pixel. */
export const MEAN = [0.485, 0.456, 0.406] as const;
export const STD = [0.229, 0.224, 0.225] as const;

async function sha256(file: string): Promise<string> {
  const h = createHash("sha256");
  await pipeline(createReadStream(file), h);
  return h.digest("hex");
}

/** The model's path, downloaded once and checked by sha256 every time it's used. */
export async function ensureModel(log: (l: string) => void = () => {}): Promise<string> {
  const dest = join(MODELS_DIR, `${MODEL.name}.onnx`);
  if (existsSync(dest)) {
    if ((await sha256(dest)) === MODEL.sha256) return dest;
    log(`${dest}: sha256 mismatch, downloading again`);
    await rm(dest);
  }
  await mkdir(MODELS_DIR, { recursive: true });
  log(`downloading ${MODEL.name} (~${Math.round(MODEL.bytes / 1e6)} MB)`);
  const res = await fetch(MODEL.url);
  if (!res.ok || !res.body) throw new Error(`model download: HTTP ${res.status}`);
  const part = `${dest}.part`;
  await pipeline(Readable.fromWeb(res.body as never), createWriteStream(part));
  const got = await sha256(part);
  if (got !== MODEL.sha256) {
    await rm(part, { force: true });
    throw new Error(`model download: sha256 ${got}, want ${MODEL.sha256}`);
  }
  await rename(part, dest);
  return dest;
}

/** A stressed word on the cut timeline: its index in the edit's words, text and seconds. */
export interface Pick {
  i: number;
  w: string;
  s: number;
  e: number;
}

export interface MatteWindow {
  /** 1-based, for the log. */
  n: number;
  /** Which cut file fills the frame then: the recording, or the camera file (cam layout). */
  source: "main" | "cam";
  /** On the cut timeline, in frames. */
  fromFrame: number;
  frames: number;
  /** The picks it carries, by word index. */
  picks: number[];
}

export interface MattePlan {
  windows: MatteWindow[];
  skipped: { i: number; why: string }[];
}

/**
 * The windows to matte, from the picks and the layout on the cut timeline. Each pick's window runs
 * from its start to `holdS` after its end (at most `maxS`). A pick too close to the one before once
 * cut is dropped; one whose window shows the screen share, or the corner cam (too small to cut out),
 * or a layout change, is skipped. Windows of one source closer than `mergeS` merge; past `max` the
 * rest are skipped.
 */
export function planMattes(o: {
  picks: readonly Pick[];
  layout: readonly LayoutRange[];
  /** A camera file, or a cam box in a one-file recording: either makes `corner` a small cam. */
  cam: boolean;
  camBox: boolean;
  durationS: number;
  fps: number;
}): MattePlan {
  const skipped: MattePlan["skipped"] = [];
  const spans: { i: number; from: number; to: number; source: "main" | "cam" }[] = [];
  let lastTo = Number.NEGATIVE_INFINITY;
  for (const p of [...o.picks].sort((a, b) => a.s - b.s)) {
    const from = Math.max(0, p.s);
    const to = Math.min(p.e + STRESS.holdS, from + MATTE.maxS, o.durationS);
    if (!(to > from)) {
      skipped.push({ i: p.i, why: "past the end" });
      continue;
    }
    if (from < lastTo + STRESS.gapS) {
      skipped.push({ i: p.i, why: `under ${STRESS.gapS}s after the word before, once cut` });
      continue;
    }
    const shows = new Set<string>();
    let covered = 0;
    for (const r of o.layout)
      if (r.to > from && r.from < to) {
        shows.add(r.show);
        covered += Math.min(r.to, to) - Math.max(r.from, from);
      }
    if (covered < to - from - 1e-6) shows.add("corner");
    if (shows.size > 1) {
      skipped.push({ i: p.i, why: "the layout changes inside its window" });
      continue;
    }
    const show = [...shows][0];
    if (show === "screen") {
      skipped.push({ i: p.i, why: "the screen share fills the frame" });
      continue;
    }
    if (show === "corner" && (o.cam || o.camBox)) {
      skipped.push({ i: p.i, why: "the corner cam is too small to cut out" });
      continue;
    }
    spans.push({ i: p.i, from, to, source: show === "cam" && o.cam ? "cam" : "main" });
    lastTo = to;
  }
  const merged: { from: number; to: number; source: "main" | "cam"; picks: number[] }[] = [];
  for (const s of spans) {
    const prev = merged.at(-1);
    if (prev && prev.source === s.source && s.from - prev.to < MATTE.mergeS) {
      prev.to = Math.max(prev.to, s.to);
      prev.picks.push(s.i);
    } else merged.push({ from: s.from, to: s.to, source: s.source, picks: [s.i] });
  }
  for (const m of merged.slice(MATTE.max))
    for (const i of m.picks) skipped.push({ i, why: `over ${MATTE.max} windows` });
  const windows = merged.slice(0, MATTE.max).map((m, k) => {
    const fromFrame = Math.floor(m.from * o.fps);
    return {
      n: k + 1,
      source: m.source,
      fromFrame,
      frames: Math.max(1, Math.ceil(m.to * o.fps) - fromFrame),
      picks: m.picks,
    };
  });
  return { windows, skipped };
}

/** One 320x320 RGB frame as the model's input: rembg's normalisation, planar. */
export function toInput(rgb: Uint8Array, out: Float32Array): Float32Array {
  const plane = MATTE.size * MATTE.size;
  let max = 0;
  for (let i = 0; i < plane * 3; i++) if ((rgb[i] as number) > max) max = rgb[i] as number;
  if (max === 0) max = 1;
  for (let i = 0; i < plane; i++) {
    out[i] = ((rgb[i * 3] as number) / max - MEAN[0]) / STD[0];
    out[plane + i] = ((rgb[i * 3 + 1] as number) / max - MEAN[1]) / STD[1];
    out[2 * plane + i] = ((rgb[i * 3 + 2] as number) / max - MEAN[2]) / STD[2];
  }
  return out;
}

/** The model's output as an 8-bit mask: min-max stretched, as rembg does. */
export function toMask(raw: Float32Array, out: Uint8Array): Uint8Array {
  const plane = MATTE.size * MATTE.size;
  let lo = Number.POSITIVE_INFINITY;
  let hi = Number.NEGATIVE_INFINITY;
  for (let i = 0; i < plane; i++) {
    const v = raw[i] as number;
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  const range = hi - lo || 1;
  for (let i = 0; i < plane; i++)
    out[i] = Math.max(0, Math.min(255, Math.round((((raw[i] as number) - lo) / range) * 255)));
  return out;
}

/** Seeking half a frame early lands on the window's first frame exactly. */
const seekArgs = (w: MatteWindow, fps: number) => [
  "-ss",
  Math.max(0, (w.fromFrame - 0.5) / fps).toFixed(4),
];

/** The encoder: the source frames, the mask scaled to them as alpha, VP9 with alpha, BT.709. */
export function encoderArgs(
  src: string,
  w: MatteWindow,
  o: { fps: number; width: number; height: number; out: string },
): string[] {
  const s = MATTE.size;
  return [
    ...["-v", "error", "-y", ...seekArgs(w, o.fps), "-i", src],
    ...["-f", "rawvideo", "-pix_fmt", "gray", "-s", `${s}x${s}`, "-r", String(o.fps), "-i", "-"],
    "-filter_complex",
    `[1:v]scale=${o.width}:${o.height}:flags=lanczos[m];[0:v][m]alphamerge,format=yuva420p[v]`,
    ...["-map", "[v]", "-frames:v", String(w.frames), "-an"],
    ...["-c:v", "libvpx-vp9", "-b:v", "0", "-crf", "30", "-deadline", "good", "-row-mt", "1"],
    ...["-cpu-used", "4", "-auto-alt-ref", "0"],
    ...["-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709"],
    ...["-color_range", "tv", "-metadata:s:v:0", "alpha_mode=1", o.out],
  ];
}

interface Ort {
  InferenceSession: typeof InferenceSession;
  Tensor: typeof Tensor;
}

/**
 * onnxruntime-node is native: loaded at run time from this package's own node_modules, so the CLI
 * bundle never tries to inline it.
 */
function loadOrt(pkgDir: string): Ort {
  return createRequire(join(pkgDir, "package.json"))("onnxruntime-node") as Ort;
}

/** Read exactly `n`-byte frames off a stream. */
async function* frames(stream: NodeJS.ReadableStream, n: number): AsyncGenerator<Buffer> {
  let buf: Buffer = Buffer.alloc(0);
  for await (const chunk of stream as AsyncIterable<Buffer>) {
    buf = buf.length ? Buffer.concat([buf, chunk]) : chunk;
    while (buf.length >= n) {
      yield buf.subarray(0, n);
      buf = buf.subarray(n);
    }
  }
}

function done(p: ReturnType<typeof spawn>, what: string, err: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    p.on("error", reject);
    p.on("close", (code) =>
      code === 0
        ? resolve()
        : reject(new Error(`${what} exit ${code}: ${err.join("").slice(-400)}`)),
    );
  });
}

export interface MatteSource {
  file: string;
  width: number;
  height: number;
}

/** One window: frames out of ffmpeg, the model on each, masks into the encoder. */
async function matteOne(
  session: InferenceSession,
  ort: Ort,
  w: MatteWindow,
  src: MatteSource,
  o: { fps: number; ffmpeg: string; out: string },
): Promise<void> {
  const s = MATTE.size;
  const decErr: string[] = [];
  const encErr: string[] = [];
  const dec = spawn(o.ffmpeg, [
    ...["-v", "error", ...seekArgs(w, o.fps), "-i", src.file, "-frames:v", String(w.frames)],
    ...["-vf", `scale=${s}:${s}:flags=lanczos`, "-f", "rawvideo", "-pix_fmt", "rgb24", "-an", "-"],
  ]);
  const part = `${o.out}.part.webm`;
  const enc = spawn(o.ffmpeg, encoderArgs(src.file, w, { ...o, ...src, out: part }));
  dec.stderr.on("data", (d) => decErr.push(String(d)));
  enc.stderr.on("data", (d) => encErr.push(String(d)));
  const decDone = done(dec, "ffmpeg decoder", decErr);
  const encDone = done(enc, "ffmpeg encoder", encErr);
  const input = new Float32Array(3 * s * s);
  const mask = new Uint8Array(s * s);
  const inName = session.inputNames[0] as string;
  const outName = session.outputNames[0] as string;
  let n = 0;
  for await (const rgb of frames(dec.stdout, s * s * 3)) {
    const out = await session.run({
      [inName]: new ort.Tensor("float32", toInput(rgb, input), [1, 3, s, s]),
    });
    toMask((out[outName] as Tensor).data as Float32Array, mask);
    if (!enc.stdin.write(Buffer.from(mask))) await new Promise((r) => enc.stdin.once("drain", r));
    n++;
  }
  enc.stdin.end();
  await Promise.all([decDone, encDone]);
  if (n !== w.frames) throw new Error(`matte ${w.n}: ${n} frames decoded, want ${w.frames}`);
  await rename(part, o.out);
}

/** What `matte/plan.json` keeps: the cut files' versions the mattes were made from. */
interface Kept {
  cut: Record<string, string>;
  windows: (MatteWindow & { file: string })[];
}

/** A cut file's version: its size and modified time (the cut pass rewrites it). */
const versionOf = async (file: string) => {
  const st = await stat(file);
  return `${st.size}:${Math.round(st.mtimeMs)}`;
};

/** A window's file, named by what it holds so a rerun finds it. */
export const matteFile = (w: MatteWindow) =>
  `${MATTE.dir}/${w.source}-${w.fromFrame}-${w.frames}.webm`;

/**
 * Matte every window not already matted from these cut files, to `<dir>/matte/`, with `plan.json`
 * naming the cut versions. A cut file that changed drops every matte made from it. Answers each
 * window with its file, relative to `dir` (Remotion's public dir).
 */
export async function makeMattes(
  pkgDir: string,
  dir: string,
  plan: MattePlan,
  sources: { main: MatteSource; cam?: MatteSource },
  o: { fps: number; ffmpeg: string; log?: (l: string) => void },
): Promise<Matte[]> {
  const log = o.log ?? (() => {});
  const at = join(dir, MATTE.dir);
  await mkdir(at, { recursive: true });
  const cut: Record<string, string> = { main: await versionOf(sources.main.file) };
  if (sources.cam) cut.cam = await versionOf(sources.cam.file);
  const keptFile = join(at, "plan.json");
  const kept: Kept | null = existsSync(keptFile)
    ? (JSON.parse(await readFile(keptFile, "utf8")) as Kept)
    : null;
  for (const k of kept?.windows ?? [])
    if (kept?.cut[k.source] !== cut[k.source]) await rm(join(dir, k.file), { force: true });
  const out = plan.windows.map((w) => ({ ...w, file: matteFile(w) }));
  const todo = out.filter(
    (w) => kept?.cut[w.source] !== cut[w.source] || !existsSync(join(dir, w.file)),
  );
  if (todo.length) {
    const ort = loadOrt(pkgDir);
    const session = await ort.InferenceSession.create(await ensureModel(log), {
      executionProviders: ["cpu"],
      graphOptimizationLevel: "all",
    });
    try {
      for (const w of todo) {
        const started = Date.now();
        const src = w.source === "cam" && sources.cam ? sources.cam : sources.main;
        await matteOne(session, ort, w, src, { ...o, out: join(dir, w.file) });
        log(`matte ${w.n}: ${w.frames} frames in ${((Date.now() - started) / 1000).toFixed(1)}s`);
      }
    } finally {
      await session.release();
    }
  }
  // Every file made from today's cut stays listed, so a later plan can reuse it.
  const still = (kept?.windows ?? []).filter(
    (k) => kept?.cut[k.source] === cut[k.source] && !out.some((w) => w.file === k.file),
  );
  await writeFile(keptFile, JSON.stringify({ cut, windows: [...still, ...out] }, null, 2));
  return out;
}

/**
 * The mattes an edit's render needs: none unless `captions.behind` is on and words are stressed;
 * else each stressed word's window on the cut timeline, planned and matted (kept ones reused).
 * `at`: only the window covering that cut-time second (a still).
 */
export async function editMattes(
  pkgDir: string,
  edit: VideoEdit,
  o: { ffmpeg: string; at?: number; log?: (l: string) => void },
): Promise<{ mattes: Matte[]; skipped: MattePlan["skipped"] }> {
  if (!edit.captions.behind || !edit.stress.length) return { mattes: [], skipped: [] };
  if (!edit.files.cutMain)
    throw new Error(`video ${edit.id}: not cut yet; wren video cut ${edit.id}`);
  const keep = keepSegments(edit.cuts, edit.tracks.main.durationS, FPS);
  const durationS = keep.reduce((n, k) => n + (k.e - k.s), 0);
  const picks = edit.stress.flatMap((i): Pick[] => {
    const w = edit.words[i];
    const s = w ? toCutTime(w.s, keep) : null;
    return w && s !== null ? [{ i, w: w.w, s, e: Math.max(s, onCut(w.e, keep)) }] : [];
  });
  const plan = planMattes({
    picks,
    layout: edit.layout.map((l) => ({ ...l, from: onCut(l.from, keep), to: onCut(l.to, keep) })),
    cam: !!edit.files.cutCam,
    camBox: !!edit.tracks.camBox,
    durationS,
    fps: FPS,
  });
  if (o.at !== undefined) {
    const f = Math.round(o.at * FPS);
    plan.windows = plan.windows.filter((w) => f >= w.fromFrame && f < w.fromFrame + w.frames);
  }
  const [mw, mh] = cutSize(edit.tracks.main);
  const cam = edit.tracks.cam && edit.files.cutCam ? cutSize(edit.tracks.cam) : null;
  const mattes = await makeMattes(
    pkgDir,
    edit.dir,
    plan,
    {
      main: { file: edit.files.cutMain, width: mw, height: mh },
      ...(cam && edit.files.cutCam
        ? { cam: { file: edit.files.cutCam, width: cam[0], height: cam[1] } }
        : {}),
    },
    { fps: FPS, ffmpeg: o.ffmpeg, ...(o.log ? { log: o.log } : {}) },
  );
  return { mattes, skipped: plan.skipped };
}

/**
 * Renders run as their own script from this package (`frames/render.ts`: Chrome through
 * `@hyperframes/engine`, esbuild and ffmpeg never enter the wren bundle). The edit's folder is
 * served as it is; one script run bundles once for every output of a job.
 */
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import type { CroppedFormat } from "./finish.js";
import { audioFiles, stageSounds } from "./kit.js";
import { normalizeLoudness } from "./loudness.js";
import type { PromoProps } from "./promo.js";
import type { FramedProps, LongProps, ShortProps, ThumbnailProps } from "./props.js";
import type { RenderOutput, RenderScriptJob } from "./render-job.js";

/**
 * Run the render script on `job`. `done(i, seconds)` runs as output `i` lands, in order, while
 * the script goes on to the next.
 */
async function renderScript(
  pkgDir: string,
  job: RenderScriptJob,
  done: (output: number, seconds: number) => Promise<void> = async () => {},
): Promise<void> {
  const tmp = await mkdtemp(join(tmpdir(), "wren-render-job-"));
  try {
    const file = join(tmp, "job.json");
    await writeFile(file, JSON.stringify(job));
    let after: Promise<void> = Promise.resolve();
    await new Promise<void>((resolve, reject) => {
      const p = spawn(process.execPath, [join(pkgDir, "frames/render.ts"), file], {
        cwd: pkgDir,
        stdio: ["ignore", "pipe", "inherit"],
      });
      createInterface({ input: p.stdout }).on("line", (line) => {
        // the engine also writes its own lines to stdout
        if (!line.startsWith('{"output":')) return;
        const row = JSON.parse(line) as { output: number; seconds: number };
        after = after.then(() => done(row.output, row.seconds));
      });
      p.on("error", reject);
      p.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`render exit ${code}`))));
    });
    await after;
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
}

/** Copy the kit sounds every output of `props` plays into the public dir, from the kit in `pkgDir`. */
const stageAll = (pkgDir: string, dir: string, props: Iterable<{ audio?: LongProps["audio"] }>) =>
  stageSounds(
    dir,
    [...props].flatMap((p) => audioFiles(p.audio)),
    { pkgDir },
  );

const jobProps = (job: Omit<RenderJob, "thumbnails">) => [
  ...(job.long ? [job.long] : []),
  ...framedOf(job).map(([, p]) => p),
  ...(job.shorts?.values() ?? []),
];

/** The edit live in a browser page with a scrubber (real video and sound); runs until Ctrl-C. */
export async function openPreview(pkgDir: string, dir: string, props: LongProps): Promise<void> {
  await stageAll(pkgDir, dir, [props]);
  await renderScript(pkgDir, {
    dir,
    preview: true,
    outputs: [{ kind: "still", composition: "Long", props, out: "", frame: 0, format: "png" }],
  });
}

const still = (composition: string, props: unknown, out: string, frame: number): RenderOutput => ({
  kind: "still",
  composition,
  props,
  out,
  frame,
  format: "png",
});

/** One frame of `Long` as a png, to check the layout without the preview. */
export async function renderStill(
  pkgDir: string,
  dir: string,
  props: LongProps,
  atS: number,
): Promise<string> {
  const out = join(dir, `still-${atS}s.png`);
  await stageAll(pkgDir, dir, [props]);
  await renderScript(pkgDir, {
    dir,
    outputs: [still("Long", props, out, Math.round(atS * props.fps))],
  });
  return out;
}

/**
 * One frame of each format the job names, at `atS` seconds on the cut timeline:
 * `<dir>/out/still-<format>-<label>.png` (a Short only when that time is inside it). `label`: the
 * time as he gave it, else `atS`. One bundle.
 */
export async function renderStills(
  pkgDir: string,
  dir: string,
  job: Omit<RenderJob, "thumbnails">,
  atS: number,
  label = String(Math.round(atS * 10) / 10),
): Promise<Record<string, string>> {
  const out = join(dir, "out");
  await mkdir(out, { recursive: true });
  await stageAll(pkgDir, dir, jobProps(job));
  const files: Record<string, string> = {};
  const outputs: RenderOutput[] = [];
  const add = (name: string, composition: string, props: unknown, frame: number) => {
    files[name] = join(out, `still-${name}-${label}.png`);
    outputs.push(still(composition, props, files[name], frame));
  };
  if (job.long) add("long", "Long", job.long, Math.round(atS * job.long.fps));
  for (const [name, p] of framedOf(job)) add(name, "Framed", p, Math.round(atS * p.fps));
  for (const [n, p] of job.shorts ?? []) {
    const f = Math.round(atS * p.fps) - p.startFrame;
    if (f >= 0 && f < p.durationInFrames) add(`short-${n}`, "Short", p, f);
  }
  if (outputs.length) await renderScript(pkgDir, { dir, outputs });
  return files;
}

export interface RenderJob {
  long?: LongProps;
  /** The whole cut cropped: 9:16 (`vertical`), 1:1 (`square`), 4:5 (`portrait`). */
  framed?: { [F in CroppedFormat]?: FramedProps | undefined };
  /** By 1-based number. */
  shorts?: Map<number, ShortProps>;
  thumbnails?: ThumbnailProps[];
}

const framedOf = (job: Pick<RenderJob, "framed">) =>
  Object.entries(job.framed ?? {}).filter((e): e is [CroppedFormat, FramedProps] => !!e[1]);

/**
 * Render what the job names to `<dir>/out/`: long.mp4, vertical.mp4 (square.mp4, portrait.mp4),
 * short-<n>.mp4, thumb-<n>.jpg.
 * One bundle for all of them; h264 on VideoToolbox (which needs a bitrate, not a CRF). Each
 * video's audio is then leveled to -14 LUFS (loudness.ts). Answers the files by name and the
 * seconds each took.
 */
export async function renderAll(
  pkgDir: string,
  dir: string,
  job: RenderJob,
  log: (line: string) => void = () => {},
  ffmpeg = "ffmpeg",
): Promise<{ files: Record<string, string>; seconds: Record<string, number> }> {
  const out = join(dir, "out");
  await mkdir(out, { recursive: true });
  const staged = await stageAll(pkgDir, dir, jobProps(job));
  if (staged) log(`sounds: ${staged} from the kit`);
  const files: Record<string, string> = {};
  const seconds: Record<string, number> = {};
  const names: string[] = [];
  const outputs: RenderOutput[] = [];
  const video = (name: string, composition: string, props: unknown, bitrate: string) => {
    names.push(name);
    // Rendered aside, then moved in whole: an approved YouTube draft uploads this very path.
    const part = join(out, `${name}.rendering.mp4`);
    outputs.push({ kind: "video", composition, props, out: part, bitrate });
  };
  if (job.long) video("long", "Long", job.long, "12M");
  for (const [name, p] of framedOf(job)) video(name, "Framed", p, "10M");
  for (const [n, p] of job.shorts ?? []) video(`short-${n}`, "Short", p, "10M");
  for (const p of job.thumbnails ?? []) {
    names.push(`thumb-${p.variant}`);
    outputs.push({
      kind: "still",
      composition: "Thumbnail",
      props: p,
      out: join(out, `thumb-${p.variant}.jpg`),
      frame: 0,
      format: "jpeg",
      quality: 90,
    });
  }
  if (!outputs.length) return { files, seconds };
  await renderScript(pkgDir, { dir, outputs, ffmpeg }, async (i, took) => {
    const name = names[i];
    const o = outputs[i];
    if (!name || !o) return;
    const started = Date.now();
    let file = o.out;
    if (o.kind === "video") {
      const was = await normalizeLoudness(o.out, ffmpeg);
      if (was) log(`${name}: audio ${was.i} LUFS to -14`);
      file = join(out, `${name}.mp4`);
      await rename(o.out, file);
    }
    files[name] = file;
    seconds[name] = Math.round((took + (Date.now() - started) / 1000) * 10) / 10;
    log(`${name}: ${seconds[name]}s`);
  });
  return { files, seconds };
}

/**
 * A promo (`./promo.ts`) to `<dir>/out/promo.mp4`, or one frame of it to `still-promo-<s>.png`
 * when `stillS` is set. `dir` is the script's folder: images and music are named inside it.
 */
export async function renderPromo(
  pkgDir: string,
  dir: string,
  props: PromoProps,
  stillS?: number,
  ffmpeg = "ffmpeg",
): Promise<string> {
  const out = join(dir, "out");
  await mkdir(out, { recursive: true });
  await stageAll(pkgDir, dir, [props]);
  if (stillS !== undefined) {
    const png = join(out, `still-promo-${stillS}.png`);
    await renderScript(pkgDir, {
      dir,
      outputs: [still("Promo", props, png, Math.round(stillS * props.fps))],
    });
    return png;
  }
  const mp4 = join(out, "promo.mp4");
  const outputs: RenderOutput[] = [
    { kind: "video", composition: "Promo", props, out: mp4, bitrate: "10M" },
  ];
  await renderScript(pkgDir, { dir, outputs, ffmpeg });
  await normalizeLoudness(mp4, ffmpeg, { i: props.lufs });
  return mp4;
}

/**
 * Remotion runs as its own CLI from this package (its bundler and renderer never enter the wren
 * bundle). The edit's folder is the public dir. Renders bundle once into a temp dir whose `public`
 * is a link to that folder: Remotion would otherwise copy the folder (cut files, earlier renders)
 * into every bundle, and its server refuses a linked file but not a linked folder.
 */
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, rename, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CroppedFormat } from "./finish.js";
import { audioFiles, stageSounds } from "./kit.js";
import { normalizeLoudness } from "./loudness.js";
import type { PromoProps } from "./promo.js";
import type { FramedProps, LongProps, ShortProps, ThumbnailProps } from "./props.js";

const ENTRY = "remotion/index.tsx";

async function remotion(pkgDir: string, args: string[]): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const p = spawn(join(pkgDir, "node_modules/.bin/remotion"), args, {
      cwd: pkgDir,
      stdio: "inherit",
    });
    p.on("error", reject);
    p.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`remotion exit ${code}`))));
  });
}

async function propsFile(dir: string, name: string, props: unknown): Promise<string> {
  const file = join(dir, `${name}-props.json`);
  await writeFile(file, JSON.stringify(props));
  return file;
}

/** Bundle the compositions with `dir` as the public dir, run `fn` on the bundle, remove it. */
async function withBundle<T>(
  pkgDir: string,
  dir: string,
  fn: (bundle: string) => Promise<T>,
): Promise<T> {
  const tmp = await mkdtemp(join(tmpdir(), "wren-studio-"));
  const bundle = join(tmp, "bundle");
  try {
    await mkdir(join(tmp, "empty"));
    await remotion(pkgDir, [
      ...["bundle", ENTRY, "--public-dir", join(tmp, "empty"), "--out-dir", bundle],
    ]);
    await rm(join(bundle, "public"), { recursive: true, force: true });
    await symlink(dir, join(bundle, "public"));
    return await fn(bundle);
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

/** Remotion Studio on localhost, live on this edit; runs until Ctrl-C. */
export async function openStudio(pkgDir: string, dir: string, props: LongProps): Promise<void> {
  await stageAll(pkgDir, dir, [props]);
  const file = await propsFile(dir, "long", props);
  await remotion(pkgDir, ["studio", ENTRY, "--public-dir", dir, "--props", file]);
}

/** One frame of `Long` as a png, to check the layout without opening Studio. */
export async function renderStill(
  pkgDir: string,
  dir: string,
  props: LongProps,
  atS: number,
): Promise<string> {
  const file = await propsFile(dir, "long", props);
  const out = join(dir, `still-${atS}s.png`);
  const frame = Math.min(props.durationInFrames - 1, Math.round(atS * props.fps));
  await withBundle(pkgDir, dir, (bundle) =>
    remotion(pkgDir, ["still", bundle, "Long", out, `--frame=${frame}`, "--props", file]),
  );
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
  const files: Record<string, string> = {};
  const at = label;
  await withBundle(pkgDir, dir, async (bundle) => {
    const still = async (
      name: string,
      comp: string,
      props: { durationInFrames: number },
      f: number,
    ) => {
      const file = join(out, `still-${name}-${at}.png`);
      const frame = Math.max(0, Math.min(props.durationInFrames - 1, f));
      await remotion(pkgDir, [
        ...["still", bundle, comp, file, `--frame=${frame}`],
        ...["--props", await propsFile(dir, `still-${name}`, props)],
      ]);
      files[name] = file;
    };
    if (job.long) await still("long", "Long", job.long, Math.round(atS * job.long.fps));
    for (const [name, p] of framedOf(job)) await still(name, "Framed", p, Math.round(atS * p.fps));
    for (const [n, p] of job.shorts ?? []) {
      const f = Math.round(atS * p.fps) - p.startFrame;
      if (f >= 0 && f < p.durationInFrames) await still(`short-${n}`, "Short", p, f);
    }
  });
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
 * One bundle for all of them; h264 on VideoToolbox (Remotion's `--hardware-acceleration`, which needs a
 * bitrate, not a CRF). Each video's audio is then leveled to -14 LUFS (loudness.ts). Answers the
 * files by name and the seconds each took.
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
  const timed = async (name: string, fn: () => Promise<void>) => {
    const started = Date.now();
    await fn();
    seconds[name] = Math.round((Date.now() - started) / 100) / 10;
    log(`${name}: ${seconds[name]}s`);
  };
  await withBundle(pkgDir, dir, async (bundle) => {
    const video = async (name: string, comp: string, props: unknown, bitrate: string) => {
      const file = join(out, `${name}.mp4`);
      // Rendered aside, then moved in whole: an approved YouTube draft uploads this very path.
      const part = join(out, `${name}.rendering.mp4`);
      await timed(name, async () => {
        await remotion(pkgDir, [
          ...["render", bundle, comp, part, "--props", await propsFile(dir, name, props)],
          ...["--codec=h264", "--hardware-acceleration=if-possible", `--video-bitrate=${bitrate}`],
        ]);
        const was = await normalizeLoudness(part, ffmpeg);
        if (was) log(`${name}: audio ${was.i} LUFS to -14`);
        await rename(part, file);
      });
      files[name] = file;
    };
    if (job.long) await video("long", "Long", job.long, "12M");
    for (const [name, p] of framedOf(job)) await video(name, "Framed", p, "10M");
    for (const [n, p] of job.shorts ?? []) await video(`short-${n}`, "Short", p, "10M");
    for (const p of job.thumbnails ?? []) {
      const name = `thumb-${p.variant}`;
      const file = join(out, `${name}.jpg`);
      await timed(name, async () =>
        remotion(pkgDir, [
          ...["still", bundle, "Thumbnail", file, "--frame=0", "--image-format=jpeg"],
          ...["--jpeg-quality=90", "--props", await propsFile(dir, name, p)],
        ]),
      );
      files[name] = file;
    }
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
  const file = await propsFile(dir, "promo", props);
  return withBundle(pkgDir, dir, async (bundle) => {
    if (stillS !== undefined) {
      const png = join(out, `still-promo-${stillS}.png`);
      const frame = Math.max(
        0,
        Math.min(props.durationInFrames - 1, Math.round(stillS * props.fps)),
      );
      await remotion(pkgDir, ["still", bundle, "Promo", png, `--frame=${frame}`, "--props", file]);
      return png;
    }
    const mp4 = join(out, "promo.mp4");
    await remotion(pkgDir, [
      ...["render", bundle, "Promo", mp4, "--props", file],
      ...["--codec=h264", "--hardware-acceleration=if-possible", "--video-bitrate=10M"],
    ]);
    await normalizeLoudness(mp4, ffmpeg);
    return mp4;
  });
}

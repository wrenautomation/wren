/**
 * Remotion runs as its own CLI from this package (its bundler and renderer never enter the wren
 * bundle). The edit's folder is the public dir. Renders bundle once into a temp dir whose `public`
 * is a link to that folder: Remotion would otherwise copy the folder (cut files, earlier renders)
 * into every bundle, and its server refuses a linked file but not a linked folder.
 */
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { normalizeLoudness } from "./loudness.js";
import type { LongProps, ShortProps, ThumbnailProps, VerticalProps } from "./props.js";

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

/** Remotion Studio on localhost, live on this edit; runs until Ctrl-C. */
export async function openStudio(pkgDir: string, dir: string, props: LongProps): Promise<void> {
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
    if (job.vertical)
      await still("vertical", "Vertical", job.vertical, Math.round(atS * job.vertical.fps));
    for (const [n, p] of job.shorts ?? []) {
      const f = Math.round(atS * p.fps) - p.startFrame;
      if (f >= 0 && f < p.durationInFrames) await still(`short-${n}`, "Short", p, f);
    }
  });
  return files;
}

export interface RenderJob {
  long?: LongProps;
  /** The whole cut, 9:16. */
  vertical?: VerticalProps;
  /** By 1-based number. */
  shorts?: Map<number, ShortProps>;
  thumbnails?: ThumbnailProps[];
}

/**
 * Render what the job names to `<dir>/out/`: long.mp4, vertical.mp4, short-<n>.mp4, thumb-<n>.jpg.
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
      await timed(name, async () => {
        await remotion(pkgDir, [
          ...["render", bundle, comp, file, "--props", await propsFile(dir, name, props)],
          ...["--codec=h264", "--hardware-acceleration=if-possible", `--video-bitrate=${bitrate}`],
        ]);
        const was = await normalizeLoudness(file, ffmpeg);
        if (was) log(`${name}: audio ${was.i} LUFS to -14`);
      });
      files[name] = file;
    };
    if (job.long) await video("long", "Long", job.long, "12M");
    if (job.vertical) await video("vertical", "Vertical", job.vertical, "10M");
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

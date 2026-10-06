/**
 * Cap recordings (desktop 0.6, beside OBS): a `<name>.cap` project folder whose
 * `recording-meta.json` names the screen, camera and mic files of each segment (a pause starts a
 * new one), with each track's start time. `capTracks` joins them into the screen-with-mic file and
 * the camera file `addVideo` takes, under `<project>/wren/`. Format: CapSoftware/Cap
 * crates/project/src/meta.rs at cap-v0.6.0. Cap's server is never used.
 */
import { execFile } from "node:child_process";
import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);

/** Where Cap keeps its projects on a Mac. */
export const CAP_RECORDINGS = join(
  homedir(),
  "Library/Application Support/so.cap.desktop/recordings",
);

interface CapTrack {
  path: string;
  start_time?: number;
}
interface CapSegment {
  display: CapTrack;
  camera?: CapTrack;
  mic?: CapTrack;
  audio?: CapTrack;
}
/** The parts of recording-meta.json read here: studio (segments) or instant (one output.mp4). */
interface CapMeta {
  pretty_name?: string;
  segments?: CapSegment[];
  display?: CapTrack;
  camera?: CapTrack;
  audio?: CapTrack;
  status?: { status: string; error?: string };
  fps?: number;
  recording?: boolean;
  error?: string;
}

export const isCap = (path: string) => /\.cap\/?$/i.test(path);

/** The project's meta, or null when it has none yet. */
export async function capMeta(project: string): Promise<CapMeta | null> {
  const text = await readFile(join(project, "recording-meta.json"), "utf8").catch(() => null);
  return text === null ? null : (JSON.parse(text) as CapMeta);
}

/**
 * Why a project isn't ready, or null when it is: still recording, failed, or not yet remuxed (Cap
 * finishes a fragmented recording after it stops).
 */
export function capNotReady(m: CapMeta | null): string | null {
  if (!m) return "no recording-meta.json yet";
  if (m.error) return `failed: ${m.error}`;
  if (m.recording !== undefined) return "still recording";
  const s = m.status?.status;
  if (s === "Failed") return `failed: ${m.status?.error ?? "no reason given"}`;
  if (s && s !== "Complete") return s === "NeedsRemux" ? "Cap is still finishing it" : s;
  return null;
}

/** The segments as one shape: a single-segment or instant project is one. */
function segmentsOf(m: CapMeta): CapSegment[] {
  if (m.segments?.length) return m.segments;
  if (m.display)
    return [
      {
        display: m.display,
        ...(m.camera ? { camera: m.camera } : {}),
        ...(m.audio ? { mic: m.audio } : {}),
      },
    ];
  // Instant: one file, sound in it.
  return [{ display: { path: "content/output.mp4" } }];
}

/**
 * The tracks to add from a finished project: the screen with the mic laid under it (each segment,
 * then joined) and the camera joined the same way, with the camera's offset from its start time.
 */
export async function capTracks(
  project: string,
  ffmpeg: string,
): Promise<{ main: string; cam?: string; offsetS?: number }> {
  const m = await capMeta(project);
  const why = capNotReady(m);
  if (why || !m) throw new Error(`${project}: ${why}`);
  const segs = segmentsOf(m);
  const at = (t: CapTrack) => join(project, t.path);
  for (const s of segs)
    if (!(await stat(at(s.display)).catch(() => null))?.isFile())
      throw new Error(`${project}: ${s.display.path} is not one file yet; open it in Cap once`);
  const out = join(project, "wren");
  await mkdir(out, { recursive: true });

  const screens: string[] = [];
  for (const [i, s] of segs.entries()) {
    const mic = s.mic ?? s.audio;
    if (!mic) {
      screens.push(at(s.display));
      continue;
    }
    // The mic's start minus the screen's: later delays it, earlier skips its head.
    const d = (mic.start_time ?? 0) - (s.display.start_time ?? 0);
    const file = join(out, `screen-${i}.mp4`);
    await run(ffmpeg, [
      ...["-v", "error", "-y", "-i", at(s.display)],
      ...(d >= 0 ? ["-itsoffset", String(d)] : ["-ss", String(-d)]),
      ...["-i", at(mic), "-map", "0:v:0", "-map", "1:a:0", "-c:v", "copy", "-c:a", "aac"],
      file,
    ]);
    screens.push(file);
  }
  const main = await joined(ffmpeg, screens, join(out, "screen.mp4"));
  const cams = segs.flatMap((s) => (s.camera ? [at(s.camera)] : []));
  // ponytail: a camera missing from some segments is left out; it would drift after the gap.
  if (!cams.length || cams.length !== segs.length) return { main };
  const first = segs[0] as CapSegment;
  return {
    main,
    cam: await joined(ffmpeg, cams, join(out, "camera.mp4")),
    offsetS: (first.camera?.start_time ?? 0) - (first.display.start_time ?? 0),
  };
}

/** One file from the segments, streams copied; a single segment is used as it is. */
async function joined(ffmpeg: string, files: string[], file: string): Promise<string> {
  if (files.length === 1) return files[0] as string;
  const list = `${file}.txt`;
  await writeFile(list, files.map((f) => `file '${f.replaceAll("'", "'\\''")}'`).join("\n"));
  await run(ffmpeg, [
    "-v",
    "error",
    "-y",
    "-f",
    "concat",
    "-safe",
    "0",
    "-i",
    list,
    "-c",
    "copy",
    file,
  ]);
  return file;
}

/** Finished projects in Cap's folder, oldest first. */
export async function findCapProjects(dir = CAP_RECORDINGS): Promise<string[]> {
  const found: { path: string; at: number }[] = [];
  for (const n of await readdir(dir).catch(() => [] as string[])) {
    if (!isCap(n)) continue;
    const path = join(dir, n);
    if (capNotReady(await capMeta(path).catch(() => null))) continue;
    found.push({ path, at: (await stat(path)).mtimeMs });
  }
  return found.sort((a, b) => a.at - b.at).map((f) => f.path);
}

/**
 * New OBS recordings, found on the Mac (designs/2026-10-06-video-editor.md, step 4): the folder
 * OBS records into, read from its profile, and the files there that are finished. `wren video
 * watch` adds each one once; the desk runs it every minute.
 */
import { execFile } from "node:child_process";
import { readdir, readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { CAM, VIDEO } from "./edit.js";

/** An .ini file as sections of keys; the last value of a key wins. */
export function parseIni(text: string): Record<string, Record<string, string>> {
  const out: Record<string, Record<string, string>> = {};
  let section: Record<string, string> = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    const head = /^\[(.+)\]$/.exec(line);
    if (head) out[head[1] as string] = section = out[head[1] as string] ?? {};
    else if (line && !line.startsWith(";") && line.includes("="))
      section[line.slice(0, line.indexOf("=")).trim()] = line.slice(line.indexOf("=") + 1).trim();
  }
  return out;
}

const read = (f: string) => readFile(f, "utf8").catch(() => null);

/**
 * Where OBS records: the current profile's Simple or Advanced output path. OBS 31 keeps the
 * profile in `user.ini`, older ones in `global.ini`. Null when OBS isn't set up here.
 */
export async function obsRecordingDir(home = homedir()): Promise<string | null> {
  const root = join(home, "Library/Application Support/obs-studio");
  const global = (await read(join(root, "user.ini"))) ?? (await read(join(root, "global.ini")));
  if (global === null) return null;
  const basic = parseIni(global).Basic ?? {};
  const profile = basic.ProfileDir ?? basic.Profile;
  if (!profile) return null;
  const ini = await read(join(root, "basic/profiles", profile, "basic.ini"));
  if (ini === null) return null;
  const p = parseIni(ini);
  const adv = p.AdvOut ?? {};
  const path =
    p.Output?.Mode === "Advanced"
      ? adv.RecType === "FFmpeg"
        ? adv.FFFilePath
        : adv.RecFilePath
      : p.SimpleOutput?.FilePath;
  return path || null;
}

/**
 * The finished recordings in `dir`, oldest first: video files untouched for `quietS` (OBS writes
 * while it records). Source Record's camera files are left out: one file is one video.
 * ponytail: a recording paused longer than `quietS` looks finished; `isOpen` catches it while OBS
 * holds the file.
 */
export async function findRecordings(dir: string, quietS = 60, now = Date.now()) {
  const names = await readdir(dir).catch(() => [] as string[]);
  const found: { file: string; at: number }[] = [];
  for (const n of names) {
    if (!VIDEO.test(n) || n.startsWith("cut-") || CAM.test(n)) continue;
    const s = await stat(join(dir, n)).catch(() => null);
    if (s?.isFile() && now - s.mtimeMs >= quietS * 1000)
      found.push({ file: join(dir, n), at: s.mtimeMs });
  }
  return found.sort((a, b) => a.at - b.at).map((f) => f.file);
}

/** Whether a process (OBS) still has the file open: `lsof` exits 0 when one does. */
export const isOpen = (file: string) =>
  new Promise<boolean>((ok) => execFile("lsof", ["-t", "--", file], (err) => ok(!err)));

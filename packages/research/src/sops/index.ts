/**
 * SOPs built from sources. One folder per SOP: `SOP.md` is the living doc,
 * `notes.md` holds the owner's own rules (top priority, never written by
 * code), `sources/*.md` is ingested text, one file per YouTube video, Drive
 * Doc or local file, with `priority` in its front matter. `buildSop` asks one
 * model for the next SOP.md from all of it; iterating is editing notes.md or
 * SOP.md and building again. Nothing here touches a database.
 */
import { execFile } from "node:child_process";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { promisify } from "node:util";
import type { LlmClient } from "@wren/llm";

const run = promisify(execFile);

export const DEFAULT_PRIORITY = 5;

export interface Source {
  /** File name under `sources/`. */
  name: string;
  md: string;
}

const frontMatter = (fields: Record<string, string | number>) =>
  `---\n${Object.entries(fields)
    .map(([k, v]) => `${k}: ${typeof v === "string" ? JSON.stringify(v) : v}`)
    .join("\n")}\n---\n\n`;

export const clock = (s: number): string => {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.floor(s % 60);
  const mm = `${m}:${String(sec).padStart(2, "0")}`;
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}` : mm;
};

/** What `yt-dlp -J` prints; only what we read. */
export interface VideoInfo {
  id: string;
  title: string;
  channel?: string;
  upload_date?: string;
  webpage_url?: string;
  duration?: number;
  chapters?: { start_time: number; end_time: number; title: string }[] | null;
  subtitles?: Record<string, { ext: string; url: string }[]>;
  automatic_captions?: Record<string, { ext: string; url: string }[]>;
}

/** YouTube's json3 caption track; only what we read. */
export interface Json3 {
  events: { tStartMs: number; segs?: { utf8: string }[] }[];
}

const MARK_EVERY_S = 60;

/** Captions as markdown: a heading per chapter, a `[m:ss]` marker every minute so the SOP can cite a moment. */
export function captionsMarkdown(
  info: VideoInfo,
  track: Json3,
  priority = DEFAULT_PRIORITY,
): string {
  const chapters = info.chapters?.length
    ? info.chapters
    : [{ start_time: 0, end_time: info.duration ?? Number.POSITIVE_INFINITY, title: info.title }];
  const words = track.events
    .filter((e) => e.segs?.length)
    .map((e) => ({
      t: e.tStartMs / 1000,
      text: (e.segs ?? [])
        .map((s) => s.utf8)
        .join("")
        .replace(/\s+/g, " ")
        .trim(),
    }))
    .filter((w) => w.text);
  const body = chapters.map((c) => {
    const lines: string[] = [];
    let mark = Number.NEGATIVE_INFINITY;
    for (const w of words) {
      if (w.t < c.start_time || w.t >= c.end_time) continue;
      if (w.t - mark >= MARK_EVERY_S) {
        mark = w.t;
        lines.push(`\n[${clock(w.t)}]`);
      }
      lines.push(w.text);
    }
    return `## [${clock(c.start_time)}] ${c.title}\n${lines.join(" ").trim()}\n`;
  });
  const uploaded = info.upload_date?.replace(/^(\d{4})(\d{2})(\d{2})$/, "$1-$2-$3");
  return `${frontMatter({
    source: `youtube:${info.id}`,
    title: info.title,
    url: info.webpage_url ?? `https://www.youtube.com/watch?v=${info.id}`,
    ...(info.channel ? { channel: info.channel } : {}),
    ...(uploaded ? { uploaded } : {}),
    priority,
  })}# ${info.title}\n\n${body.join("\n")}`;
}

const captionTrack = (info: VideoInfo) =>
  [info.subtitles?.en, info.automatic_captions?.en, info.automatic_captions?.["en-orig"]]
    .flatMap((t) => t ?? [])
    .find((t) => t.ext === "json3");

/** A YouTube video's captions and chapters, through `yt-dlp` (`ytDlp` is the command, split on spaces: `uvx yt-dlp`). */
export async function youtubeSource(
  url: string,
  ytDlp: string,
  priority = DEFAULT_PRIORITY,
  fetchFn: typeof fetch = fetch,
): Promise<Source> {
  const [cmd, ...pre] = ytDlp.split(/\s+/) as [string, ...string[]];
  const { stdout } = await run(cmd, [...pre, "-J", "--no-warnings", url], {
    maxBuffer: 256 * 1024 * 1024,
  });
  const info = JSON.parse(stdout) as VideoInfo;
  const track = captionTrack(info);
  if (!track) throw new Error(`${url}: no English captions (manual or auto) to read`);
  const res = await fetchFn(track.url);
  if (!res.ok) throw new Error(`${url}: captions fetch HTTP ${res.status}`);
  const json = (await res.json()) as Json3;
  return { name: `youtube-${info.id}.md`, md: captionsMarkdown(info, json, priority) };
}

/** `GET /drive/v3/...` on autobrowse's `drive` site, as the CLI wires it. */
export type DriveGet = (path: string, body: Record<string, unknown>) => Promise<unknown>;

interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  modifiedTime?: string;
}

const GOOGLE_DOC = "application/vnd.google-apps.document";
const FOLDER = "application/vnd.google-apps.folder";

/** Every Google Doc and text file under a Drive folder, recursively, each as one source. */
export async function driveSources(
  folderId: string,
  drive: DriveGet,
  priority = DEFAULT_PRIORITY,
  path = "",
): Promise<Source[]> {
  const out: Source[] = [];
  const { files } = (await drive("/drive/v3/files", {
    q: `'${folderId}' in parents and trashed = false`,
    pageSize: 1000,
    fields: "files(id,name,mimeType,modifiedTime)",
  })) as { files: DriveFile[] };
  for (const f of files) {
    const where = path ? `${path}/${f.name}` : f.name;
    if (f.mimeType === FOLDER) {
      out.push(...(await driveSources(f.id, drive, priority, where)));
      continue;
    }
    const text =
      f.mimeType === GOOGLE_DOC
        ? await drive(`/drive/v3/files/${f.id}/export`, { mimeType: "text/plain" })
        : f.mimeType.startsWith("text/")
          ? await drive(`/drive/v3/files/${f.id}`, { alt: "media" })
          : null;
    if (!text) continue;
    out.push({
      name: `drive-${f.id}.md`,
      md: `${frontMatter({
        source: `drive:${f.id}`,
        title: f.name,
        path: where,
        ...(f.modifiedTime ? { modified: f.modifiedTime.slice(0, 10) } : {}),
        priority,
      })}# ${f.name}\n\n${((text as { text: string }).text ?? "").trim()}\n`,
    });
  }
  return out;
}

/** A local text file as a source. */
export async function fileSource(file: string, priority = DEFAULT_PRIORITY): Promise<Source> {
  const name = basename(file);
  const text = await readFile(file, "utf8");
  return {
    name: `file-${name.replace(/\.(md|txt)$/i, "")}.md`,
    md: `${frontMatter({ source: `file:${name}`, title: name, priority })}${text.trim()}\n`,
  };
}

export const STYLE = `Style: short plain sentences a person would say out loud. Lead with the action. Fewer words, more signal. No filler, no hedging, no hype, no jargon, no restating. No "not X but Y" contrasts, no one-line closers that repeat the point, no colon reveals, no dashes, no forced groups of three, no bold labels on list items. Vary sentence length. As short as it can be and still be followed by someone new; most SOPs fit in 400 to 900 words before the examples.`;

export interface SopInput {
  name: string;
  notes: string;
  current: string;
  /** Highest priority first. */
  sources: { name: string; priority: number; md: string }[];
}

export function sopPrompt(input: SopInput): string {
  const sources = input.sources
    .map((s) => `<source file="${s.name}" priority="${s.priority}">\n${s.md.trim()}\n</source>`)
    .join("\n\n");
  return [
    `Write the next version of the SOP "${input.name}" as markdown. It is a standard operating procedure the owner and their team follow every day.`,
    STYLE,
    "Priority. The owner's notes win over everything. Sources are listed highest priority first; when two disagree, the higher one wins, and a lower one only adds what the higher ones leave out. A source may be dated or off topic: take only what serves this SOP. Make nothing up; every step and rule must come from the notes or a source.",
    'Examples. End with an "## Examples" section holding the one or two best worked examples the sources give (a full email, script or message). Quote each one in full, in a fenced block, with the wording as the source gives it; do not shorten or improve it, only fix obvious caption transcription errors (misheard words, spelling). Under each, keep the source\'s own analysis of why it works, point by point, cited. Examples are the highest-signal part of the SOP, so pick the ones the source itself treats as best.',
    "Citations. After a step or rule, cite where it came from in brackets: the source file stem and, for a video, the nearest [m:ss] marker before the words, e.g. [youtube-abc123 1:02:30] or [drive-9f8e]. Notes need no citation.",
    input.current.trim()
      ? "There is a current SOP.md below. Keep what still holds, word for word where you can. Change only what the notes or a higher-priority source contradicts, and add only what they add. Do not reword for its own sake."
      : "There is no SOP.md yet. Start with a one-line purpose, then numbered steps in the order they happen, then the rules that apply throughout. Use the sections the material asks for, no more.",
    "Reply with only the SOP markdown, starting with a level-one heading.",
    `<notes>\n${input.notes.trim() || "(none yet)"}\n</notes>`,
    `<current>\n${input.current.trim() || "(none yet)"}\n</current>`,
    sources,
  ].join("\n\n");
}

export interface SopDir {
  dir: string;
  notes: string;
  current: string;
  sources: SopInput["sources"];
}

const priorityOf = (md: string) =>
  Number(md.match(/^priority:\s*(\d+)\s*$/m)?.[1] ?? DEFAULT_PRIORITY);

/** One SOP's folder, read. Sources come back highest priority first, then by name. */
export async function readSopDir(dir: string): Promise<SopDir> {
  const read = (f: string) => readFile(join(dir, f), "utf8").catch(() => "");
  const srcDir = join(dir, "sources");
  const names = (await readdir(srcDir).catch(() => [] as string[])).filter((n) =>
    n.endsWith(".md"),
  );
  const sources = await Promise.all(
    names.map(async (name) => {
      const md = await readFile(join(srcDir, name), "utf8");
      return { name: name.replace(/\.md$/, ""), priority: priorityOf(md), md };
    }),
  );
  sources.sort((a, b) => b.priority - a.priority || a.name.localeCompare(b.name));
  return { dir, notes: await read("notes.md"), current: await read("SOP.md"), sources };
}

const NOTES_STUB = `# Notes

Your own rules for this SOP. They beat every source. Code never writes here.
`;

/** Add a source to an SOP's folder (creating it and a notes.md stub); same name overwrites. */
export async function addSource(dir: string, source: Source): Promise<string> {
  await mkdir(join(dir, "sources"), { recursive: true });
  const notes = join(dir, "notes.md");
  await readFile(notes).catch(() => writeFile(notes, NOTES_STUB));
  const file = join(dir, "sources", source.name);
  await writeFile(file, source.md);
  return file;
}

/** Build the next SOP.md from the folder; returns it. The model answers in markdown, no schema. */
export async function buildSop(dir: string, llm: LlmClient): Promise<string> {
  const read = await readSopDir(dir);
  if (!read.sources.length && !read.notes.trim())
    throw new Error(`${dir}: nothing to build from (no sources, empty notes.md)`);
  const name = basename(dir);
  const { text } = await llm.complete(sopPrompt({ name, ...read }), { maxTokens: 8000 });
  const sop = `${text.trim().replace(/^```(?:markdown)?\n([\s\S]*?)\n```$/, "$1")}\n`;
  await writeFile(join(dir, "SOP.md"), sop);
  return sop;
}

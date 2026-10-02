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

const captionTracks = (info: VideoInfo) =>
  [info.subtitles?.en, info.automatic_captions?.en, info.automatic_captions?.["en-orig"]]
    .flatMap((t) => t ?? [])
    .filter((t) => t.ext === "json3");

const GEMINI = (model: string) =>
  `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
// flash first; 503 (model busy) hands the clip to lite.
const GEMINI_MODELS = ["gemini-2.5-flash", "gemini-3.5-flash-lite"];
const CLIP_S = 600;

/**
 * What the video shows on screen (documents, slides, tables, templates), read by Gemini straight
 * from the YouTube URL in `CLIP_S` clips, keys rotated on 429/403. One markdown block per clip,
 * timestamps absolute. Empty when `keys` is empty.
 */
export async function screenText(
  url: string,
  durationS: number,
  keys: readonly string[],
  fetchFn: typeof fetch = fetch,
): Promise<string> {
  if (!keys.length) return "";
  const clips = Array.from({ length: Math.ceil(durationS / CLIP_S) }, (_, i) => i * CLIP_S);
  let next = 0;
  const read = async (start: number): Promise<string> => {
    const end = Math.min(start + CLIP_S, durationS);
    const body = {
      contents: [
        {
          parts: [
            {
              fileData: { fileUri: url },
              videoMetadata: { startOffset: `${start}s`, endOffset: `${end}s`, fps: 0.5 },
            },
            {
              text: `Transcribe in full, verbatim, every document, list, table, slide, template or other text the speaker shows on screen in this clip, each under a [h:mm:ss] heading of the video time it appears (the clip starts at ${clock(start)}). Skip the speaker's face, chat windows and anything already shown earlier in the clip. Markdown. If nothing is shown, reply with the single word none.`,
            },
          ],
        },
      ],
      // Low resolution reads a shown document fine at a quarter of the tokens.
      generationConfig: { mediaResolution: "MEDIA_RESOLUTION_LOW" },
    };
    let last = "";
    let wait = 2000;
    for (let i = 0; i < 24; i++) {
      const key = keys[next++ % keys.length] as string;
      const model = GEMINI_MODELS[i % GEMINI_MODELS.length] as string;
      const res = await fetchFn(GEMINI(model), {
        method: "POST",
        headers: { "content-type": "application/json", "x-goog-api-key": key },
        body: JSON.stringify(body),
      });
      const json = (await res.json()) as {
        candidates?: { content?: { parts?: { text?: string }[] } }[];
        error?: { message?: string };
      };
      if (res.ok)
        return (json.candidates?.[0]?.content?.parts ?? [])
          .map((p) => p.text ?? "")
          .join("")
          .trim();
      last = `${model} HTTP ${res.status} ${json.error?.message ?? ""}`.trim();
      if (![401, 402, 403, 429, 500, 503].includes(res.status))
        throw new Error(`gemini ${clock(start)}: ${last}`);
      // Busy or throttled: back off (2s doubling to 1 min) before the next key and model.
      await new Promise((r) => setTimeout(r, wait));
      wait = Math.min(wait * 2, 60_000);
    }
    // One unread clip must not lose the other 23: leave a marker and carry on.
    console.warn(`gemini ${clock(start)}: unread, last ${last}`);
    return `[${clock(start)}] (not read: ${last})`;
  };
  const out: string[] = [];
  // ponytail: 4 clips at a time; limits are per key, so go wider if it ever drags.
  for (let i = 0; i < clips.length; i += 4) {
    const texts = await Promise.all(clips.slice(i, i + 4).map(read));
    out.push(...texts.filter((t) => t && t.toLowerCase() !== "none"));
  }
  return out.join("\n\n");
}

/** A YouTube video's captions and chapters, through `yt-dlp` (`ytDlp` is the command, split on spaces: `uvx yt-dlp`). */
export async function youtubeSource(
  url: string,
  ytDlp: string,
  priority = DEFAULT_PRIORITY,
  opts: { geminiKeys?: readonly string[]; fetchFn?: typeof fetch } = {},
): Promise<Source> {
  const fetchFn = opts.fetchFn ?? fetch;
  const [cmd, ...pre] = ytDlp.split(/\s+/) as [string, ...string[]];
  const { stdout } = await run(cmd, [...pre, "-J", "--no-warnings", "--no-playlist", url], {
    maxBuffer: 256 * 1024 * 1024,
  });
  const info = JSON.parse(stdout) as VideoInfo;
  const tracks = captionTracks(info);
  if (!tracks.length) throw new Error(`${url}: no English captions (manual or auto) to read`);
  // YouTube throttles single caption URLs (429); the same text sits behind several, so try each.
  let json: Json3 | undefined;
  let last = 0;
  for (const t of tracks) {
    const res = await fetchFn(t.url);
    last = res.status;
    if (!res.ok) continue;
    json = (await res.json()) as Json3;
    break;
  }
  if (!json) throw new Error(`${url}: captions fetch HTTP ${last} on all ${tracks.length} tracks`);
  let md = captionsMarkdown(info, json, priority);
  const screen = await screenText(url, info.duration ?? 0, opts.geminiKeys ?? [], fetchFn);
  if (screen)
    md += `\n## On screen\n\nWhat the video showed (documents, slides, tables), read from the frames; the transcript above has only the speech.\n\n${screen}\n`;
  return { name: `youtube-${info.id}.md`, md };
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
    "Structure. When a source teaches its own framework (numbered parts, a formula, named stages), make that the SOP's skeleton in the source's order, with the source's names, and nest everything else under it. Cover every key point the source makes; a missed point is worse than a longer SOP.",
    "Points. A source whose text is a list of points (its file name starts with points-) is the owner's curated extract of a raw source: every line is a point with its citation already in brackets. The owner has deleted what they don't want; what remains is in. A line starting with ! is one the owner marked important and must appear in the SOP. Keep each point's citation as given.",
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
      const stem = name.replace(/\.md$/, "");
      const raw = await readFile(join(srcDir, name), "utf8");
      // A curated points file stands in for the raw source when it exists.
      const points = await readFile(join(dir, "points", name), "utf8").catch(() => "");
      return points
        ? { name: `points-${stem}`, priority: priorityOf(points), md: points }
        : { name: stem, priority: priorityOf(raw), md: raw };
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

/** Prompt that turns one raw source into an exhaustive, cited list of points for the owner to curate. */
export function pointsPrompt(stem: string, md: string): string {
  return [
    `Extract every point the source below makes, as a markdown list, for the owner to curate before an SOP is built from it. Be exhaustive: every rule, step, claim, number, heuristic, warning, example and the reasoning behind it. Missing a point is the one failure that matters; a long list is fine.`,
    "One point per line, starting with \"- \", in the source's own order, under the source's section headings. Each line ends with its citation in brackets: the source stem and, for a video, the nearest [m:ss] marker before the words, e.g. [" +
      stem +
      " 1:02:30]. Keep the source's wording where it is specific; fix only obvious caption transcription errors.",
    "Worked examples (a full email, script or message) are quoted in full inside a fenced block, followed by the source's own analysis of why it works as points.",
    'An "## On screen" section is what the video showed (documents, tables, lists); carry every item of it as points, cited to its time. On-screen text is often the highest-signal part of a source.',
    "Reply with only the markdown list and headings. Start with the front matter block from the source, unchanged.",
    `<source file="${stem}">\n${md.trim()}\n</source>`,
  ].join("\n\n");
}

/** Write `points/<stem>.md` for one source (or every source without one); returns the files written. */
export async function extractPoints(dir: string, llm: LlmClient, only?: string): Promise<string[]> {
  const read = await readSopDir(dir);
  await mkdir(join(dir, "points"), { recursive: true });
  const out: string[] = [];
  for (const s of read.sources) {
    if (s.name.startsWith("points-")) continue;
    if (only && s.name !== only) continue;
    const { text } = await llm.complete(pointsPrompt(s.name, s.md), { maxTokens: 32_000 });
    const file = join(dir, "points", `${s.name}.md`);
    // Models drop the stem from citations; a bare [m:ss] or [h:mm:ss] gets it back.
    const md = text
      .trim()
      .replace(/^```(?:markdown)?\n([\s\S]*?)\n```$/, "$1")
      .replace(/\[(\d{1,2}:\d{2}(?::\d{2})?)\]/g, `[${s.name} $1]`);
    await writeFile(file, `${md}\n`);
    out.push(file);
  }
  return out;
}

/** The folder as a Claude Code skill. SKILL.md injects SOP.md and the refs listing at load time (`!\`cmd\``), so the model never has to go read them. */
export function skillMd(name: string, dir: string, sop: string): string {
  const purpose =
    sop
      .split("\n")
      .find((l) => l.trim() && !l.startsWith("#"))
      ?.trim() ?? name;
  const q = JSON.stringify(dir);
  return `---
name: sop-${name}
description: ${JSON.stringify(`SOP: ${purpose}`)}
---

Follow this SOP start to finish. Its examples and prompts are the bar.

!\`cat ${q}/SOP.md\`

Reference files (designs, PDFs, images) in \`${dir}/refs/\`; open the relevant ones before writing:

!\`ls ${q}/refs 2>/dev/null || echo "(none)"\`
`;
}

/** Write SKILL.md from the folder's current SOP.md. */
export async function writeSkill(dir: string): Promise<string> {
  const sop = await readFile(join(dir, "SOP.md"), "utf8");
  const file = join(dir, "SKILL.md");
  await writeFile(file, skillMd(basename(dir), dir, sop));
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
  await writeSkill(dir);
  // ponytail: tokens ≈ chars/4; swap in a real tokenizer if the estimate starts to matter.
  const row = (name: string, md: string) =>
    `${name}\t${md.split(/\s+/).filter(Boolean).length} words\t~${Math.round(md.length / 4)} tokens`;
  await writeFile(
    join(dir, "counts.tsv"),
    `${[row("SOP.md", sop), row("notes.md", read.notes), ...read.sources.map((s) => row(`sources/${s.name}.md`, s.md))].join("\n")}\n`,
  );
  return sop;
}

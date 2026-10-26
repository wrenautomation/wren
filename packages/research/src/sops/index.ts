/**
 * SOPs built from sources. One folder per SOP: `SOP.md` is the living doc,
 * `notes.md` holds the owner's own rules (top priority, never written by
 * code; its front matter names what the SOP governs), `calls.md` and `standard.md` are the
 * owner's keep / tune / drop calls and the measured numbers (both written by `wren sop sync`,
 * from the learn package), `sources/*.md` is ingested text, one file per YouTube video, other
 * video (Instagram reel, TikTok, X), Drive Doc or local file, with `priority` in its front matter,
 * and `points/*.md` is each source's generated list of points. `buildSop` asks one
 * model for the next SOP.md from all of it; iterating is editing notes.md, calling on
 * pieces, or editing SOP.md and building again. The videos and audio are read by scribe
 * (`@wrenautomation/scribe/video`); this file only files what it read. Nothing here touches a
 * database.
 */
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import type { LlmClient } from "@wren/llm";
import {
  readAudio,
  readVideo,
  readYoutube,
  readYoutubeByUrl,
  type VideoRead,
  type WatchOptions,
} from "@wrenautomation/scribe/video";
import { expandCites, numberCites } from "./cites.js";

export { expandCites, numberCites };

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

/**
 * A scribe read filed as a source: the read's facts and the SOP's `priority` as front matter,
 * then its title and sections. Named `<kind>-<id>.md`.
 */
export function toSource(read: VideoRead, priority = DEFAULT_PRIORITY): Source {
  return {
    name: `${read.kind}-${read.id}.md`,
    md: `${frontMatter({
      source: `${read.kind}:${read.id}`,
      title: read.title,
      url: read.url,
      ...(read.channel ? { channel: read.channel } : {}),
      ...(read.uploaded ? { uploaded: read.uploaded } : {}),
      priority,
      ...(read.duration ? { duration: read.duration } : {}),
      ...(read.thumbnail ? { thumbnail: read.thumbnail } : {}),
    })}# ${read.title}\n\n${read.body}`,
  };
}

/**
 * A YouTube video's captions and chapters through `yt-dlp` (`ytDlp` is the command, split on
 * spaces: `uvx yt-dlp`), plus what it showed on screen when Gemini keys are given: scribe's
 * `readYoutube`, filed with the SOP's priority.
 */
export const youtubeSource = async (
  url: string,
  ytDlp: string,
  priority = DEFAULT_PRIORITY,
  opts: { geminiKeys?: readonly string[]; fetchFn?: typeof fetch } = {},
): Promise<Source> => toSource(await readYoutube(url, { ytDlp, ...opts }), priority);

/**
 * A YouTube video read from its URL alone, no download and no home IP (scribe's
 * `readYoutubeByUrl`): what the worker reads with, through the gateway (`gatewayGemini` in
 * `@wren/llm`); the Mac's `youtubeSource` uses the captions instead.
 */
export const youtubeByUrl = async (
  url: string,
  opts: {
    geminiKeys: readonly string[];
    fetchFn?: typeof fetch;
    durationS?: number | null | undefined;
    priority?: number;
  },
): Promise<Source> => toSource(await readYoutubeByUrl(url, opts), opts.priority);

/**
 * Any other video `yt-dlp` fetches (Instagram reel, TikTok, X), watched (scribe's `readVideo`):
 * the caption, then its Speech, On screen and Cuts.
 */
export const videoSource = async (
  url: string,
  ytDlp: string,
  priority = DEFAULT_PRIORITY,
  opts: Omit<WatchOptions, "ytDlp">,
): Promise<Source> => toSource(await readVideo(url, { ...opts, ytDlp }), priority);

/**
 * A podcast episode heard from its audio file (scribe's `readAudio`): cut by ffmpeg, each clip
 * transcribed by Gemini. `url` is the episode's page; `title` and `creator` are what its feed said.
 */
export const audioSource = async (
  audioUrl: string,
  opts: {
    url: string;
    title?: string | null;
    creator?: string | null;
    geminiKeys: readonly string[];
    fetchFn?: typeof fetch;
    ffmpeg?: string;
    priority?: number;
  },
): Promise<Source> => toSource(await readAudio(audioUrl, opts), opts.priority);

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

interface SopInput {
  name: string;
  notes: string;
  /** `calls.md`: the owner's calls on pieces, rolled up; empty when none. */
  calls: string;
  /** `standard.md`: the numbers the pieces measure; empty when none. */
  standard: string;
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
    "Priority. The owner's notes win over everything. Then the owner's calls, then the standard, then the sources. Sources are listed highest priority first; when two disagree, the higher one wins, and a lower one only adds what the higher ones leave out. A source may be dated or off topic: take only what serves this SOP. Make nothing up; every step and rule must come from the notes, the calls, the standard or a source.",
    "Calls. The <calls> block is the owner's own judgement on real pieces: keep means do this, tune means do this with the change in their words, drop means never do this. A pattern marked rule (kept on several pieces, dropped on none) is a rule of the SOP; a drop with words is a rule too, in the owner's words. A tune on a point forces that point into the SOP, changed as the words say. Cite a call by its piece, as given: [learn:12].",
    "Standard. The <standard> block is measured on the pieces the SOP governs: a median and the middle half for each number, counts for each closed set. Where the SOP gives a number (length, lines, cuts, when the product shows), use the standard's, as a range, and say it is measured. Never invent a number the standard does not give.",
    'Examples. End with an "## Examples" section holding the one or two best worked examples the sources give (a full email, script or message). Quote each one in full, in a fenced block, with the wording as the source gives it; do not shorten or improve it, only fix obvious caption transcription errors (misheard words, spelling). Under each, keep the source\'s own analysis of why it works, point by point, cited. Examples are the highest-signal part of the SOP, so pick the ones the source itself treats as best.',
    "Structure. When a source teaches its own framework (numbered parts, a formula, named stages), make that the SOP's skeleton in the source's order, with the source's names, and nest everything else under it. Cover every key point the source makes; a missed point is worse than a longer SOP.",
    "Points. A source whose text is a list of points (its file name starts with points-) is the generated extract of a raw source: every line is a point with its citation already in brackets. Take the points that serve this SOP and that the notes and calls do not contradict. Keep each point's citation as given.",
    "Citations. After a step or rule, cite where it came from in brackets: the source file stem and, for a video, the nearest [m:ss] marker before the words, e.g. [youtube-abc123 1:02:30] or [drive-9f8e]. Notes need no citation.",
    input.current.trim()
      ? "There is a current SOP.md below. Keep what still holds, word for word where you can. Change only what the notes or a higher-priority source contradicts, and add only what they add. Do not reword for its own sake."
      : "There is no SOP.md yet. Start with a one-line purpose, then numbered steps in the order they happen, then the rules that apply throughout. Use the sections the material asks for, no more.",
    "Reply with only the SOP markdown, starting with a level-one heading.",
    `<notes>\n${input.notes.trim() || "(none yet)"}\n</notes>`,
    `<calls>\n${input.calls.trim() || "(none yet)"}\n</calls>`,
    `<standard>\n${input.standard.trim() || "(none yet)"}\n</standard>`,
    `<current>\n${input.current.trim() || "(none yet)"}\n</current>`,
    sources,
  ].join("\n\n");
}

interface SopDir {
  dir: string;
  /** `notes.md` without its front matter (the scope lines are for `wren sop sync`, not the model). */
  notes: string;
  calls: string;
  standard: string;
  current: string;
  sources: SopInput["sources"];
}

const FRONT_MATTER = /^---\n[\s\S]*?\n---\n?/;

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
  return {
    dir,
    notes: (await read("notes.md")).replace(FRONT_MATTER, ""),
    calls: await read("calls.md"),
    standard: await read("standard.md"),
    current: expandCites(await read("SOP.md")),
    sources,
  };
}

const NOTES_STUB = `---
kinds:
platforms:
topic:
set:
---

# Notes

Your own rules for this SOP. They beat every source. Code never writes here. The front matter
names what the SOP governs (kinds post, film, reel, video; platforms; topic words; set of creators
and brands): \`wren sop sync\` measures those pieces into standard.md and rolls your calls into calls.md.
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

/** Prompt that turns one raw source into an exhaustive, cited list of points. */
function pointsPrompt(stem: string, md: string): string {
  return [
    `Extract every point the source below makes, as a markdown list, before an SOP is built from it. Be exhaustive: every rule, step, claim, number, heuristic, warning, example and the reasoning behind it. Missing a point is the one failure that matters; a long list is fine.`,
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
function skillMd(name: string, dir: string, sop: string): string {
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
  const sop = await numberCites(
    dir,
    `${text.trim().replace(/^```(?:markdown)?\n([\s\S]*?)\n```$/, "$1")}\n`,
  );
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

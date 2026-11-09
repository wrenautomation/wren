/**
 * SOPs built from sources, kept in the knowledge repo (`@wrenautomation/knowledge`; design:
 * designs/2026-11-09-knowledge-repo.md). An SOP is a guide record (`guides/<name>.md`, its `[n]`
 * cites = the nth id in `cites`); its sources are source records tagged with its name
 * (`sources/<stem>.md`, one per YouTube video, other video, Drive Doc or file, `priority` 1-9); each
 * source's extracted points are finding records tagged with it. `topics/<name>/` holds the rest:
 * `notes.md` (the owner's own rules, top priority, never written by code; its front matter names
 * what the SOP governs), `calls.md` and `standard.md` (the owner's keep / tune / drop calls and the
 * measured numbers, written by `wren sop sync` from the learn package), refs, SKILL.md. `buildSop` asks one
 * model for the next guide from all of it; iterating is editing notes.md, calling on
 * pieces, or editing the guide and building again. Every record write is one commit with a by and a why. The videos and audio are read by
 * `@wrenautomation/read/video`; this file only files what it read. Nothing here touches a
 * database.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import type { LlmClient } from "@wren/llm";
import {
  type Change,
  loadWorking,
  newId,
  readRecord,
  render,
  write,
} from "@wrenautomation/knowledge";
import type { Model } from "@wrenautomation/models";
import type { Ear } from "@wrenautomation/models/hear";
import type { Fetched, MediaStore, VideoRead, WatchOptions } from "@wrenautomation/read/video";
import { keptRead, mediaKey, readAudio, readVideo, readYoutube } from "@wrenautomation/read/video";
import { expandCites, numberCites } from "./cites.js";
import { atOf, type Point, pointsOf, pointsText, pointTitle } from "./points.js";

export { expandCites, numberCites, type Point, pointsOf, pointsText };

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
 * A read filed as a source: the read's facts and the SOP's `priority` as front matter,
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
 * spaces: `uvx yt-dlp`), plus what it showed on screen when a video model is given (`geminiVideo`):
 * `readYoutube`, filed with the SOP's priority. `ear` hears the audio when captions 429 or are missing.
 * `store` keeps the read: a URL is read once (WA-1184).
 */
export const youtubeSource = async (
  url: string,
  ytDlp: string,
  priority = DEFAULT_PRIORITY,
  opts: {
    video?: Model | null;
    fetchFn?: typeof fetch;
    ear?: Ear | undefined;
    ffmpeg?: string | undefined;
    store?: MediaStore | undefined;
  } = {},
): Promise<Source> => {
  const { ffmpeg, store, ...rest } = opts;
  const key = mediaKey(url);
  // with the screen: its own read, apart from a captions-only one (weaver's key)
  const kept = key && opts.video ? `${key}.screen` : key;
  return toSource(
    await keptRead(store, kept, () =>
      readYoutube(url, { ytDlp, ...rest, ...(ffmpeg ? { ffmpeg } : {}) }),
    ),
    priority,
  );
};

/**
 * Any other video (Instagram reel, TikTok, X), watched (`readVideo`): the caption, then its
 * Speech, On screen and Cuts. The file: the store's copy, else `mediaUrl`, else yt-dlp. A kept
 * read skips all of it.
 */
export const videoSource = async (
  url: string,
  ytDlp: string,
  priority = DEFAULT_PRIORITY,
  opts: Omit<WatchOptions, "ytDlp"> & Fetched,
): Promise<Source> =>
  toSource(
    await keptRead(opts.store, mediaKey(url), () => readVideo(url, { ...opts, ytDlp })),
    priority,
  );

/**
 * A podcast episode heard from its audio file (`readAudio`): cut by ffmpeg, each clip
 * transcribed by a model that takes audio (`geminiVideo`). `url` is the episode's page; `title`
 * and `creator` are what its feed said.
 */
export const audioSource = async (
  audioUrl: string,
  opts: {
    url: string;
    title?: string | null;
    creator?: string | null;
    model: Model;
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
  root: string;
  /** `topics/<name>/`: notes, calls, standard, counts, refs, SKILL.md. */
  dir: string;
  /** `notes.md` without its front matter (the scope lines are for `wren sop sync`, not the model). */
  notes: string;
  calls: string;
  standard: string;
  /** The guide's body, cites in the long form; empty before the first build. */
  current: string;
  /** The guide's cites: `[n]` in its body is the nth. */
  cites: string[];
  sources: SopInput["sources"];
}

const FRONT_MATTER = /^---\n[\s\S]*?\n---\n?/;

export const topicDir = (root: string, name: string) => join(root, "topics", name);

type Loaded = ReturnType<typeof loadWorking>["docs"][number]["doc"];
const live = (d: Loaded) => d.fm.status === "live";
const tagged = (d: Loaded, name: string) => d.fm.tags.includes(name);

/** A source record as the model reads it: what it is, then its text. */
function sourceText(d: Loaded): string {
  const f = d.fm as Record<string, unknown>;
  const head = ["title", "url", "handle", "priority"]
    .filter((k) => f[k] !== undefined)
    .map((k) => `${k}: ${JSON.stringify(f[k])}`);
  return `---\n${head.join("\n")}\n---\n\n${d.body}\n`;
}

/** The points a source has for this SOP, in order. */
function pointsFor(docs: Loaded[], stem: string, name: string): Loaded[] {
  return docs
    .filter((d) => d.fm.type === "finding" && live(d) && d.fm.source === stem && tagged(d, name))
    .sort((a, b) => Number(a.fm.order ?? 0) - Number(b.fm.order ?? 0));
}

const asPoint = (d: Loaded): Point => ({
  form: d.fm.form === "passage" ? "passage" : "point",
  section: typeof d.fm.section === "string" ? d.fm.section : null,
  text: d.body,
  must: d.fm.tags.includes("must"),
});

/**
 * One SOP, read from the knowledge repo: the topic folder's files, its guide, and the live sources
 * tagged with its name (each as its points when it has some). Highest priority first, then by name.
 */
export async function readSopDir(root: string, name: string): Promise<SopDir> {
  const dir = topicDir(root, name);
  const read = (f: string) => readFile(join(dir, f), "utf8").catch(() => "");
  const docs = loadWorking(root).docs.map((l) => l.doc);
  const sources = docs
    .filter((d) => d.fm.type === "source" && live(d) && tagged(d, name))
    .map((d) => {
      const priority = Number(d.fm.priority ?? DEFAULT_PRIORITY);
      const points = pointsFor(docs, d.fm.id, name);
      // Curated points stand in for the raw source when there are some.
      return points.length
        ? { name: `points-${d.fm.id}`, priority, md: pointsText(points.map(asPoint)) }
        : { name: d.fm.id, priority, md: sourceText(d) };
    });
  sources.sort((a, b) => b.priority - a.priority || a.name.localeCompare(b.name));
  const guide = docs.find((d) => d.fm.type === "guide" && d.fm.id === name);
  return {
    root,
    dir,
    notes: (await read("notes.md")).replace(FRONT_MATTER, ""),
    calls: await read("calls.md"),
    standard: await read("standard.md"),
    current: guide ? expandCites(guide.body, guide.fm.cites) : "",
    cites: guide?.fm.cites ?? [],
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

/** `toSource`'s front matter: JSON strings and bare numbers, one per line. */
function sourceFields(md: string): { fields: Record<string, string | number>; body: string } {
  const m = md.match(FRONT_MATTER);
  if (!m) return { fields: {}, body: md.trim() };
  const fields: Record<string, string | number> = {};
  for (const line of m[0].split("\n").slice(1, -2)) {
    const kv = line.match(/^([a-z_]+):\s*(.*)$/);
    if (!kv?.[1]) continue;
    const v = kv[2] ?? "";
    fields[kv[1]] = v.startsWith('"') ? (JSON.parse(v) as string) : /^\d+$/.test(v) ? Number(v) : v;
  }
  return { fields, body: md.slice(m[0].length).trim() };
}

const kindOf = (stem: string, url: string | undefined) =>
  stem.startsWith("youtube-")
    ? "video"
    : stem.startsWith("instagram-")
      ? /\/reel\//.test(url ?? "")
        ? "reel"
        : "post"
      : stem.startsWith("tiktok-")
        ? "reel"
        : stem.startsWith("x-")
          ? "post"
          : stem.startsWith("web-")
            ? "page"
            : stem.startsWith("github-")
              ? "repo"
              : /^(drive|file|note)-/.test(stem)
                ? "doc"
                : "other";

/** Who writes and why: every record carries both. */
export interface By {
  by: string;
  why: string;
}

/**
 * Add a source to an SOP: a source record (`sources/<stem>.md`, one commit) tagged with the SOP's
 * name, and the topic folder with a notes.md stub. A source already there gets the new text and the tag.
 */
export async function addSource(
  root: string,
  name: string,
  source: Source,
  who: By,
): Promise<string> {
  const dir = topicDir(root, name);
  await mkdir(dir, { recursive: true });
  const notes = join(dir, "notes.md");
  await readFile(notes).catch(() => writeFile(notes, NOTES_STUB));
  const id = source.name.replace(/\.md$/, "");
  const { fields, body } = sourceFields(source.md);
  const { source: origin, channel, title, url, priority, ...rest } = fields;
  const record = {
    title: String(title ?? body.match(/^# (.+)$/m)?.[1] ?? id),
    kind: kindOf(id, url as string | undefined),
    ...(url ? { url } : {}),
    ...(channel ? { handle: channel } : {}),
    ...(priority ? { priority } : {}),
    ...(origin ? { origin } : {}),
    ...rest,
    body,
  };
  const prev = loadWorking(root).docs.find((l) => l.doc.fm.id === id);
  await write(
    root,
    [
      prev
        ? {
            op: "edit",
            id,
            ...record,
            tags: [...new Set([...prev.doc.fm.tags, name])].sort(),
          }
        : { op: "add", type: "source", id, tags: [name], ...record },
    ],
    who,
  );
  return join(root, "sources", `${id}.md`);
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
    "Reply with only the markdown list and headings.",
    `<source file="${stem}">\n${md.trim()}\n</source>`,
  ].join("\n\n");
}

/**
 * Extract each source's points as findings (one per point or passage, tagged with the SOP), one
 * commit per source: every source of the SOP without points, or only `only` (its old points retired).
 * Returns the stems extracted.
 */
export async function extractPoints(
  root: string,
  name: string,
  llm: LlmClient,
  who: Pick<By, "by">,
  only?: string,
): Promise<string[]> {
  const docs = loadWorking(root).docs.map((l) => l.doc);
  const out: string[] = [];
  for (const s of docs.filter((d) => d.fm.type === "source" && live(d) && tagged(d, name))) {
    const stem = s.fm.id;
    const old = pointsFor(docs, stem, name);
    if (only ? stem !== only : old.length) continue;
    const { text } = await llm.complete(pointsPrompt(stem, sourceText(s)), { maxTokens: 32_000 });
    // Models drop the stem from citations; a bare [m:ss] or [h:mm:ss] gets it back.
    const md = text
      .trim()
      .replace(/^```(?:markdown)?\n([\s\S]*?)\n```$/, "$1")
      .replace(FRONT_MATTER, "")
      .replace(/\[(\d{1,2}:\d{2}(?::\d{2})?)\]/g, `[${stem} $1]`);
    const points = pointsOf(md);
    if (!points.length) throw new Error(`${stem}: the model gave no points`);
    const changes: Change[] = [
      // a point shared with another SOP stays live there
      ...old.map((d): Change => {
        const tags = d.fm.tags.filter((t) => t !== name);
        return tags.some((t) => t !== "must")
          ? { op: "edit", id: d.fm.id, tags }
          : { op: "retire", id: d.fm.id };
      }),
      ...points.map(
        (p, i): Change => ({
          op: "add",
          type: "finding",
          id: newId(pointTitle(p, `${stem} passage`)),
          title: pointTitle(p, stem),
          tags: [name, ...(p.must ? ["must"] : [])],
          source: stem,
          ...(atOf(p.text) ? { at: atOf(p.text) } : {}),
          form: p.form,
          order: i + 1,
          ...(p.section ? { section: p.section } : {}),
          body: p.text,
        }),
      ),
    ];
    await write(root, changes, { by: who.by, why: `points extracted from ${stem} for ${name}` });
    out.push(stem);
  }
  return out;
}

/** The topic folder as a Claude Code skill. SKILL.md renders the guide and lists refs at load time (`!\`cmd\``), so the model never has to go read them. */
function skillMd(root: string, name: string, description: string): string {
  const dir = topicDir(root, name);
  const q = JSON.stringify(dir);
  return `---
name: sop-${name}
description: ${JSON.stringify(`SOP: ${description}`)}
---

Follow this SOP start to finish. Its examples and prompts are the bar.

!\`knowledge --repo ${JSON.stringify(root)} render ${name}\`

Reference files (designs, PDFs, images) in \`${dir}/refs/\`; open the relevant ones before writing:

!\`ls ${q}/refs 2>/dev/null || echo "(none)"\`
`;
}

/** The first line of a guide that is not a heading: what the SOP is for. */
const purposeOf = (body: string, name: string) =>
  body
    .split("\n")
    .find((l) => l.trim() && !l.startsWith("#"))
    ?.trim() ?? name;

/** Write `topics/<name>/SKILL.md` from the guide. */
export async function writeSkill(root: string, name: string): Promise<string> {
  const guide = readRecord(root, name);
  if (guide?.fm.type !== "guide") throw new Error(`${name}: no guide (sop build first)`);
  const file = join(topicDir(root, name), "SKILL.md");
  await mkdir(topicDir(root, name), { recursive: true });
  await writeFile(file, skillMd(root, name, guide.fm.description ?? purposeOf(guide.body, name)));
  return file;
}

/** The SOP as one markdown doc: the guide's body and its Sources list (what a playbook and a skill read). */
export const sopText = (root: string, name: string) => render(root, name);

/** Renumber a guide's cites (`wren sop cite`); false when nothing changed. */
export async function renumberGuide(root: string, name: string, who: By): Promise<boolean> {
  const guide = readRecord(root, name);
  if (guide?.fm.type !== "guide") return false;
  const known = sourceIds(root);
  const next = numberCites(expandCites(guide.body, guide.fm.cites), guide.fm.cites, known);
  if (next.body.trimEnd() === guide.body.trimEnd() && next.cites.join() === guide.fm.cites.join())
    return false;
  await write(root, [{ op: "edit", id: name, body: next.body, cites: next.cites }], who);
  return true;
}

const sourceIds = (root: string) =>
  new Set(
    loadWorking(root)
      .docs.filter((l) => l.doc.fm.type === "source")
      .map((l) => l.doc.fm.id),
  );

/**
 * Build the next guide (`guides/<name>.md`, one commit) from the topic folder and the sources; then
 * SKILL.md and counts.tsv. Returns the SOP as rendered. The model answers in markdown, no schema.
 */
export async function buildSop(
  root: string,
  name: string,
  llm: LlmClient,
  who: Pick<By, "by">,
): Promise<string> {
  const read = await readSopDir(root, name);
  if (!read.sources.length && !read.notes.trim())
    throw new Error(`${name}: nothing to build from (no sources, empty notes.md)`);
  const { text } = await llm.complete(sopPrompt({ name, ...read }), { maxTokens: 8000 });
  const { body, cites } = numberCites(
    `${text.trim().replace(/^```(?:markdown)?\n([\s\S]*?)\n```$/, "$1")}\n`,
    read.cites,
    sourceIds(root),
  );
  const fields = {
    title: body.match(/^# (.+)$/m)?.[1] ?? name,
    description: purposeOf(body, name),
    cites,
    body,
  };
  await write(
    root,
    [
      read.current || read.cites.length
        ? { op: "edit", id: name, ...fields }
        : { op: "add", type: "guide", id: name, topic: name, ...fields },
    ],
    { by: who.by, why: `built from notes, calls, the standard and ${read.sources.length} sources` },
  );
  await writeSkill(root, name);
  const sop = render(root, name);
  // ponytail: tokens ≈ chars/4; swap in a real tokenizer if the estimate starts to matter.
  const row = (n: string, md: string) =>
    `${n}\t${md.split(/\s+/).filter(Boolean).length} words\t~${Math.round(md.length / 4)} tokens`;
  await writeFile(
    join(read.dir, "counts.tsv"),
    `${[row("SOP", sop), row("notes.md", read.notes), ...read.sources.map((s) => row(`sources/${s.name}.md`, s.md))].join("\n")}\n`,
  );
  return sop;
}

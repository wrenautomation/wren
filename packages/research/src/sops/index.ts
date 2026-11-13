/**
 * SOPs built from sources, kept in Canon (`@wrenautomation/knowledge`; design:
 * designs/2026-11-09-knowledge-repo.md). An SOP is a guide record (`guides/<name>.md`, the
 * procedure; its `[n]` cites = the nth id in `cites`, sources first, then the rule sets it uses) plus
 * rule sets (`rules/<name>/<set>.md`, one rule per line with a fixed id; `./sets.ts`). A guide may
 * also cite another topic's set: one owner, many users. Its sources are source records tagged with its name
 * (`sources/<stem>.md`, one per YouTube video, other video, Drive Doc or file, `priority` 1-9); each
 * source's extracted points are finding records tagged with it. `topics/<name>/` holds the rest:
 * `notes.md` (the owner's own rules, top priority, never written by code; its front matter names
 * what the SOP governs), `calls.md` and `standard.md` (the owner's keep / tune / drop calls and the
 * measured numbers, written by `wren topic sync` from Canon breakdowns), refs, SKILL.md. `buildSop` asks one
 * model for the next guide and its own sets from all of it, as one doc that code splits; iterating is editing notes.md, calling on
 * pieces, or editing the guide and building again. Every record write is one commit with a by and a why. The videos and audio are read by
 * `@wrenautomation/read/video`; this file only files what it read. Nothing here touches a
 * database.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import type { LlmClient } from "@wren/llm";
import {
  type Change,
  citeLine,
  loadWorking,
  newId,
  readRecord,
  sourceId,
  write,
} from "@wrenautomation/knowledge";
import type { Model } from "@wrenautomation/models";
import type { Ear } from "@wrenautomation/models/hear";
import type { Fetcher } from "@wrenautomation/read/fetch";
import { pdfText, readPage, withoutNul } from "@wrenautomation/read/text";
import type { Fetched, MediaStore, VideoRead, WatchOptions } from "@wrenautomation/read/video";
import {
  keptRead,
  mediaKey,
  readStats,
  readVideo,
  readYoutube,
  seeYoutube,
} from "@wrenautomation/read/video";
import { expandCites, numberCites } from "./cites.js";
import { atOf, type Point, pointsOf, pointsText, pointTitle } from "./points.js";
import { assignIds, freePrefix, mergeDoc, prefixesIn, type SetBlock, splitDoc } from "./sets.js";

export {
  assignIds,
  expandCites,
  mergeDoc,
  numberCites,
  type Point,
  pointsOf,
  pointsText,
  splitDoc,
};

export const DEFAULT_PRIORITY = 5;

export interface Source {
  /** File name under `sources/`. */
  name: string;
  md: string;
}

const frontMatter = (fields: Record<string, string | number | object>) =>
  `---\n${Object.entries(fields)
    .map(([k, v]) => `${k}: ${typeof v === "number" ? v : JSON.stringify(v)}`)
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
      ...(read.stats ? { stats: read.stats } : {}),
    })}# ${read.title}\n\n${read.body}`,
  };
}

/**
 * A YouTube video: its captions and chapters (yt-dlp), and with an `eye` its frames too, picked
 * where the picture changes and read by the eye (`seeYoutube`), the path weaver's `youtube-see`
 * takes. The ear hears the audio when captions fail. A kept read skips all of it.
 */
export const youtubeSource = async (
  url: string,
  ytDlp: string,
  priority = DEFAULT_PRIORITY,
  opts: {
    eye?: Model | undefined;
    fetchFn?: typeof fetch;
    ear?: Ear | undefined;
    ffmpeg?: string | undefined;
    store?: MediaStore | undefined;
  } = {},
): Promise<Source> => {
  const { eye, ear, ffmpeg, store, fetchFn } = opts;
  const key = mediaKey(url);
  const common = {
    ytDlp,
    ...(ear ? { ear } : {}),
    ...(ffmpeg ? { ffmpeg } : {}),
    ...(fetchFn ? { fetchFn } : {}),
  };
  // with frames: its own read, apart from a captions-only one
  const read = eye
    ? await keptRead(store, key && `${key}.see`, () =>
        seeYoutube(url, { ...common, eye, words: true, ...(store ? { store } : {}) }),
      )
    : await keptRead(store, key, () => readYoutube(url, common));
  return toSource(await withFreshStats(read, url, ytDlp), priority);
};

/** A kept read's numbers are old: read them again, else keep the read's own. */
async function withFreshStats(read: VideoRead, url: string, ytDlp: string): Promise<VideoRead> {
  const stats = await readStats(url, ytDlp).catch(() => undefined);
  const best = stats ?? read.stats;
  return best ? { ...read, stats: best } : read;
}

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
    await withFreshStats(
      await keptRead(opts.store, mediaKey(url), () => readVideo(url, { ...opts, ytDlp })),
      url,
      ytDlp,
    ),
    priority,
  );

/** A person's own note on a source: whole, never cut. */
export interface Note {
  text: string;
  by: string;
  /** YYYY-MM-DD */
  at: string;
}

/** Hosts whose links are videos or posts yt-dlp reads; any other link is a page. */
export const VIDEO_HOST =
  /^https?:\/\/([a-z]+\.)?(instagram\.com|tiktok\.com|x\.com|twitter\.com|vimeo\.com|facebook\.com|fb\.watch)\//i;

/**
 * A web page as a source: its title, picture and text. A GitHub repo: its README, raw. Named by
 * `sourceId`, so one URL is one record whoever adds it.
 */
export async function pageSource(
  url: string,
  fetcher: Fetcher,
  priority = DEFAULT_PRIORITY,
): Promise<Source> {
  const id = sourceId(url);
  // arxiv (abs, pdf or html link): the abstract page names the paper; the PDF holds the words
  const arxiv =
    /^https?:\/\/(?:www\.)?arxiv\.org\/(?:abs|pdf|html)\/([^?#]+?)(?:\.pdf)?\/?(?:[?#].*)?$/i.exec(
      url,
    )?.[1];
  const page = await fetcher.get(arxiv ? `https://arxiv.org/abs/${arxiv}` : url);
  if (page.status >= 400) throw new Error(`${url}: HTTP ${page.status}`);
  const pdfUrl = arxiv
    ? `https://arxiv.org/pdf/${arxiv}`
    : page.text.startsWith("%PDF")
      ? page.url
      : null;
  const read = page.text.startsWith("%PDF")
    ? { title: "", text: "", image: undefined }
    : readPage(page.text, page.url);
  let text = read.text;
  if (pdfUrl) {
    // the fetcher answers text: a PDF's bytes are read again as bytes
    const r = await fetch(pdfUrl, { headers: { "user-agent": fetcher.userAgent } });
    if (!r.ok) throw new Error(`${pdfUrl}: HTTP ${r.status}`);
    const words = await pdfText(new Uint8Array(await r.arrayBuffer()));
    if (!words && !arxiv) throw new Error(`${pdfUrl}: a PDF with no readable text`);
    if (words) text = arxiv ? `${text.trim()}\n\n## Paper\n\n${words}` : words;
  }
  text = withoutNul(text);
  const repo = new URL(page.url).pathname.match(/^\/([^/]+)\/([^/]+)/);
  if (id.startsWith("github-") && repo) {
    for (const f of ["README.md", "readme.md", "README"]) {
      const r = await fetcher
        .get(`https://raw.githubusercontent.com/${repo[1]}/${repo[2]}/HEAD/${f}`)
        .catch(() => null);
      if (r && r.status < 400 && r.text.trim()) {
        text = r.text;
        break;
      }
    }
  }
  const title = read.title || id;
  const meta = "meta" in read ? read.meta : undefined;
  // the page's own author fields; a repo's owner is its author
  const channel =
    meta?.authors?.join("; ") || (id.startsWith("github-") && repo?.[1] ? repo[1] : undefined);
  return {
    name: `${id}.md`,
    md: `${frontMatter({
      url: page.url,
      title,
      ...(channel ? { channel } : {}),
      // a site is a publisher, never an author
      ...(meta?.site ? { site: meta.site } : {}),
      ...(meta?.published ? { uploaded: meta.published } : {}),
      ...(read.image ? { image: read.image } : {}),
      priority,
    })}# ${title}\n\n${text.trim()}\n`,
  };
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

interface SopInput {
  name: string;
  /** One instruction for this build only (`topic build --ask`). */
  ask?: string;
  notes: string;
  /** `calls.md`: the owner's calls on pieces, rolled up; empty when none. */
  calls: string;
  /** `standard.md`: the numbers the pieces measure; empty when none. */
  standard: string;
  current: string;
  /** Other topics' rule sets this SOP uses, as text; read only. */
  shared?: string;
  /** The house rules every SOP follows: the `sop-making` rule sets, cites stripped. */
  house?: string;
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
    `Rule sets. The doc has two layers. The procedure is the steps in the order they happen; it holds no rules and points at a rule by its id ("check OF-3"). A rule that applies throughout, a check, a pattern list or a catalog goes in a rule set: a block that opens with <!-- set <set-id> <PREFIX> "<Title>" --> on its own line and closes with <!-- /set -->. One rule per top-level list item. Keep every block of the current doc, with its marker as given. A kept rule keeps its id (- **OF-3** ...) and its words unless the notes or a higher source change it; never renumber, never reuse an id. A new rule is a plain list item with no id; code numbers it. Make a new block only when the rules have a second subject another SOP could use alone: <!-- set ${input.name}-<subject> "<Title>" -->. With no block yet, put the rules in <!-- set ${input.name}-rules "Rules" -->. A set holds what a source supports: every block cites at least one source. A rule only the notes give stays out: the notes load beside the SOP.`,
    "House rules. The <house> block is how every SOP in this repo is shaped: which line goes in which layer, how a rule line is written, how sets are shared. Follow it. It never overrides the notes, the calls or a source on what the SOP says, only on its shape.",
    "Shared sets. The <shared> block holds rule sets another SOP owns and this one uses. Never restate or edit them; point at their ids.",
    "Citations. After a step or rule, cite where it came from in brackets: the source file stem and, for a video, the nearest [m:ss] marker before the words, e.g. [youtube-abc123 1:02:30] or [drive-9f8e]. A step or rule that comes from the notes cites [notes].",
    input.current.trim()
      ? "There is a current SOP below. Keep what still holds, word for word where you can. Change only what the notes or a higher-priority source contradicts, and add only what they add. Do not reword for its own sake."
      : "There is no SOP yet. Start with a one-line purpose, then numbered steps in the order they happen, then the rule set. Use the sections the material asks for, no more.",
    ...(input.ask ? [`This build. The owner asks, for this build only: ${input.ask}`] : []),
    "Reply with only the SOP markdown, starting with a level-one heading.",
    `<notes>\n${input.notes.trim() || "(none yet)"}\n</notes>`,
    `<calls>\n${input.calls.trim() || "(none yet)"}\n</calls>`,
    `<standard>\n${input.standard.trim() || "(none yet)"}\n</standard>`,
    `<current>\n${input.current.trim() || "(none yet)"}\n</current>`,
    `<house>\n${input.house?.trim() || "(none)"}\n</house>`,
    `<shared>\n${input.shared?.trim() || "(none)"}\n</shared>`,
    sources,
  ].join("\n\n");
}

interface SopDir {
  root: string;
  /** `topics/<name>/`: notes, calls, standard, counts, refs, SKILL.md. */
  dir: string;
  /** `notes.md` without its front matter (the scope lines are for `wren topic sync`, not the model). */
  notes: string;
  calls: string;
  standard: string;
  /** The build doc: the guide with its own sets in place, cites in the long form; empty before the first build. */
  current: string;
  /** The guide's source cites: `[n]` in its body is the nth. Its set cites follow them in the record. */
  cites: string[];
  /** The SOP's own rule sets as stored (bodies in the long form, no title line). */
  sets: StoredSet[];
  /** Rule sets of other topics the guide cites. */
  sharedIds: string[];
  shared: string;
  sources: SopInput["sources"];
}

export interface StoredSet extends SetBlock {
  cites: string[];
  last: number;
}

/** A rule record's body without its `# Title` line; the title. */
function setBody(body: string): { title: string; body: string } {
  const m = body.match(/^# (.+)\n+/);
  return m
    ? { title: (m[1] as string).trim(), body: body.slice(m[0].length) }
    : { title: "", body };
}

const FRONT_MATTER = /^---\n[\s\S]*?\n---\n?/;

const HOUSE = ["sop-making-layers", "sop-making-lines", "sop-making-sharing"];

/** The sets of the `sop-making` topic, cites stripped: they number that topic's sources, not this one's. */
function houseRules(root: string): string {
  return HOUSE.map((id) =>
    readRecord(root, id)
      ?.body.replace(/ \[\d+(?: [^\]]*)?\]/g, "")
      .trim(),
  )
    .filter(Boolean)
    .join("\n\n");
}

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
 * One SOP, read from Canon: the topic folder's files, its guide, and the live sources
 * tagged with its name (each as its points when it has some). Highest priority first, then by name.
 */
export async function readSopDir(root: string, name: string): Promise<SopDir> {
  const dir = topicDir(root, name);
  const read = (f: string) => readFile(join(dir, f), "utf8").catch(() => "");
  const docs = loadWorking(root).docs.map((l) => l.doc);
  // a source the guide or a set of it cites is read too, tagged or not
  const cited = new Set(
    docs
      .filter((d) => live(d) && (d.fm.id === name || (d.fm.type === "rule" && d.fm.topic === name)))
      .flatMap((d) => d.fm.cites),
  );
  const sources = docs
    .filter((d) => d.fm.type === "source" && live(d) && (tagged(d, name) || cited.has(d.fm.id)))
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
  const rules = docs.filter((d) => d.fm.type === "rule" && live(d));
  const sets = rules
    .filter((d) => d.fm.topic === name)
    .sort((a, b) => Number(a.fm.order ?? 0) - Number(b.fm.order ?? 0))
    .map((d): StoredSet => {
      const { title, body } = setBody(expandCites(d.body, d.fm.cites));
      return {
        id: d.fm.id,
        prefix: String(d.fm.prefix ?? [...prefixesIn([d.body])][0] ?? ""),
        title: title || d.fm.title,
        body,
        cites: d.fm.cites,
        last: Number(d.fm.last ?? 0),
      };
    });
  const isRule = new Set(rules.map((d) => d.fm.id));
  const gone = (guide?.fm.cites ?? []).filter((c) =>
    docs.some((d) => d.fm.id === c && d.fm.type === "rule" && !live(d)),
  );
  if (gone.length)
    throw new Error(
      `${name}: cites retired rule set ${gone.join(", ")}; drop the cite or cite its successor`,
    );
  const sharedIds = (guide?.fm.cites ?? []).filter(
    (c) => isRule.has(c) && !sets.some((s) => s.id === c),
  );
  const shared = sharedIds
    .map((id) => {
      const d = rules.find((r) => r.fm.id === id) as Loaded;
      return `<set id="${id}">\n${expandCites(d.body, d.fm.cites).trim()}\n</set>`;
    })
    .join("\n\n");
  const cites = (guide?.fm.cites ?? []).filter((c) => !isRule.has(c));
  return {
    root,
    dir,
    notes: (await read("notes.md")).replace(FRONT_MATTER, ""),
    calls: await read("calls.md"),
    standard: await read("standard.md"),
    current: guide ? mergeDoc(expandCites(guide.body, guide.fm.cites), sets) : "",
    cites,
    sets,
    sharedIds,
    shared,
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
and brands): \`wren topic sync\` measures those pieces into standard.md and rolls your calls into calls.md.
`;

/** `toSource`'s front matter: JSON strings, objects and bare numbers, one per line. */
function sourceFields(md: string): { fields: Record<string, unknown>; body: string } {
  const m = md.match(FRONT_MATTER);
  if (!m) return { fields: {}, body: md.trim() };
  const fields: Record<string, unknown> = {};
  for (const line of m[0].split("\n").slice(1, -2)) {
    const kv = line.match(/^([a-z_]+):\s*(.*)$/);
    if (!kv?.[1]) continue;
    const v = kv[2] ?? "";
    fields[kv[1]] = /^["{]/.test(v) ? JSON.parse(v) : /^\d+$/.test(v) ? Number(v) : v;
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
              : stem.startsWith("image-")
                ? "image"
                : stem.startsWith("arxiv-")
                  ? "paper"
                  : /^(drive|file|note)-/.test(stem)
                    ? "doc"
                    : stem.startsWith("linkedin-")
                      ? "post"
                      : stem.startsWith("creator-")
                        ? "person"
                        : "other";

/** Who writes and why: every record carries both. */
export interface By {
  by: string;
  why: string;
}

/**
 * Add a source: a source record (`sources/<stem>.md`, one commit), tagged with the SOP's name and
 * with the topic folder and a notes.md stub when one is named. A source already there gets the
 * new text and the tag. `extra` adds fields: a `provider` counts on add, or raises an agent's to a
 * person's; a `note` goes under any note already there.
 */
export async function addSource(
  root: string,
  name: string | null,
  source: Source,
  who: By,
  extra: Record<string, unknown> = {},
): Promise<string> {
  if (name) {
    const dir = topicDir(root, name);
    await mkdir(dir, { recursive: true });
    const notes = join(dir, "notes.md");
    await readFile(notes).catch(() => writeFile(notes, NOTES_STUB));
  }
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
  // provider: set on add; an edit only raises an agent's to a person's
  const { provider, note, tags: given, ...more } = extra;
  // `tags`: plain tags, never a topic folder
  const tags = [...new Set([...(name ? [name] : []), ...((given as string[] | undefined) ?? [])])];
  const was = prev?.doc.fm as { provider?: { kind?: string }; note?: Note } | undefined;
  const raise =
    prev && provider && (provider as { kind?: string }).kind === "human"
      ? was?.provider?.kind !== "human"
      : false;
  // a person's note is never replaced: a new one goes under the old
  const said = note as Note | undefined;
  const old = was?.note;
  if (said?.text.trim())
    more.note =
      old && !old.text.includes(said.text.trim())
        ? { ...said, text: `${old.text}\n\n${said.text.trim()}` }
        : (old ?? { ...said, text: said.text.trim() });
  await write(
    root,
    [
      prev
        ? {
            op: "edit",
            id,
            ...record,
            ...more,
            ...(raise ? { provider } : {}),
            tags: [...new Set([...prev.doc.fm.tags, ...tags])].sort(),
          }
        : {
            op: "add",
            type: "source",
            id,
            tags,
            ...record,
            ...more,
            ...(provider ? { provider } : {}),
          },
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

/**
 * The topic folder as a Claude Code skill. SKILL.md renders the guide, the owner's notes and every
 * rule set the guide cites at load time (`!\`cmd\``), so the model never has to go read them. A
 * guide's `load` field narrows the sets to a subset by line id: `--only HK-9..HK-16` or
 * `--except MO-5..MO-9` (`knowledge render` flags; a range goes to the set that holds its prefix).
 */
/** Door print budget: past ~30 KB tool output lands behind a 2 KB preview (sop-making SK-10). */
const DOOR_INLINE = 24 * 1024;

type DoorSet = { id: string; prefix: string; bytes: number };

/** Where a set first matters: the heading (and top-level step) of the first guide line naming one of its ids. */
export function firstStep(guide: string, prefix: string): string {
  if (!prefix) return "";
  const id = new RegExp(`\\b${prefix}-\\d+`);
  let heading = "";
  let step = "";
  for (const line of guide.split("\n")) {
    const h = /^#{2,3} (.+)$/.exec(line);
    if (h) {
      heading = (h[1] as string).trim();
      step = "";
      continue;
    }
    const n = /^(\d+)\. /.exec(line);
    if (n) step = n[1] as string;
    if (id.test(line)) return heading ? `"${heading}"${step ? `, step ${step}` : ""}` : "";
  }
  return "";
}

function skillMd(
  root: string,
  name: string,
  description: string,
  sets: { own: DoorSet[]; shared: DoorSet[]; load: string; guide: string; bytes: number },
): string {
  const dir = topicDir(root, name);
  const q = JSON.stringify(dir);
  const knowledge = `knowledge --repo ${JSON.stringify(root)}`;
  const all = [...sets.own, ...sets.shared];
  const ids = all.map((s) => s.id);
  const owner = sets.shared.length
    ? ` (another SOP owns ${sets.shared.map((s) => s.id).join(", ")})`
    : "";
  // --only/--except names one prefix: pass it only to the set that holds it (render errors otherwise)
  const loadFor = (s: DoorSet) =>
    sets.load && s.prefix && sets.load.includes(`${s.prefix}-`) ? ` ${sets.load}` : "";
  const atStep = all
    .map((s) => {
      const at = firstStep(sets.guide, s.prefix);
      return `- \`${s.id}\`${loadFor(s) ? ` (add \`${loadFor(s).trim()}\`)` : ""}: ${at ? `before ${at}` : "before you start"}.`;
    })
    .join("\n");
  const rules = !ids.length
    ? ""
    : sets.bytes <= DOOR_INLINE
      ? `\n# Rule sets${owner}\n\n!\`${knowledge} render ${ids.join(" ")}${sets.load ? ` ${sets.load}` : ""}\`\n`
      : `\n# Rule sets${owner}\n\nEach set loads at its step. Write it into a file and read the whole file: \`${knowledge} render <set> > <scratch>/<set>.md\`. Its lines apply from that step on.\n\n${atStep}\n`;
  return `---
name: sop-${name}
description: ${JSON.stringify(`SOP: ${description}`)}
---

Follow this SOP start to finish. Its examples and prompts are the bar. Every loaded rule line applies; the procedure names a rule by its id.

!\`knowledge --repo ${JSON.stringify(root)} render ${name} | grep -v '^<!-- set '\`

# The owner's notes (they beat every source)

!\`awk 'NR==1 && /^---$/ {f=1; next} f && /^---$/ {f=0; next} !f' ${q}/notes.md 2>/dev/null || echo "(none)"\`
${rules}
Reference files (designs, PDFs, images) in \`${dir}/refs/\`; open the relevant ones before writing:

!\`ls ${q}/refs 2>/dev/null || echo "(none)"\`
`;
}

/** The first line of a guide that is not a heading or a set marker: what the SOP is for. */
const purposeOf = (body: string, name: string) =>
  body
    .split("\n")
    .find((l) => l.trim() && !l.startsWith("#") && !l.startsWith("<!--"))
    ?.trim() ?? name;

/** Write `topics/<name>/SKILL.md` from the guide and the sets it cites. */
export async function writeSkill(root: string, name: string): Promise<string> {
  const guide = readRecord(root, name);
  if (guide?.fm.type !== "guide") throw new Error(`${name}: no guide (topic build first)`);
  const read = await readSopDir(root, name);
  const file = join(topicDir(root, name), "SKILL.md");
  await mkdir(topicDir(root, name), { recursive: true });
  const load = String((guide.fm as { load?: string }).load ?? "");
  const own = read.sets.map((s) => ({ id: s.id, prefix: s.prefix, bytes: s.body.length }));
  const shared = read.sharedIds.map((id) => {
    const body = readRecord(root, id)?.body ?? "";
    return { id, prefix: [...prefixesIn([body])][0] ?? "", bytes: body.length };
  });
  const bytes = [...own, ...shared].reduce(
    (n, s) => n + s.bytes,
    guide.body.length + read.notes.length,
  );
  await writeFile(
    file,
    skillMd(root, name, guide.fm.description ?? purposeOf(guide.body, name), {
      own,
      shared,
      load,
      guide: guide.body,
      bytes,
    }),
  );
  return file;
}

/** The build doc as a reader sees it: each set under its title, no markers. */
const readable = (doc: string) =>
  doc
    .replace(/^<!-- set [a-z0-9-]+(?: [A-Z]{2,3})? "([^"]*)" -->$/gm, "## $1")
    .replace(/^<!-- (?:\/set|set [a-z0-9-]+) -->\n?/gm, "");

/**
 * The SOP as one markdown doc (what a playbook reads): the procedure with its own rule sets in
 * place, the shared sets it uses, the owner's notes, then one Sources list for all of it.
 */
export async function sopText(root: string, name: string): Promise<string> {
  const read = await readSopDir(root, name);
  if (!read.current) throw new Error(`${name}: no guide (topic build first)`);
  const shared = read.shared
    ? `\n## Shared rule sets\n\n${read.shared.replace(/^<\/?set[^>]*>\n?/gm, "").replace(/^# /gm, "### ")}\n`
    : "";
  const notes = read.notes.trim()
    ? `\n## The owner's notes (they beat every source)\n\n${read.notes.trim().replace(/^# .*\n+/, "")}\n`
    : "";
  const { body, cites } = numberCites(
    `${readable(read.current).trimEnd()}\n${shared}${notes}`,
    [],
    sourceIds(root),
  );
  if (!cites.length) return body;
  const lines = cites.map((c, i) => citeLine(i + 1, c, readRecord(root, c)?.fm));
  return `${body}\n## Sources\n\n${lines.join("\n")}\n`;
}

/** Renumber a guide's source cites (`wren topic cite`); its set cites stay. False when nothing changed. */
export async function renumberGuide(root: string, name: string, who: By): Promise<boolean> {
  const guide = readRecord(root, name);
  if (guide?.fm.type !== "guide") return false;
  const known = sourceIds(root);
  const setCites = guide.fm.cites.filter(
    (c) => !known.has(c) && readRecord(root, c)?.fm.type === "rule",
  );
  const prior = guide.fm.cites.filter((c) => !setCites.includes(c));
  const next = numberCites(expandCites(guide.body, guide.fm.cites), prior, known);
  const cites = [...next.cites, ...setCites];
  if (next.body.trimEnd() === guide.body.trimEnd() && cites.join() === guide.fm.cites.join())
    return false;
  await write(root, [{ op: "edit", id: name, body: next.body, cites }], who);
  return true;
}

const sourceIds = (root: string) =>
  new Set(
    loadWorking(root)
      .docs.filter((l) => l.doc.fm.type === "source")
      .map((l) => l.doc.fm.id),
  );

/** `OF-3` → its line, for telling which kept rules changed words. */
const linesById = (body: string) =>
  new Map(
    [...body.matchAll(/^- \*\*([A-Z]{2,3}-\d+)\*\* (.*)$/gm)].map((m) => [
      m[1] as string,
      m[2] as string,
    ]),
  );

/**
 * The record changes one build doc makes: the guide (procedure; cites = its sources, then its own
 * sets, then the shared sets it used before) and one rule record per set block. `report` lists the
 * rule lines added, reworded and dropped. Throws when a stored set is missing from the doc or a set
 * cites no source.
 */
function docChanges(
  root: string,
  name: string,
  doc: string,
  read: Pick<SopDir, "current" | "cites" | "sets" | "sharedIds">,
): { changes: Change[]; report: string } {
  const { guide, sets } = splitDoc(doc);
  for (const s of read.sets)
    if (!sets.some((x) => x.id === s.id))
      throw new Error(
        `${name}: the build dropped set ${s.id}; a set is retired by hand, never by a build`,
      );
  const known = sourceIds(root);
  const all = loadWorking(root).docs.map((l) => l.doc);
  const used = prefixesIn(all.filter((d) => d.fm.type === "rule").map((d) => d.body));
  const taken = new Set(all.map((d) => d.fm.id));
  const g = numberCites(guide, read.cites, known);
  const title = g.body.match(/^# (.+)$/m)?.[1] ?? name;
  const changes: Change[] = [];
  const notes: string[] = [];
  const dropped = new Map<string, string>();
  sets.forEach((s, i) => {
    const prev = read.sets.find((x) => x.id === s.id);
    if (!prev && taken.has(s.id)) throw new Error(`${name}: set id ${s.id} is another record's`);
    if (!prev && !s.id.startsWith(`${name}-`))
      throw new Error(`${name}: a new set is named ${name}-<subject>, not ${s.id}`);
    const prefix =
      prev?.prefix || (s.prefix && !used.has(s.prefix) ? s.prefix : freePrefix(s.id, used));
    used.add(prefix);
    const a = assignIds(s.body, prefix, prev?.last ?? 0, prev?.body ?? "");
    const before = linesById(prev?.body ?? "");
    const reworded = [...linesById(a.body)]
      .filter(([id, line]) => before.has(id) && before.get(id) !== line)
      .map(([id]) => id);
    for (const [word, ids] of [
      ["added", a.added],
      ["reworded", reworded],
      ["dropped", a.dropped],
    ] as const)
      if (ids.length) notes.push(`${word} ${ids.join(" ")}`);
    const heading = s.title || prev?.title || "Rules";
    const n = numberCites(`# ${heading}\n\n${a.body.trim()}\n`, prev?.cites ?? [], known);
    // an owner call ([learn:12]) is evidence too
    if (!n.cites.length && !/\[learn:\d+/.test(n.body))
      throw new Error(
        `${name}: set ${s.id} cites no source or call. A rule set holds what a source or a call supports; a rule only the notes give stays in notes.md`,
      );
    const fields = { title: `${title}: ${heading}`, body: n.body, cites: n.cites, last: a.last };
    const stored = prev ? readRecord(root, s.id) : null;
    // an unchanged set gets no edit: a new version would mark every guide that cites it stale
    if (
      stored &&
      stored.body.trimEnd() === n.body.trimEnd() &&
      stored.fm.cites.join() === n.cites.join() &&
      stored.fm.title === fields.title &&
      Number(stored.fm.last ?? 0) === a.last
    )
      return;
    for (const id of a.dropped) dropped.set(id, s.id);
    changes.push(
      prev
        ? { op: "edit", id: s.id, ...fields }
        : { op: "add", type: "rule", id: s.id, topic: name, order: i + 1, prefix, ...fields },
    );
  });
  // a dead line id in this guide: the write's lint refuses it (knowledge 0.68.5); other guides it does not touch
  const named = (body: string) => [
    ...new Set(
      [...body.matchAll(/\b([A-Z]{2,3})-\d+\b/g)]
        .filter((m) => used.has(m[1] as string))
        .map((m) => m[0]),
    ),
  ];
  for (const d of all.filter(
    (x) => x.fm.type === "guide" && x.fm.status === "live" && x.fm.id !== name,
  )) {
    const hit = named(d.body).filter(
      (id) => dropped.has(id) && d.fm.cites.includes(dropped.get(id) as string),
    );
    if (hit.length)
      throw new Error(
        `${name}: the build dropped ${hit.join(", ")}, which guide ${d.fm.id} names; edit that guide first`,
      );
  }
  const guideFields = {
    title,
    description: purposeOf(g.body, name),
    cites: [...g.cites, ...sets.map((s) => s.id), ...read.sharedIds],
    body: g.body,
  };
  const was = readRecord(root, name);
  if (!was) changes.push({ op: "add", type: "guide", id: name, topic: name, ...guideFields });
  else if (
    was.body.trimEnd() !== g.body.trimEnd() ||
    was.fm.cites.join() !== guideFields.cites.join() ||
    was.fm.title !== title
  )
    changes.push({ op: "edit", id: name, ...guideFields });
  return { changes, report: notes.join("; ") };
}

/**
 * Build the next SOP (the guide and its own rule sets, one commit) from the topic folder and the
 * sources; then SKILL.md and counts.tsv. Returns the SOP as one doc. The model answers in markdown, no
 * schema: one doc with its rule sets as marked blocks, which `docChanges` splits.
 */
export async function buildSop(
  root: string,
  name: string,
  llm: LlmClient,
  who: Pick<By, "by">,
  ask?: string,
): Promise<string> {
  const read = await readSopDir(root, name);
  if (!read.sources.length && !read.notes.trim())
    throw new Error(`${name}: nothing to build from (no sources, empty notes.md)`);
  // a set written by hand carries no `last`: a build would renumber and rewrite it
  const byHand = read.sets.filter((s) => !s.last && /^- \*\*[A-Z]{2,3}-\d+\*\*/m.test(s.body));
  if (byHand.length)
    throw new Error(
      `${name}: ${byHand.map((s) => s.id).join(", ")} written by hand; edit this topic with knowledge apply, not topic build`,
    );
  const { text } = await llm.complete(
    sopPrompt({ name, ...read, house: houseRules(root), ...(ask ? { ask } : {}) }),
    {
      maxTokens: 32_000,
    },
  );
  const doc = `${text.trim().replace(/^```(?:markdown)?\n([\s\S]*?)\n```$/, "$1")}\n`;
  // a record edited while the model wrote would be overwritten whole
  if ((await readSopDir(root, name)).current !== read.current)
    throw new Error(`${name}: the guide or a rule set changed during the build; build again`);
  const { changes, report } = docChanges(root, name, doc, read);
  if (changes.length)
    await write(root, changes, {
      by: who.by,
      why: `built from notes, calls, the standard and ${read.sources.length} sources${ask ? `; asked: ${ask}` : ""}${report ? `; rules: ${report}` : ""}`,
    });
  await writeSkill(root, name);
  const sop = await sopText(root, name);
  // ponytail: tokens ≈ chars/4; swap in a real tokenizer if the estimate starts to matter.
  const row = (n: string, md: string) =>
    `${n}\t${md.split(/\s+/).filter(Boolean).length} words\t~${Math.round(md.length / 4)} tokens`;
  await writeFile(
    join(read.dir, "counts.tsv"),
    `${[row("SOP", sop), row("notes.md", read.notes), ...read.sources.map((s) => row(`sources/${s.name}.md`, s.md))].join("\n")}\n`,
  );
  return sop;
}

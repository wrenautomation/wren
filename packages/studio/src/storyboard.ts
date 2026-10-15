/**
 * The storyboard of an edit (designs/2026-10-15-storyboard.md): the video as frames, one per beat,
 * read from what the edit already holds. A beat is a chapter, or a run of whole sentences when
 * there are no chapters, and each Short is one more. Pure: the same edit gives the same board, so
 * the page, `wren video storyboard` and the change prompt all read this one.
 */
import { keepSegments, onCut, type Span, toCutTime } from "./cuts.js";
import { FPS } from "./finish.js";
import { CARD } from "./props.js";
import type { Cut, Format, LAYOUTS, VideoEdit, Word } from "./schema.js";
import { sentenceEdges } from "./sentences.js";

export type Show = (typeof LAYOUTS)[number];

export const BEAT = {
  /** No chapters: sentences join into a beat until it holds this many raw seconds. */
  partS: 30,
} as const;

export interface Beat {
  /** Stable while the beats keep their places: `chapter-2`, `part-3`, `short-1`. */
  key: string;
  kind: "chapter" | "part" | "short";
  /** 1-based within its kind. */
  n: number;
  /** A chapter's or a Short's title. */
  title: string | null;
  /** Raw seconds on the recording, as the edit keeps every time. */
  from: number;
  to: number;
  /** The poster frame: the first moment of it that plays (its start when all of it is cut). */
  at: number;
  /** Where it sits once cut; null when none of it plays. */
  onCut: { from: number; to: number } | null;
  playsS: number;
  cutS: number;
  cut: "none" | "some" | "all";
  /** The words that play in it. */
  said: string;
  /** Words in it that a cut takes out. */
  struck: string;
  /** Text on the video while it plays; a Short's title card first. */
  onScreen: string[];
  /**
   * What the long video's picture shows, in order: his camera in the corner, his face only, the
   * screen only. Empty for a Short: it is the 9:16 crop, whatever the long video shows.
   */
  layout: Show[];
}

export interface Storyboard {
  title: string;
  rawS: number;
  /** Length once cut. */
  cutS: number;
  formats: Format[];
  chapters: number;
  /** The caption style and where each format shows them: `word, long track, short screen`. */
  captions: string;
  beats: Beat[];
  shorts: Beat[];
}

type Edit = Pick<
  VideoEdit,
  | "title"
  | "words"
  | "cuts"
  | "layout"
  | "overlays"
  | "shorts"
  | "chapters"
  | "formats"
  | "captions"
  | "tracks"
>;

const r2 = (x: number) => Math.round(x * 100) / 100;
const mid = (w: Word) => (w.s + w.e) / 2;

/** The raw spans of the main beats: chapters, else sentence runs of about `BEAT.partS`. */
export function beatSpans(
  e: Pick<Edit, "words" | "chapters">,
  durationS: number,
): { kind: "chapter" | "part"; title: string | null; from: number; to: number }[] {
  const chapters = [...e.chapters].filter((c) => c.at < durationS).sort((a, b) => a.at - b.at);
  if (chapters.length) {
    const starts = chapters[0]?.at ? [{ at: 0, title: null }, ...chapters] : chapters;
    return starts.map((c, i) => ({
      kind: "chapter" as const,
      title: c.title,
      from: c.at,
      to: starts[i + 1]?.at ?? durationS,
    }));
  }
  const cutsAt: number[] = [];
  if (e.words.length) {
    const { starts } = sentenceEdges(e.words);
    let from = 0;
    for (const i of [...starts].sort((a, b) => a - b)) {
      const w = e.words[i] as Word;
      // Between sentences: halfway through the gap before this one's first word.
      const at = i > 0 ? ((e.words[i - 1] as Word).e + w.s) / 2 : w.s;
      if (at - from >= BEAT.partS && durationS - at >= BEAT.partS / 3) {
        cutsAt.push(at);
        from = at;
      }
    }
  } else
    for (let at = BEAT.partS; at < durationS - BEAT.partS / 3; at += BEAT.partS) cutsAt.push(at);
  const edges = [0, ...cutsAt, durationS];
  return edges.slice(0, -1).map((from, i) => ({
    kind: "part" as const,
    title: null,
    from: r2(from),
    to: r2(edges[i + 1] as number),
  }));
}

/** What the long video shows over a span, in order (a range unset is the corner). */
function shows(layout: Edit["layout"], keep: readonly Span[], from: number, to: number): Show[] {
  const out: Show[] = [];
  const add = (s: Show) => {
    if (out.at(-1) !== s) out.push(s);
  };
  const ranges = [...layout].sort((a, b) => a.from - b.from);
  // Walk the span's played parts, each split at the layout ranges' edges.
  for (const k of keep) {
    const s = Math.max(k.s, from);
    const e = Math.min(k.e, to);
    if (e <= s) continue;
    const edges = [
      s,
      ...ranges.flatMap((r) => [r.from, r.to]).filter((x) => x > s && x < e),
      e,
    ].sort((a, b) => a - b);
    for (let i = 0; i < edges.length - 1; i++) {
      const m = ((edges[i] as number) + (edges[i + 1] as number)) / 2;
      add(ranges.find((r) => m >= r.from && m < r.to)?.show ?? "corner");
    }
  }
  return out.length ? out : [ranges.find((r) => from >= r.from && from < r.to)?.show ?? "corner"];
}

function beatOf(
  e: Edit,
  keep: readonly Span[],
  span: { kind: Beat["kind"]; title: string | null; from: number; to: number },
  n: number,
  card: string | null,
): Beat {
  let playsS = 0;
  let at: number | null = null;
  for (const k of keep) {
    const s = Math.max(k.s, span.from);
    const t = Math.min(k.e, span.to);
    if (t <= s) continue;
    playsS += t - s;
    at ??= s;
  }
  const inSpan = e.words.filter((w) => mid(w) >= span.from && mid(w) < span.to);
  const plays = (w: Word) => toCutTime(mid(w), keep) !== null;
  const spanS = span.to - span.from;
  const cutS = Math.max(0, spanS - playsS);
  const overlays = e.overlays
    .filter((o) => o.from < span.to && o.to > span.from)
    .sort((a, b) => a.from - b.from)
    .map((o) => o.text);
  return {
    key: `${span.kind}-${n}`,
    kind: span.kind,
    n,
    title: span.title,
    from: r2(span.from),
    to: r2(span.to),
    at: r2(at ?? span.from),
    onCut: playsS > 0 ? { from: r2(onCut(span.from, keep)), to: r2(onCut(span.to, keep)) } : null,
    playsS: r2(playsS),
    cutS: r2(cutS),
    // Under a frame of cut is the frame grid's rounding, not a cut.
    cut: playsS < 1 / FPS ? "all" : cutS < 1 / FPS ? "none" : "some",
    said: inSpan
      .filter(plays)
      .map((w) => w.w)
      .join(" "),
    struck: inSpan
      .filter((w) => !plays(w))
      .map((w) => w.w)
      .join(" "),
    onScreen: card ? [card, ...overlays] : overlays,
    layout: span.kind === "short" ? [] : shows(e.layout, keep, span.from, span.to),
  };
}

const captionLine = (c: Edit["captions"]) => {
  const short = c.short ?? (c.on === false ? "track" : "screen");
  return `${c.style}, long ${c.long ?? "track"}, short ${short}${c.behind ? ", behind" : ""}`;
};

/** The edit as frames: the main beats, then each Short. */
export function storyboardOf(e: Edit): Storyboard {
  const durationS = e.tracks.main.durationS;
  const keep = keepSegments(e.cuts as Cut[], durationS, FPS);
  const counts = { chapter: 0, part: 0 };
  return {
    title: e.title,
    rawS: r2(durationS),
    cutS: r2(keep.reduce((n, k) => n + k.e - k.s, 0)),
    formats: [...e.formats],
    chapters: e.chapters.length,
    captions: captionLine(e.captions),
    beats: beatSpans(e, durationS).map((s) => beatOf(e, keep, s, ++counts[s.kind], null)),
    shorts: e.shorts.map((s, i) =>
      beatOf(
        e,
        keep,
        { kind: "short", title: s.title, from: s.from, to: s.to },
        i + 1,
        s.card === false ? null : (s.cardText || s.title).slice(0, CARD.maxChars) || null,
      ),
    ),
  };
}

export interface BoardChange {
  /** Header fields that moved: title, cutS, formats, chapters, captions, shorts. */
  header: string[];
  /** Frames that are new or read differently after. */
  beats: string[];
  /** Frames that are gone after. */
  gone: string[];
}

const HEADER = ["title", "cutS", "formats", "chapters", "captions"] as const;

/** What a change moves on the board: the header lines and the frames, by key. */
export function boardChange(before: Storyboard, after: Storyboard): BoardChange {
  const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
  const header: string[] = HEADER.filter((k) => !same(before[k], after[k]));
  if (before.shorts.length !== after.shorts.length) header.push("shorts");
  const was = new Map([...before.beats, ...before.shorts].map((b) => [b.key, b]));
  const now = [...after.beats, ...after.shorts];
  // Where it sits once cut moves with every cut before it: not a change of this frame.
  const look = ({ onCut: _o, ...b }: Beat) => b;
  return {
    header,
    beats: now
      .filter((b) => !same(look(b), was.has(b.key) ? look(was.get(b.key) as Beat) : null))
      .map((b) => b.key),
    gone: [...was.keys()].filter((k) => !now.some((b) => b.key === k)),
  };
}

const clock = (s: number) => {
  const m = Math.floor(s / 60);
  const sec = s - m * 60;
  return `${m}:${sec.toFixed(1).padStart(4, "0")}`;
};
const quote = (s: string, max: number) => (s.length > max ? `${s.slice(0, max - 1)}…` : s);

/** One beat as lines of text: the CLI's and the model's view of a frame. */
export function beatText(b: Beat, o: { max?: number } = {}): string[] {
  const max = o.max ?? 2000;
  const name =
    b.kind === "short" ? `Short ${b.n}` : b.kind === "chapter" ? `Chapter ${b.n}` : `Part ${b.n}`;
  const cut = b.cut === "all" ? "all cut" : b.cut === "some" ? `cut ${b.cutS.toFixed(1)}s` : "";
  const lines = [
    [
      `${name} [${b.key}]`,
      `${clock(b.from)}-${clock(b.to)}`,
      b.onCut ? `(plays ${clock(b.onCut.from)}-${clock(b.onCut.to)})` : "",
      b.kind === "short" ? "9:16" : b.layout.join(" > "),
      cut,
      b.title ? `"${b.title}"` : "",
    ]
      .filter(Boolean)
      .join("  "),
    `  said: ${b.said ? `"${quote(b.said, max)}"` : "nothing"}`,
  ];
  if (b.struck) lines.push(`  cut out: "${quote(b.struck, max)}"`);
  if (b.onScreen.length)
    lines.push(`  on screen: ${b.onScreen.map((t) => `"${quote(t, 200)}"`).join(", ")}`);
  return lines;
}

/** The whole board as text: `wren video storyboard <id>` prints it, the change prompt reads it. */
export function storyboardText(sb: Storyboard, o: { max?: number } = {}): string {
  const shorts = sb.shorts.length;
  const head = [
    `"${sb.title || "Untitled"}"`,
    `${clock(sb.rawS)} -> ${clock(sb.cutS)} after cuts`,
    sb.formats.join(", "),
    `${shorts} ${shorts === 1 ? "Short" : "Shorts"}`,
    `captions ${sb.captions}`,
  ].join("  ·  ");
  return [
    head,
    "",
    ...sb.beats.flatMap((b) => [...beatText(b, o), ""]),
    ...(shorts ? ["Shorts", "", ...sb.shorts.flatMap((b) => [...beatText(b, o), ""])] : []),
  ]
    .join("\n")
    .trimEnd();
}

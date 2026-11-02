/**
 * The finishing step (designs/2026-10-15-video-finishing.md): trims and cut edges, text on the
 * video, where captions sit, the cover frame, and each format's crop. Pure and browser-safe: the
 * Studio page draws and edits with these, and the render reads the same edit through props.ts.
 * Every time is seconds on the raw main track, like the rest of the edit.
 */
import { z } from "zod";
import { type Line, lineAt, pageLines, reelLines } from "./captions.js";
import { keepSegments, onCut, type Span, toCutTime } from "./cuts.js";
import { CAPTION_Y, OVERLAY, OVERLAY_SIZES, type TextOverlay } from "./finish-look.js";
import type { Cut, Format, Tracks, Word } from "./schema.js";

/** Every output's frame rate; the cut pass and the compositions run at the same. */
export const FPS = 30;

/** Each format's output frame in pixels. */
export const FRAME: Record<Format, [number, number]> = {
  long: [1920, 1080],
  vertical: [1080, 1920],
  square: [1080, 1080],
  portrait: [1080, 1350],
};
export const ASPECT: Record<Format, string> = {
  long: "16:9",
  vertical: "9:16",
  square: "1:1",
  portrait: "4:5",
};

/** The formats that crop the picture to a window (the long video shows it whole). */
export const CROPPED = ["vertical", "square", "portrait"] as const satisfies readonly Format[];
export type CroppedFormat = (typeof CROPPED)[number];
export const isCropped = (f: Format): f is CroppedFormat =>
  (CROPPED as readonly string[]).includes(f);

/** A crop's middle, as 0..1 of the picture across and down. */
export type Point = { x: number; y: number };
export type Crops = { [F in CroppedFormat]?: Point | undefined } & {
  /** A Short's own crop, by its number (1-based, as text): else the vertical crop. */
  shorts?: Record<string, Point> | undefined;
};

export { onScreen, wordState } from "./caption-styles.js";
export { REEL } from "./captions.js";
export {
  CAPTION_LOOK,
  CAPTION_Y,
  captionWordLook,
  cornerCam,
  longCaption,
  OVERLAY,
  OVERLAY_SIZES,
  type OverlaySize,
  overlayAt,
  pillLook,
  reelCaption,
  reelY,
  type TextOverlay,
} from "./finish-look.js";

const unit = z.number().min(0).max(1);
const sec = z.number().min(0);
const point = z.object({ x: unit, y: unit }).strict();

export const overlaySchema = z
  .object({
    text: z.string().trim().min(1).max(OVERLAY.maxChars),
    from: sec,
    to: sec,
    x: z
      .number()
      .min(OVERLAY.margin)
      .max(1 - OVERLAY.margin),
    y: z
      .number()
      .min(OVERLAY.margin)
      .max(1 - OVERLAY.margin),
    size: z.enum(OVERLAY_SIZES),
  })
  .strict()
  .refine((o) => o.to - o.from >= OVERLAY.minS - 1e-6, {
    message: `on screen at least ${OVERLAY.minS}s`,
  });
export const overlaysSchema = z.array(overlaySchema).max(OVERLAY.max);
export const cropsSchema = z
  .object({
    vertical: point.optional(),
    square: point.optional(),
    portrait: point.optional(),
    shorts: z
      .record(z.string().regex(/^([1-9]|1[0-2])$/, "a Short's number, 1 to 12"), point)
      .optional(),
  })
  .strict();

/**
 * Where Short `n` (1-based) is centred on his picture: its own crop, else the vertical crop, else
 * null (the face as the render finds it). The render and the Finish preview read the same.
 */
export const shortCrop = (crops: Crops | undefined, n: number): Point | null =>
  crops?.shorts?.[String(n)] ?? crops?.vertical ?? null;
/** Where each format's caption line sits: its middle, 0..1 from the top. */
export const captionPlaceSchema = z
  .object({
    long: z.number().min(0.1).max(0.92).optional(),
    short: z.number().min(0.12).max(0.8).optional(),
  })
  .strict();
type CaptionPlace = z.infer<typeof captionPlaceSchema>;
/** A caption line's height in a format: the edit's, else the usual. */
export const captionY = (place: CaptionPlace | undefined, which: "long" | "short") =>
  place?.[which] ?? CAPTION_Y[which];

/** A time on the frame grid. */
export const snapFrame = (t: number, fps = FPS) => Math.round(t * fps) / fps;

/**
 * A dragged time: a word's edge when one is within `magnetS` (a cut never lands mid-word), else
 * the nearest frame. Kept inside [0, durationS].
 */
export function snapTime(
  t: number,
  words: readonly Pick<Word, "s" | "e">[],
  durationS: number,
  magnetS = 4 / FPS,
): number {
  let best = t;
  let gap = magnetS;
  for (const w of words)
    for (const edge of [w.s, w.e]) {
      const d = Math.abs(edge - t);
      if (d < gap) {
        gap = d;
        best = edge;
      }
    }
  return Math.max(0, Math.min(snapFrame(durationS), snapFrame(best)));
}

/**
 * The window of a `w` x `h` picture that a `frame` shows: as big as fits at the frame's shape, its
 * middle at `centre` (0..1, default the middle), kept inside the picture.
 */
export function cropWindow(
  w: number,
  h: number,
  frame: readonly [number, number],
  centre: Point = { x: 0.5, y: 0.5 },
): [number, number, number, number] {
  const a = frame[0] / frame[1];
  const [cw, ch] = w / h > a ? [Math.round(h * a), h] : [w, Math.round(w / a)];
  const x = Math.round(Math.min(w - cw, Math.max(0, centre.x * w - cw / 2)));
  const y = Math.round(Math.min(h - ch, Math.max(0, centre.y * h - ch / 2)));
  return [x, y, cw, ch];
}

/** The middle a crop window really has once kept inside the picture (what a drag lands on). */
export function cropCentre(
  w: number,
  h: number,
  frame: readonly [number, number],
  centre: Point,
): Point {
  const [x, y, cw, ch] = cropWindow(w, h, frame, centre);
  const r = (n: number) => Math.round(n * 1000) / 1000;
  return { x: r((x + cw / 2) / w), y: r((y + ch / 2) / h) };
}

/**
 * Which picture a cropped format crops, and where its window sits unless he moved it: a portrait
 * recording, or one with no camera file, crops the recording (on the cam box when it has one);
 * else the camera file, centred. The render (`framedProps`) crops the same.
 */
export function pictureOf(tracks: Pick<Tracks, "main" | "cam" | "camBox">): {
  source: "main" | "cam";
  centre: Point;
} {
  const { main, cam, camBox } = tracks;
  if (main.height > main.width || !cam || camBox)
    return {
      source: "main",
      centre: { x: camBox ? (camBox[0] + camBox[2] / 2) / main.width : 0.5, y: 0.5 },
    };
  return { source: "cam", centre: { x: 0.5, y: 0.5 } };
}

/** The first and last kept moment: the clip's in and out points. */
export function inOut(cuts: readonly Cut[], durationS: number, fps = FPS) {
  const keep = keepSegments(cuts, durationS, fps);
  return { in: keep[0]?.s ?? 0, out: keep.at(-1)?.e ?? 0 };
}

const EPS = 0.5 / FPS;
const applied = (c: Cut) => c.state === "cut";

/**
 * Move the clip's in or out point. The head trim is the applied cut from 0 (the tail one to the
 * end): it becomes `[0, in]` (`[out, end]`), his, or goes when the point is back at the edge.
 * Other cuts stay, so moving a trim back brings them back as they were.
 */
export function trimCuts(
  cuts: readonly Cut[],
  durationS: number,
  to: { in?: number; out?: number },
): Cut[] {
  const end = snapFrame(durationS);
  let next = [...cuts];
  if (to.in !== undefined) {
    const at = Math.max(0, Math.min(snapFrame(to.in), end - 1 / FPS));
    next = next.filter((c) => !(applied(c) && c.from <= EPS));
    if (at > EPS) next.push({ from: 0, to: at, why: "manual", state: "cut" });
  }
  if (to.out !== undefined) {
    const at = Math.max(1 / FPS, Math.min(snapFrame(to.out), end));
    next = next.filter((c) => !(applied(c) && c.to >= end - EPS));
    if (at < end - EPS) next.push({ from: at, to: durationS, why: "manual", state: "cut" });
  }
  return next.sort((a, b) => a.from - b.from || a.to - b.to);
}

/**
 * Drag one edge of cut `i` to `t` (snapped by the caller): it stays at least a frame long and
 * inside the recording. Dragged by him, it is his and applied.
 */
export function moveCutEdge(
  cuts: readonly Cut[],
  i: number,
  side: "from" | "to",
  t: number,
  durationS: number,
): Cut[] {
  const c = cuts[i];
  if (!c) return [...cuts];
  const f = 1 / FPS;
  const moved =
    side === "from"
      ? { ...c, from: Math.max(0, Math.min(snapFrame(t), c.to - f)) }
      : { ...c, to: Math.min(durationS, Math.max(snapFrame(t), c.from + f)) };
  return cuts.map((x, j) => (j === i ? { ...moved, state: "cut" as const } : x));
}

/** A new cut of his over `[from, to]`, applied. */
export function addCut(cuts: readonly Cut[], from: number, to: number, durationS: number): Cut[] {
  const s = Math.max(0, snapFrame(Math.min(from, to)));
  const e = Math.min(durationS, snapFrame(Math.max(from, to)));
  if (e - s < 1 / FPS) return [...cuts];
  return [...cuts, { from: s, to: e, why: "manual" as const, state: "cut" as const }].sort(
    (a, b) => a.from - b.from || a.to - b.to,
  );
}

/** Where playback goes next from raw `t`: itself when kept, else the next kept part's start (null past the end). */
export function playFrom(t: number, keep: readonly Span[]): number | null {
  for (const k of keep) {
    if (t < k.s) return k.s;
    if (t < k.e) return t;
  }
  return null;
}

/** Each overlay on the cut timeline (output seconds); one wholly inside a cut is dropped. */
export function overlaysOnCut(overlays: readonly TextOverlay[], keep: readonly Span[]) {
  const r = (x: number) => Math.round(x * 1000) / 1000;
  return overlays.flatMap((o) => {
    const from = r(onCut(o.from, keep));
    const to = r(onCut(o.to, keep));
    return to - from >= 1 / FPS ? [{ ...o, from, to }] : [];
  });
}

/** A new overlay at raw `at`: 3 s, in the upper middle, medium. */
export function newOverlay(at: number, durationS: number, text = "Your text"): TextOverlay {
  const from = snapFrame(Math.max(0, Math.min(at, durationS - OVERLAY.minS)));
  return { text, from, to: snapFrame(Math.min(durationS, from + 3)), x: 0.5, y: 0.22, size: "m" };
}

/** A caption line as the vertical and Shorts show it, with its words' indexes and raw times. */
export interface CaptionLine {
  /** Indexes into the edit's words. */
  at: number[];
  text: string;
  /** Raw seconds: the first word's start to the last word's end. */
  s: number;
  e: number;
}

/**
 * The Reels caption lines (`reelLines`), broken where the render breaks them: on the cut timeline,
 * each line's words named by index and timed on the raw clock.
 */
export function captionLines(
  words: readonly Word[],
  cuts: readonly Cut[],
  durationS: number,
): CaptionLine[] {
  const keep = keepSegments(cuts, durationS, FPS);
  const kept: Word[] = [];
  const index = new Map<Word, number>();
  words.forEach((w, i) => {
    const s = toCutTime(w.s, keep);
    if (s === null) return;
    const cw = { w: w.w, s, e: Math.max(s, onCut(w.e, keep)) };
    index.set(cw, i);
    kept.push(cw);
  });
  return reelLines(kept).map((l: Line) => {
    const at = l.words.map((w) => index.get(w) as number);
    return {
      at,
      text: l.words.map((w) => w.w).join(" "),
      s: (words[at[0] as number] as Word).s,
      e: (words[at.at(-1) as number] as Word).e,
    };
  });
}

/** A caption word on the cut timeline, as the render draws it: stressed or not. */
interface ShownWord extends Word {
  stressed: boolean;
}
/** The caption line on screen: its words, when its last word's state ends, the time on the cut. */
export interface ShownLine {
  words: ShownWord[];
  end: number;
  t: number;
}

/**
 * The captions a format burns in, on the cut timeline, broken as the render breaks them: the long
 * video's pages, or the Reels lines. `words` carry `stress` (marked words); `cuts` may be a draft.
 */
export function captionTrack(
  words: readonly (Word & { stress?: boolean })[],
  cuts: readonly Cut[],
  durationS: number,
  which: "long" | "short",
): { keep: Span[]; lines: (Line & { words: ShownWord[] })[]; which: "long" | "short" } {
  const keep = keepSegments(cuts, durationS, FPS);
  const r = (x: number) => Math.round(x * 1000) / 1000;
  const kept = words.flatMap((w): ShownWord[] => {
    const s = toCutTime(w.s, keep);
    if (s === null) return [];
    return [{ w: w.w, s: r(s), e: r(Math.max(s, onCut(w.e, keep))), stressed: !!w.stress }];
  });
  // reelLines groups the words it is given, so its lines hold these same words.
  const lines =
    which === "long" ? pageLines(kept) : (reelLines(kept) as (Line & { words: ShownWord[] })[]);
  return { keep, which, lines };
}

/** The line on screen at raw `t`, as the render shows it then. */
export function captionShown(track: ReturnType<typeof captionTrack>, t: number): ShownLine | null {
  const at = onCut(t, track.keep);
  const hit = lineAt(track.lines, at);
  if (!hit) return null;
  const line = hit.line as Line & { words: ShownWord[] };
  const last = line.words.at(-1) as ShownWord;
  return { words: line.words, end: track.which === "long" ? last.e + 0.3 : line.e, t: at };
}

/**
 * The words with one caption line (`at`, indexes into `words`) rewritten as `text`: same count,
 * word for word on their times; another count, the new words share the line's span by length.
 * Empty `text` is refused, so a line can't vanish from the transcript.
 */
export function rewriteLine(words: readonly Word[], at: readonly number[], text: string): Word[] {
  const put = text.trim().split(/\s+/).filter(Boolean);
  if (!put.length) throw new Error("A caption line needs words.");
  const first = at[0];
  const last = at.at(-1);
  if (
    first === undefined ||
    last === undefined ||
    at.some((i, k) => k && i !== (at[k - 1] as number) + 1)
  )
    throw new Error("That caption line isn't in the transcript.");
  const old = words.slice(first, last + 1);
  if (old.length !== at.length) throw new Error("That caption line isn't in the transcript.");
  const made =
    put.length === old.length
      ? old.map((w, k) => ({ ...w, w: put[k] as string }))
      : spread(put, (old[0] as Word).s, (old.at(-1) as Word).e);
  return [...words.slice(0, first), ...made, ...words.slice(last + 1)];
}

function spread(put: readonly string[], s: number, e: number): Word[] {
  const total = put.reduce((n, w) => n + w.length + 1, 0);
  const r = (x: number) => Math.round(x * 1000) / 1000;
  let at = s;
  return put.map((w) => {
    const len = ((w.length + 1) / total) * (e - s);
    const word = { w, s: r(at), e: r(at + len) };
    at += len;
    return word;
  });
}

/**
 * Which render a platform gets for the whole cut, from those rendered: Reels and TikTok take 9:16;
 * Facebook and LinkedIn feeds 4:5, then 1:1; X 1:1. Null when none fits.
 */
const PLATFORM_FORMATS: Record<string, readonly CroppedFormat[]> = {
  instagram: ["vertical"],
  tiktok: ["vertical"],
  youtube: ["vertical"],
  facebook: ["portrait", "square", "vertical"],
  linkedin: ["portrait", "square", "vertical"],
  x: ["square", "vertical"],
};
export function formatFor(platform: string, rendered: ReadonlySet<string>): CroppedFormat | null {
  return (PLATFORM_FORMATS[platform] ?? ["vertical"]).find((f) => rendered.has(f)) ?? null;
}

/** The cover frame on the cut timeline, in whole milliseconds (Reels' `thumbOffset`, TikTok's `coverMs`). */
export function coverMs(at: number, keep: readonly Span[]): number {
  return Math.round(onCut(at, keep) * 1000);
}

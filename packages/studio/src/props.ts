/**
 * What the Remotion compositions get: the cut files (named inside the edit's folder, which Remotion
 * serves as its public dir) and the edit moved onto the cut timeline. Remotion never reads the DB.
 */
import { basename } from "node:path";
import { DEFAULT_LOOK, type Look } from "@wren/video";
import type { Captions } from "./caption-styles.js";
import { srt } from "./captions.js";
import { keepSegments, onCut, toCutTime } from "./cuts.js";
import type { MatteWindow } from "./matte.js";
import { cutSize, FPS, portrait } from "./media.js";
import { fitRect, placeWord, type Rect, verticalRect, type Zone } from "./safe-zones.js";
import type { LayoutRange, Short, VideoEdit, Word } from "./schema.js";
import { STRESS } from "./stress.js";

export type LongProps = {
  /** File names in the public dir. */
  main: string;
  cam: string | null;
  fps: number;
  durationInFrames: number;
  /** Cut-timeline seconds. */
  words: Word[];
  layout: LayoutRange[];
  captions: Captions;
  /** Stressed words, as indexes into `words` (the `stress` style). */
  stress: number[];
  /** Stressed words drawn behind the speaker, each over its matte (`captions.behind`). */
  behind: BehindWord[];
  look: Look;
};

/**
 * A stressed word behind the speaker: its text and seconds, and the matte that holds the speaker
 * over it: a file in the public dir starting at `fromFrame`, cut out of the cut file `src`. The word
 * shows from `s` until `to` (`holdS` after its end, inside its matte).
 */
export type BehindWord = {
  w: string;
  s: number;
  e: number;
  to: number;
  matte: { file: string; src: string; fromFrame: number; frames: number };
  /** Where it reads (`placeWord`): the drawn text, its middle and size in output px. */
  place: { text: string; x: number; y: number; size: number };
};

/** A matte `makeMattes` made: its window, its file in the public dir, and where he is in it. */
export type Matte = MatteWindow & { file: string; zone?: Zone };

/** A stressed word with its matte, not yet placed for a format. */
type Unplaced = Omit<BehindWord, "place"> & { zone?: Zone | undefined };

/** Each format's frame, big word size and usual height (its middle, from the top). */
export const BIG = {
  long: { frame: [1920, 1080], size: 260, y: 430 },
  vertical: { frame: [1080, 1920], size: 220, y: 620 },
  short: { frame: [1080, 1920], size: 220, y: 620 },
  /** A Short with no face shows the recording; the word sits higher. */
  shortScreen: { frame: [1080, 1920], size: 220, y: 660 },
} as const satisfies Record<string, { frame: [number, number]; size: number; y: number }>;

/** The big word's text: the word without its punctuation. */
export const bigText = (w: string) => w.replace(/^[^\p{L}\p{N}$]+|[^\p{L}\p{N}%]+$/gu, "");

/** Called with each stressed word that can't read in a format and so isn't drawn behind. */
export type OnSkip = (w: { w: string; s: number }, format: string) => void;

/**
 * Place each word for one format: where `rect(b)` says its matte's picture sits (null: not drawn
 * in this format). A word whose matte has no zone keeps the usual spot; one that reads nowhere
 * is dropped and reported to `skip`.
 */
function placeAll(
  raw: readonly Unplaced[],
  big: { frame: readonly [number, number]; size: number; y: number },
  rect: (b: Unplaced) => Rect | null,
  format: string,
  skip?: OnSkip,
): BehindWord[] {
  const frame: [number, number] = [big.frame[0], big.frame[1]];
  return raw.flatMap(({ zone, ...b }) => {
    const r = rect({ ...b, zone });
    if (!r) return [];
    const text = bigText(b.w);
    if (!zone) {
      const size = Math.round(
        Math.min(big.size, (frame[0] * 0.9) / (0.62 * Math.max(1, text.length))),
      );
      return [{ ...b, place: { text, x: frame[0] / 2, y: big.y, size } }];
    }
    const spot = placeWord(zone, r, { frame, text, size: big.size, y: big.y });
    if (!spot) {
      skip?.(b, format);
      return [];
    }
    return [
      { ...b, place: { text, x: Math.round(spot.x), y: Math.round(spot.y), size: spot.size } },
    ];
  });
}

/**
 * The Long props. `mattes`: the windows matted for the words behind the speaker (`makeMattes`);
 * a stressed word with no matte isn't drawn behind.
 */
export function longProps(
  edit: VideoEdit,
  mattes: readonly Matte[] = [],
  o: { skip?: OnSkip } = {},
): LongProps {
  const { raw, ...long } = longBase(edit, mattes);
  const frame = BIG.long.frame;
  const main = fitRect(cutSize(edit.tracks.main), [...frame], "contain");
  const cam = edit.tracks.cam ? fitRect(cutSize(edit.tracks.cam), [...frame], "cover") : null;
  return {
    ...long,
    behind: placeAll(
      raw,
      BIG.long,
      (b) => (b.matte.src === long.main ? main : cam),
      "long",
      o.skip,
    ),
  };
}

const r = (x: number) => Math.round(x * 1000) / 1000;

/** Each word left after the cuts, on the cut timeline, with its index in the edit's words. */
function keptWords(edit: VideoEdit) {
  const keep = keepSegments(edit.cuts, edit.tracks.main.durationS, FPS);
  return edit.words.flatMap((w, i) => {
    const s = toCutTime(w.s, keep);
    return s === null ? [] : [{ i, w: { w: w.w, s: r(s), e: r(Math.max(s, onCut(w.e, keep))) } }];
  });
}

/** The long video's English subtitles (`out/long.en.srt`): its words as fixed, on the cut. */
export function longSrt(edit: VideoEdit): string {
  return srt(keptWords(edit).map(({ w }) => w));
}

function longBase(
  edit: VideoEdit,
  mattes: readonly Matte[],
): Omit<LongProps, "behind"> & { raw: Unplaced[] } {
  if (!edit.files.cutMain)
    throw new Error(`video ${edit.id}: not cut yet; run wren video cut ${edit.id}`);
  const keep = keepSegments(edit.cuts, edit.tracks.main.durationS, FPS);
  const total = keep.reduce((n, k) => n + (k.e - k.s), 0);
  const kept = keptWords(edit);
  const stressed = new Set(edit.stress ?? []);
  const main = basename(edit.files.cutMain);
  const cam = edit.files.cutCam ? basename(edit.files.cutCam) : null;
  const raw = edit.captions.behind
    ? kept.flatMap(({ i, w }): Unplaced[] => {
        const m = stressed.has(i) ? mattes.find((x) => x.picks.includes(i)) : undefined;
        if (!m) return [];
        const src = m.source === "cam" && cam ? cam : main;
        const to = r(Math.min(w.e + STRESS.holdS, (m.fromFrame + m.frames) / FPS));
        const { file, fromFrame, frames } = m;
        return [{ ...w, to, matte: { file, src, fromFrame, frames }, zone: m.zone }];
      })
    : [];
  return {
    main,
    cam,
    fps: FPS,
    durationInFrames: Math.max(1, Math.round(total * FPS)),
    words: kept.map(({ w }) => w),
    stress: kept.flatMap(({ i }, j) => (stressed.has(i) ? [j] : [])),
    raw,
    layout: edit.layout.map((l) => ({
      ...l,
      from: r(onCut(l.from, keep)),
      to: r(onCut(l.to, keep)),
    })),
    captions: edit.captions,
    look: DEFAULT_LOOK,
  };
}

/** Where his face is: the camera file, or a box cropped out of the recording (one-file OBS). */
export type Face = {
  /** A file in the public dir; null = no face to show. */
  file: string | null;
  /** [x, y, w, h] in that file's pixels; null = the whole file. */
  box: [number, number, number, number] | null;
  /** That file's size in pixels, so a box can be cropped by CSS. */
  size: [number, number];
};

export type ShortProps = Omit<LongProps, "cam"> & {
  face: Face;
  /** Where the clip starts on the cut file, in frames. */
  startFrame: number;
  title: string;
};

export type ThumbnailProps = {
  main: string;
  face: Face;
  /** The chosen frame on the cut files. */
  frame: number;
  text: string;
  variant: 1 | 2 | 3;
  look: Look;
};

export type VerticalProps = Omit<LongProps, "cam" | "layout"> & {
  /** What fills the 9:16 frame: a file in the public dir, its size, the window shown of it. */
  picture: { file: string; size: [number, number]; window: [number, number, number, number] };
};

/**
 * The window of a `w` x `h` picture a 9:16 frame shows: all of a portrait one (cropped to 9:16 at
 * its centre), else full height and 9:16 wide, centred on `cx` (his face) and kept inside.
 */
export function verticalWindow(w: number, h: number, cx = w / 2): [number, number, number, number] {
  const r = 9 / 16;
  if (w / h <= r) {
    const wh = Math.round(w / r);
    return [0, Math.round((h - wh) / 2), w, wh];
  }
  const ww = Math.round(h * r);
  return [Math.round(Math.min(w - ww, Math.max(0, cx - ww / 2))), 0, ww, h];
}

/**
 * The whole cut as 9:16 (step 5). A portrait recording fills it. A landscape one is cropped to a
 * 9:16 window on his face: the camera file's centre when there is one, the cam box's centre in a
 * one-file recording, else the frame's centre. The recording always carries the sound.
 */
export function verticalProps(
  edit: VideoEdit,
  mattes: readonly Matte[] = [],
  o: { skip?: OnSkip } = {},
): VerticalProps {
  const { cam: _c, layout: _l, raw, ...long } = longBase(edit, mattes);
  const face = faceOf(edit);
  // A portrait recording is the picture; else the camera file, else the recording.
  const own = portrait(edit.tracks.main) || !face.file || !!face.box;
  const [w, h] = own ? cutSize(edit.tracks.main) : face.size;
  const cx = own && face.box ? face.box[0] + face.box[2] / 2 : w / 2;
  const file = own ? long.main : (face.file as string);
  const picture: VerticalProps["picture"] = {
    file,
    size: [w, h],
    window: verticalWindow(w, h, cx),
  };
  // A matte lines up only with the picture it was cut out of.
  const rect = verticalRect(picture);
  const behind = placeAll(
    raw,
    BIG.vertical,
    (b) => (b.matte.src === file ? rect : null),
    "vertical",
    o.skip,
  );
  return { ...long, behind, picture };
}

/** Where `face`'s file sits when its face (box, else the whole file) covers a `w` x `h` box. */
export function faceRect(face: Face, w: number, h: number): Rect {
  const [fw, fh] = face.size;
  const [bx, by, bw, bh] = face.box ?? [0, 0, fw, fh];
  const k = Math.max(w / bw, h / bh);
  return [(w - bw * k) / 2 - bx * k, (h - bh * k) / 2 - by * k, fw * k, fh * k];
}

/** Shorts run 20 to 60 s on the cut timeline, 2 to 4 of them (or none). */
export const SHORT_S = { min: 20, max: 60 } as const;
export const SHORT_COUNT = { min: 2, max: 4 } as const;

function faceOf(edit: VideoEdit): Face {
  const { main, cam, camBox } = edit.tracks;
  // The cut pass writes each track at 1080 on its short side (`cutSize`).
  if (cam && edit.files.cutCam)
    return { file: basename(edit.files.cutCam), box: null, size: cutSize(cam) };
  const size = cutSize(main);
  if (camBox && edit.files.cutMain) {
    const k = size[0] / main.width;
    return {
      file: basename(edit.files.cutMain),
      box: camBox.map((n) => Math.round(n * k)) as Face["box"],
      size,
    };
  }
  return { file: null, box: null, size };
}

/** Short `n` (1-based): the Long props cut down to its span, times from its start. */
export function shortProps(
  edit: VideoEdit,
  n: number,
  mattes: readonly Matte[] = [],
  o: { skip?: OnSkip } = {},
): ShortProps {
  const short: Short | undefined = edit.shorts[n - 1];
  if (!short) throw new Error(`video ${edit.id} has ${edit.shorts.length} shorts; no ${n}`);
  const { cam: _c, raw, ...long } = longBase(edit, mattes);
  const face = faceOf(edit);
  const keep = keepSegments(edit.cuts, edit.tracks.main.durationS, FPS);
  const start = onCut(short.from, keep);
  const end = onCut(short.to, keep);
  const r = (x: number) => Math.round(x * 1000) / 1000;
  const inside = long.words.flatMap((w, j) => (w.s >= start && w.s < end ? [j] : []));
  return {
    ...long,
    face,
    startFrame: Math.round(start * FPS),
    durationInFrames: Math.max(1, Math.round((end - start) * FPS)),
    words: inside.map((j) => {
      const w = long.words[j] as Word;
      return { ...w, s: r(w.s - start), e: r(Math.min(w.e, end) - start) };
    }),
    stress: inside.flatMap((j, k) => (long.stress.includes(j) ? [k] : [])),
    behind: shortBehind(
      raw
        .filter((b) => b.s >= start && b.to <= end)
        .map((b) => ({
          ...b,
          s: r(b.s - start),
          e: r(b.e - start),
          to: r(b.to - start),
          matte: { ...b.matte, fromFrame: b.matte.fromFrame - Math.round(start * FPS) },
        })),
      face,
      long.main,
      long.layout
        .filter((l) => l.to > start && l.from < end)
        .map((l) => ({ ...l, from: Math.max(0, l.from - start), to: l.to - start })),
      `short-${n}`,
      o.skip,
    ),
    layout: long.layout
      .filter((l) => l.to > start && l.from < end)
      .map((l) => ({ ...l, from: r(Math.max(0, l.from - start)), to: r(l.to - start) })),
    title: short.title,
  };
}

/**
 * A Short draws a matte only where it lines up: his face full frame (cam layout) from the face's
 * file, or the whole recording when there's no face (it then sits higher).
 */
function shortBehind(
  raw: Unplaced[],
  face: Face,
  main: string,
  layout: LayoutRange[],
  format: string,
  skip?: OnSkip,
): BehindWord[] {
  const noFace = !face.file && !face.box;
  const full = faceRect(face, 1080, 1920);
  const screen = fitRect(face.size, [1080, 1920], "contain");
  const camAt = (t: number) =>
    (layout.find((l) => t >= l.from && t < l.to)?.show ?? "corner") === "cam";
  if (noFace)
    return placeAll(
      raw,
      BIG.shortScreen,
      (b) => (b.matte.src === main ? screen : null),
      format,
      skip,
    );
  return placeAll(
    raw,
    BIG.short,
    (b) =>
      camAt(b.s) && (face.file === b.matte.src || (!!face.box && b.matte.src === main))
        ? full
        : null,
    format,
    skip,
  );
}

/** The three thumbnail variants at the chosen frame; null when no thumbnail is set. */
export function thumbnailProps(edit: VideoEdit): ThumbnailProps[] | null {
  if (!edit.thumbnail) return null;
  const { main, durationInFrames } = longProps(edit);
  const keep = keepSegments(edit.cuts, edit.tracks.main.durationS, FPS);
  const frame = Math.min(durationInFrames - 1, Math.round(onCut(edit.thumbnail.at, keep) * FPS));
  const text = edit.thumbnail.text || edit.title;
  return ([1, 2, 3] as const).map((variant) => ({
    main,
    face: faceOf(edit),
    frame,
    text,
    variant,
    look: DEFAULT_LOOK,
  }));
}

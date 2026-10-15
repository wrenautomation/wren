/**
 * What the Remotion compositions get: the cut files (named inside the edit's folder, which Remotion
 * serves as its public dir) and the edit moved onto the cut timeline. Remotion never reads the DB.
 */
import { basename } from "node:path";
import { DEFAULT_LOOK, type Look } from "@wren/video";
import type { Captions } from "./caption-styles.js";
import { srt } from "./captions.js";
import { keepSegments, onCut, toCutTime } from "./cuts.js";
import {
  type CroppedFormat,
  cropWindow,
  FRAME,
  overlaysOnCut,
  type Point,
  shortCrop,
  type TextOverlay,
} from "./finish.js";
import { coverRect } from "./finish-look.js";
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
  /** Text on the video (finish.ts), cut-timeline seconds. */
  overlays: TextOverlay[];
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
  square: { frame: [1080, 1080], size: 200, y: 400 },
  portrait: { frame: [1080, 1350], size: 210, y: 470 },
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
    overlays: overlaysOnCut(edit.overlays ?? [], keep),
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
  /** Where the frame centres on his picture (`shortCrop`); null = the face box's middle. */
  crop: Point | null;
  /** Where the clip starts on the cut file, in frames. */
  startFrame: number;
  title: string;
  /** The title on screen at the start (`cardOf`); null when the Short turns it off. */
  card: TitleCard | null;
};

/**
 * A Short's opening title, Reels style: a small label in the top third, there from the first
 * frame (the platforms' cover), held `holdS`, then gone over `fadeS`. At most `maxChars`.
 */
export const CARD = { holdS: 2.6, fadeS: 0.4, maxChars: 60 } as const;
export type TitleCard = { text: string; holdS: number; fadeS: number };

/** A Short's captions read as whole sentences: a capital first, a stop for a trailing comma. */
const opened = (w: string) => w.replace(/^(["'“‘(]?)(\p{Ll})/u, (_, q, c) => q + c.toUpperCase());
const closed = (w: string) => w.replace(/[,;:]$/, ".");

/** What a Short's title card says and how long it stays: its `cardText`, else its title. */
export function cardOf(short: Short, durationS: number): TitleCard | null {
  if (short.card === false) return null;
  let text = (short.cardText ?? short.title).replace(/\s+/g, " ").trim();
  if (!text) return null;
  if (text.length > CARD.maxChars) {
    const cut = text.slice(0, CARD.maxChars + 1);
    text = cut.slice(0, Math.max(cut.lastIndexOf(" "), 1)).replace(/[\s,;:.-]+$/, "");
  }
  const holdS = Math.max(0, Math.min(CARD.holdS, durationS - CARD.fadeS));
  return { text, holdS, fadeS: CARD.fadeS };
}

export type ThumbnailProps = {
  main: string;
  face: Face;
  /** The chosen frame on the cut files. */
  frame: number;
  text: string;
  variant: 1 | 2 | 3;
  look: Look;
};

export type FramedProps = Omit<LongProps, "cam" | "layout"> & {
  format: CroppedFormat;
  /** The output frame in pixels. */
  frame: [number, number];
  /** What fills the frame: a file in the public dir, its size, the window shown of it. */
  picture: { file: string; size: [number, number]; window: [number, number, number, number] };
};
/** The whole cut as 9:16. */
export type VerticalProps = FramedProps;

/**
 * The window of a `w` x `h` picture a 9:16 frame shows: all of a portrait one (cropped to 9:16 at
 * its centre), else full height and 9:16 wide, centred on `cx` (his face) and kept inside.
 */
export const verticalWindow = (w: number, h: number, cx = w / 2) =>
  cropWindow(w, h, FRAME.vertical, { x: cx / w, y: 0.5 });

/**
 * Which picture fills a cropped format and where its crop sits unless he moved it: a portrait
 * recording or one with no camera file is the recording itself (centred on the cam box when there
 * is one); else the camera file, centred. The page shows the crop on the same picture.
 */
export function framedPicture(edit: VideoEdit): {
  source: "main" | "cam";
  size: [number, number];
  centre: Point;
} {
  const face = faceOf(edit);
  const own = portrait(edit.tracks.main) || !face.file || !!face.box;
  const [w, h] = own ? cutSize(edit.tracks.main) : face.size;
  const cx = own && face.box ? face.box[0] + face.box[2] / 2 : w / 2;
  return { source: own ? "main" : "cam", size: [w, h], centre: { x: cx / w, y: 0.5 } };
}

/**
 * The whole cut cropped to `format` (9:16, 1:1 or 4:5). The window sits where `crops` puts it,
 * else on his face (`framedPicture`). The recording always carries the sound.
 */
export function framedProps(
  edit: VideoEdit,
  format: CroppedFormat,
  mattes: readonly Matte[] = [],
  o: { skip?: OnSkip } = {},
): FramedProps {
  const { cam: _c, layout: _l, raw, ...long } = longBase(edit, mattes);
  const at = framedPicture(edit);
  const file = at.source === "main" ? long.main : (faceOf(edit).file as string);
  const frame: [number, number] = [...FRAME[format]];
  const [w, h] = at.size;
  const picture: FramedProps["picture"] = {
    file,
    size: [w, h],
    window: cropWindow(w, h, frame, edit.crops?.[format] ?? at.centre),
  };
  // A matte lines up only with the picture it was cut out of.
  const rect = verticalRect(picture, frame);
  const behind = placeAll(
    raw,
    BIG[format],
    (b) => (b.matte.src === file ? rect : null),
    format,
    o.skip,
  );
  return { ...long, format, frame, behind, picture };
}

/** The whole cut as 9:16 (step 5). */
export const verticalProps = (
  edit: VideoEdit,
  mattes: readonly Matte[] = [],
  o: { skip?: OnSkip } = {},
) => framedProps(edit, "vertical", mattes, o);

/** Where `face`'s file sits when its face (box, else the whole file) covers a `w` x `h` box. */
export const faceRect = (face: Face, w: number, h: number, crop: Point | null = null): Rect =>
  coverRect(face.size, face.box, w, h, crop);

/** Shorts run 20 to 60 s on the cut timeline, 2 to 12 of them (or none): a 20 minute video yields a dozen. */
export const SHORT_S = { min: 20, max: 60 } as const;
export const SHORT_COUNT = { min: 2, max: 12 } as const;

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
  const crop = shortCrop(edit.crops, n);
  const keep = keepSegments(edit.cuts, edit.tracks.main.durationS, FPS);
  const start = onCut(short.from, keep);
  const end = onCut(short.to, keep);
  const r = (x: number) => Math.round(x * 1000) / 1000;
  // By their middles, like `sentences.ts` snaps them: a word Whisper overlaps into the edge.
  const inside = long.words.flatMap((w, j) => {
    const mid = (w.s + w.e) / 2;
    return mid >= start && mid < end ? [j] : [];
  });
  const last = inside.length - 1;
  return {
    ...long,
    face,
    crop,
    startFrame: Math.round(start * FPS),
    durationInFrames: Math.max(1, Math.round((end - start) * FPS)),
    words: inside.map((j, k) => {
      const w = long.words[j] as Word;
      return {
        ...w,
        w: k === last ? closed(k === 0 ? opened(w.w) : w.w) : k === 0 ? opened(w.w) : w.w,
        s: r(Math.max(w.s, start) - start),
        e: r(Math.min(w.e, end) - start),
      };
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
      crop,
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
    overlays: long.overlays
      .filter((x) => x.to > start && x.from < end)
      .map((x) => ({
        ...x,
        from: r(Math.max(0, x.from - start)),
        to: r(Math.min(end, x.to) - start),
      })),
    title: short.title,
    card: cardOf(short, end - start),
  };
}

/**
 * A Short draws a matte only where it lines up: his face full frame (cam layout) from the face's
 * file, or the whole recording when there's no face (it then sits higher).
 */
function shortBehind(
  raw: Unplaced[],
  face: Face,
  crop: Point | null,
  main: string,
  layout: LayoutRange[],
  format: string,
  skip?: OnSkip,
): BehindWord[] {
  const noFace = !face.file && !face.box;
  const full = faceRect(face, 1080, 1920, crop);
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

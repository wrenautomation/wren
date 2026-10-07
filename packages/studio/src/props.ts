/**
 * What the Remotion compositions get: the cut files (named inside the edit's folder, which Remotion
 * serves as its public dir) and the edit moved onto the cut timeline. Remotion never reads the DB.
 */
import { basename } from "node:path";
import { DEFAULT_LOOK, type Look } from "@wren/video";
import type { Captions } from "./caption-styles.js";
import { keepSegments, onCut, toCutTime } from "./cuts.js";
import type { MatteWindow } from "./matte.js";
import { cutSize, FPS, portrait } from "./media.js";
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
};

/** A matte `makeMattes` made: its window and its file in the public dir. */
export type Matte = MatteWindow & { file: string };

/**
 * The Long props. `mattes`: the windows matted for the words behind the speaker (`makeMattes`);
 * a stressed word with no matte isn't drawn behind.
 */
export function longProps(edit: VideoEdit, mattes: readonly Matte[] = []): LongProps {
  if (!edit.files.cutMain)
    throw new Error(`video ${edit.id}: not cut yet; run wren video cut ${edit.id}`);
  const keep = keepSegments(edit.cuts, edit.tracks.main.durationS, FPS);
  const total = keep.reduce((n, k) => n + (k.e - k.s), 0);
  const r = (x: number) => Math.round(x * 1000) / 1000;
  // Each word left after the cuts, on the cut timeline, with its index in the edit's words.
  const kept = edit.words.flatMap((w, i) => {
    const s = toCutTime(w.s, keep);
    return s === null ? [] : [{ i, w: { w: w.w, s: r(s), e: r(Math.max(s, onCut(w.e, keep))) } }];
  });
  const stressed = new Set(edit.stress ?? []);
  const main = basename(edit.files.cutMain);
  const cam = edit.files.cutCam ? basename(edit.files.cutCam) : null;
  const behind = edit.captions.behind
    ? kept.flatMap(({ i, w }): BehindWord[] => {
        const m = stressed.has(i) ? mattes.find((x) => x.picks.includes(i)) : undefined;
        if (!m) return [];
        const src = m.source === "cam" && cam ? cam : main;
        const to = r(Math.min(w.e + STRESS.holdS, (m.fromFrame + m.frames) / FPS));
        const { file, fromFrame, frames } = m;
        return [{ ...w, to, matte: { file, src, fromFrame, frames } }];
      })
    : [];
  return {
    main,
    cam,
    fps: FPS,
    durationInFrames: Math.max(1, Math.round(total * FPS)),
    words: kept.map(({ w }) => w),
    stress: kept.flatMap(({ i }, j) => (stressed.has(i) ? [j] : [])),
    behind,
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
export function verticalProps(edit: VideoEdit, mattes: readonly Matte[] = []): VerticalProps {
  const { cam: _c, layout: _l, ...long } = longProps(edit, mattes);
  const face = faceOf(edit);
  // A portrait recording is the picture; else the camera file, else the recording.
  const own = portrait(edit.tracks.main) || !face.file || !!face.box;
  const [w, h] = own ? cutSize(edit.tracks.main) : face.size;
  const cx = own && face.box ? face.box[0] + face.box[2] / 2 : w / 2;
  const file = own ? long.main : (face.file as string);
  // A matte lines up only with the picture it was cut out of.
  const behind = long.behind.filter((b) => b.matte.src === file);
  return { ...long, behind, picture: { file, size: [w, h], window: verticalWindow(w, h, cx) } };
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
export function shortProps(edit: VideoEdit, n: number, mattes: readonly Matte[] = []): ShortProps {
  const short: Short | undefined = edit.shorts[n - 1];
  if (!short) throw new Error(`video ${edit.id} has ${edit.shorts.length} shorts; no ${n}`);
  const { cam: _c, ...long } = longProps(edit, mattes);
  const keep = keepSegments(edit.cuts, edit.tracks.main.durationS, FPS);
  const start = onCut(short.from, keep);
  const end = onCut(short.to, keep);
  const r = (x: number) => Math.round(x * 1000) / 1000;
  const inside = long.words.flatMap((w, j) => (w.s >= start && w.s < end ? [j] : []));
  return {
    ...long,
    face: faceOf(edit),
    startFrame: Math.round(start * FPS),
    durationInFrames: Math.max(1, Math.round((end - start) * FPS)),
    words: inside.map((j) => {
      const w = long.words[j] as Word;
      return { ...w, s: r(w.s - start), e: r(Math.min(w.e, end) - start) };
    }),
    stress: inside.flatMap((j, k) => (long.stress.includes(j) ? [k] : [])),
    behind: long.behind
      .filter((b) => b.s >= start && b.to <= end)
      .map((b) => ({
        ...b,
        s: r(b.s - start),
        e: r(b.e - start),
        to: r(b.to - start),
        matte: { ...b.matte, fromFrame: b.matte.fromFrame - Math.round(start * FPS) },
      })),
    layout: long.layout
      .filter((l) => l.to > start && l.from < end)
      .map((l) => ({ ...l, from: r(Math.max(0, l.from - start)), to: r(l.to - start) })),
    title: short.title,
  };
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

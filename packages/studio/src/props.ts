/**
 * What the Remotion compositions get: the cut files (named inside the edit's folder, which Remotion
 * serves as its public dir) and the edit moved onto the cut timeline. Remotion never reads the DB.
 */
import { basename } from "node:path";
import { DEFAULT_LOOK, type Look } from "@wren/video";
import { keepSegments, onCut, toCutTime } from "./cuts.js";
import { FPS } from "./media.js";
import type { LayoutRange, Short, VideoEdit, Word } from "./schema.js";

export type LongProps = {
  /** File names in the public dir. */
  main: string;
  cam: string | null;
  fps: number;
  durationInFrames: number;
  /** Cut-timeline seconds. */
  words: Word[];
  layout: LayoutRange[];
  captions: { on: boolean; style: string };
  look: Look;
};

export function longProps(edit: VideoEdit): LongProps {
  if (!edit.files.cutMain)
    throw new Error(`video ${edit.id}: not cut yet; run wren video cut ${edit.id}`);
  const keep = keepSegments(edit.cuts, edit.tracks.main.durationS, FPS);
  const total = keep.reduce((n, k) => n + (k.e - k.s), 0);
  const r = (x: number) => Math.round(x * 1000) / 1000;
  return {
    main: basename(edit.files.cutMain),
    cam: edit.files.cutCam ? basename(edit.files.cutCam) : null,
    fps: FPS,
    durationInFrames: Math.max(1, Math.round(total * FPS)),
    words: edit.words.flatMap((w) => {
      const s = toCutTime(w.s, keep);
      return s === null ? [] : [{ w: w.w, s: r(s), e: r(Math.max(s, onCut(w.e, keep))) }];
    }),
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

/** Shorts run 20 to 60 s on the cut timeline, 2 to 4 of them (or none). */
export const SHORT_S = { min: 20, max: 60 } as const;
export const SHORT_COUNT = { min: 2, max: 4 } as const;

function faceOf(edit: VideoEdit): Face {
  const { main, cam, camBox } = edit.tracks;
  // The cut pass scales every track to 1080 high.
  const sized = (w: number, h: number): [number, number] => [
    Math.round((w * 1080) / h / 2) * 2,
    1080,
  ];
  if (cam && edit.files.cutCam)
    return { file: basename(edit.files.cutCam), box: null, size: sized(cam.width, cam.height) };
  if (camBox && edit.files.cutMain) {
    const k = 1080 / main.height;
    return {
      file: basename(edit.files.cutMain),
      box: camBox.map((n) => Math.round(n * k)) as Face["box"],
      size: sized(main.width, main.height),
    };
  }
  return { file: null, box: null, size: sized(main.width, main.height) };
}

/** Short `n` (1-based): the Long props cut down to its span, times from its start. */
export function shortProps(edit: VideoEdit, n: number): ShortProps {
  const short: Short | undefined = edit.shorts[n - 1];
  if (!short) throw new Error(`video ${edit.id} has ${edit.shorts.length} shorts; no ${n}`);
  const { cam: _c, ...long } = longProps(edit);
  const keep = keepSegments(edit.cuts, edit.tracks.main.durationS, FPS);
  const start = onCut(short.from, keep);
  const end = onCut(short.to, keep);
  const r = (x: number) => Math.round(x * 1000) / 1000;
  return {
    ...long,
    face: faceOf(edit),
    startFrame: Math.round(start * FPS),
    durationInFrames: Math.max(1, Math.round((end - start) * FPS)),
    words: long.words
      .filter((w) => w.s >= start && w.s < end)
      .map((w) => ({ ...w, s: r(w.s - start), e: r(Math.min(w.e, end) - start) })),
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

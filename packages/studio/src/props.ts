/**
 * What the Remotion compositions get: the cut files (named inside the edit's folder, which Remotion
 * serves as its public dir) and the edit moved onto the cut timeline. Remotion never reads the DB.
 */
import { basename } from "node:path";
import { DEFAULT_LOOK, type Look } from "@wren/video";
import { keepSegments, type Span, toCutTime } from "./cuts.js";
import { FPS } from "./media.js";
import type { LayoutRange, VideoEdit, Word } from "./schema.js";

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

/** A raw time on the cut timeline; a time inside a cut lands where the next kept part starts. */
const onCut = (t: number, keep: readonly Span[]): number => {
  let before = 0;
  for (const k of keep) {
    if (t <= k.e) return before + Math.max(0, t - k.s);
    before += k.e - k.s;
  }
  return before;
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

/**
 * The Finish view's data: the edit and record types, its constants, and the pure sums over them
 * (times, stable JSON, what a format shows, what a version changed).
 */
import {
  type CaptionLine,
  type CroppedFormat,
  type Crops,
  FPS,
  type Point,
  type TextOverlay,
} from "@wren/studio/finish";
import type { Cut } from "@wren/studio/schema";
import type { ReactNode } from "react";
import type { CamBox, LayoutRange, Short } from "./finish-parts.js";

export type Format = "long" | CroppedFormat;
/** A transcript word as the page has it: `stress` marks a stressed word. */
export type Word = { w: string; s: number; e: number; stress?: boolean };
type Captions = {
  style: string;
  long?: "screen" | "track";
  short?: "screen" | "track";
  behind?: boolean;
  on?: boolean;
  place?: { long?: number; short?: number };
};
/** What this view saves: the fields of the edit it changes. */
export type FinishEdit = {
  cuts: Cut[];
  overlays: TextOverlay[];
  crops: Crops;
  captions: Captions;
  thumbnail: { at: number; text: string } | null;
  formats: Format[];
};
/** The record's `video.finish` (content `finishOf`). */
export type FinishData = {
  fps: number;
  durationS: number;
  size: [number, number];
  camSize: [number, number] | null;
  source: string | null;
  sourceCam: string | null;
  strip: string | null;
  picture: { source: "main" | "cam"; centre: Point };
  /** What the long video shows when (raw seconds): his face in the corner, alone, or the screen. */
  layout?: LayoutRange[];
  lines: CaptionLine[];
  rendered: Format[];
  /** The Shorts, in order (their number is the crop key); `face` = there is a face to crop. */
  shorts: (Short & { n: number })[];
  /** The face box in a recording with the camera in it, [x, y, w, h] pixels. */
  camBox?: CamBox | null;
  face: boolean;
  /** The renders the edit has since changed, by output name; null when that can't be told. */
  stale: string[] | null;
  covers: Partial<Record<CroppedFormat, string>>;
  saved: FinishEdit;
};

export const SET = "marketing.videoSet";
export const LINE = "marketing.videoLine";
export const FIELDS = ["cuts", "overlays", "crops", "captions", "thumbnail", "formats"] as const;
export const SAVE_DELAY_MS = 1200;
/** The tallest the stage gets, so a 9:16 view leaves the timeline on screen. */
export const STAGE_MAX_H = 520;
export const ZOOMS = [1, 2, 4, 8, 16, 32] as const;
/** The filmstrip sprite: frames across a row, and in all (content `finishMedia`). */
export const STRIP_ACROSS = 10;
export const STRIP_FRAMES = 60;

export const VIEWS: [Format, string][] = [
  ["long", "16:9"],
  ["vertical", "9:16"],
  ["square", "1:1"],
  ["portrait", "4:5"],
];
export const SHAPES: [Format, string, string][] = [
  ["long", "Long, 16:9", "YouTube"],
  ["vertical", "Vertical, 9:16", "Shorts, Reels and TikTok"],
  ["square", "Square, 1:1", "X, and LinkedIn or Facebook when 4:5 is off"],
  ["portrait", "Portrait, 4:5", "LinkedIn and Facebook feeds"],
];
export const STYLES: [string, string][] = [
  ["word", "Word"],
  ["pill", "Pill"],
  ["sweep", "Sweep"],
  ["pop", "Pop"],
  ["wipe", "Wipe"],
  ["stress", "Stress"],
];
/** How far each format's caption line may sit from the top (studio `captionPlaceSchema`). */
export const PLACE = { long: [0.1, 0.92], short: [0.12, 0.8] } as const;

export const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));
export const r3 = (x: number) => Math.round(x * 1000) / 1000;
/** "1:05.12": minutes, seconds and the frame. */
export const stamp = (t: number) => {
  const f = Math.round(t * FPS);
  const s = Math.floor(f / FPS);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}.${String(f % FPS).padStart(2, "0")}`;
};
export const short = (t: number) =>
  `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, "0")}`;

/** JSON with keys in order: Postgres hands jsonb back with its own key order. */
export const stable = (v: unknown) =>
  JSON.stringify(v, (_k, x) =>
    x && typeof x === "object" && !Array.isArray(x)
      ? Object.fromEntries(
          Object.entries(x as Record<string, unknown>)
            .filter(([, y]) => y !== undefined)
            .sort(([a], [b]) => (a < b ? -1 : 1)),
        )
      : x,
  );
export const same = (a: unknown, b: unknown) => stable(a) === stable(b);
export const normal = (e: FinishEdit): FinishEdit => ({
  ...e,
  captions: e.captions ?? { style: "word" },
  crops: e.crops ?? {},
  overlays: e.overlays ?? [],
  cuts: [...e.cuts].sort((a, b) => a.from - b.from || a.to - b.to),
});
/** Whether a format burns its captions in (the storyboard's frames draw them the same). */
export const shownOn = (c: Captions, which: "long" | "short") =>
  which === "long"
    ? c.long === "screen"
    : (c.short ?? (c.on === false ? "track" : "screen")) === "screen";
export const problem = (e: FinishEdit) =>
  !e.formats.length
    ? "Keep at least one shape."
    : e.overlays.some((o) => !o.text.trim())
      ? "Text on the video needs words."
      : null;

export type Picked =
  | { kind: "overlay"; i: number }
  | { kind: "cut"; i: number }
  | { kind: "line"; i: number }
  | null;
export type Panel = "text" | "captions" | "cover" | "shapes" | "shorts" | "layout";

/** What their version changed, in words, for Keep mine or Use theirs. */
export function whatChanged(mine: FinishEdit, theirs: FinishEdit): ReactNode {
  const names: Record<(typeof FIELDS)[number], string> = {
    cuts: "the cuts",
    overlays: "the text on the video",
    crops: "the crops",
    captions: "the captions",
    thumbnail: "the cover",
    formats: "the shapes",
  };
  const moved = FIELDS.filter((k) => !same(mine[k], theirs[k])).map((k) => names[k]);
  return moved.length ? `They changed ${moved.join(", ")}.` : "Their version matches yours.";
}

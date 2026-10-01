/**
 * What a recording is once the browser closes: frames on disk with the second
 * each one appeared, plus the zooms and captions the walk asked for at given
 * seconds. Times count from the recording's start; positions are frame pixels
 * (CSS pixels times the device scale). Plain data, so the encoder and its tests
 * need no browser.
 */

export interface Frame {
  /** Path relative to the recording's directory. */
  file: string;
  /** Seconds from the start when this frame appeared. */
  t: number;
}

/** A push in on one spot, eased in over `ramp`, held, eased out over `ramp`. */
export interface Zoom {
  start: number;
  end: number;
  ramp: number;
  /** Center of the zoomed view, frame pixels. */
  cx: number;
  cy: number;
  /** 1 is the whole frame; 2 shows a quarter of it. */
  z: number;
}

/** A line of text over the video between two seconds; `png` is it drawn at the output size. */
export interface Caption {
  text: string;
  start: number;
  end: number;
  png?: string;
}

export interface Recording {
  dir: string;
  /** Frame size in pixels. */
  width: number;
  height: number;
  frames: Frame[];
  /** Seconds: the video's length. */
  end: number;
  zooms: Zoom[];
  captions: Caption[];
}

const MIN_FRAME = 0.001;

/**
 * The frames as an ffconcat list. A frame shows until the next one appears (the
 * browser only sends a frame when the page changes), the first from second 0,
 * the last until `end`. The last file is listed twice: the concat demuxer
 * ignores the final entry's duration otherwise.
 */
export function concatList(frames: readonly Frame[], end: number): string {
  if (!frames.length) throw new Error("a recording with no frames: the page never painted");
  const lines = ["ffconcat version 1.0"];
  frames.forEach((f, i) => {
    const from = i === 0 ? 0 : f.t;
    const to = frames[i + 1]?.t ?? end;
    lines.push(`file '${f.file}'`, `duration ${Math.max(MIN_FRAME, to - from).toFixed(4)}`);
  });
  lines.push(`file '${frames[frames.length - 1]?.file}'`);
  return `${lines.join("\n")}\n`;
}

const num = (n: number) => String(Math.round(n * 1000) / 1000);
const smooth = (p: string) => `(${p})*(${p})*(3-2*(${p}))`;

/** 0 outside the zoom, easing to 1 over its ramp and back: an ffmpeg expression of `it`. */
function weight(z: Zoom): string {
  const r = num(Math.max(0.05, z.ramp));
  const rise = `clip((it-${num(z.start)})/${r},0,1)`;
  const fall = `clip((${num(z.end)}-it)/${r},0,1)`;
  return `${smooth(rise)}*${smooth(fall)}`;
}

/**
 * zoompan's z, x and y for these zooms over a `width`x`height` frame. Between
 * zooms the view is the whole frame; the zoomed view never leaves the frame.
 * Zooms must not overlap (`checkZooms`).
 */
export function zoomExpressions(
  zooms: readonly Zoom[],
  width: number,
  height: number,
): { z: string; x: string; y: string } {
  if (!zooms.length) return { z: "1", x: "0", y: "0" };
  const terms = (pick: (z: Zoom) => number, base: number) =>
    zooms.map((z) => `${weight(z)}*(${num(pick(z) - base)})`).join("+");
  const cx = `(${num(width / 2)}+${terms((z) => z.cx, width / 2)})`;
  const cy = `(${num(height / 2)}+${terms((z) => z.cy, height / 2)})`;
  return {
    z: `1+${terms((z) => z.z, 1)}`,
    x: `clip(${cx}-iw/zoom/2,0,iw-iw/zoom)`,
    y: `clip(${cy}-ih/zoom/2,0,ih-ih/zoom)`,
  };
}

/** Zooms in time order, none overlapping and each long enough for its two ramps. */
export function checkZooms(zooms: readonly Zoom[]): void {
  let last = Number.NEGATIVE_INFINITY;
  for (const z of zooms) {
    if (z.z < 1) throw new Error(`a zoom below 1 (${z.z}) would show past the frame`);
    if (z.end - z.start < 2 * z.ramp)
      throw new Error(`a zoom from ${z.start}s to ${z.end}s is shorter than its two ramps`);
    if (z.start < last) throw new Error(`zooms overlap at ${z.start}s`);
    last = z.end;
  }
}

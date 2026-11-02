/**
 * Render only what changed (designs/2026-10-15-video-finishing.md). Each output a render makes
 * (`long`, `vertical`, `square`, `portrait`, `short-<n>`, `thumb-<n>`) has a hash of what its
 * composition draws from: the props the render would pass, less what that composition never
 * reads (a title, another format's caption height). The hash is stored beside the output's file
 * (`files["short-2.hash"]`); a render redoes the outputs whose hash differs or has none. Pure:
 * the worker (the page's "changed since the last render") and the Mac's render read the same.
 *
 * The hash is of the props with no mattes: those are cut from the same words, stress and cut
 * files the props already hold. A prop the compositions gain is hashed with no change here; one
 * a composition stops reading is named in the `key` functions below.
 */
import { createHash } from "node:crypto";
import { type Captions, onScreen } from "./caption-styles.js";
import { keepSegments } from "./cuts.js";
import { CROPPED, FPS } from "./finish.js";
import {
  framedProps,
  type LongProps,
  longProps,
  type ShortProps,
  shortProps,
  thumbnailProps,
} from "./props.js";
import type { Format, VideoEdit } from "./schema.js";

/**
 * Bump when a composition, the cut pass or a look changes how the same props draw: every output
 * is then out of date once.
 */
export const RENDER_VERSION = 1;

/** What a render can be narrowed to: one format, or the Shorts or thumbnails alone. */
export const RENDER_PARTS = ["long", "vertical", "square", "portrait", "shorts", "thumbs"] as const;
export type RenderPart = (typeof RENDER_PARTS)[number];

const SUFFIX = ".hash";
/** Where an output's hash is kept in the edit's `files`. */
export const hashKey = (output: string) => `${output}${SUFFIX}`;
/** Does this `files` record hold a hash from any render? Older renders hold none. */
export const hasHashes = (files: Record<string, string>) =>
  Object.keys(files).some((k) => k.endsWith(SUFFIX));

/** JSON with object keys in order, so the same props always give the same text. */
function stable(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stable).join(",")}]`;
  if (v && typeof v === "object")
    return `{${Object.entries(v)
      .filter(([, x]) => x !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([k, x]) => `${JSON.stringify(k)}:${stable(x)}`)
      .join(",")}}`;
  return JSON.stringify(v) ?? "null";
}

/** A short digest of anything JSON. */
export const digest = (v: unknown): string =>
  createHash("sha256").update(stable(v)).digest("hex").slice(0, 16);

/**
 * What the captions do in one family of outputs: burned in or not, their style and height. Only
 * these reach the composition (`onScreen`, `captions.style`, `captions.place`).
 */
function captionsRead(c: Captions, which: "long" | "short") {
  const on = onScreen(c, which);
  return { on, style: on ? c.style : null, y: on ? (c.place?.[which] ?? null) : null };
}

/**
 * The words and stressed words a composition draws: captions need the words, the `stress` style
 * needs which are stressed, and the words behind the speaker need both.
 */
function drawn(c: Captions, which: "long" | "short", p: { words: unknown; stress: unknown }) {
  const read = captionsRead(c, which);
  const behind = !!c.behind;
  return {
    captions: { ...read, behind },
    words: read.on || behind ? p.words : null,
    stress: behind || (read.on && read.style === "stress") ? p.stress : null,
  };
}

/** The Long composition: the words always, so the subtitle file (`longSrt`) is redone with them. */
const longKey = (p: LongProps) => {
  const { captions, words, stress, ...rest } = p;
  return { ...rest, ...drawn(captions, "long", { words, stress }), words };
};

/** Shorts and the cropped formats caption alike (`onScreen(..., "short")`). */
const reelKey = <P extends { captions: Captions; words: unknown; stress: unknown }>(p: P) => {
  const { captions, words, stress, ...rest } = p;
  return { ...rest, ...drawn(captions, "short", { words, stress }) };
};

/** A Short's composition never draws `title` (its opening card, `card`, does). */
const shortKey = (p: ShortProps) => {
  const { title: _t, ...rest } = p;
  return reelKey(rest);
};

/** What every output is cut from: which stretches of which recordings. */
function cutKey(e: VideoEdit) {
  const { main, cam, camBox } = e.tracks;
  return {
    keep: keepSegments(e.cuts, main.durationS, FPS),
    main: [main.path, main.durationS, main.width, main.height, main.fps],
    cam: cam ? [cam.path, cam.durationS, cam.width, cam.height, cam.fps, cam.offsetS] : null,
    camBox: camBox ?? null,
  };
}

/** The cut pass's hash: when it is unchanged the cut files on disk are still the cut. */
export const cutHash = (e: VideoEdit): string => digest({ v: RENDER_VERSION, cut: cutKey(e) });
/** Where the cut pass's hash is kept in `files`. */
export const CUT_HASH = hashKey("cut");

/**
 * The hash of every output the edit can render, by the name its file goes by. Empty before the
 * first cut pass (nothing to draw from yet).
 */
export function outputHashes(e: VideoEdit): Record<string, string> {
  if (!e.files.cutMain) return {};
  const cut = cutKey(e);
  const out: Record<string, string> = {};
  const put = (name: string, comp: string, key: unknown) => {
    out[name] = digest({ v: RENDER_VERSION, comp, cut, key });
  };
  put("long", "Long", longKey(longProps(e)));
  for (const f of CROPPED) put(f, "Framed", reelKey(framedProps(e, f)));
  for (const i of e.shorts.keys()) put(`short-${i + 1}`, "Short", shortKey(shortProps(e, i + 1)));
  for (const p of thumbnailProps(e) ?? []) put(`thumb-${p.variant}`, "Thumbnail", p);
  return out;
}

/**
 * The hash of the cover frame cut out of a rendered format: that file's hash and the cover's
 * moment. Moving the cover re-cuts the frame from the file already there, no new render.
 */
export const coverHash = (output: string | undefined, at: number): string =>
  digest({ output: output ?? null, at });

/** Is this output one a render makes for the edit unless told otherwise? */
export const isWanted = (e: Pick<VideoEdit, "formats">, output: string): boolean =>
  output === "long" || (CROPPED as readonly string[]).includes(output)
    ? e.formats.includes(output as Format)
    : true;

/**
 * The outputs a render made that the edit has since changed, by name; null when that can't be
 * told (no render stored hashes yet, or nothing is cut).
 */
export function changedSince(e: VideoEdit): string[] | null {
  if (!hasHashes(e.files)) return null;
  const now = outputHashes(e);
  if (!Object.keys(now).length) return null;
  return Object.entries(now)
    .filter(([name, h]) => isWanted(e, name) && !!e.files[name] && e.files[hashKey(name)] !== h)
    .map(([name]) => name);
}

/** The hashes to store beside the files of `names`. */
export const hashFiles = (hashes: Record<string, string>, names: Iterable<string>) =>
  Object.fromEntries(
    [...names].flatMap((n) => (hashes[n] ? [[hashKey(n), hashes[n] as string] as const] : [])),
  );

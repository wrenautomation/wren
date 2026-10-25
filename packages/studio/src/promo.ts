/**
 * A promo (designs/2026-10-11-promo-video.md): a product video made from a script, no camera and
 * no voice. Kinetic lines, notification toasts, the product on screen with the camera moving over
 * it, numbers counting up, an end card. Claude Code writes the script; `wren video promo`
 * captures any page the script names and renders `Promo`. Plain data and math here, so the
 * composition and its tests share one clock.
 */
import { DEFAULT_LOOK, type Look } from "@wren/video";
import { z } from "zod";
import { autoCamera, type CameraKey, clip } from "./camera.js";
import { type CursorTrack, cursorTrack } from "./cursor.js";
import {
  clamp,
  ENTRANCES,
  type Entrance,
  LENS_MOVES,
  PROMO_FPS,
  SWAP_BEATS,
  TAGLINE_S,
  TYPE_CPS,
  toastAt,
} from "./promo-clock.js";
import {
  type AudioProps,
  BED_ID,
  BED_LUFS,
  dbToGain,
  FX_BED_LUFS,
  gapOf,
  placeEffects,
  type Role,
  soundFile,
  spaced,
} from "./sounds.js";
import { besideAt, eventsIn, paneOf, paneSeconds, type Take, type TakePane } from "./take.js";

export * from "./promo-clock.js";

/** The render's frame rates: 30, or 60 for a take (the cursor and the camera move every frame). */
const PROMO_RATES = [30, 60] as const;
const PROMO_SIZE = { wide: [1920, 1080], tall: [1080, 1920] } as const;

const unit = z.number().min(0).max(1);
const seconds = z
  .number()
  .min(0.5)
  .max(30)
  .optional()
  .describe("How long it holds; set by length when left out");
/** How it comes in (`entranceAt`): rise, a camera pull-back, a matte wipe, or a flow cut. */
const enter = z.enum(ENTRANCES).default("rise");
/**
 * The plane in 3D for the whole shot (`lensAt`), lit: a spotlight on the focus point and a
 * vignette (`light`), and the page soft away from it (`focus`). A take's focus point is its
 * camera's; the lens owns the zoom, so the camera's own zoom stays out.
 */
const lens = z
  .object({
    move: z.enum(LENS_MOVES),
    light: z.boolean().default(true),
    focus: z.boolean().default(true),
  })
  .optional();
/** A camera key as a screen scene takes it: `at` is the scene's progress, 0 to 1. */
const move = z.object({ at: unit, x: unit, y: unit, zoom: z.number().min(1).max(4) });

const TEXT = z.object({
  kind: z.literal("text"),
  /** One to three lines; words appear one by one. */
  lines: z.array(z.string().min(1).max(80)).min(1).max(3),
  /** Words drawn in the accent color, as written. */
  accent: z.array(z.string()).max(6).default([]),
  /** `stack`: lines under each other. `scatter`: words spread over a quiet frame (`scatterAt`). */
  layout: z.enum(["stack", "scatter"]).default("stack"),
  /**
   * `kinetic`: big, word by word. `card`: small and centered, the lines blur in. `caps`: monospace
   * caps typed with a block caret.
   */
  style: z.enum(["kinetic", "card", "caps"]).default("kinetic"),
  /** On a card or caps: the last word swaps in place to each of these in turn. */
  swap: z.array(z.string().min(1).max(30)).max(12).default([]),
  seconds,
  enter,
});
const TOASTS = z.object({
  kind: z.literal("toasts"),
  /** A line over the stack. */
  title: z.string().max(80).optional(),
  items: z
    .array(
      z.object({
        title: z.string().min(1).max(40),
        body: z.string().max(80).optional(),
        when: z.string().max(12).default("now"),
      }),
    )
    .min(1)
    .max(6),
  seconds,
  enter,
});
const SCREEN = z
  .object({
    kind: z.literal("screen"),
    /** A file beside the script, or a page `wren video promo` captures to one. */
    image: z.string().min(1).optional(),
    url: z.url().optional(),
    caption: z.string().max(90).optional(),
    /**
     * Where the camera looks, by the scene's progress `at` (0 to 1): the point (`x`, `y`, as a
     * share of the image) at the middle, and the zoom (1 is the whole image).
     */
    moves: z.array(move).max(8).default([]),
    /** A box drawn around one thing, as shares of the image, from `from` on. */
    highlight: z.object({ x: unit, y: unit, w: unit, h: unit, from: unit.default(0.3) }).optional(),
    lens,
    seconds,
    enter,
  })
  .refine((s) => !!s.image !== !!s.url, "a screen takes an image or a url, one of them");
/**
 * A shot from a filmed take (`autobrowse film`): a pane's video from `from` to `to`, with the
 * cursor, the camera and the sounds drawn from its log.
 */
const TAKE = z
  .object({
    kind: z.literal("take"),
    /** The take's folder, beside the script. */
    take: z.string().min(1),
    /** Which pane; unset: the first web pane. */
    pane: z.string().min(1).optional(),
    /** Seconds on the pane; `to` unset: its end. */
    from: z.number().min(0).default(0),
    to: z.number().positive().optional(),
    caption: z.string().max(90).optional(),
    /** `auto`: zooms that follow the acts (`autoCamera`); `none`: the whole page; or moves. */
    camera: z.union([z.enum(["auto", "none"]), z.array(move).max(8)]).default("auto"),
    /** How close `auto` goes. */
    zoom: z.number().min(1).max(4).default(1.8),
    /** A second pane beside it, on the same clock (the terminal by the browser). */
    beside: z.string().min(1).optional(),
    /** A terminal pane's window title. */
    title: z.string().max(40).default("Terminal"),
    /** The part of the main pane the window shows, px on the pane: a terminal's lines, large. */
    crop: z
      .object({
        x: z.number().min(0),
        y: z.number().min(0),
        w: z.number().positive(),
        h: z.number().positive(),
      })
      .optional(),
    /** Blocks over the page (px on the pane) from `from` to `to`, seconds of the shot: a token, an email. */
    mask: z
      .array(
        z.object({
          x: z.number().min(0),
          y: z.number().min(0),
          w: z.number().positive(),
          h: z.number().positive(),
          from: z.number().min(0).default(0),
          to: z.number().positive().optional(),
        }),
      )
      .max(8)
      .default([]),
    lens,
    enter,
  })
  .refine((s) => s.to === undefined || s.to > s.from, "a take's to is after its from");
const STAT = z.object({
  kind: z.literal("stat"),
  title: z.string().max(80).optional(),
  items: z
    .array(
      z.object({
        value: z.number(),
        label: z.string().min(1).max(40),
        prefix: z.string().max(4).default(""),
        suffix: z.string().max(6).default(""),
        decimals: z.number().int().min(0).max(2).default(0),
      }),
    )
    .min(1)
    .max(4),
  seconds,
  enter,
});
const END = z.object({
  kind: z.literal("end"),
  title: z.string().min(1).max(60),
  sub: z.string().max(90).optional(),
  url: z.string().max(60).optional(),
  /** A line on its own before the title. */
  tagline: z.string().max(60).optional(),
  /** `pill`: the accent pill grows, then turns into the title. */
  mark: z.enum(["plain", "pill"]).default("plain"),
  seconds,
  enter,
});

const promoScene = z.discriminatedUnion("kind", [TEXT, TOASTS, SCREEN, TAKE, STAT, END]);
export type PromoScene = z.infer<typeof promoScene>;

export const promoScript = z
  .object({
    format: z.enum(["wide", "tall"]).default("wide"),
    /** The base look under `look`: Wren's light one, or dark (`DARK_LOOK`), as craft films are. */
    theme: z.enum(["light", "dark"]).default("light"),
    /** Frames a second; unset: 60 when a scene is a take, else 30. */
    fps: z.union(PROMO_RATES.map((r) => z.literal(r))).optional(),
    /** Colors and font over Wren's. */
    look: z
      .object({
        background: z.string(),
        foreground: z.string(),
        muted: z.string(),
        accent: z.string(),
        font: z.string(),
      })
      .partial()
      .default({}),
    /** The bed: a kit id (`bed-calm`) or a music file beside the script, his own; none: silent. */
    music: z.string().optional(),
    /** Kit sounds on the scenes (`PROMO_SOUNDS`); false: the music alone. */
    sounds: z.boolean().default(true),
    /**
     * A flow edit's finish. `glow`: accent words and the highlight bloom. `dither`: the whole
     * frame in an ordered dither, a few tones a channel, like an old screen.
     */
    finish: z
      .object({ glow: z.boolean().default(false), dither: z.boolean().default(false) })
      .default({ glow: false, dither: false }),
    scenes: z.array(promoScene).min(1).max(30),
  })
  .strict();
export type PromoScript = z.infer<typeof promoScript>;

const words = (s: string) => s.split(/\s+/).filter(Boolean);

/** The dark base look: near black, soft white, Figtree. */
const DARK_LOOK: Look = {
  background: "#0b0c10",
  foreground: "#ececee",
  muted: "#8a8b93",
  accent: "#3d7bff",
  font: '"Figtree", ui-sans-serif, system-ui, sans-serif',
};

/** A scene's seconds: as set, else by how much there is to read. */
export function secondsOf(s: PromoScene): number {
  if (s.kind === "take") return (s.to ?? s.from + 4) - s.from;
  if (s.seconds) return s.seconds;
  switch (s.kind) {
    case "text": {
      const swaps = (s.swap.length * SWAP_BEATS) / PROMO_FPS;
      if (s.style === "caps") return s.lines.join(" ").length / TYPE_CPS + 1.2 + swaps;
      if (s.style === "card") return 1.6 + swaps;
      return clamp(1.4 + words(s.lines.join(" ")).length * 0.3, 2, 6);
    }
    case "toasts":
      return 1.2 + s.items.length * 0.55 + 1.4;
    case "screen":
      return 4 + (s.caption ? 0.5 : 0);
    case "stat":
      return 3.2;
    case "end":
      return (s.tagline ? TAGLINE_S : 0) + (s.mark === "pill" ? 4 : 3);
  }
}

/**
 * A pane as a shot plays it: its video, its page size, the part the window shows (`crop`, px: x, y,
 * w, h; the whole page when not cropped), and the second it starts at (below 0: not open yet).
 */
export interface ShotPane {
  video: string;
  kind: TakePane["kind"];
  size: [number, number];
  crop: [number, number, number, number];
  at: number;
  /** The window bar's text from each second of the shot on: a page's address, a terminal's title. */
  bar: [number, string][];
}
/**
 * A take scene's shot, all in seconds of the shot: the camera keys (`cameraAt`), the cursor's
 * track (none on a terminal) and the pane beside it.
 */
export interface TakeShot {
  pane: ShotPane;
  beside: ShotPane | null;
  moves: CameraKey[];
  cursor: CursorTrack | null;
  sounds: [number, Role, number?][];
}

/**
 * A scene on the timeline: its first beat and how many (`PROMO_FPS`). A screen's `image` is set by now, with
 * its pixel `size` when known (the box takes its shape, so marks land where the script says).
 * `next`: how the scene after it comes in, so a flow cut starts in this one.
 */
export type TimedScene = PromoScene & {
  from: number;
  frames: number;
  size?: [number, number];
  next?: Entrance;
  shot?: TakeShot;
};

/** Beats a scene lasts: its seconds on the promo's clock. */
const beatsOf = (s: PromoScene) => Math.round(secondsOf(s) * PROMO_FPS);

export type PromoProps = {
  /** The render's rate; scenes count beats (`PROMO_FPS`) whatever it is. */
  fps: number;
  /** Frames at `fps`. */
  durationInFrames: number;
  width: number;
  height: number;
  look: Look;
  audio: AudioProps;
  finish: { glow: boolean; dither: boolean };
  scenes: TimedScene[];
};

/**
 * A promo's kit sounds, by scene: on each cut a whoosh by its entrance (a big low whoosh for a
 * pull-back, a shutter for a flow's rush, none for a dip), a dark riser into the end card and one hit on it, a pop on
 * each toast and a ding as the numbers start. No voice to duck under.
 */
export const PROMO_SOUNDS = {
  rise: "whoosh.short",
  dip: null,
  wipe: "whoosh.short",
  "pull-back": "whoosh.long",
  flow: "snap",
  riser: "riser",
  end: "hit",
  toast: "pop",
  stat: "click.confirm",
} as const satisfies Record<string, Role | null>;

/** A take's sounds by what the log says (`TAKE_SOUNDS`); the zoom's whoosh sits under the clicks. */
export const TAKE_SOUNDS = {
  down: "click",
  key: "key",
  " ": "key.space",
  Enter: "key.return",
  zoom: "whoosh.short",
} as const satisfies Record<string, Role>;
const ZOOM_DB = -6;

/** A shot's sounds, `[seconds of the shot, id, gainDb?]`: clicks and keys of each pane it shows, a whoosh on each push in. */
function takeSounds(
  shown: readonly { events: readonly TakePane["events"][number][] }[],
  moves: readonly CameraKey[],
  seconds: number,
): [number, Role, number?][] {
  const by = new Map<Role, number[]>();
  const add = (role: Role, t: number) => {
    if (t >= 0 && t <= seconds) by.set(role, [...(by.get(role) ?? []), t]);
  };
  for (const { events } of shown)
    for (const e of events) {
      if (e.kind === "down") add(TAKE_SOUNDS.down, e.t);
      if (e.kind === "key")
        add(e.key === " " || e.key === "Enter" ? TAKE_SOUNDS[e.key] : TAKE_SOUNDS.key, e.t);
    }
  const out: [number, Role, number?][] = [...by].flatMap(([role, ts]) =>
    spaced(ts, gapOf(role)).map((t): [number, Role] => [t, role]),
  );
  for (const [i, m] of moves.entries()) {
    const next = moves[i + 1];
    if (m.zoom === 1 && next && next.zoom > 1 && m.at > 0)
      out.push([m.at, TAKE_SOUNDS.zoom, ZOOM_DB]);
  }
  return out.sort((a, b) => a[0] - b[0]);
}

/** The kit sounds on the promo's scenes: `[seconds, id, gainDb?]`, in order. */
function promoSounds(scenes: readonly TimedScene[]): [number, string, number?][] {
  const out: [number, string, number?][] = [];
  const at = (beat: number) => beat / PROMO_FPS;
  for (const [i, s] of scenes.entries()) {
    if (i > 0 && s.kind === "end")
      out.push([at(s.from), PROMO_SOUNDS.riser], [at(s.from), PROMO_SOUNDS.end]);
    else if (i > 0) {
      const cut = PROMO_SOUNDS[s.enter];
      if (cut) out.push([at(s.from), cut]);
    }
    if (s.kind === "toasts")
      for (const j of s.items.keys()) {
        const beat = s.from + toastAt(j, !!s.title);
        if (beat < s.from + s.frames) out.push([at(beat), PROMO_SOUNDS.toast]);
      }
    if (s.kind === "stat") out.push([at(s.from + 8), PROMO_SOUNDS.stat]);
    if (s.shot)
      for (const [t, id, db] of s.shot.sounds)
        out.push(db === undefined ? [at(s.from) + t, id] : [at(s.from) + t, id, db]);
  }
  return out.sort((a, b) => a[0] - b[0]);
}

/**
 * The promo's sounds and bed as the composition plays them. The music plays at
 * `FX_BED_LUFS.music`: a kit bed is at `BED_LUFS`; his own file is at `musicLufs`, measured.
 */
function promoAudio(
  music: string | undefined,
  sounds: [number, string, number?][],
  musicLufs: number | undefined,
  fps: number,
): AudioProps {
  const kit = music !== undefined && BED_ID.test(music);
  const lufs = kit ? BED_LUFS : musicLufs;
  return {
    sounds: placeEffects(sounds, { fps, bed: FX_BED_LUFS.music }),
    music:
      music === undefined
        ? null
        : {
            file: kit ? soundFile(music) : music,
            volume:
              lufs === undefined ? 1 : Math.round(dbToGain(FX_BED_LUFS.music - lufs) * 1000) / 1000,
            duck: [],
            duckDb: 0,
          },
  };
}

type TakeScene = Extract<PromoScene, { kind: "take" }>;
/** Seconds of log kept before a shot's cut: a run of acts under way carries its zoom and cursor in. */
const LEAD_S = 4;

/** A page's address as the bar shows it: no scheme, no lone slash. */
const address = (url: string) => url.replace(/^https?:\/\//, "").replace(/\/$/, "");

const shotPane = (
  take: Take,
  pane: TakePane,
  at: number,
  title: string,
  crop?: TakeScene["crop"],
): ShotPane => ({
  video: `${take.dir}/${pane.file}`,
  kind: pane.kind,
  size: pane.size,
  crop: crop ? [crop.x, crop.y, crop.w, crop.h] : [0, 0, pane.size[0], pane.size[1]],
  at,
  bar:
    pane.kind === "term"
      ? [[0, title]]
      : pane.events.flatMap((e): [number, string][] =>
          e.kind === "load" ? [[e.t / 1000 - at, address(e.url)]] : [],
        ),
});

/** A take scene's shot from its take; `to` must be set (`promoProps` sets it to the pane's end). */
function takeShot(s: TakeScene & { to: number }, take: Take): TakeShot {
  const pane = paneOf(take, s.pane);
  const seconds = s.to - s.from;
  const events = eventsIn(pane, s.from, s.to, LEAD_S);
  const camera =
    s.camera === "none"
      ? []
      : s.camera === "auto"
        ? autoCamera(events, pane.size, seconds, { zoom: s.zoom })
        : clip(
            s.camera.map((m) => ({ ...m, at: m.at * seconds })),
            seconds,
          );
  // The camera's points are shares of the page; a cropped window takes them as shares of the crop.
  const c = s.crop;
  const moves = c
    ? camera.map((m) => ({
        ...m,
        x: clamp((m.x * pane.size[0] - c.x) / c.w, 0, 1),
        y: clamp((m.y * pane.size[1] - c.y) / c.h, 0, 1),
      }))
    : camera;
  const other = s.beside ? paneOf(take, s.beside) : null;
  const at = other ? besideAt(pane, other, s.from) : 0;
  const shown = [{ events }, ...(other ? [{ events: eventsIn(other, at, at + seconds) }] : [])];
  return {
    pane: shotPane(take, pane, s.from, s.title, s.crop),
    beside: other ? shotPane(take, other, at, s.title) : null,
    moves,
    cursor: pane.kind === "web" ? cursorTrack(events) : null,
    // Under a lens the camera's zoom is not shown, so no whoosh on it.
    sounds: takeSounds(shown, s.lens ? [] : moves, seconds),
  };
}

/** A take scene with `to` set and checked against its pane. */
function takeTo(s: TakeScene, take: Take | undefined, n: number): TakeScene & { to: number } {
  if (!take) throw new Error(`scene ${n}: take ${s.take} is not read yet`);
  const pane = paneOf(take, s.pane);
  const length = paneSeconds(pane);
  const to = s.to ?? length;
  const c = s.crop;
  if (c && (c.x + c.w > pane.size[0] || c.y + c.h > pane.size[1]))
    throw new Error(`scene ${n}: the crop runs past the pane (${pane.size.join("x")})`);
  if (to > length + 0.05)
    throw new Error(`scene ${n}: to ${to}s is past the pane's end (${length.toFixed(2)}s)`);
  if (to <= s.from) throw new Error(`scene ${n}: from ${s.from}s is at or past the pane's end`);
  return { ...s, to: Math.min(to, length) };
}

/**
 * The script on the clock. Every screen must have its image by now (`wren video promo` captures
 * urls); `sizes`: each image's pixels, by file name; `musicLufs`: his own music file's loudness;
 * `takes`: each take scene's take, by its folder (`readTake`).
 */
export function promoProps(
  script: PromoScript,
  sizes: Record<string, [number, number]> = {},
  o: { musicLufs?: number; takes?: Record<string, Take> } = {},
): PromoProps {
  const [width, height] = PROMO_SIZE[script.format];
  const fps = script.fps ?? (script.scenes.some((s) => s.kind === "take") ? 60 : PROMO_FPS);
  let from = 0;
  const scenes = script.scenes.map((raw, i) => {
    if (raw.kind === "screen" && !raw.image) throw new Error(`scene ${i + 1}: no image yet`);
    const s = raw.kind === "take" ? takeTo(raw, o.takes?.[raw.take], i + 1) : raw;
    const frames = beatsOf(s);
    const size = s.kind === "screen" && s.image ? sizes[s.image] : undefined;
    const next = script.scenes[i + 1]?.enter;
    const t: TimedScene = {
      ...s,
      from,
      frames,
      ...(size ? { size } : {}),
      ...(next ? { next } : {}),
      ...(s.kind === "take" ? { shot: takeShot(s, o.takes?.[s.take] as Take) } : {}),
    };
    from += frames;
    return t;
  });
  return {
    fps,
    durationInFrames: Math.round((from * fps) / PROMO_FPS),
    width,
    height,
    look: {
      ...(script.theme === "dark" ? DARK_LOOK : DEFAULT_LOOK),
      ...Object.fromEntries(Object.entries(script.look).filter(([, v]) => v !== undefined)),
    },
    audio: promoAudio(script.music, script.sounds ? promoSounds(scenes) : [], o.musicLufs, fps),
    finish: script.finish,
    scenes,
  };
}

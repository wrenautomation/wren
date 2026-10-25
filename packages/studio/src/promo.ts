/**
 * A promo (designs/2026-10-11-promo-video.md): a product video made from a script, no camera and
 * no voice. Kinetic lines, notification toasts, the product on screen with the camera moving over
 * it, numbers counting up, an end card. Claude Code writes the script; `wren video promo`
 * captures any page the script names and renders `Promo`. Plain data and math here, so the
 * composition and its tests share one clock.
 */
import { DEFAULT_LOOK, type Look } from "@wren/video";
import { z } from "zod";
import { clamp, ENTRANCES, type Entrance, toastAt } from "./promo-clock.js";
import {
  type AudioProps,
  BED_ID,
  BED_LUFS,
  dbToGain,
  FX_BED_LUFS,
  placeEffects,
  type Role,
  soundFile,
} from "./sounds.js";

export * from "./promo-clock.js";

export const PROMO_FPS = 30;
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

const TEXT = z.object({
  kind: z.literal("text"),
  /** One to three lines; words appear one by one. */
  lines: z.array(z.string().min(1).max(80)).min(1).max(3),
  /** Words drawn in the accent color, as written. */
  accent: z.array(z.string()).max(6).default([]),
  /** `stack`: lines under each other. `scatter`: words spread over a quiet frame (`scatterAt`). */
  layout: z.enum(["stack", "scatter"]).default("stack"),
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
    moves: z
      .array(z.object({ at: unit, x: unit, y: unit, zoom: z.number().min(1).max(4) }))
      .max(8)
      .default([]),
    /** A box drawn around one thing, as shares of the image, from `from` on. */
    highlight: z.object({ x: unit, y: unit, w: unit, h: unit, from: unit.default(0.3) }).optional(),
    seconds,
    enter,
  })
  .refine((s) => !!s.image !== !!s.url, "a screen takes an image or a url, one of them");
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
  seconds,
  enter,
});

const promoScene = z.discriminatedUnion("kind", [TEXT, TOASTS, SCREEN, STAT, END]);
export type PromoScene = z.infer<typeof promoScene>;

export const promoScript = z
  .object({
    format: z.enum(["wide", "tall"]).default("wide"),
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

/** A scene's seconds: as set, else by how much there is to read. */
export function secondsOf(s: PromoScene): number {
  if (s.seconds) return s.seconds;
  switch (s.kind) {
    case "text":
      return clamp(1.4 + words(s.lines.join(" ")).length * 0.3, 2, 6);
    case "toasts":
      return 1.2 + s.items.length * 0.55 + 1.4;
    case "screen":
      return 4 + (s.caption ? 0.5 : 0);
    case "stat":
      return 3.2;
    case "end":
      return 3;
  }
}

/**
 * A scene on the timeline: its first frame and how many. A screen's `image` is set by now, with
 * its pixel `size` when known (the box takes its shape, so marks land where the script says).
 * `next`: how the scene after it comes in, so a flow cut starts in this one.
 */
export type TimedScene = PromoScene & {
  from: number;
  frames: number;
  size?: [number, number];
  next?: Entrance;
};

export type PromoProps = {
  fps: number;
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
 * pull-back, a shutter for a flow's rush), a dark riser into the end card and one hit on it, a pop on
 * each toast and a ding as the numbers start. No voice to duck under.
 */
export const PROMO_SOUNDS = {
  rise: "whoosh.short",
  wipe: "whoosh.short",
  "pull-back": "whoosh.long",
  flow: "snap",
  riser: "riser",
  end: "hit",
  toast: "pop",
  stat: "click.confirm",
} as const satisfies Record<string, Role>;
/** The kit sounds on the promo's scenes: `[frame, id]`, in order. */
function promoSounds(scenes: readonly TimedScene[]): [number, string][] {
  const out: [number, string][] = [];
  for (const [i, s] of scenes.entries()) {
    if (i > 0 && s.kind === "end")
      out.push([s.from, PROMO_SOUNDS.riser], [s.from, PROMO_SOUNDS.end]);
    else if (i > 0) out.push([s.from, PROMO_SOUNDS[s.enter]]);
    if (s.kind === "toasts")
      for (const j of s.items.keys()) {
        const at = s.from + toastAt(j, !!s.title);
        if (at < s.from + s.frames) out.push([at, PROMO_SOUNDS.toast]);
      }
    if (s.kind === "stat") out.push([s.from + 8, PROMO_SOUNDS.stat]);
  }
  return out.sort((a, b) => a[0] - b[0]);
}

/**
 * The promo's sounds and bed as the composition plays them. The music plays at
 * `FX_BED_LUFS.music`: a kit bed is at `BED_LUFS`; his own file is at `musicLufs`, measured.
 */
function promoAudio(
  music: string | undefined,
  sounds: [number, string][],
  musicLufs: number | undefined,
): AudioProps {
  const kit = music !== undefined && BED_ID.test(music);
  const lufs = kit ? BED_LUFS : musicLufs;
  return {
    sounds: placeEffects(
      sounds.map(([from, id]) => [from / PROMO_FPS, id] as const),
      { fps: PROMO_FPS, bed: FX_BED_LUFS.music },
    ),
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

/**
 * The script on the clock. Every screen must have its image by now (`wren video promo` captures
 * urls); `sizes`: each image's pixels, by file name; `musicLufs`: his own music file's loudness.
 */
export function promoProps(
  script: PromoScript,
  sizes: Record<string, [number, number]> = {},
  o: { musicLufs?: number } = {},
): PromoProps {
  const [width, height] = PROMO_SIZE[script.format];
  let from = 0;
  const scenes = script.scenes.map((s, i) => {
    if (s.kind === "screen" && !s.image) throw new Error(`scene ${i + 1}: no image yet`);
    const frames = Math.round(secondsOf(s) * PROMO_FPS);
    const size = s.kind === "screen" && s.image ? sizes[s.image] : undefined;
    const next = script.scenes[i + 1]?.enter;
    const t: TimedScene = {
      ...s,
      from,
      frames,
      ...(size ? { size } : {}),
      ...(next ? { next } : {}),
    };
    from += frames;
    return t;
  });
  return {
    fps: PROMO_FPS,
    durationInFrames: from,
    width,
    height,
    look: {
      ...DEFAULT_LOOK,
      ...Object.fromEntries(Object.entries(script.look).filter(([, v]) => v !== undefined)),
    },
    audio: promoAudio(script.music, script.sounds ? promoSounds(scenes) : [], o.musicLufs),
    finish: script.finish,
    scenes,
  };
}

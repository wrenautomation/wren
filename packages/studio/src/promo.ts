/**
 * A promo (designs/2026-10-11-promo-video.md): a product video made from a script, no camera and
 * no voice. Kinetic lines, notification toasts, the product on screen with the camera moving over
 * it, numbers counting up, an end card. Claude Code writes the script; `wren video promo`
 * captures any page the script names and renders `Promo`. Plain data and math here, so the
 * composition and its tests share one clock.
 */
import { DEFAULT_LOOK, type Look } from "@wren/video";
import { z } from "zod";
import { clamp } from "./promo-clock.js";

export * from "./promo-clock.js";

export const PROMO_FPS = 30;
export const PROMO_SIZE = { wide: [1920, 1080], tall: [1080, 1920] } as const;
export type PromoFormat = keyof typeof PROMO_SIZE;

const unit = z.number().min(0).max(1);
const seconds = z
  .number()
  .min(0.5)
  .max(30)
  .optional()
  .describe("How long it holds; set by length when left out");

const TEXT = z.object({
  kind: z.literal("text"),
  /** One to three lines; words appear one by one. */
  lines: z.array(z.string().min(1).max(80)).min(1).max(3),
  /** Words drawn in the accent color, as written. */
  accent: z.array(z.string()).max(6).default([]),
  seconds,
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
});
const END = z.object({
  kind: z.literal("end"),
  title: z.string().min(1).max(60),
  sub: z.string().max(90).optional(),
  url: z.string().max(60).optional(),
  seconds,
});

export const promoScene = z.discriminatedUnion("kind", [TEXT, TOASTS, SCREEN, STAT, END]);
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
    /** A music file beside the script, his own; none: silent. */
    music: z.string().optional(),
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
 */
export type TimedScene = PromoScene & { from: number; frames: number; size?: [number, number] };

export type PromoProps = {
  fps: number;
  durationInFrames: number;
  width: number;
  height: number;
  look: Look;
  music: string | null;
  scenes: TimedScene[];
};

/**
 * The script on the clock. Every screen must have its image by now (`wren video promo` captures
 * urls); `sizes`: each image's pixels, by file name.
 */
export function promoProps(
  script: PromoScript,
  sizes: Record<string, [number, number]> = {},
): PromoProps {
  const [width, height] = PROMO_SIZE[script.format];
  let from = 0;
  const scenes = script.scenes.map((s, i) => {
    if (s.kind === "screen" && !s.image) throw new Error(`scene ${i + 1}: no image yet`);
    const frames = Math.round(secondsOf(s) * PROMO_FPS);
    const size = s.kind === "screen" && s.image ? sizes[s.image] : undefined;
    const t: TimedScene = size ? { ...s, from, frames, size } : { ...s, from, frames };
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
    music: script.music ?? null,
    scenes,
  };
}

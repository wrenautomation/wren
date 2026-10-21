/**
 * Platform and channel marks, and the kit's 8 tints (designs/2026-10-07-visual-cues.md). Brand
 * paths and colors come from the `simple-icons` package (CC0), so no third-party image loads.
 * Our own channels (email, text, call, DM, web) are drawn plainly in the text's gray.
 */
import { type Mark, markOf, markOfHost } from "@wren/core/records";
import { cn } from "cn";
import {
  type SimpleIcon,
  siApplepodcasts,
  siDiscord,
  siFacebook,
  siGoogle,
  siInstagram,
  siMeta,
  siReddit,
  siThreads,
  siTiktok,
  siWhatsapp,
  siX,
  siYoutube,
} from "simple-icons";

interface Brand {
  /** One 24-unit path. */
  d: string;
  /** The brand color; null for black brands, which draw in the text's color. */
  color: string | null;
}

const brand = (i: SimpleIcon): Brand => ({
  d: i.path,
  color: i.hex === "000000" ? null : `#${i.hex}`,
});

const BRANDS: Partial<Record<Mark, Brand>> = {
  youtube: brand(siYoutube),
  // Simple Icons dropped LinkedIn at the brand's request. Its last CC0 path stays here.
  linkedin: {
    color: "#0A66C2",
    d: "M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z",
  },
  instagram: brand(siInstagram),
  threads: brand(siThreads),
  x: brand(siX),
  tiktok: brand(siTiktok),
  reddit: brand(siReddit),
  facebook: brand(siFacebook),
  meta: brand(siMeta),
  discord: brand(siDiscord),
  google: brand(siGoogle),
  whatsapp: brand(siWhatsapp),
  podcast: brand(siApplepodcasts),
};

/** Our own channels: plain line marks, 24 units, stroked in the text's gray. */
const OWN: Partial<Record<Mark, string>> = {
  // An envelope.
  email: "M3 5.5h18v13H3zM3.5 6l8.5 7 8.5-7",
  // A speech bubble with lines: a text.
  text: "M4 4.5h16v12H9l-5 4zM8 9h8M8 12.5h5",
  // A handset.
  call: "M6.6 3.5h3l1.5 4.2-2.1 1.4a11 11 0 0 0 5.9 5.9l1.4-2.1 4.2 1.5v3a2 2 0 0 1-2.2 2A16.5 16.5 0 0 1 4.6 5.7a2 2 0 0 1 2-2.2z",
  // A paper plane: a direct message.
  dm: "M21 3 10.5 13.5M21 3l-6.5 18-4-7.5L3 9.5z",
  // A globe: a web page.
  web: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM3 12h18M12 3c2.5 2.6 3.7 5.6 3.7 9s-1.2 6.4-3.7 9c-2.5-2.6-3.7-5.6-3.7-9S9.5 5.6 12 3z",
};

const NAMES: Record<Mark, string> = {
  youtube: "YouTube",
  linkedin: "LinkedIn",
  instagram: "Instagram",
  threads: "Threads",
  x: "X",
  tiktok: "TikTok",
  reddit: "Reddit",
  facebook: "Facebook",
  meta: "Meta",
  discord: "Discord",
  google: "Google",
  whatsapp: "WhatsApp",
  podcast: "Podcast",
  email: "Email",
  text: "Text",
  call: "Call",
  dm: "DM",
  web: "Web",
};

/**
 * A platform's or channel's mark, 14px by default. Brand color unless `mono`, which draws it in
 * the text's color for dense spots. A key we have no mark for draws nothing.
 */
export function PlatformMark({
  mark,
  size = 14,
  mono = false,
  label,
  className,
}: {
  /** A mark, or a key that names one ("sms" is text). */
  mark: string;
  size?: number;
  mono?: boolean;
  /** Read aloud in place of being hidden: when the mark stands alone, without its name. */
  label?: string;
  className?: string;
}) {
  const m = markOf(mark);
  if (!m) return null;
  const brand = BRANDS[m];
  const own = OWN[m];
  const box = cn("inline-block shrink-0 align-[-0.125em]", className);
  if (brand)
    return (
      <svg
        role="img"
        aria-label={label ?? NAMES[m]}
        aria-hidden={label ? undefined : true}
        viewBox="0 0 24 24"
        width={size}
        height={size}
        className={box}
        data-mark={m}
        style={{ color: mono || !brand.color ? undefined : brand.color }}
        fill="currentColor"
      >
        <path d={brand.d} />
      </svg>
    );
  return (
    <svg
      role="img"
      aria-label={label ?? NAMES[m]}
      aria-hidden={label ? undefined : true}
      viewBox="0 0 24 24"
      width={size}
      height={size}
      className={cn(box, !mono && "text-(--ui-ink-2)")}
      data-mark={m}
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d={own} />
    </svg>
  );
}

/** A filled globe: a plain site's glyph on a tile, where a stroked one would vanish. */
const SITE_GLOBE =
  "M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm6.9 6h-2.9a15.7 15.7 0 0 0-1.4-3.6A8 8 0 0 1 18.9 8zM12 4c.8 1.2 1.5 2.5 1.9 4h-3.8c.4-1.5 1.1-2.8 1.9-4zM4.3 14a8 8 0 0 1 0-4h3.4a16.5 16.5 0 0 0 0 4H4.3zm.8 2h2.9c.3 1.3.8 2.5 1.4 3.6A8 8 0 0 1 5.1 16zM8 8H5.1a8 8 0 0 1 4.3-3.6C8.8 5.5 8.3 6.7 8 8zm4 12c-.8-1.2-1.5-2.5-1.9-4h3.8c-.4 1.5-1.1 2.8-1.9 4zm2.3-6H9.7a14.7 14.7 0 0 1 0-4h4.6a14.7 14.7 0 0 1 0 4zm.3 5.6c.6-1.1 1.1-2.3 1.4-3.6h2.9a8 8 0 0 1-4.3 3.6zm1.7-5.6a16.5 16.5 0 0 0 0-4h3.4a8 8 0 0 1 0 4h-3.4z";
/** The tile of a black brand, and of a plain site or our own channel. */
const BLACK_TILE = "#000000";
const PLAIN_TILE = "#5f6b7a";

/**
 * A platform's mark as a 16px tile: the white glyph on its brand color. A key or a host
 * ("reddit.com", "youtube"); any other site gets a globe. Brand colors stay in every look, so
 * the glyph is always white. Steps' cards wear it.
 */
export function PlatformTile({ mark, className }: { mark: string; className?: string }) {
  const m = markOf(mark) ?? markOfHost(mark);
  const b = m ? BRANDS[m] : undefined;
  const own = m && m !== "web" ? OWN[m] : undefined;
  return (
    <span
      aria-hidden="true"
      data-mark={m ?? "web"}
      className={cn("grid size-4 flex-none place-items-center rounded-[4px]", className)}
      style={{ background: b ? (b.color ?? BLACK_TILE) : PLAIN_TILE }}
    >
      <svg viewBox="0 0 24 24" width={10} height={10} aria-hidden="true">
        {own && !b ? (
          <path
            d={own}
            fill="none"
            stroke="#fff"
            strokeWidth={2.4}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ) : (
          <path d={b?.d ?? SITE_GLOBE} fill="#fff" />
        )}
      </svg>
    </span>
  );
}

/** A mark's name as people say it: "LinkedIn". */
export const markName = (mark: Mark) => NAMES[mark];

/** A site's mark, from its host or address: "www.reddit.com/r/x" is Reddit. */
export const hostMark = (site: string) => markOfHost(site);

/** The kit's 8 tints, in order (`--ui-cue-1` to `--ui-cue-8` in tailwind.css). */
const CUES = [
  "var(--ui-cue-1)",
  "var(--ui-cue-2)",
  "var(--ui-cue-3)",
  "var(--ui-cue-4)",
  "var(--ui-cue-5)",
  "var(--ui-cue-6)",
  "var(--ui-cue-7)",
  "var(--ui-cue-8)",
] as const;
/** A tint's color: 0 to 7, wrapping. */
export const tintColor = (tint: number) => CUES[((tint % 8) + 8) % 8] ?? CUES[0];

/** A kind of thing's tint, 0 to 7, as a small square swatch. */
export function TintSwatch({ tint, className }: { tint: number; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn("inline-block size-2 shrink-0", className)}
      style={{ background: tintColor(tint) }}
    />
  );
}

/** The soft wash of a tint, for a group's heading. */
export const tintWash = (tint: number) => `color-mix(in srgb, ${tintColor(tint)} 10%, transparent)`;

/** A lane's colour, 0 to 7 (`--ui-line-N`, the Map's lines); -1 is ink-3, the grey of no lane. */
export const lineColor = (line: number) =>
  line < 0 ? "var(--ui-ink-3)" : `var(--ui-line-${((line % 8) + 8) % 8})`;

/** A stage's mark: an 8px leaf square in its lane's colour, before the stage's label. */
export function StageSquare({ line, className }: { line: number; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn("inline-block size-2 shrink-0 rounded-[1px_3px]", className)}
      style={{ background: lineColor(line) }}
    />
  );
}

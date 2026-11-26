/**
 * A look for the kit, as data. Each key is a kit token without its `--ui-` prefix, the same name
 * a stylesheet uses; leave one out and it keeps Wren's. A client's brand is one of these, stored
 * with the client, not a fork of the kit.
 */
import { useLayoutEffect } from "react";
import { brandTheme, readBrand } from "./palette-brand.js";

/** Every token tailwind.css declares. The first group is what a theme usually sets; the rest follow it. */
export const TOKENS = [
  "scheme",
  "canvas",
  "paper",
  "ink",
  "ink-2",
  "ink-3",
  "accent",
  "on-accent",
  "good",
  "good-ink",
  "bad",
  "needs",
  "warn",
  "warn-ink",
  "shade",
  "font",
  "font-display",
  "numeric",
  "display-weight",
  "display-squeeze",
  "label-case",
  "label-tracking",
  "button-case",
  "button-tracking",
  "button-weight",
  "radius",
  "leaf-panel",
  "leaf-button",
  "leaf-chip",
  "leaf-nav",
  "leaf-sheet",
  "leaf-box",
  "leaf-seg",
  "leaf-bar",
  "leaf-line",
  "sweep",
  "frame",
  "main-width",
  "ease",
  "spring",
  // The map's line colours, one per offer (the metro reads them by name).
  "line-0",
  "line-1",
  "line-2",
  "line-3",
  "line-4",
  "line-5",
  "line-6",
  "line-7",
  "line-out",
  // Showcase only: image layers behind the window (gradients, never a fetch) and film grain.
  "backdrop",
  "grain",
  "lift",
  // Terminal block: dark in both looks.
  "term",
  "term-ink",
  "term-dim",
  "term-prompt",
  "term-bad",
  // Made from the ones above by default.
  "tile",
  "window",
  "window-blur",
  "wash",
  "band",
  "on-ink",
  "hair",
  "edge",
  "fill",
  "hover",
  "glass",
  "primary",
  "active",
  "link",
  "focus",
  "live",
  "press-edge",
  "accent-wash",
  "accent-tint",
  "good-tint",
  "bad-tint",
  "warn-tint",
  "needs-tint",
  "scrim",
  "graph",
  "radius-panel",
  "radius-sheet",
  "rim",
  "raise",
  "float",
  "shadow",
  "ground",
  "chart-1",
  "chart-2",
  "chart-3",
  "chart-4",
  "chart-5",
  "cue-1",
  "cue-2",
  "cue-3",
  "cue-4",
  "cue-5",
  "cue-6",
  "cue-7",
  "cue-8",
] as const;

export type Token = (typeof TOKENS)[number];
export type Theme = Partial<Record<Token, string>>;

const KNOWN: ReadonlySet<string> = new Set(TOKENS);
/** The tokens CSS makes from the others: a brand drops a preset's, so they follow its colors. */
const DERIVED = TOKENS.slice(TOKENS.indexOf("tile"));

/** Lengths the kit does math on: a bare 0 there breaks calc(), so it becomes 0px. */
const LENGTHS: ReadonlySet<string> = new Set([
  "radius",
  "radius-panel",
  "radius-sheet",
  "frame",
  "main-width",
]);

/**
 * The set tokens as tailwind.css ships them (its first `:root`), so a preview can start clean
 * instead of from whatever look the page wears. A test keeps the two the same.
 */
export const BASE: Theme = {
  scheme: "light",
  canvas: "#f3f1ec",
  paper: "#fff",
  ink: "#0e0e0e",
  "ink-2": "#40403c",
  "ink-3": "#56564f",
  accent: "#6a5a93",
  "on-accent": "#faf7f2",
  good: "#17803d",
  "good-ink": "#136b33",
  bad: "#c31c15",
  needs: "#ad1457",
  warn: "#b7791f",
  "warn-ink": "#895911",
  shade: "#0e0e0e",
  font: '"Figtree Variable", ui-sans-serif, system-ui, sans-serif',
  "font-display": "var(--ui-font)",
  numeric: "tabular-nums",
  "display-weight": "500",
  "display-squeeze": "1",
  "label-case": "none",
  "label-tracking": "0",
  "button-case": "none",
  "button-tracking": "0",
  "button-weight": "650",
  radius: "6px",
  "leaf-panel": "6px 24px",
  "leaf-button": "6px 10px",
  "leaf-chip": "3px 10px",
  "leaf-nav": "3px 12px",
  "leaf-sheet": "6px 18px",
  "leaf-box": "6px 14px",
  "leaf-seg": "3px 9px",
  "leaf-bar": "2px 8px",
  "leaf-line": "3px 8px",
  sweep: "1",
  frame: "10px",
  "main-width": "1240px",
  ease: "cubic-bezier(0.16, 1, 0.3, 1)",
  spring: "cubic-bezier(0.2, 0.9, 0.25, 1.12)",
  "line-0": "#6a5a93",
  "line-1": "#4f62c8",
  "line-2": "#c0567f",
  "line-3": "#2e8545",
  "line-4": "#1f8a8a",
  "line-5": "#2d6fc0",
  "line-6": "#6f8a2a",
  "line-7": "#87508a",
  "line-out": "#3d4785",
  backdrop: "none",
  grain: "0",
  lift: "0 0 #0000",
};

/** The line colours at night: lighter, each 3:1 or more on the night paper. */
export const NIGHT_LINES = {
  "line-0": "#a596d6",
  "line-1": "#9aa6f2",
  "line-2": "#e588ac",
  "line-3": "#5fc27c",
  "line-4": "#4fc4c4",
  "line-5": "#79aef0",
  "line-6": "#a9c25f",
  "line-7": "#d39ad6",
  "line-out": "#7f89bd",
} satisfies Theme;

/** The chart series at night (chart-1 is the accent): the same hues, each 3:1 or more on the night paper. */
export const NIGHT_CHARTS = {
  "chart-2": "#d95926",
  "chart-3": "#199e70",
  "chart-4": "#c98500",
  "chart-5": "#d55181",
} satisfies Theme;

/**
 * What a look gets when it wants capitals: the case and tracking Wren had before it went to
 * sentence case. A look that wants capitals spreads this first, then sets what differs.
 */
const CAPS = {
  "label-case": "uppercase",
  "label-tracking": "0.09em",
  "button-case": "uppercase",
  "button-tracking": "0.08em",
  "button-weight": "600",
} satisfies Theme;

/** Ready-made looks. `wren` is the kit as it ships. */
export const PRESETS = {
  wren: {},
  night: {
    scheme: "dark",
    canvas: "#0d0d0c",
    paper: "#171716",
    ink: "#f2f0ea",
    "ink-2": "#bfbdb6",
    "ink-3": "#a9a79f",
    accent: "#a596d6",
    "on-accent": "#15121f",
    "press-edge": "#7a69ad",
    good: "#4cc27a",
    "good-ink": "#6fd394",
    bad: "#ff6b5e",
    needs: "#ff80ab",
    warn: "#e0a64a",
    "warn-ink": "#ebbd6e",
    shade: "#000",
    scrim: "rgb(0 0 0 / 0.5)",
    raise: "0 0 0 1px var(--ui-hair), 0 6px 18px -8px rgb(0 0 0 / 0.6)",
    ...NIGHT_LINES,
    ...NIGHT_CHARTS,
  },
  soft: {
    canvas: "#eef1f6",
    paper: "#fff",
    ink: "#111827",
    "ink-2": "#3a4351",
    "ink-3": "#4b5563",
    accent: "#3552d4",
    "on-accent": "#fff",
    "warn-ink": "#86570e",
    shade: "#1e2a4a",
    font: 'ui-rounded, "SF Pro Rounded", system-ui, sans-serif',
    "display-weight": "600",
    "display-squeeze": "0.5",
    "button-weight": "600",
    radius: "12px",
  },
  editorial: {
    ...CAPS,
    canvas: "#f4f1ea",
    paper: "#fffdf8",
    ink: "#1a1a17",
    "ink-2": "#46453f",
    "ink-3": "#595850",
    accent: "#1d5a45",
    "on-accent": "#fffdf8",
    bad: "#bf1913",
    "warn-ink": "#86570e",
    "font-display": '"Iowan Old Style", "Palatino Linotype", Palatino, Georgia, serif',
    "display-weight": "400",
    "display-squeeze": "0.2",
    radius: "6px", // its own, so it keeps plain corners (themeVars)
    frame: "0",
  },
} satisfies Record<string, Theme>;

/**
 * Wren's own workspace, never a client's (Settings → Look; `setLook` refuses them for a client).
 * Fonts are ones a Mac has, each with a plain fallback; raycast's Schibsted Grotesk is self-hosted
 * (tailwind.css), fetched only when the look is on.
 */
export const SHOWCASE = {
  aurora: {
    ...CAPS,
    scheme: "dark",
    canvas: "#07080f",
    paper: "#0f111f",
    tile: "rgb(255 255 255 / 0.045)",
    ink: "#eef0ff",
    "ink-2": "#babed8",
    "ink-3": "#a3a8c7",
    accent: "#7cf5c8",
    "on-accent": "#04140e",
    good: "#5be38f",
    "good-ink": "#7eeaa8",
    bad: "#ff6b8b",
    needs: "#c49bff",
    warn: "#ffc46b",
    "warn-ink": "#ffd391",
    shade: "#000",
    scrim: "rgb(0 0 0 / 0.55)",
    font: '"Avenir Next", "Figtree Variable", system-ui, sans-serif',
    "display-weight": "600",
    "label-case": "none",
    "label-tracking": "0.02em",
    radius: "14px",
    frame: "14px",
    backdrop:
      "radial-gradient(55% 60% at 4% 4%, rgb(124 245 200 / 0.42), transparent 70%), radial-gradient(50% 65% at 96% 10%, rgb(155 107 255 / 0.5), transparent 70%), radial-gradient(70% 60% at 50% 115%, rgb(64 120 255 / 0.45), transparent 70%)",
    grain: "0.08",
    lift: "0 0 0 1px rgb(255 255 255 / 0.06), 0 30px 90px -20px rgb(124 245 200 / 0.35)",
  },
  synthwave: {
    ...CAPS,
    scheme: "dark",
    canvas: "#120726",
    paper: "#1a0b34",
    tile: "rgb(255 47 214 / 0.06)",
    ink: "#fbeaff",
    "ink-2": "#d8bceb",
    "ink-3": "#c9a8e2",
    accent: "#ff2fd6",
    "on-accent": "#1a0326",
    good: "#2ef2c2",
    "good-ink": "#6ff6d6",
    bad: "#ff4d6d",
    needs: "#5ee6ff",
    warn: "#ffb84d",
    "warn-ink": "#ffcc7a",
    shade: "#000",
    scrim: "rgb(8 0 20 / 0.6)",
    font: '"Avenir Next", "Figtree Variable", system-ui, sans-serif',
    "font-display": 'Futura, "Century Gothic", "Figtree Variable", sans-serif',
    "display-weight": "700",
    "button-tracking": "0.16em",
    radius: "4px",
    frame: "14px",
    backdrop:
      "radial-gradient(45% 38% at 50% 100%, rgb(255 140 60 / 0.38), transparent 70%), linear-gradient(180deg, transparent 50%, rgb(255 47 214 / 0.2)), repeating-linear-gradient(90deg, rgb(46 242 194 / 0.07) 0 1px, transparent 1px 56px)",
    grain: "0.06",
    lift: "0 0 0 1px rgb(255 47 214 / 0.5), 0 0 70px -8px rgb(255 47 214 / 0.55)",
  },
  terminal: {
    ...CAPS,
    scheme: "dark",
    canvas: "#020603",
    paper: "#050d07",
    tile: "#08140b",
    ink: "#b6ffc4",
    "ink-2": "#84dd99",
    "ink-3": "#6fcf86",
    accent: "#39ff6a",
    "on-accent": "#021006",
    good: "#39ff6a",
    "good-ink": "#7dff9c",
    bad: "#ff5f56",
    needs: "#ff79c6",
    warn: "#ffd75f",
    "warn-ink": "#ffe28a",
    shade: "#000",
    scrim: "rgb(0 0 0 / 0.6)",
    font: '"SF Mono", Menlo, ui-monospace, monospace',
    "font-display": '"SF Mono", Menlo, ui-monospace, monospace',
    "display-weight": "600",
    "display-squeeze": "0",
    "label-tracking": "0.14em",
    radius: "0px",
    backdrop:
      "repeating-linear-gradient(0deg, rgb(57 255 106 / 0.04) 0 1px, transparent 1px 3px), radial-gradient(80% 70% at 50% 40%, rgb(57 255 106 / 0.08), transparent 75%)",
    grain: "0.05",
    lift: "0 0 0 1px rgb(57 255 106 / 0.35), 0 0 40px -6px rgb(57 255 106 / 0.35)",
    frame: "14px",
  },
  gilded: {
    ...CAPS,
    scheme: "dark",
    canvas: "#0b0a08",
    paper: "#131210",
    tile: "#1b1916",
    ink: "#f3ead7",
    "ink-2": "#c8bda5",
    "ink-3": "#b5a98f",
    accent: "#d4af37",
    "on-accent": "#1a1405",
    good: "#8fbf7a",
    "good-ink": "#a9d394",
    bad: "#e0705a",
    needs: "#f48fb1",
    warn: "#e3b25a",
    "warn-ink": "#ecc57e",
    shade: "#000",
    scrim: "rgb(0 0 0 / 0.55)",
    "font-display": 'Didot, "Bodoni 72", "Iowan Old Style", Georgia, serif',
    "display-weight": "400",
    "display-squeeze": "0.1",
    "label-tracking": "0.22em",
    "button-tracking": "0.18em",
    radius: "6px", // its own, so it keeps plain corners (themeVars)
    backdrop:
      "radial-gradient(80% 60% at 50% -10%, rgb(212 175 55 / 0.16), transparent 70%), radial-gradient(40% 40% at 100% 100%, rgb(212 175 55 / 0.07), transparent 70%)",
    grain: "0.06",
    lift: "0 0 0 1px rgb(212 175 55 / 0.45), 0 24px 70px -30px rgb(212 175 55 / 0.4)",
    frame: "16px",
  },
  riso: {
    ...CAPS,
    radius: "6px", // its own, so it keeps plain corners (themeVars)
    canvas: "#f1ece1",
    paper: "#fbf8f1",
    tile: "#f3eee3",
    ink: "#1f1a3a",
    "ink-2": "#3f3960",
    "ink-3": "#4c4670",
    accent: "#b60075",
    "on-accent": "#fff8fb",
    good: "#00804f",
    bad: "#b71416",
    needs: "#1a4fa8",
    "warn-ink": "#83540b",
    shade: "#1f1a3a",
    "font-display": 'Futura, "Century Gothic", "Figtree Variable", sans-serif',
    "display-weight": "700",
    "display-squeeze": "0.4",
    backdrop:
      "radial-gradient(circle at 92% 0%, rgb(232 57 155 / 0.2), transparent 42%), radial-gradient(circle at 0% 100%, rgb(0 120 191 / 0.2), transparent 46%)",
    grain: "0.16",
    lift: "10px 10px 0 rgb(0 120 191 / 0.55)",
    frame: "18px",
  },
  brutal: {
    ...CAPS,
    canvas: "#ffe94d",
    paper: "#fff",
    tile: "#fff7c2",
    ink: "#000",
    "ink-2": "#262626",
    "ink-3": "#59595a",
    accent: "#0038ff",
    "on-accent": "#fff",
    "good-ink": "#0d6730",
    bad: "#b50d0b",
    needs: "#b0105a",
    "warn-ink": "#7e5005",
    hair: "#000",
    edge: "#000",
    shade: "#000",
    shadow: "6px 6px 0 #000",
    font: '"Helvetica Neue", Helvetica, Arial, sans-serif',
    "font-display": '"Arial Black", "Helvetica Neue", Arial, sans-serif',
    "display-weight": "900",
    "display-squeeze": "0.6",
    radius: "0px",
    frame: "18px",
    backdrop: "repeating-linear-gradient(45deg, rgb(0 0 0 / 0.07) 0 2px, transparent 2px 14px)",
    lift: "0 0 0 2px #000, 10px 10px 0 #000",
  },
  // Wren's own look from the style set's v116 (raycast-light-jira): a glass window on a pastel wall,
  // opaque white cards, ink buttons; colour in words. Purple only in the map's line-0.
  raycast: {
    canvas: "#e2e6ef",
    // the style set's veil (deepInk3 in its variants.mjs) over WALL.light: the wall at about half
    backdrop:
      "linear-gradient(rgb(244 246 250 / 0.55), rgb(244 246 250 / 0.55)), radial-gradient(70% 90% at 8% 8%, #adc6f4 0, transparent 62%), radial-gradient(60% 80% at 92% 18%, #f4c4d8 0, transparent 60%), radial-gradient(70% 70% at 58% 104%, #bfe3c6 0, transparent 62%)",
    window: "rgb(255 255 255 / 0.62)",
    "window-blur": "blur(36px) saturate(1.6)",
    paper: "#fff",
    tile: "#f5f6f8",
    ground: "transparent", // the sidebar is the bare glass, as v116's side panel
    ink: "#16161a",
    "ink-2": "#3a3a42",
    "ink-3": "color-mix(in srgb, #55555e 68%, #16161a)", // deepInk3, as v116
    accent: "#1d1d22",
    "on-accent": "#fff",
    "good-ink": "#0f5f2c", // the status inks, deepened for the cooler canvas
    bad: "#a8150f",
    "warn-ink": "#74490a",
    "press-edge": "#1d1d22", // flat, as v116: no lip under the ink button
    link: "#2450c4", // v116's #3a6df0, deepened to 4.5:1 on the grey washes
    focus: "#3a6df0",
    "chart-1": "#3a6df0", // chart-1 follows accent by default; ink is no series colour
    live: "#2450c4", // the run pulse and live wash; it follows accent, and an ink pulse reads dead
    hair: "rgb(0 0 0 / 0.08)",
    edge: "rgb(0 0 0 / 0.14)",
    fill: "rgb(0 0 0 / 0.05)",
    hover: "rgb(0 0 0 / 0.04)",
    shade: "#14182a",
    font: '"Schibsted Grotesk Variable", ui-sans-serif, system-ui, sans-serif',
    numeric: "normal", // its tnum sets , . : at figure width; number cells keep tabular-nums
    "display-weight": "600",
    "display-squeeze": "0.6",
    "button-weight": "600",
    radius: "8px", // its own, so it keeps plain corners (themeVars); panel 12, sheet 16
    frame: "12px",
    raise: "0 0 0 1px var(--ui-hair), 0 1px 2px rgb(0 0 0 / 0.06), 0 4px 14px rgb(20 30 60 / 0.06)",
    lift: "0 0 0 1px rgb(255 255 255 / 0.6), 0 10px 30px rgb(40 50 90 / 0.08)",
  },
  // v119 (raycast-jira): graphite glass on a dark radial. The dark twin of raycast.
  "raycast-night": {
    scheme: "dark",
    canvas: "#0c0c0e",
    backdrop:
      "linear-gradient(rgb(14 15 20 / 0.5), rgb(14 15 20 / 0.5)), radial-gradient(120% 90% at 30% 20%, #2e3034, #141416 55%, #0b0b0d)",
    window: "rgb(28 28 31 / 0.94)",
    "window-blur": "blur(36px) saturate(1.6)",
    paper: "#232326",
    tile: "#1a1a1d",
    ground: "rgb(0 0 0 / 0.16)",
    ink: "#f2f2f2",
    "ink-2": "#bdbdc2",
    "ink-3": "color-mix(in srgb, #9a9aa2 68%, #f2f2f2)",
    accent: "#f2f2f2",
    "on-accent": "#111",
    "press-edge": "#f2f2f2",
    link: "#8aa8ff",
    focus: "#fff",
    "chart-1": "#7f9dff",
    live: "#7f9dff",
    hair: "rgb(255 255 255 / 0.08)",
    edge: "rgb(255 255 255 / 0.14)",
    fill: "rgb(255 255 255 / 0.06)",
    hover: "rgb(255 255 255 / 0.05)",
    good: "#5fb37c",
    "good-ink": "#7cc796",
    bad: "#ff8a80",
    needs: "#ff80ab",
    warn: "#e09a4f",
    "warn-ink": "#ebb377",
    shade: "#000",
    scrim: "rgb(0 0 0 / 0.55)",
    font: '"Schibsted Grotesk Variable", ui-sans-serif, system-ui, sans-serif',
    numeric: "normal", // its tnum sets , . : at figure width; number cells keep tabular-nums
    "display-weight": "600",
    "display-squeeze": "0.6",
    "button-weight": "600",
    radius: "8px",
    frame: "12px",
    raise: "0 0 0 1px var(--ui-hair), 0 6px 18px -8px rgb(0 0 0 / 0.6)",
    lift: "0 0 0 1px rgb(255 255 255 / 0.1), 0 30px 80px -24px rgb(0 0 0 / 0.7)",
    ...NIGHT_LINES,
    ...NIGHT_CHARTS,
  },
} satisfies Record<string, Theme>;

/** One line each, for the gallery. */
export const LOOK_NOTES: Readonly<Record<PresetName | ShowcaseName, string>> = {
  wren: "Soft corners, warm paper, lavender.",
  night: "Wren after dark.",
  soft: "Rounded and blue.",
  editorial: "A serif and a deep green.",
  aurora: "Glass over a slow northern glow.",
  synthwave: "Neon on a grid at dusk.",
  terminal: "Phosphor green and scanlines.",
  gilded: "Black, gold leaf and a Didot.",
  riso: "Two-ink print, grain and all.",
  brutal: "Hard edges, yellow, no apologies.",
  raycast: "Glass on a pastel wall, ink buttons.",
  "raycast-night": "Graphite glass, white ink.",
};

export type PresetName = keyof typeof PRESETS;
export type ShowcaseName = keyof typeof SHOWCASE;
export const isShowcase = (name: unknown): name is ShowcaseName =>
  typeof name === "string" && Object.hasOwn(SHOWCASE, name);

/** Characters a token never needs, so stored data can't reach past its own value. */
const UNSAFE = /[;{}<>!\\]|@import/i;
/** The only CSS calls a token may make. None fetches anything: no url(), image-set(), src(). */
const CALLS: ReadonlySet<string> = new Set([
  "linear-gradient",
  "radial-gradient",
  "conic-gradient",
  "repeating-linear-gradient",
  "repeating-radial-gradient",
  "rgb",
  "rgba",
  "hsl",
  "hsla",
  "hwb",
  "lab",
  "lch",
  "oklab",
  "oklch",
  "color",
  "color-mix",
  "var",
  "calc",
  "min",
  "max",
  "clamp",
  "cubic-bezier",
  "steps",
]);
const safe = (v: string) =>
  !UNSAFE.test(v) &&
  [...v.matchAll(/([\w-]*)\s*\(/g)].every((m) => CALLS.has((m[1] ?? "").toLowerCase()));
/** "0", "0.0", ".0": a zero a stylesheet would take, but calc() won't. */
const ZERO = /^[+-]?(0+\.?0*|\.0+)$/;

/**
 * A theme from stored or typed-in data: a preset's name, or an object of tokens with an optional
 * `preset` to start from and an optional `brand` (palette-brand.ts) to color it. Typed tokens
 * beat the brand's, the brand's beat the preset's. What it can't use is dropped, never thrown on,
 * so a bad value costs one token, not the page.
 */
export function readTheme(raw: unknown): Theme {
  if (typeof raw === "string") return preset(raw);
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const input = raw as Record<string, unknown>;
  const theme: Theme = { ...preset(input.preset) };
  const brand = readBrand(input.brand);
  if (brand) {
    for (const t of DERIVED) delete theme[t];
    // The map's lines follow the brand's scheme: the night set on a dark brand, else Wren's.
    for (const k of Object.keys(NIGHT_LINES)) delete theme[k as Token];
    Object.assign(theme, brandTheme(brand).theme, brand.scheme === "dark" ? NIGHT_LINES : {});
  }
  for (const [key, value] of Object.entries(input)) {
    if (!KNOWN.has(key)) continue;
    const v = typeof value === "number" && Number.isFinite(value) ? String(value) : value;
    if (typeof v !== "string") continue;
    const clean = v.trim();
    if (clean && clean.length <= (key === "backdrop" ? 800 : 300) && safe(clean))
      theme[key as Token] = clean;
  }
  return theme;
}

function preset(name: unknown): Theme {
  if (isShowcase(name)) return { ...SHOWCASE[name] };
  return typeof name === "string" && Object.hasOwn(PRESETS, name)
    ? { ...PRESETS[name as PresetName] }
    : {};
}

/**
 * The Quiet Client Rule for corners: a look that sets its own `radius` keeps plain corners, so
 * its leaf tokens read that radius (a panel's derived one) and its sweep is off. Leaf corners
 * and the sweep are the Wren look and its night.
 */
const PLAIN: Theme = {
  "leaf-panel": "var(--ui-radius-panel)",
  "leaf-button": "var(--ui-radius)",
  "leaf-chip": "var(--ui-radius)",
  "leaf-nav": "var(--ui-radius)",
  "leaf-sheet": "var(--ui-radius-sheet)",
  "leaf-box": "var(--ui-radius-panel)",
  "leaf-seg": "var(--ui-radius)",
  "leaf-bar": "var(--ui-radius)",
  "leaf-line": "var(--ui-radius)",
  sweep: "0",
};

function varsOf(theme: Theme): Record<string, string> {
  const vars: Record<string, string> = {};
  for (const [key, value] of Object.entries(theme))
    if (KNOWN.has(key) && typeof value === "string" && value)
      vars[`--ui-${key}`] = LENGTHS.has(key) && ZERO.test(value.trim()) ? "0px" : value;
  return vars;
}

/**
 * The theme as CSS custom properties: {"--ui-accent": "#3552d4"}. A look that sets `radius` gets
 * plain corners and no sweep (the Quiet Client Rule).
 */
export function themeVars(theme: Theme): Record<string, string> {
  return varsOf(theme.radius ? { ...PLAIN, ...theme } : theme);
}

/**
 * A look whole, for a preview or a scan: `BASE` under the look. The Quiet Client Rule reads the
 * look's own `radius`, not `BASE`'s, so the Wren look and its night keep the leaf.
 */
export function wholeVars(look: Theme): Record<string, string> {
  return { ...varsOf(BASE), ...themeVars(look) };
}

/** Put `theme` on `el` (the page's root by default). Returns the undo. */
export function applyTheme(theme: Theme, el: HTMLElement = document.documentElement): () => void {
  const vars = Object.entries(themeVars(theme));
  const before = vars.map(([k]) => [k, el.style.getPropertyValue(k)] as const);
  for (const [k, v] of vars) el.style.setProperty(k, v);
  // `data-scheme`: for what CSS vars can't switch (an <img> src, e.g. the brand mark's dark file)
  const scheme = el.dataset.scheme;
  if (theme.scheme) el.dataset.scheme = String(theme.scheme);
  return () => {
    for (const [k, v] of before) {
      if (v) el.style.setProperty(k, v);
      else el.style.removeProperty(k);
    }
    if (scheme === undefined) delete el.dataset.scheme;
    else el.dataset.scheme = scheme;
  };
}

/**
 * Takes off the look a page put on before its app loaded (the portal's public/look.js), once the
 * real one is known, so none of its tokens outlive it.
 */
export function dropPreloadedLook(root: HTMLElement = document.documentElement) {
  const keys = root.dataset.lookPreload;
  if (keys === undefined) return;
  for (const k of keys.split(" ")) root.style.removeProperty(k);
  delete root.dataset.lookPreload;
  delete root.dataset.scheme;
}

/**
 * Keeps `theme` on the page's root while the caller is on screen, so the body, the scrim and
 * the phone's browser bar all match it.
 */
export function usePageTheme(theme: Theme | undefined) {
  // A string, so a new but equal theme object each render doesn't re-apply it.
  const key = JSON.stringify(theme ?? {});
  useLayoutEffect(() => {
    const t = JSON.parse(key) as Theme;
    if (!Object.keys(t).length) return;
    const root = document.documentElement;
    dropPreloadedLook(root);
    const undo = applyTheme(t, root);
    // Grain is a fixed layer over the page: drawn only when a look asks for it.
    const grain = Number(t.grain) > 0;
    if (grain) root.dataset.grain = "";
    const bar = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
    const was = bar?.content;
    const canvas = getComputedStyle(root).getPropertyValue("--ui-canvas").trim();
    if (bar && canvas) bar.content = canvas;
    return () => {
      undo();
      if (grain) delete root.dataset.grain;
      if (bar && was !== undefined) bar.content = was;
    };
  }, [key]);
}

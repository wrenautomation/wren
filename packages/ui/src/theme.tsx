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
  "warn",
  "warn-ink",
  "shade",
  "font",
  "font-display",
  "display-weight",
  "display-squeeze",
  "label-case",
  "label-tracking",
  "button-case",
  "button-tracking",
  "button-weight",
  "radius",
  "frame",
  "main-width",
  "ease",
  // Showcase only: image layers behind the window (gradients, never a fetch) and film grain.
  "backdrop",
  "grain",
  "lift",
  // Made from the ones above by default.
  "tile",
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
  "accent-wash",
  "accent-tint",
  "good-tint",
  "bad-tint",
  "warn-tint",
  "scrim",
  "graph",
  "radius-panel",
  "radius-sheet",
  "umbra",
  "rim",
  "raise",
  "float",
  "shadow",
  "ground",
  "motif",
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
  "ink-2": "#56564f",
  "ink-3": "#63645e",
  accent: "#6a5a93",
  "on-accent": "#faf7f2",
  good: "#17803d",
  "good-ink": "#136b33",
  bad: "#c31c15",
  warn: "#b7791f",
  "warn-ink": "#895911",
  shade: "#0e0e0e",
  font: '"Figtree Variable", ui-sans-serif, system-ui, sans-serif',
  "font-display": "var(--ui-font)",
  "display-weight": "500",
  "display-squeeze": "1",
  "label-case": "uppercase",
  "label-tracking": "0.09em",
  "button-case": "uppercase",
  "button-tracking": "0.08em",
  "button-weight": "600",
  radius: "6px",
  frame: "10px",
  "main-width": "1240px",
  ease: "cubic-bezier(0.16, 1, 0.3, 1)",
  backdrop: "none",
  grain: "0",
  lift: "0 0 #0000",
};

/** Ready-made looks. `wren` is the kit as it ships. */
export const PRESETS = {
  wren: {},
  night: {
    scheme: "dark",
    canvas: "#0d0d0c",
    paper: "#171716",
    tile: "#222120",
    wash: "#1d1d1b",
    ink: "#f2f0ea",
    "ink-2": "#a9a79f",
    "ink-3": "#98968f",
    accent: "#e8794a",
    "on-accent": "#1a0c06",
    good: "#4cc27a",
    "good-ink": "#6fd394",
    bad: "#ff6b5e",
    warn: "#e0a64a",
    "warn-ink": "#ebbd6e",
    shade: "#000",
    scrim: "rgb(0 0 0 / 0.5)",
  },
  soft: {
    canvas: "#eef1f6",
    paper: "#fff",
    ink: "#111827",
    "ink-2": "#4b5563",
    "ink-3": "#5a616c",
    accent: "#3552d4",
    "on-accent": "#fff",
    "warn-ink": "#86570e",
    shade: "#1e2a4a",
    font: 'ui-rounded, "SF Pro Rounded", system-ui, sans-serif',
    "display-weight": "600",
    "display-squeeze": "0.5",
    "label-case": "none",
    "label-tracking": "0",
    "button-case": "none",
    "button-tracking": "0",
    radius: "12px",
  },
  editorial: {
    canvas: "#f4f1ea",
    paper: "#fffdf8",
    ink: "#1a1a17",
    "ink-2": "#595850",
    "ink-3": "#626159",
    accent: "#1d5a45",
    "on-accent": "#fffdf8",
    bad: "#bf1913",
    "warn-ink": "#86570e",
    "font-display": '"Iowan Old Style", "Palatino Linotype", Palatino, Georgia, serif',
    "display-weight": "400",
    "display-squeeze": "0.2",
    frame: "0",
  },
} satisfies Record<string, Theme>;

/**
 * Wren's own dashboard, never a client's (Settings → Themes): loud on purpose. Fonts are ones a
 * Mac has, each with a plain fallback, so nothing is fetched.
 */
export const SHOWCASE = {
  aurora: {
    scheme: "dark",
    canvas: "#07080f",
    paper: "#0f111f",
    tile: "rgb(255 255 255 / 0.045)",
    ink: "#eef0ff",
    "ink-2": "#a3a8c7",
    "ink-3": "#8c91b7",
    accent: "#7cf5c8",
    "on-accent": "#04140e",
    good: "#5be38f",
    "good-ink": "#7eeaa8",
    bad: "#ff6b8b",
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
    scheme: "dark",
    canvas: "#120726",
    paper: "#1a0b34",
    tile: "rgb(255 47 214 / 0.06)",
    ink: "#fbeaff",
    "ink-2": "#c9a8e2",
    "ink-3": "#a582c6",
    accent: "#ff2fd6",
    "on-accent": "#1a0326",
    good: "#2ef2c2",
    "good-ink": "#6ff6d6",
    bad: "#ff4d6d",
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
    scheme: "dark",
    canvas: "#020603",
    paper: "#050d07",
    tile: "#08140b",
    ink: "#b6ffc4",
    "ink-2": "#6fcf86",
    "ink-3": "#599663",
    accent: "#39ff6a",
    "on-accent": "#021006",
    good: "#39ff6a",
    "good-ink": "#7dff9c",
    bad: "#ff5f56",
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
    scheme: "dark",
    canvas: "#0b0a08",
    paper: "#131210",
    tile: "#1b1916",
    ink: "#f3ead7",
    "ink-2": "#b5a98f",
    "ink-3": "#968d7a",
    accent: "#d4af37",
    "on-accent": "#1a1405",
    good: "#8fbf7a",
    "good-ink": "#a9d394",
    bad: "#e0705a",
    warn: "#e3b25a",
    "warn-ink": "#ecc57e",
    shade: "#000",
    scrim: "rgb(0 0 0 / 0.55)",
    "font-display": 'Didot, "Bodoni 72", "Iowan Old Style", Georgia, serif',
    "display-weight": "400",
    "display-squeeze": "0.1",
    "label-tracking": "0.22em",
    "button-tracking": "0.18em",
    backdrop:
      "radial-gradient(80% 60% at 50% -10%, rgb(212 175 55 / 0.16), transparent 70%), radial-gradient(40% 40% at 100% 100%, rgb(212 175 55 / 0.07), transparent 70%)",
    grain: "0.06",
    lift: "0 0 0 1px rgb(212 175 55 / 0.45), 0 24px 70px -30px rgb(212 175 55 / 0.4)",
    frame: "16px",
  },
  riso: {
    canvas: "#f1ece1",
    paper: "#fbf8f1",
    tile: "#f3eee3",
    ink: "#1f1a3a",
    "ink-2": "#4c4670",
    "ink-3": "#5f5b74",
    accent: "#b60075",
    "on-accent": "#fff8fb",
    good: "#00804f",
    bad: "#b71416",
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
    Object.assign(theme, brandTheme(brand).theme);
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

/** The theme as CSS custom properties: {"--ui-accent": "#3552d4"}. */
export function themeVars(theme: Theme): Record<string, string> {
  const vars: Record<string, string> = {};
  for (const [key, value] of Object.entries(theme))
    if (KNOWN.has(key) && typeof value === "string" && value)
      vars[`--ui-${key}`] = LENGTHS.has(key) && ZERO.test(value.trim()) ? "0px" : value;
  return vars;
}

/** Put `theme` on `el` (the page's root by default). Returns the undo. */
export function applyTheme(theme: Theme, el: HTMLElement = document.documentElement): () => void {
  const vars = Object.entries(themeVars(theme));
  const before = vars.map(([k]) => [k, el.style.getPropertyValue(k)] as const);
  for (const [k, v] of vars) el.style.setProperty(k, v);
  return () => {
    for (const [k, v] of before) {
      if (v) el.style.setProperty(k, v);
      else el.style.removeProperty(k);
    }
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

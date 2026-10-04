/**
 * A look for the kit, as data. Each key is a kit token without its `--ui-` prefix, the same name
 * a stylesheet uses; leave one out and it keeps Wren's. A client's brand is one of these, stored
 * with the client, not a fork of the kit.
 */
import { useLayoutEffect } from "react";

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
  "radius-window",
  "radius-card",
  "radius-control",
  "radius-button",
  "radius-tag",
  "radius-bar",
  "frame",
  "main-width",
  "ease",
  // Made from the ones above by default.
  "tile",
  "wash",
  "on-ink",
  "rule",
  "hair",
  "line",
  "fill",
  "hover",
  "glass",
  "accent-wash",
  "accent-tint",
  "good-tint",
  "bad-tint",
  "scrim",
  "shadow-node",
  "shadow-window",
  "shadow-lift",
  "shadow-drawer",
] as const;

export type Token = (typeof TOKENS)[number];
export type Theme = Partial<Record<Token, string>>;

const KNOWN: ReadonlySet<string> = new Set(TOKENS);

/** Lengths the kit does math on: a bare 0 there breaks calc(), so it becomes 0px. */
const LENGTHS: ReadonlySet<string> = new Set([
  "radius-window",
  "radius-card",
  "radius-control",
  "radius-button",
  "radius-tag",
  "radius-bar",
  "frame",
  "main-width",
]);

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
    "ink-3": "#6b6a64",
    accent: "#e8794a",
    "on-accent": "#1a0c06",
    good: "#4cc27a",
    "good-ink": "#6fd394",
    bad: "#ff6b5e",
    shade: "#000",
    scrim: "rgb(0 0 0 / 0.5)",
  },
  soft: {
    canvas: "#eef1f6",
    paper: "#fff",
    ink: "#111827",
    "ink-2": "#4b5563",
    "ink-3": "#9ca3af",
    accent: "#3552d4",
    "on-accent": "#fff",
    shade: "#1e2a4a",
    font: 'ui-rounded, "SF Pro Rounded", system-ui, sans-serif',
    "display-weight": "600",
    "display-squeeze": "0.5",
    "label-case": "none",
    "label-tracking": "0",
    "button-case": "none",
    "button-tracking": "0",
    "radius-window": "28px",
    "radius-card": "18px",
    "radius-control": "12px",
    "radius-button": "999px",
    "radius-bar": "999px",
  },
  editorial: {
    canvas: "#f4f1ea",
    paper: "#fffdf8",
    ink: "#1a1a17",
    "ink-2": "#595850",
    "ink-3": "#a19f96",
    accent: "#1d5a45",
    "on-accent": "#fffdf8",
    "font-display": '"Iowan Old Style", "Palatino Linotype", Palatino, Georgia, serif',
    "display-weight": "400",
    "display-squeeze": "0.2",
    "radius-window": "0",
    "radius-card": "0",
    "radius-control": "0",
    "radius-tag": "2px",
    "radius-bar": "0",
    frame: "0",
    "shadow-window": "-1px 0 0 var(--ui-rule)",
    "shadow-node": "inset 0 0 0 1px var(--ui-rule)",
  },
} satisfies Record<string, Theme>;

export type PresetName = keyof typeof PRESETS;

/** Characters a token never needs, so stored data can't reach past its own value. */
const UNSAFE = /[;{}<>!\\]|@import/i;
/** The only CSS calls a token may make. None fetches anything: no url(), image-set(), src(). */
const CALLS: ReadonlySet<string> = new Set([
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
 * `preset` to start from. What it can't use is dropped, never thrown on, so a bad value costs one
 * token, not the page.
 */
export function readTheme(raw: unknown): Theme {
  if (typeof raw === "string") return preset(raw);
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const input = raw as Record<string, unknown>;
  const theme: Theme = { ...preset(input.preset) };
  for (const [key, value] of Object.entries(input)) {
    if (!KNOWN.has(key)) continue;
    const v = typeof value === "number" && Number.isFinite(value) ? String(value) : value;
    if (typeof v !== "string") continue;
    const clean = v.trim();
    if (clean && clean.length <= 300 && safe(clean)) theme[key as Token] = clean;
  }
  return theme;
}

function preset(name: unknown): Theme {
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
    const undo = applyTheme(t, root);
    const bar = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
    const was = bar?.content;
    const canvas = getComputedStyle(root).getPropertyValue("--ui-canvas").trim();
    if (bar && canvas) bar.content = canvas;
    return () => {
      undo();
      if (bar && was !== undefined) bar.content = was;
    };
  }, [key]);
}

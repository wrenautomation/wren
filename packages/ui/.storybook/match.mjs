#!/usr/bin/env node
/**
 * Artifact match (designs/2026-10-21-artifact-match.md): each part in `match/parts.ts` is read on
 * the artifact page and in its story with getComputedStyle, day and night, at 390 and 1280. Any
 * difference fails and prints the part, the property, the look and both values. No pixels.
 *   wren-match [--static storybook-static] [--port 61000] [--only <part>]
 * Colours compare as rgba, 2 per channel for rounding. Everything else compares exactly.
 * Local only, like wren-look. Nothing outlives it.
 */
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { chromium } from "playwright";
import { PARTS } from "../match/parts.ts";
import { serve } from "./static.mjs";

const { values } = parseArgs({
  options: {
    port: { type: "string", default: "61000" },
    static: { type: "string" },
    designs: {
      type: "string",
      default: fileURLToPath(new URL("../../../designs", import.meta.url)),
    },
    only: { type: "string" },
  },
});

const WIDTHS = [390, 1280];
const THEMES = ["light", "dark"];
const TOLERANCE = 2;

const stories = values.static ? await serve(values.static) : null;
const designs = await serve(values.designs, { need: null });
const storyBase = stories?.base ?? `http://localhost:${values.port}`;

const browser = await chromium.launch();
const stop = async (code) => {
  await browser.close().catch(() => {});
  stories?.server.close();
  designs.server.close();
  process.exit(code);
};
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => void stop(130));

/** Every colour in a computed value, as [r, g, b, a] on 0-255 (alpha 0-1). */
function colours(v) {
  const out = [];
  for (const m of v.matchAll(/rgba?\(([^)]+)\)|color\(srgb ([^)]+)\)/g)) {
    const [nums, alpha] = (m[1] ?? m[2]).split("/");
    const parts = nums
      .split(/[\s,]+/)
      .filter(Boolean)
      .map(Number);
    const a = alpha !== undefined ? Number(alpha) : (parts[3] ?? 1);
    const rgb = m[2] ? parts.slice(0, 3).map((n) => n * 255) : parts.slice(0, 3);
    out.push([...rgb, a]);
  }
  return out;
}

const COLOURED = /color|shadow|^background$/;
function same(px, py, a, b) {
  if (!COLOURED.test(py)) return a === b;
  // Tailwind's empty ring and shadow layers draw nothing: only drawn colours count.
  const [x, y] = [colours(a), colours(b)].map((cs) => cs.filter((c) => c[3] > 0));
  if (!x.length || !y.length) return a === b;
  // A border on one side against an inset shadow on the other: the first colour is the line.
  const n = px === py ? Math.max(x.length, y.length) : 1;
  for (let i = 0; i < n; i++) {
    const [p, q] = [x[i], y[i]];
    if (!p || !q) return false;
    if (p.slice(0, 3).some((c, k) => Math.abs(c - q[k]) > TOLERANCE)) return false;
    if (Math.abs(p[3] - q[3]) > 0.01) return false;
  }
  return true;
}

/** The computed props of one node; null when the node is not there. */
async function read(page, at, props) {
  return page.evaluate(
    ([sel, names]) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      const s = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      const value = (n) => {
        if (n === "height" || n === "width") return `${Math.round(r[n])}px`;
        const v = s.getPropertyValue(n);
        // A radius of half the box or more draws the same circle as 50%.
        if (n === "border-radius" && parseFloat(v) >= Math.min(r.width, r.height) / 2) return "50%";
        // The face, not its fallbacks: "Figtree Variable" is Figtree's variable build.
        if (n === "font-family")
          return v
            .split(",")[0]
            .replace(/["']/g, "")
            .replace(/ Variable$/, "");
        return v;
      };
      return Object.fromEntries(names.map((n) => [n, value(n)]));
    },
    [at, props],
  );
}

const QUIET = "*,*::before,*::after{animation:none!important;transition:none!important}";
const pages = new Map();
/** One open page per URL, width and theme: parts share them. */
async function pageOf(href, width, theme, artifact) {
  const key = `${href} ${width} ${theme}`;
  if (pages.has(key)) return pages.get(key);
  const ctx = await browser.newContext({
    viewport: { width, height: 900 },
    reducedMotion: "reduce",
  });
  const page = await ctx.newPage();
  await page.goto(href);
  if (artifact)
    await page.evaluate((t) => document.documentElement.setAttribute("data-theme", t), theme);
  else
    await page.waitForFunction(
      () => document.getElementById("storybook-root")?.childElementCount,
      null,
      { timeout: 20_000 },
    );
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.addStyleTag({ content: QUIET });
  await page.waitForTimeout(150);
  pages.set(key, page);
  return page;
}

const parts = values.only ? PARTS.filter((p) => p.name.includes(values.only)) : PARTS;
const lines = [];
let checked = 0;
for (const part of parts)
  for (const width of WIDTHS) {
    const at = part.story.at[width];
    if (!at) continue;
    for (const theme of THEMES) {
      const look = `${width} ${theme}`;
      const art = await pageOf(`${designs.base}/${part.artifact.file}`, width, theme, true);
      const story = await pageOf(
        `${storyBase}/iframe.html?id=${part.story.id}&viewMode=story&globals=theme:${theme}`,
        width,
        theme,
        false,
      );
      const pairs = part.props.map((p) => (typeof p === "string" ? [p, p] : p));
      const a = await read(
        art,
        part.artifact.at,
        pairs.map((p) => p[0]),
      );
      const b = await read(
        story,
        at,
        pairs.map((p) => p[1]),
      );
      checked++;
      if (!a || !b) {
        lines.push(
          `✗ ${part.name} ${look}: no node on the ${a ? "story" : "artifact"} side (${a ? at : part.artifact.at})`,
        );
        continue;
      }
      for (const [x, y] of pairs)
        if (!same(x, y, a[x], b[y]))
          lines.push(
            `✗ ${part.name} ${look} ${x === y ? x : `${x}/${y}`}: artifact ${a[x]}, story ${b[y]}`,
          );
    }
  }

console.log(lines.join("\n"));
console.log(`${checked} part looks, ${lines.length} differences`);
await stop(lines.length ? 1 : 0);

/**
 * A carousel's slide set (designs/2026-10-07-content-funnel.md, build order 3): 5 to 10 slides, a
 * title and a few short lines each. One HTML page draws them in the video title cards' look
 * (`@wren/video` DEFAULT_LOOK): the renderer screenshots each slide square for Instagram and
 * prints the same page as a PDF for a LinkedIn document post; the portal's preview strip draws
 * the same page, so what he sees is what renders. Plain TypeScript, no imports: the browser
 * bundle reads it too.
 */

export interface Slide {
  title: string;
  lines: string[];
}

export const SLIDES_MIN = 5;
export const SLIDES_MAX = 10;
export const SLIDE_TITLE_MAX = 70;
export const SLIDE_LINES_MAX = 4;
export const SLIDE_LINE_MAX = 110;
/** Square, Instagram's carousel size; the PDF's pages are the same. */
export const SLIDE_PX = 1080;

/** The video title cards' look: the portal's canvas, ink and lavender. */
export const SLIDE_LOOK = {
  background: "#f3f1ec",
  foreground: "#0e0e0e",
  muted: "#56564f",
  accent: "#7969a3",
  font: '"General Sans", "Inter", "Helvetica Neue", Arial, ui-sans-serif, system-ui, sans-serif',
} as const;

/** The slides as stored, trimmed, blank lines dropped; anything not a slide is left out. */
export function cleanSlides(v: unknown): Slide[] {
  if (!Array.isArray(v)) return [];
  return v.flatMap((s) => {
    if (!s || typeof s !== "object") return [];
    const o = s as { title?: unknown; lines?: unknown };
    const title = typeof o.title === "string" ? o.title.trim() : "";
    const lines = Array.isArray(o.lines)
      ? o.lines.filter((l): l is string => typeof l === "string").map((l) => l.trim())
      : [];
    return [{ title, lines: lines.filter(Boolean) }];
  });
}

/** Why the set can't be saved or rendered, or null. Counts as the editor shows them. */
export function slidesUnfit(slides: readonly Slide[]): string | null {
  if (slides.length < SLIDES_MIN || slides.length > SLIDES_MAX)
    return `a carousel is ${SLIDES_MIN} to ${SLIDES_MAX} slides`;
  for (const [i, s] of slides.entries()) {
    const n = i + 1;
    if (!s.title.trim()) return `slide ${n} needs a title`;
    if (s.title.length > SLIDE_TITLE_MAX)
      return `slide ${n}'s title is ${s.title.length} characters, over ${SLIDE_TITLE_MAX}`;
    if (s.lines.length > SLIDE_LINES_MAX)
      return `slide ${n} has ${s.lines.length} lines, up to ${SLIDE_LINES_MAX}`;
    const long = s.lines.findIndex((l) => l.length > SLIDE_LINE_MAX);
    if (long >= 0)
      return `slide ${n}, line ${long + 1} is ${s.lines[long]?.length} characters, over ${SLIDE_LINE_MAX}`;
  }
  return null;
}

/** A short key of the set's words: the render keeps it, so a changed set reads as not drawn yet. */
export function slidesKey(slides: readonly Slide[]): string {
  let h = 0x811c9dc5;
  for (const c of JSON.stringify(slides.map((s) => [s.title, s.lines]))) {
    h ^= c.codePointAt(0) ?? 0;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

/** The slides' words as one text: what the facts guard reads. */
export const slidesText = (slides: readonly Slide[]): string =>
  slides.map((s) => [s.title, ...s.lines].join("\n")).join("\n\n");

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** A title's size: big when short, smaller as it grows. */
const titlePx = (title: string, cover: boolean) => {
  const n = title.length;
  if (cover) return n <= 28 ? 104 : n <= 48 ? 88 : 72;
  return n <= 28 ? 84 : n <= 48 ? 72 : 60;
};

function slideSection(s: Slide, i: number, total: number, by: string): string {
  const cover = i === 0;
  const lines = s.lines.map((l) => `<p class="line">${esc(l)}</p>`).join("");
  return `<section class="slide${cover ? " cover" : ""}" data-n="${i + 1}">
<p class="eyebrow">${esc(by)}</p>
<div class="body"><h1 style="font-size:${titlePx(s.title, cover)}px">${esc(s.title)}</h1>${lines ? `<div class="lines">${lines}</div>` : ""}</div>
<footer><span class="bar"></span><span class="n">${i + 1} / ${total}</span>${cover && total > 1 ? '<span class="swipe">Swipe</span>' : ""}</footer>
</section>`;
}

/**
 * The page that draws the slides, one square section each (`.slide`, `data-n` from 1). `only`
 * draws one slide (the portal's strip); `by` is the line over each title.
 */
export function slidesHtml(
  slides: readonly Slide[],
  o: { only?: number; by?: string } = {},
): string {
  const L = SLIDE_LOOK;
  const by = o.by ?? "Wren Automation";
  const picked =
    o.only === undefined
      ? slides.map((s, i) => slideSection(s, i, slides.length, by))
      : [slideSection(slides[o.only] ?? { title: "", lines: [] }, o.only, slides.length, by)];
  return `<!doctype html><html><head><meta charset="utf-8"><style>
@page{size:${SLIDE_PX}px ${SLIDE_PX}px;margin:0}
*{box-sizing:border-box;margin:0;padding:0}
html,body{background:${L.background}}
body{font-family:${L.font};color:${L.foreground};-webkit-font-smoothing:antialiased}
.slide{position:relative;width:${SLIDE_PX}px;height:${SLIDE_PX}px;padding:96px 104px;display:flex;flex-direction:column;background:${L.background};overflow:hidden;break-after:page;page-break-after:always}
.slide:last-child{break-after:auto;page-break-after:auto}
.eyebrow{font-size:24px;letter-spacing:.14em;text-transform:uppercase;color:${L.accent};font-weight:600}
.body{flex:1;display:flex;flex-direction:column;justify-content:center;gap:44px}
h1{line-height:1.04;letter-spacing:-.02em;font-weight:650;max-width:16ch;text-wrap:balance}
.cover h1{max-width:14ch}
.lines{display:flex;flex-direction:column;gap:22px;border-left:8px solid ${L.accent};padding-left:36px}
.line{font-size:36px;line-height:1.32;color:${L.muted};max-width:32ch}
footer{display:flex;align-items:center;gap:24px;font-size:24px;color:${L.muted}}
.bar{width:72px;height:8px;background:${L.accent}}
.swipe{margin-left:auto;font-weight:600;color:${L.foreground}}
.swipe::after{content:" \\2192"}
</style></head><body>${picked.join("\n")}</body></html>`;
}

/** True of a draft whose post is a slide set: an Instagram carousel or a LinkedIn PDF. */
export const isCarousel = (d: {
  platform: string;
  extra?: Readonly<Record<string, unknown>> | null;
}): boolean =>
  (d.platform === "instagram" && d.extra?.kind === "carousel") ||
  (d.platform === "linkedin" && d.extra?.kind === "document");

/** The stored files a carousel posts: the slide images and the PDF, as drawn. */
export interface CarouselFiles {
  images: string[];
  pdf: string | null;
}

/**
 * Why a carousel can't go out yet, or null when its drawn files match its slides. A set edited
 * after drawing is stale; Instagram takes JPEG only, so slides drawn as PNG before 10-09 redraw.
 */
export function carouselUnfit(d: {
  platform: string;
  extra?: Readonly<Record<string, unknown>> | null;
}): string | null {
  const slides = cleanSlides(d.extra?.slides);
  const bad = slidesUnfit(slides);
  if (bad) return bad;
  const r = d.extra?.rendered as { images?: unknown; pdf?: unknown; of?: unknown } | undefined;
  if (!r || r.of !== slidesKey(slides)) return "draw the slides first: the images don't match them";
  const images = Array.isArray(r.images) ? r.images : [];
  if (d.platform === "linkedin" && typeof r.pdf !== "string")
    return "draw the slides again: no PDF";
  if (d.platform === "instagram" && !images.every((k) => /\.jpe?g$/i.test(String(k))))
    return "draw the slides again: Instagram takes JPEG slides";
  return null;
}

/** The files to post, once `carouselUnfit` says null. */
export function carouselFiles(d: {
  extra?: Readonly<Record<string, unknown>> | null;
}): CarouselFiles {
  const r = (d.extra?.rendered ?? {}) as { images?: unknown; pdf?: unknown };
  return {
    images: Array.isArray(r.images) ? r.images.map(String) : [],
    pdf: typeof r.pdf === "string" ? r.pdf : null,
  };
}

/**
 * Layout problems on the page as it is drawn, as text (designs/2026-10-21-dev-loop.md): words
 * over other words, words past their box, a pane that scrolls sideways. No screenshot: each
 * problem is one line that names the parts. `wren-look` runs it on any local page (look.mjs).
 *
 * Self-contained, no imports: Playwright sends its source into the page (`page.evaluate`).
 * An overlay that sits on text on purpose wears `data-look-over`; a pane meant to scroll sideways
 * (a wide table) wears `data-look-scroll`.
 */
export function lookProblems(root: Element = document.body): string[] {
  const out: string[] = [];
  const name = (el: Element) => {
    const tag = el.tagName.toLowerCase();
    const id = el.closest("[data-testid]")?.getAttribute("data-testid");
    const label =
      el.getAttribute("aria-label") ??
      el.closest("[role=row],tr,li,section,nav,header")?.getAttribute("aria-label");
    const words = (el.textContent ?? "").trim().replace(/\s+/g, " ").slice(0, 32);
    return [id && `[${id}]`, label && `«${label}»`, `${tag} "${words}"`].filter(Boolean).join(" ");
  };
  // checkVisibility also skips a closed <details>' body: Chrome keeps its boxes, undrawn.
  const shown = (el: Element) =>
    el.checkVisibility({ opacityProperty: true, visibilityProperty: true });
  // The box a text's drawing is cut to: its own part and each ancestor that clips or scrolls.
  const clipOf = (el: Element) => {
    let r = { left: -1e9, top: -1e9, right: 1e9, bottom: 1e9 };
    for (let a: Element | null = el; a; a = a.parentElement) {
      const s = getComputedStyle(a);
      if (s.overflowX === "visible" && s.overflowY === "visible") continue;
      const b = a.getBoundingClientRect();
      r = {
        left: Math.max(r.left, b.left),
        top: Math.max(r.top, b.top),
        right: Math.min(r.right, b.right),
        bottom: Math.min(r.bottom, b.bottom),
      };
    }
    return r;
  };
  type Run = { el: Element; left: number; top: number; right: number; bottom: number };
  const runs: Run[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const el = n.parentElement;
    if (
      !el ||
      !n.textContent?.trim() ||
      !shown(el) ||
      el.closest("[data-look-over],[aria-hidden=true],script,style,svg")
    )
      continue;
    const range = document.createRange();
    range.selectNodeContents(n);
    const clip = clipOf(el);
    for (const r of range.getClientRects()) {
      const run = {
        el,
        left: Math.max(r.left, clip.left),
        top: Math.max(r.top, clip.top),
        right: Math.min(r.right, clip.right),
        bottom: Math.min(r.bottom, clip.bottom),
      };
      if (run.right - run.left > 1 && run.bottom - run.top > 1) runs.push(run);
    }
  }
  // A bar that stays put (fixed, sticky) has the page pass under it, and a raised card (absolute
  // with a z-index: a banner, a popover) sits over what is under it, on purpose.
  const layers = new Map<Element, Element | null>();
  const raised = (el: Element) => {
    const s = getComputedStyle(el);
    return (
      s.position === "fixed" ||
      s.position === "sticky" ||
      (s.position === "absolute" && s.zIndex !== "auto" && Number(s.zIndex) > 0)
    );
  };
  const layerOf = (el: Element) => {
    if (!layers.has(el)) {
      let at: Element | null = el;
      while (at && !raised(at)) at = at.parentElement;
      layers.set(el, at);
    }
    return layers.get(el);
  };
  // Words over words: two runs of text from parts that are not one inside the other.
  const seen = new Set<string>();
  for (let i = 0; i < runs.length; i++) {
    for (let j = i + 1; j < runs.length; j++) {
      const a = runs[i];
      const b = runs[j];
      if (a.el === b.el || a.el.contains(b.el) || b.el.contains(a.el)) continue;
      if (layerOf(a.el) !== layerOf(b.el)) continue;
      const w = Math.min(a.right, b.right) - Math.max(a.left, b.left);
      const h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
      if (w < 3 || h < 4) continue;
      const key = `over ${name(a.el)} | ${name(b.el)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(`text over text: ${name(a.el)} covers ${name(b.el)} by ${Math.round(w)}px`);
    }
  }
  // Drawn where a person can see it: not off the window, not cut away whole by a closed panel.
  const seen1 = (el: Element) => {
    const b = el.getBoundingClientRect();
    const c = clipOf(el.parentElement ?? el);
    const left = Math.max(b.left, c.left, 0);
    const right = Math.min(b.right, c.right, innerWidth);
    const top = Math.max(b.top, c.top, 0);
    const bottom = Math.min(b.bottom, c.bottom, innerHeight);
    if (right - left <= 1 || bottom - top <= 1) return false;
    // Under another part (a swipe action behind its row): not seen.
    const top1 = document.elementFromPoint((left + right) / 2, (top + bottom) / 2);
    return !top1 || el.contains(top1) || top1.contains(el);
  };
  for (const el of root.querySelectorAll("*")) {
    if (!shown(el) || el.closest("[data-look-over],[inert]") || !seen1(el)) continue;
    const s = getComputedStyle(el);
    const spill = el.scrollWidth - el.clientWidth;
    // A reader-only label (`sr-only`) is cut to a pixel on purpose. SVG text has no CSS box to
    // spill from: a scaled map gives scrollWidth and clientWidth in different units.
    if (spill <= 1 || el.clientWidth <= 2 || el instanceof SVGElement) continue;
    const own = [...el.childNodes].some((c) => c.nodeType === 3 && c.textContent?.trim());
    // Words that run out of their own box into the next one.
    if (own && s.overflowX === "visible" && s.whiteSpace.startsWith("nowrap"))
      out.push(`text past its box: ${name(el)} runs ${spill}px over`);
    // A cut line with no "…": the reader can't tell words are missing.
    else if (
      own &&
      s.overflowX !== "visible" &&
      s.textOverflow !== "ellipsis" &&
      s.whiteSpace.startsWith("nowrap")
    )
      out.push(`text cut without "…": ${name(el)} loses ${spill}px`);
    // A pane that scrolls down and sideways: a page or pane scrolls down only, unless it says it
    // may. A strip of tabs or a code block scrolls sideways alone, on purpose.
    else if (
      (s.overflowX === "auto" || s.overflowX === "scroll") &&
      el.scrollHeight > el.clientHeight + 1 &&
      !el.closest("[data-look-scroll]") &&
      // A list at its least may scroll sideways (widthsOf in records.tsx): its table says how wide.
      ![...el.querySelectorAll("table")].some(
        (t) => parseFloat(t.style.minWidth) > (t.parentElement?.clientWidth ?? el.clientWidth),
      )
    )
      out.push(`scrolls sideways: ${name(el)} is ${spill}px wider than its ${el.clientWidth}px`);
  }
  const page = document.documentElement;
  if (page.scrollWidth > innerWidth + 1)
    out.push(`page scrolls sideways: ${page.scrollWidth}px wide in a ${innerWidth}px window`);
  return out;
}

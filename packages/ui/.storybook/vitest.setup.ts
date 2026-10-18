/**
 * Stories as tests: a fixed clock, nothing moving, and links that keep the test frame.
 * The addon has already loaded preview.tsx's annotations; this file adds what only a test needs.
 */
import { beforeAll, beforeEach, vi } from "vitest";

// Each story file runs in a new frame of one tab, and the tab's session storage outlives it: the
// presses an earlier file left there (save/writes.ts reads them on import) would show here.
sessionStorage.clear();

/** Fixtures and parts that say "today" or "3 days ago" read this clock, so every run draws the same day. */
const NOW = new Date("2026-10-17T15:00:00Z");

// Set before the story file loads, so a fixture that reads the date on import reads this one.
// Only Date: timers stay real, so debounces and `waitFor` still run.
vi.useFakeTimers({ toFake: ["Date"], now: NOW, shouldAdvanceTime: true });

beforeAll(() => {
  // Nothing moves: axe reads each colour where it ends, not a frame of a theme fading in.
  const still = document.createElement("style");
  still.textContent = `*, *::before, *::after { animation: none !important; transition: none !important; }`;
  document.head.append(still);
  // A real click on a `#` link unloads Vitest's test frame and ends the run. Stories that move
  // through the hash (fixtures/place.ts) get the same move from a hash write, which keeps it.
  document.addEventListener("click", (e) => {
    const link = e.target instanceof Element ? e.target.closest("a[href^='#']") : null;
    if (!link || e.defaultPrevented) return;
    e.preventDefault();
    location.hash = link.getAttribute("href") ?? "";
  });
});

// Stories share one frame's address: a hash one story moved to (`#state=waiting`) would open the next.
beforeEach(() => {
  if (location.hash) history.replaceState(null, "", location.pathname + location.search);
});

/**
 * Stories as tests: hold still, then compare one screenshot per story with its baseline.
 * The addon has already loaded preview.tsx's annotations; this file adds what only a test needs.
 */
import { afterEach, beforeAll, expect, inject, vi } from "vitest";
import { page } from "vitest/browser";
import { answering } from "../src/fixtures/load.js";

// Each story file runs in a new frame of one tab, and the tab's session storage outlives it: the
// presses an earlier file left there (save/writes.ts reads them on import) would show here.
sessionStorage.clear();

/** Fixtures and parts that say "today" or "3 days ago" read this clock, so every run draws the same day. */
const NOW = new Date("2026-10-17T15:00:00Z");

// Set before the story file loads, so a fixture that reads the date on import reads this one.
// Only Date: timers stay real, so debounces and `waitFor` still run.
vi.useFakeTimers({ toFake: ["Date"], now: NOW, shouldAdvanceTime: true });

beforeAll(() => {
  // Nothing moves: the shot is of where each part ends, not a frame of the way there.
  const still = document.createElement("style");
  still.textContent = `*, *::before, *::after {
    animation: none !important; transition: none !important; caret-color: transparent !important;
  }`;
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

afterEach(async ({ task }) => {
  const id = task.meta.storyId;
  // A story that already failed has nothing worth a shot.
  if (!id || task.result?.errors?.length) return;
  // Fixture answers come after a set delay (a read's 200 ms): the shot waits for all of them,
  // then for React to draw what they brought. A held read (`pending`) is never counted.
  await vi.waitUntil(() => answering() === 0, { timeout: 5000 });
  await new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)));
  await document.fonts.ready;
  const [title, story] = id.split("--");
  await expect
    .element(page.elementLocator(document.body))
    .toMatchScreenshot(`${title}/${story}-${inject("shot")}`);
});

/**
 * A short walk through a local page, recorded and encoded for real: card,
 * click, zoom, caption, then the mp4 and its poster. Skipped where Chromium or
 * ffmpeg is missing (CI has neither).
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright";
import { afterAll, describe, expect, it } from "vitest";
import { encode, openRecorder } from "../../src/index.js";

const hasFfmpeg = spawnSync("ffmpeg", ["-version"]).status === 0;
const hasChromium = existsSync(chromium.executablePath());

const PAGE = `<!doctype html><html><body style="font:20px sans-serif;padding:40px">
<h1>Sample page</h1><p id="why">The line the video zooms in on.</p>
<button onclick="document.getElementById('out').textContent='Clicked'">Press</button>
<p id="out"></p></body></html>`;

describe.skipIf(!hasFfmpeg || !hasChromium)("record and encode", () => {
  let dir = "";
  afterAll(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  it("turns a walk into an mp4 and a poster, and drops the frames", async () => {
    dir = await mkdtemp(join(tmpdir(), "wren-video-"));
    const page = join(dir, "page.html");
    await writeFile(page, PAGE);
    const rec = await openRecorder({ dir, width: 640, height: 360, outWidth: 640, outHeight: 360 });
    try {
      await rec.goto(pathToFileURL(page).href);
      await rec.card({ eyebrow: "Made for a sample firm", title: "Sample" }, true);
      await rec.start();
      await rec.pause(600);
      await rec.uncard();
      rec.caption("A caption over the page.");
      await rec.click(rec.page.getByRole("button", { name: "Press" }));
      expect(await rec.page.locator("#out").textContent()).toBe("Clicked");
      await rec.zoom(rec.page.locator("#why"), { hold: 0.4, ramp: 0.3 });
      rec.caption(null);
      await rec.pause(300);
      const recording = await rec.stop();
      expect(recording.frames.length).toBeGreaterThan(0);
      await rec.close();

      const out = await encode(recording, join(dir, "video"), { width: 640, height: 360 });
      expect(out.seconds).toBeGreaterThan(1);
      expect((await stat(out.mp4)).size).toBeGreaterThan(1000);
      expect((await stat(out.poster)).size).toBeGreaterThan(1000);
      expect((await readdir(dir)).sort()).toEqual(["page.html", "video.jpg", "video.mp4"]);
    } finally {
      await rec.close().catch(() => {});
    }
  });
});

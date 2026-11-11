import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import type { ShortProps } from "./props.js";
import {
  contrastFaults,
  flashFaults,
  opposingChanges,
  paceFaults,
  pictureChanges,
  textOnScreen,
  tileSeries,
} from "./render-checks.js";
import { balancedLines, textWidth } from "./text-box.js";

const FFMPEG = "ffmpeg";
const HAS_FFMPEG = spawnSync(FFMPEG, ["-version"]).status === 0;
const dir = mkdtempSync(join(tmpdir(), "render-checks-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

/** A synthetic clip from an ffmpeg lavfi source. */
function clip(name: string, source: string, seconds: number): string {
  const out = join(dir, `${name}.mp4`);
  const r = spawnSync(FFMPEG, [
    ...["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", source],
    ...["-t", String(seconds), "-pix_fmt", "yuv420p", "-y", out],
  ]);
  if (r.status !== 0) throw new Error(String(r.stderr));
  return out;
}

const OVER = {
  text: "Three times more replies",
  from: 0.2,
  to: 1.8,
  x: 0.5,
  y: 0.5,
  size: "l" as const,
};

describe("flash", () => {
  it("counts a swing of 0.1 or more as one change, a smaller wobble as none", () => {
    expect(opposingChanges([0, 0.05, 0, 0.05])).toEqual([]);
    expect(opposingChanges([0, 1, 0, 1, 0])).toEqual([1, 2, 3, 4]);
    // Both sides at 0.8 or brighter: not a flash.
    expect(opposingChanges([0.85, 1, 0.85, 1])).toEqual([]);
  });

  it("4 flashes in 1 s fail, 3 pass", () => {
    const at = (n: number) =>
      Array.from({ length: 30 }, (_, i) => (Math.floor((i * n * 2) / 30) % 2 ? 1 : 0));
    expect(flashFaults([at(3)], 30)).toEqual([]);
    const [f] = flashFaults([at(5)], 30);
    expect(f).toMatchObject({ rank: "P0", rule: "flash", at: 0.1, box: [0, 0, 0.25, 0.25] });
  });

  it.skipIf(!HAS_FFMPEG)("finds a 10 Hz black and white clip; a steady clip has none", async () => {
    const strobe = clip(
      "strobe",
      "color=c=black:s=320x180:r=30,geq=lum='if(mod(floor(T*20),2),255,16)':cb=128:cr=128",
      2,
    );
    const steady = clip("steady", "color=c=gray:s=320x180:r=30", 2);
    expect(flashFaults(await tileSeries(strobe, 30, FFMPEG), 30)[0]).toMatchObject({
      rank: "P0",
      box: [0, 0, 1, 1],
    });
    expect(flashFaults(await tileSeries(steady, 30, FFMPEG), 30)).toEqual([]);
  });
});

describe("contrast", () => {
  it("measures text with the bundled font and balances its lines", () => {
    expect(textWidth("replies", 100)).toBeGreaterThan(textWidth("reply", 100));
    expect(balancedLines("one two three four five six", 100, 0, 900)).toHaveLength(2);
  });

  it.skipIf(!HAS_FFMPEG)(
    "white text on a white frame fails; on a dark frame it passes",
    async () => {
      const frame = [1920, 1080] as const;
      const texts = textOnScreen({ overlays: [OVER], behind: [] }, frame);
      const white = clip("white", "color=c=white:s=1920x1080:r=30", 2);
      const dark = clip("dark", "color=c=0x202020:s=1920x1080:r=30", 2);
      const [f] = await contrastFaults(white, texts, frame, FFMPEG);
      expect(f).toMatchObject({ rank: "P1", rule: "contrast" });
      expect(await contrastFaults(dark, texts, frame, FFMPEG)).toEqual([]);
    },
  );
});

describe("pace", () => {
  const short = (o: Partial<ShortProps>) =>
    ({
      fps: 30,
      durationInFrames: 30 * 30,
      segments: [{ from: 0, frames: 30 * 30 }],
      layout: [],
      overlays: [],
      behind: [],
      card: null,
      ...o,
    }) as unknown as ShortProps;

  it("30 s with no change is a P1", () => {
    expect(paceFaults(short({}))).toEqual([
      expect.objectContaining({ rank: "P1", rule: "pace", at: 0 }),
    ]);
  });

  it("a cut every 2.5 s is clean; one 5 s stretch is a P2", () => {
    const every = (s: number, n: number) =>
      Array.from({ length: n }, () => ({ from: 0, frames: s * 30 }));
    expect(paceFaults(short({ durationInFrames: 300, segments: every(2.5, 4) }))).toEqual([]);
    const p = short({
      durationInFrames: 300,
      segments: [...every(2.5, 2), { from: 0, frames: 150 }],
    });
    expect(pictureChanges(p)).toEqual([2.5, 5]);
    expect(paceFaults(p)).toEqual([expect.objectContaining({ rank: "P2", at: 5 })]);
  });

  it("an overlay, a layout mark and the title card count as changes", () => {
    const p = short({
      durationInFrames: 300,
      overlays: [{ ...OVER, from: 3, to: 6 }],
      layout: [{ from: 8, to: 9, show: "screen" }] as ShortProps["layout"],
      card: { text: "t", holdS: 2.6, fadeS: 0.4 },
    });
    expect(pictureChanges(p)).toEqual([3, 6, 8, 9]);
    expect(paceFaults(p)).toEqual([]);
  });
});

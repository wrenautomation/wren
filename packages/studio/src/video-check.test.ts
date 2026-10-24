import { execFileSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { barLines } from "./bar.js";
import { checkPrompt, checkRender, parseCheck, sheetGrid } from "./video-check.js";

const hasFfmpeg = (() => {
  try {
    execFileSync("ffmpeg", ["-version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
})();

describe("the bar", () => {
  it("gives a Short its own rules and a long video the rest", () => {
    expect(barLines("short")).toContain("- pace:");
    expect(barLines("long")).not.toContain("- pace:");
    expect(barLines()).toContain("- pace (short only):");
  });
});

describe("video check", () => {
  it("reads the answer; an unknown rule is `best`, any issue fails", () => {
    expect(parseCheck('```json\n{"pass": true, "issues": []}\n```')).toEqual({
      pass: true,
      issues: [],
    });
    expect(
      parseCheck('{"pass": true, "issues": [{"at": 3.14, "rule": "vibes", "says": "Dull."}]}'),
    ).toEqual({ pass: false, issues: [{ at: 3.1, rule: "best", says: "Dull." }] });
    expect(() => parseCheck('{"pass": "yes"}')).toThrow();
  });

  it("keeps the sheet at 48 frames or fewer, 2 s apart at least", () => {
    expect(sheetGrid(30)).toEqual({ every: 2, n: 15, cols: 8, rows: 2 });
    expect(sheetGrid(600)).toEqual({ every: 13, n: 47, cols: 8, rows: 6 });
    expect(sheetGrid(1)).toEqual({ every: 2, n: 1, cols: 1, rows: 1 });
  });

  it("asks against the bar for its format, with the cuts and the words", () => {
    const p = checkPrompt("short", {
      durationS: 30,
      every: 2,
      cols: 8,
      cuts: [4.2],
      words: "0.0 hi",
    });
    expect(p).toContain("Short (9:16");
    expect(p).toContain("4.2");
    expect(p).toContain("- open:");
  });

  describe.skipIf(!hasFfmpeg)("on a file", () => {
    let dir = "";
    let video = "";
    beforeAll(async () => {
      dir = await mkdtemp(join(tmpdir(), "check-test-"));
      video = join(dir, "short.mp4");
      // Made here, never committed: 3 s of bars, 3 s of blue.
      execFileSync("ffmpeg", [
        ...["-hide_banner", "-loglevel", "error", "-y", "-filter_complex"],
        "smptebars=s=360x640:r=10:d=3,format=yuv420p[a];color=c=blue:s=360x640:r=10:d=3,format=yuv420p[b];[a][b]concat=n=2:v=1:a=0[v]",
        ...["-map", "[v]", "-c:v", "libx264", video],
      ]);
    });
    afterAll(() => rm(dir, { recursive: true, force: true }));

    it("sends a sheet and 3 frames in one ask and reads the verdict", async () => {
      const sent: { images: number; text: string }[] = [];
      const fetchFn = (async (_url: string, init: RequestInit) => {
        const body = JSON.parse(String(init.body)) as {
          contents: { parts: { inlineData?: unknown; text?: string }[] }[];
        };
        const parts = body.contents[0]?.parts ?? [];
        sent.push({
          images: parts.filter((x) => x.inlineData).length,
          text: parts.find((x) => x.text)?.text ?? "",
        });
        const answer = { pass: false, issues: [{ at: 3, rule: "pace", says: "Blue for 3 s." }] };
        return new Response(
          JSON.stringify({
            candidates: [{ content: { parts: [{ text: JSON.stringify(answer) }] } }],
          }),
        );
      }) as unknown as typeof fetch;
      const r = await checkRender(video, {
        format: "short",
        durationS: 6,
        words: [{ w: "hi", s: 0.5 }],
        geminiKeys: ["k"],
        ffmpeg: "ffmpeg",
        fetchFn,
      });
      expect(r).toEqual({ pass: false, issues: [{ at: 3, rule: "pace", says: "Blue for 3 s." }] });
      expect(sent).toHaveLength(1);
      expect(sent[0]?.images).toBe(4);
      expect(sent[0]?.text).toContain("0.5 hi");
      expect(sent[0]?.text).toMatch(/Scene cuts ffmpeg found \(s\): 3/);
    });
  });
});

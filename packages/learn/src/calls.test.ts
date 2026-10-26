import { describe, expect, it } from "vitest";
import { factRows, factSubject, ITEM_PATH, isFactCall } from "./calls.js";

const BREAKDOWN = {
  hookStyle: "contrarian" as const,
  hook: "Stop posting every day.",
  hookWhy: "It says the common advice is wrong.",
  topic: "posting cadence",
  beats: [
    { t: 0, beat: "The claim" },
    { t: 72, beat: "Proof" },
    { t: null, beat: "The ask" },
  ],
  ctaKind: "comment-word" as const,
  cta: "Comment PLAN.",
};

describe("fact calls", () => {
  it("names the item and each fact as a subject under it", () => {
    expect(factSubject(7, ITEM_PATH)).toBe("doc:7");
    expect(factSubject(7, "beats/2")).toBe("doc:7/beats/2");
    expect(isFactCall("tune")).toBe(true);
    expect(isFactCall("maybe")).toBe(false);
  });

  it("lists a post's facts in reading order, each whole, by a stable path", () => {
    const rows = factRows({
      ...BREAKDOWN,
      facts: { format: null, chars: 63, lines: 5, link: "body", hashtags: 2, shape: "list" },
    });
    expect(rows.map((r) => r.path)).toEqual([
      "hook_style",
      "hook",
      "topic",
      "beats/0",
      "beats/1",
      "beats/2",
      "cta",
      "facts/chars",
      "facts/lines",
      "facts/link",
      "facts/hashtags",
      "facts/shape",
    ]);
    expect(rows.find((r) => r.path === "beats/1")).toEqual({
      path: "beats/1",
      label: "Beat 2",
      value: "[1:12] Proof",
      proof: { t: 72 },
    });
    expect(rows.find((r) => r.path === "cta")?.value).toBe("comment-word: Comment PLAN.");
    expect(rows.find((r) => r.path === "facts/chars")?.label).toBe("Characters");
  });

  it("gives a film one row per shot and words for its counts", () => {
    const rows = factRows({
      ...BREAKDOWN,
      cta: null,
      facts: {
        duration_s: 20,
        cuts: 1,
        cuts_by_signal: { hash: 1, adaptive: 2, ffmpeg: 0 },
        cuts_trust: "ok",
        cuts_per_10s: [1, 0],
        music: true,
        vo: null,
        cta: "ignored: the shared cta row has it",
        shots: [
          { t: 0, len: 12.5, type: "product", move: "push", in: "cut", text: null, sound: null },
          { t: 12.5, len: 7.5, type: null, move: null, in: null, text: "Try it", sound: "hit" },
        ],
      },
    });
    const paths = rows.map((r) => r.path);
    expect(paths).toContain("facts/shots/0");
    expect(paths).toContain("facts/shots/1");
    expect(paths).not.toContain("facts/cta");
    expect(paths).not.toContain("facts/vo");
    expect(rows.find((r) => r.path === "facts/shots/0")?.value).toBe(
      "0:00 · 12.5 s · product · push · cut",
    );
    expect(rows.find((r) => r.path === "facts/shots/1")?.value).toBe("0:12 · 7.5 s · hit · Try it");
    expect(rows.find((r) => r.path === "facts/cuts_by_signal")?.value).toBe(
      "hash 1, adaptive 2, ffmpeg 0",
    );
    expect(rows.find((r) => r.path === "cta")?.value).toBe("comment-word");
  });
});

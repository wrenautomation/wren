import { describe, expect, it } from "vitest";
import { beatsOf, breakdownPrompt, breakdownSchema, HOOK_STYLE_ABOUT } from "./breakdown.js";
import { statsOf } from "./creators.js";
import { HOOK_STYLES } from "./schema.js";

describe("breakdown", () => {
  it("tells the model every hook style", () => {
    const p = breakdownPrompt({ title: "T", url: "https://x.example/1", text: "[0:00] Hi" });
    for (const h of HOOK_STYLES) expect(p).toContain(`- ${h}: ${HOOK_STYLE_ABOUT[h]}`);
  });

  it("places beats it can and keeps the rest unplaced", () => {
    expect(
      beatsOf([
        { at: "0:00", beat: "a" },
        { at: "1:05", beat: "b" },
        { at: "soon", beat: "c" },
        { beat: "d" },
      ]),
    ).toEqual([
      { t: 0, beat: "a" },
      { t: 65, beat: "b" },
      { t: null, beat: "c" },
      { t: null, beat: "d" },
    ]);
  });

  it("refuses a style outside the set", () => {
    const ok = {
      hook_style: "news",
      hook: "h",
      hook_why: "w",
      topic: "t",
      format: "mixed",
      beats: [{ beat: "b" }],
      cta_kind: "none",
    };
    expect(breakdownSchema.safeParse(ok).success).toBe(true);
    expect(breakdownSchema.safeParse({ ...ok, hook_style: "vibes" }).success).toBe(false);
  });

  it("keeps only the numbers a platform gave", () => {
    expect(statsOf({ likes: 12, comments: undefined, views: null })).toEqual({ likes: 12 });
    expect(statsOf({})).toBeNull();
    expect(statsOf({ likes: -1, views: 10.4 })).toEqual({ views: 10 });
  });
});

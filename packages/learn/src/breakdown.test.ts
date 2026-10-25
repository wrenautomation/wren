import { describe, expect, it } from "vitest";
import {
  answerSchema,
  beatsOf,
  breakdownPrompt,
  breakdownSchema,
  FACTS,
  factsOf,
  HOOK_STYLE_ABOUT,
  postCounts,
} from "./breakdown.js";
import { statsOf } from "./creators.js";
import { HOOK_STYLES } from "./schema.js";

describe("breakdown", () => {
  it("tells the model every hook style", () => {
    const p = breakdownPrompt({
      title: "T",
      url: "https://x.example/1",
      text: "[0:00] Hi",
    });
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
    expect(statsOf({ likes: 12, comments: undefined, views: null })).toEqual({
      likes: 12,
    });
    expect(statsOf({})).toBeNull();
    expect(statsOf({ likes: -1, views: 10.4 })).toEqual({ views: 10 });
  });
});

describe("kind rubrics", () => {
  it("counts a post from its text; a link in a comment is unknown, not none", () => {
    expect(
      postCounts("Stop doing this.\n\nThree fixes:\n1 a\n2 b\n\n#ops #sales https://x.y"),
    ).toEqual({
      chars: 63,
      lines: 5,
      first_line_chars: 16,
      link: "body",
      hashtags: 2,
    });
    expect(postCounts("one line, no tags").link).toBeNull();
    expect(postCounts("").lines).toBe(0);
  });

  it("asks each kind its own labels: a post its shape, a reel its format, a film neither", () => {
    const item = { title: "T", url: "https://x.example/1", text: "hi" };
    expect(breakdownPrompt({ ...item, kind: "post" })).toContain(
      "Shapes: list, story, essay, one-liner, thread.",
    );
    expect(breakdownPrompt({ ...item, kind: "post" })).not.toContain('"at"');
    expect(breakdownPrompt({ ...item, kind: "reel" })).toContain("Formats: talking-head");
    expect(breakdownPrompt({ ...item, kind: "film" })).not.toMatch(/Formats:|Shapes:/);
    expect(
      answerSchema("post").safeParse({
        hook_style: "news",
        hook: "h",
        hook_why: "w",
        topic: "t",
        shape: "list",
        beats: [{ beat: "b" }],
        cta_kind: "none",
      }).success,
    ).toBe(true);
    expect(
      answerSchema("film").safeParse({
        hook_style: "news",
        hook: "h",
        hook_why: "w",
        topic: "t",
        beats: [{ beat: "b" }],
        cta_kind: "none",
      }).success,
    ).toBe(true);
  });

  it("a film's facts come off its read page's fence; a page without one gives none", () => {
    const page = `# F\n\n## Speech\n\n(no speech)\n\n## On screen\n\n[0:00] Linear\n\n## Cuts\n\n(none)\n\n## Facts\n\n\`\`\`json\n${JSON.stringify({ duration_s: 20, audio: true, cuts_by: { ffmpeg: [], hash: [5, 10], adaptive: [5, 11] } })}\n\`\`\``;
    const v: Parameters<typeof factsOf>[1] = {
      hook_style: "demo-first",
      hook: "h",
      hook_why: "w",
      topic: "t",
      beats: [{ beat: "b" }],
      cta_kind: "none",
    };
    const f = factsOf({ kind: "film", text: "", transcript: page }, v);
    expect(f).toMatchObject({
      cuts: 2,
      cuts_trust: "ok",
      vo: false,
      shot_median_s: 5,
    });
    expect(FACTS.film.safeParse(f).success).toBe(true);
    expect(factsOf({ kind: "film", text: "", transcript: "# F\n\n## Speech\n\nhi" }, v)).toBeNull();
    expect(
      factsOf({ kind: "post", text: "a\nb", transcript: "" }, { ...v, shape: "list" }),
    ).toMatchObject({ format: null, lines: 2, shape: "list" });
  });
});

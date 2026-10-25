import { describe, expect, it } from "vitest";
import {
  callsMarkdown,
  kindStandard,
  type SopCall,
  scopeOf,
  standardMarkdown,
} from "./standard.js";

const SCOPE = { kinds: ["film"], platforms: [], topic: "launch", set: ["linear", "raycast"] };

const row = (o: Record<string, unknown>) =>
  ({
    id: 1,
    kind: "film",
    platform: "youtube",
    creator: "Linear",
    title: "t",
    reach: 100,
    at: new Date(0),
    by: "hand",
    hookStyle: "demo-first",
    ctaKind: "none",
    format: null,
    shape: null,
    link: null,
    chars: null,
    lines: null,
    firstLineChars: null,
    hashtags: null,
    durationS: null,
    cuts: null,
    shotMedianS: null,
    shotP90S: null,
    firstProductS: null,
    logoS: null,
    ctaS: null,
    cutsTrust: "ok",
    music: true,
    vo: false,
    calls: 0,
    ...o,
  }) as Parameters<typeof kindStandard>[1][number];

describe("the scope in notes.md", () => {
  it("reads kinds, platforms, topic and set off the front matter, lower-cased; none without kinds", () => {
    expect(
      scopeOf(
        '---\nkinds: film, Post\nplatforms: [YouTube]\ntopic: "launch films"\nset: Linear, raycast\n---\n# Notes',
      ),
    ).toEqual({
      kinds: ["film", "post"],
      platforms: ["youtube"],
      topic: "launch films",
      set: ["linear", "raycast"],
    });
    expect(scopeOf("---\nkinds:\nset: linear\n---\n")).toBeNull();
    expect(scopeOf("# Notes\n\nmine")).toBeNull();
  });
});

describe("the standard", () => {
  it("gives each number its median and middle half, trusted films only for cuts, and counts each closed set", () => {
    const rows = [
      row({ id: 1, durationS: "30", cuts: 10, shotMedianS: "2.5", cutsTrust: "ok" }),
      row({
        id: 2,
        durationS: "40",
        cuts: 12,
        shotMedianS: "3",
        cutsTrust: "ok",
        hookStyle: "story",
      }),
      row({ id: 3, durationS: "50", cuts: 99, shotMedianS: "0.4", cutsTrust: "low", music: false }),
      row({
        id: 4,
        durationS: "60",
        cuts: 14,
        shotMedianS: "3.5",
        cutsTrust: "ok",
        ctaKind: "link",
      }),
    ];
    const k = kindStandard("film", rows);
    expect(k.n).toBe(4);
    expect(k.trusted).toBe(3);
    expect(k.numbers.find((x) => x.label === "Length (s)")).toEqual({
      label: "Length (s)",
      n: 4,
      median: 45,
      p25: 37.5,
      p75: 52.5,
    });
    expect(k.numbers.find((x) => x.label === "Cuts")).toEqual({
      label: "Cuts",
      n: 3,
      median: 12,
      p25: 11,
      p75: 13,
    });
    expect(k.numbers.find((x) => x.label === "Logo (s)")).toBeUndefined();
    expect(k.shares.find((s) => s.label === "Hook style")?.of).toEqual([
      ["demo-first", 3],
      ["story", 1],
    ]);
    expect(k.shares.find((s) => s.label === "Music")?.of).toEqual([
      ["yes", 3],
      ["no", 1],
    ]);
    const md = standardMarkdown(SCOPE, [k], new Date("2026-10-25T12:00:00Z"));
    expect(md).toContain(
      "kinds film; platforms any; set linear, raycast: 4 pieces as of 2026-10-25",
    );
    expect(md).toContain("## film (4 pieces, 3 with a trusted cut count)");
    expect(md).toContain("- Length (s): median 45, half between 37.5 and 52.5");
    expect(md).toContain("- Cuts: median 12, half between 11 and 13 (3 of 4)");
    expect(md).toContain("- Hook style: demo-first 3, story 1 (of 4)");
    expect(standardMarkdown(SCOPE, [])).toContain("No pieces yet");
  });
});

describe("his calls as markdown", () => {
  const call = (o: Partial<SopCall>): SopCall => ({
    id: 1,
    title: "Linear launch",
    creator: "Linear",
    path: "hook_style",
    label: "Hook style",
    value: "demo-first",
    call: "keep",
    comment: null,
    at: new Date(0),
    ...o,
  });
  it("counts a pattern across pieces, marks a rule, and lists his words on a piece's own facts by call", () => {
    const md = callsMarkdown(
      SCOPE,
      [
        call({ id: 1 }),
        call({ id: 2, title: "Raycast 1.0", creator: "Raycast" }),
        call({ id: 3, title: "Cursor 2", creator: "Cursor", comment: "straight to the product" }),
        call({
          id: 4,
          title: "Slow one",
          creator: "X",
          path: "cta",
          label: "Call to action",
          value: "link: Try it free",
          call: "drop",
          comment: "no asks this early",
        }),
        call({
          id: 2,
          title: "Raycast 1.0",
          creator: "Raycast",
          path: "beats/0",
          label: "Beat 1",
          value: "[0:00] Logo",
          call: "tune",
          comment: "hold the product longer",
        }),
        call({
          id: 3,
          title: "Cursor 2",
          creator: "Cursor",
          path: "/",
          label: "Whole piece",
          value: "",
          call: "keep",
        }),
      ],
      new Date("2026-10-25T12:00:00Z"),
    );
    expect(md).toContain("## Patterns");
    expect(md).toContain(
      '- Hook style: demo-first: keep 3 → rule [learn:1, learn:2, learn:3] ("straight to the product" [learn:3])',
    );
    expect(md).toContain(
      '- Call to action: link: drop 1 [learn:4] ("no asks this early" [learn:4])',
    );
    expect(md).toContain("## Keep\n- Whole piece: Cursor 2, Cursor [learn:3]");
    expect(md).toContain(
      '## Tune: do this, with the change in his words\n- Beat 1 "[0:00] Logo" (Raycast 1.0, Raycast) "hold the product longer" [learn:2]',
    );
    expect(md).not.toContain("## Drop");
    expect(callsMarkdown(SCOPE, [])).toContain("No calls yet");
  });
});

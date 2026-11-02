import { describe, expect, it } from "vitest";
import type { VideoEdit, Word } from "./schema.js";
import { BEAT, beatSpans, boardChange, storyboardOf, storyboardText } from "./storyboard.js";

/** Sentences of `n` words, a word a second, each ending on a stop. */
function talk(sentences: number[], at = 0): Word[] {
  const out: Word[] = [];
  let t = at;
  sentences.forEach((n, k) => {
    for (let i = 0; i < n; i++) {
      out.push({ w: i === n - 1 ? `end${k}.` : i === 0 ? `Start${k}` : "word", s: t, e: t + 0.8 });
      t += 1;
    }
  });
  return out;
}

const edit = (o: Partial<VideoEdit> = {}): VideoEdit =>
  ({
    id: 1,
    title: "Synthetic take",
    state: "edited",
    dir: "/rec",
    tracks: { main: { path: "/rec/a.mp4", durationS: 120, width: 1920, height: 1080, fps: 30 } },
    script: null,
    words: talk([10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10]),
    cuts: [],
    layout: [],
    captions: { style: "word" },
    stress: [],
    shorts: [],
    formats: ["long"],
    description: "",
    chapters: [],
    tags: [],
    thumbnail: null,
    overlays: [],
    crops: {},
    looks: {},
    files: {},
    keys: {},
    render: null,
    createdAt: new Date(0),
    updatedAt: new Date(0),
    ...o,
  }) as VideoEdit;

describe("beats", () => {
  it("joins whole sentences into parts of about 30 s, covering the recording", () => {
    const spans = beatSpans(edit(), 120);
    expect(spans.length).toBe(4);
    expect(spans[0]?.from).toBe(0);
    expect(spans.at(-1)?.to).toBe(120);
    for (let i = 1; i < spans.length; i++) {
      expect(spans[i]?.from).toBe(spans[i - 1]?.to);
      // Each break sits in the gap before a sentence's first word.
      expect((spans[i]?.from as number) % 10).toBeCloseTo(9.9, 5);
      expect((spans[i]?.from as number) - (spans[i - 1]?.from as number)).toBeGreaterThanOrEqual(
        BEAT.partS,
      );
    }
  });

  it("takes the chapters when there are some, a lead-in before the first", () => {
    const sb = storyboardOf(
      edit({
        chapters: [
          { at: 40, title: "Middle" },
          { at: 80, title: "End" },
        ],
      }),
    );
    expect(sb.beats.map((b) => [b.key, b.from, b.to, b.title])).toEqual([
      ["chapter-1", 0, 40, null],
      ["chapter-2", 40, 80, "Middle"],
      ["chapter-3", 80, 120, "End"],
    ]);
  });

  it("cuts every 30 s when there are no words", () => {
    expect(beatSpans({ words: [], chapters: [] }, 95).map((s) => [s.from, s.to])).toEqual([
      [0, 30],
      [30, 60],
      [60, 95],
    ]);
  });

  it("says what each frame plays, cuts, shows and has on screen", () => {
    const sb = storyboardOf(
      edit({
        chapters: [
          { at: 0, title: "One" },
          { at: 30, title: "Two" },
          { at: 60, title: "Three" },
        ],
        cuts: [
          { from: 29.95, to: 60, why: "manual", state: "cut" },
          { from: 4.95, to: 7.9, why: "filler", state: "cut" },
          { from: 70, to: 72, why: "retake", state: "proposed" },
        ],
        layout: [{ from: 65, to: 200, show: "screen" }],
        overlays: [{ text: "Say this", from: 10, to: 12, x: 0.5, y: 0.2, size: "m" }],
      }),
    );
    const [one, two, three] = sb.beats;
    expect(one?.cut).toBe("some");
    expect(one?.struck).toBe("word word word");
    expect(one?.onScreen).toEqual(["Say this"]);
    expect(one?.layout).toEqual(["corner"]);
    expect(two?.cut).toBe("all");
    expect(two?.said).toBe("");
    expect(two?.onCut).toBeNull();
    expect(two?.at).toBe(30);
    // A proposed cut still plays.
    expect(three?.cut).toBe("none");
    expect(three?.layout).toEqual(["corner", "screen"]);
    expect(three?.at).toBe(60);
    expect(sb.cutS).toBeCloseTo(120 - 30.05 - 2.95, 1);
  });

  it("adds a frame per Short with its title card", () => {
    const sb = storyboardOf(
      edit({
        shorts: [
          { from: 0, to: 29.9, title: "First" },
          { from: 30, to: 59.9, title: "Second", card: false },
          { from: 60, to: 89.9, title: "Third", cardText: "Read this" },
        ],
      }),
    );
    expect(sb.shorts.map((b) => [b.key, b.onScreen])).toEqual([
      ["short-1", ["First"]],
      ["short-2", []],
      ["short-3", ["Read this"]],
    ]);
    const text = storyboardText(sb);
    expect(text).toContain('"Synthetic take"');
    expect(text).toContain("3 Shorts");
    expect(text).toContain("Short 2 [short-2]");
  });
});

describe("what a change moves", () => {
  it("marks only the frames that read differently, not ones a cut earlier shifts", () => {
    const before = storyboardOf(edit());
    const after = storyboardOf(edit({ cuts: [{ from: 4.9, to: 6, why: "manual", state: "cut" }] }));
    const moved = boardChange(before, after);
    expect(moved.beats).toEqual(["part-1"]);
    expect(moved.header).toEqual(["cutS"]);
    expect(moved.gone).toEqual([]);
  });

  it("names new and gone frames and header lines", () => {
    const before = storyboardOf(edit());
    const after = storyboardOf(
      edit({
        title: "New",
        captions: { style: "pill", long: "screen" },
        chapters: [{ at: 0, title: "All" }],
      }),
    );
    const moved = boardChange(before, after);
    expect(moved.header).toEqual(["title", "chapters", "captions"]);
    expect(moved.beats).toEqual(["chapter-1"]);
    expect(moved.gone).toEqual(["part-1", "part-2", "part-3", "part-4"]);
  });
});

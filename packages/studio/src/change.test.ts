import { describe, expect, it } from "vitest";
import {
  changeAnswerOf,
  changePrompt,
  changeSystem,
  checkChange,
  withCutChanges,
} from "./change.js";
import type { Cut, VideoEdit, Word } from "./schema.js";
import { storyboardOf } from "./storyboard.js";

/** Sentences of `n` words, a word a second, each ending on a stop. */
function talk(sentences: number[]): Word[] {
  const out: Word[] = [];
  let t = 0;
  sentences.forEach((n, k) => {
    for (let i = 0; i < n; i++) {
      out.push({ w: i === n - 1 ? `end${k}.` : i === 0 ? `Start${k}` : "word", s: t, e: t + 0.8 });
      t += 1;
    }
  });
  return out;
}

const filler: Cut = { from: 12.85, to: 13.9, why: "filler", state: "proposed" };
const silence: Cut = { from: 30.85, to: 30.95, why: "silence", state: "cut" };

const edit = (o: Partial<VideoEdit> = {}): VideoEdit =>
  ({
    id: 7,
    title: "Synthetic take",
    state: "edited",
    dir: "/rec",
    tracks: { main: { path: "/rec/a.mp4", durationS: 120, width: 1920, height: 1080, fps: 30 } },
    script: null,
    words: talk([25, 25, 25, 25, 20]),
    cuts: [silence, filler],
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

describe("the model's answer", () => {
  it("reads the first JSON object, prose around it or not", () => {
    expect(
      changeAnswerOf(
        'Sure:\n{"changes": [" Cut the um at 0:13. "], "patch": {"title": "A"}}\nDone',
      ),
    ).toEqual({ changes: ["Cut the um at 0:13."], patch: { title: "A" } });
    expect(changeAnswerOf('{"changes": ["Can\'t change caption size."], "patch": null}')).toEqual({
      changes: ["Can't change caption size."],
      patch: null,
    });
    expect(changeAnswerOf('{"changes": [], "patch": {}}')?.patch).toBeNull();
    expect(changeAnswerOf("I would cut the pause.")).toBeNull();
    expect(changeAnswerOf('{"changes": "one"}')).toBeNull();
  });
});

describe("checking a patch", () => {
  it("merges cut changes onto the cuts: a proposal by its ends, else a new manual cut", () => {
    const cuts = withCutChanges(
      [silence, filler],
      [
        { from: 12.85, to: 13.9, state: "cut" },
        { from: 50, to: 51, state: "cut" },
        { from: 60, to: 61, state: "kept" },
      ],
    );
    expect(cuts).toEqual([
      silence,
      { ...filler, state: "cut" },
      { from: 50, to: 51, why: "manual", state: "cut" },
    ]);
  });

  it("answers set's shape with what each field was, and drops what doesn't move", () => {
    const e = edit();
    const c = checkChange(e, {
      title: "Synthetic take",
      cuts: [{ from: 12.85, to: 13.9, state: "cut" }],
      overlays: [{ text: "Say this", from: 10, to: 12, x: 0.5, y: 0.2, size: "m" }],
    });
    expect(c.issues).toEqual([]);
    expect(Object.keys(c.patch ?? {}).sort()).toEqual(["cuts", "overlays"]);
    // In order, as a save keeps them.
    expect(c.patch?.cuts).toEqual([{ ...filler, state: "cut" }, silence]);
    expect(c.expect).toEqual({ cuts: [silence, filler], overlays: [] });
  });

  it("refuses what video set refuses, in its words", () => {
    const e = edit();
    expect(checkChange(e, { words: [] }).issues[0]).toMatch(/Unrecognized key/);
    expect(checkChange(e, { captions: { style: "huge" } }).issues[0]).toMatch(/^captions\.style/);
    expect(checkChange(e, { layout: [{ from: 50, to: 40, show: "cam" }] }).issues).toEqual([
      "layout[0]: to must be after from",
    ]);
    expect(checkChange(e, { shorts: [{ from: 0, to: 24.9, title: "One" }] }).issues).toEqual([
      "shorts: 1 picked; want 2 to 12",
    ]);
    expect(checkChange(e, { cuts: [{ from: 1, to: 2, state: "gone" }] }).issues[0]).toMatch(
      /^cuts:/,
    );
    expect(checkChange(e, { thumbnail: { at: 500, text: "x" } }).issues).toEqual([
      "thumbnail: past the end (120s)",
    ]);
  });

  it("snaps Shorts to whole sentences, as a save does", () => {
    const c = checkChange(edit(), {
      shorts: [
        { from: 1, to: 24.9, title: "One" },
        { from: 50, to: 74.9, title: "Three" },
      ],
    });
    expect(c.issues).toEqual([]);
    expect(c.snapped.map((m) => m.n)).toEqual([1]);
    expect(c.patch?.shorts?.[0]?.from).toBeLessThan(1);
  });

  it("is nothing when the model has no patch", () => {
    expect(checkChange(edit(), null)).toEqual({
      patch: null,
      expect: {},
      issues: [],
      snapped: [],
    });
  });
});

describe("the prompt", () => {
  it("holds the edit, the choices among the cuts, the storyboard and the frame meant", () => {
    const e = edit();
    const board = storyboardOf(e);
    const p = changePrompt(e, "tighter cut", { board, beat: board.beats[0] ?? null });
    expect(p).toContain('"title":"Synthetic take"');
    // Silence cuts are settled: only the filler is offered.
    expect(p).toContain('"why":"filler"');
    expect(p).not.toContain('"why":"silence"');
    expect(p).toContain("Part 1 [part-1]");
    expect(p).toContain("He means this frame (0:00-");
    expect(p.trimEnd().endsWith("He says: tighter cut")).toBe(true);
    const again = changePrompt(e, "tighter cut", { refused: ["shorts: 1 picked; want 2 to 12"] });
    expect(again).toContain("Your last patch was refused: shorts: 1 picked");
    expect(changeSystem()).toContain('"changes"');
  });
});

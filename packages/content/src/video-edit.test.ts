/** The editing agent's pass, steps and checks (designs/2026-10-13-video-review.md). Synthetic edits only. */
import type { VideoEdit } from "@wren/studio/schema";
import { describe, expect, it } from "vitest";
import {
  describeOutputs,
  editPrompt,
  passOf,
  previewCheck,
  RENDER_STALE_MS,
  renderRefusal,
  renderTimes,
  selfChecks,
  stepWhat,
  type VideoStep,
  videoChecks,
  videoEditDefault,
} from "./video-edit.js";

const word = (w: string, s: number) => ({ w, s, e: s + 0.4 });
const edit = (over: Partial<VideoEdit> = {}) =>
  ({
    id: 7,
    title: "A title",
    description: "Words",
    tags: [],
    chapters: [],
    shorts: [],
    thumbnail: null,
    cuts: [],
    words: [word("hello", 0), word("there", 1), word("friend", 2)],
    state: "rendered",
    render: null,
    files: { long: "/tmp/out/long.mp4" },
    tracks: { main: { durationS: 60 } },
    ...over,
  }) as unknown as VideoEdit;

const step = (over: Partial<VideoStep>): VideoStep => ({
  id: "x",
  command: "video set",
  by: "cli",
  at: "2026-10-13T10:00:00.000Z",
  state: "done",
  what: "",
  error: null,
  reply: null,
  notes: null,
  note: null,
  changed: false,
  check: null,
  ...over,
});

describe("passOf", () => {
  it("reads the agent's JSON, drops bad fixes, caps notes", () => {
    const p = passOf(
      `Sure. {"reply": "Fixed it.", "notes": ["a", " ", "b", "c", "d", "e", "f"], "words": [{"wrong": "tick tock", "right": "TikTok"}, {"wrong": "", "right": "x"}, {"wrong": "same", "right": "same"}, 3], "patch": {"title": "New"}}`,
    );
    expect(p.reply).toBe("Fixed it.");
    expect(p.notes).toEqual(["a", "b", "c", "d", "e"]);
    expect(p.words).toEqual([{ wrong: "tick tock", right: "TikTok" }]);
    expect(p.patch).toEqual({ title: "New" });
  });

  it("takes words alone as a reply that changes nothing", () => {
    expect(passOf("Looks good to me.")).toEqual({
      reply: "Looks good to me.",
      notes: [],
      words: [],
      patch: null,
    });
    expect(passOf('{"reply": "ok", "patch": {}}').patch).toBeNull();
  });
});

describe("editPrompt", () => {
  it("renders the shipped prompt with the id, his note and flagged cuts", () => {
    const e = edit({ cuts: [{ from: 0.5, to: 3.5, why: "silence", state: "cut" }] });
    const p = editPrompt(e, { by: "w@example.com", note: "Shorter title" });
    expect(p.question).toBe("w@example.com asks for changes: Shorter title");
    expect(p.system).toContain("video show 7");
    expect(p.system).toContain('"flagged":[{"from":0.5,"to":3.5');
    expect(p.commands).toEqual(["Bash(node scripts/prod-wren.mjs video show 7)"]);
    expect(p.system).toMatch(/The bar every cut[\s\S]*- private: Nothing private/);
    expect(editPrompt(e, { by: "x", note: null }).question).toBe("Do your pass on this video.");
    expect(videoEditDefault().version).toMatch(/^[0-9a-f]{12}$/);
  });
});

describe("renderRefusal", () => {
  const now = Date.parse("2026-10-13T12:00:00Z");
  it("lets a stale render go again and refuses an approved one", () => {
    expect(renderRefusal(edit(), now)).toBeNull();
    expect(renderRefusal(edit({ state: "approved" }), now)).toMatch(/approved/);
    expect(renderRefusal(edit({ state: "rejected" }), now)).toMatch(/rejected/);
    const at = new Date(now - 60_000).toISOString();
    expect(renderRefusal(edit({ render: { state: "rendering", at } }), now)).toMatch(/rendering/);
    const old = new Date(now - RENDER_STALE_MS - 1).toISOString();
    expect(renderRefusal(edit({ render: { state: "rendering", at: old } }), now)).toBeNull();
  });
});

describe("stepWhat", () => {
  it("says each run in a few words", () => {
    expect(stepWhat("video words", { wrong: "b2b", right: "B2B" }, null)).toBe(
      'Fixed "b2b" to "B2B"',
    );
    expect(
      stepWhat("video-edit", {}, { fixed: ["a", "b"], fields: ["title"], rendering: true }),
    ).toBe("Agent pass: fixed 2 words; changed title; queued a render");
    expect(stepWhat("video-edit", {}, {})).toBe("Agent pass");
    expect(stepWhat("video render", { upload: false }, {})).toBe("Rendered");
  });
});

describe("videoChecks", () => {
  const o = { chaptersShown: 0, lastChange: null, lastRender: null };
  const says = (c: ReturnType<typeof videoChecks>) => c.map((x) => `${x.tone}: ${x.say}`);

  it("flags a missing title, chapters YouTube ignores, and a change after the render", () => {
    const steps = [
      step({ command: "video render", at: "2026-10-13T10:00:00.000Z" }),
      step({ command: "video set", at: "2026-10-13T11:00:00.000Z", changed: true }),
    ];
    const c = videoChecks(edit({ title: "", chapters: [{ at: 0, title: "Intro" }] }), {
      ...o,
      ...renderTimes(steps),
    });
    expect(says(c)).toEqual([
      "bad: No title yet.",
      "good: It has a description.",
      "warn: YouTube won't show these chapters. It needs 3 or more, 10 seconds apart, the first at 0:00.",
      "warn: Changed since the last render. Render again to see it.",
    ]);
  });

  it("says the preview is current, and counts proposed and flagged cuts", () => {
    const steps = [
      step({ command: "video set", at: "2026-10-13T09:00:00.000Z", changed: true }),
      step({ command: "video render", at: "2026-10-13T10:00:00.000Z" }),
    ];
    const c = videoChecks(
      edit({
        cuts: [
          { from: 0.2, to: 0.9, why: "filler", state: "proposed" },
          { from: 1.1, to: 1.9, why: "manual", state: "cut" },
        ],
      }),
      { ...o, chaptersShown: 3, ...renderTimes(steps) },
    );
    expect(says(c)).toContain("good: YouTube will show 3 chapters.");
    expect(says(c)).toContain("warn: 1 proposed cut waits on Keep or Cut.");
    expect(says(c)).toContain("warn: 1 cut is long or touches a word. Look at it under Cuts.");
    expect(says(c)).toContain("good: The preview is the latest render.");
  });

  it("warns about Shorts that start or end mid-sentence", () => {
    const words = ["One", "two", "three.", "Four", "five", "six."].map((w, i) => word(w, i));
    const tracks = { main: { path: "/m.mp4", durationS: 10, width: 1920, height: 1080, fps: 30 } };
    const shorts = [
      { from: 0, to: 2.9, title: "a" },
      { from: 1, to: 5.9, title: "b" },
    ];
    expect(says(videoChecks(edit({ words, shorts, tracks }), o))).toContain(
      "warn: 1 Short starts or ends mid-sentence. Save the Shorts again to snap it to whole sentences.",
    );
  });

  it("says a stale render stopped, and a video never rendered", () => {
    const at = new Date(Date.now() - RENDER_STALE_MS - 1).toISOString();
    expect(says(videoChecks(edit({ render: { state: "rendering", at } }), o))).toContain(
      "bad: The render stopped reporting. Render it again.",
    );
    expect(says(videoChecks(edit({ files: {}, state: "edited" }), o))).toContain(
      "warn: Not rendered yet.",
    );
  });

  it("tells the preview when it is older than the last change", () => {
    const e = edit({ files: { long: "long.mp4" }, state: "rendered" });
    const older = previewCheck(e, {
      lastChange: "2026-10-14T12:00:00Z",
      lastRender: "2026-10-14T11:00:00Z",
    });
    expect(older?.say).toBe("Changed since the last render. Render again to see it.");
    const latest = previewCheck(e, {
      lastChange: "2026-10-14T10:00:00Z",
      lastRender: "2026-10-14T11:00:00Z",
    });
    expect(latest?.say).toBe("The preview is the latest render.");
  });

  it("names the outputs that moved on once hashes can tell", () => {
    const e = edit({ files: { long: "long.mp4" }, state: "rendered" });
    const o = { lastChange: "2026-10-14T10:00:00Z", lastRender: "2026-10-14T11:00:00Z" };
    expect(previewCheck(e, { ...o, stale: ["long", "short-2"] })?.say).toBe(
      "Changed since the last render: Long and Short 2. Render again to see it.",
    );
    // The hashes win over the clock, both ways.
    expect(previewCheck(e, { ...o, lastChange: "2026-10-14T12:00:00Z", stale: [] })?.say).toBe(
      "The preview is the latest render.",
    );
    expect(previewCheck(e, { ...o, stale: null })?.say).toBe("The preview is the latest render.");
  });
});

describe("describeOutputs", () => {
  it("reads like a sentence", () => {
    expect(describeOutputs(["long"])).toBe("Long");
    expect(describeOutputs(["vertical", "long"])).toBe("9:16 and Long");
    expect(describeOutputs(["short-3", "short-1", "long"])).toBe("Long and Shorts 1 and 3");
    expect(describeOutputs(["square", "portrait", "short-2"])).toBe("1:1, 4:5 and Short 2");
    expect(describeOutputs(["thumb-1", "thumb-2", "thumb-3"])).toBe("the thumbnails");
    expect(describeOutputs([])).toBe("");
  });
});

describe("selfChecks", () => {
  const verdict = (
    output: string,
    hash: string | null,
    issues: { at: number; rule: string; says: string }[] = [],
  ) =>
    step({
      command: "video check",
      check: { output, hash, pass: !issues.length, issues },
    });
  const files = {
    long: "/o/long.mp4",
    "long.hash": "h1",
    "short-1": "/o/short-1.mp4",
    "short-1.hash": "s1",
    "short-2": "/o/short-2.mp4",
    "short-2.hash": "s2",
    "thumb-1": "/o/thumb-1.jpg",
  };

  it("shows the newest verdict on this render, red on a fail, and what is not checked", () => {
    const steps = [
      verdict("long", "h0", [{ at: 1, rule: "face", says: "Old render." }]),
      verdict("long", "h1"),
      verdict("short-1", "s1", [
        { at: 2, rule: "face", says: "The head is cut at the top." },
        { at: 5, rule: "text", says: "The title sits under the like button." },
        { at: 9, rule: "pace", says: "The picture holds still for 14 s." },
        { at: 30, rule: "best", says: "It ends before its point." },
      ]),
    ];
    expect(selfChecks(files, steps).map((c) => `${c.tone}: ${c.say}`)).toEqual([
      "bad: Short 1 failed the self-check: at 2.0 s, The head is cut at the top. at 5.0 s, The title sits under the like button. at 9.0 s, The picture holds still for 14 s. And 1 more.",
      "good: Long passed the self-check.",
      "neutral: Not self-checked yet: Short 2.",
    ]);
  });

  it("drops a verdict on an older render of the same output", () => {
    const c = selfChecks(files, [verdict("short-2", "old")]);
    expect(c.at(-1)?.say).toBe("Not self-checked yet: Long and Shorts 1 and 2.");
  });

  it("names a check in the steps", () => {
    expect(stepWhat("video check", { output: "short-2" }, { pass: false, issues: [{}, {}] })).toBe(
      "Checked Short 2: 2 to fix",
    );
  });
});

import { describe, expect, it } from "vitest";
import {
  changedSince,
  cutHash,
  digest,
  hasHashes,
  hashFiles,
  hashKey,
  isWanted,
  outputHashes,
} from "./render-hash.js";
import type { VideoEdit } from "./schema.js";

/** A 100 s recording, a word every 0.4 s, two Shorts, a cover frame; long and Short captions burned in. */
const base = (): VideoEdit =>
  ({
    id: 7,
    title: "A talk",
    description: "About the talk",
    tags: [],
    chapters: [],
    state: "edited",
    formats: ["long", "vertical"],
    tracks: { main: { path: "/m.mp4", durationS: 100, width: 1920, height: 1080, fps: 30 } },
    cuts: [{ from: 10, to: 12, why: "silence", state: "cut" }],
    words: Array.from({ length: 240 }, (_, i) => ({ w: `w${i}`, s: i * 0.4, e: i * 0.4 + 0.3 })),
    layout: [],
    captions: { style: "word", long: "screen", short: "screen" },
    stress: [],
    shorts: [
      { from: 20, to: 45, title: "First" },
      { from: 50, to: 80, title: "Second" },
    ],
    overlays: [],
    crops: {},
    thumbnail: { at: 30, text: "Words" },
    files: { cutMain: "/d/cut-main.mp4" },
    keys: {},
  }) as unknown as VideoEdit;

const hashes = (e: VideoEdit) => outputHashes(e);
/** The outputs whose hash differs between two versions of the edit. */
const changed = (a: VideoEdit, b: Partial<VideoEdit>) => {
  const was = hashes(a);
  const now = hashes({ ...a, ...b });
  return Object.keys(now).filter((k) => now[k] !== was[k]);
};
const VIDEOS = ["long", "vertical", "square", "portrait", "short-1", "short-2"];

describe("outputHashes", () => {
  it("names every output the edit can render", () => {
    expect(Object.keys(hashes(base())).sort()).toEqual(
      [...VIDEOS, "thumb-1", "thumb-2", "thumb-3"].sort(),
    );
    expect(Object.keys(hashes({ ...base(), thumbnail: null }))).not.toContain("thumb-1");
    expect(Object.keys(hashes({ ...base(), shorts: [] }))).not.toContain("short-1");
  });

  it("is nothing before the first cut pass", () => {
    expect(hashes({ ...base(), files: {} })).toEqual({});
  });

  it("gives the same hash for the same edit, however its keys sit", () => {
    const e = base();
    expect(hashes(e)).toEqual(hashes(JSON.parse(JSON.stringify(e))));
    expect(digest({ a: 1, b: { c: 2, d: 3 } })).toBe(digest({ b: { d: 3, c: 2 }, a: 1 }));
    expect(digest({ a: 1 })).not.toBe(digest({ a: 2 }));
  });

  it("leaves everything alone for words nothing draws", () => {
    const e = base();
    expect(changed(e, { title: "Another title" })).toEqual([]);
    expect(
      changed(e, { description: "Other", tags: ["x"], chapters: [{ at: 0, title: "c" }] }),
    ).toEqual([]);
    expect(changed(e, { formats: ["long"] })).toEqual([]);
  });

  it("takes a title into the cover only when the cover has no words of its own", () => {
    const e = { ...base(), thumbnail: { at: 30, text: "" } };
    expect(changed(e, { title: "Another title" }).sort()).toEqual([
      "thumb-1",
      "thumb-2",
      "thumb-3",
    ]);
  });

  it("moves every video when a cut changes, and the cover with it", () => {
    const e = base();
    const cuts = [{ from: 10, to: 13, why: "silence", state: "cut" }] as VideoEdit["cuts"];
    expect(changed(e, { cuts }).sort()).toEqual(
      [...VIDEOS, "thumb-1", "thumb-2", "thumb-3"].sort(),
    );
  });

  it("moves every video for text on the video", () => {
    const overlays = [
      { text: "Hi", from: 5, to: 8, x: 0.5, y: 0.5, size: "m" },
    ] as VideoEdit["overlays"];
    // Only the part of it inside a Short touches that Short.
    expect(changed(base(), { overlays }).sort()).toEqual([
      "long",
      "portrait",
      "square",
      "vertical",
    ]);
    const inside = [
      { text: "Hi", from: 25, to: 28, x: 0.5, y: 0.5, size: "m" },
    ] as VideoEdit["overlays"];
    expect(changed(base(), { overlays: inside }).sort()).toEqual([
      "long",
      "portrait",
      "short-1",
      "square",
      "vertical",
    ]);
  });

  it("changes a crop's own format alone", () => {
    expect(changed(base(), { crops: { square: { x: 0.3, y: 0.5 } } })).toEqual(["square"]);
    expect(changed(base(), { crops: { vertical: { x: 0.3, y: 0.5 } } })).toContain("vertical");
  });

  it("changes the Short whose own crop moved, and every Short for the vertical one", () => {
    const own = { shorts: { "2": { x: 0.3, y: 0.5 } } };
    expect(changed(base(), { crops: own })).toEqual(["short-2"]);
    expect(changed(base(), { crops: { vertical: { x: 0.3, y: 0.5 } } }).sort()).toEqual([
      "short-1",
      "short-2",
      "vertical",
    ]);
    // A Short with its own crop doesn't follow the vertical one.
    const withOwn = { ...base(), crops: own } as VideoEdit;
    expect(changed(withOwn, { crops: { ...own, vertical: { x: 0.3, y: 0.5 } } }).sort()).toEqual([
      "short-1",
      "vertical",
    ]);
  });

  it("changes the one Short a pick changes", () => {
    const e = base();
    const shorts = [e.shorts[0], { ...e.shorts[1], to: 85 }] as VideoEdit["shorts"];
    expect(changed(e, { shorts })).toEqual(["short-2"]);
    const retitled = [e.shorts[0], { ...e.shorts[1], title: "Renamed" }] as VideoEdit["shorts"];
    // Its opening card says the title.
    expect(changed(e, { shorts: retitled })).toEqual(["short-2"]);
    const quiet = [{ ...e.shorts[0], card: false }, e.shorts[1]] as VideoEdit["shorts"];
    expect(changed(e, { shorts: quiet })).toEqual(["short-1"]);
    // With the card off and the words elsewhere, the title alone draws nothing.
    const off = {
      ...e,
      shorts: [{ ...e.shorts[0], card: false }, e.shorts[1]] as VideoEdit["shorts"],
    };
    const offRenamed = [{ ...off.shorts[0], title: "Other" }, off.shorts[1]] as VideoEdit["shorts"];
    expect(changed(off, { shorts: offRenamed })).toEqual([]);
  });

  it("redoes a Short and the long video for a fixed word, not the Short beside it", () => {
    const e = base();
    // 25.2 s on the recording is inside Short 1 (20 to 45); the cut at 10 to 12 moves it on the cut.
    const words = e.words.map((w, i) => (i === 63 ? { ...w, w: "fixed" } : w));
    expect(changed(e, { words }).sort()).toEqual([
      "long",
      "portrait",
      "short-1",
      "square",
      "vertical",
    ]);
  });

  it("follows each format's own caption settings", () => {
    const e = base();
    expect(changed(e, { captions: { ...e.captions, place: { long: 0.5 } } })).toEqual(["long"]);
    expect(changed(e, { captions: { ...e.captions, place: { short: 0.5 } } }).sort()).toEqual([
      "portrait",
      "short-1",
      "short-2",
      "square",
      "vertical",
    ]);
    expect(changed(e, { captions: { ...e.captions, style: "pill" } }).sort()).toEqual(
      [...VIDEOS].sort(),
    );
    // Long captions off the picture: the style and height don't reach it.
    const track = { ...e, captions: { style: "word", short: "screen" as const } };
    expect(changed(track, { captions: { ...track.captions, style: "pill" } })).not.toContain(
      "long",
    );
    expect(changed(track, { captions: { ...track.captions, place: { long: 0.5 } } })).toEqual([]);
    // Short captions off: the Shorts and formats don't draw the words, so a fix doesn't redo them.
    const off = {
      ...e,
      captions: { style: "word", long: "screen" as const, short: "track" as const },
    };
    const words = e.words.map((w, i) => (i === 63 ? { ...w, w: "fixed" } : w));
    expect(changed(off, { words })).toEqual(["long"]);
  });

  it("redoes the long video for a fixed word even when its captions are not on the picture", () => {
    // The subtitle file is written with the long render, so the words stay in its hash.
    const e = { ...base(), captions: { style: "word", short: "track" } } as VideoEdit;
    const words = e.words.map((w, i) => (i === 63 ? { ...w, w: "fixed" } : w));
    expect(changed(e, { words })).toEqual(["long"]);
  });

  it("reads stressed words only where a style or the words behind use them", () => {
    const e = base();
    expect(changed(e, { stress: [63] })).toEqual([]);
    const stress = { ...e, captions: { ...e.captions, style: "stress" } };
    expect(changed(stress, { stress: [63] }).sort()).toEqual(
      ["long", "portrait", "short-1", "square", "vertical"].sort(),
    );
    const behind = { ...e, captions: { ...e.captions, behind: true } };
    expect(changed(behind, { stress: [63] })).toContain("short-1");
  });

  it("moves the cover for its frame and words, no video", () => {
    const e = base();
    expect(changed(e, { thumbnail: { at: 31, text: "Words" } }).sort()).toEqual([
      "thumb-1",
      "thumb-2",
      "thumb-3",
    ]);
    expect(changed(e, { thumbnail: { at: 30, text: "Other" } })).toHaveLength(3);
  });

  it("changes every output when the camera file or recording changes", () => {
    const e = base();
    const tracks = { main: { ...e.tracks.main, path: "/other.mp4" } };
    expect(changed(e, { tracks }).length).toBe(Object.keys(hashes(e)).length);
  });
});

describe("cutHash", () => {
  it("follows the cuts and the recordings, nothing else", () => {
    const e = base();
    const was = cutHash(e);
    expect(cutHash({ ...e, title: "x", captions: { style: "pill" }, words: [] })).toBe(was);
    expect(cutHash({ ...e, cuts: [] })).not.toBe(was);
    expect(cutHash({ ...e, tracks: { main: { ...e.tracks.main, durationS: 99 } } })).not.toBe(was);
  });
});

describe("changedSince", () => {
  const rendered = (e: VideoEdit): VideoEdit => ({
    ...e,
    files: {
      ...e.files,
      ...Object.fromEntries(VIDEOS.map((n) => [n, `/d/out/${n}.mp4`])),
      ...hashFiles(hashes(e), VIDEOS),
    },
  });

  it("can't tell for a render from before hashes, or before a cut", () => {
    const e = base();
    expect(hasHashes(e.files)).toBe(false);
    expect(changedSince({ ...e, files: { ...e.files, long: "/d/out/long.mp4" } })).toBeNull();
    expect(changedSince({ ...e, files: {} })).toBeNull();
  });

  it("lists the rendered outputs that moved on", () => {
    const e = rendered(base());
    expect(hasHashes(e.files)).toBe(true);
    expect(changedSince(e)).toEqual([]);
    const moved = { ...e, crops: { vertical: { x: 0.2, y: 0.5 } } } as VideoEdit;
    // The Shorts follow the vertical crop unless they have their own.
    expect(changedSince(moved)).toEqual(["vertical", "short-1", "short-2"]);
    const square = {
      ...e,
      formats: ["long", "vertical", "square"],
      crops: { square: { x: 0.2, y: 0.5 } },
    };
    expect(changedSince(square as VideoEdit)).toEqual(["square"]);
    const reshort = {
      ...e,
      shorts: [e.shorts[0], { ...e.shorts[1], to: 90 }],
    } as VideoEdit;
    expect(changedSince(reshort)).toEqual(["short-2"]);
  });

  it("counts a rendered output with no hash as out of date, an unrendered one as not rendered", () => {
    const e = rendered(base());
    const { [hashKey("short-1")]: _h, ...files } = e.files;
    expect(changedSince({ ...e, files })).toEqual(["short-1"]);
    const { "short-2": _f, [hashKey("short-2")]: _g, ...rest } = e.files;
    expect(changedSince({ ...e, files: rest })).toEqual([]);
  });

  it("leaves out a format the edit no longer makes", () => {
    const e = rendered({ ...base(), formats: ["long", "vertical", "square"] });
    const changedFormat = {
      ...e,
      formats: ["long"],
      crops: { vertical: { x: 0.2, y: 0.5 } },
    } as VideoEdit;
    expect(isWanted(changedFormat, "vertical")).toBe(false);
    expect(changedSince(changedFormat)).toEqual(["short-1", "short-2"]);
  });
});

describe("hashFiles", () => {
  it("keeps a hash beside each file", () => {
    expect(hashFiles({ long: "a", "short-1": "b" }, ["long"])).toEqual({ "long.hash": "a" });
    expect(hashFiles({ long: "a" }, ["long", "nothing"])).toEqual({ "long.hash": "a" });
  });
});

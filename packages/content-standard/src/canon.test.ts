import type { Loaded } from "@wrenautomation/knowledge";
import { describe, expect, it } from "vitest";
import { callsOf, piecesOf, platformOf, verdictsOf } from "./canon.js";

const reel = (over: Record<string, unknown> = {}) => ({
  hookStyle: "contrarian",
  hook: "Synthetic hook line.",
  hookWhy: "It contradicts a belief.",
  topic: "synthetic topic",
  kind: "reel",
  facts: { format: "talking-head" },
  beats: [{ t: 0, beat: "open" }],
  ctaKind: "follow",
  cta: "Follow for more",
  by: "model",
  at: "2026-11-01T00:00:00Z",
  ...over,
});

const doc = (fm: Record<string, unknown>, path = `sources/${fm.id}.md`): Loaded =>
  ({ path, doc: { fm, body: "" } }) as unknown as Loaded;

const source = (id: string, fm: Record<string, unknown> = {}) =>
  doc({ id, type: "source", status: "live", title: id, breakdown: reel(), ...fm });

const verdict = (id: string, cites: string, call: string, fm: Record<string, unknown> = {}) =>
  doc({ id, type: "verdict", status: "live", from: "owner", cites: [cites], call, ...fm });

describe("platformOf", () => {
  it("takes the source's own platform, else the URL's host", () => {
    expect(platformOf({ platform: "instagram", url: "https://youtube.com/x" })).toBe("instagram");
    expect(platformOf({ url: "https://www.youtube.com/watch?v=1" })).toBe("youtube");
    expect(platformOf({ url: "https://youtu.be/1" })).toBe("youtube");
    expect(platformOf({ url: "https://twitter.com/a" })).toBe("x");
    expect(platformOf({ url: "not a url" })).toBeNull();
    expect(platformOf({})).toBeNull();
  });
});

describe("verdictsOf", () => {
  it("keeps the newest owner call per source and path; others are skipped", () => {
    const by = verdictsOf([
      verdict("v1", "s1", "keep", { at: "2026-11-01" }),
      verdict("v2", "s1", "drop", { at: "2026-11-02" }),
      verdict("v3", "s1", "tune", { at: "2026-11-03", path: "/hook" }),
      verdict("v4", "s1", "keep", { at: "2026-11-09", from: "agent" }),
      verdict("v5", "s1", "keep", { at: "2026-11-09", status: "retired" }),
      verdict("v6", "s1", "maybe", { at: "2026-11-09" }),
    ]);
    expect(by.get("s1")?.get("/")?.call).toBe("drop");
    expect(by.get("s1")?.get("/hook")?.call).toBe("tune");
    expect(by.get("s1")?.size).toBe(2);
  });
});

describe("piecesOf", () => {
  it("rows every live source with a breakdown; a piece counts once picked", () => {
    const pieces = piecesOf([
      source("hand", { breakdown: reel({ by: "hand" }) }),
      source("saved", { saved: true, stats: { views: 900 } }),
      source("fed", { feed: { name: "Synth Feed" }, stats: { likes: 10, comments: 5 } }),
      source("kept"),
      verdict("v-kept", "kept", "keep"),
      source("dropped", { saved: true }),
      verdict("v-dropped", "dropped", "drop"),
      source("unpicked"),
      source("retired", { status: "retired" }),
      source("bare", { breakdown: undefined }),
      source("odd", { breakdown: reel({ kind: "podcast" }) }),
    ]);
    const picked = Object.fromEntries(pieces.map((p) => [p.row.id, p.picked]));
    expect(picked).toEqual({
      hand: true,
      saved: true,
      fed: true,
      kept: true,
      dropped: false,
      unpicked: false,
    });
    const rows = Object.fromEntries(pieces.map((p) => [p.row.id, p.row]));
    expect(rows.saved?.reach).toBe(900);
    expect(rows.fed?.reach).toBe(15);
    expect(rows.fed?.creator).toBe("Synth Feed");
    expect(rows.hand?.by).toBe("hand");
    expect(rows.kept?.format).toBe("talking-head");
  });
});

describe("callsOf", () => {
  it("lists his calls on pieces in scope or tagged with the SOP, on paths the breakdown has", () => {
    const docs = [
      source("in", { platform: "instagram", saved: true }),
      source("tagged", { platform: "youtube", tags: ["synth-sop"] }),
      source("out", { platform: "youtube" }),
      verdict("a", "in", "keep", { comment: "good open" }),
      verdict("b", "tagged", "drop"),
      verdict("c", "out", "keep"),
      verdict("d", "in", "tune", { path: "/not/a/path" }),
    ];
    const scope = { kinds: ["reel"], platforms: ["instagram"], topic: "", set: [] };
    const calls = callsOf(docs, piecesOf(docs), [scope], "synth-sop");
    expect(calls.map((c) => [c.id, c.path, c.call, c.comment])).toEqual([
      ["in", "/", "keep", "good open"],
      ["tagged", "/", "drop", null],
    ]);
    expect(calls[0]?.label).toBe("Whole piece");
  });
});

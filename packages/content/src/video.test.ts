import { parseKind } from "@wren/core/slots";
import { defaultFile } from "@wren/core/templates/defaults";
import { describe, expect, it } from "vitest";
import {
  chapterLines,
  clock,
  cutSeconds,
  fillFooter,
  longOf,
  markWords,
  numbered,
  VIDEO_FOOTERS,
  type VideoFooter,
  videoRef,
  videoSlug,
  withFooter,
} from "./video.js";

/** A footer's shipped default, parsed. */
const shipped = (which: VideoFooter) => {
  const f = defaultFile(VIDEO_FOOTERS[which]);
  if (!f) throw new Error(`no default for ${which}`);
  return parseKind("post", VIDEO_FOOTERS[which].name, f.source);
};

describe("videos", () => {
  it("reads numbered outputs in order, from 0 or 1, whatever the separator", () => {
    const files = {
      cutMain: "/v/cut-main.mp4",
      short2: "/v/s2.mp4",
      "short-1": "/v/s1.mp4",
      short10: "/v/s10.mp4",
      thumb_0: "/v/t0.png",
      thumbnail1: "/v/t1.png",
    };
    expect(numbered(files, "short")).toEqual(["/v/s1.mp4", "/v/s2.mp4", "/v/s10.mp4"]);
    expect(numbered(files, "thumb")).toEqual(["/v/t0.png", "/v/t1.png"]);
    expect(longOf({ long: "a", preview: "b" })).toBe("a");
    expect(longOf({ preview: "b" })).toBe("b");
    expect(longOf({})).toBeNull();
  });

  it("strikes words under applied and proposed cuts, never kept ones", () => {
    const words = [
      { w: "so", s: 0, e: 0.4 },
      { w: "um", s: 1, e: 1.2 },
      { w: "like", s: 2, e: 2.3 },
      { w: "this", s: 3, e: 3.4 },
    ];
    const cuts = [
      { from: 0.9, to: 1.3, why: "silence", state: "cut" },
      { from: 1.9, to: 2.4, why: "filler", state: "proposed" },
      { from: 2.9, to: 3.5, why: "manual", state: "kept" },
    ] as const;
    expect(markWords(words, [...cuts]).map((w) => w.cut)).toEqual([null, "cut", "proposed", null]);
    expect(cutSeconds([...cuts])).toBeCloseTo(0.4);
  });

  it("names lengths and refs", () => {
    expect(clock(492.4)).toBe("8:12");
    expect(clock(59.6)).toBe("1:00");
    expect(videoRef(3)).toBe("video:3");
    expect(videoRef(3, 2)).toBe("video:3/short:2");
  });

  it("writes chapters on the cut timeline, or none YouTube would ignore", () => {
    const tracks = { main: { path: "/v.mp4", durationS: 120, width: 1920, height: 1080, fps: 30 } };
    const cuts = [{ from: 10, to: 20, why: "silence", state: "cut" }] as const;
    const chapters = [
      { at: 2, title: "Intro" },
      { at: 30, title: "Setup" },
      { at: 15, title: "Inside a cut" },
      { at: 90, title: "Wrap" },
    ];
    expect(chapterLines({ tracks, cuts: [...cuts], chapters })).toBe(
      "0:00 Intro\n0:10 Inside a cut\n0:20 Setup\n1:20 Wrap",
    );
    expect(chapterLines({ tracks, cuts: [], chapters: chapters.slice(0, 2) })).toBe("");
    expect(
      chapterLines({ tracks, cuts: [], chapters: [...chapters, { at: 35, title: "Too close" }] }),
    ).toBe("");
  });

  it("slugs a video for its links: id, then title words, 40 characters at most", () => {
    expect(videoSlug({ id: 12, title: "How I'd fix cold email, with AI" })).toBe(
      "12-how-id-fix-cold-email-with-ai",
    );
    expect(videoSlug({ id: 3, title: "" })).toBe("3");
    expect(videoSlug({ id: 7, title: "Café ads: Ünder $5?" })).toBe("7-cafe-ads-under-5");
    const long = videoSlug({ id: 1, title: "one two three four five six seven eight nine ten" });
    expect(long.length).toBeLessThanOrEqual(40);
    expect(long).toBe("1-one-two-three-four-five-six-seven");
    // Every slug passes the lander's /go/ word check.
    expect(long).toMatch(/^[a-z0-9][a-z0-9._-]{0,79}$/);
  });

  it("fills the long footer: site, then booking, then socials, then the bio", () => {
    const text = fillFooter(shipped("long"), { id: 12, title: "Cold email" });
    const lines = text.split("\n").filter(Boolean);
    expect(lines.slice(0, 2)).toEqual([
      "Website: https://wrenautomation.com/go/yt/12-cold-email",
      "Book a call: https://wrenautomation.com/go/yt/12-cold-email/book?to=/book/reactivation",
    ]);
    expect(lines.slice(2, 6).map((l) => l.split(":")[0])).toEqual([
      "LinkedIn",
      "Instagram",
      "X",
      "TikTok",
    ]);
    expect(lines[6]).toMatch(/^I'm Will, a software engineering student at Waterloo/);
    expect(lines[6]).toMatch(/Subscribe to follow along\.$/);
    expect(lines).toHaveLength(7);
    expect(text).not.toMatch(/[{}\u2014\u2013]/);
  });

  it("keeps the Short and Reel footers plain: no links to click", () => {
    const short = fillFooter(shipped("short"), { id: 1, title: "x" });
    const reel = fillFooter(shipped("reel"), { id: 1, title: "x" });
    expect(short.split("\n")[0]).toBe("wrenautomation.com");
    expect(reel.split("\n")[0]).toBe("wrenautomation.com, link in bio");
    for (const t of [short, reel]) expect(t).not.toMatch(/https?:/);
    expect(fillFooter(null, { id: 1, title: "x" })).toBe("");
  });

  it("puts the footer after the words, a blank line between, never cut", () => {
    expect(withFooter(["About.", "", "0:00 Start"], "Site", 5000)).toBe(
      "About.\n\n0:00 Start\n\nSite",
    );
    expect(withFooter(["About."], "  ", 5000)).toBe("About.");
    expect(withFooter(["x".repeat(30)], "Footer.", 20)).toBe("xxxxxxxxxxx\n\nFooter.");
  });
});

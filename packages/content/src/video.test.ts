import { parseKind } from "@wren/core/slots";
import { describe, expect, it } from "vitest";
import {
  alsoText,
  chapterLines,
  clipWords,
  clock,
  cutSeconds,
  excerpt,
  fillFooter,
  leadOf,
  longOf,
  looksOf,
  markWords,
  numbered,
  tidy,
  tiktokFields,
  VIDEO_FOOTERS,
  type VideoFooter,
  videoRef,
  videoSlug,
  withFooter,
} from "./video.js";

/** A footer as the store would hold it: made-up words, parsed as a post. Wren ships none. */
const footer = (which: VideoFooter, words: string) =>
  parseKind("post", VIDEO_FOOTERS[which].name, words);

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

  it("fills the long footer's video slot in every link, line by line", () => {
    const tpl = footer(
      "long",
      [
        "Website: https://site.example/go/yt/{video}",
        "Book a call: https://site.example/go/yt/{video}/book?to=/book/demo",
        "",
        "About the channel, in my words.",
      ].join("\n"),
    );
    const text = fillFooter(tpl, { id: 12, title: "Cold email" });
    expect(text.split("\n")).toEqual([
      "Website: https://site.example/go/yt/12-cold-email",
      "Book a call: https://site.example/go/yt/12-cold-email/book?to=/book/demo",
      "",
      "About the channel, in my words.",
    ]);
    expect(text).not.toMatch(/[{}\u2014\u2013]/);
  });

  it("keeps a plain footer plain: no links, and no footer at all when none is live", () => {
    const short = fillFooter(footer("short", "site.example\n\nShort bio."), { id: 1, title: "x" });
    const reel = fillFooter(footer("reel", "site.example, link in bio"), { id: 1, title: "x" });
    expect(short.split("\n")[0]).toBe("site.example");
    expect(reel).toBe("site.example, link in bio");
    for (const t of [short, reel]) expect(t).not.toMatch(/https?:/);
    // Wren ships no footer words: a database with none live renders no footer, never an error.
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

describe("clip captions", () => {
  const description = "First paragraph of the video.\n\nSecond paragraph.";
  it("takes a description's first paragraph, cut at a word", () => {
    expect(leadOf(description)).toBe("First paragraph of the video.");
    expect(leadOf("one two three four", 12)).toBe("one two...");
    expect(leadOf("")).toBe("");
  });

  it("gives X and TikTok the title, LinkedIn and Facebook the title and a lead", () => {
    expect(alsoText("x", "A point", description)).toBe("A point");
    expect(alsoText("tiktok", "A point", description)).toBe("A point");
    expect(alsoText("linkedin", "A point", description)).toBe(
      "A point\n\nFirst paragraph of the video.",
    );
    expect(alsoText("facebook", "A point", "")).toBe("A point");
  });

  it("drafts TikTok public with interactions on through Studio, private and off by the API", () => {
    expect(tiktokFields("web")).toMatchObject({
      privacy: "PUBLIC_TO_EVERYONE",
      allowComment: true,
      allowDuet: true,
      allowStitch: true,
    });
    expect(tiktokFields("api")).toEqual({ privacy: "SELF_ONLY" });
  });

  it("reads a clip's own words on the cut timeline, cut at a sentence", () => {
    const words = [
      { w: "Hello", s: 0, e: 0.4 },
      { w: "um", s: 1, e: 1.2 },
      { w: "there.", s: 2, e: 2.4 },
      { w: "Next", s: 5, e: 5.4 },
      { w: "bit.", s: 5.5, e: 5.9 },
    ];
    const cuts = [{ from: 0.9, to: 1.3, why: "filler", state: "cut" }] as const;
    const shorts = [
      { from: 0, to: 3, title: "A" },
      { from: 5, to: 6, title: "B" },
    ];
    expect(clipWords({ words, cuts: [...cuts], shorts }, 1)).toBe("Hello there.");
    expect(clipWords({ words, cuts: [...cuts], shorts }, 2)).toBe("Next bit.");
    expect(clipWords({ words, cuts: [], shorts }, 3)).toBe("");
    expect(excerpt("One two. Three four five six.", 14)).toBe("One two.");
    expect(tidy("so i think i'll go")).toBe("So I think I'll go.");
    expect(tidy("Done?")).toBe("Done?");
    expect(excerpt("alpha beta gamma delta", 12)).toBe("alpha beta...");
  });
});

describe("looksOf", () => {
  it("lists each look newest first, without the provider's media ids", () => {
    const look = (at: string, title: string) => ({
      at,
      summary: "s",
      moments: [],
      shorts: [{ from: 1, to: 20, title, card: false }],
      chapters: [{ at: 0, title: "Intro" }],
      thumbnails: [],
      media: { id: "m", asset: "a", cut: "c", minutes: 3 },
    });
    const out = looksOf({
      looks: {
        gemini: look("2026-01-01T00:00:00Z", "a"),
        twelvelabs: look("2026-01-02T00:00:00Z", "b"),
      },
    });
    expect(out.map((l) => l.by)).toEqual(["twelvelabs", "gemini"]);
    expect(out[0]?.shorts).toEqual([{ from: 1, to: 20, title: "b" }]);
    expect(out[0]).not.toHaveProperty("media");
  });
});

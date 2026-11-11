import { describe, expect, it } from "vitest";
import {
  adCopy,
  adFacts,
  adFactsOf,
  adImages,
  adPage,
  adTitle,
  adVideos,
  isWinner,
  type LibraryAd,
} from "./ads.js";
import { adFactsSchema } from "./breakdown.js";

// synthetic: no real advertiser
const ad = (o: Partial<LibraryAd> = {}): LibraryAd => ({
  libraryId: "100200300",
  advertiser: { id: "9", name: "Acme Staffing" },
  active: true,
  ...o,
});

describe("isWinner", () => {
  it("long runner while active", () => {
    expect(isWinner(ad({ daysRunning: 30 }))).toBe(true);
    expect(isWinner(ad({ daysRunning: 29 }))).toBe(false);
  });
  it("an ended long runner is no winner on days alone", () => {
    expect(isWinner(ad({ active: false, daysRunning: 90 }))).toBe(false);
  });
  it("three versions of one creative", () => {
    expect(isWinner(ad({ active: false, versions: 3 }))).toBe(true);
    expect(isWinner(ad({ versions: 2 }))).toBe(false);
  });
});

describe("adTitle", () => {
  it("headline, else the first body line", () => {
    expect(adTitle(ad({ headline: "Hire in 48 hours" }))).toBe("Acme Staffing: Hire in 48 hours");
    expect(adTitle(ad({ body: "\n  Need staff?\nCall us" }))).toBe("Acme Staffing: Need staff?");
  });
  it("skips a DPA template line", () => {
    expect(adTitle(ad({ headline: "{{product.name}}", cards: [{ headline: "Card one" }] }))).toBe(
      "Acme Staffing: Card one",
    );
  });
  it("no copy: the library id", () => {
    expect(adTitle(ad({ advertiser: null }))).toBe("Ad: 100200300");
  });
});

describe("media", () => {
  it("own media then cards', each image once", () => {
    const a = ad({
      media: {
        images: [{ url: "https://x/a.jpg" }, { resized: "https://x/b.jpg" }],
        videos: [{ sd: "https://x/v.mp4" }],
      },
      cards: [
        { image: "https://x/a.jpg" },
        { image: "https://x/c.jpg", video: { hd: "https://x/w.mp4" } },
      ],
    });
    expect(adImages(a)).toEqual(["https://x/a.jpg", "https://x/b.jpg", "https://x/c.jpg"]);
    expect(adVideos(a).map((v) => v.hd ?? v.sd)).toEqual(["https://x/v.mp4", "https://x/w.mp4"]);
  });
});

describe("page", () => {
  it("facts fence round-trips and fits the breakdown's schema", () => {
    const a = ad({
      format: "VIDEO",
      daysRunning: 41,
      versions: 4,
      platforms: ["facebook", "instagram"],
      headline: "H",
      cta: "Apply",
    });
    const facts = adFacts(a, { speech: true, cuts: 7 });
    const md = adPage(a, facts, "## Said\n\nhello");
    expect(adFactsOf(md)).toEqual(facts);
    const full = { ...facts, offer: "Free shift", offer_kind: "free-trial" as const };
    expect(adFactsSchema.parse(full)).toEqual(full);
    expect(md).toContain("Headline: H\nCTA: Apply");
    expect(md.trim().endsWith("hello")).toBe(true);
  });
  it("an unknown format is null, not a bad enum", () => {
    expect(adFacts(ad({ format: "reels-magic" }), { speech: null, cuts: null }).format).toBeNull();
  });
  it("no fence: null", () => {
    expect(adFactsOf("## Copy\n\nx")).toBeNull();
  });
  it("cards in the copy", () => {
    expect(adCopy(ad({ cards: [{ headline: "One", link: "https://x" }] }))).toBe(
      "Card 1\n  Headline: One\n  Link: https://x",
    );
  });
});

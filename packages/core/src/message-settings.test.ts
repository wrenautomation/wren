import { describe, expect, it } from "vitest";
import { CAP_MAX, capOf, slugOf, tagLinks } from "./message-settings.js";

const tags = { source: "Acme Dental", medium: "email", campaign: "Spring Offer!" };

describe("tagLinks", () => {
  it("adds the three parameters to an http link", () => {
    expect(tagLinks("See https://shop.example/menu now", tags)).toBe(
      "See https://shop.example/menu?utm_source=acme-dental&utm_medium=email&utm_campaign=spring-offer now",
    );
  });

  it("keeps a link's own query and fragment as written", () => {
    expect(tagLinks("https://shop.example/a?x=1%202&y=#top", tags)).toBe(
      "https://shop.example/a?x=1%202&y=&utm_source=acme-dental&utm_medium=email&utm_campaign=spring-offer#top",
    );
  });

  it("never overwrites a parameter that is already there", () => {
    const out = tagLinks("https://shop.example/?utm_source=partner&utm_campaign=mine", tags);
    expect(out).toBe("https://shop.example/?utm_source=partner&utm_campaign=mine&utm_medium=email");
  });

  it("is idempotent", () => {
    const once = tagLinks("a https://shop.example/x b", tags);
    expect(tagLinks(once, tags)).toBe(once);
  });

  it("skips our own tracked /go/ links", () => {
    const text = "Book: https://wrenautomation.com/go/ab12cd and https://x.example/";
    expect(tagLinks(text, tags)).toBe(
      "Book: https://wrenautomation.com/go/ab12cd and https://x.example/?utm_source=acme-dental&utm_medium=email&utm_campaign=spring-offer",
    );
  });

  it("leaves a sentence's closing punctuation outside the link", () => {
    expect(tagLinks("Visit https://shop.example/menu.", { ...tags, campaign: null })).toBe(
      "Visit https://shop.example/menu?utm_source=acme-dental&utm_medium=email.",
    );
  });

  it("tags every link and ignores mailto and bare words", () => {
    const out = tagLinks("mailto:a@b.example http://one.example https://two.example/p", tags);
    expect(out.match(/utm_source=acme-dental/g)).toHaveLength(2);
    expect(out).toContain("mailto:a@b.example ");
  });

  it("leaves text without links alone", () => {
    expect(tagLinks("Hello there", tags)).toBe("Hello there");
  });
});

describe("slugOf", () => {
  it("makes lowercase words joined by dashes, at most 60 long", () => {
    expect(slugOf("  Spring  Offer! ")).toBe("spring-offer");
    expect(slugOf("x".repeat(90))).toHaveLength(60);
  });
});

describe("capOf", () => {
  it("reads blank, 0 and off as no cap", () => {
    for (const v of ["", " ", "0", "off", "None", null, undefined]) expect(capOf(v)).toBeNull();
  });
  it("reads a whole number up to the limit", () => {
    expect(capOf("3")).toBe(3);
    expect(capOf(CAP_MAX)).toBe(CAP_MAX);
  });
  it("refuses the rest", () => {
    for (const v of ["-1", "2.5", "many", CAP_MAX + 1]) expect(() => capOf(v)).toThrow(RangeError);
  });
});

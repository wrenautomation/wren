import { describe, expect, it } from "vitest";
import {
  cleanSlides,
  isCarousel,
  type Slide,
  slidesHtml,
  slidesText,
  slidesUnfit,
} from "./slides.js";

const five: Slide[] = Array.from({ length: 5 }, (_, i) => ({
  title: `Step ${i + 1}`,
  lines: [`Line for ${i + 1}`],
}));

describe("slides", () => {
  it("cleans what's stored and checks the set", () => {
    expect(cleanSlides([{ title: " A ", lines: [" b ", "", 3] }, "junk", null])).toEqual([
      { title: "A", lines: ["b"] },
    ]);
    expect(cleanSlides("nope")).toEqual([]);
    expect(slidesUnfit(five)).toBeNull();
    expect(slidesUnfit(five.slice(0, 4))).toMatch(/5 to 10 slides/);
    expect(slidesUnfit([...five.slice(0, 4), { title: "", lines: [] }])).toMatch(
      /slide 5 needs a title/,
    );
    expect(
      slidesUnfit([...five.slice(0, 4), { title: "T", lines: ["a", "b", "c", "d", "e"] }]),
    ).toMatch(/up to 4/);
  });

  it("draws one square section per slide, escaped", () => {
    const html = slidesHtml([{ title: "<b>&", lines: ["x"] }, ...five]);
    expect(html.match(/<section class="slide/g)).toHaveLength(6);
    expect(html).toContain("&lt;b&gt;&amp;");
    expect(html).toContain("1 / 6");
    expect(slidesHtml(five, { only: 2 }).match(/<section/g)).toHaveLength(1);
    expect(slidesHtml(five, { only: 2 })).toContain("3 / 5");
    expect(slidesText(five.slice(0, 1))).toBe("Step 1\nLine for 1");
    expect(isCarousel({ platform: "instagram", extra: { kind: "carousel" } })).toBe(true);
    expect(isCarousel({ platform: "linkedin", extra: { kind: "document" } })).toBe(true);
    expect(isCarousel({ platform: "linkedin", extra: {} })).toBe(false);
  });
});

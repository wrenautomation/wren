import { slidesKey } from "@wren/core/content/slides";
import { describe, expect, it } from "vitest";
import type { ContentDraft } from "./schema.js";
import { fieldsSaved, slidesSaved } from "./shape-view.js";

const slides = Array.from({ length: 5 }, (_, i) => ({
  title: `Slide ${i + 1}`,
  lines: ["A line"],
}));
const row = (over: Partial<ContentDraft> = {}): ContentDraft =>
  ({
    id: "00000000-0000-4000-8000-000000000001",
    platform: "instagram",
    status: "draft",
    title: null,
    text: "Words",
    extra: { kind: "carousel", deck: "k", slides },
    ...over,
  }) as ContentDraft;

describe("what a save answers", () => {
  it("fields: the fields as the editor draws them, and what Approve still needs", () => {
    const got = fieldsSaved(row());
    expect(got.status).toBe("draft");
    expect(got.editable).toBe(true);
    expect(Array.isArray(got.fields)).toBe(true);
    expect(Array.isArray(got.missing)).toBe(true);
    expect(fieldsSaved(row({ status: "published" })).missing).toEqual([]);
  });

  it("slides: the set, stale drawn files, and every share's status", () => {
    const other = row({ id: "00000000-0000-4000-8000-000000000002", status: "draft" });
    const got = slidesSaved(row().id, [row(), other]);
    expect(got?.carousel.slides).toEqual(slides);
    expect(got?.carousel.fresh).toBe(false);
    expect(got?.carousel.unfit).toMatch(/draw the slides/);
    expect(got?.shares.map((s) => s.id)).toEqual([row().id, other.id]);
    const drawn = row({
      extra: {
        kind: "carousel",
        slides,
        rendered: { images: slides.map(() => "s3://b/i.png"), of: slidesKey(slides), at: "now" },
      },
    });
    expect(slidesSaved(drawn.id, [drawn])?.carousel).toMatchObject({ fresh: true, drawn: "now" });
    expect(slidesSaved("nope", [drawn])).toBeNull();
  });
});

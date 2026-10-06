import { describe, expect, it } from "vitest";
import { type Dossier, dossierText, type Fact, recentPosts } from "./dossier.js";

const seen = new Date("2026-10-05T00:00:00Z");
const post = (site: string, n: number, extra: Record<string, unknown> = {}): Fact => ({
  what: "post",
  value: {
    site,
    kind: site === "YouTube" ? "video" : "photo",
    published_at: `2026-09-${String(10 + n).padStart(2, "0")}T12:00:00.000Z`,
    likes: n,
    comments: 0,
    raw: { big: "x".repeat(500) },
    ...extra,
  },
  confidence: 1,
  source: `https://${site.toLowerCase()}.test/${n}`,
  via: site.toLowerCase(),
  seenAt: seen,
});

const dossier = (facts: Fact[]): Dossier => ({
  company: {
    id: 7,
    name: "Acme",
    domain: "acme.test",
    niche: "roofing",
    country: "US",
    timezone: null,
  },
  facts,
  people: [],
});

describe("recentPosts", () => {
  it("keeps the newest few per network by when they went up, title or caption as text", () => {
    const facts = [
      ...Array.from({ length: 8 }, (_, i) => post("Instagram", i, { caption: `cap ${i}` })),
      post("YouTube", 3, { title: "Roof tour" }),
      post("Instagram", 99, { caption: "undated", published_at: undefined }),
    ];
    const got = recentPosts(dossier(facts), 3);
    expect(got.map((p) => `${p.site} ${p.text}`)).toEqual([
      "Instagram cap 7",
      "Instagram cap 6",
      "Instagram cap 5",
      "YouTube Roof tour",
    ]);
    expect(got[0]).toMatchObject({
      kind: "photo",
      url: "https://instagram.test/7",
      likes: 7,
      publishedAt: new Date("2026-09-17T12:00:00.000Z"),
    });
  });
});

describe("dossierText", () => {
  it("shows posts as one dated block, not a raw line each", () => {
    const text = dossierText(
      dossier([
        {
          what: "hiring",
          value: "estimator",
          confidence: null,
          source: null,
          via: "site",
          seenAt: seen,
        },
        ...Array.from({ length: 7 }, (_, i) =>
          post("Instagram", i, { caption: `New roof\nin ${i}` }),
        ),
      ]),
    );
    expect(text).toContain("hiring: estimator");
    expect(text).toContain("  recent posts:");
    expect(text).toContain(
      "    2026-09-16 Instagram photo: New roof in 6 · 6 likes https://instagram.test/6",
    );
    expect(text.match(/Instagram photo/g)).toHaveLength(5);
    expect(text).not.toContain("xxxxx");
  });
});

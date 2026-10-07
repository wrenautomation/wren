import { describe, expect, it } from "vitest";
import { addLine, landerPages, sitemapUrls, unlisted } from "./scan.js";

const ORIGIN = "https://lander.example";
const FILES = [
  {
    path: "src/content/hub/home.yaml",
    text: '# the hub\ntitle: "Home: the hub"\ndescription: x\npath: /\noffer: build\n',
  },
  {
    path: "src/content/pitches/roofs.yaml",
    text: "title: Roofs\nlede: |\n  path: /not-this\npath: /roofs/audit\noffer: audit\n",
  },
  { path: "src/content/pitches/broken.yaml", text: "title: No path\n" },
  { path: "src/content/niches/dentists.yaml", text: "title: For dentists\n" },
  { path: "src/pages/terms.astro", text: "" },
  { path: "src/pages/schedule.astro", text: "" },
  { path: "src/pages/404.astro", text: "" },
  { path: "src/pages/[...slug].astro", text: "" },
  { path: "src/pages/v.astro", text: "" },
];

describe("landerPages", () => {
  it("reads hub and pitch paths, niche names and static routes", () => {
    expect(landerPages(FILES, ORIGIN)).toEqual([
      {
        url: "https://lander.example/",
        from: "lander/src/content/hub/home.yaml",
        kind: "lander",
        repoPath: "lander/src/content/hub/home.yaml",
        title: "Home: the hub",
        offer: "build",
      },
      {
        url: "https://lander.example/roofs/audit",
        from: "lander/src/content/pitches/roofs.yaml",
        kind: "pitch",
        repoPath: "lander/src/content/pitches/roofs.yaml",
        title: "Roofs",
        offer: "audit",
      },
      {
        url: "https://lander.example/dentists",
        from: "lander/src/content/niches/dentists.yaml",
        kind: "lander",
        repoPath: "lander/src/content/niches/dentists.yaml",
        title: "For dentists",
      },
      {
        url: "https://lander.example/terms",
        from: "lander/src/pages/terms.astro",
        repoPath: "lander/src/pages/terms.astro",
      },
      {
        url: "https://lander.example/schedule",
        from: "lander/src/pages/schedule.astro",
        repoPath: "lander/src/pages/schedule.astro",
        kind: "booking",
      },
    ]);
  });
});

describe("sitemapUrls", () => {
  it("takes every loc, and nothing from a page that isn't a sitemap", () => {
    const xml =
      "<urlset><url><loc>https://a.example/x</loc></url><url><loc> https://a.example/y?a=1&amp;b=2 </loc></url></urlset>";
    expect(sitemapUrls(xml, "s").map((f) => f.url)).toEqual([
      "https://a.example/x",
      "https://a.example/y?a=1&b=2",
    ]);
    expect(sitemapUrls("<!doctype html><div id=app></div>", "s")).toEqual([]);
  });
});

describe("unlisted", () => {
  it("lists what the list lacks, once, matched as the list keeps links", () => {
    const found = [
      ...landerPages(FILES, ORIGIN),
      ...sitemapUrls(
        "<loc>https://lander.example/roofs/audit/</loc><loc>https://pages.acme.example/o/spring</loc><loc>http://plain.example/</loc>",
        "https://pages.acme.example/sitemap.xml",
      ),
    ];
    const out = unlisted(
      ["https://lander.example", "https://lander.example/terms?x=1", null],
      found,
      (h) => (h === "pages.acme.example" ? "acme" : undefined),
    );
    expect(out.map((u) => u.url)).toEqual([
      "https://lander.example/roofs/audit",
      "https://lander.example/dentists",
      "https://lander.example/schedule",
      "https://pages.acme.example/o/spring",
    ]);
    expect(out[0]?.title).toBe("Roofs");
    expect(out[3]?.add).toBe(
      "wren --client acme sites add --url https://pages.acme.example/o/spring",
    );
  });

  it("quotes what the shell would split", () => {
    expect(
      addLine({ url: "https://a.example/x", from: "f", title: "Bob's roofs", kind: "pitch" }),
    ).toBe("wren sites add --url https://a.example/x --title 'Bob'\\''s roofs' --kind pitch");
  });
});

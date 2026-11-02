import { describe, expect, it } from "vitest";
import { blogFile, blogProblem, slugOf } from "./blog.js";

describe("blog", () => {
  it("makes an address from a title", () => {
    expect(slugOf("Why we don't use Zapier: 5 reasons")).toBe("why-we-dont-use-zapier-5-reasons");
    expect(slugOf("Café façade")).toBe("cafe-facade");
    expect(slugOf("!!!")).toBe("post");
  });

  it("writes frontmatter any title survives, and refuses what can't go up", () => {
    const text = blogFile({
      slug: "a-b",
      title: 'He said: "no"',
      description: "One line.",
      body: "## Hi\n\nWords.\n\n",
      date: "2026-10-13",
      draft: false,
    });
    expect(text).toBe(
      '---\ntitle: "He said: \\"no\\""\ndescription: "One line."\ndate: 2026-10-13\ndraft: false\n---\n\n## Hi\n\nWords.\n',
    );
    const ok = { slug: "a-b", title: "T", description: "D", body: "B" };
    expect(blogProblem(ok)).toBeNull();
    expect(blogProblem({ ...ok, slug: "how-to-post" })).toMatch("address");
    expect(blogProblem({ ...ok, slug: "A B" })).toMatch("address");
    expect(blogProblem({ ...ok, body: " " })).toMatch("no words");
  });
});

import { describe, expect, it } from "vitest";
import { blogFile, blogProblem, githubRepo, slugOf } from "./blog.js";

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

  it("commits through GitHub's contents API, and a repeat of the same text commits nothing", async () => {
    const calls: Array<{ url: string; method: string; body?: Record<string, unknown> }> = [];
    let stored: { text: string; sha: string } | null = null;
    const fake = (async (url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      const body = init?.body
        ? (JSON.parse(String(init.body)) as Record<string, unknown>)
        : undefined;
      calls.push({ url, method, ...(body ? { body } : {}) });
      if (method === "GET")
        return stored
          ? Response.json({ content: Buffer.from(stored.text).toString("base64"), sha: stored.sha })
          : new Response("{}", { status: 404 });
      stored = { text: Buffer.from(String(body?.content), "base64").toString(), sha: "f1" };
      return Response.json({ commit: { sha: "c1" } });
    }) as typeof fetch;
    const repo = githubRepo({ token: "t", repo: "o/lander", fetch: fake });
    expect(await repo.write("src/content/blog/a.md", "hi\n", "Blog: a")).toBe("c1");
    expect(calls[1]).toMatchObject({
      url: "https://api.github.com/repos/o/lander/contents/src/content/blog/a.md",
      method: "PUT",
      body: { message: "Blog: a", branch: "main" },
    });
    expect(calls[1]?.body).not.toHaveProperty("sha");
    expect(await repo.write("src/content/blog/a.md", "hi\n", "Blog: a")).toBeNull();
    await repo.write("src/content/blog/a.md", "changed\n", "Blog: a");
    expect(calls.at(-1)?.body).toMatchObject({ sha: "f1" });
  });
});

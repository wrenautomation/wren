import { describe, expect, it } from "vitest";
import { githubRepo } from "./github.js";

describe("githubRepo", () => {
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
    const repo = githubRepo({ token: "t", repo: "o/files", fetch: fake });
    expect(await repo.write("docs/a.md", "hi\n", "Add a")).toBe("c1");
    expect(calls[1]).toMatchObject({
      url: "https://api.github.com/repos/o/files/contents/docs/a.md",
      method: "PUT",
      body: { message: "Add a", branch: "main" },
    });
    expect(calls[1]?.body).not.toHaveProperty("sha");
    expect(await repo.write("docs/a.md", "hi\n", "Add a")).toBeNull();
    await repo.write("docs/a.md", "changed\n", "Edit a");
    expect(calls.at(-1)?.body).toMatchObject({ sha: "f1" });
  });

  it("names the newest commit that touched a path, or null when none did", async () => {
    const urls: string[] = [];
    const heads: Array<Record<string, string>> = [];
    let answer: unknown = [{ sha: "abc123" }, { sha: "older" }];
    const fake = (async (url: string, init?: RequestInit) => {
      urls.push(url);
      heads.push(init?.headers as Record<string, string>);
      return Response.json(answer);
    }) as typeof fetch;
    const repo = githubRepo({ token: "t", repo: "o/files", branch: "trunk", fetch: fake });
    expect(await repo.lastCommit("shapes/a b.yaml")).toBe("abc123");
    expect(urls[0]).toBe(
      "https://api.github.com/repos/o/files/commits?path=shapes%2Fa%20b.yaml&sha=trunk&per_page=1",
    );
    expect(heads[0]).toMatchObject({ authorization: "Bearer t", "user-agent": "wren" });
    answer = [];
    expect(await repo.lastCommit("shapes/none.yaml")).toBeNull();
  });

  it("fails with the status and GitHub's reason", async () => {
    const fake = (async () =>
      Response.json({ message: "Bad credentials" }, { status: 401 })) as unknown as typeof fetch;
    const repo = githubRepo({ token: "t", repo: "o/files", fetch: fake });
    await expect(repo.lastCommit("x")).rejects.toThrow("HTTP 401 (Bad credentials)");
  });
});

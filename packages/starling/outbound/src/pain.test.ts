import { FakeLlm } from "@wren/llm";
import { describe, expect, it } from "vitest";
import { painFired, painKey, painPrompt, proven, readPains } from "./pain.js";
import type { ReachPost } from "./schema.js";

const NOW = new Date("2026-10-26T10:00:00Z");

const post = (id: number, text: string): ReachPost =>
  ({
    id,
    platform: "linkedin",
    ref: `p${id}`,
    author: "Ada Example",
    authorUrl: "https://www.linkedin.com/in/ada-example/",
    handle: "ada-example",
    headline: "Founder at Example Staffing",
    text,
    url: `https://www.linkedin.com/posts/p${id}`,
    postedAt: NOW,
    createdAt: NOW,
    fit: 80,
    state: "found",
  }) as ReachPost;

describe("the proof rule", () => {
  it("keeps a quote that is in the post, whitespace and quote marks aside", () => {
    const text = "We lost two placements this month because the client's ATS ate our\nnotes.";
    expect(proven(text, "we lost two placements this month")).toBe(true);
    expect(proven(text, "the client’s ATS ate our notes")).toBe(true);
  });
  it("drops a paraphrase, a too short quote and a quote longer than the post", () => {
    const text = "We lost two placements this month because the ATS ate our notes.";
    expect(proven(text, "lost placements because of the ATS")).toBe(false);
    expect(proven(text, "ATS")).toBe(false);
    expect(proven(text, `${text} ${"and more ".repeat(60)}`)).toBe(false);
  });
});

describe("a pain finding's key", () => {
  it("is one per document and quote, blind to case and spacing", () => {
    expect(painKey(7, "We lost  two placements")).toBe(painKey(7, "we lost two placements"));
    expect(painKey(7, "we lost two placements")).not.toBe(painKey(8, "we lost two placements"));
    expect(painKey(7, "x")).toMatch(/^doc:7\/pain\/[0-9a-f]{12}$/);
  });
});

describe("the model read", () => {
  it("numbers each post by its id and keeps only pains on posts it was given", async () => {
    const posts = [post(5, "Our ATS ate our notes."), post(6, "Hiring is fun!")];
    let seen = "";
    const llm = new FakeLlm({
      respond: (prompt) => {
        seen = prompt;
        return JSON.stringify({
          pains: [
            { post: 5, pain: "Their ATS loses notes.", quote: "Our ATS ate our notes." },
            { post: 99, pain: "Made up.", quote: "nope" },
          ],
        });
      },
    });
    const pains = await readPains(llm, posts);
    expect(seen).toContain("Post 5 by Ada Example (Founder at Example Staffing) on linkedin:");
    expect(seen).toContain("Post 6 by");
    expect(pains).toEqual([
      { post: 5, pain: "Their ATS loses notes.", quote: "Our ATS ate our notes." },
    ]);
  });
  it("reads nothing for no posts", async () => {
    const llm = new FakeLlm({
      respond: () => {
        throw new Error("not asked");
      },
    });
    expect(await readPains(llm, [])).toEqual([]);
    expect(painPrompt([])).toBe("");
  });
});

describe("the fire", () => {
  it("enters the author's profile at the line's list, one subject per post", () => {
    const f = painFired("import:12", { id: 5, profile: 9, pain: "Their ATS loses notes." }, NOW);
    expect(f).toEqual({
      client: null,
      facts: { trigger: "trigger.source", source: "import:12" },
      event: {
        subject: "source:import:12:rp5",
        kind: "lead",
        data: {
          profile: 9,
          row: "rp:5",
          source: "import:12",
          post: 5,
          pain: "Their ATS loses notes.",
          cause: { kind: "sourced", ref: "import:12", at: NOW.toISOString() },
        },
      },
    });
  });
});

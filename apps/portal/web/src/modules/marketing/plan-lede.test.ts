import { describe, expect, it, vi } from "vitest";

vi.stubGlobal("location", new URL("http://localhost:8803/"));
const { waitLine } = await import("./plan.js");

describe("Plan's lede", () => {
  it("counts drafts and videos waiting apart", () => {
    const d = { platform: "x", state: "draft" };
    const v = { platform: "editor", state: "review" };
    expect(waitLine([])).toBe("Nothing waits on you.");
    expect(waitLine([d])).toBe("1 draft waits on you.");
    expect(waitLine([d, d, v])).toBe("2 drafts and 1 video wait on you.");
    expect(waitLine([v, v])).toBe("2 videos wait on you.");
  });
});

import { describe, expect, it } from "vitest";
import { pageRow } from "./crawler.js";

const resp = {
  status: 200,
  url: "https://a.example/",
  text: "<html><body><p>Hi there.</p></body></html>",
};

describe("pageRow", () => {
  it("records a plain fetch as httpx with no block and no steps", () => {
    expect(pageRow(1, "https://a.example/", resp)).toMatchObject({
      fetchTier: "httpx",
      blockReason: null,
      fetchSteps: null,
    });
  });
  it("records the ladder's tier, block and steps", () => {
    const steps = [
      { tier: "plain", status: 403, block: "status-403" },
      { tier: "impersonate", status: 200, block: null },
    ];
    expect(
      pageRow(null, "https://a.example/", {
        ...resp,
        tier: "impersonate",
        block: "status-403",
        steps,
      }),
    ).toMatchObject({ fetchTier: "impersonate", blockReason: "status-403", fetchSteps: steps });
  });
});

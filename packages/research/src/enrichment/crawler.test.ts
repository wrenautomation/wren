import { describe, expect, it } from "vitest";
import { pageRow } from "./crawler.js";

const resp = {
  status: 200,
  url: "https://a.example/",
  text: "<html><body><p>Hi there.</p></body></html>",
};

describe("pageRow", () => {
  it("records a plain fetch as httpx", () => {
    expect(pageRow(1, "https://a.example/", resp)).toMatchObject({ fetchTier: "httpx" });
  });
  it("keeps the tier of a page served from the shared cache", () => {
    expect(pageRow(1, "https://a.example/", { ...resp, tier: "render" })).toMatchObject({
      fetchTier: "render",
    });
  });
});

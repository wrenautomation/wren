import { describe, expect, it } from "vitest";
import { gatewayGemini } from "./gateway.js";

describe("gatewayGemini", () => {
  it("sends Gemini calls to the gateway with its bearer, and leaves other calls alone", async () => {
    const calls: { url: string; auth: string | null; goog: string | null }[] = [];
    const base = (async (input: string | URL | Request, init?: RequestInit) => {
      const h = new Headers(init?.headers);
      calls.push({
        url: String(input),
        auth: h.get("authorization"),
        goog: h.get("x-goog-api-key"),
      });
      return Response.json({});
    }) as unknown as typeof fetch;
    const fetchFn = gatewayGemini("https://gw.example/v1", "tok", base);
    await fetchFn("https://generativelanguage.googleapis.com/v1beta/models/m:generateContent", {
      method: "POST",
      headers: { "x-goog-api-key": "placeholder" },
    });
    await fetchFn("https://www.youtube.com/oembed?format=json");
    expect(calls).toEqual([
      { url: "https://gw.example/v1beta/models/m:generateContent", auth: "Bearer tok", goog: null },
      { url: "https://www.youtube.com/oembed?format=json", auth: null, goog: null },
    ]);
  });
});

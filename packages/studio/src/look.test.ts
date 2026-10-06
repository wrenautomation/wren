import { describe, expect, it } from "vitest";
import { TL_FREE_MINUTES, twelvelabsLooker } from "./look.js";

const answer = JSON.stringify({
  summary: "a test",
  moments: [],
  shorts: [],
  chapters: [],
  thumbnails: [],
});

describe("twelvelabsLooker", () => {
  it("stops before any call that would pass the free minutes", async () => {
    const calls: string[] = [];
    const fake = (async (url: string) => {
      calls.push(url);
      return new Response("{}");
    }) as unknown as typeof fetch;
    const look = twelvelabsLooker("k", {
      usedMinutes: TL_FREE_MINUTES - 3,
      durationS: 150,
      cut: "v1",
      fetchFn: fake,
    });
    await expect(look("/nope.mp4", "")).rejects.toThrow(/needs 6 min/);
    expect(calls).toEqual([]);
  });

  it("reuses the indexed cut: analysis only, minutes added once", async () => {
    const calls: string[] = [];
    const fake = (async (url: string) => {
      calls.push(new URL(url).pathname);
      return new Response(JSON.stringify({ data: answer, finish_reason: "stop" }));
    }) as unknown as typeof fetch;
    const look = twelvelabsLooker("k", { usedMinutes: 0, durationS: 61, cut: "v1", fetchFn: fake });
    const out = await look("/nope.mp4", "", { id: "i", asset: "a", cut: "v1", minutes: 4 });
    expect(calls).toEqual(["/v1.3/analyze"]);
    expect(out.media).toEqual({ id: "i", asset: "a", cut: "v1", minutes: 6 });
    expect(out.summary).toBe("a test");
  });
});

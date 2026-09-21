import { describe, expect, it } from "vitest";
import { ideaFromVerdict, isWinner, specFromPost } from "./bridge.js";
import type { Verdict } from "./launches.js";
import type { AdLaunch } from "./schema.js";

const launch = {
  name: "founders",
  spec: { creative: { message: "every buy asks me first.\n\nthe gate is live." } },
} as AdLaunch;
const verdict = (over: Partial<Verdict["result"]>, pause: string | null = null): Verdict => ({
  launch,
  result: { adsetId: "s", campaignId: "c", spendUsd: 12.5, clicks: 0, results: 0, ...over },
  pause,
});

describe("winners → ideas", () => {
  it("a result or ten clicks wins; a paused one never does", () => {
    expect(isWinner(verdict({ results: 1 }))).toBe(true);
    expect(isWinner(verdict({ clicks: 10 }))).toBe(true);
    expect(isWinner(verdict({ clicks: 9 }))).toBe(false);
    expect(isWinner(verdict({ results: 3 }, "spent"))).toBe(false);
  });

  it("the idea carries the numbers and the message", () => {
    expect(ideaFromVerdict(verdict({ clicks: 14, results: 2 }))).toBe(
      [
        'the ad "founders" got 14 clicks and 2 results on $12.50 in 7 days.',
        "the message that did it:",
        "every buy asks me first.\n\nthe gate is live.",
        "make a post out of what worked.",
      ].join("\n"),
    );
  });
});

describe("specFromPost", () => {
  it("keeps the words and media, names it by the first line, PAUSED", () => {
    const spec = specFromPost(
      {
        text: "the spend gate is live.\n\nevery buy asks first.",
        url: "https://x.com/wren/status/1",
        media: { kind: "video", source: "s3://media/gate.mp4", title: "Gate" },
      },
      { countries: ["US", "CA"], dailyBudgetUsd: 15 },
    );
    expect(spec).toEqual({
      name: "post · the spend gate is live.",
      objective: "OUTCOME_TRAFFIC",
      dailyBudgetUsd: 15,
      targeting: { countries: ["US", "CA"] },
      optimizationGoal: "LINK_CLICKS",
      creative: {
        message: "the spend gate is live.\n\nevery buy asks first.",
        link: "https://x.com/wren/status/1",
        headline: "the spend gate is live.",
        callToAction: "LEARN_MORE",
        media: { kind: "video", source: "s3://media/gate.mp4" },
      },
      status: "PAUSED",
    });
  });

  it("a title beats the first line; --link beats the post URL; no link at all is an error", () => {
    const spec = specFromPost(
      { text: "body", title: "Spend gate", url: "https://a" },
      { link: "https://b" },
    );
    expect(spec.name).toBe("post · Spend gate");
    expect(spec.creative.link).toBe("https://b");
    expect(spec.creative.headline).toBe("Spend gate");
    expect(spec.targeting.countries).toEqual(["US"]);
    expect(() => specFromPost({ text: "body" })).toThrow(/--link/);
  });
});

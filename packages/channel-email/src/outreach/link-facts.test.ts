/** linkFacts: which links a draft gets, each with its own code, and never a code on another site. */
import { describe, expect, it } from "vitest";
import { linkFacts } from "./compose.js";

const SITE = "https://site.example";

describe("linkFacts", () => {
  it("no site, no links", () => {
    expect(linkFacts(null, "reactivation", {}, {}, "code0001")).toEqual({});
  });

  it("watch is the firm's own demo first, then the offer's video, never another site's page", () => {
    const own = { "company.video_url": `${SITE}/v/abc` };
    const vsl = { "offer.video": "https://cdn.example/vsl.mp4" };
    expect(linkFacts(SITE, "reactivation", own, vsl, "c1")["link.watch"]).toBe(
      `${SITE}/v/abc?r=c1`,
    );
    expect(linkFacts(SITE, "reactivation", {}, vsl, "c1")["link.watch"]).toBe(
      `${SITE}/watch/reactivation?r=c1`,
    );
    const foreign = { "company.video_url": "https://elsewhere.example/v/abc" };
    expect(linkFacts(SITE, "reactivation", foreign, {}, "c1")).toEqual({
      "link.book": `${SITE}/book/reactivation?r=c1`,
    });
  });
});

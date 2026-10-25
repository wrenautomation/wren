import { describe, expect, it } from "vitest";
import { kindOfPost, outcomeOf } from "./learn-back.js";

const none = { hook: null, avg_view_pct: null, avg_view_secs: null };

describe("our pieces for learn back", () => {
  it("names each format's Learn kind, a long video by its length", () => {
    expect(kindOfPost({ ...none, format: "short" })).toBe("reel");
    expect(kindOfPost({ ...none, format: "post" })).toBe("post");
    expect(kindOfPost({ ...none, format: "post", hook: 0.6 })).toBe("reel");
    // 54 s watched at 30%: a 3-minute film.
    expect(kindOfPost({ ...none, format: "long", avg_view_secs: 54, avg_view_pct: 0.3 })).toBe(
      "film",
    );
    expect(kindOfPost({ ...none, format: "long", avg_view_secs: 544, avg_view_pct: 0.37 })).toBe(
      "video",
    );
    expect(kindOfPost({ ...none, format: "long" })).toBe("video");
    expect(kindOfPost({ ...none, format: "story" })).toBeNull();
    expect(kindOfPost({ ...none, format: "carousel" })).toBeNull();
  });

  it("reads each kind's one number as a share, null until insights give it", () => {
    expect(outcomeOf("reel", { hook: 0.42, avg_view_pct: 0.2, score: 3 })).toBe(0.42);
    expect(outcomeOf("film", { hook: null, avg_view_pct: 0.2, score: 3 })).toBe(0.2);
    expect(outcomeOf("post", { hook: null, avg_view_pct: null, score: 3 })).toBe(0.03);
    expect(outcomeOf("reel", { hook: null, avg_view_pct: 0.2, score: 3 })).toBeNull();
  });
});

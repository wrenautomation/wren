import { describe, expect, it } from "vitest";
import { attributionOf, touchFacts } from "./attribution.js";

describe("touchFacts", () => {
  it("reads a paid touch as the ads channel, the platform and the campaign word", () => {
    expect(
      touchFacts({
        utm_source: "Meta",
        utm_medium: "paid",
        utm_campaign: "Spring-Offer",
        utm_content: "ad-77",
      }),
    ).toEqual({ channel: "ads", platform: "meta", campaign: "spring-offer" });
  });

  it("reads an email link, a search and a post", () => {
    expect(touchFacts({ r: "abc123" })).toEqual({ channel: "email" });
    expect(touchFacts({ ref: "https://www.google.com/" })).toEqual({ channel: "search" });
    expect(
      touchFacts({ utm_source: "youtube", utm_medium: "organic", utm_campaign: "launch" }),
    ).toEqual({
      channel: "content",
      platform: "youtube",
      campaign: "launch",
    });
  });

  it("is null for a touch that names no channel, and for what is no touch", () => {
    expect(touchFacts({ utm_source: "", utm_medium: "" })).toBeNull();
    expect(touchFacts(null)).toBeNull();
    expect(touchFacts("meta")).toBeNull();
    expect(touchFacts([])).toBeNull();
  });
});

describe("attributionOf", () => {
  const paid = { utm_source: "meta", utm_medium: "paid", utm_campaign: "spring" };

  it("takes the cause from the page the form was sent from", () => {
    expect(attributionOf({ email: "a@example.test", ...paid })).toEqual({
      cause: { channel: "ads", platform: "meta", campaign: "spring" },
      first: null,
    });
  });

  it("takes the first touch from first_touch and falls back to the last touch for the cause", () => {
    expect(
      attributionOf({
        utm_source: "",
        first_touch: paid,
        last_touch: { utm_source: "google", utm_medium: "organic", ref: "https://www.google.com/" },
      }),
    ).toEqual({
      cause: { channel: "search", platform: "google" },
      first: { channel: "ads", platform: "meta", campaign: "spring" },
    });
  });

  it("is empty for a payload with no touch fields", () => {
    expect(attributionOf({ email: "a@example.test", channel: "email" })).toEqual({
      cause: {},
      first: null,
    });
  });
});

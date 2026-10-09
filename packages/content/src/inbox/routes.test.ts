import { describe, expect, it } from "vitest";
import type { ReplyOption } from "./conversation.js";
import { clientRoute, withRoutes } from "./routes.js";

const x = [{ platform: "x", state: "connected" }];

describe("clientRoute", () => {
  it("texts and email are never shut here", () => {
    expect(clientRoute("text", null, [])).toBeNull();
    expect(clientRoute("email", null, [])).toBeNull();
  });

  it("goes on a connected account for the platforms with an API", () => {
    expect(clientRoute("dm", "x", x)).toBeNull();
    expect(clientRoute("comment", "x", x)).toBeNull();
    for (const platform of ["facebook", "instagram"])
      for (const channel of ["dm", "comment"] as const)
        expect(clientRoute(channel, platform, [{ platform, state: "connected" }])).toBeNull();
    expect(clientRoute("comment", "youtube", [{ platform: "youtube", state: "connected" }])).toBe(
      null,
    );
  });

  it("no account, or a broken one: says so and points at Account → Social", () => {
    expect(clientRoute("dm", "instagram", x)).toEqual({
      off: "No Instagram account connected. Replies go out on your own account.",
      fix: "social",
    });
    expect(clientRoute("comment", "x", [{ platform: "x", state: "broken" }])).toEqual({
      off: "Your X account needs connecting again.",
      fix: "social",
    });
  });

  it("LinkedIn, Reddit, TikTok and YouTube DMs: not available yet, with why", () => {
    const all = [
      { platform: "linkedin", state: "connected" },
      { platform: "youtube", state: "connected" },
      { platform: "tiktok", state: "connected" },
    ];
    expect(clientRoute("dm", "linkedin", all)?.off).toBe(
      "Not available yet. LinkedIn has no messaging API.",
    );
    expect(clientRoute("dm", "reddit", all)?.off).toMatch(/^Not available yet\. Reddit/);
    expect(clientRoute("comment", "reddit", all)?.off).toMatch(/^Not available yet\. Reddit/);
    expect(clientRoute("comment", "tiktok", all)?.off).toMatch(/^Not available yet\. TikTok/);
    expect(clientRoute("dm", "youtube", all)).toEqual({ off: "YouTube has no DMs.", fix: null });
    expect(clientRoute("dm", null, all)?.fix).toBeNull();
  });
});

it("LinkedIn comments answer on a company page, reviews on a Business Profile", () => {
  const page = [{ platform: "linkedin_page", state: "connected" }];
  expect(clientRoute("comment", "linkedin", page)).toBeNull();
  expect(
    clientRoute("comment", "linkedin", [{ platform: "linkedin", state: "connected" }]),
  ).toEqual({
    off: "No LinkedIn company page account connected. Replies go out on your own account.",
    fix: "social",
  });
  expect(clientRoute("dm", "linkedin", page)?.off).toMatch(/^Not available yet\. LinkedIn/);
  const gb = [{ platform: "google_business", state: "connected" }];
  expect(clientRoute("comment", "google_business", gb)).toBeNull();
  expect(clientRoute("comment", "google_business", [])?.fix).toBe("social");
  expect(clientRoute("dm", "google_business", gb)?.fix).toBeNull();
});

describe("withRoutes", () => {
  it("shuts what can't go and keeps an earlier reason", () => {
    const o = (channel: ReplyOption["channel"], platform: string | null, off: string | null) =>
      ({ channel, target: "1", label: "l", platform, own: false, off }) as ReplyOption;
    const out = withRoutes(
      [o("dm", "x", null), o("dm", "x", "They opted out."), o("comment", "youtube", null)],
      x,
    );
    expect(out.map((r) => [r.off, r.fix])).toEqual([
      [null, undefined],
      ["They opted out.", undefined],
      ["No YouTube channel account connected. Replies go out on your own account.", "social"],
    ]);
  });
});

import { describe, expect, it } from "vitest";
import type { RedditRequirement } from "../schema.js";
import {
  type AccountStanding,
  decide,
  effectiveNeed,
  type Need,
  NO_NEED,
  parseNeed,
  shortfall,
} from "./requirements.js";

describe("parseNeed", () => {
  it("reads AutoModerator's age and karma", () => {
    expect(
      parseNeed(
        'AutoModerator: "Your comment was removed: your account must be 10+ days old with 50+ karma."',
      ),
    ).toEqual({ ...NO_NEED, minAgeDays: 10, minKarma: 50 });
  });

  it("reads weeks and months as days, and comment karma apart from total", () => {
    expect(parseNeed("Accounts under 2 weeks old are filtered. Need 100 comment karma.")).toEqual({
      ...NO_NEED,
      minAgeDays: 14,
      minCommentKarma: 100,
    });
    expect(parseNeed("account at least 3 months old, karma of 1,000")).toEqual({
      ...NO_NEED,
      minAgeDays: 90,
      minKarma: 1000,
    });
  });

  it("files post karma and a verified email as other, and counts neither", () => {
    expect(parseNeed("25 post karma and a verified email required")).toEqual({
      ...NO_NEED,
      other: "25 post karma, verified email",
    });
  });

  it("leaves numbers that are not about the account", () => {
    expect(parseNeed("No reposts within 7 days. Posts from the last 30 days only.")).toEqual(
      NO_NEED,
    );
    expect(parseNeed("[removed] for strangers; no account read")).toEqual(NO_NEED);
  });
});

const standing = (
  account: string,
  ageDays: number | null,
  karma: number | null,
): AccountStanding => ({
  account,
  ageDays,
  karma,
  commentKarma: null,
});
const need = (n: Partial<Need> & { hold?: boolean }) => ({ ...NO_NEED, hold: false, ...n });

describe("shortfall", () => {
  it("lists each floor the account is under, and treats an unread one as under", () => {
    expect(shortfall(need({ minAgeDays: 10, minKarma: 50 }), standing("a", 3, 1))).toEqual({
      needs: ["10 days old", "50 karma"],
      has: ["3 days", "1"],
    });
    expect(shortfall(need({ minKarma: 50 }), standing("a", 30, null)).needs).toEqual(["50 karma"]);
    expect(shortfall(need({ minKarma: 50 }), standing("a", 30, 80)).needs).toEqual([]);
  });
});

describe("decide", () => {
  const pool = [
    { id: "alt", standing: standing("reddit@alt", 4, 1) },
    { id: "wren", standing: standing("reddit@wren", 40, 2) },
  ];

  it("lets a sub with no floor through", () => {
    expect(decide("example", "alt", need({}), pool)).toMatchObject({ ok: true, reason: null });
  });

  it("holds with the reason when no account qualifies", () => {
    const g = decide("SalesTechniques", "alt", need({ minAgeDays: 10, minKarma: 50 }), pool);
    expect(g.ok).toBe(false);
    expect(g.reason).toBe(
      "r/SalesTechniques needs 10 days old and 50 karma, reddit@alt has 4 days and 1 (reddit@wren has 2)",
    );
  });

  it("sends from the other account when only it qualifies", () => {
    const g = decide("example", "alt", need({ minKarma: 2 }), pool);
    expect(g).toMatchObject({ ok: true, accountId: "wren", switched: true });
    expect(decide("example", "wren", need({ minKarma: 2 }), pool)).toMatchObject({
      ok: true,
      accountId: "wren",
      switched: false,
    });
  });

  it("holds an unknown gate for every account", () => {
    const g = decide("example", "alt", need({ hold: true }), pool);
    expect(g.ok).toBe(false);
    expect(g.reason).toContain("did not say why");
    expect(decide("example", "alt", need({ hold: true, minKarma: 1 }), pool).ok).toBe(false);
  });

  it("holds when there is no account to send from", () => {
    expect(decide("example", null, need({ minKarma: 5 }), []).reason).toBe(
      "r/example needs 5 karma: no account to send from",
    );
  });
});

describe("effectiveNeed", () => {
  const row = (r: Partial<RedditRequirement>): RedditRequirement => ({
    subreddit: "example",
    source: "removal",
    minAgeDays: null,
    minKarma: null,
    minCommentKarma: null,
    other: null,
    hold: false,
    item: null,
    evidence: null,
    learnedAt: new Date("2026-10-14T00:00:00Z"),
    clearedAt: null,
    ...r,
  });

  it("takes the highest of each floor and skips cleared rows", () => {
    const n = effectiveNeed([
      row({ source: "removal", minKarma: 50, minAgeDays: 10 }),
      row({ source: "rules", minKarma: 100 }),
      row({ source: "manual", minKarma: 999, clearedAt: new Date("2026-10-14T01:00:00Z") }),
    ]);
    expect(n).toMatchObject({ minKarma: 100, minAgeDays: 10, hold: false });
  });
});

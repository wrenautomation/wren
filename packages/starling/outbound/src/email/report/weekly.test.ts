import { describe, expect, it } from "vitest";
import { mondayLine, renderWeekly, type WeeklyStats, ZERO } from "./weekly.js";

const base: WeeklyStats = {
  periodStart: "2026-09-11T00:00:00.000Z",
  periodEnd: "2026-09-18T00:00:00.000Z",
  headline: {
    key: "campaign",
    week: { ...ZERO, sent: 62, openers: 40, replies: 3, interested: 1 },
    toDate: { ...ZERO, sent: 200, openers: 120, replies: 9, interested: 2, hardBounces: 4 },
  },
  byNiche: [
    {
      key: { niche: "agencies" },
      week: { ...ZERO, sent: 62, replies: 3, interested: 1 },
      toDate: { ...ZERO, sent: 200, replies: 9, interested: 2 },
    },
  ],
  byArm: [
    {
      key: { niche: "agencies", arm: "founder" },
      week: { ...ZERO, sent: 62, replies: 3 },
      toDate: { ...ZERO, sent: 200, replies: 9 },
    },
  ],
  domains: [
    {
      domain: "wren-a.test",
      sent: 62,
      hardBounces: 1,
      spamRate: 0.001,
      reputation: "HIGH",
      postmasterDay: "2026-09-17",
    },
  ],
  pauses: [],
  replies: [
    {
      receivedAt: "2026-09-16T14:00:00.000Z",
      company: "Acme",
      fromAddress: "j@acme.test",
      niche: "agencies",
      disposition: "interested",
      snippet: "sure, send me times",
    },
  ],
  pool: {
    approved: 300,
    drafts: 12,
    activeEnrollments: 150,
    openersPerSendDay: 10,
    sendDaysLeft: 30,
  },
};

describe("renderWeekly", () => {
  it("renders every section with Wilson rates and deltas against last week", () => {
    const prev: WeeklyStats = {
      ...base,
      headline: { ...base.headline, week: { ...ZERO, sent: 50, replies: 3 } },
    };
    const text = renderWeekly(base, prev);
    expect(text).toContain("2026-09-11 to 2026-09-18");
    expect(text).toContain("sends 62 (+12) · replies 3 (=) · interested 1 (+1)");
    expect(text).toContain("reply rate 4.8% [1.7%–13.3%] n=62");
    expect(text).toContain("- agencies/founder: 200 sent, 9 replies");
    expect(text).toContain(
      "- wren-a.test: bounces 1/62 · postmaster 2026-09-17: spam 0.10%, reputation HIGH",
    );
    expect(text).toContain("- 2026-09-16 Acme [agencies, interested]: sure, send me times");
    expect(text).toContain("300 approved and waiting, 12 drafts unreviewed");
    expect(text).toContain("10.0 openers per send day → empties in ~30 send day(s)");
    expect(text).toContain("- last week: sends 50");
    expect(text.endsWith("7. Monday: nothing owed. Let it run.\n")).toBe(true);
  });

  it("says so when there is nothing", () => {
    const empty: WeeklyStats = {
      ...base,
      headline: { key: "campaign", week: ZERO, toDate: ZERO },
      byNiche: [],
      byArm: [],
      domains: [],
      replies: [],
      pool: {
        approved: 0,
        drafts: 0,
        activeEnrollments: 0,
        openersPerSendDay: 0,
        sendDaysLeft: null,
      },
    };
    const text = renderWeekly(empty, null);
    expect(text).toContain("reply rate n=0");
    expect(text).toContain("- nothing sent yet");
    expect(text).toContain("- no sending domains yet");
    expect(text).toContain("- none this week");
    expect(text).toContain("- no earlier report to compare with");
    expect(text).toContain("Monday: the pool is empty");
  });
});

describe("mondayLine", () => {
  it("pauses first", () => {
    const s = {
      ...base,
      pauses: [
        { sender: "a@x.test", domain: "x.test", reason: "bounce rate", pausedAt: "2026-09-15" },
      ],
      replies: [{ ...base.replies[0], disposition: null }],
    } as WeeklyStats;
    expect(mondayLine(s)).toContain("1 sender(s) paused — investigate x.test (bounce rate)");
  });
  it("then unread replies", () => {
    const s = { ...base, replies: [{ ...base.replies[0], disposition: null }] } as WeeklyStats;
    expect(mondayLine(s)).toBe("Monday: read the 1 unclassified reply below.");
  });
  it("then a pool about to empty", () => {
    const s = { ...base, pool: { ...base.pool, sendDaysLeft: 3 } };
    expect(mondayLine(s)).toContain("empties in ~3 send day(s)");
  });
  it("then drafts waiting", () => {
    const s = { ...base, pool: { ...base.pool, approved: 0, sendDaysLeft: null } };
    expect(mondayLine(s)).toBe("Monday: nothing approved; 12 drafts waiting for review.");
  });
});

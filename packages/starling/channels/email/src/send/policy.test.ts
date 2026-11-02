/**
 * Send pacing (C-D2): the clock arithmetic the tick trusts (I11.9). Every
 * instant is a literal UTC Date. America/Chicago in September is CDT (UTC-5),
 * so the default 08:00 window opens at 13:00 UTC; the DST cases are the two
 * days a year where that stops being true.
 */
import { loadSettings } from "@wren/config";
import { describe, expect, it } from "vitest";
import { PlainDate } from "./dates.js";
import { EPOCH, SendPolicy, type SendPolicySettings } from "./policy.js";
import { seededRng } from "./rng.js";

const utc = (y: number, mo: number, d: number, h: number, mi: number): Date =>
  new Date(Date.UTC(y, mo - 1, d, h, mi));

// Tuesday 2026-09-08, 08:00 America/Chicago: the inclusive window start.
const TUESDAY_OPEN = utc(2026, 9, 8, 13, 0);
const TUESDAY_MIDWINDOW = utc(2026, 9, 8, 15, 0); // 10:00 local
const TUESDAY_BEFORE = utc(2026, 9, 8, 11, 0); // 06:00 local
const TUESDAY_LAST_MINUTE = utc(2026, 9, 8, 21, 59); // 16:59 local
const TUESDAY_CLOSE = utc(2026, 9, 8, 22, 0); // 17:00 local, exclusive
const FRIDAY_EVENING = utc(2026, 9, 11, 23, 0); // 18:00 local Friday
const SUNDAY_MORNING = utc(2026, 9, 13, 15, 0); // 10:00 local Sunday
const SATURDAY_MIDDAY = utc(2026, 9, 12, 15, 0); // 10:00 local Saturday
const MONDAY_OPEN = utc(2026, 9, 14, 13, 0); // 08:00 local Monday

const MIN = 60_000;

/** The shipped defaults unless a test says otherwise. Hermetic: reads no process env. */
function policy(overrides: Partial<SendPolicySettings> = {}): SendPolicy {
  const defaults = loadSettings({ WREN_DATABASE_URL: "postgresql://x" });
  return SendPolicy.fromSettings({ ...defaults, ...overrides });
}

describe("parsing", () => {
  it("defaults parse to the designed policy", () => {
    const p = policy();
    expect(p.timezone).toBe("America/Chicago");
    expect([...p.days].sort()).toEqual([0, 1, 2, 3, 4]);
    expect(p.windowStart).toEqual({ hour: 8, minute: 0 });
    expect(p.windowEnd).toEqual({ hour: 17, minute: 0 });
    expect(p.perInboxCeiling).toBe(5);
    expect(p.rampStart).toBeNull();
    expect([p.rampFrom, p.rampStep, p.rampEverySendDays]).toEqual([5, 2, 3]);
    expect(p.gapMinMs).toBe(8 * MIN);
    expect(p.gapMaxMs).toBe(20 * MIN);
    expect(p.newOpenersPerDay).toBeNull();
    expect(p.resendCooldownDays).toBe(30);
    expect(p.reconcileGraceMs).toBe(10 * MIN);
    expect(p.bouncePauseRate).toBe(0.02);
    expect(p.bouncePauseMinBounces).toBe(2);
    expect(p.healthWindowMs).toBe(7 * 24 * 60 * MIN);
  });

  it("day names are case-insensitive, full or short, whitespace tolerant", () => {
    expect([...policy({ sendDays: " Monday, WED ,fri " }).days].sort()).toEqual([0, 2, 4]);
  });

  it("days deduplicate", () => {
    expect([...policy({ sendDays: "mon,mon,Monday" }).days]).toEqual([0]);
  });

  it("a weekend schedule is allowed", () => {
    expect([...policy({ sendDays: "sat,sun" }).days].sort()).toEqual([5, 6]);
  });

  it("the policy is frozen", () => {
    const p = policy();
    expect(() => {
      (p as { perInboxCeiling: number }).perInboxCeiling = 99;
    }).toThrow();
  });
});

describe("validation", () => {
  it("unknown timezone is loud", () => {
    expect(() => policy({ sendTimezone: "America/Chicargo" })).toThrow("WREN_SEND_TIMEZONE");
  });
  it("unknown day token is loud", () => {
    expect(() => policy({ sendDays: "mon,tues" })).toThrow("unknown day 'tues'");
  });
  it("empty days is loud", () => {
    expect(() => policy({ sendDays: "  ,  " })).toThrow("at least one send day");
  });
  it.each(["8:00", "0800", "08:60", "24:00", "08:00:00", "morning", ""])(
    "window start must be HH:MM (%s)",
    (bad) => {
      expect(() => policy({ sendWindowStart: bad })).toThrow(
        "WREN_SEND_WINDOW_START must be HH:MM",
      );
    },
  );
  it("window end must be HH:MM", () => {
    expect(() => policy({ sendWindowEnd: "5pm" })).toThrow("WREN_SEND_WINDOW_END must be HH:MM");
  });
  it("window end must be after start", () => {
    expect(() => policy({ sendWindowStart: "17:00", sendWindowEnd: "08:00" })).toThrow(
      "must be after",
    );
  });
  it("a zero-width window is refused", () => {
    expect(() => policy({ sendWindowStart: "08:00", sendWindowEnd: "08:00" })).toThrow(
      "must be after",
    );
  });
  it("daily cap must be at least one", () => {
    expect(() => policy({ coldSendsPerInboxPerDay: 0 })).toThrow(
      "COLD_SENDS_PER_INBOX_PER_DAY must be at least 1",
    );
  });
  it("gap min must not be negative", () => {
    expect(() => policy({ sendGapMinMinutes: -1 })).toThrow("GAP_MIN_MINUTES must not be negative");
  });
  it("gap max must not be below gap min", () => {
    expect(() => policy({ sendGapMinMinutes: 20, sendGapMaxMinutes: 8 })).toThrow(
      /GAP_MAX_MINUTES .* must not be below/,
    );
  });
  it("equal gaps are a fixed gap, not an error", () => {
    const p = policy({ sendGapMinMinutes: 9, sendGapMaxMinutes: 9 });
    expect(p.gapFor(seededRng(7))).toBe(9 * MIN);
  });
  it("openers cap must not be negative; 0 is follow-ups only", () => {
    expect(() => policy({ newOpenersPerDay: -1 })).toThrow(
      "NEW_OPENERS_PER_DAY must not be negative",
    );
    expect(policy({ newOpenersPerDay: 0 }).newOpenersPerDay).toBe(0);
  });
  it("per-niche openers caps and kill-switch exemptions parse; a typo is loud", () => {
    const p = policy({
      nicheOpenersPerDay: "agencies=0, recruiting=40",
      killSwitchOffFor: "agencies",
    });
    expect(p.nicheOpenerCap("agencies")).toBe(0);
    expect(p.nicheOpenerCap("recruiting")).toBe(40);
    expect(p.nicheOpenerCap("sec_ria")).toBeNull();
    expect(p.killSwitchOn("agencies")).toBe(false);
    expect(p.killSwitchOn("recruiting")).toBe(true);
    expect(p.describe()).toContain("kill switch off for agencies");
    expect(() => policy({ nicheOpenersPerDay: "agencies:0" })).toThrow("NICHE_OPENERS_PER_DAY");
  });
  it("console overrides lay over env in a new frozen policy; null keeps env", () => {
    const env = policy({ nicheOpenersPerDay: "agencies=0", killSwitchOffFor: "agencies" });
    const p = env.withCampaigns([
      { campaign: "agencies", killSwitch: true, openersPerDay: 5 },
      { campaign: "recruiting", killSwitch: false, openersPerDay: null },
      { campaign: "sec_ria", killSwitch: null, openersPerDay: 0 },
    ]);
    expect([p.killSwitchOn("agencies"), p.nicheOpenerCap("agencies")]).toEqual([true, 5]);
    expect([p.killSwitchOn("recruiting"), p.nicheOpenerCap("recruiting")]).toEqual([false, null]);
    expect([p.killSwitchOn("sec_ria"), p.nicheOpenerCap("sec_ria")]).toEqual([true, 0]);
    expect([env.killSwitchOn("agencies"), env.nicheOpenerCap("agencies")]).toEqual([false, 0]);
    expect(Object.isFrozen(p)).toBe(true);
    expect(p.perInboxCap(MONDAY_OPEN)).toBe(env.perInboxCap(MONDAY_OPEN));
    expect(env.withCampaigns([])).toBe(env);
  });
  it("cooldown must not be negative", () => {
    expect(() => policy({ resendCooldownDays: -1 })).toThrow(
      "RESEND_COOLDOWN_DAYS must not be negative",
    );
  });
  it("reconcile grace must not be negative", () => {
    expect(() => policy({ reconcileGraceMinutes: -1 })).toThrow(
      "RECONCILE_GRACE_MINUTES must not be negative",
    );
  });
  it.each([0.0, -0.02, 1.5, 2.0])("bounce pause rate must be in (0, 1] (%s)", (bad) => {
    expect(() => policy({ bouncePauseRate: bad })).toThrow("BOUNCE_PAUSE_RATE must be in (0, 1]");
  });
  it("a bounce pause rate of one is allowed", () => {
    expect(policy({ bouncePauseRate: 1.0 }).bouncePauseRate).toBe(1.0);
  });
  it("min bounces must be at least one", () => {
    expect(() => policy({ bouncePauseMinBounces: 0 })).toThrow(
      "BOUNCE_PAUSE_MIN_BOUNCES must be at least 1",
    );
  });
  it("health window must be at least a day", () => {
    expect(() => policy({ healthWindowDays: 0 })).toThrow("HEALTH_WINDOW_DAYS must be at least 1");
  });
  it("a ramp start that is not a date is loud", () => {
    expect(() => policy({ coldSendsRampStart: "next monday" })).toThrow(
      "WREN_COLD_SENDS_RAMP_START",
    );
  });
});

describe("local clock", () => {
  it("local now and local day are in the send timezone", () => {
    const p = policy();
    const late = utc(2026, 9, 9, 1, 0); // 01:00 UTC Wednesday is Tuesday evening in Chicago
    expect(p.localNow(late).time.hour).toBe(20);
    expect(p.localDay(late).equals(new PlainDate(2026, 9, 8))).toBe(true);
  });
  it("an invalid instant is refused", () => {
    expect(() => policy().windowOpen(new Date(Number.NaN))).toThrow("valid instant");
  });
  it("local day bounds are UTC instants around the local day", () => {
    const [start, end] = policy().localDayBounds(TUESDAY_MIDWINDOW);
    expect(start).toEqual(utc(2026, 9, 8, 5, 0));
    expect(end).toEqual(utc(2026, 9, 9, 5, 0));
    expect(end.getTime() - start.getTime()).toBe(24 * 60 * MIN);
  });
});

describe("the window", () => {
  it("open at the inclusive start", () => expect(policy().windowOpen(TUESDAY_OPEN)).toBe(true));
  it("open one minute before the close", () =>
    expect(policy().windowOpen(TUESDAY_LAST_MINUTE)).toBe(true));
  it("shut at the exclusive end", () => expect(policy().windowOpen(TUESDAY_CLOSE)).toBe(false));
  it("shut before the start", () => expect(policy().windowOpen(TUESDAY_BEFORE)).toBe(false));
  it("shut on a Saturday inside the hours", () =>
    expect(policy().windowOpen(SATURDAY_MIDDAY)).toBe(false));
  it("next open from mid-window is now", () =>
    expect(policy().nextWindowOpen(TUESDAY_MIDWINDOW)).toEqual(TUESDAY_MIDWINDOW));
  it("next open before the start is today", () =>
    expect(policy().nextWindowOpen(TUESDAY_BEFORE)).toEqual(TUESDAY_OPEN));
  it("next open after the close is tomorrow", () =>
    expect(policy().nextWindowOpen(TUESDAY_CLOSE)).toEqual(utc(2026, 9, 9, 13, 0)));
  it("next open from Friday evening skips the weekend", () =>
    expect(policy().nextWindowOpen(FRIDAY_EVENING)).toEqual(MONDAY_OPEN));
  it("next open from Sunday is Monday", () =>
    expect(policy().nextWindowOpen(SUNDAY_MORNING)).toEqual(MONDAY_OPEN));
  it("next open lands on an open instant", () => {
    const p = policy();
    for (const m of [
      TUESDAY_BEFORE,
      TUESDAY_CLOSE,
      FRIDAY_EVENING,
      SUNDAY_MORNING,
      SATURDAY_MIDDAY,
    ]) {
      expect(p.windowOpen(p.nextWindowOpen(m))).toBe(true);
    }
  });
  it("next open terminates on a one-day schedule", () => {
    const p = policy({ sendDays: "wed" });
    expect(p.nextWindowOpen(utc(2026, 9, 9, 23, 0))).toEqual(utc(2026, 9, 16, 13, 0));
  });
  it("window close is today's end while open", () =>
    expect(policy().windowClose(TUESDAY_MIDWINDOW)).toEqual(TUESDAY_CLOSE));
  it("window close is null when shut", () => {
    const p = policy();
    expect(p.windowClose(TUESDAY_CLOSE)).toBeNull();
    expect(p.windowClose(SATURDAY_MIDDAY)).toBeNull();
  });
});

describe("DST", () => {
  it("spring-forward local day is twenty-three hours", () => {
    const [start, end] = policy().localDayBounds(utc(2026, 3, 8, 17, 0));
    expect(start).toEqual(utc(2026, 3, 8, 6, 0));
    expect(end).toEqual(utc(2026, 3, 9, 5, 0));
    expect(end.getTime() - start.getTime()).toBe(23 * 60 * MIN);
  });
  it("fall-back local day is twenty-five hours", () => {
    const [start, end] = policy().localDayBounds(utc(2026, 11, 1, 17, 0));
    expect(start).toEqual(utc(2026, 11, 1, 5, 0));
    expect(end).toEqual(utc(2026, 11, 2, 6, 0));
    expect(end.getTime() - start.getTime()).toBe(25 * 60 * MIN);
  });
  it("window edge holds on the spring-forward day", () => {
    const p = policy({ sendDays: "mon,tue,wed,thu,fri,sat,sun" });
    expect(p.windowOpen(utc(2026, 3, 8, 12, 59))).toBe(false); // 07:59 CDT
    expect(p.windowOpen(utc(2026, 3, 8, 13, 0))).toBe(true); // 08:00 CDT
  });
  it("window edge holds on the fall-back day", () => {
    const p = policy({ sendDays: "mon,tue,wed,thu,fri,sat,sun" });
    expect(p.windowOpen(utc(2026, 11, 1, 13, 59))).toBe(false); // 07:59 CST
    expect(p.windowOpen(utc(2026, 11, 1, 14, 0))).toBe(true); // 08:00 CST
  });
  it("next open crosses the spring-forward night", () => {
    const saturdayEvening = utc(2026, 3, 7, 23, 0); // 17:00 CST Saturday
    expect(policy().nextWindowOpen(saturdayEvening)).toEqual(utc(2026, 3, 9, 13, 0));
  });
});

describe("the gap", () => {
  it("stays within the configured bounds", () => {
    const p = policy();
    const rng = seededRng(1);
    for (let i = 0; i < 200; i++) {
      const gap = p.gapFor(rng);
      expect(gap).toBeGreaterThanOrEqual(p.gapMinMs);
      expect(gap).toBeLessThanOrEqual(p.gapMaxMs);
    }
  });
  it("is whole seconds", () => {
    const p = policy();
    const rng = seededRng(1);
    for (let i = 0; i < 50; i++) expect(p.gapFor(rng) % 1000).toBe(0);
  });
  it("is deterministic for a seed", () => {
    const p = policy();
    const one = seededRng(1);
    const another = seededRng(1);
    const a = Array.from({ length: 5 }, () => p.gapFor(one));
    const b = Array.from({ length: 5 }, () => p.gapFor(another));
    expect(a).toEqual(b);
  });
  it("actually varies", () => {
    const p = policy();
    const rng = seededRng(1);
    expect(new Set(Array.from({ length: 50 }, () => p.gapFor(rng))).size).toBeGreaterThan(1);
  });
  it("earliest next send for an inbox that never sent is the past", () => {
    expect(policy().earliestNextSend(null, 0)).toEqual(EPOCH);
    expect(EPOCH.getTime()).toBeLessThan(TUESDAY_OPEN.getTime());
  });
  it("earliest next send adds at least the configured gap", () => {
    const p = policy({ coldSendsPerInboxPerDay: 1000 });
    const earliest = p.earliestNextSend(TUESDAY_OPEN, 1).getTime();
    expect(earliest).toBeGreaterThanOrEqual(TUESDAY_OPEN.getTime() + p.gapMinMs);
    expect(earliest).toBeLessThanOrEqual(TUESDAY_OPEN.getTime() + p.gapMaxMs);
  });
  it("spreads a small cap across the window", () => {
    // 08:00–17:00 is 540 min; 10 a day with one sent leaves 9 → 60 min ±20%.
    const p = policy({ coldSendsPerInboxPerDay: 10 });
    for (let i = 0; i < 20; i++) {
      const at = new Date(TUESDAY_OPEN.getTime() + i * 1000);
      const gap = p.gapAfter(at, 1);
      expect(gap).toBeGreaterThanOrEqual(48 * MIN - 1000);
      expect(gap).toBeLessThanOrEqual(72 * MIN);
    }
  });
  it("the same send gives the same gap, so every tick agrees", () => {
    const p = policy({ coldSendsPerInboxPerDay: 10 });
    expect(p.gapAfter(TUESDAY_OPEN, 3)).toBe(p.gapAfter(TUESDAY_OPEN, 3));
  });
  it("100 a day sends at the floor and still fits the floor", () => {
    const p = policy({ coldSendsPerInboxPerDay: 100, sendGapMinMinutes: 5, sendGapMaxMinutes: 10 });
    const gap = p.gapAfter(TUESDAY_OPEN, 1);
    expect(gap).toBeGreaterThanOrEqual(5 * MIN);
    expect(gap).toBeLessThanOrEqual(10 * MIN);
  });
});

describe("describe", () => {
  it("reads as one line for the operator", () => {
    expect(policy().describe()).toBe(
      "Mon–Fri 08:00–17:00 America/Chicago, 5/inbox/day, gap 8–20 min, openers/day unlimited, " +
        "cooldown 30 d, off on us, ca, year_end holidays",
    );
  });
  it("names a set openers cap", () => {
    expect(policy({ newOpenersPerDay: 50 }).describe()).toContain("openers/day 50");
  });
  it("lists scattered days instead of a range", () => {
    expect(policy({ sendDays: "mon,wed,fri" }).describe().startsWith("Mon, Wed, Fri 08:00")).toBe(
      true,
    );
  });
  it("keeps a two-day run as a list", () => {
    expect(policy({ sendDays: "sat,sun" }).describe().startsWith("Sat, Sun 08:00")).toBe(true);
  });
});

// Warmup protocol §2 as data: from 5, +2 per inbox every 3 SEND days, to a
// ceiling. Start Monday 2026-09-14, the campaign's first send day. No holidays
// here; "holidays" below covers the ramp across them.
const RAMP = {
  coldSendsRampStart: "2026-09-14",
  coldSendsPerInboxPerDay: 25,
  sendHolidays: "none",
};
/** 10:00 America/Chicago on `day`, as the UTC instant the tick sees. */
const at = (y: number, m: number, d: number): Date => utc(y, m, d, 15, 0);

describe("the ramp", () => {
  it("without a ramp the cap is the flat ceiling every day", () => {
    const p = policy({ coldSendsPerInboxPerDay: 7 });
    expect(p.perInboxCap(TUESDAY_MIDWINDOW)).toBe(7);
    expect(p.perInboxCap(at(2027, 1, 1))).toBe(7);
    expect(p.sendDaysElapsed(TUESDAY_MIDWINDOW)).toBe(0);
  });
  it.each([
    [[2026, 9, 11], 0, 5], // the Friday before the start: nothing elapsed
    [[2026, 9, 14], 0, 5], // start day is send day 1
    [[2026, 9, 16], 2, 5], // Wed: send day 3
    [[2026, 9, 17], 3, 7], // Thu: send day 4, first step
    [[2026, 9, 19], 5, 7], // Saturday counts nothing
    [[2026, 9, 21], 5, 7], // Monday sends what Friday would have
    [[2026, 9, 22], 6, 9],
    [[2026, 9, 30], 12, 13],
    [[2026, 10, 23], 29, 23],
    [[2026, 10, 26], 30, 25], // the ceiling, send day 31
    [[2026, 12, 1], 56, 25], // and it stays there
  ] as const)(
    "climbs in send days to the ceiling (%j → %i elapsed, cap %i)",
    (day, elapsed, cap) => {
      const p = policy(RAMP);
      const [y, m, d] = day;
      expect(p.sendDaysElapsed(at(y, m, d))).toBe(elapsed);
      expect(p.perInboxCap(at(y, m, d))).toBe(cap);
    },
  );
  it("reads the local day, not the UTC one", () => {
    // 03:00 UTC on Thu 2026-09-17 is 22:00 Wednesday in Chicago: still send day 3.
    const lateWednesday = utc(2026, 9, 17, 3, 0);
    expect(policy(RAMP).sendDaysElapsed(lateWednesday)).toBe(2);
    expect(policy(RAMP).perInboxCap(lateWednesday)).toBe(5);
  });
  it("counts the schedule's own days", () => {
    const p = policy({
      sendDays: "sat,sun",
      coldSendsRampStart: "2026-09-12",
      coldSendsPerInboxPerDay: 25,
    });
    expect(p.sendDaysElapsed(at(2026, 9, 18))).toBe(2); // Sat 12, Sun 13
    expect(p.perInboxCap(at(2026, 9, 20))).toBe(7); // Sun 20: three elapsed (12, 13, 19)
  });
  it("step and pace are data", () => {
    const p = policy({
      ...RAMP,
      coldSendsRampFrom: 3,
      coldSendsRampStep: 5,
      coldSendsRampEveryDays: 1,
    });
    expect(p.perInboxCap(at(2026, 9, 14))).toBe(3);
    expect(p.perInboxCap(at(2026, 9, 15))).toBe(8);
    expect(p.perInboxCap(at(2026, 9, 21))).toBe(25); // 3 + 5 × 5 = 28, capped
  });
  it.each(["coldSendsRampFrom", "coldSendsRampStep", "coldSendsRampEveryDays"] as const)(
    "ramp numbers must be at least one (%s)",
    (field) => {
      expect(() => policy({ [field]: 0 })).toThrow(/WREN_COLD_SENDS_RAMP_.* must be at least 1/);
    },
  );
  it("a ramp may not start above its ceiling", () => {
    expect(() => policy({ coldSendsRampStart: "2026-09-14", coldSendsPerInboxPerDay: 3 })).toThrow(
      /RAMP_FROM .* must not exceed/,
    );
    // Without a start the ramp numbers are inert, so a low flat cap is fine.
    expect(policy({ coldSendsPerInboxPerDay: 3 }).perInboxCap(TUESDAY_MIDWINDOW)).toBe(3);
  });
  it("describe says where the ramp stands", () => {
    expect(policy().describe()).toContain("5/inbox/day,");
    const rule = "ramp 5 +2 every 3 send days from 2026-09-14, ceiling 25";
    expect(policy(RAMP).describe()).toContain(rule);
    expect(policy(RAMP).describe(at(2026, 9, 17))).toContain(
      `7/inbox/day today (send day 4, ${rule})`,
    );
  });
});

describe("an inbox's own ramp", () => {
  // Monday 2026-09-14: from 2, +3 every send day, to 10. Weekends and holidays count nothing.
  const OWN = { start: PlainDate.fromIso("2026-09-14"), from: 2, step: 3, ceiling: 10 };
  it.each([
    [[2026, 9, 11], 0], // before its start: no sends at all
    [[2026, 9, 14], 2], // send day 1
    [[2026, 9, 15], 5],
    [[2026, 9, 18], 10 /* 2 + 3 × 4 = 14, capped */],
    [[2026, 9, 21], 10],
  ] as const)("climbs every send day (%j → cap %i)", (day, cap) => {
    const [y, m, d] = day;
    expect(policy(RAMP).perInboxCap(at(y, m, d), OWN)).toBe(cap);
  });
  it("skips the weekend and the fleet's own ramp", () => {
    const p = policy(RAMP);
    // Mon 21: Mon–Fri elapsed = 5, the same count the fleet ramp sees.
    expect(p.sendDaysElapsed(at(2026, 9, 21), OWN)).toBe(5);
    expect(
      p.sendDaysElapsed(at(2026, 9, 21), { ...OWN, start: PlainDate.fromIso("2026-09-17") }),
    ).toBe(2);
    expect(p.perInboxCap(at(2026, 9, 15))).toBe(5); // the fleet's ramp, untouched
  });
  it("paces the day by its own cap", () => {
    const p = policy();
    const sent = at(2026, 9, 14);
    // One left of a cap of 2 shares the rest of the window; the fleet's cap of 5 leaves four.
    expect(p.earliestNextSend(sent, 1, OWN).getTime()).toBeGreaterThan(
      p.earliestNextSend(sent, 1).getTime(),
    );
  });
});

describe("warmup to cold, 2 to 1", () => {
  // Warmup began Mon 2026-08-31 (+2 a calendar day to 60); cold starts Mon 09-14 at 1, +1 a send day, to 30.
  const WARM = {
    start: PlainDate.fromIso("2026-09-14"),
    from: 1,
    step: 1,
    ceiling: 30,
    warmupStart: PlainDate.fromIso("2026-08-31"),
  };
  it("counts warmup by calendar day, weekends too, to the limit", () => {
    const p = policy();
    expect(p.warmupOn(at(2026, 8, 31), WARM)).toBe(0);
    expect(p.warmupOn(at(2026, 9, 14), WARM)).toBe(28);
    expect(p.warmupOn(at(2026, 10, 30), WARM)).toBe(60);
    expect(p.warmupOn(at(2026, 9, 14), { ...WARM, warmupStart: null })).toBeNull();
  });
  it("cold never passes half the day's warmup", () => {
    const p = policy();
    // Warmup a day before the cold start: 2 warm, so 1 cold, though the ramp says 1 anyway.
    const late = { ...WARM, from: 20, warmupStart: PlainDate.fromIso("2026-09-13") };
    expect(p.perInboxCap(at(2026, 9, 14), late)).toBe(1);
    expect(p.perInboxCap(at(2026, 9, 21), late)).toBe(8); // 16 warm ÷ 2; the ramp alone says 25
    expect(p.perInboxCap(at(2026, 9, 14), WARM)).toBe(1); // the ramp is the lower one
    expect(p.perInboxCap(at(2026, 12, 1), WARM)).toBe(30); // 60 warm, 30 cold: the peak
  });
  it("the ratio and climb are settings", () => {
    const p = policy({ warmupPerCold: 3, warmupStep: 3, warmupLimit: 90 });
    const late = { ...WARM, from: 20, warmupStart: PlainDate.fromIso("2026-09-13") };
    expect(p.perInboxCap(at(2026, 9, 21), late)).toBe(8); // 24 warm ÷ 3
    expect(() => policy({ warmupPerCold: 0 })).toThrow(/WREN_WARMUP_PER_COLD/);
  });
});

// Monday 2026-09-14, fleet window 13:00–19:00 America/New_York (EDT, UTC-4):
// 17:00–23:00 UTC. Lead window 13:00–16:00 on the lead's clock.
const LEAD_WINDOW = {
  sendTimezone: "America/New_York",
  sendWindowStart: "13:00",
  sendWindowEnd: "19:00",
  sendLeadWindowStart: "13:00",
  sendLeadWindowEnd: "16:00",
};
const ET_1330 = utc(2026, 9, 14, 17, 30); // 13:30 ET, 10:30 PT
const ET_1630 = utc(2026, 9, 14, 20, 30); // 16:30 ET, 13:30 PT
const ET_1600 = utc(2026, 9, 14, 20, 0); // 16:00 ET: Eastern's close
const EASTERN = "America/New_York";
const PACIFIC = "America/Los_Angeles";
const HAWAII = "Pacific/Honolulu"; // 13:00–16:00 HST = 19:00–22:00 EDT

describe("the lead's own window", () => {
  it("no lead window by default, and every lead is open", () => {
    const p = policy();
    expect(p.leadWindowStart).toBeNull();
    expect(p.leadWindowEnd).toBeNull();
    expect(p.leadWindowOpen(TUESDAY_MIDWINDOW, PACIFIC)).toBe(true);
    expect(p.leadWindowOpen(TUESDAY_MIDWINDOW, null)).toBe(true);
  });
  it("parses to times", () => {
    const p = policy(LEAD_WINDOW);
    expect(p.leadWindowStart).toEqual({ hour: 13, minute: 0 });
    expect(p.leadWindowEnd).toEqual({ hour: 16, minute: 0 });
  });
  it.each([{ sendLeadWindowStart: "13:00" }, { sendLeadWindowEnd: "16:00" }])(
    "half a lead window is loud (%j)",
    (half) => {
      expect(() => policy(half)).toThrow("set both or neither");
    },
  );
  it("end must be after start", () => {
    expect(() => policy({ sendLeadWindowStart: "16:00", sendLeadWindowEnd: "13:00" })).toThrow(
      /WREN_SEND_LEAD_WINDOW_END .* must be after/,
    );
  });
  it("must be HH:MM", () => {
    expect(() => policy({ sendLeadWindowStart: "1pm", sendLeadWindowEnd: "16:00" })).toThrow(
      "WREN_SEND_LEAD_WINDOW_START must be HH:MM",
    );
  });
  it("an Eastern lead is open at the Eastern lunch and a Pacific one waits", () => {
    const p = policy(LEAD_WINDOW);
    expect(p.leadWindowOpen(ET_1330, EASTERN)).toBe(true);
    expect(p.leadWindowOpen(ET_1330, PACIFIC)).toBe(false);
  });
  it("a Pacific lead opens when its own clock passes lunch", () => {
    const p = policy(LEAD_WINDOW);
    expect(p.leadWindowOpen(ET_1630, PACIFIC)).toBe(true);
    expect(p.leadWindowOpen(ET_1630, EASTERN)).toBe(false);
  });
  it("the end is exclusive", () => {
    const p = policy(LEAD_WINDOW);
    expect(p.leadWindowOpen(ET_1600, EASTERN)).toBe(false);
    expect(p.leadWindowOpen(new Date(ET_1600.getTime() - MIN), EASTERN)).toBe(true);
  });
  it("a lead with no zone follows the fleet window alone", () => {
    expect(policy(LEAD_WINDOW).leadWindowOpen(ET_1330, null)).toBe(true);
  });
  it("a zone whose afternoon never meets the fleet window follows it alone", () => {
    const p = policy(LEAD_WINDOW);
    expect(p.leadWindowMeetsFleetWindow(ET_1330, HAWAII)).toBe(false);
    expect(p.leadWindowOpen(ET_1330, HAWAII)).toBe(true);
    expect(p.leadWindowMeetsFleetWindow(ET_1330, PACIFIC)).toBe(true);
  });
  it("is read on the fleet's day, not UTC", () => {
    // 23:30 UTC Monday is 19:30 ET Monday: the fleet window has shut, but the
    // question "does Pacific's afternoon meet today's fleet window" is still Monday's.
    expect(policy(LEAD_WINDOW).leadWindowMeetsFleetWindow(utc(2026, 9, 14, 23, 30), PACIFIC)).toBe(
      true,
    );
  });
  it("describe names the lead window only when set", () => {
    expect(policy().describe()).not.toContain("lead window");
    expect(policy(LEAD_WINDOW).describe()).toContain("lead window 13:00–16:00 on the lead's clock");
  });
});

// US Thanksgiving 2026 is Thu Nov 26; Chicago is CST (UTC-6) by then.
describe("holidays", () => {
  const THANKSGIVING_NOON = utc(2026, 11, 26, 18, 0);
  const DEC_23_EVENING = utc(2026, 12, 24, 0, 0); // 18:00 Wed Dec 23 local
  it("the window stays shut on a holiday", () => {
    expect(policy().windowOpen(THANKSGIVING_NOON)).toBe(false);
    expect(policy().holidayOn(new PlainDate(2026, 11, 26))).toBe("Thanksgiving");
    expect(policy({ sendHolidays: "none" }).windowOpen(THANKSGIVING_NOON)).toBe(true);
  });
  it("the next window skips the year-end break to Monday Jan 4", () => {
    expect(policy().nextWindowOpen(DEC_23_EVENING)).toEqual(utc(2027, 1, 4, 14, 0));
    expect(policy({ sendHolidays: "us" }).nextWindowOpen(DEC_23_EVENING)).toEqual(
      utc(2026, 12, 28, 14, 0),
    );
  });
  it("the ramp does not climb on a holiday", () => {
    // Mon Nov 23 to Mon Nov 30: five weekdays, two of them Thanksgiving and the day after.
    const p = policy({ coldSendsRampStart: "2026-11-23", coldSendsPerInboxPerDay: 25 });
    expect(p.sendDaysElapsed(utc(2026, 11, 30, 18, 0))).toBe(3);
    const none = policy({
      coldSendsRampStart: "2026-11-23",
      coldSendsPerInboxPerDay: 25,
      sendHolidays: "none",
    });
    expect(none.sendDaysElapsed(utc(2026, 11, 30, 18, 0))).toBe(5);
  });
  it("counts holidays across a year boundary once", () => {
    // Mon Dec 21 2026 to Mon Jan 11 2027: 15 weekdays, 7 of them in the year-end break.
    const p = policy({ coldSendsRampStart: "2026-12-21", coldSendsPerInboxPerDay: 25 });
    expect(p.sendDaysElapsed(utc(2027, 1, 11, 18, 0))).toBe(8);
  });
  it("a typo stops startup", () => {
    expect(() => policy({ sendHolidays: "us,xmas" })).toThrow(/WREN_SEND_HOLIDAYS/);
  });
  it("describe says when none are off", () => {
    expect(policy({ sendHolidays: "none" }).describe()).toContain("no holidays off");
  });
});

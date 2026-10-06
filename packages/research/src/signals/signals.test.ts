import { describe, expect, it } from "vitest";
import { signalDate, signalRefusal } from "../findings.js";
import { SIGNAL_KINDS } from "../schema.js";
import {
  anyCollectorBuilt,
  COLLECTORS,
  firmKey,
  personKey,
  readAccount,
  signalsSettingsSchema,
  subjectOf,
} from "./collectors.js";

const draft = (over: Record<string, unknown> = {}) => ({
  kind: "news" as const,
  factKey: "c1:news:x",
  value: { title: "t", topic: "funding", raw: {} } as Record<string, unknown>,
  confidence: 0.9,
  via: "test",
  sourceUrl: "https://example.test/a",
  document: null,
  signalAt: new Date("2026-09-01T00:00:00Z"),
  dated: "published" as const,
  ...over,
});

describe("the registry", () => {
  it("lists the eight collectors once each, all stubs, off by default", () => {
    expect(COLLECTORS.map((c) => c.name)).toEqual([
      "hiring",
      "news",
      "funding",
      "stack",
      "linkedin",
      "talks",
      "site",
      "demand",
    ]);
    expect(anyCollectorBuilt()).toBe(false);
    const s = signalsSettingsSchema.parse({});
    for (const c of COLLECTORS) expect(s[c.name]).toEqual({ on: false });
    for (const c of COLLECTORS) expect(c.bucket.burst).toBeLessThanOrEqual(c.bucket.perDay);
  });

  it("a stub answers unresolved and keeps nothing", async () => {
    for (const c of COLLECTORS)
      expect(await c.collect({} as never, "c1", {})).toEqual({
        state: "unresolved",
        signals: [],
        tried: [],
      });
  });

  it("refuses an unknown collector in settings", () => {
    expect(signalsSettingsSchema.safeParse({ nope: { on: true } }).success).toBe(false);
  });
});

describe("subjects and accounts", () => {
  it("round-trips firm and person keys; a post key is neither", () => {
    expect(subjectOf(firmKey(7))).toEqual({ companyId: 7 });
    expect(subjectOf(personKey(9))).toEqual({ personId: 9 });
    expect(subjectOf("reddit:t3_abc")).toBeNull();
  });

  it("reads LinkedIn only as the alt", () => {
    expect(readAccount("linkedin@alt")).toBe("linkedin@alt");
    expect(readAccount("linkedin")).toBeNull();
    expect(readAccount("linkedin@wren")).toBeNull();
    expect(readAccount(null)).toBeNull();
  });
});

describe("a signal's date", () => {
  const now = new Date("2026-10-06T12:00:00Z");
  const bare = { signalAt: null, dated: null };

  it("reads published_at or date, only on a signal kind with a link", () => {
    expect(
      signalDate({ ...draft(bare), value: { published_at: "2026-09-02T10:00:00Z" } }, now),
    ).toEqual({ at: new Date("2026-09-02T10:00:00Z"), dated: "published" });
    expect(signalDate({ ...draft(bare), value: { date: "2026-08-30" } }, now)?.dated).toBe(
      "published",
    );
    expect(signalDate({ ...draft(bare), value: { date: "2w" } }, now)).toBeNull();
    expect(
      signalDate({ ...draft(bare), sourceUrl: null, value: { date: "2026-08-30" } }, now),
    ).toBeNull();
    expect(
      signalDate({ ...draft(bare), kind: "profile", value: { published_at: "2020-01-01" } }, now),
    ).toBeNull();
  });

  it("hiring: the newest posting, else our read; job_change: our read", () => {
    const roles = [{ postedAt: "2026-09-01" }, { postedAt: "2026-09-20" }, {}];
    expect(signalDate({ ...draft(bare), kind: "hiring", value: { roles } }, now)).toEqual({
      at: new Date("2026-09-20"),
      dated: "published",
    });
    expect(signalDate({ ...draft(bare), kind: "hiring", value: { roles: [] } }, now)).toEqual({
      at: now,
      dated: "seen",
    });
    expect(signalDate({ ...draft(bare), kind: "job_change", value: {} }, now)).toEqual({
      at: now,
      dated: "seen",
    });
  });
});

describe("keepSignal's refusals", () => {
  it("needs a signal kind, a date, a link and the raw", () => {
    expect(signalRefusal(draft())).toBeNull();
    expect(signalRefusal(draft({ kind: "profile" }))).toMatch(/not a signal kind/);
    expect(signalRefusal(draft({ signalAt: null }))).toBe("no date");
    expect(signalRefusal(draft({ signalAt: new Date("x") }))).toBe("no date");
    expect(signalRefusal(draft({ sourceUrl: null }))).toBe("no link");
    expect(signalRefusal(draft({ value: { title: "t" } }))).toBe("no raw");
    expect(SIGNAL_KINDS).toContain("demand");
  });
});

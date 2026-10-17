/**
 * "Research this person" spends from the same day budgets as the profiles stage: its Google
 * searches count in `googleLeft`, and a LinkedIn cap it hits parks `linkedinParkedUntil`.
 * Also: a run that is gone or finished starts nothing. Synthetic rows.
 */
import { resolveProfile } from "@wren/core/profiles";
import { profileLookups } from "@wren/core/profiles-schema";
import { startTestPostgres, type TestPostgres, truncate } from "@wren/db/testing";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { googleLeft, linkedinParkedUntil } from "../../src/enrichment/profiles.js";
import { beginProfileResearch } from "../../src/people/profile-research.js";

let pg: TestPostgres;
beforeAll(async () => {
  pg = await startTestPostgres();
});
afterAll(() => pg.stop());
beforeEach(() =>
  truncate(pg.db, [
    "profile_findings",
    "profile_lookups",
    "profile_keys",
    "profiles",
    "person_lookups",
  ]),
);

const TZ = "America/Chicago";
/** 10:00 in Chicago. */
const DAY = new Date("2026-10-03T15:00:00Z");

async function jane() {
  const r = await resolveProfile(pg.db, [{ kind: "email", value: "jane@example.test" }], "t", {
    name: "Jane Doe",
  });
  return (r as { id: number }).id;
}

describe("shared day budgets", () => {
  it("a run's Google searches count against the day", async () => {
    const id = await jane();
    expect(await googleLeft(pg.db, { now: DAY, timezone: TZ, perDay: 5 })).toBe(5);
    await pg.db.insert(profileLookups).values({
      profileId: id,
      state: "done",
      tried: [
        { step: "google", what: "q one", outcome: "3 results, 1 by name, 0 naming the firm" },
        { step: "google", what: "q two", outcome: "0 results, 0 by name, 0 naming the firm" },
        { step: "search", what: "Jane Doe", outcome: "0 people via exa" },
      ],
      finishedAt: new Date("2026-10-03T14:00:00Z"),
    });
    expect(await googleLeft(pg.db, { now: DAY, timezone: TZ, perDay: 5 })).toBe(3);
    // A stopped search ends the day for every stage.
    await pg.db.insert(profileLookups).values({
      profileId: id,
      state: "done",
      tried: [{ step: "google", what: "q", outcome: "stopped: captcha" }],
      finishedAt: new Date("2026-10-03T14:30:00Z"),
    });
    expect(await googleLeft(pg.db, { now: DAY, timezone: TZ, perDay: 5 })).toBe(0);
  });

  it("an unfinished or empty trail adds nothing and breaks nothing", async () => {
    const id = await jane();
    await pg.db.insert(profileLookups).values([
      { profileId: id, state: "queued" },
      { profileId: id, state: "running", tried: [] },
      { profileId: id, state: "failed", tried: null, finishedAt: DAY },
    ]);
    expect(await googleLeft(pg.db, { now: DAY, timezone: TZ, perDay: 5 })).toBe(5);
    expect(await linkedinParkedUntil(pg.db)).toBeNull();
  });

  it("a LinkedIn cap a run hit parks the account until it lifts", async () => {
    const id = await jane();
    const until = new Date(Date.now() + 3_600_000);
    await pg.db.insert(profileLookups).values({
      profileId: id,
      state: "done",
      outcome: "capped",
      tried: [{ step: "capped", what: "linkedin: daily cap", outcome: "retry after 3600s" }],
      retryAt: until,
      finishedAt: new Date(),
    });
    expect((await linkedinParkedUntil(pg.db))?.getTime()).toBe(until.getTime());
    // A lifted cap parks nothing.
    await pg.db.update(profileLookups).set({ retryAt: new Date(Date.now() - 1000) });
    expect(await linkedinParkedUntil(pg.db)).toBeNull();
  });
});

describe("beginProfileResearch", () => {
  it("marks a queued run running with what it searches by; a finished or missing run starts nothing", async () => {
    const id = await jane();
    const [q] = await pg.db
      .insert(profileLookups)
      .values({ profileId: id, state: "queued" })
      .returning({ id: profileLookups.id });
    const begun = await beginProfileResearch(pg.db, (q as { id: number }).id);
    expect(begun?.profileId).toBe(id);
    expect(begun?.subject).toMatchObject({ firstName: "Jane", lastName: "Doe" });
    const [row] = await pg.db.select().from(profileLookups);
    expect(row).toMatchObject({ state: "running" });
    expect(row?.startedAt).toBeTruthy();
    await pg.db.update(profileLookups).set({ state: "done" });
    expect(await beginProfileResearch(pg.db, (q as { id: number }).id)).toBeNull();
    expect(await beginProfileResearch(pg.db, 999_999)).toBeNull();
  });
});

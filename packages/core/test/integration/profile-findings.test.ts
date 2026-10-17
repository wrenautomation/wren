/**
 * "Research this person" writes (designs/2026-10-17-people-depth.md): queue a run once at a time,
 * keep and drop findings, a kept handle becomes a key. Synthetic rows.
 */
import { startTestPostgres, type TestPostgres, truncate } from "@wren/db/testing";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  abandonProfileResearch,
  decideFindings,
  findingRows,
  queueProfileResearch,
  researchDetail,
} from "../../src/profile-findings.js";
import { resolveProfile } from "../../src/profiles.js";
import { profileFindings, profileLookups } from "../../src/profiles-schema.js";
import { PortalRefusal } from "../../src/refusal.js";

let pg: TestPostgres;
beforeAll(async () => {
  pg = await startTestPostgres();
});
afterAll(() => pg.stop());

type Row = Record<string, unknown>;
const run = async (q: ReturnType<typeof sql>) => (await pg.db.execute(q)) as unknown as Row[];
const T = (day: number) => new Date(Date.UTC(2026, 9, day, 12));

beforeEach(async () => {
  await truncate(pg.db, [
    "profile_findings",
    "profile_lookups",
    "profile_merges",
    "profile_trait_events",
    "profile_traits",
    "profile_keys",
    "profiles",
    "social_handles",
  ]);
});

const person = async (email: string, name: string) => {
  const r = await resolveProfile(pg.db, [{ kind: "email", value: email }], "t", { name, at: T(2) });
  return (r as { id: number }).id;
};

/** One finding on a profile, as a run would store it. */
async function finding(
  profileId: number,
  f: { kind: string; platform?: string | null; value: string; url?: string | null },
  state = "found",
) {
  const [row] = await pg.db
    .insert(profileFindings)
    .values({
      profileId,
      kind: f.kind as never,
      ref: `${f.kind}:${f.platform ?? ""}:${f.value}`,
      platform: f.platform ?? null,
      value: f.value,
      url: f.url ?? null,
      source: "elsewhere",
      confidence: 0.6,
      state: state as never,
    })
    .returning({ id: profileFindings.id });
  return (row as { id: number }).id;
}

describe("queueProfileResearch", () => {
  it("queues one run, and refuses a second while it is queued or running", async () => {
    const id = await person("jane@example.test", "Jane Doe");
    const first = await queueProfileResearch(pg.db, id, "william");
    expect(first.profileId).toBe(id);
    const [row] = await pg.db.select().from(profileLookups);
    expect(row).toMatchObject({ id: first.lookupId, state: "queued", by: "william" });
    await expect(queueProfileResearch(pg.db, id, "william")).rejects.toMatchObject({
      message: "Already running",
      status: 409,
    });
    await pg.db.update(profileLookups).set({ state: "running" });
    await expect(queueProfileResearch(pg.db, id, "william")).rejects.toThrow("Already running");
    // A finished run frees the next.
    await pg.db.update(profileLookups).set({ state: "done" });
    const next = await queueProfileResearch(pg.db, id, "william");
    expect(next.lookupId).toBeGreaterThan(first.lookupId);
  });

  it("two presses at once queue one run", async () => {
    const id = await person("jane@example.test", "Jane Doe");
    const got = await Promise.allSettled([
      queueProfileResearch(pg.db, id, "a"),
      queueProfileResearch(pg.db, id, "b"),
    ]);
    expect(got.filter((g) => g.status === "fulfilled")).toHaveLength(1);
    const bad = got.find((g) => g.status === "rejected") as PromiseRejectedResult;
    expect(bad.reason).toBeInstanceOf(PortalRefusal);
    expect(await pg.db.select().from(profileLookups)).toHaveLength(1);
  });

  it("fails a run that never finished, so a new one may start", async () => {
    const id = await person("jane@example.test", "Jane Doe");
    const old = await queueProfileResearch(pg.db, id, "william");
    await pg.db.execute(
      sql`update profile_lookups set created_at = now() - interval '2 hours' where id = ${old.lookupId}`,
    );
    const fresh = await queueProfileResearch(pg.db, id, "william");
    expect(fresh.lookupId).not.toBe(old.lookupId);
    const rows = await run(sql`select id, state, error from profile_lookups order by id`);
    expect(rows.map((r) => r.state)).toEqual(["failed", "queued"]);
    expect(rows[0]?.error).toBe("The run did not finish.");
  });

  it("refuses a missing or merged profile", async () => {
    await expect(queueProfileResearch(pg.db, 999_999, "w")).rejects.toMatchObject({ status: 404 });
    const a = await person("a@example.test", "Ann Lee");
    const b = await person("b@example.test", "Ann Lee");
    await pg.db.execute(sql`update profiles set merged_into = ${a} where id = ${b}`);
    await expect(queueProfileResearch(pg.db, b, "w")).rejects.toMatchObject({ status: 409 });
  });

  it("abandons a queued run that could not start", async () => {
    const id = await person("jane@example.test", "Jane Doe");
    const q = await queueProfileResearch(pg.db, id, "w");
    await abandonProfileResearch(pg.db, q.lookupId, "The run could not be started.");
    const [row] = await pg.db.select().from(profileLookups);
    expect(row).toMatchObject({ state: "failed", error: "The run could not be started." });
    expect((await queueProfileResearch(pg.db, id, "w")).lookupId).toBeGreaterThan(q.lookupId);
  });
});

describe("decideFindings", () => {
  it("keeping a handle adds its key to the profile and its page to the handle row", async () => {
    const id = await person("jane@example.test", "Jane Doe");
    const f = await finding(id, {
      kind: "handle",
      platform: "x",
      value: "janedoe",
      url: "https://x.com/janedoe",
    });
    const got = await decideFindings(pg.db, [f], "kept", "william", T(5));
    expect(got).toEqual({ done: [f], keys: 1 });
    const keys = await run(
      sql`select kind, value from profile_keys where profile_id = ${id} order by kind`,
    );
    expect(keys).toEqual([
      { kind: "email", value: "jane@example.test" },
      { kind: "handle:x", value: "janedoe" },
    ]);
    const [h] = await run(sql`select platform, handle, url, name from social_handles`);
    expect(h).toEqual({
      platform: "x",
      handle: "janedoe",
      url: "https://x.com/janedoe",
      name: "Jane Doe",
    });
    const [row] = await pg.db.select().from(profileFindings);
    expect(row).toMatchObject({ state: "kept", decidedBy: "william" });
    expect(row?.decidedAt).toEqual(T(5));
    // Again: nothing new.
    expect(await decideFindings(pg.db, [f], "kept", "william")).toEqual({ done: [f], keys: 0 });
  });

  it("a key another profile holds merges the two, and the finding moves with it", async () => {
    const jane = await person("jane@example.test", "Jane Doe");
    const other = await resolveProfile(pg.db, [{ kind: "handle:x", value: "janedoe" }], "t", {
      at: T(3),
    });
    const f = await finding(jane, { kind: "handle", platform: "x", value: "janedoe" });
    const got = await decideFindings(pg.db, [f], "kept", "william");
    expect(got.keys).toBe(0);
    const [live1] = await run(sql`select count(*)::int n from profiles where merged_into is null`);
    expect(live1?.n).toBe(1);
    const [row] = await pg.db.select().from(profileFindings);
    const live = (await run(sql`select id from profiles where merged_into is null`))[0] as {
      id: number;
    };
    expect(row?.profileId).toBe(live.id);
    expect([jane, (other as { id: number }).id]).toContain(live.id);
  });

  it("keeping a link or a role only marks it; dropping marks it and adds nothing", async () => {
    const id = await person("jane@example.test", "Jane Doe");
    const link = await finding(id, {
      kind: "link",
      platform: "github",
      value: "Jane Doe (janedoe)",
      url: "https://github.com/janedoe",
    });
    const job = await finding(id, { kind: "employer", value: "Recruiter at Acme Staffing" });
    const handle = await finding(id, { kind: "handle", platform: "x", value: "janedoe" });
    expect(await decideFindings(pg.db, [link, job], "kept", "w")).toEqual({
      done: [link, job],
      keys: 0,
    });
    expect(await decideFindings(pg.db, [handle], "dropped", "w")).toEqual({
      done: [handle],
      keys: 0,
    });
    expect(await run(sql`select kind from profile_keys where kind like 'handle:%'`)).toEqual([]);
    expect(await run(sql`select 1 from social_handles`)).toEqual([]);
    const states = await run(sql`select state from profile_findings order by id`);
    expect(states.map((r) => r.state)).toEqual(["kept", "kept", "dropped"]);
  });

  it("a dropped handle can be kept after all", async () => {
    const id = await person("jane@example.test", "Jane Doe");
    const f = await finding(id, { kind: "handle", platform: "x", value: "janedoe" }, "dropped");
    expect((await decideFindings(pg.db, [f], "kept", "w")).keys).toBe(1);
  });
});

describe("what the page reads", () => {
  it("the newest run and its findings, and every finding as a row", async () => {
    const id = await person("jane@example.test", "Jane Doe");
    await pg.db.insert(profileLookups).values({
      profileId: id,
      state: "done",
      outcome: "matched",
      by: "w",
      tried: [{ step: "search", what: "Jane Doe Acme", outcome: "1 people via exa" }],
    });
    await finding(id, { kind: "handle", platform: "x", value: "janedoe", url: "https://x.com/jd" });
    const d = await researchDetail(pg.db, id);
    expect(d.run).toMatchObject({
      state: "done",
      outcome: "matched",
      steps: ["Search Jane Doe Acme: 1 people via exa"],
    });
    expect(d.findings).toHaveLength(1);
    expect(d.findings[0]).toMatchObject({ kind: "handle", platform: "x", state: "found" });
    const rows = await findingRows(pg.db);
    expect(rows[0]).toMatchObject({
      who: "Jane Doe",
      profile_id: id,
      profile_link: `/people/people/${id}`,
      value: "janedoe",
    });
    expect((await researchDetail(pg.db, 999_999)).run).toBeNull();
  });
});

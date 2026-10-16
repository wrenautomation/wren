/**
 * Channel stats and the new segment rules (designs/2026-10-15-channel-stats.md) on a real
 * database: timed and anchored events, at most, campaigns, funnel steps, one_of; versions;
 * inSegment; the funnel per channel, source and trait, by each attribution, filtered by a rule;
 * and the people behind a number. Synthetic rows; every time is fixed.
 */
import { startTestPostgres, type TestPostgres, truncate } from "@wren/db/testing";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { channelPeople, channelStats, type StatsQuery } from "../../src/channel-stats.js";
import { mergeProfiles, resolveProfile, setTraits } from "../../src/profiles.js";
import { profileOfEvent } from "../../src/segment-step.js";
import {
  addMembers,
  inSegment,
  previewRule,
  type Rule,
  saveSegment,
  segmentVersions,
} from "../../src/segments.js";
import { parseRule } from "../../src/segments-text.js";

let pg: TestPostgres;
beforeAll(async () => {
  pg = await startTestPostgres();
});
afterAll(() => pg.stop());

type Row = Record<string, unknown>;
const run = async (q: ReturnType<typeof sql>) => (await pg.db.execute(q)) as unknown as Row[];
const one = async (q: ReturnType<typeof sql>) => (await run(q))[0] as Row;
/** October 2026, noon UTC, by day. */
const T = (day: number, hour = 12) => new Date(Date.UTC(2026, 9, day, hour));
const NOW = T(14);

beforeEach(async () => {
  await truncate(pg.db, [
    "segment_versions",
    "segment_member_events",
    "segment_members",
    "segments",
    "profile_events",
    "profile_merges",
    "profile_trait_events",
    "profile_traits",
    "profile_keys",
    "profiles",
    "sms_messages",
    "sms_contacts",
    "touches",
    "social_handles",
    "enrollments",
    "reach_contacts",
    "companies",
  ]);
});

async function person(name: string, keys: { kind: string; value: string }[]): Promise<number> {
  const got = await resolveProfile(pg.db, keys, "test", { name, at: T(1) });
  return got?.id as number;
}

let n = 0;
async function text(e164: string, out: Date, reply?: Date) {
  const c = (
    await one(sql`insert into sms_contacts (e164, source_kind, basis)
      values (${e164}, 'manual', 'opt_in') returning id`)
  ).id as number;
  await run(sql`insert into sms_messages (contact_id, direction, kind, to_e164, body, state, sent_at, delivered_at, provider_id, cost_usd)
    values (${c}, 'out', 'manual', ${e164}, 'Hello', 'delivered', ${out.toISOString()},
      ${out.toISOString()}, ${`SM${++n}`}, 0.01)`);
  if (reply)
    await run(sql`insert into sms_messages (contact_id, direction, kind, to_e164, body, state, received_at, provider_id)
      values (${c}, 'in', 'inbound', ${e164}, 'Yes', 'received', ${reply.toISOString()}, ${`SM${++n}`})`);
}

async function touch(
  handle: string,
  direction: "ours" | "theirs",
  kind: string,
  at: Date,
  response?: { response: string; at: Date },
) {
  const h = (
    await one(sql`insert into social_handles (platform, handle) values ('reddit', ${handle})
      on conflict (platform, handle) do update set handle = excluded.handle returning id`)
  ).id as number;
  await run(sql`insert into touches (handle_id, kind, direction, url, at, response, response_at, source, ref)
    values (${h}, ${kind}, ${direction}, 'https://reddit.example/r/x/1', ${at.toISOString()},
      ${response?.response ?? null}, ${response?.at.toISOString() ?? null}, 'test', ${`t${++n}`})`);
}

const booking = (profile: number, at: Date) =>
  run(sql`insert into profile_events (profile_id, kind, channel, at, summary, source, source_id)
    values (${profile}, 'booking', 'calendar', ${at.toISOString()}, 'Booked a call', 'test', ${String(++n)})`);

/**
 * Ann: texted Oct 2, replied Oct 3, booked Oct 5. Bo: we replied on Reddit Oct 1 and he answered
 * Oct 2; texted Oct 4; booked Oct 6. Cy: liked our Reddit post Oct 8. Di: nothing.
 */
async function world() {
  const ann = await person("Ann", [
    { kind: "email", value: "ann@example.test" },
    { kind: "phone", value: "+15550100001" },
  ]);
  const bo = await person("Bo", [
    { kind: "phone", value: "+15550100002" },
    { kind: "handle:reddit", value: "bo_r" },
  ]);
  const cy = await person("Cy", [{ kind: "handle:reddit", value: "cy_r" }]);
  const di = await person("Di", [{ kind: "email", value: "di@example.test" }]);
  await setTraits(pg.db, ann, { persona: "agency owner" }, "t", T(1));
  await setTraits(pg.db, bo, { persona: "coach" }, "t", T(1));
  await setTraits(pg.db, cy, { persona: "Agency Owner" }, "t", T(1));
  await text("+15550100001", T(2), T(3));
  await text("+15550100002", T(4));
  await touch("bo_r", "ours", "reply", T(1), { response: "replied", at: T(2) });
  await touch("cy_r", "theirs", "like", T(8));
  await booking(ann, T(5));
  await booking(bo, T(6));
  return { ann, bo, cy, di };
}

const who = async (text: string): Promise<string[]> => {
  const got = parseRule(text);
  if ("problems" in got) throw new Error(got.problems.join("; "));
  const p = await previewRule(pg.db, got.rule, NOW);
  return p.sample.map((s) => s.name).sort();
};

describe("new rule conditions on the database", () => {
  it("events: on a channel, at most, never, before and after another", async () => {
    await world();
    expect(await who("event booking never")).toEqual(["Cy", "Di"]);
    expect(await who("event touch on reddit")).toEqual(["Bo", "Cy"]);
    expect(await who('event touch on reddit matching "they like"')).toEqual(["Cy"]);
    expect(await who("event text_sent <= 1")).toEqual(["Ann", "Bo", "Cy", "Di"]);
    expect(await who("event text_sent before booking")).toEqual(["Ann", "Bo"]);
    expect(await who("event text_sent after booking")).toEqual([]);
    expect(await who("event text_received in 30d after text_sent on sms")).toEqual(["Ann"]);
    // Before an anchor they never had: every line counts.
    expect(await who("event touch before booking")).toEqual(["Bo", "Cy"]);
  });

  it("messages by campaign, steps by channel, traits in a list", async () => {
    await world();
    expect(await who('message delivered on sms campaign "manual"')).toEqual(["Ann", "Bo"]);
    expect(await who('message delivered campaign "nope"')).toEqual([]);
    expect(await who("step replied on sms")).toEqual(["Ann"]);
    expect(await who("step replied on reddit")).toEqual(["Bo"]);
    expect(await who("step booked on reddit")).toEqual(["Bo"]);
    expect(await who("step booked on sms in 30d")).toEqual(["Ann", "Bo"]);
    expect(await who("step booked on reddit in 9d")).toEqual(["Bo"]);
    expect(await who("step booked on reddit in 7d")).toEqual([]);
    expect(await who("step saw on reddit in 7d")).toEqual(["Cy"]);
    expect(await who('trait persona one_of "agency owner, coach"')).toEqual(["Ann", "Bo", "Cy"]);
    expect(
      await who(
        'all(trait persona is "agency owner", step reached on reddit in 30d, not step booked)',
      ),
    ).toEqual(["Cy"]);
  });
});

describe("versions and inSegment", () => {
  it("keeps every save; answers for one person, merged or not", async () => {
    const { ann, bo, cy } = await world();
    const rule = (persona: string): Rule => ({
      kind: "group",
      match: "all",
      of: [{ kind: "trait", key: "persona", op: "is", value: persona }],
    });
    const first = await saveSegment(
      pg.db,
      { name: "Owners", kind: "live", rule: rule("agency owner") },
      "t",
      NOW,
    );
    expect(first.segment.version).toBe(1);
    const second = await saveSegment(
      pg.db,
      {
        id: first.segment.id,
        name: "Coaches",
        kind: "live",
        rule: rule("coach"),
        expect: first.segment.updatedAt,
      },
      "t",
      T(14, 13),
    );
    expect(second.segment.version).toBe(2);
    const versions = await segmentVersions(pg.db, first.segment.id);
    expect(versions.map((v) => [v.version, v.name])).toEqual([
      [2, "Coaches"],
      [1, "Owners"],
    ]);
    expect(versions[1]?.rule).toEqual(rule("agency owner"));

    expect(await inSegment(pg.db, bo, second.segment.id, NOW)).toBe(true);
    expect(await inSegment(pg.db, ann, second.segment.id, NOW)).toBe(false);
    expect(await inSegment(pg.db, ann, rule("agency owner"), NOW)).toBe(true);
    expect(await inSegment(pg.db, ann, 9999, NOW)).toBe(false);

    const hand = (await saveSegment(pg.db, { name: "Hand", kind: "manual" }, "t", NOW)).segment;
    await addMembers(pg.db, hand.id, [ann], NOW);
    expect(await inSegment(pg.db, ann, hand, NOW)).toBe(true);
    // Cy merged into Ann answers as Ann.
    await mergeProfiles(pg.db, ann, cy, "t", "test", NOW);
    expect(await inSegment(pg.db, cy, hand, NOW)).toBe(true);
  });
});

describe("In segment finds the person", () => {
  it("from an email enrollment, a text contact or a DM contact, by subject or data", async () => {
    const { ann, bo, cy } = await world();
    const company = (
      await one(sql`insert into companies (domain) values ('firm.example.test') returning id`)
    ).id as number;
    const enrollment = (
      await one(sql`insert into enrollments
        (niche, sequence_name, sequence_snapshot, offer, state, company_id, kind, to_email, sender)
        values ('plumbing', 'cold_intro', '{}'::jsonb, 'offer', 'active', ${company},
          'role_inbox', 'Ann@Example.test', 'sender@example.test') returning id`)
    ).id as number;
    const contact = (await one(sql`select id from sms_contacts where e164 = '+15550100002'`))
      .id as number;
    const dm = (
      await one(sql`insert into reach_contacts (platform, handle, url, found_in)
        values ('reddit', 'cy_r', 'https://reddit.example/u/cy_r', 'test') returning id`)
    ).id as number;
    const at = (subject: string, data: Record<string, unknown> = {}) =>
      profileOfEvent(pg.db, { subject, kind: "lead", data });

    expect(await at(`lead:email:${enrollment}`)).toBe(ann);
    expect(await at(`reply:email:${enrollment}`)).toBe(ann);
    expect(await at(`lead:sms:${contact}`)).toBe(bo);
    expect(await at(`reply:sms:${contact}`)).toBe(bo);
    expect(await at(`reply:reach:${dm}`)).toBe(cy);
    // A trigger's own subject, the thread in its data.
    expect(await at("form:site:1", { enrollmentId: enrollment })).toBe(ann);
    expect(await at("call:9", { contactId: dm, channel: "dm" })).toBe(cy);
    // Its own fields first; nothing known is no one.
    expect(await at(`lead:sms:${contact}`, { email: "ann@example.test" })).toBe(ann);
    expect(await at("lead:email:999999")).toBeNull();
    expect(await at("form:site:2")).toBeNull();
  });
});

describe("channelStats", () => {
  const row = async (q: StatsQuery, key: string) =>
    (await channelStats(pg.db, q, NOW)).rows.find((r) => r.key === key);

  it("counts each channel's funnel; a step it can't prove is null", async () => {
    await world();
    const sms = await row({}, "sms");
    expect(sms?.people).toEqual({
      reached: 2,
      saw: null,
      engaged: null,
      replied: 1,
      booked: 2,
      paid: 0,
    });
    expect(sms?.sends).toBe(2);
    expect(sms?.costUsd).toBeCloseTo(0.02);
    expect(sms?.rates.replied).toBe(0.5);
    const reddit = await row({}, "reddit");
    expect(reddit?.people).toEqual({
      reached: 2,
      saw: 2,
      engaged: 2,
      replied: 1,
      booked: 1,
      paid: 0,
    });
    expect(reddit?.label).toBe("Reddit");
  });

  it("gives bookings by attribution", async () => {
    await world();
    expect((await row({ attribution: "first" }, "sms"))?.people.booked).toBe(1);
    expect((await row({ attribution: "first" }, "reddit"))?.people.booked).toBe(1);
    expect((await row({ attribution: "last" }, "sms"))?.people.booked).toBe(2);
    expect((await row({ attribution: "last" }, "reddit"))?.people.booked).toBe(0);
  });

  it("cohorts by first reach in the window; filters by rule and segment; rows by trait", async () => {
    const { ann } = await world();
    expect((await row({ days: 11 }, "sms"))?.people.reached).toBe(1);
    expect((await row({ days: 11 }, "reddit"))?.people.reached).toBe(1);
    const owners = parseRule('trait persona is "agency owner"');
    if ("problems" in owners) throw new Error("rule");
    expect((await row({ rule: owners.rule }, "sms"))?.people.reached).toBe(1);
    expect((await row({ rule: owners.rule }, "reddit"))?.people.reached).toBe(1);
    const hand = (await saveSegment(pg.db, { name: "Hand", kind: "manual" }, "t", NOW)).segment;
    await addMembers(pg.db, hand.id, [ann], NOW);
    const got = await channelStats(pg.db, { segment: hand.id }, NOW);
    expect(got.rows.map((r) => r.key)).toEqual(["sms"]);
    const byTrait = await channelStats(pg.db, { by: "trait:persona" }, NOW);
    expect(byTrait.rows.map((r) => [r.key, r.people.reached])).toEqual([
      ["agency owner", 2],
      ["coach", 1],
    ]);
    const bySource = await channelStats(pg.db, { by: "source", channel: "sms" }, NOW);
    expect(bySource.rows.map((r) => [r.label, r.people.reached])).toEqual([["manual", 2]]);
    await expect(channelStats(pg.db, { by: "nope" as "channel" }, NOW)).rejects.toThrow(/by is/);
  });

  it("lists the people behind a number, latest first", async () => {
    await world();
    const booked = await channelPeople(pg.db, { key: "sms", step: "booked" }, NOW);
    expect(booked.map((p) => p.name)).toEqual(["Bo", "Ann"]);
    expect(booked[1]?.email).toBe("ann@example.test");
    expect(booked[0]?.link).toMatch(/^\/people\/people\/\d+$/);
    const replied = await channelPeople(pg.db, { key: "reddit", step: "replied" }, NOW);
    expect(replied.map((p) => p.name)).toEqual(["Bo"]);
  });
});

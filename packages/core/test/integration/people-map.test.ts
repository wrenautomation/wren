/**
 * The people map (designs/2026-10-15-people-map.md): stage, warmth and why, persona, the trait
 * mirror, loose handles keyed, site counts, and the warm gate. Synthetic rows.
 */
import { startTestPostgres, type TestPostgres, truncate } from "@wren/db/testing";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { leadRefusal } from "../../src/leads.js";
import {
  coldOpenerRefusal,
  countHits,
  findProfile,
  keyLooseHandles,
  listPeople,
  peopleCounts,
  readSiteCounts,
  refreshPeople,
  storedRollup,
  warmthOf,
} from "../../src/people-map.js";
import { mergeProfiles, resolveProfile, setTraits } from "../../src/profiles.js";

let pg: TestPostgres;
beforeAll(async () => {
  pg = await startTestPostgres();
});
afterAll(() => pg.stop());

type Row = Record<string, unknown>;
const run = async (q: ReturnType<typeof sql>) => (await pg.db.execute(q)) as unknown as Row[];
const one = async (q: ReturnType<typeof sql>) => (await run(q))[0] as Row;
const T = (day: number, min = 0) => new Date(Date.UTC(2026, 9, day, 12, min));
const S = (day: number, min = 0) => T(day, min).toISOString();

beforeEach(async () => {
  await truncate(pg.db, [
    "profile_rollups",
    "profile_site_reads",
    "profile_events",
    "profile_merges",
    "profile_trait_events",
    "profile_traits",
    "profile_keys",
    "profiles",
    "open_events",
    "email_clicks",
    "thread_events",
    "messages",
    "enrollments",
    "people",
    "companies",
    "consent_events",
    "consents",
    "topics",
    "touches",
    "social_handles",
    "comments",
    "sms_messages",
    "sms_contacts",
  ]);
});

const profile = async (email: string, at = T(1)) =>
  (await resolveProfile(pg.db, [{ kind: "email", value: email }], "test", { at }))?.id as number;

/** One cold email sent to `email` on `day`; returns the message id. */
async function emailed(email: string, day: number): Promise<number> {
  const c = await one(sql`insert into companies (domain) values (${`${email}.test`}) returning id`);
  const e = await one(sql`insert into enrollments
    (niche, sequence_name, sequence_snapshot, offer, state, company_id, kind, to_email, sender)
    values ('plumbing', 'cold_intro', '{}'::jsonb, 'offer', 'active', ${c.id as number},
      'role_inbox', ${email}, 'sender@example.test') returning id`);
  const m = await one(sql`insert into messages
    (enrollment_id, step, template, template_version, to_email, subject, body, provenance, state, sent_at, message_id)
    values (${e.id as number}, 1, 't', 'v1', ${email}, 'Hi', 'One line.', '{}'::jsonb, 'sent',
      ${S(day)}, ${`<${email}.${day}@example.test>`}) returning id, enrollment_id`);
  return m.id as number;
}

describe("stage and warmth", () => {
  it("a key only is a cold stranger; a send makes a cold lead", async () => {
    const a = await profile("a@example.test");
    const b = await profile("b@example.test");
    await emailed("b@example.test", 2);
    await refreshPeople(pg.db);
    expect(await storedRollup(pg.db, a)).toMatchObject({ stage: "stranger", warmth: "cold" });
    const rb = await storedRollup(pg.db, b);
    expect(rb).toMatchObject({ stage: "lead", warmth: "cold", why: [], warmthLine: null });
    expect(rb?.counts.contacted.n).toBe(1);
    expect(rb?.lastTouch?.channel).toBe("email");
  });

  it("an open counts only past two minutes; a click and a reply make them warm", async () => {
    const id = await profile("c@example.test");
    const m = await emailed("c@example.test", 2);
    await run(sql`insert into open_events (message_id, remote_id, seen_at) values
      (${m}, 1, ${S(2, 1)})`);
    expect((await warmthOf(pg.db, [id]))[0]).toMatchObject({ warmth: "cold", stage: "lead" });
    await run(sql`insert into open_events (message_id, remote_id, seen_at) values
      (${m}, 2, ${S(3)}), (${m}, 3, ${S(4)})`);
    await run(sql`insert into email_clicks (link_code, url, message_id, first_at, last_at, clicks)
      values ('abc', '/go/x', ${m}, ${S(3)}, ${S(3)}, 2)`);
    const enr = await one(sql`select enrollment_id from messages where id = ${m}`);
    await run(sql`insert into thread_events (enrollment_id, kind, received_at)
      values (${enr.enrollment_id as number}, 'reply', ${S(5)})`);
    const [r] = await warmthOf(pg.db, [id]);
    expect(r).toMatchObject({
      stage: "replied",
      warmth: "warm",
      why: ["replied", "opened", "clicked"],
      repliedLastChannel: "email",
    });
    expect(r?.counts.opened.n).toBe(2);
    expect(r?.counts.clicked.n).toBe(2);
    expect(r?.warmthLine).toBe(
      "replied, last Oct 5; opened 2x, last Oct 4; clicked 2x, last Oct 3",
    );
    expect(r?.warmSince).toBe(S(3));
  });

  it("a confirmed consent is subscribed; every consent is listed", async () => {
    const id = await profile("d@example.test");
    const t = await one(sql`insert into topics (name, public_name, line, channel, cadence)
      values ('news', 'News', 'l', 'email', 'weekly') returning id`);
    await run(sql`insert into consents (channel, address, topic_id, state, source, text_version, confirmed_at)
      values ('email', 'd@example.test', ${t.id as number}, 'confirmed', 'lander_form', 'v1', ${S(2)})`);
    const [r] = await warmthOf(pg.db, [id]);
    expect(r).toMatchObject({ warmth: "warm", stage: "lead", why: ["subscribed"] });
    expect(r?.subscriptions).toBe("News (email, confirmed)");
  });

  it("a payment makes a client; a lifecycle mark makes a past client", async () => {
    const a = await profile("e@example.test");
    const b = await profile("f@example.test");
    await run(sql`insert into profile_events (profile_id, kind, channel, at, summary, source, source_id)
      values (${a}, 'payment', 'pay', ${S(3)}, 'Paid $1 for setup', 'pay_links', 'p1')`);
    await setTraits(pg.db, b, { lifecycle: "past_client" }, "test");
    const got = await warmthOf(pg.db, [a, b]);
    expect(got.find((r) => r.profileId === a)).toMatchObject({ stage: "client", warmth: "warm" });
    expect(got.find((r) => r.profileId === b)).toMatchObject({
      stage: "past_client",
      warmth: "warm",
    });
  });
});

describe("social", () => {
  it("their comment is engaged; a handle with no key gets one", async () => {
    const h = await one(sql`insert into social_handles (platform, handle, name)
      values ('x', 'someone', 'Some One') returning id`);
    await run(sql`insert into touches (handle_id, kind, direction, at, source, ref, text)
      values (${h.id as number}, 'comment', 'theirs', ${S(2)}, 'test', 'c:1', 'Nice post')`);
    const first = await keyLooseHandles(pg.db);
    expect(first).toEqual({ seen: 1, keyed: 1 });
    expect(await keyLooseHandles(pg.db)).toEqual({ seen: 1, keyed: 0 });
    const k = await one(sql`select profile_id from profile_keys where kind = 'handle:x'`);
    const [r] = await warmthOf(pg.db, [k.profile_id as number]);
    expect(r).toMatchObject({ warmth: "warm", why: ["engaged"], cameFrom: "social_handle" });
    expect(r?.lastTouch?.what).toBe("They comment: Nice post");
  });

  it("a reply to ours is replied", async () => {
    const h = await one(sql`insert into social_handles (platform, handle)
      values ('linkedin', 'pat') returning id`);
    await run(sql`insert into touches (handle_id, kind, direction, at, source, ref, response, response_at)
      values (${h.id as number}, 'dm', 'ours', ${S(2)}, 'test', 'rm:1', 'replied', ${S(3)})`);
    await keyLooseHandles(pg.db);
    const k = await one(sql`select profile_id from profile_keys where kind = 'handle:linkedin'`);
    const [r] = await warmthOf(pg.db, [k.profile_id as number]);
    expect(r).toMatchObject({ stage: "replied", warmth: "warm", repliedLastChannel: "linkedin" });
    expect(r?.counts.contacted.n).toBe(1);
  });
});

describe("persona", () => {
  it("role from the title, niche and size from the company; a trait wins", async () => {
    const c = await one(sql`insert into companies (domain, name, niche, raw)
      values ('firm.example.test', 'Firm', 'agencies', ${JSON.stringify({ "Company Size": "2 - 9" })}::jsonb)
      returning id`);
    const p =
      await one(sql`insert into people (company_id, full_name, title, is_compliance, origin, origin_ref, raw)
      values (${c.id as number}, 'Pat Lee', 'Founder & CEO', false, 'manual', 'r1', '{}'::jsonb)
      returning id`);
    const id = (
      await resolveProfile(
        pg.db,
        [
          { kind: "person", value: p.id as number },
          { kind: "email", value: "pat@firm.example.test" },
        ],
        "test",
      )
    )?.id as number;
    const [r] = await warmthOf(pg.db, [id]);
    expect(r).toMatchObject({
      persona: "agencies owner",
      personaRole: "owner",
      personaNiche: "agencies",
      personaSize: "small",
    });
    await setTraits(pg.db, id, { persona_role: "executive", persona_size: "mid" }, "test");
    const [s] = await warmthOf(pg.db, [id]);
    expect(s).toMatchObject({ personaRole: "executive", personaSize: "mid" });
  });

  it("a vice president is an executive; no title is unknown", async () => {
    const a = await profile("vp@example.test");
    const b = await profile("none@example.test");
    await setTraits(pg.db, a, { title: "Vice President, Sales" }, "test");
    const got = await warmthOf(pg.db, [a, b]);
    expect(got.find((r) => r.profileId === a)?.personaRole).toBe("executive");
    expect(got.find((r) => r.profileId === b)).toMatchObject({
      personaRole: "unknown",
      persona: "unknown",
    });
  });
});

describe("refresh", () => {
  it("writes changed rows only, mirrors non-default traits, drops merged rows", async () => {
    const a = await profile("g@example.test");
    const b = await profile("h@example.test", T(2));
    const m = await emailed("g@example.test", 2);
    await run(
      sql`insert into open_events (message_id, remote_id, seen_at) values (${m}, 9, ${S(3)})`,
    );
    const first = await refreshPeople(pg.db);
    expect(first).toEqual({ written: 2, dropped: 0, traits: 2 });
    expect(await refreshPeople(pg.db)).toEqual({ written: 0, dropped: 0, traits: 0 });
    const traits = await run(sql`select profile_id, key, value #>> '{}' v from profile_traits
      where key in ('stage', 'warmth') order by profile_id, key`);
    expect(traits).toEqual([
      { profile_id: a, key: "stage", v: "lead" },
      { profile_id: a, key: "warmth", v: "warm" },
    ]);
    await run(sql`select 1`);
    await mergeProfiles(pg.db, a, b, "email:h@example.test", "test", T(4));
    expect(await refreshPeople(pg.db)).toMatchObject({ dropped: 1 });
    expect(await storedRollup(pg.db, b)).toBeNull();
    const view = await one(sql`select stage, warmth, persona from profile_records where id = ${a}`);
    expect(view).toEqual({ stage: "lead", warmth: "warm", persona: "unknown" });
  });

  it("a scoped refresh touches only those profiles", async () => {
    const a = await profile("i@example.test");
    const b = await profile("j@example.test");
    expect(await refreshPeople(pg.db, { ids: [a] })).toMatchObject({ written: 1 });
    expect(await storedRollup(pg.db, b)).toBeNull();
  });
});

describe("site counts", () => {
  it("counts a visitor's pages and watch pages; visits make them warm", async () => {
    const r = await resolveProfile(
      pg.db,
      [
        { kind: "email", value: "k@example.test" },
        { kind: "visitor", value: "visitor-1" },
      ],
      "test",
    );
    const id = r?.id as number;
    const read = async (visitors: readonly string[]) =>
      visitors.includes("visitor-1")
        ? countHits([
            { ts: S(2), page: "/" },
            { ts: S(3), page: "/watch/offer" },
            { ts: S(4), page: "/pricing" },
          ])
        : null;
    expect(await readSiteCounts(pg.db, read, { now: T(5) })).toBe(1);
    const [w] = await warmthOf(pg.db, [id]);
    expect(w).toMatchObject({ warmth: "warm", why: ["visited", "watched"] });
    expect(w?.counts.visited).toEqual({ n: 3, first: S(2), last: S(4) });
    expect(w?.counts.watched).toEqual({ n: 1, first: S(3), last: S(3) });
  });
});

describe("warm gate", () => {
  it("refuses a cold opener to a warm person, by any of their keys", async () => {
    const id = await profile("l@example.test");
    await resolveProfile(
      pg.db,
      [
        { kind: "email", value: "l@example.test" },
        { kind: "phone", value: "+15550100777" },
      ],
      "test",
    );
    expect(
      await coldOpenerRefusal(pg.db, { keys: [{ kind: "phone", value: "(555) 010-0777" }] }),
    ).toBeNull();
    const m = await emailed("l@example.test", 2);
    await run(
      sql`insert into open_events (message_id, remote_id, seen_at) values (${m}, 7, ${S(3)})`,
    );
    const why = await coldOpenerRefusal(pg.db, {
      keys: [{ kind: "phone", value: "(555) 010-0777" }],
    });
    expect(why).toBe(`warm (profile ${id}): opened, last Oct 3; no cold opener`);
    expect(
      await coldOpenerRefusal(pg.db, { keys: [{ kind: "email", value: "nobody@example.test" }] }),
    ).toBeNull();
    // The cross-channel rule hears it too: a text opener to their phone is refused.
    expect(
      await leadRefusal(pg.db, { personId: null, companyId: null }, "text", T(5), [
        { kind: "phone", value: "+15550100777" },
      ]),
    ).toBe(why);
  });

  it("finds a profile by id, email, phone or handle; lists the map", async () => {
    const id = await profile("m@example.test");
    await resolveProfile(
      pg.db,
      [
        { kind: "email", value: "m@example.test" },
        { kind: "handle:x", value: "@Emm" },
      ],
      "test",
    );
    for (const who of [`#${id}`, String(id), "M@Example.test", "x:emm"])
      expect(await findProfile(pg.db, who)).toBe(id);
    expect(await findProfile(pg.db, "x:nobody")).toBeNull();
    const t = await one(sql`insert into topics (name, public_name, line, channel, cadence)
      values ('tips', 'Tips', 'l', 'email', 'weekly') returning id`);
    await run(sql`insert into consents (channel, address, topic_id, state, source, text_version)
      values ('email', 'm@example.test', ${t.id as number}, 'confirmed', 'lander_form', 'v1')`);
    await profile("n@example.test");
    await refreshPeople(pg.db);
    expect((await listPeople(pg.db, { warmth: "warm" })).map((r) => r.profileId)).toEqual([id]);
    expect(await listPeople(pg.db, { subscribed: "tips" })).toHaveLength(1);
    expect(await listPeople(pg.db, { reason: "replied" })).toHaveLength(0);
    expect(await peopleCounts(pg.db)).toEqual([
      { stage: "stranger", warmth: "cold", n: 1 },
      { stage: "lead", warmth: "warm", n: 1 },
    ]);
  });
});

/** Profiles: resolve, merge into the oldest, traits and their changes, the timeline, the records. Synthetic rows. */
import { startTestPostgres, type TestPostgres, truncate } from "@wren/db/testing";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { profileRecords } from "../../src/profile-records.js";
import { resolveProfile, setTraits } from "../../src/profiles.js";
import { backfillProfiles, noteContacts } from "../../src/profiles-backfill.js";
import { serveRecords } from "../../src/records-serve.js";
import { resolveHandle } from "../../src/touches.js";
import type { Workflow } from "../../src/workflows.js";

let pg: TestPostgres;
beforeAll(async () => {
  pg = await startTestPostgres();
});
afterAll(() => pg.stop());

type Row = Record<string, unknown>;
const run = async (q: ReturnType<typeof sql>) => (await pg.db.execute(q)) as unknown as Row[];
const one = async (q: ReturnType<typeof sql>) => (await run(q))[0] as Row;
const T = (day: number) => new Date(Date.UTC(2026, 9, day, 12));
const S = (day: number) => T(day).toISOString();

beforeEach(async () => {
  await truncate(pg.db, [
    "profile_merges",
    "profile_trait_events",
    "profile_traits",
    "profile_keys",
    "profiles",
    "thread_events",
    "messages",
    "enrollments",
    "companies",
    "sms_messages",
    "sms_contacts",
    "consent_events",
    "consents",
    "topics",
    "social_handles",
  ]);
});

describe("resolveProfile", () => {
  it("makes one profile per person, and adds new keys to it", async () => {
    const a = await resolveProfile(pg.db, [{ kind: "email", value: " Ann@Example.TEST " }], "t", {
      name: "Ann Lee",
      at: T(2),
    });
    expect(a).toMatchObject({ created: true, added: 1, merged: [] });
    const b = await resolveProfile(
      pg.db,
      [
        { kind: "email", value: "ann@example.test" },
        { kind: "phone", value: "(555) 010-0101" },
      ],
      "t",
      { at: T(3) },
    );
    expect(b).toMatchObject({ id: a?.id, created: false, added: 1 });
    const keys = await run(sql`select kind, value from profile_keys order by kind`);
    expect(keys).toEqual([
      { kind: "email", value: "ann@example.test" },
      { kind: "phone", value: "+15550100101" },
    ]);
    const p = await one(sql`select name, first_seen, last_seen from profiles`);
    expect(p.name).toBe("Ann Lee");
    expect(new Date(p.last_seen as string).toISOString()).toBe(S(3));
  });

  it("drops what isn't a key and makes nothing from none", async () => {
    expect(
      await resolveProfile(
        pg.db,
        [
          { kind: "email", value: "not an email" },
          { kind: "phone", value: "12" },
          { kind: "nope", value: "x" },
        ],
        "t",
      ),
    ).toBeNull();
    expect((await one(sql`select count(*)::int n from profiles`)).n).toBe(0);
  });

  it("merges two into the oldest, moves keys, takes newer traits, deletes nothing", async () => {
    const old = await resolveProfile(pg.db, [{ kind: "email", value: "bo@example.test" }], "t", {
      at: T(1),
      traits: { title: "Owner", city: "Austin" },
    });
    const young = await resolveProfile(pg.db, [{ kind: "phone", value: "+15550100102" }], "t", {
      at: T(5),
      name: "Bo",
      traits: { title: "Founder" },
    });
    const both = await resolveProfile(
      pg.db,
      [
        { kind: "phone", value: "+15550100102" },
        { kind: "email", value: "bo@example.test" },
      ],
      "site_form",
      { at: T(6) },
    );
    expect(both).toMatchObject({ id: old?.id, merged: [young?.id] });
    const keys = await run(sql`select distinct profile_id from profile_keys`);
    expect(keys).toEqual([{ profile_id: old?.id }]);
    const traits = await run(
      sql`select profile_id, key, value from profile_traits order by profile_id, key`,
    );
    expect(traits).toEqual([
      { profile_id: old?.id, key: "city", value: "Austin" },
      { profile_id: old?.id, key: "title", value: "Founder" },
      // The merged profile keeps its own row as it was.
      { profile_id: young?.id, key: "title", value: "Founder" },
    ]);
    const change = await one(
      sql`select old, new from profile_trait_events where profile_id = ${old?.id ?? 0} and key = 'title' order by id desc limit 1`,
    );
    expect(change).toEqual({ old: "Owner", new: "Founder" });
    const merged = await one(sql`select merged_into from profiles where id = ${young?.id ?? 0}`);
    expect(merged.merged_into).toBe(old?.id);
    const m = await one(sql`select into_id, from_id, keys, traits, source from profile_merges`);
    expect(m).toEqual({
      into_id: old?.id,
      from_id: young?.id,
      keys: 1,
      traits: 1,
      source: "site_form",
    });
    const into = await one(sql`select name from profiles where id = ${old?.id ?? 0}`);
    expect(into.name).toBe("Bo");
  });

  it("keeps a held trait over an older one and logs only changes", async () => {
    const p = await resolveProfile(pg.db, [{ kind: "email", value: "cy@example.test" }], "t");
    const id = p?.id ?? 0;
    expect(await setTraits(pg.db, id, { plan: "pro" }, "t", T(5))).toBe(1);
    expect(await setTraits(pg.db, id, { plan: "pro" }, "t", T(6))).toBe(0);
    expect(await setTraits(pg.db, id, { plan: "free" }, "t", T(4))).toBe(0);
    expect(await setTraits(pg.db, id, { plan: "team", "Bad Key": 1 }, "t", T(7))).toBe(1);
    const events = await run(sql`select old, new from profile_trait_events order by id`);
    expect(events).toEqual([
      { old: null, new: "pro" },
      { old: "pro", new: "team" },
    ]);
  });

  it("makes one profile when two writers hold the same address at once", async () => {
    const got = await Promise.all(
      Array.from({ length: 6 }, (_, i) =>
        resolveProfile(
          pg.db,
          [
            { kind: "email", value: "di@example.test" },
            { kind: "visitor", value: `visitor-${i}` },
          ],
          "t",
        ),
      ),
    );
    expect(new Set(got.map((g) => g?.id)).size).toBe(1);
    expect((await one(sql`select count(*)::int n from profiles`)).n).toBe(1);
    expect((await one(sql`select count(*)::int n from profile_keys`)).n).toBe(7);
  });
});

/** An email thread, a texting thread and a consent for one person. */
async function seed() {
  const company = await one(
    sql`insert into companies (domain) values ('firm.example.test') returning id`,
  );
  const e = await one(sql`insert into enrollments
    (niche, sequence_name, sequence_snapshot, offer, state, company_id, kind, to_email, sender)
    values ('plumbing', 'cold_intro', '{}'::jsonb, 'offer', 'active', ${company.id as number},
      'role_inbox', 'Eve@Example.test', 'sender@example.test') returning id`);
  await run(sql`insert into messages
    (enrollment_id, step, template, template_version, to_email, subject, body, provenance, state, sent_at, message_id)
    values (${e.id as number}, 1, 't', 'v1', 'Eve@Example.test', 'Quick question', 'Hi Eve, one line.',
      '{}'::jsonb, 'sent', ${S(2)}, '<m1@example.test>')`);
  await run(sql`insert into thread_events (enrollment_id, kind, subject, snippet, body_text, received_at)
    values (${e.id as number}, 'reply', 'Re: Quick question', 'Sure', 'Sure, call me.', ${S(3)})`);
  const c = await one(sql`insert into sms_contacts (e164, source_kind, basis, email, name)
    values ('+15550100105', 'manual', 'opt_in', 'eve@example.test', 'Eve Park') returning id`);
  await run(sql`insert into sms_messages (contact_id, direction, kind, to_e164, body, state, sent_at, provider_id)
    values (${c.id as number}, 'out', 'manual', '+15550100105', 'Hi Eve, it is Wren.', 'sent', ${S(4)}, 'SMsynthetic1')`);
  const t = await one(sql`insert into topics (name, public_name, line, channel, cadence)
    values ('news', 'News', 'l', 'email', 'weekly') returning id`);
  const k =
    await one(sql`insert into consents (channel, address, topic_id, state, source, text_version)
    values ('email', 'eve@example.test', ${t.id as number}, 'confirmed', 'lander_form', 'v1') returning id`);
  await run(sql`insert into consent_events (consent_id, kind, by, created_at)
    values (${k.id as number}, 'confirmed', 'subscriber', ${S(1)})`);
}

describe("backfill, timeline and records", () => {
  it("backfills every source once, and a second run changes nothing", async () => {
    await seed();
    const first = await backfillProfiles(pg.db);
    expect(first.find((c) => c.source === "enrollment")).toMatchObject({ rows: 1, created: 1 });
    expect(first.find((c) => c.source === "sms_contact")).toMatchObject({ rows: 1, created: 0 });
    expect((await one(sql`select count(*)::int n from profiles`)).n).toBe(1);
    const again = await backfillProfiles(pg.db);
    expect(again.reduce((n, c) => n + c.created + c.merged, 0)).toBe(0);
    expect((await one(sql`select count(*)::int n from profile_keys`)).n).toBe(2);
  });

  it("reads the timeline from the source tables, each line with its kind and link", async () => {
    await seed();
    await backfillProfiles(pg.db);
    const lines = await run(
      sql`select kind, channel, summary, body, link, who from profile_timeline order by at`,
    );
    expect(lines.map((l) => l.kind)).toEqual([
      "consent",
      "email_sent",
      "email_received",
      "text_sent",
    ]);
    expect(lines[1]).toMatchObject({ summary: "Quick question", body: "Hi Eve, one line." });
    expect(lines[3]?.link).toMatch(/^\/marketing\/texts\/\d+$/);
    expect(lines[0]?.who).toBe("Eve Park");
    const row = await one(
      sql`select name, emails, phones, channels, consent, keys from profile_records`,
    );
    expect(row).toEqual({
      name: "Eve Park",
      emails: "eve@example.test",
      phones: "+15550100105",
      channels: "email, sms",
      consent: "email confirmed",
      keys: 2,
    });
  });

  it("serves the profile with its timeline counts, and the data index with what uses it", async () => {
    await seed();
    await backfillProfiles(pg.db);
    const flows: Workflow[] = [
      {
        id: "follow_up",
        name: "Follow up",
        for: "wren",
        nodes: [{ id: "heard", uses: "trigger.reply" }],
        wires: [],
      } as unknown as Workflow,
    ];
    const api = serveRecords(profileRecords(flows), pg.db);
    const list = await api.list({ record: "people.profile" });
    expect(list.total).toBe(1);
    const id = String(list.rows[0]?.id);
    const got = await api.get({ record: "people.profile", id });
    expect(got.related).toEqual(
      expect.arrayContaining([
        { record: "people.key", count: 2 },
        { record: "people.event", count: 4 },
      ]),
    );
    const detail = got.detail as { total: number; timeline: { kind: string; href: string }[] };
    expect(detail.total).toBe(4);
    expect(detail.timeline.find((t) => t.kind === "email_received")?.href).toBe(
      `/people/timeline?profile=${id}..${id}&kind=email_received`,
    );
    const lines = await api.list({
      record: "people.event",
      where: { profile: { gte: Number(id), lte: Number(id) }, kind: ["email_sent"] },
    });
    expect(lines.rows.map((r) => r.summary)).toEqual(["Quick question"]);
    const data = await api.list({ record: "people.datum" });
    const reply = data.rows.find((r) => r.id === "event:email_received");
    expect(reply).toMatchObject({ people: 1, usedBy: "Follow up" });
  });
});

describe("writers", () => {
  it("a new text contact and a new handle each join a profile", async () => {
    const c = await one(sql`insert into sms_contacts (e164, source_kind, basis, email, name)
      values ('+15550100107', 'manual', 'opt_in', 'gus@example.test', 'Gus') returning id`);
    await noteContacts(pg.db, [c.id as number]);
    await resolveHandle(pg.db, { platform: "x", handle: "gus_x", url: null }, { name: "Gus" });
    await resolveHandle(pg.db, { platform: "x", handle: "gus_x", url: null });
    const keys = await run(sql`select kind, value, source from profile_keys order by kind`);
    expect(keys).toEqual([
      { kind: "email", value: "gus@example.test", source: "sms_contact" },
      { kind: "handle:x", value: "gus_x", source: "social_handle" },
      { kind: "phone", value: "+15550100107", source: "sms_contact" },
    ]);
  });
});

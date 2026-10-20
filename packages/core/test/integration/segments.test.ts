/**
 * Segments (B5) on a real database: each condition kind, live recompute with entries and exits,
 * manual and snapshot segments, archiving, the pass's fires and cursor, Date triggers' days, and
 * the members read B6 sends from. Synthetic rows; every time is fixed.
 */
import { startTestPostgres, type TestPostgres, truncate } from "@wren/db/testing";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { datumRecord } from "../../src/profile-records.js";
import { resolveProfile, setTraits } from "../../src/profiles.js";
import { segmentDetail } from "../../src/segment-records.js";
import {
  addMembers,
  addToGroup,
  archiveSegment,
  archiveUnused,
  type Condition,
  listSegments,
  previewRule,
  type Rule,
  recomputeLive,
  removeMembers,
  restoreSegment,
  retake,
  saveSegment,
  segmentById,
  segmentMembers,
} from "../../src/segments.js";
import { dueOn, segmentsPass } from "../../src/segments-pass.js";
import type { Workflow, WorkflowNode } from "../../src/workflows.js";

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
const all = (...of: Rule["of"]): Rule => ({ kind: "group", match: "all", of });

beforeEach(async () => {
  await truncate(pg.db, [
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
    "consent_events",
    "consents",
    "topics",
  ]);
});

/** A profile with an email and maybe a phone, made on a fixed day. */
async function person(name: string, email: string, phone?: string): Promise<number> {
  const keys = [
    { kind: "email", value: email },
    ...(phone ? [{ kind: "phone", value: phone }] : []),
  ];
  const got = await resolveProfile(pg.db, keys, "test", { name, at: T(1) });
  return got?.id as number;
}

/** Who a rule matches now, by name. */
async function matches(rule: Rule, now = NOW): Promise<string[]> {
  const p = await previewRule(pg.db, rule, now);
  return p.sample.map((s) => s.name).sort();
}

async function fourPeople() {
  const ann = await person("Ann", "ann@example.test", "+15550100001");
  const bo = await person("Bo", "bo@example.test", "+15550100002");
  const cy = await person("Cy", "cy@example.test");
  const di = await person("Di", "di@example.test");
  await setTraits(pg.db, ann, { plan: "Pro", seats: 12, renewal_date: "2026-10-20" }, "t", T(2));
  await setTraits(pg.db, bo, { plan: "basic", seats: 3, renewal_date: "2026-09-30" }, "t", T(2));
  await setTraits(pg.db, cy, { plan: "pro trial", renewal_date: "not a date" }, "t", T(2));
  return { ann, bo, cy, di };
}

describe("each condition kind matches on the database", () => {
  it("traits: is, contains, more, less, set, dates", async () => {
    await fourPeople();
    const t = (key: string, op: string, value?: string | number) =>
      matches(all({ kind: "trait", key, op, value } as Condition));
    expect(await t("plan", "is", "pro")).toEqual(["Ann"]);
    expect(await t("plan", "contains", "pro")).toEqual(["Ann", "Cy"]);
    expect(await t("plan", "exists")).toEqual(["Ann", "Bo", "Cy"]);
    expect(await t("seats", "gt", 5)).toEqual(["Ann"]);
    expect(await t("seats", "lt", 5)).toEqual(["Bo"]);
    const d = (op: string, value: string | number) =>
      matches(all({ kind: "trait", key: "renewal_date", op, value } as Condition));
    // An unreadable date ("not a date") never matches and never fails the count.
    expect(await d("before", "2026-10-01")).toEqual(["Bo"]);
    expect(await d("after", "2026-10-01")).toEqual(["Ann"]);
    expect(await d("in_next", 7)).toEqual(["Ann"]);
    expect(await d("in_next", 5)).toEqual([]);
    expect(await d("in_last", 14)).toEqual(["Bo"]);
    // Not: everyone the condition leaves out, with no plan too.
    expect(
      await matches(all({ kind: "trait", key: "plan", op: "is", value: "pro", not: true })),
    ).toEqual(["Bo", "Cy", "Di"]);
  });

  it("events: at least N times in the last D days on the timeline", async () => {
    const { ann, bo } = await fourPeople();
    let n = 0;
    const form = (profile: number, at: Date) =>
      run(sql`insert into profile_events (profile_id, kind, channel, at, summary, source, source_id)
        values (${profile}, 'form', 'site', ${at.toISOString()}, 'Form', 'site_forms', ${String(++n)})`);
    await form(ann, T(10));
    await form(ann, T(12));
    await form(bo, T(1));
    // One after "now" doesn't count yet.
    await form(bo, T(20));
    const e = (atLeast: number, days: number | null) =>
      matches(all({ kind: "event", event: "form", atLeast, days }));
    expect(await e(1, 7)).toEqual(["Ann"]);
    expect(await e(2, 7)).toEqual(["Ann"]);
    expect(await e(3, 7)).toEqual([]);
    expect(await e(1, null)).toEqual(["Ann", "Bo"]);
    expect(await e(2, null)).toEqual(["Ann"]);
  });

  it("consent: by channel and state; a STOP", async () => {
    await fourPeople();
    const topic = await one(sql`insert into topics (name, public_name, line, channel, cadence)
      values ('news', 'News', 'l', 'email', 'weekly') returning id`);
    await run(sql`insert into consents (channel, address, topic_id, state, source, text_version)
      values ('email', 'ann@example.test', ${topic.id as number}, 'confirmed', 'lander_form', 'v1'),
        ('email', 'cy@example.test', ${topic.id as number}, 'withdrawn', 'lander_form', 'v1'),
        ('sms', '+15550100002', ${topic.id as number}, 'confirmed', 'lander_form', 'v1')`);
    await run(sql`insert into sms_contacts (e164, source_kind, basis, state)
      values ('+15550100001', 'manual', 'opt_in', 'opted_out')`);
    const c = (channel: string, state: string) =>
      matches(all({ kind: "consent", channel, state } as Condition));
    expect(await c("email", "confirmed")).toEqual(["Ann"]);
    expect(await c("email", "withdrawn")).toEqual(["Cy"]);
    expect(await c("sms", "confirmed")).toEqual(["Bo"]);
    expect(await c("sms", "opted_out")).toEqual(["Ann"]);
  });

  it("messages: the sent log's ladder, by channel and window", async () => {
    await fourPeople();
    const contact = async (e164: string) =>
      (
        await one(sql`insert into sms_contacts (e164, source_kind, basis)
        values (${e164}, 'manual', 'opt_in') returning id`)
      ).id as number;
    const a = await contact("+15550100001");
    const b = await contact("+15550100002");
    let n = 0;
    const text = (c: number, to: string, state: string, at: Date) =>
      run(sql`insert into sms_messages (contact_id, direction, kind, to_e164, body, state, sent_at, delivered_at, provider_id)
        values (${c}, 'out', 'manual', ${to}, 'Hello', ${state}, ${at.toISOString()},
          ${state === "delivered" ? at.toISOString() : null}, ${`SM${++n}`})`);
    await text(a, "+15550100001", "delivered", T(10));
    await text(a, "+15550100001", "delivered", T(11));
    await text(b, "+15550100002", "failed", T(12));
    await text(b, "+15550100002", "sent", T(1));
    const m = (state: string, channel: string, atLeast: number, days: number | null) =>
      matches(all({ kind: "message", state, channel, atLeast, days } as Condition));
    expect(await m("delivered", "sms", 2, 7)).toEqual(["Ann"]);
    expect(await m("sent", "sms", 1, 7)).toEqual(["Ann"]);
    expect(await m("sent", "any", 1, null)).toEqual(["Ann", "Bo"]);
    expect(await m("failed", "any", 1, null)).toEqual(["Bo"]);
    expect(await m("delivered", "email", 1, null)).toEqual([]);
  });

  it("segments: membership in another, and any-of groups", async () => {
    const { ann, cy } = await fourPeople();
    const vip = (await saveSegment(pg.db, { name: "VIP", kind: "manual" }, "t", NOW)).segment;
    await addMembers(pg.db, vip.id, [cy], NOW);
    expect(await matches(all({ kind: "segment", segment: vip.id }))).toEqual(["Cy"]);
    expect(
      await matches({
        kind: "group",
        match: "any",
        of: [
          { kind: "segment", segment: vip.id },
          { kind: "trait", key: "plan", op: "is", value: "pro" },
        ],
      }),
    ).toEqual(["Ann", "Cy"]);
    expect(ann).toBeGreaterThan(0);
  });
});

describe("live, manual and snapshot segments", () => {
  it("keeps a live one true and records who came and went", async () => {
    const { ann, bo } = await fourPeople();
    const rule = all({ kind: "trait", key: "plan", op: "is", value: "pro" });
    const { segment, change } = await saveSegment(
      pg.db,
      { name: "Pro", kind: "live", rule, words: "pro customers" },
      "ops@example.test",
      NOW,
    );
    expect(change).toMatchObject({ entered: [ann], left: [], size: 1 });
    expect(segment).toMatchObject({ size: 1, kind: "live", words: "pro customers" });
    await setTraits(pg.db, ann, { plan: "basic" }, "t", T(15));
    await setTraits(pg.db, bo, { plan: "PRO" }, "t", T(15));
    const [c] = await recomputeLive(pg.db, T(15));
    expect(c).toMatchObject({ entered: [bo], left: [ann], size: 1 });
    // Nothing changed: nothing recorded.
    expect((await recomputeLive(pg.db, T(16)))[0]).toMatchObject({ entered: [], left: [] });
    const events = await run(sql`select profile_id, change from segment_member_events order by id`);
    expect(events).toEqual([
      { profile_id: ann, change: "entered" },
      { profile_id: ann, change: "left" },
      { profile_id: bo, change: "entered" },
    ]);
    const d = await segmentDetail(pg.db, String(segment.id));
    expect(d?.ruleWords).toBe('plan is "pro"');
    expect(d?.moves).toEqual({ entered7: 2, left7: 1, entered30: 2, left30: 1 });
  });

  it("refuses a bad rule, a rule that reads itself, a second name, a kind change", async () => {
    await fourPeople();
    const a = (
      await saveSegment(
        pg.db,
        { name: "A", kind: "live", rule: all({ kind: "trait", key: "plan", op: "exists" }) },
        "t",
        NOW,
      )
    ).segment;
    const b = (
      await saveSegment(
        pg.db,
        { name: "B", kind: "live", rule: all({ kind: "segment", segment: a.id }) },
        "t",
        NOW,
      )
    ).segment;
    await expect(
      saveSegment(
        pg.db,
        { id: a.id, name: "A", kind: "live", rule: all({ kind: "segment", segment: b.id }) },
        "t",
        NOW,
      ),
    ).rejects.toThrow(/B already reads this group/);
    await expect(
      saveSegment(
        pg.db,
        { id: a.id, name: "A", kind: "live", rule: all({ kind: "segment", segment: a.id }) },
        "t",
        NOW,
      ),
    ).rejects.toThrow(/its own rule/);
    await expect(
      saveSegment(
        pg.db,
        {
          name: "a",
          kind: "live",
          rule: all({ kind: "trait", key: "plan", op: "is" } as Condition),
        },
        "t",
        NOW,
      ),
    ).rejects.toThrow(/needs a value/);
    await expect(saveSegment(pg.db, { name: "B", kind: "manual" }, "t", NOW)).rejects.toThrow(
      /called B already/,
    );
    await expect(
      saveSegment(
        pg.db,
        {
          id: a.id,
          name: "A",
          kind: "snapshot",
          rule: all({ kind: "trait", key: "plan", op: "exists" }),
        },
        "t",
        NOW,
      ),
    ).rejects.toThrow(/keeps its kind/);
    // A reads before B: one pass sees B's fresh members.
    expect((await recomputeLive(pg.db, NOW)).map((c) => c.segment)).toEqual([a.id, b.id]);
    // A save over the version it opened on; one opened before a later save is refused.
    const opened = a.updatedAt;
    const later = new Date(NOW.getTime() + 1000);
    const again = { id: a.id, name: "A", kind: "live" as const, rule: a.rule, expect: opened };
    await saveSegment(pg.db, again, "t", later);
    await expect(saveSegment(pg.db, again, "t", later)).rejects.toThrow(/changed since/);
    expect((await segmentDetail(pg.db, String(a.id)))?.version).toBe(later.toISOString());
  });

  it("a manual one takes people by hand; a live one doesn't", async () => {
    const { ann, bo } = await fourPeople();
    const m = (await saveSegment(pg.db, { name: "Picked", kind: "manual" }, "t", NOW)).segment;
    expect(await addMembers(pg.db, m.id, [ann, bo, ann], NOW)).toMatchObject({
      entered: [ann, bo],
      size: 2,
    });
    expect(await addMembers(pg.db, m.id, [ann], NOW)).toMatchObject({ entered: [], size: 2 });
    expect(await removeMembers(pg.db, m.id, [ann], T(15))).toMatchObject({ left: [ann], size: 1 });
    const live = (
      await saveSegment(
        pg.db,
        { name: "L", kind: "live", rule: all({ kind: "trait", key: "plan", op: "exists" }) },
        "t",
        NOW,
      )
    ).segment;
    await expect(addMembers(pg.db, live.id, [ann], NOW)).rejects.toThrow(/only a manual/);
    // A live pass leaves a manual one alone.
    await recomputeLive(pg.db, T(16));
    expect((await segmentById(pg.db, m.id))?.size).toBe(1);
  });

  it("a snapshot is who matched when taken, until taken again", async () => {
    const { ann, bo } = await fourPeople();
    const rule = all({ kind: "trait", key: "plan", op: "is", value: "basic" });
    const s = (await saveSegment(pg.db, { name: "Basic then", kind: "snapshot", rule }, "t", NOW))
      .segment;
    expect(s.size).toBe(1);
    await setTraits(pg.db, ann, { plan: "basic" }, "t", T(15));
    await recomputeLive(pg.db, T(15));
    expect((await segmentMembers(pg.db, s.id, { now: T(15) })).map((m) => m.profileId)).toEqual([
      bo,
    ]);
    expect(await retake(pg.db, s.id, T(16))).toMatchObject({ entered: [ann], size: 2 });
  });
});

describe("archiving", () => {
  it("archives what nothing used for 90 days; one click restores", async () => {
    await fourPeople();
    const rule = all({ kind: "trait", key: "plan", op: "exists" });
    const old = (await saveSegment(pg.db, { name: "Old", kind: "live", rule }, "t", T(1))).segment;
    const read = (await saveSegment(pg.db, { name: "Read", kind: "live", rule }, "t", T(1)))
      .segment;
    const reader = (
      await saveSegment(
        pg.db,
        { name: "Reader", kind: "live", rule: all({ kind: "segment", segment: read.id }) },
        "t",
        T(1),
      )
    ).segment;
    const day90 = new Date(T(1).getTime() + 90 * 86_400_000);
    expect(await archiveUnused(pg.db, new Date(day90.getTime() - 60_000))).toEqual([]);
    // 90 days on: Old and Reader are unused; Read is read by Reader, so it stays.
    const gone = await archiveUnused(pg.db, new Date(day90.getTime() + 60_000));
    expect(gone.sort()).toEqual([old.id, reader.id].sort());
    expect((await segmentById(pg.db, old.id))?.state).toBe("archived");
    expect((await segmentById(pg.db, read.id))?.state).toBe("active");
    // Archived, it stops counting; restored, it counts again and is fresh for 90 days.
    const back = await restoreSegment(pg.db, old.id, day90);
    expect(back.segment).toMatchObject({ state: "active", archivedAt: null });
    expect(back.segment.usedAt).toBe(day90.toISOString());
  });

  it("refuses to archive one a workflow or a segment uses", async () => {
    await fourPeople();
    const rule = all({ kind: "trait", key: "plan", op: "exists" });
    const a = (await saveSegment(pg.db, { name: "A", kind: "live", rule }, "t", NOW)).segment;
    await saveSegment(
      pg.db,
      { name: "B", kind: "live", rule: all({ kind: "segment", segment: a.id }) },
      "t",
      NOW,
    );
    await expect(archiveSegment(pg.db, a.id, NOW)).rejects.toThrow(/used by B/);
  });
});

const node = (uses: string, w: Record<string, string | number>): WorkflowNode =>
  ({ id: `n-${uses}`, uses, with: w }) as WorkflowNode;
const flow = (...nodes: WorkflowNode[]) =>
  [{ id: "wf", name: "Welcome", nodes, edges: [] }] as unknown as Workflow[];

describe("the segments pass", () => {
  it("starts at the newest rows, then tells each entry, exit and trait change it hears", async () => {
    const { ann, bo } = await fourPeople();
    const rule = all({ kind: "trait", key: "plan", op: "is", value: "pro" });
    const pro = (await saveSegment(pg.db, { name: "Pro", kind: "live", rule }, "t", NOW)).segment;
    const flows = flow(
      node("trigger.segment", { segment: pro.id, on: "any" }),
      node("trigger.trait", { trait: "plan" }),
    );
    // First pass: history (Ann's entry, the traits set) is never told.
    const first = await segmentsPass(pg.db, null, flows, NOW, null);
    expect(first.fires).toEqual([]);
    expect((await segmentById(pg.db, pro.id))?.uses).toEqual([
      { kind: "workflow", id: "wf", name: "Welcome" },
    ]);

    await setTraits(pg.db, ann, { plan: "basic" }, "t", T(15));
    await setTraits(pg.db, bo, { plan: "pro" }, "t", T(15));
    const second = await segmentsPass(pg.db, null, flows, T(15), first.cursor);
    const facts = second.fires.map((f) => [f.event.subject, f.facts]);
    expect(facts).toEqual([
      [`profile:${ann}`, { trigger: "trigger.segment", segment: pro.id, change: "left" }],
      [`profile:${bo}`, { trigger: "trigger.segment", segment: pro.id, change: "entered" }],
      [`profile:${ann}`, { trigger: "trigger.trait", key: "plan", value: "basic" }],
      [`profile:${bo}`, { trigger: "trigger.trait", key: "plan", value: "pro" }],
    ]);
    const lead = second.fires[1]?.event.data.lead as Record<string, unknown>;
    expect(lead).toMatchObject({
      name: "Bo",
      email: "bo@example.test",
      phone: "+15550100002",
      source: "segment",
    });
    // Each fire names its own membership row, so a repeating Group node can tell entries apart.
    const entered = await run(
      sql`select id from segment_member_events where profile_id = ${bo} and change = 'entered' order by id desc limit 1`,
    );
    expect(second.fires[1]?.event.data.member).toBe(Number(entered[0]?.id));
    // Told once: the next pass from its cursor tells nothing.
    const third = await segmentsPass(pg.db, null, flows, T(15, 13), second.cursor);
    expect(third.fires).toEqual([]);
  });

  it("tells a date trigger once a day from 09:00 New York", async () => {
    const { ann } = await fourPeople();
    // Ann renews 2026-10-20: seven days before is the 13th.
    const flows = flow(node("trigger.date", { trait: "renewal_date", offset: -7 }));
    const start = await segmentsPass(pg.db, null, flows, T(12), null);
    // 08:00 in New York (12:00 UTC is 08:00 EDT): not yet.
    const early = await segmentsPass(pg.db, null, flows, T(13, 12), start.cursor);
    expect(early.fires).toEqual([]);
    const due = await segmentsPass(pg.db, null, flows, T(13, 14), early.cursor);
    expect(due.fires.map((f) => [f.event.subject, f.facts])).toEqual([
      [
        `profile:${ann}:renewal_date-7@2026-10-13`,
        { trigger: "trigger.date", key: "renewal_date", offset: -7, every: "once" },
      ],
    ]);
    expect(due.cursor.dated).toBe("2026-10-13");
    expect((await segmentsPass(pg.db, null, flows, T(13, 18), due.cursor)).fires).toEqual([]);
  });

  it("finds a date's day once or every year, Feb 29 on Feb 28", async () => {
    const { ann, bo, cy } = await fourPeople();
    await setTraits(pg.db, ann, { birthday: "1992-02-29" }, "t", T(2));
    await setTraits(pg.db, bo, { birthday: "1985-03-01" }, "t", T(2));
    await setTraits(pg.db, cy, { birthday: "2027-02-28" }, "t", T(2));
    const y = (day: string) =>
      dueOn(pg.db, { key: "birthday", offset: 0, every: "yearly" }, day).then((r) =>
        r.map((x) => x.profile),
      );
    expect(await y("2027-02-28")).toEqual([ann, cy]);
    expect(await y("2028-02-28")).toEqual([cy]);
    expect(await y("2028-02-29")).toEqual([ann]);
    expect(await y("2027-03-01")).toEqual([bo]);
    const once = (day: string, offset: number) =>
      dueOn(pg.db, { key: "renewal_date", offset, every: "once" }, day).then((r) =>
        r.map((x) => x.profile),
      );
    expect(await once("2026-10-20", 0)).toEqual([ann]);
    expect(await once("2026-10-27", 7)).toEqual([ann]);
    expect(await once("2027-10-20", 0)).toEqual([]);
  });
});

describe("reads", () => {
  it("segmentMembers pages by profile id and counts as a use", async () => {
    const { ann, bo, cy } = await fourPeople();
    const m = (await saveSegment(pg.db, { name: "Picked", kind: "manual" }, "t", T(1))).segment;
    await addMembers(pg.db, m.id, [ann, bo, cy], T(1));
    const page = await segmentMembers(pg.db, m.id, { limit: 2, now: NOW });
    expect(page).toEqual([
      { profileId: ann, name: "Ann", emails: ["ann@example.test"], phones: ["+15550100001"] },
      { profileId: bo, name: "Bo", emails: ["bo@example.test"], phones: ["+15550100002"] },
    ]);
    expect(
      (await segmentMembers(pg.db, m.id, { after: bo, now: NOW })).map((x) => x.profileId),
    ).toEqual([cy]);
    expect((await segmentById(pg.db, m.id))?.usedAt).toBe(NOW.toISOString());
    await expect(segmentMembers(pg.db, 999)).rejects.toThrow(/no such group/);
  });

  it("the Data index names the segments that read each data point", async () => {
    await fourPeople();
    await saveSegment(
      pg.db,
      {
        name: "Pro",
        kind: "live",
        rule: all({ kind: "trait", key: "plan", op: "is", value: "pro" }),
      },
      "t",
      NOW,
    );
    const rec = datumRecord([]);
    const got = (
      await (rec as unknown as { rows: (db: unknown) => Promise<Row[]> }).rows(pg.db)
    ).find((r) => r.id === "trait:plan");
    expect(got?.used_by).toBe("Group Pro");
  });

  it("the views list segments and members", async () => {
    const { ann } = await fourPeople();
    const s = (
      await saveSegment(
        pg.db,
        {
          name: "Pro",
          kind: "live",
          rule: all({ kind: "trait", key: "plan", op: "is", value: "pro" }),
        },
        "t",
        NOW,
      )
    ).segment;
    expect(await one(sql`select name, kind, state, size, members from segment_records`)).toEqual({
      name: "Pro",
      kind: "live",
      state: "active",
      size: 1,
      members: `/people/members?segmentId=${s.id}..${s.id}`,
    });
    expect(
      await one(sql`select id, segment, segment_kind, name, emails from segment_member_records`),
    ).toEqual({
      id: `${s.id}:${ann}`,
      segment: "Pro",
      segment_kind: "live",
      name: "Ann",
      emails: "ann@example.test",
    });
  });
});

describe("addToGroup", () => {
  it("makes a manual group from a new name, then adds", async () => {
    const ann = await person("Ann", "ann@example.test");
    const got = await addToGroup(pg.db, "Fair follow-ups", [ann], "test", NOW);
    expect(got.made).toBe(true);
    expect(got.group.name).toBe("Fair follow-ups");
    expect(got.group.kind).toBe("manual");
    expect(got.group.size).toBe(1);
    expect((await segmentMembers(pg.db, got.group.id)).map((m) => m.name)).toEqual(["Ann"]);
  });

  it("adds to an existing group by name, in any case, and by id", async () => {
    const ann = await person("Ann", "ann@example.test");
    const bob = await person("Bob", "bob@example.test");
    const first = await addToGroup(pg.db, "Fair", [ann], "test", NOW);
    const byName = await addToGroup(pg.db, "fAIR", [bob], "test", NOW);
    expect(byName.made).toBe(false);
    expect(byName.group.id).toBe(first.group.id);
    const cat = await person("Cat", "cat@example.test");
    const byId = await addToGroup(pg.db, first.group.id, [cat], "test", NOW);
    expect(byId.made).toBe(false);
    expect((await segmentMembers(pg.db, first.group.id)).map((m) => m.name).sort()).toEqual([
      "Ann",
      "Bob",
      "Cat",
    ]);
    expect(await listSegments(pg.db)).toHaveLength(1);
  });

  it("refuses a live group by name and by id, and adds nobody", async () => {
    const ann = await person("Ann", "ann@example.test");
    const live = await saveSegment(
      pg.db,
      {
        name: "Warm leads",
        kind: "live",
        rule: all({ kind: "event", event: "form" } as Condition),
      },
      "test",
      NOW,
    );
    await expect(addToGroup(pg.db, "warm leads", [ann], "test", NOW)).rejects.toThrow(
      "Warm leads follows a rule: only manual groups take people by hand",
    );
    await expect(addToGroup(pg.db, live.segment.id, [ann], "test", NOW)).rejects.toThrow(
      /follows a rule/,
    );
    expect(await listSegments(pg.db)).toHaveLength(1);
    expect(await segmentMembers(pg.db, live.segment.id)).toEqual([]);
  });

  it("refuses an empty pick before it makes anything", async () => {
    const ann = await person("Ann", "ann@example.test");
    await expect(addToGroup(pg.db, "  ", [ann], "test", NOW)).rejects.toThrow(/pick a group/);
    expect(await listSegments(pg.db)).toHaveLength(0);
  });
});

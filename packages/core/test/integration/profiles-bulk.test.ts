/**
 * The set-based backfill against the per-row one: the same rows through both, every table equal.
 * Synthetic rows only. The first group runs invented sources (so merges, ties, mixed formats,
 * traits arriving out of order and a stray key are all there on purpose); the second runs the real
 * sources over seeded tables.
 */
import { appendFileSync } from "node:fs";
import { startTestPostgres, type TestPostgres, truncate } from "@wren/db/testing";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { type ProfileKey, resolveProfile } from "../../src/profiles.js";
import {
  type BackfillCount,
  backfillProfiles,
  type ProfileInput,
  type ProfileSource,
  SOURCES,
  type Source,
} from "../../src/profiles-backfill.js";
import { type BulkCount, bulkBackfillProfiles } from "../../src/profiles-bulk.js";

let pg: TestPostgres;
beforeAll(async () => {
  pg = await startTestPostgres();
});
afterAll(() => pg.stop());

type Row = Record<string, unknown>;
const run = async (q: ReturnType<typeof sql>) => (await pg.db.execute(q)) as unknown as Row[];
const one = async (q: ReturnType<typeof sql>) => (await run(q))[0] as Row;
const PROFILE_TABLES = [
  "profile_merges",
  "profile_trait_events",
  "profile_traits",
  "profile_keys",
  "profiles",
];

beforeEach(async () => {
  await truncate(pg.db, [...PROFILE_TABLES, "companies", "imports", "topics", "chat_threads"]);
  await truncate(pg.db, ["call_bookings"]);
});

/**
 * Everything the profile tables hold. Profile, key and merge ids are in it, so ties fell the same
 * way. Trait changes are in order per profile and key, not across them: a merge moves traits in
 * the order a scan returns them, which neither path controls. A merge's `by` is checked apart.
 */
async function dump() {
  const iso = (v: unknown) => (v ? new Date(String(v)).toISOString() : v);
  const ts = (rows: Row[], cols: string[]) =>
    rows.map((r) => ({ ...r, ...Object.fromEntries(cols.map((c) => [c, iso(r[c])])) }));
  return {
    profiles: ts(
      await run(sql`select id, name, first_seen, last_seen, merged_into from profiles order by id`),
      ["first_seen", "last_seen"],
    ),
    keys: ts(
      await run(
        sql`select id, profile_id, kind, value, source, first_seen from profile_keys order by id`,
      ),
      ["first_seen"],
    ),
    traits: ts(
      await run(
        sql`select profile_id, key, value, source, at from profile_traits order by profile_id, key`,
      ),
      ["at"],
    ),
    events: ts(
      await run(
        sql`select profile_id, key, old, new, source, at from profile_trait_events order by profile_id, key, id`,
      ),
      ["at"],
    ),
    merges: ts(
      await run(
        sql`select id, into_id, from_id, keys, traits, source, at from profile_merges order by id`,
      ),
      ["at"],
    ),
  };
}

/** Each merge's `by` names a key the profile tables hold, as `resolveProfile` writes it. */
async function bysAreKeys() {
  const bad = await run(sql`select m.by from profile_merges m
    where not exists (select 1 from profile_keys k where k.kind || ':' || k.value = m.by)`);
  expect(bad).toEqual([]);
}

const count = (c: BackfillCount[]) =>
  c.map(({ source, rows, created, merged, skipped }) => ({
    source,
    rows,
    created,
    merged,
    skipped,
  }));

/**
 * What `backfillProfiles` does, over any sources: each row through `resolveProfile`. `patient`
 * tries a row again after a deadlock with the writer beside it, as the bulk path does.
 */
async function perRow(sources: Source[], patient = false): Promise<BackfillCount[]> {
  const out: BackfillCount[] = [];
  for (const s of sources) {
    const c: BackfillCount = { source: s.name, rows: 0, created: 0, merged: 0, skipped: 0 };
    for (const r of await s.rows(pg.db, s.first, 1_000_000)) {
      c.rows += 1;
      const { keys, ...rest } = s.input(r);
      for (let tries = 1; ; tries++) {
        try {
          const got = await resolveProfile(pg.db, keys, s.name, rest);
          if (!got) c.skipped += 1;
          else {
            if (got.created) c.created += 1;
            c.merged += got.merged.length;
          }
        } catch (err) {
          const code = (err as { cause?: { code?: string } }).cause?.code;
          if (patient && code === "40P01" && tries < 5) continue;
          c.skipped += 1;
        }
        break;
      }
    }
    out.push(c);
  }
  return out;
}

// ---- invented sources -------------------------------------------------------------------

function rng(seed: number) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pad = (i: number) => String(i).padStart(4, "0");
/** Person `i` by each kind of address, written the ways writers write them. */
const WAYS: Record<string, (i: number) => (string | number)[]> = {
  email: (i) => [`p${i}@example.test`, `P${i}@Example.TEST`, ` mailto:p${i}@example.test `],
  phone: (i) => [`+1555010${pad(i)}`, `(555) 010-${pad(i)}`, `1-555-010-${pad(i)}`],
  person: (i) => [i + 1, String(i + 1)],
  "handle:x": (i) => [`@pers${i}`, `https://x.com/pers${i}`],
  visitor: (i) => [`visit_${pad(i)}`],
  "crm:acme": (i) => [`c${i}`],
};
const KINDS = Object.keys(WAYS);

/** `slot`: every row gets a minute of its own, from `slot * 1000`, so no two rows tie. */
function invent(seed: number, n: number, people: number, slot?: number): ProfileInput[] {
  const rand = rng(seed);
  const pick = <T>(a: readonly T[]): T => a[Math.floor(rand() * a.length)] as T;
  const key = (kind: string, who: number): ProfileKey => ({
    kind,
    value: pick((WAYS[kind] as (i: number) => (string | number)[])(who)),
  });
  const rows: ProfileInput[] = [];
  for (let r = 0; r < n; r++) {
    const who = Math.floor(rand() * people);
    const kinds = [...KINDS].sort(() => rand() - 0.5).slice(0, 1 + Math.floor(rand() * 3));
    const keys = kinds.map((k) => key(k, who));
    // One row in twelve also names someone else: two profiles turn out to be one person.
    if (rand() < 0.08) keys.push(key(pick(KINDS), Math.floor(rand() * people)));
    if (rand() < 0.05) keys.push({ kind: "email", value: "not an email" });
    const traits: Record<string, unknown> = {};
    if (rand() < 0.6) traits.title = pick(["Owner", "Founder", "  Partner  ", ""]);
    if (rand() < 0.4) traits.plan = pick([1, 2, 3, Number.NaN]);
    if (rand() < 0.3) traits.vip = pick([true, false]);
    if (rand() < 0.3) traits.city = pick(["Austin", "Boston", null, { x: 1 }]);
    if (rand() < 0.1) traits["Bad-Key"] = "x";
    if (rand() < 0.05) traits.note = "n".repeat(2500);
    rows.push({
      // No keys at all, once in thirty: nothing to make a profile from.
      keys: rand() < 0.03 ? [] : keys,
      name:
        rand() < 0.5
          ? pick([`Person ${who}`, `  person   ${who} `, `P. ${who}`])
          : pick([null, "   "]),
      traits,
      // Hourly over forty hours: ties on purpose.
      at: new Date(
        Date.UTC(2026, 8, 1) +
          (slot === undefined ? Math.floor(rand() * 40) * 3_600_000 : (slot * 1000 + r) * 60_000),
      ),
    });
  }
  return rows;
}

function source(name: ProfileSource, rows: ProfileInput[]): Source {
  return {
    name,
    first: "0",
    rows: async (_db, after, n) =>
      rows
        .map((input, i) => ({ cursor: String(i + 1), input }))
        .filter((r) => Number(r.cursor) > Number(after))
        .slice(0, n),
    input: (r) => r.input as ProfileInput,
  };
}

const PEOPLE = 90;
const sources = (seed: number, unique = false): Source[] => [
  source("lead_import", invent(seed + 1, 160, PEOPLE, unique ? 1 : undefined)),
  source("enrollment", invent(seed + 2, 160, PEOPLE, unique ? 2 : undefined)),
  source("consent", invent(seed + 3, 120, PEOPLE, unique ? 3 : undefined)),
  source("booking", invent(seed + 4, 120, PEOPLE, unique ? 4 : undefined)),
];

/** What the database holds before either path runs: a prior per-row run, and one stray key. */
async function prior(seed: number, stray = true) {
  await truncate(pg.db, PROFILE_TABLES);
  await perRow([source("people_import", invent(seed, 100, PEOPLE))]);
  if (!stray) return;
  // A profile merged away whose key never moved: `resolveProfile` follows it to the live one.
  const [a, b] = (await run(sql`select id from profiles order by id limit 2`)).map((r) => r.id);
  await run(sql`update profiles set merged_into = ${a as number} where id = ${b as number}`);
}

describe("bulk backfill gives the per-row result", () => {
  for (const seed of [11, 4242, 90210]) {
    it(`seed ${seed}: profiles, keys, traits, trait changes and merges all equal`, async () => {
      await prior(seed);
      const want = count(await perRow(sources(seed)));
      const wantDump = await dump();
      await prior(seed);
      const got = await bulkBackfillProfiles(pg.db, {
        sources: sources(seed),
        batch: 70,
        lockBudget: 24,
      });
      expect(count(got)).toEqual(want);
      expect(await dump()).toEqual(wantDump);
      await bysAreKeys();
      // Both paths really ran: merges made some rows go one by one, and most still went in bulk.
      const total = (f: (c: BulkCount) => number) => got.reduce((n, c) => n + f(c), 0);
      expect(total((c) => c.merged)).toBeGreaterThan(0);
      expect(total((c) => c.perRow)).toBeGreaterThan(0);
      expect(total((c) => c.perRow)).toBeLessThan(total((c) => c.rows) / 2);
      expect(total((c) => c.chunks)).toBeGreaterThan(8);
      expect(wantDump.events.length).toBeGreaterThan(50);
      expect(wantDump.merges.length).toBeGreaterThan(5);
    });
  }

  it("run again, it settles; the run after that inserts, updates and logs nothing", async () => {
    // Per row too: a merge in the first run can leave a trait for the second to move (a value the
    // survivor already held, merged in at an older time). By the third run nothing is left.
    const opts = { sources: sources(7, true), batch: 70, lockBudget: 24 };
    await prior(7, false);
    await bulkBackfillProfiles(pg.db, opts);
    await bulkBackfillProfiles(pg.db, opts);
    const before = await dump();
    const xmin = async () =>
      run(sql`select 'p' || id t, xmin::text x from profiles
        union all select 'k' || id, xmin::text from profile_keys
        union all select 't' || profile_id || key, xmin::text from profile_traits order by 1`);
    const rows = await xmin();
    const again = await bulkBackfillProfiles(pg.db, opts);
    expect(again.reduce((n, c) => n + c.created + c.merged + c.perRow, 0)).toBe(0);
    expect(await dump()).toEqual(before);
    expect(await xmin()).toEqual(rows);
  });

  it("a row naming two profiles merges them, and the rows after it follow", async () => {
    const at = (h: number) => new Date(Date.UTC(2026, 9, 1, h));
    const rows: ProfileInput[] = [
      { keys: [{ kind: "email", value: "Ann@Example.test" }], name: "Ann", at: at(1) },
      { keys: [{ kind: "phone", value: "(555) 010-0001" }], at: at(2), traits: { plan: 1 } },
      { keys: [{ kind: "email", value: "other@example.test" }], at: at(3) },
      {
        keys: [
          { kind: "phone", value: "+15550100001" },
          { kind: "email", value: "ann@example.test" },
        ],
        at: at(4),
        traits: { plan: 2 },
      },
      { keys: [{ kind: "phone", value: "555.010.0001" }], name: "Late", at: at(5) },
    ];
    const got = await bulkBackfillProfiles(pg.db, { sources: [source("lead_import", rows)] });
    expect(got[0]).toMatchObject({ rows: 5, created: 3, merged: 1, skipped: 0, chunks: 1 });
    expect(await run(sql`select id, name, merged_into from profiles order by id`)).toEqual([
      { id: 1, name: "Ann", merged_into: null },
      { id: 2, name: null, merged_into: 1 },
      { id: 3, name: null, merged_into: null },
    ]);
    expect(await run(sql`select profile_id, kind, value from profile_keys order by id`)).toEqual([
      { profile_id: 1, kind: "email", value: "ann@example.test" },
      { profile_id: 1, kind: "phone", value: "+15550100001" },
      { profile_id: 3, kind: "email", value: "other@example.test" },
    ]);
    expect(await run(sql`select into_id, from_id, keys, traits from profile_merges`)).toEqual([
      { into_id: 1, from_id: 2, keys: 1, traits: 1 },
    ]);
    expect(await run(sql`select profile_id, key, value from profile_traits order by 1, 2`)).toEqual(
      [
        { profile_id: 1, key: "plan", value: 2 },
        { profile_id: 2, key: "plan", value: 1 },
      ],
    );
  });

  it("holds each key's lock in the order resolveProfile does, beside a live per-row run", async () => {
    // The per-row backfill and the bulk one on the same rows at once: no deadlock, nothing skipped,
    // and every address ends on one live profile.
    const seed = 31;
    await prior(seed);
    const [a, b] = await Promise.all([
      perRow(sources(seed), true),
      bulkBackfillProfiles(pg.db, { sources: sources(seed), batch: 70, lockBudget: 24 }),
    ]);
    expect(a.reduce((n, c) => n + c.skipped, 0)).toBe(b.reduce((n, c) => n + c.skipped, 0));
    const twice = await run(
      sql`select kind, value from profile_keys group by kind, value having count(*) > 1`,
    );
    expect(twice).toEqual([]);
    const live = await run(sql`select count(*)::int n from profile_keys k
      join profiles p on p.id = k.profile_id where p.merged_into is not null and p.id <> 2`);
    expect(live[0]?.n).toBe(0);
    // The same partition as one path alone: who shares a profile.
    const people = async () =>
      (
        await run(
          sql`select string_agg(kind || ':' || value, ' ' order by kind, value) k from profile_keys group by profile_id`,
        )
      )
        .map((r) => r.k)
        .sort();
    const both = await people();
    await prior(seed);
    await perRow(sources(seed));
    expect(both).toEqual(await people());
  });

  it("a row that can't be written goes through alone, as the per-row run skips it", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const at = (h: number) => new Date(Date.UTC(2026, 9, 1, h));
    const rows: ProfileInput[] = [
      { keys: [{ kind: "email", value: "a@example.test" }], name: "A", at: at(1) },
      // A NUL can't be stored in text: the chunk's statement fails, the others still go in.
      { keys: [{ kind: "email", value: "b@example.test" }], name: "B\u0000", at: at(2) },
      { keys: [{ kind: "email", value: "c@example.test" }], name: "C", at: new Date(Number.NaN) },
      { keys: [{ kind: "email", value: "a@example.test" }], traits: { plan: 3 }, at: at(4) },
      { keys: [{ kind: "email", value: "d@example.test" }], name: "D", at: at(5) },
    ];
    const want = count(await perRow([source("lead_import", rows)]));
    const wantDump = await dump();
    await truncate(pg.db, PROFILE_TABLES);
    const got = await bulkBackfillProfiles(pg.db, { sources: [source("lead_import", rows)] });
    expect(count(got)).toEqual(want);
    expect(got[0]?.skipped).toBe(2);
    const now = await dump();
    // Ids may skip a number where a rolled-back statement used one; what's kept is the same.
    const strip = (d: typeof now) => ({
      names: d.profiles.map((p) => p.name),
      keys: d.keys.map((k) => k.value),
      traits: d.traits.map((t) => `${t.key}=${t.value}`),
    });
    expect(strip(now)).toEqual(strip(wantDump));
    spy.mockRestore();
  });
});

// ---- the real sources -------------------------------------------------------------------

const N = 90;
/** No two rows share a time: a tie between different values flips on every run, per row too. */
const T0 = sql.raw("timestamptz '2026-09-01 00:00:00+00'");

/** Rows in each table a source reads, overlapping by email, phone, person and handle. */
async function seedTables() {
  await run(sql`insert into companies (domain, name) select 'c' || i || '.example.test', 'Co ' || i
    from generate_series(1, ${N}) i`);
  await run(
    sql`insert into imports (source_type, source_ref, stats) values ('t', 'r', '{}'::jsonb)`,
  );
  await run(sql`insert into people (company_id, full_name, title, is_compliance, origin, origin_ref, raw, linkedin_url, import_id, created_at)
    select i, 'Person ' || i, case when i % 2 = 0 then 'Owner' end, false, 'manual', 'r' || i, '{}'::jsonb,
      case when i % 3 = 0 then 'https://www.linkedin.com/in/person-' || i end, 1,
      ${T0} + (i || ' minutes')::interval
    from generate_series(1, ${N}) i`);
  await run(sql`insert into leads (email, first_name, last_name, title, status, raw, company_id, import_id, country, social_url, person_id, created_at)
    select 'p' || i || '@example.test', 'Lee' || i, 'Park', case when i % 4 = 0 then 'Founder' end, 'imported', '{}'::jsonb,
      i, 1, 'US', case when i % 5 = 0 then 'https://x.com/pers' || i end,
      case when i % 3 = 0 then i end, ${T0} + ((100 + i) || ' minutes')::interval
    from generate_series(1, ${N}) i`);
  await run(sql`insert into enrollments (niche, sequence_name, sequence_snapshot, offer, state, company_id, kind, to_email, sender, person_id, created_at)
    select 'plumbing', 'cold_intro', '{}'::jsonb, 'offer', 'active', i, 'role_inbox',
      'P' || (i + 2) || '@Example.TEST', 'sender@example.test', case when i % 4 = 0 then i + 1 end,
      ${T0} + ((200 + i) || ' minutes')::interval
    from generate_series(1, ${N - 2}) i`);
  await run(sql`insert into sms_contacts (e164, source_kind, basis, email, name, person_id, created_at)
    select '+1555010' || lpad(i::text, 4, '0'), 'manual', 'opt_in', 'p' || (i + 3) || '@example.test',
      case when i % 2 = 0 then 'Pat ' || i end, case when i % 5 = 0 then i + 1 end,
      ${T0} + ((300 + i) || ' minutes')::interval
    from generate_series(1, ${N - 3}) i`);
  await run(
    sql`insert into topics (name, public_name, line, channel, cadence) values ('news', 'News', 'l', 'email', 'weekly')`,
  );
  await run(sql`insert into consents (channel, address, topic_id, state, source, text_version)
    select 'email', 'p' || i || '@example.test', 1, 'confirmed', 'lander_form', 'v1' from generate_series(1, ${N}) i
    union all select 'sms', '(555) 010-' || lpad(i::text, 4, '0'), 1, 'confirmed', 'lander_form', 'v1'
    from generate_series(1, ${N}, 2) i`);
  await run(sql`insert into social_handles (platform, handle, name, person_id, created_at)
    select 'x', 'pers' || i, 'Handle ' || i, case when i % 2 = 0 then i end, ${T0} + ((400 + i) || ' minutes')::interval
    from generate_series(1, ${N}) i`);
  await run(sql`insert into crm_contacts (person_id, company_id, import_id, row_number, format, crm_key, email, phone, owner, status, raw)
    select i, i, 1, i, 'Acme', 'c' || i, 'p' || (i + 5) || '@example.test', '555.010.' || lpad((i + 7)::text, 4, '0'),
      case when i % 3 = 0 then 'Sam' end, 'open', '{}'::jsonb
    from generate_series(1, ${N - 6}) i`);
  await run(sql`insert into chat_threads (key_hash, name, email, phone)
    select 'k' || i, 'Chat ' || i, case when i % 2 = 0 then 'p' || (i + 1) || '@example.test' end,
      case when i % 3 = 0 then '555-010-' || lpad((i + 2)::text, 4, '0') end from generate_series(1, ${N}) i`);
  await run(sql`insert into call_bookings (uid, state, email, name, booked_at)
    select 'u' || i, 'booked', 'p' || (i + 4) || '@example.test', 'Caller ' || i, ${T0} + ((500 + i) || ' minutes')::interval
    from generate_series(1, ${N - 5}) i`);
}

describe("bulk backfill over the real sources", () => {
  it("gives the per-row result, run once and run again, and the third run changes nothing", async () => {
    await seedTables();
    await truncate(pg.db, PROFILE_TABLES);
    const want = count(await backfillProfiles(pg.db));
    const wantOnce = await dump();
    const wantAgain = count(await backfillProfiles(pg.db));
    const wantTwice = await dump();
    expect(wantOnce.merges.length).toBeGreaterThan(5);
    await truncate(pg.db, PROFILE_TABLES);
    const opts = { batch: 50, lockBudget: 40 };
    const got = await bulkBackfillProfiles(pg.db, opts);
    expect(count(got)).toEqual(want);
    expect(await dump()).toEqual(wantOnce);
    await bysAreKeys();
    expect(got.reduce((n, c) => n + c.chunks, 0)).toBeGreaterThan(5);
    const again = await bulkBackfillProfiles(pg.db, opts);
    expect(count(again)).toEqual(wantAgain);
    expect(await dump()).toEqual(wantTwice);
    const third = await bulkBackfillProfiles(pg.db, opts);
    expect(third.reduce((n, c) => n + c.created + c.merged + c.perRow, 0)).toBe(0);
    expect(await dump()).toEqual(wantTwice);
    expect((await one(sql`select count(*)::int n from profile_keys`)).n).toBeGreaterThan(N);
  });

  it("--only and --dry-run act as they do per row", async () => {
    await seedTables();
    await truncate(pg.db, PROFILE_TABLES);
    const dry = await bulkBackfillProfiles(pg.db, {
      dryRun: true,
      only: ["lead_import", "consent"],
    });
    expect(dry.map((c) => [c.source, c.rows, c.created])).toEqual([
      ["lead_import", N, 0],
      ["consent", N + N / 2, 0],
    ]);
    expect((await one(sql`select count(*)::int n from profiles`)).n).toBe(0);
    const some = await bulkBackfillProfiles(pg.db, { only: ["lead_import"] });
    expect(some).toHaveLength(1);
    expect(some[0]).toMatchObject({ rows: N, created: N });
  });
});

// ---- rate (BULK_ROWS=100000 pnpm vitest run test/integration/profiles-bulk.test.ts -t rate) -----

describe.skipIf(!process.env.BULK_ROWS)("bulk backfill rate", () => {
  // vitest hides console output here, so BULK_OUT names a file to append the numbers to.
  const say = (line: string) => {
    if (process.env.BULK_OUT) appendFileSync(process.env.BULK_OUT, `${line}\n`);
    else console.log(line);
  };
  it("rows a second, bulk against per row", { timeout: 3_600_000 }, async () => {
    const n = Number(process.env.BULK_ROWS);
    await seedLeads(n);
    await truncate(pg.db, PROFILE_TABLES);
    const t0 = performance.now();
    const got = await bulkBackfillProfiles(pg.db, { only: ["lead_import"] });
    const secs = (performance.now() - t0) / 1000;
    const c = got[0] as BulkCount;
    say(
      `bulk: ${c.rows} rows in ${secs.toFixed(1)}s, ${Math.round(c.rows / secs)} rows/s, ${c.chunks} chunks, ${c.created} made, ${c.perRow} one by one`,
    );
    expect((await one(sql`select count(*)::int n from profiles`)).n).toBe(n - Math.floor(n / 14));
    // Per row on the first slice, the same rows, for the rate beside it.
    const slice = 2000;
    const lead = SOURCES.find((s) => s.name === "lead_import") as Source;
    const first: Source = {
      ...lead,
      rows: (db, after, k) => lead.rows(db, after, Math.min(k, slice - Number(after))),
    };
    await truncate(pg.db, PROFILE_TABLES);
    const t1 = performance.now();
    await perRow([first]);
    const s1 = (performance.now() - t1) / 1000;
    say(`per row: ${slice} rows in ${s1.toFixed(1)}s, ${Math.round(slice / s1)} rows/s`);
  });
});

/** Leads in bulk: one in fourteen joins an earlier lead's profile by its social handle. */
async function seedLeads(n: number) {
  await run(
    sql`insert into imports (source_type, source_ref, stats) values ('t', 'r', '{}'::jsonb)`,
  );
  await run(sql`insert into leads (email, first_name, last_name, title, status, raw, import_id, country, social_url, created_at)
    select 'lead' || i || '@example.test', 'Lee' || i, 'Park',
      case when i % 40 = 0 then 'Founder' end, 'imported', '{}'::jsonb, 1, 'US',
      case when i % 2 = 0 then 'https://x.com/h' || (i / 2 - (i / 2) / 7) end,
      ${T0} + ((i % 5000) || ' minutes')::interval
    from generate_series(1, ${n}) i`);
}

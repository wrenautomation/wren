/**
 * Setup alerts on Postgres: each state change alerts once, routed to whoever acts; a lost fact
 * pauses the installed parts that need it and its return resumes them; a run past its limit turns
 * stuck once; the team hears each alert once and a daily digest of what's still open. SetupWatch
 * writes only its own three tables.
 */
import { startTestPostgres, type TestPostgres } from "@wren/db/testing";
import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { clients } from "../../src/clients/schema.js";
import {
  AGENT_ON_IT,
  addAccount,
  defineSetup,
  markStep,
  recheck,
  type SetupEmit,
  setupStep,
  setupWorkflow,
  startSetup,
} from "../../src/setup.js";
import {
  type AlertPart,
  alertTimeline,
  clientAlerts,
  clientMailAlerts,
  partPaused,
  pausedParts,
  teamAlerts,
} from "../../src/setup-alerts.js";
import { setupAlerts, setupRuns } from "../../src/setup-schema.js";
import { setupWatchPass } from "../../src/setup-watch.js";
import { pgSpineStore, resume, type Walk, walk } from "../../src/spine.js";

let pg: TestPostgres;
beforeAll(async () => {
  pg = await startTestPostgres();
  await pg.db.insert(clients).values([
    { id: "acme", name: "Acme", database: "wren_client_acme", products: { "part.watch": {} } },
    { id: "beta", name: "Beta", database: "wren_client_beta" },
  ]);
});
afterAll(() => pg.stop());

const SETUP = defineSetup({
  id: "setup.alerts",
  name: "Alerts setup",
  blurb: "Two steps.",
  site: "domain",
  repeat: "1 day",
  steps: [
    {
      id: "details",
      fact: "a.details",
      label: "Details",
      who: "client",
      how: "Send your details.",
      forYou: "We collect your details.",
      within: "2 days",
    },
    {
      id: "dns",
      fact: "a.dns",
      label: "DNS records",
      who: "auto",
      how: "Add the records.",
      forYou: "Wren adds the records.",
      check: "a.dns",
      every: "1 hour",
      within: "2 days",
    },
  ],
});
const PART: AlertPart = {
  id: "part.watch",
  name: "Watch",
  requires: { components: [], accounts: [], anyAccount: [], facts: ["a.dns"] },
};

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const T0 = new Date("2026-02-02T12:00:00Z");
let now = T0;
let dnsOk = true;
const seen: unknown[] = [];
const checks = {
  "a.dns": async (input: unknown) => {
    seen.push(input);
    return dnsOk ? { ok: true, why: "Records found" } : { ok: false, why: "No MX record" };
  },
};
const told: { client: string | null; title: string; level?: string | undefined }[] = [];
const notifierFor = (owner: string | null) => ({
  name: "test",
  notify: async (title: string, _body: string, level?: string) => {
    told.push({ client: owner, title, level });
    return true;
  },
});

function walker(client: string) {
  const later: { id: string; ms: number }[] = [];
  const w: Walk = {
    flows: new Map([[SETUP.id, setupWorkflow(SETUP)]]),
    parts: new Map(),
    steps: {
      "setup.step": setupStep({
        main: pg.db,
        setups: [SETUP],
        checks,
        agent: null,
        notifierFor,
        parts: [PART],
        now: () => now,
      }),
    },
    store: pgSpineStore(pg.db),
    client,
    by: `inv-${client}`,
    run: (_n, fn) => fn(),
    later: (id, ms) => later.push({ id, ms }),
    rule: async () => false,
  };
  const go = (e: SetupEmit) => walk(w, e.workflow, e.from, e.events);
  return { w, later, go };
}

const alertsOf = (accountId: number) =>
  pg.db
    .select()
    .from(setupAlerts)
    .where(eq(setupAlerts.accountId, accountId))
    .orderBy(setupAlerts.id);

describe("setup alerts", () => {
  it("routes each change once, pauses on a lost fact and resumes on its return", async () => {
    now = T0;
    dnsOk = true;
    told.length = 0;
    const acct = await addAccount(pg.db, {
      client: "acme",
      site: "domain",
      ref: "acme.test",
      by: "op",
    });
    const { go, w, later } = walker("acme");
    await go(await startSetup(pg.db, SETUP, { accountId: acct.id, by: "op", now }));

    // The client's step: on their Now, not the team's, and never pinged to the team.
    const [waiting] = await alertsOf(acct.id);
    expect(waiting).toMatchObject({
      kind: "waiting",
      for: "client",
      level: "action",
      title: 'Sending domain: "Details" needs you',
      clearedAt: null,
    });
    expect((await clientAlerts(pg.db, "acme", now)).map((a) => a.kind)).toEqual(["waiting"]);
    expect(await teamAlerts(pg.db)).toEqual([]);
    expect(told).toEqual([]);
    // Mailed once to people with access: the window after it is empty.
    expect(await clientMailAlerts(pg.db, "acme", new Date(T0.getTime() - 1), now)).toHaveLength(1);
    expect(await clientMailAlerts(pg.db, "acme", now, now)).toHaveLength(0);

    // Marked done: the waiting clears; the check passes; done, told once at info.
    await go(
      (await markStep(pg.db, SETUP, {
        accountId: acct.id,
        step: "details",
        by: "op",
        now,
        parts: [PART],
      })) as SetupEmit,
    );
    expect(
      (await pg.db.select().from(setupRuns).where(eq(setupRuns.accountId, acct.id)))[0],
    ).toMatchObject({ state: "done" });
    expect((await alertsOf(acct.id)).map((a) => [a.kind, !!a.clearedAt])).toEqual([
      ["waiting", true],
      ["done", true],
    ]);
    expect(told).toEqual([
      { client: "acme", title: "Sending domain: Alerts setup done", level: "info" },
    ]);
    expect(await pausedParts(pg.db, "acme", [PART])).toEqual(new Map());

    // A day on the records are gone: lost (warning, the team's) and the part pauses.
    dnsOk = false;
    now = new Date(T0.getTime() + DAY + HOUR);
    const r = await recheck(pg.db, [SETUP], checks, { now, parts: [PART] });
    expect(r).toMatchObject({ checked: 1, lost: 1 });
    for (const e of r.emits) await go(e);
    const lost = (await alertsOf(acct.id)).filter((a) => !a.clearedAt);
    expect(lost.map((a) => [a.kind, a.for, a.level])).toEqual([
      ["lost", "wren", "warning"],
      ["paused", "client", "info"],
    ]);
    expect(lost[1]?.title).toBe('Watch paused: needs "DNS records"');
    expect(await pausedParts(pg.db, "acme", [PART])).toEqual(new Map([["part.watch", "a.dns"]]));
    expect(await partPaused(pg.db, "acme", PART)).toBe("a.dns");
    expect(told.slice(1).map((t) => t.level)).toEqual(["warning", "info"]);

    // Later rounds of the same loss alert nobody again.
    const count = (await alertsOf(acct.id)).length;
    now = new Date(now.getTime() + HOUR);
    await resume(w, later.at(-1)?.id as string);
    expect(await alertsOf(acct.id)).toHaveLength(count);
    expect(told).toHaveLength(3);

    // The records are back: lost and paused clear, the part resumes, the setup is done again.
    dnsOk = true;
    now = new Date(now.getTime() + HOUR);
    await resume(w, later.at(-1)?.id as string);
    const after = await alertsOf(acct.id);
    expect(after.filter((a) => !a.clearedAt)).toEqual([]);
    expect(after.slice(count).map((a) => a.kind)).toEqual(["resumed", "done"]);
    expect(await pausedParts(pg.db, "acme", [PART])).toEqual(new Map());
    expect(await partPaused(pg.db, "acme", PART)).toBeNull();

    // The account's timeline: everything, newest first.
    const line = (await alertTimeline(pg.db, [acct.id])).get(acct.id) ?? [];
    expect(line.map((a) => a.kind)).toEqual([
      "done",
      "resumed",
      "paused",
      "lost",
      "done",
      "waiting",
    ]);
  });

  it("turns a quiet step stuck once, and digests what's still open once a day", async () => {
    now = T0;
    told.length = 0;
    const acct = await addAccount(pg.db, {
      client: "beta",
      site: "domain",
      ref: "beta.test",
      by: "op",
    });
    const { go } = walker("beta");
    await go(await startSetup(pg.db, SETUP, { accountId: acct.id, by: "op", now }));
    const deps = { main: pg.db, setups: [SETUP], checks, parts: [PART], notifierFor };

    // Within its two days: nothing.
    now = new Date(T0.getTime() + DAY);
    expect(await setupWatchPass(deps, now)).toMatchObject({ stuck: 0, told: 0, digests: 0 });

    // Past them: stuck, the team told once at warning.
    now = new Date(T0.getTime() + 3 * DAY);
    expect(await setupWatchPass(deps, now)).toMatchObject({ stuck: 1, told: 1 });
    expect(told).toEqual([
      { client: "beta", title: 'Sending domain: "Details" stuck past 2 days', level: "warning" },
    ]);
    expect(
      (await pg.db.select().from(setupRuns).where(eq(setupRuns.accountId, acct.id)))[0],
    ).toMatchObject({ state: "stuck" });
    expect(await setupWatchPass(deps, now)).toMatchObject({ stuck: 0, told: 0, digests: 0 });
    expect((await teamAlerts(pg.db)).map((a) => a.kind)).toEqual(["stuck"]);

    // A day on, still stuck: one digest for beta, then none until the next day.
    now = new Date(now.getTime() + DAY + HOUR);
    expect(await setupWatchPass(deps, now)).toMatchObject({ digests: 1 });
    expect(told.at(-1)).toMatchObject({ client: "beta", level: "info" });
    expect(await setupWatchPass(deps, now)).toMatchObject({ digests: 0 });
    now = new Date(now.getTime() + DAY + HOUR);
    expect(await setupWatchPass(deps, now)).toMatchObject({ digests: 1 });
  });

  it("SetupWatch writes only setup runs, facts and alerts, and checks read nothing else", async () => {
    // Every other table logs any write to it. The audit log's own rows record those three.
    await pg.db.execute(sql`create table write_log (t text)`);
    await pg.db.execute(sql`
      create function log_write() returns trigger language plpgsql as $$
      begin insert into write_log values (TG_TABLE_NAME); return null; end $$`);
    await pg.db.execute(sql`
      do $$ declare r record; begin
        for r in select tablename from pg_tables where schemaname = 'public'
          and tablename not in ('setup_runs', 'account_facts', 'setup_alerts', 'write_log',
            'audit_events')
        loop
          execute format(
            'create trigger %I after insert or update or delete on %I for each statement execute function log_write()',
            'lw_' || left(r.tablename, 50), r.tablename);
        end loop;
      end $$`);

    // Due rechecks, a lost fact, a stuck run, a done-for-you step waiting on the team.
    now = new Date(T0.getTime() + 10 * DAY);
    dnsOk = false;
    seen.length = 0;
    await pg.db.update(setupRuns).set({ nextCheckAt: now }).where(eq(setupRuns.state, "done"));
    const deps = { main: pg.db, setups: [SETUP], checks, parts: [PART], notifierFor };
    const pass = await setupWatchPass(deps, now);
    expect(pass.checked).toBeGreaterThan(0);
    const logged = await pg.db.execute<{ t: string }>(sql`select t from write_log`);
    expect(logged.map((r) => r.t)).toEqual([]);
    // A check is handed the account and the time: nothing to write with.
    for (const input of seen)
      expect(Object.keys(input as object).sort()).toEqual(["account", "now"]);
    // Nothing queued an agent: no run waits on it.
    expect(
      await pg.db
        .select()
        .from(setupRuns)
        .where(and(eq(setupRuns.state, "waiting_wren"), eq(setupRuns.why, AGENT_ON_IT))),
    ).toEqual([]);
  });
});

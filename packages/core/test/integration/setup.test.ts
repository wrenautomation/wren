/**
 * Account setups on the spine and Postgres: a step waits and checks again on its own wire,
 * a person marks one done, done-for-you buys wait on Wren's team, a run past its `within` is
 * stuck, and a lost fact starts the setup over as its next generation.
 */
import { startTestPostgres, type TestPostgres } from "@wren/db/testing";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { clients } from "../../src/clients/schema.js";
import type { DoOutcome, DoRequest } from "../../src/content/do.js";
import {
  AGENT_ON_IT,
  type AgentJob,
  accountsOf,
  addAccount,
  agentDone,
  checkNow,
  defineSetup,
  factLost,
  factsHeld,
  factsLacking,
  markStep,
  recheck,
  type SetupEmit,
  setupStep,
  setupWorkflow,
  startSetup,
  WAITING_ON_WREN,
} from "../../src/setup.js";
import { setupRuns } from "../../src/setup-schema.js";
import { pgSpineStore, resume, type Walk, walk } from "../../src/spine.js";

let pg: TestPostgres;
beforeAll(async () => {
  pg = await startTestPostgres();
  await pg.db.insert(clients).values([
    { id: "acme", name: "Acme", database: "wren_client_acme" },
    { id: "beta", name: "Beta", database: "wren_client_beta", buysOk: true },
  ]);
});
afterAll(() => pg.stop());

const SETUP = defineSetup({
  id: "setup.test",
  name: "Test setup",
  blurb: "Three steps.",
  site: "domain",
  repeat: "7 days",
  steps: [
    {
      id: "details",
      fact: "t.details",
      label: "Details",
      who: "client",
      how: "Send your details.",
      forYou: "We collect your details.",
      goal: "collect the details",
    },
    {
      id: "buy",
      fact: "t.bought",
      label: "Bought",
      who: "wren",
      how: "Wren buys it.",
      forYou: "Wren buys it.",
      goal: "buy it",
      buys: true,
    },
    {
      id: "approve",
      fact: "t.approved",
      label: "Approved",
      who: "auto",
      how: "Wait for approval.",
      forYou: "Wait for approval.",
      check: "t.approved",
      every: "1 day",
      within: "3 days",
    },
  ],
});

const DAY = 86_400_000;
const T0 = new Date("2026-01-05T12:00:00Z");
let now = T0;
let approved = false;
const asked: DoRequest[] = [];
let answer: DoOutcome["status"] = "done";
const doFake = async (req: DoRequest): Promise<DoOutcome> => {
  asked.push(req);
  return {
    via: "agent",
    name: null,
    input: {},
    output: null,
    status: answer,
    built: null,
    session: null,
    summary: answer === "done" ? "Done by the agent" : "The agent needs a person",
  };
};
// The agent queue: SetupAgent's half runs in `drain`, as the service would.
const jobs: { job: AgentJob; key: string }[] = [];
const told: {
  client: string | null;
  title: string;
  body?: string | undefined;
  level?: string | undefined;
}[] = [];
const checks = {
  "t.approved": async () =>
    approved ? { ok: true, why: "Approved" } : { ok: false, why: "Still in review" },
};

function walker(client: string, withDo = false) {
  const later: { id: string; ms: number }[] = [];
  const w: Walk = {
    flows: new Map([[SETUP.id, setupWorkflow(SETUP)]]),
    parts: new Map(),
    steps: {
      "setup.step": setupStep({
        main: pg.db,
        setups: [SETUP],
        checks,
        agent: withDo
          ? async (job, key) => {
              jobs.push({ job, key });
            }
          : null,
        notifierFor: (owner) => ({
          name: "test",
          notify: async (title, body, level) => {
            told.push({ client: owner, title, body, level });
            return true;
          },
        }),
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
  /** What SetupAgent does with each queued job: autobrowse answers, the run hears it. */
  const drain = async () => {
    for (let q = jobs.shift(); q; q = jobs.shift()) {
      const out = await doFake(q.job.request);
      const e = await agentDone(
        pg.db,
        SETUP,
        q.job,
        { done: out.status === "done", why: out.summary },
        now,
      );
      if (e) await go(e);
    }
  };
  return { w, later, go, drain };
}

const runOf = async (accountId: number) =>
  (await pg.db.select().from(setupRuns).where(eq(setupRuns.accountId, accountId)))[0];

describe("a setup run, self-serve", () => {
  it("waits on the client, then Wren's team, then a check; a lost fact starts it over", async () => {
    now = T0;
    approved = false;
    const acct = await addAccount(pg.db, {
      client: "acme",
      site: "domain",
      ref: "acme.test",
      by: "op",
    });
    // The same account twice is one row.
    expect(
      (await addAccount(pg.db, { client: "acme", site: "domain", ref: "acme.test", by: "op" })).id,
    ).toBe(acct.id);
    const { go, w, later } = walker("acme");

    await go(await startSetup(pg.db, SETUP, { accountId: acct.id, by: "op", now }));
    expect(await runOf(acct.id)).toMatchObject({
      gen: 1,
      state: "waiting_client",
      step: "details",
      why: "Send your details.",
    });
    expect(later).toEqual([]);

    // The client sends them; an operator marks it. The buy waits on William's yes for acme.
    await go(
      (await markStep(pg.db, SETUP, {
        accountId: acct.id,
        step: "details",
        by: "op",
        now,
      })) as SetupEmit,
    );
    expect(await runOf(acct.id)).toMatchObject({
      state: "waiting_wren",
      step: "buy",
      why: WAITING_ON_WREN,
    });

    // Wren's team buys it by hand. The approval checks daily on its own wire.
    await go(
      (await markStep(pg.db, SETUP, {
        accountId: acct.id,
        step: "buy",
        by: "op",
        now,
      })) as SetupEmit,
    );
    expect(await runOf(acct.id)).toMatchObject({
      state: "checking",
      step: "approve",
      why: "Still in review",
      rounds: 1,
    });
    expect(later).toEqual([{ id: expect.any(String), ms: DAY }]);

    // A day on, still in review: round two.
    now = new Date(T0.getTime() + DAY);
    await resume(w, later[0]?.id as string);
    expect(await runOf(acct.id)).toMatchObject({ state: "checking", rounds: 2 });
    expect(later).toHaveLength(2);

    // Approved: done, out of the workflow, with its repeat booked.
    approved = true;
    now = new Date(T0.getTime() + 2 * DAY);
    expect(await resume(w, later[1]?.id as string)).toMatchObject({ out: 1 });
    const done = await runOf(acct.id);
    expect(done).toMatchObject({ state: "done", step: null, gen: 1 });
    expect(done?.nextCheckAt?.getTime()).toBe(now.getTime() + 7 * DAY);
    expect(await factsHeld(pg.db, "acme")).toEqual(
      new Set(["t.details", "t.bought", "t.approved"]),
    );
    expect(
      factsLacking(
        {
          requires: { components: [], accounts: [], anyAccount: [], facts: ["t.approved", "x"] },
        } as never,
        await factsHeld(pg.db, "acme"),
      ),
    ).toEqual(["x"]);

    // Not due yet: nothing rechecked.
    expect((await recheck(pg.db, [SETUP], checks, { now })).checked).toBe(0);

    // A week on the approval is gone: lost, and generation 2 goes straight to that step.
    approved = false;
    now = new Date(T0.getTime() + 10 * DAY);
    const r = await recheck(pg.db, [SETUP], checks, { now });
    expect(r).toMatchObject({ checked: 1, lost: 1 });
    for (const e of r.emits) await go(e);
    expect(await runOf(acct.id)).toMatchObject({ gen: 2, state: "checking", step: "approve" });
    const [view] = await accountsOf(pg.db, "acme");
    // Lost stays lost until a check passes again: what needs it stays paused meanwhile.
    expect(view?.facts.find((f) => f.fact === "t.approved")).toMatchObject({ state: "lost" });

    // A round left over from generation 1 moves nothing.
    const gen2 = await runOf(acct.id);
    await resume(w, later[1]?.id as string);
    expect(await runOf(acct.id)).toEqual(gen2);

    // Past `within`: stuck, and Wren's team is told once. A vendor's review keeps checking.
    const before = later.length;
    told.length = 0;
    now = new Date(T0.getTime() + 14 * DAY);
    await resume(w, later.at(-1)?.id as string);
    expect(await runOf(acct.id)).toMatchObject({
      state: "stuck",
      why: expect.stringMatching(/^Stuck past 3 days/),
    });
    expect(later.length).toBe(before + 1);
    expect(told).toEqual([
      {
        client: "acme",
        title: 'Sending domain: "Approved" stuck past 3 days',
        body: expect.stringContaining("Still in review"),
        level: "warning",
      },
    ]);
    // A check now on the stuck run checks, but tells nobody again.
    await go((await checkNow(pg.db, SETUP, { accountId: acct.id, now })) as SetupEmit);
    expect(await runOf(acct.id)).toMatchObject({ state: "stuck" });
    expect(told).toHaveLength(1);
  });
});

describe("a setup run, done for you", () => {
  it("runs the agent once per step, and buys only with the client's yes", async () => {
    now = T0;
    approved = true;
    asked.length = 0;
    answer = "done";
    const acct = await addAccount(pg.db, {
      client: "beta",
      site: "domain",
      ref: "beta.test",
      mode: "for_you",
      login: "beta-registrar",
      by: "op",
    });
    const { go, drain } = walker("beta", true);
    jobs.length = 0;
    await go(await startSetup(pg.db, SETUP, { accountId: acct.id, by: "op", now }));
    // Queued, in the client's own autobrowse, once per account, generation and step.
    expect(jobs.map((j) => [j.key, j.job.owner])).toEqual([
      [`setup-agent:${acct.id}:g1:details`, "beta"],
    ]);
    expect(await runOf(acct.id)).toMatchObject({ state: "waiting_wren", why: AGENT_ON_IT });
    const first = jobs[0]?.job as AgentJob;
    await drain();
    expect(asked.map((a) => a.goal)).toEqual(["collect the details", "buy it"]);
    expect(asked[0]?.inputs).toEqual({
      account: "beta.test",
      site: "domain",
      client: "beta",
      login: "beta-registrar",
    });
    expect(await runOf(acct.id)).toMatchObject({ state: "done", mode: "for_you" });
    // A late answer for a step the run passed moves nothing.
    expect(await agentDone(pg.db, SETUP, first, { done: true, why: "again" }, now)).toBeNull();

    // The agent can't finish: the step waits on Wren's team with what it said.
    answer = "needs-human";
    const other = await addAccount(pg.db, {
      client: "beta",
      site: "domain",
      ref: "beta2.test",
      mode: "for_you",
      by: "op",
    });
    await go(await startSetup(pg.db, SETUP, { accountId: other.id, by: "op", now }));
    await drain();
    expect(await runOf(other.id)).toMatchObject({
      state: "waiting_wren",
      step: "details",
      why: "The agent couldn't: The agent needs a person",
    });
    expect(asked).toHaveLength(3);

    // No yes for acme: the agent does the details, never the buy.
    const theirs = await addAccount(pg.db, {
      client: "acme",
      site: "domain",
      ref: "acme2.test",
      mode: "for_you",
      by: "op",
    });
    answer = "done";
    const acme = walker("acme", true);
    await acme.go(await startSetup(pg.db, SETUP, { accountId: theirs.id, by: "op", now }));
    await acme.drain();
    expect(asked.slice(3).map((a) => a.goal)).toEqual(["collect the details"]);
    expect(await runOf(theirs.id)).toMatchObject({
      state: "waiting_wren",
      step: "buy",
      why: WAITING_ON_WREN,
    });
  });

  it("a step with a finder queues it; what it finds becomes the account's ref", async () => {
    now = T0;
    const FIND = defineSetup({
      id: "setup.find",
      name: "Find setup",
      blurb: "One step a finder does.",
      site: "google_business",
      steps: [
        {
          id: "place",
          fact: "t.place",
          label: "Found",
          who: "client",
          how: "Send the id.",
          forYou: "Wren finds the id.",
          find: "t.finder",
        },
      ],
    });
    const queued: AgentJob[] = [];
    const w: Walk = {
      flows: new Map([[FIND.id, setupWorkflow(FIND)]]),
      parts: new Map(),
      steps: {
        "setup.step": setupStep({
          main: pg.db,
          setups: [FIND],
          checks: {},
          agent: async (job) => {
            queued.push(job);
          },
          now: () => now,
        }),
      },
      store: pgSpineStore(pg.db),
      client: "beta",
      by: "inv-beta-find",
      run: (_n, fn) => fn(),
      later: () => undefined,
      rule: async () => false,
    };
    const go = (e: SetupEmit) => walk(w, e.workflow, e.from, e.events);
    const acct = await addAccount(pg.db, {
      client: "beta",
      site: "google_business",
      ref: "Northwind Plumbing, 12 Elm St",
      mode: "for_you",
      by: "op",
    });
    await go(await startSetup(pg.db, FIND, { accountId: acct.id, by: "op", now }));
    expect(queued.map((j) => [j.step, j.request.goal])).toEqual([["place", "Wren finds the id."]]);
    const job = queued[0] as AgentJob;

    // Another of the owner's accounts already holds that ref: not done, and says so.
    await addAccount(pg.db, {
      client: "beta",
      site: "google_business",
      ref: "ChIJtaken-0001",
      by: "op",
    });
    expect(
      await agentDone(pg.db, FIND, job, { done: true, why: "Found", ref: "ChIJtaken-0001" }, now),
    ).toBeNull();
    expect(await runOf(acct.id)).toMatchObject({
      state: "waiting_wren",
      why: "The agent couldn't: Another account already holds ChIJtaken-0001",
    });

    const e = await agentDone(
      pg.db,
      FIND,
      job,
      { done: true, why: "Found on Google Maps", ref: "ChIJsynthetic-0001" },
      now,
    );
    if (e) await go(e);
    const [row] = await accountsOf(pg.db, "beta").then((a) => a.filter((x) => x.id === acct.id));
    expect(row?.ref).toBe("ChIJsynthetic-0001");
    expect(row?.facts.find((f) => f.fact === "t.place")).toMatchObject({ state: "ok" });
    expect(await runOf(acct.id)).toMatchObject({ state: "done" });
  });

  it("another owner's walk can't move an account", async () => {
    const acct = await addAccount(pg.db, {
      client: "acme",
      site: "domain",
      ref: "acme3.test",
      by: "op",
    });
    const { go } = walker("beta");
    await go(await startSetup(pg.db, SETUP, { accountId: acct.id, by: "op", now }));
    expect(await runOf(acct.id)).toMatchObject({ state: "checking", rounds: 0 });
  });
});

describe("factLost", () => {
  it("a part's failed call loses the fact and starts its setup over", async () => {
    now = T0;
    approved = true;
    answer = "done";
    const acct = await addAccount(pg.db, {
      client: "beta",
      site: "domain",
      ref: "beta4.test",
      mode: "for_you",
      by: "op",
    });
    const { go, drain } = walker("beta", true);
    await go(await startSetup(pg.db, SETUP, { accountId: acct.id, by: "op", now }));
    await drain();
    expect(await runOf(acct.id)).toMatchObject({ state: "done", gen: 1 });
    approved = false;
    const emits = await factLost(
      pg.db,
      [SETUP],
      {
        client: "beta",
        site: "domain",
        fact: "t.approved",
        why: "The carrier blocked a send",
        by: "sms",
      },
      now,
    );
    // beta.test and beta4.test both held it.
    expect(emits).toHaveLength(2);
    for (const e of emits) await go(e);
    expect(await runOf(acct.id)).toMatchObject({ gen: 2, state: "checking", step: "approve" });
  });
});

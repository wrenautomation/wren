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
  accountsOf,
  addAccount,
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
        do: withDo ? doFake : null,
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
  return { w, later, go: (e: SetupEmit) => walk(w, e.workflow, e.from, e.events) };
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
    expect(view?.facts.find((f) => f.fact === "t.approved")).toMatchObject({ state: "waiting" });

    // A round left over from generation 1 moves nothing.
    const gen2 = await runOf(acct.id);
    await resume(w, later[1]?.id as string);
    expect(await runOf(acct.id)).toEqual(gen2);

    // Past `within`: stuck, and no more rounds.
    const before = later.length;
    now = new Date(T0.getTime() + 14 * DAY);
    await resume(w, later.at(-1)?.id as string);
    expect(await runOf(acct.id)).toMatchObject({
      state: "stuck",
      why: expect.stringMatching(/^Stuck past 3 days/),
    });
    expect(later.length).toBe(before);
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
    const { go } = walker("beta", true);
    expect(
      (await go(await startSetup(pg.db, SETUP, { accountId: acct.id, by: "op", now }))).out,
    ).toBe(1);
    expect(asked.map((a) => a.goal)).toEqual(["collect the details", "buy it"]);
    expect(asked[0]?.inputs).toEqual({
      account: "beta.test",
      site: "domain",
      client: "beta",
      login: "beta-registrar",
    });
    expect(await runOf(acct.id)).toMatchObject({ state: "done", mode: "for_you" });

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
    expect(await runOf(other.id)).toMatchObject({
      state: "waiting_wren",
      step: "details",
      why: "The agent needs a person",
    });
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
    const { go } = walker("beta", true);
    await go(await startSetup(pg.db, SETUP, { accountId: acct.id, by: "op", now }));
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

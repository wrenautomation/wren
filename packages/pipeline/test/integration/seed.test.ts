/**
 * The client-zero seed on a real Postgres (designs/2026-10-18-journeys.md): the same file twice
 * makes the same rows, and a bad file writes nothing. The journey opens on the real store and
 * steps through `openEmit`, no Restate. Synthetic data only.
 */
import { randomUUID } from "node:crypto";
import { LOGIC } from "@wren/core/logic";
import { type Fired, pgSpineStore, type Walk, walk } from "@wren/core/spine";
import type { Workflow } from "@wren/core/workflows";
import { startTestPostgres, type TestPostgres } from "@wren/db/testing";
import { count, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { funnelWorkflowsOf } from "../../src/journeys.js";
import { openEmit } from "../../src/moves.js";
import {
  funnels,
  funnelVersions,
  journeys,
  offerVersions,
  pipelineDeals,
  termsVersions,
} from "../../src/schema.js";
import { applySeed, parseSeed, planSeed, type SeedDeps } from "../../src/seed.js";
import { Refused } from "../../src/store.js";

let pg: TestPostgres;
beforeAll(async () => {
  pg = await startTestPostgres();
});
afterAll(() => pg.stop());

const triggers = new Set(LOGIC.filter((l) => l.group === "trigger").map((l) => l.id));

/** What `Spine/emit` does with an Emit: walk it from its node. */
async function play(e: Awaited<ReturnType<typeof openEmit>>) {
  const flows: Workflow[] = await funnelWorkflowsOf(pg.db, "wren");
  const w: Walk = {
    flows: new Map(flows.map((f) => [f.id, f])),
    parts: new Map(),
    steps: (await import("../../src/steps.js")).journeySteps({ db: () => pg.db }),
    store: pgSpineStore(pg.db),
    client: null,
    by: randomUUID(),
    run: (_name, fn) => fn(),
    later: () => {},
    rule: async () => true,
    fire: (_req: Fired) => {},
  };
  await walk(w, e.workflow, e.from, e.events);
}

const deps = (over: Partial<SeedDeps> = {}): SeedDeps => ({
  db: pg.db,
  by: "tester",
  triggers,
  open: async (req) => play(await openEmit(pg.db, req)),
  engagements: async () => [7],
  wait: async () => {},
  ...over,
});

/** A fresh offer per test, so tests do not share rows. */
async function world(tag: string) {
  const offer = `offer-${tag}`;
  await pg.db.insert(offerVersions).values({
    offer,
    number: 1,
    hash: tag.padEnd(64, "0"),
    body: {} as never,
    why: "t",
    createdBy: "t",
  });
  const terms = (setupCents: number, shareBps?: number) => ({
    currency: "USD",
    setupCents,
    monthlyCents: null,
    perUnitCents: null,
    unit: null,
    capCents: null,
    days: 90,
    payDays: 7,
    ...(shareBps ? { shareBps } : {}),
  });
  const file = (): Loose => ({
    offer,
    funnels: [
      {
        id: `main-${tag}`,
        body: {
          name: "Main",
          offer,
          stages: [
            { key: "engaged", label: "Engaged", on: [{ trigger: "trigger.reply" }] },
            { key: "signed", label: "Signed", sale: true, on: [{ trigger: "trigger.document" }] },
            { key: "paying", label: "Paying", on: [{ trigger: "trigger.payment" }] },
          ],
          entries: [
            { id: "mail", kind: "outbound", channel: "email" },
            { id: "partner", kind: "manual", to: "signed" },
          ],
        },
      },
      {
        id: `side-${tag}`,
        status: "off",
        body: {
          name: "Side",
          offer,
          stages: [{ key: "lead", label: "Lead", sale: true, on: [{ trigger: "trigger.form" }] }],
          entries: [{ id: "ads", kind: "ads" }],
        },
      },
    ],
    terms: [
      { plan: "standard", from: "2020-01-01", body: terms(100_000) },
      { plan: "partner-1", from: "2020-01-01", body: terms(0, 1000) },
    ],
    journeys: [
      {
        person: `partner-${tag}@example.test`,
        name: "Pat Partner",
        funnel: `main-${tag}`,
        at: "signed",
        entry: "partner",
      },
    ],
    deals: [
      {
        person: `partner-${tag}@example.test`,
        funnel: `main-${tag}`,
        plan: "partner-1",
        engagement: { client: "acme" },
      },
    ],
  });
  return { offer, file, terms };
}

type TStage = { key: string; label: string; sale?: true; on: { trigger: string }[] };
type Loose = {
  offer: string;
  funnels: {
    id: string;
    status?: string;
    body: { name: string; offer: string; stages: TStage[]; entries: object[] };
  }[];
  terms: { plan: string; from: string; body: { setupCents: number } & Record<string, unknown> }[];
  journeys: { person: string; name: string; funnel: string; at: string; entry: string }[];
  deals: { person: string; funnel: string; plan: string; engagement: { client: string } }[];
};

const rows = async () => ({
  funnels: (await pg.db.select({ n: count() }).from(funnels))[0]?.n,
  versions: (await pg.db.select({ n: count() }).from(funnelVersions))[0]?.n,
  terms: (await pg.db.select({ n: count() }).from(termsVersions))[0]?.n,
  journeys: (await pg.db.select({ n: count() }).from(journeys))[0]?.n,
  deals: (await pg.db.select({ n: count() }).from(pipelineDeals))[0]?.n,
});
const run = async (raw: unknown, d = deps()) => {
  const plan = await planSeed(d, parseSeed(raw));
  await applySeed(plan);
  return plan;
};
const reasons = (p: Promise<unknown>) =>
  p.then(
    () => [] as string[],
    (e: unknown) => (e instanceof Refused ? e.errors : [String(e)]),
  );

describe("seed", () => {
  it("makes the same rows when run twice", async () => {
    const w = await world("twice");
    const first = await run(w.file());
    expect(first.filter((i) => i.run).map((i) => `${i.area}:${i.do}`)).toEqual([
      "funnel:add",
      "funnel:add",
      "status:set",
      "terms:add",
      "terms:add",
      "journey:open",
      "deal:sign",
      "engagement:link",
    ]);
    const after = await rows();
    const [deal] = await pg.db.select().from(pipelineDeals);
    expect(deal?.termsVersion).not.toBeNull();
    expect(deal?.engagementId).toBe(7);
    const [side] = await pg.db.select().from(funnels).where(eq(funnels.id, "side-twice"));
    expect(side?.status).toBe("off");

    const second = await run(w.file());
    expect(second.every((i) => !i.run)).toBe(true);
    expect(await rows()).toEqual(after);
  });

  it("appends a funnel version and a terms version only when the body changed", async () => {
    const w = await world("change");
    await run(w.file());
    const f = w.file();
    f.funnels[0]?.body.stages.push({ key: "extra", label: "Extra", on: [] });
    const plan = await planSeed(deps(), parseSeed(f));
    expect(plan.filter((i) => i.run).map((i) => `${i.area}:${i.do}`)).toEqual(["funnel:append"]);
    await applySeed(plan);
    const v = await pg.db
      .select()
      .from(funnelVersions)
      .where(eq(funnelVersions.funnel, "main-change"));
    expect(v.map((x) => x.number)).toEqual([1, 2]);
  });

  it("refuses a deal whose terms differ, and writes nothing", async () => {
    const w = await world("conflict");
    await run(w.file());
    const before = await rows();
    const f = w.file();
    f.terms[1] = { plan: "partner-1", from: "2020-02-01", body: w.terms(5_000, 2000) };
    const e = await reasons(planSeed(deps(), parseSeed(f)));
    expect(e.join("\n")).toMatch(/never changes them/);
    expect(await rows()).toEqual(before);
  });

  it("writes nothing for a bad file", async () => {
    const w = await world("bad");
    const before = await rows();
    const cases: [string, (f: ReturnType<typeof w.file>) => unknown, RegExp][] = [
      [
        "a value from a person",
        (f) => ({
          ...f,
          terms: [{ ...f.terms[0], body: { ...f.terms[0]?.body, setupCents: "ASK_WILLIAM" } }],
        }),
        /terms\[0\]\.body\.setupCents/,
      ],
      ["a field the file does not know", (f) => ({ ...f, extra: 1 }), /extra/],
      [
        "a trigger that does not exist",
        (f) => {
          f.funnels[0]?.body.stages.push({
            key: "x",
            label: "X",
            on: [{ trigger: "trigger.nope" }],
          });
          return f;
        },
        /not a known trigger/,
      ],
      [
        "another offer",
        (f) => {
          if (f.funnels[0]) f.funnels[0].body.offer = "other";
          return f;
        },
        /not the file's offer/,
      ],
      [
        "a stage that is no entry",
        (f) => {
          if (f.journeys[0]) f.journeys[0].at = "paying";
          return f;
        },
        /not an entry stage/,
      ],
      [
        "a plan with no terms",
        (f) => {
          if (f.deals[0]) f.deals[0].plan = "ghost";
          return f;
        },
        /plan ghost/,
      ],
      [
        "a plan twice",
        (f) => {
          f.terms.push({ ...f.terms[0] } as never);
          return f;
        },
        /twice/,
      ],
      [
        "a bad amount",
        (f) => {
          if (f.terms[0]) f.terms[0].body.setupCents = -1;
          return f;
        },
        /setupCents/,
      ],
    ];
    for (const [name, make, want] of cases) {
      const e = await reasons(
        (async () => {
          const plan = await planSeed(deps(), parseSeed(make(w.file())));
          await applySeed(plan);
        })(),
      );
      expect(e.join("\n"), name).toMatch(want);
      expect(await rows(), name).toEqual(before);
    }
  });

  it("refuses an offer with no stored version", async () => {
    const w = await world("nover");
    const f = { ...w.file(), offer: "unsynced" };
    f.funnels.forEach((x) => {
      x.body.offer = "unsynced";
    });
    expect((await reasons(planSeed(deps(), parseSeed(f)))).join("\n")).toMatch(/offers sync/);
  });

  it("refuses an engagement link that is not one row", async () => {
    const w = await world("eng");
    const e = await reasons(planSeed(deps({ engagements: async () => [] }), parseSeed(w.file())));
    expect(e.join("\n")).toMatch(/exactly one/);
  });
});

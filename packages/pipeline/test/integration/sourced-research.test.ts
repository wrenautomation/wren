/**
 * Sourced entries and stage research, on a real Postgres (designs/2026-10-18-journeys.md): the
 * generated funnel workflows walk with the real store and steps, no Restate. Synthetic data only.
 */
import { randomUUID } from "node:crypto";
import { resolveProfile } from "@wren/core/profiles";
import { companies, imports, people } from "@wren/core/schema";
import { type Fired, hearersOf, pgSpineStore, type Walk, walk } from "@wren/core/spine";
import type { Workflow } from "@wren/core/workflows";
import { startTestPostgres, type TestPostgres } from "@wren/db/testing";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { funnelWorkflowsOf } from "../../src/journeys.js";
import type { FunnelBody } from "../../src/model.js";
import { type ResearchAsk, type Researcher, requestResearch } from "../../src/research.js";
import {
  funnels,
  funnelVersions,
  journeyResearch,
  journeys,
  offerVersions,
} from "../../src/schema.js";
import { sourcedPass } from "../../src/sourced.js";
import { journeySteps } from "../../src/steps.js";
import { addFunnel, Refused } from "../../src/store.js";

let pg: TestPostgres;
beforeAll(async () => {
  pg = await startTestPostgres();
});
afterAll(() => pg.stop());

const NOW = new Date("2026-10-19T10:00:00Z");

/** A researcher that counts its asks and reads nothing. */
function stub(over: Partial<Researcher> = {}) {
  const calls = { light: [] as ResearchAsk[], full: [] as ResearchAsk[] };
  const r: Researcher = {
    async light(_db, ask) {
      calls.light.push(ask);
      return { role: "Partner", icp: ask.icp };
    },
    async full(ask) {
      calls.full.push(ask);
      return { state: "started", lookupId: 7 };
    },
    ...over,
  };
  return { r, calls };
}

const body = (over: Partial<FunnelBody> = {}): FunnelBody => ({
  name: "Test funnel",
  offer: "offer-a",
  stages: [
    { key: "engaged", label: "Engaged", on: [{ trigger: "trigger.reply" }] },
    { key: "booked", label: "Booked", research: "light", on: [{ trigger: "trigger.booking" }] },
    { key: "signed", label: "Signed", sale: true, on: [{ trigger: "trigger.document" }] },
  ],
  entries: [{ id: "mail", kind: "outbound", channel: "email" }],
  ...over,
});

async function funnel(id: string, b: FunnelBody) {
  await pg.db.insert(funnels).values({ id, name: b.name, status: "live" });
  await pg.db
    .insert(funnelVersions)
    .values({ funnel: id, number: 1, body: b, why: "first", createdBy: "t" });
}

let seq = 0;

/** An import batch of `n` people, each with a profile keyed by the person id. */
async function list(n: number) {
  const [co] = await pg.db
    .insert(companies)
    .values({ name: "Acme Test", domain: `acme-test-${++seq}.example` })
    .returning();
  const [batch] = await pg.db
    .insert(imports)
    .values({ sourceType: "test", sourceRef: "synthetic", stats: {} })
    .returning();
  if (!co || !batch) throw new Error("no rows");
  const ids: number[] = [];
  const profiles: number[] = [];
  for (let i = 0; i < n; i++) {
    const [p] = await pg.db
      .insert(people)
      .values({
        companyId: co.id,
        fullName: `Ada Test${i}`,
        isCompliance: false,
        origin: "manual",
        originRef: "test",
        raw: {},
        importId: batch.id,
      })
      .returning();
    if (!p) throw new Error("no person");
    ids.push(p.id);
    const prof = await resolveProfile(pg.db, [{ kind: "person", value: p.id }], "test", {
      name: p.fullName,
    });
    if (!prof) throw new Error("no profile");
    profiles.push(prof.id);
  }
  return { source: `import:${batch.id}`, batch: batch.id, ids, profiles };
}

function rig(researcher?: Researcher) {
  const w: Walk = {
    flows: new Map(),
    parts: new Map(),
    steps: journeySteps({ db: () => pg.db, ...(researcher ? { researcher } : {}) }),
    store: pgSpineStore(pg.db),
    client: null,
    by: "test",
    run: (_name, fn) => fn(),
    later: () => {},
    rule: async () => true,
    fire: () => {},
  };
  return w;
}

async function hear(w: Walk, flows: Workflow[], f: Fired) {
  const walker: Walk = { ...w, by: randomUUID(), flows: new Map(flows.map((x) => [x.id, x])) };
  for (const h of hearersOf(flows, f.facts)) await walk(walker, h.workflow, h.from, [f.event]);
}

const flowsOf = async (id: string) =>
  (await funnelWorkflowsOf(pg.db, "wren")).filter((f) => f.id.startsWith(`funnel.${id}.`));

describe("a sourced entry", () => {
  it("opens a journey once for a person added to its list", async () => {
    const l = await list(2);
    await funnel(
      "src",
      body({ entries: [{ id: "list", kind: "sourced", source: l.source, to: "engaged" }] }),
    );
    const flows = await flowsOf("src");
    const w = rig();

    const first = await sourcedPass(pg.db, null, {}, NOW);
    expect(first.fires).toHaveLength(2);
    expect(first.cursors[l.source]).toBe(l.ids[1]);
    for (const f of first.fires) await hear(w, flows, f);
    // The same fire again, as a replay would send it: nothing new.
    for (const f of first.fires) await hear(w, flows, f);

    const opened = await pg.db.select().from(journeys).where(eq(journeys.funnel, "src"));
    expect(opened.map((j) => j.profileId).sort()).toEqual([...l.profiles].sort());
    expect(opened.every((j) => j.entry === "list" && j.stage === "engaged")).toBe(true);
    const ref = opened[0]?.entryRef as Record<string, unknown>;
    expect(ref.source).toBe(l.source);
    expect((ref.cause as { kind: string }).kind).toBe("sourced");
    expect(ref.row).toBeDefined();

    // The next pass reads past the cursor: nothing until someone new is added.
    const second = await sourcedPass(pg.db, null, first.cursors, NOW);
    expect(second.fires).toEqual([]);
  });

  it("reads only lists a live funnel names, and skips a member with no profile", async () => {
    const other = await list(1);
    const none = await sourcedPass(pg.db, null, {}, NOW);
    expect(
      none.fires.some(
        (f) => f.facts.trigger === "trigger.source" && f.facts.source === other.source,
      ),
    ).toBe(false);
    const l = await list(1);
    await pg.db.insert(people).values({
      companyId: (await pg.db.select().from(companies).limit(1))[0]?.id ?? 0,
      fullName: "No Profile",
      isCompliance: false,
      origin: "manual",
      originRef: "test",
      raw: {},
      importId: l.batch,
    });
    await funnel("src2", body({ entries: [{ id: "list", kind: "sourced", source: l.source }] }));
    const got = await sourcedPass(pg.db, null, {}, NOW);
    const mine = got.fires.filter(
      (f) => f.facts.trigger === "trigger.source" && f.facts.source === l.source,
    );
    expect(mine).toHaveLength(1);
    expect(got.unkeyed).toBeGreaterThanOrEqual(1);
  });

  it("is refused by checkFunnel when its list does not exist", async () => {
    const triggers = new Set(["trigger.reply", "trigger.booking", "trigger.document"]);
    const bad = body({ entries: [{ id: "list", kind: "sourced", source: "import:999999" }] });
    await expect(
      addFunnel(pg.db, { id: "badsrc", name: "x", body: bad, why: "t", by: "t", triggers }),
    ).rejects.toThrow(Refused);
    const l = await list(1);
    const good = body({ entries: [{ id: "list", kind: "sourced", source: l.source }] });
    await expect(
      addFunnel(pg.db, { id: "goodsrc", name: "x", body: good, why: "t", by: "t", triggers }),
    ).resolves.toMatchObject({ number: 1 });
  });
});

describe("stage research", () => {
  it("asks once on arrival at a light stage, against the offer's icp, and a replay asks nothing", async () => {
    await pg.db.insert(offerVersions).values({
      offer: "offer-a",
      number: 1,
      hash: "2".repeat(64),
      body: { icp: { who: "Small firms" } } as never,
      why: "t",
      createdBy: "t",
    });
    const l = await list(1);
    await funnel(
      "res",
      body({ entries: [{ id: "list", kind: "sourced", source: l.source, to: "booked" }] }),
    );
    const flows = await flowsOf("res");
    const { r, calls } = stub();
    const w = rig(r);

    const pass = await sourcedPass(pg.db, null, {}, NOW);
    const fire = pass.fires.find(
      (f) => f.facts.trigger === "trigger.source" && f.facts.source === l.source,
    );
    if (!fire) throw new Error("no fire");
    await hear(w, flows, fire);
    await hear(w, flows, fire);

    expect(calls.light).toHaveLength(1);
    expect(calls.full).toHaveLength(0);
    expect(calls.light[0]).toMatchObject({
      profile: l.profiles[0],
      stage: "booked",
      level: "light",
      offer: "offer-a",
      icp: { who: "Small firms" },
    });
    const rows = await pg.db.select().from(journeyResearch);
    const row = rows.find((x) => x.profileId === l.profiles[0]);
    expect(row).toMatchObject({ state: "read", level: "light", result: { role: "Partner" } });
    expect(row?.icp).toEqual({ who: "Small firms" });
  });

  it("starts a full run once, and a repeat after a failed start starts it", async () => {
    const l = await list(1);
    await funnel("full", body());
    const [j] = await pg.db
      .insert(journeys)
      .values({
        profileId: l.profiles[0] as number,
        funnel: "full",
        version: 1,
        stage: "booked",
        entry: "mail",
      })
      .returning();
    if (!j) throw new Error("no journey");
    const ask: ResearchAsk = {
      client: null,
      profile: j.profileId,
      journey: j.id,
      stage: "booked",
      level: "full",
      offer: "offer-a",
      icp: null,
    };
    let fail = true;
    const { r, calls } = stub({
      async full(a) {
        calls.full.push(a);
        if (fail) throw new Error("ingress down");
        return { state: "started", lookupId: 7 };
      },
    });
    // The first start fails: the journey goes on, the row waits as queued.
    expect(await requestResearch(pg.db, r, ask, NOW)).toBe("full");
    expect(
      (await pg.db.select().from(journeyResearch).where(eq(journeyResearch.journey, j.id)))[0]
        ?.state,
    ).toBe("queued");
    // A repeat of the step starts it.
    fail = false;
    expect(await requestResearch(pg.db, r, ask, NOW)).toBe("full");
    const [row] = await pg.db
      .select()
      .from(journeyResearch)
      .where(eq(journeyResearch.journey, j.id));
    expect(row).toMatchObject({ state: "started", lookupId: 7 });
    // Another repeat asks nothing.
    expect(await requestResearch(pg.db, r, ask, NOW)).toBe("none");
    expect(calls.full).toHaveLength(2);
  });
});

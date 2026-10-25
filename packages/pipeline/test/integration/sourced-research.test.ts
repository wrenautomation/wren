/**
 * Sourced sources and node research, on a real Postgres (designs/2026-10-19-business-map.md): the
 * generated shape workflows walk with the real store and steps, no Restate. One shape, saved once
 * with the lists these tests make. Synthetic data only.
 */
import { randomUUID } from "node:crypto";
import { type Fired, hearersOf, pgExecutorStore, type Walk, walk } from "@wren/core/executor";
import { resolveProfile } from "@wren/core/profiles";
import { companies, imports, people } from "@wren/core/schema";
import type { Workflow } from "@wren/core/workflows";
import { startTestPostgres, type TestPostgres } from "@wren/db/testing";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { shapeWorkflowsOf } from "../../src/journeys.js";
import type { ShapeBody } from "../../src/model.js";
import { journeyRecord } from "../../src/records.js";
import {
  type ResearchAsk,
  type Researcher,
  refineFit,
  requestResearch,
} from "../../src/research.js";
import { journeyResearch, journeys, offerVersions } from "../../src/schema.js";
import { sourcedPass } from "../../src/sourced.js";
import { journeySteps } from "../../src/steps.js";
import { Refused, saveShape } from "../../src/store.js";
import { asMetro, flow, TRIGGERS } from "../fixtures.js";

let pg: TestPostgres;
/** The lists the shape names: two that open at the first node, one that opens at the research node. */
let lists: { first: Made; unkeyed: Made; research: Made };

beforeAll(async () => {
  pg = await startTestPostgres();
  await pg.db.insert(offerVersions).values({
    offer: "offer-a",
    number: 1,
    hash: "2".repeat(64),
    body: { icp: { who: "Small firms" } } as never,
    why: "t",
    createdBy: "t",
  });
  lists = { first: await list(2), unkeyed: await list(1), research: await list(1) };
  await saveShape(pg.db, {
    body: asMetro(body(lists)),
    note: "first",
    by: "t",
    triggers: TRIGGERS,
  });
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

const body = (l: typeof lists): ShapeBody => ({
  name: "Test shape",
  nodes: [
    { id: "mail", kind: "source", name: "Email", via: "outbound", channel: "email" },
    { id: "first", kind: "source", name: "First list", via: "sourced", source: l.first.source },
    { id: "unkeyed", kind: "source", name: "Other list", via: "sourced", source: l.unkeyed.source },
    { id: "deep", kind: "source", name: "Deep list", via: "sourced", source: l.research.source },
    {
      id: "engaged",
      kind: "step",
      name: "Engaged",
      action: "reply",
      advance: [{ trigger: "trigger.reply" }],
    },
    {
      id: "booked",
      kind: "step",
      name: "Booked",
      action: "book",
      research: "light",
      advance: [{ trigger: "trigger.booking" }],
    },
    {
      id: "signed",
      kind: "offer",
      name: "Signed",
      offer: "offer-a",
      advance: [{ trigger: "trigger.document" }],
    },
  ],
  edges: [
    flow("mail", "engaged"),
    flow("first", "engaged"),
    flow("unkeyed", "engaged"),
    flow("deep", "booked"),
    flow("engaged", "booked"),
    flow("booked", "signed"),
  ],
});

type Made = Awaited<ReturnType<typeof list>>;

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
    store: pgExecutorStore(pg.db),
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

const flowsOf = () => shapeWorkflowsOf(pg.db, "wren");

describe("a sourced source", () => {
  it("opens a journey once for a person added to its list", async () => {
    const l = lists.first;
    const flows = await flowsOf();
    const w = rig();

    const first = await sourcedPass(pg.db, null, {}, NOW);
    const mine = first.fires.filter(
      (f) => f.facts.trigger === "trigger.source" && f.facts.source === l.source,
    );
    expect(mine).toHaveLength(2);
    expect(first.cursors[l.source]).toBe(l.ids[1]);
    for (const f of mine) await hear(w, flows, f);
    // The same fire again, as a replay would send it: nothing new.
    for (const f of mine) await hear(w, flows, f);

    const opened = (await pg.db.select().from(journeys)).filter((j) =>
      l.profiles.includes(j.profileId),
    );
    expect(opened.map((j) => j.profileId).sort()).toEqual([...l.profiles].sort());
    expect(opened.every((j) => j.entry === "first" && j.node === "engaged")).toBe(true);
    expect(opened.every((j) => j.version === 1)).toBe(true);
    const ref = opened[0]?.entryRef as Record<string, unknown>;
    expect(ref.source).toBe(l.source);
    expect((ref.cause as { kind: string }).kind).toBe("sourced");
    expect(ref.row).toBeDefined();

    // The next pass reads past the cursor: nothing until someone new is added.
    const second = await sourcedPass(pg.db, null, first.cursors, NOW);
    expect(second.fires).toEqual([]);
  });

  it("reads only lists the shape names, and skips a member with no profile", async () => {
    const other = await list(1);
    const none = await sourcedPass(pg.db, null, {}, NOW);
    expect(
      none.fires.some(
        (f) => f.facts.trigger === "trigger.source" && f.facts.source === other.source,
      ),
    ).toBe(false);
    const l = lists.unkeyed;
    await pg.db.insert(people).values({
      companyId: (await pg.db.select().from(companies).limit(1))[0]?.id ?? 0,
      fullName: "No Profile",
      isCompliance: false,
      origin: "manual",
      originRef: "test",
      raw: {},
      importId: l.batch,
    });
    const got = await sourcedPass(pg.db, null, {}, NOW);
    const mine = got.fires.filter(
      (f) => f.facts.trigger === "trigger.source" && f.facts.source === l.source,
    );
    expect(mine).toHaveLength(1);
    expect(got.unkeyed).toBeGreaterThanOrEqual(1);
  });
});

describe("node research", () => {
  it("asks once on arrival at a light node, against the offer's icp, and a replay asks nothing", async () => {
    const l = lists.research;
    const flows = await flowsOf();
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
    const [j] = await pg.db
      .insert(journeys)
      .values({
        profileId: l.profiles[0] as number,
        version: 1,
        node: "booked",
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

describe("ICP fit in the light read", () => {
  const icp = { who: "Small firms", industries: ["dental"], not: ["Large chain"] };
  const traits = { industries: ["Dental practice"], about: ["Industry: dental practice"] };

  async function journeyAsk(): Promise<ResearchAsk> {
    const l = await list(1);
    const [j] = await pg.db
      .insert(journeys)
      .values({ profileId: l.profiles[0] as number, version: 1, node: "booked", entry: "mail" })
      .returning();
    if (!j) throw new Error("no journey");
    return {
      client: null,
      profile: j.profileId,
      journey: j.id,
      stage: "booked",
      level: "light",
      offer: "offer-a",
      icp,
    };
  }
  const resultOf = async (journey: string) =>
    (await pg.db.select().from(journeyResearch).where(eq(journeyResearch.journey, journey)))[0]
      ?.result as { fit?: { score: number; reasons: string[]; unknown: string[] } } | null;

  it("stores the code score with the read, and a model fills in the plain-word rules after", async () => {
    const ask = await journeyAsk();
    const model = { complete: vi.fn(async () => ({ text: '{"who": "yes", "not": ["no"]}' })) };
    const { r } = stub({ model, light: async () => ({ traits }) });

    expect(await requestResearch(pg.db, r, ask, NOW)).toBe("light");
    // The industry is checked in code; who and not wait for the model.
    await vi.waitFor(async () => {
      expect((await resultOf(ask.journey))?.fit).toMatchObject({ score: 100, unknown: [] });
    });
    const fit = (await resultOf(ask.journey))?.fit;
    expect(fit?.reasons).toContain("Industry fits: Dental practice.");
    expect(fit?.reasons).toContain("Clear of: Large chain.");
    expect(model.complete).toHaveBeenCalledTimes(1);

    // The record's detail shows it, with the node's name.
    const detail = await journeyRecord().load?.(pg.db, ask.journey);
    expect(detail).toMatchObject({ fit: { score: 100, node: "booked" } });
    // A repeat of the step scores nothing again.
    expect(await requestResearch(pg.db, r, ask, NOW)).toBe("none");
    expect(model.complete).toHaveBeenCalledTimes(1);
  });

  it("keeps the code score, and says why, when the model fails", async () => {
    const ask = await journeyAsk();
    const down = {
      complete: async () => {
        throw new Error("gateway down");
      },
    };
    const { r } = stub({ light: async () => ({ traits }) });
    expect(await requestResearch(pg.db, r, ask, NOW)).toBe("light");
    // Without a model on the researcher the code score alone is stored.
    expect((await resultOf(ask.journey))?.fit).toMatchObject({ score: 100 });
    expect((await resultOf(ask.journey))?.fit?.unknown).toEqual(["who", "not: Large chain"]);

    const fit = await refineFit(pg.db, down, ask, icp, traits);
    expect(fit?.score).toBe(100);
    expect(fit?.reasons[0]).toMatch(/^The model check failed \(gateway down\)/);
    expect((await resultOf(ask.journey))?.fit?.reasons[0]).toMatch(/^The model check failed/);
  });

  it("scores nothing when the offer has no icp", async () => {
    const ask = { ...(await journeyAsk()), icp: null };
    const { r } = stub({ light: async () => ({ traits }) });
    await requestResearch(pg.db, r, ask, NOW);
    expect((await resultOf(ask.journey))?.fit).toBeUndefined();
    expect(await journeyRecord().load?.(pg.db, ask.journey)).toMatchObject({ fit: null });
  });
});

describe("a sourced list in a saved shape", () => {
  it("is refused when its list does not exist, and saved when it does", async () => {
    const at = (source: string): ShapeBody => {
      const b = body(lists);
      return {
        ...b,
        nodes: [
          ...b.nodes,
          { id: "late", kind: "source", name: "Late list", via: "sourced", source },
        ],
        edges: [...b.edges, flow("late", "engaged")],
      };
    };
    const ask = (b: ShapeBody) => ({ body: asMetro(b), note: "t", by: "t", triggers: TRIGGERS });
    await expect(saveShape(pg.db, ask(at("import:999999")))).rejects.toThrow(Refused);
    const l = await list(1);
    await expect(saveShape(pg.db, ask(at(l.source)))).resolves.toMatchObject({ number: 2 });
  });
});

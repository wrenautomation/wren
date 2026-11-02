/**
 * Branches end to end on a real Postgres (designs/2026-11-02-campaigns.md, phase 4): a split's
 * tracks move one by one, a join holds the next station until its rule is met, a race arm taken
 * by hand is named as won, and a rebuild from the events gives the same row. Synthetic data only.
 */
import { randomUUID } from "node:crypto";
import { type Fired, pgExecutorStore, type Walk, walk } from "@wren/core/executor";
import { resolveProfile } from "@wren/core/profiles";
import { events } from "@wren/core/schema";
import type { Workflow } from "@wren/core/workflows";
import { startTestPostgres, type TestPostgres } from "@wren/db/testing";
import { and, asc, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { shapeWorkflowsOf } from "../../src/journeys.js";
import type { ShapeBody, ShapeEdge, ShapeNode } from "../../src/model.js";
import { type Emit, moveEmit, openEmit, rebuildJourney } from "../../src/moves.js";
import { instances } from "../../src/schema.js";
import { journeySteps } from "../../src/steps.js";
import { Refused } from "../../src/store.js";
import { seedGraph } from "../fixtures.js";

let pg: TestPostgres;
beforeAll(async () => {
  pg = await startTestPostgres();
});
afterAll(() => pg.stop());

const OP = "op@example.test";
const step = (id: string): ShapeNode => ({
  id,
  kind: "step",
  name: id,
  action: "reply",
  advance: [{ trigger: "trigger.reply" }],
});
const edge = (from: string, to: string, over: Partial<ShapeEdge> = {}): ShapeEdge => ({
  id: `${from}_to_${to}`,
  from,
  to,
  kind: "flow",
  ...over,
});

/** Onboarding, then a race: no reply in 3 days goes to `nudge`. */
const body = (): ShapeBody => ({
  name: "Branches",
  nodes: [
    { id: "mail", kind: "source", name: "Email", via: "outbound", channel: "email" },
    ...["won", "signed", "paid", "intake", "kickoff", "sent", "replied", "nudge"].map(step),
  ],
  gates: [
    { id: "f", kind: "split" },
    { id: "j", kind: "join", rule: "all" },
    { id: "r", kind: "race" },
  ],
  edges: [
    edge("mail", "won"),
    edge("won", "f"),
    edge("f", "signed"),
    edge("f", "paid"),
    edge("f", "intake"),
    edge("signed", "j"),
    edge("paid", "j"),
    edge("intake", "j"),
    edge("j", "kickoff"),
    edge("kickoff", "sent"),
    edge("sent", "r"),
    edge("r", "replied", { cond: "a reply" }),
    edge("r", "nudge", { wait: "3 days" }),
  ],
});

async function play(e: Emit) {
  const fired: Fired[] = [];
  const flows: Workflow[] = await shapeWorkflowsOf(pg.db, "wren");
  const w: Walk = {
    flows: new Map(flows.map((f) => [f.id, f])),
    parts: new Map(),
    steps: journeySteps({ db: () => pg.db }),
    store: pgExecutorStore(pg.db),
    client: null,
    by: randomUUID(),
    run: (_name, fn) => fn(),
    later: () => {},
    rule: async () => true,
    fire: (req) => fired.push(req),
  };
  await walk(w, e.workflow, e.from, e.events);
}

const row = async (id: string) =>
  (await pg.db.select().from(instances).where(eq(instances.id, id)))[0];
const move = async (journey: string, to: string) =>
  play(await moveEmit(pg.db, { journey, to, by: OP }));
const refused = (p: Promise<unknown>) =>
  p.then(
    () => [] as string[],
    (e: unknown) => (e instanceof Refused ? e.errors : [String(e)]),
  );
const at = (bs: Array<{ key: string; node: string }>) => bs.map((b) => `${b.key}@${b.node}`).sort();

describe("a journey with branches", () => {
  it("splits, joins all, wins a race by hand and rebuilds the same", async () => {
    await seedGraph(pg.db, body());
    const r = await resolveProfile(pg.db, [{ kind: "email", value: "a@example.test" }], "test", {
      name: "Ada",
    });
    if (!r) throw new Error("no profile");
    await play(await openEmit(pg.db, { person: "a@example.test", by: OP }));
    const [j] = await pg.db.select().from(instances).where(eq(instances.profileId, r.id));
    const id = j?.id as string;
    expect(j).toMatchObject({ node: "won", branches: [] });

    // A kickoff before the join holds: refused without a reason.
    expect(await refused(moveEmit(pg.db, { journey: id, to: "kickoff", by: OP }))).toEqual([
      "No path from won to kickoff. Give a reason to force the move.",
    ]);

    await move(id, "paid");
    expect(at((await row(id))?.branches ?? [])).toEqual([
      "f_to_intake@f",
      "f_to_signed@f",
      "main@paid",
    ]);
    await move(id, "signed");
    await move(id, "intake");
    const three = await row(id);
    expect(three?.node).toBe("intake");
    expect(three?.trail.at(-1)).toMatchObject({ edge: "f_to_intake", branch: "f_to_intake" });

    await move(id, "kickoff");
    expect(await row(id)).toMatchObject({ node: "kickoff", branches: [], status: "open" });

    // The race: the wait arm is the clock's alone; a reply by hand wins the cond arm.
    await move(id, "sent");
    expect(await refused(moveEmit(pg.db, { journey: id, to: "nudge", by: OP }))).toHaveLength(1);
    await move(id, "replied");
    expect(await row(id)).toMatchObject({ node: "replied", status: "done" });
    const [last] = await pg.db
      .select({ data: events.data })
      .from(events)
      .where(and(eq(events.subject, `journey:${id}`), eq(events.node, "s_replied")))
      .orderBy(asc(events.at));
    expect(last?.data).toMatchObject({ won: [{ gate: "r", arm: "r_to_replied" }] });

    // Gates are crossings on the trail, never arrivals.
    const stages = await pg.db
      .select({ node: events.node })
      .from(events)
      .where(and(eq(events.subject, `journey:${id}`)));
    expect(stages.map((s) => s.node)).not.toContain("s_f");

    expect(await rebuildJourney(pg.db, id)).toMatchObject({ changed: false });
  });
});

import { describe, expect, it } from "vitest";
import {
  funnelIdOf,
  funnelOf,
  isDefaultPipeline,
  type OldDeal,
  type OldMove,
  type OldPipeline,
  planJourney,
  stageKeys,
} from "./fold.js";
import { checkFunnel } from "./model.js";

const DEFAULT: OldPipeline = {
  id: "00000000-0000-4000-8000-000000000001",
  name: "Sales",
  stages: [
    { key: "new", label: "New", kind: "open" },
    { key: "contacted", label: "Contacted", kind: "open" },
    { key: "booked", label: "Booked", kind: "open" },
    { key: "quoted", label: "Quoted", kind: "open" },
    { key: "won", label: "Won", kind: "won" },
    { key: "lost", label: "Lost", kind: "lost" },
  ],
};

const at = (n: number) => new Date(Date.UTC(2026, 0, n));
const deal = (over: Partial<OldDeal> = {}): OldDeal => ({
  id: "00000000-0000-4000-8000-0000000000d1",
  pipeline: DEFAULT.id,
  stage: "new",
  status: "open",
  name: "Test deal",
  valueCents: null,
  currency: "usd",
  contactName: null,
  contactEmail: null,
  contactPhone: null,
  source: "manual",
  sourceRef: null,
  owner: null,
  note: null,
  nextOn: null,
  movedAt: at(1),
  closedAt: null,
  createdAt: at(1),
  createdBy: "t",
  ...over,
});
const move = (from: string | null, to: string, day: number): OldMove => ({
  deal: "00000000-0000-4000-8000-0000000000d1",
  from,
  to,
  at: at(day),
  by: "t",
});

describe("funnelIdOf", () => {
  it("makes a slug", () => {
    expect(funnelIdOf("Partner Deals!", new Set())).toBe("partner-deals");
  });
  it("starts with a letter", () => {
    expect(funnelIdOf("2026 plan", new Set())).toBe("p-2026-plan");
    expect(funnelIdOf("!!!", new Set())).toBe("pipeline");
  });
  it("keeps to 40 characters, and numbers a clash", () => {
    const long = funnelIdOf("a".repeat(80), new Set());
    expect(long.length).toBeLessThanOrEqual(40);
    expect(funnelIdOf("Sales", new Set(["sales"]))).toBe("sales-2");
    expect(funnelIdOf("Sales", new Set(["sales", "sales-2"]))).toBe("sales-3");
    expect(funnelIdOf("a".repeat(80), new Set([long]))).toMatch(/-2$/);
  });
});

describe("stageKeys", () => {
  const s = (key: string) => ({ key, label: key, kind: "open" as const });
  it("keeps a good key", () => {
    expect([...stageKeys([s("new"), s("call_2")]).values()]).toEqual(["new", "call_2"]);
  });
  it("fixes a bad key and the reserved one, never repeating", () => {
    const m = stageKeys([s("2nd"), s("dropped"), s("a-b"), s("a_b")]);
    expect(m.get("2nd")).toBe("s_2nd");
    expect(m.get("dropped")).toBe("dropped_stage");
    expect(m.get("a-b")).toBe("a_b");
    expect(m.get("a_b")).toBe("a_b_2");
  });
});

describe("funnelOf", () => {
  it("drops the lost stage and marks the won stage as the sale", () => {
    const m = funnelOf(DEFAULT, "offer-a");
    if (typeof m === "string") throw new Error(m);
    expect(m.body.stages.map((x) => x.key)).toEqual([
      "new",
      "contacted",
      "booked",
      "quoted",
      "won",
    ]);
    expect(m.body.stages.filter((x) => x.sale).map((x) => x.key)).toEqual(["won"]);
    expect(m.sale).toBe("won");
    expect(m.keys.has("lost")).toBe(false);
    expect(m.body.entries).toEqual([{ id: "manual", kind: "manual" }]);
    const ctx = {
      id: "sales",
      triggers: new Set<string>(),
      funnel: () => undefined,
      group: () => undefined,
      source: () => undefined,
      feeds: {},
    };
    expect(checkFunnel(null, m.body, ctx as never)).toEqual([]);
  });
  it("says why a pipeline cannot fold", () => {
    const none = { ...DEFAULT, stages: DEFAULT.stages.filter((x) => x.kind !== "won") };
    expect(funnelOf(none, "offer-a")).toMatch(/no won stage/);
  });
});

describe("isDefaultPipeline", () => {
  it("knows the old default, and only that", () => {
    expect(isDefaultPipeline(DEFAULT)).toBe(true);
    expect(isDefaultPipeline({ ...DEFAULT, name: "Other" })).toBe(false);
    expect(isDefaultPipeline({ ...DEFAULT, stages: DEFAULT.stages.slice(1) })).toBe(false);
  });
});

describe("planJourney", () => {
  const m = funnelOf(DEFAULT, "offer-a");
  if (typeof m === "string") throw new Error(m);
  const plan = (d: OldDeal, moves: OldMove[]) => {
    const p = planJourney(d, moves, DEFAULT, m);
    if (typeof p === "string") throw new Error(p);
    return p;
  };

  it("walks a deal through its moves", () => {
    const p = plan(deal({ stage: "booked", movedAt: at(3), createdAt: at(1) }), [
      move(null, "new", 1),
      move("new", "contacted", 2),
      move("contacted", "booked", 3),
    ]);
    expect(p.arrivals.map((a) => [a.from, a.to])).toEqual([
      [null, "new"],
      ["new", "contacted"],
      ["contacted", "booked"],
    ]);
    expect(p).toMatchObject({ stage: "booked", status: "open", reason: null, sale: null });
    expect(p.movedAt).toEqual(at(3));
    expect(p.warnings).toEqual([]);
  });

  it("marks the sale and, at the last stage, done", () => {
    const p = plan(deal({ stage: "won", status: "won", movedAt: at(4) }), [
      move(null, "new", 1),
      move("new", "won", 4),
    ]);
    expect(p).toMatchObject({ stage: "won", status: "done", closedAt: at(4) });
    expect(p.sale).toEqual(at(4));
  });

  it("drops a lost deal with the lost stage as the reason", () => {
    const p = plan(deal({ stage: "lost", status: "lost", closedAt: at(5), movedAt: at(5) }), [
      move(null, "new", 1),
      move("new", "contacted", 2),
      move("contacted", "lost", 5),
    ]);
    expect(p).toMatchObject({ stage: "contacted", status: "dropped", reason: "Lost" });
    expect(p.dropped).toEqual({ at: at(5), stage: "contacted", reason: "Lost" });
    expect(p.arrivals.map((a) => a.to)).toEqual(["new", "contacted"]);
    expect(p.closedAt).toEqual(at(5));
  });

  it("opens a deal born lost at the first stage", () => {
    const p = plan(deal({ stage: "lost", status: "lost", closedAt: at(2), movedAt: at(2) }), [
      move(null, "lost", 2),
    ]);
    expect(p.arrivals.map((a) => a.to)).toEqual(["new"]);
    expect(p).toMatchObject({ stage: "new", status: "dropped" });
  });

  it("makes an arrival for a deal with no moves", () => {
    const p = plan(deal({ stage: "contacted", movedAt: at(2) }), []);
    expect(p.arrivals.map((a) => [a.to, a.at])).toEqual([["contacted", at(1)]]);
    expect(p.stage).toBe("contacted");
  });

  it("keeps the first visit of a stage and says so", () => {
    const p = plan(deal({ stage: "contacted", movedAt: at(4) }), [
      move(null, "new", 1),
      move("new", "booked", 2),
      move("booked", "contacted", 4),
    ]);
    expect(p.arrivals.map((a) => a.to)).toEqual(["new", "booked", "contacted"]);
    const back = plan(deal({ stage: "new", movedAt: at(4) }), [
      move(null, "new", 1),
      move("new", "booked", 2),
      move("booked", "new", 4),
    ]);
    expect(back.stage).toBe("new");
    expect(back.warnings.join(" ")).toMatch(/Moved back to "New"/);
  });

  it("refuses a deal in a stage its pipeline lacks", () => {
    expect(planJourney(deal({ stage: "ghost" }), [], DEFAULT, m)).toMatch(/ghost/);
  });
});

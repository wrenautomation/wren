import { describe, expect, it } from "vitest";
import {
  COOL_MS,
  healthOf,
  type Incident,
  type LoopHealth,
  type LoopView,
  MAX_RESTARTS,
  noticesOf,
  type OpenCall,
  planWatch,
  RESTART_EVERY_MS,
} from "./loop-watch.js";

const T0 = Date.parse("2026-01-02T12:00:00.000Z");
const at = (min: number) => new Date(T0 + min * 60_000);
const iso = (min: number) => at(min).toISOString();

const view = (o: Partial<LoopView> = {}): LoopView => ({
  service: "Tick",
  key: "k",
  running: true,
  lastAt: iso(-5),
  failures: 0,
  error: null,
  nextAt: null,
  delayMs: 10 * 60_000,
  timeouts: [],
  open: [],
  waitsOn: [],
  ...o,
});
const call = (status: string, movedMin: number, target = "Tick/k/loop"): OpenCall => ({
  id: `inv_${status}${movedMin}`.replace(/-/g, "m"),
  target,
  status,
  movedAt: iso(movedMin),
});

describe("healthOf", () => {
  it("alive: a pass queued, a pass running, or between passes", () => {
    expect(healthOf(view({ nextAt: iso(5) }), at(0)).health).toBe("alive");
    expect(healthOf(view({ open: [call("running", -2)] }), at(0)).health).toBe("alive");
    // Last pass 5 min ago, next due in 5: between passes even with no call seen.
    expect(healthOf(view(), at(0)).health).toBe("alive");
    // Only queued calls: Restate is about to run one.
    expect(healthOf(view({ open: [call("pending", -1)] }), at(0)).health).toBe("alive");
  });

  it("stopped: running false, whatever else", () => {
    expect(healthOf(view({ running: false, lastAt: iso(-600) }), at(0)).health).toBe("stopped");
  });

  it("dead: running, nothing queued, the next pass overdue past the grace", () => {
    // Due at +5 min; grace 10: dead after +15.
    expect(healthOf(view(), at(14)).health).toBe("alive");
    const h = healthOf(view(), at(16));
    expect(h).toMatchObject({ health: "dead", id: "Tick/k" });
    expect(h.why).toContain("due 11 min ago");
    expect(healthOf(view({ lastAt: null, delayMs: null }), at(0)).health).toBe("dead");
  });

  it("stuck: the pass waits on a paused call, or nothing moved past the stall limit", () => {
    const paused = call("paused", -1, "Content/publish");
    const h = healthOf(view({ open: [call("suspended", -1)], waitsOn: [paused] }), at(0));
    expect(h).toMatchObject({ health: "stuck", blocker: paused });
    expect(h.why).toContain("Content/publish, paused");
    const quiet = healthOf(
      view({ open: [call("suspended", -50)], waitsOn: [call("running", -46, "desk/call")] }),
      at(0),
    );
    expect(quiet).toMatchObject({ health: "stuck", blocker: { target: "desk/call" } });
    // Under the limit, or a loop with a longer one: alive.
    expect(healthOf(view({ open: [call("suspended", -40)] }), at(0)).health).toBe("alive");
    expect(
      healthOf(view({ service: "ReachWatch", open: [call("suspended", -70)] }), at(0)).health,
    ).toBe("alive");
  });
});

const sick = (health: LoopHealth["health"], o: Partial<LoopHealth> = {}): LoopHealth => ({
  id: "Tick/k",
  service: "Tick",
  key: "k",
  health,
  why: health,
  blocker: null,
  lastAt: null,
  nextAt: null,
  timeouts: [],
  ...o,
});

/** Runs checks at the given minutes; returns each plan and the incidents left. */
function checks(seq: [number, LoopHealth["health"]][]) {
  let incidents: Record<string, Incident> = {};
  return seq.map(([min, h]) => {
    const plan = planWatch([sick(h)], incidents, at(min));
    incidents = plan.incidents;
    return plan;
  });
}

describe("planWatch", () => {
  it("leaves alive and stopped loops alone", () => {
    const plan = planWatch([sick("alive"), sick("stopped", { id: "S/x" })], {}, at(0));
    expect(plan).toEqual({ restart: [], opened: [], gaveUp: [], incidents: {} });
  });

  it("dead: restarts once and tells once; a second check soon after waits", () => {
    const [first, second] = checks([
      [0, "dead"],
      [10, "dead"],
    ]);
    expect(first?.restart).toEqual([{ service: "Tick", key: "k" }]);
    expect(noticesOf(first as never)).toMatchObject([{ title: "1 loop had stopped: woken" }]);
    expect(second?.restart).toEqual([]);
    expect(second?.opened).toEqual([]);
    expect(second?.incidents["Tick/k"]?.restarts).toBe(1);
  });

  it("flapping: woken again quietly inside one incident, then one give-up", () => {
    const step = RESTART_EVERY_MS / 60_000;
    const seq: [number, LoopHealth["health"]][] = [];
    for (let i = 0; i <= MAX_RESTARTS + 1; i++) {
      seq.push([i * step * 2, "dead"], [i * step * 2 + step, "alive"]);
    }
    const plans = checks(seq);
    const notices = plans.flatMap((p) => noticesOf(p));
    expect(plans.flatMap((p) => p.restart)).toHaveLength(MAX_RESTARTS);
    expect(notices.map((n) => n.title)).toEqual([
      "1 loop had stopped: woken",
      "1 loop keeps stopping: watchdog gave up",
    ]);
    // Given up: no more wakes, no more notices.
    expect(plans.at(-2)?.restart).toEqual([]);
  });

  it("closes an incident after an hour healthy; a later stop is a new one", () => {
    const cool = COOL_MS / 60_000;
    const plans = checks([
      [0, "dead"],
      [10, "alive"],
      [10 + cool - 1, "alive"],
      [10 + cool, "alive"],
      [20 + cool, "dead"],
    ]);
    expect(plans[2]?.incidents["Tick/k"]).toBeDefined();
    expect(plans[3]?.incidents).toEqual({});
    expect(plans[4]?.opened).toHaveLength(1);
    expect(plans[4]?.restart).toHaveLength(1);
  });

  it("stuck: told once with its blocker, never woken", () => {
    const blocker = call("paused", -1, "Content/publish");
    let incidents: Record<string, Incident> = {};
    const titles: string[] = [];
    for (const min of [0, 10, 20]) {
      const plan = planWatch([sick("stuck", { blocker, why: "waits" })], incidents, at(min));
      expect(plan.restart).toEqual([]);
      for (const o of plan.opened) o.letter = 7;
      titles.push(...noticesOf(plan).map((n) => `${n.title} | ${n.body.split("\n")[0]}`));
      incidents = plan.incidents;
    }
    expect(titles).toEqual(["1 loop stuck behind a call | Tick/k: waits (dead letter #7)"]);
  });

  it("a stopped loop ends its incident", () => {
    const [, stopped] = checks([
      [0, "stuck"],
      [10, "stopped"],
    ]);
    expect(stopped?.incidents).toEqual({});
  });
});

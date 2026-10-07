import { describe, expect, it } from "vitest";
import { EVENT_KINDS } from "./components.js";
import {
  bucketOf,
  casesOf,
  holdOf,
  KINDS,
  LOGIC,
  logicOf,
  logicProblems,
  logicSteps,
  shareOf,
  startWith,
} from "./logic.js";
import type { SpineEvent, StepAt } from "./spine.js";

const at = (node: string, w: Record<string, string | number>): StepAt => ({
  client: null,
  workflow: "f",
  node,
  with: w,
});
const ev = (subject: string, data: Record<string, unknown> = {}): SpineEvent => ({
  subject,
  kind: "lead",
  data,
});

describe("logic parts", () => {
  it("knows every event kind, and each part has an id, a name and ports", () => {
    expect([...KINDS].sort()).toEqual(Object.keys(EVENT_KINDS).sort());
    expect(new Set(LOGIC.map((l) => l.id)).size).toBe(LOGIC.length);
    for (const l of LOGIC) expect(l.ports(startWith(l)).out.length).toBeGreaterThan(0);
  });

  it("gives Switch a port per case and Split its shares", () => {
    expect(casesOf("Booked, Not now, booked, other,")).toEqual([
      { id: "booked", label: "Booked" },
      { id: "not_now", label: "Not now" },
    ]);
    const sw = logicOf("logic.switch")?.ports({ cases: "Booked, Not now", kind: "reply" });
    expect(sw?.out.map((p) => [p.id, p.kind])).toEqual([
      ["booked", "reply"],
      ["not_now", "reply"],
      ["other", "reply"],
    ]);
    expect(
      logicOf("logic.split")
        ?.ports({ a: 20 })
        .out.map((p) => p.label),
    ).toEqual(["A 20%", "B 80%"]);
    expect([shareOf(0), shareOf("x"), shareOf(99)]).toEqual([50, 50, 99]);
  });

  it("says what won't run", () => {
    const n = (uses: string, w: Record<string, string | number> = {}) =>
      logicProblems("f.n", { id: "n", uses, with: w });
    expect(n("logic.if")).toEqual(["f.n: If needs a rule"]);
    expect(n("logic.if", { when: "asked about price", kind: "lead" })).toEqual([]);
    expect(n("logic.switch", { field: "stage", cases: "" })).toEqual([
      "f.n: Switch reads a field like data.stage",
      "f.n: Switch needs a case",
    ]);
    expect(n("logic.wait", { for: "soon" })).toEqual(['f.n: a wait reads like "2 days"']);
    expect(n("logic.split", { a: 120 })).toEqual(["f.n: Split's share is 1 to 99"]);
    expect(n("trigger.schedule")).toEqual(["f.n: Schedule triggers are in development"]);
    expect(n("logic.merge", { kind: "nope" })).toEqual(["f.n: nope is no event kind"]);
    expect(n("x.part")).toEqual([]);
    expect(holdOf({ id: "w", uses: "logic.wait", with: {} })).toBe("1 day");
    expect(holdOf({ id: "w", uses: "logic.if" })).toBeUndefined();
  });
});

describe("logic steps", () => {
  const steps = logicSteps(async (when) => when === "yes please");

  it("If asks the rule; Switch reads its field", async () => {
    expect(
      (await steps["logic.if"]?.("in", ev("a"), at("n", { when: "yes please" })))?.[0]?.port,
    ).toBe("yes");
    expect((await steps["logic.if"]?.("in", ev("a"), at("n", { when: "no" })))?.[0]?.port).toBe(
      "no",
    );
    const sw = at("n", { field: "data.stage", cases: "Booked, Not now" });
    expect(
      (await steps["logic.switch"]?.("in", ev("a", { stage: "not now" }), sw))?.[0]?.port,
    ).toBe("not_now");
    expect((await steps["logic.switch"]?.("in", ev("a", { stage: "lost" }), sw))?.[0]?.port).toBe(
      "other",
    );
  });

  it("Split sends a subject the same way every time, near its share", async () => {
    expect(bucketOf("lead:1", "ab")).toBe(bucketOf("lead:1", "ab"));
    let a = 0;
    for (let i = 0; i < 1000; i++) {
      const out = await steps["logic.split"]?.("in", ev(`lead:${i}`), at("ab", { a: 30 }));
      if (out?.[0]?.port === "a") a++;
    }
    expect(a).toBeGreaterThan(240);
    expect(a).toBeLessThan(360);
  });
});

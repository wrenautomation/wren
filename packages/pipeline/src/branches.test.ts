import { describe, expect, it } from "vitest";
import { shape } from "../test/fixtures.js";
import {
  type Branch,
  branchesOf,
  forceBranches,
  MAIN,
  moveBranches,
  opensBranch,
  racesAfter,
  storedOf,
} from "./branches.js";
import { type Gate, pathOf, type ShapeBody, type ShapeNode } from "./model.js";

const step = (id: string): ShapeNode =>
  ({ id, kind: "step", name: id, action: "email", advance: [] }) as unknown as ShapeNode;

/** A body from `a>b` pairs; `a>b:3 days` is a wait arm, `a>b?` a cond arm. */
function body(nodes: string[], gates: Gate[], links: string[]): ShapeBody {
  return {
    name: "Case",
    nodes: nodes.map(step),
    gates,
    edges: links.map((l) => {
      const [pair = "", wait] = l.split(":");
      const cond = pair.endsWith("?");
      const [from = "", to = ""] = pair.replace("?", "").split(">");
      return {
        id: `${from}_to_${to}`,
        from,
        to,
        kind: "flow" as const,
        ...(wait ? { wait } : {}),
        ...(cond ? { cond: "an event" } : {}),
      };
    }),
  };
}

const main = (node: string): Branch[] => [{ key: MAIN, node }];
const at = (bs: Branch[] | undefined) => (bs ?? []).map((b) => `${b.key}@${b.node}`).sort();

describe("proposal follow-up: a race", () => {
  const b = body(
    ["sent", "replied", "follow"],
    [{ id: "r", kind: "race" }],
    ["sent>r", "r>replied?", "r>follow:3 days"],
  );

  it("a reply takes the cond arm and wins the race", () => {
    const m = moveBranches(b, main("sent"), "replied");
    expect(m).toMatchObject({ edges: ["sent_to_r", "r_to_replied"], skipped: [] });
    expect(m?.won).toEqual([{ gate: "r", arm: "r_to_replied" }]);
  });

  it("only the clock takes the wait arm, and only from the station before the race", () => {
    expect(moveBranches(b, main("sent"), "follow")).toBeNull();
    const clock = { gate: "r", branch: MAIN };
    expect(moveBranches(b, main("sent"), "follow", { clock })?.won).toEqual([]);
    expect(moveBranches(b, main("replied"), "follow", { clock })).toBeNull();
    expect(racesAfter(b, "sent").map((g) => g.id)).toEqual(["r"]);
  });
});

describe("onboarding: split, then join all", () => {
  const b = body(
    ["won", "signed", "paid", "intake", "kickoff"],
    [
      { id: "f", kind: "split" },
      { id: "j", kind: "join", rule: "all" },
    ],
    ["won>f", "f>signed", "f>paid", "f>intake", "signed>j", "paid>j", "intake>j", "j>kickoff"],
  );

  it("each event moves its own branch, in any order; kickoff waits for all three", () => {
    const one = moveBranches(b, main("won"), "paid");
    expect(at(one?.branches)).toEqual(["f_to_intake@f", "f_to_signed@f", "main@paid"]);
    expect(one?.skipped).toEqual([]);
    expect(moveBranches(b, one?.branches ?? [], "kickoff")).toBeNull();
    const two = moveBranches(b, one?.branches ?? [], "signed");
    expect(two).toMatchObject({ branch: "f_to_signed", from: "f", edges: ["f_to_signed"] });
    const three = moveBranches(b, two?.branches ?? [], "intake");
    expect(moveBranches(b, two?.branches ?? [], "kickoff")).toBeNull();
    const done = moveBranches(b, three?.branches ?? [], "kickoff", { front: "f_to_intake" });
    expect(done?.branch).toBe("f_to_intake");
    expect(done?.closed.sort()).toEqual(["f_to_signed", "main"]);
    expect(at(done?.branches)).toEqual(["f_to_intake@kickoff"]);
    expect(storedOf(done?.branches ?? [])).toEqual([]);
  });

  it("a kickoff moved early by hand closes the branches behind it", () => {
    const one = moveBranches(b, main("won"), "paid");
    const f = forceBranches(b, one?.branches ?? [], "kickoff", MAIN);
    expect(f.closed.sort()).toEqual(["f_to_intake", "f_to_signed"]);
    expect(at(f.branches)).toEqual(["main@kickoff"]);
  });
});

describe("sales-ready: join 2 of 3", () => {
  const b = body(
    ["lead", "guide", "webinar", "pricing", "call"],
    [
      { id: "f", kind: "split" },
      { id: "j", kind: "join", rule: "2 of 3" },
    ],
    ["lead>f", "f>guide", "f>webinar", "f>pricing", "guide>j", "webinar>j", "pricing>j", "j>call"],
  );

  it("the second signal meets the rule; the third branch closes", () => {
    const one = moveBranches(b, main("lead"), "guide");
    expect(moveBranches(b, one?.branches ?? [], "call")).toBeNull();
    const two = moveBranches(b, one?.branches ?? [], "pricing");
    const done = moveBranches(b, two?.branches ?? [], "call", { front: "f_to_pricing" });
    expect(done?.closed.sort()).toEqual(["f_to_webinar", "main"]);
    expect(at(done?.branches)).toEqual(["f_to_pricing@call"]);
  });
});

describe("nested split", () => {
  const b = body(
    ["a", "b", "c", "d", "e", "g", "h"],
    [
      { id: "s1", kind: "split" },
      { id: "s2", kind: "split" },
      { id: "j2", kind: "join", rule: "all" },
      { id: "j1", kind: "join", rule: "all" },
    ],
    [
      "a>s1",
      "s1>b",
      "s1>c",
      "b>s2",
      "s2>d",
      "s2>e",
      "d>j2",
      "e>j2",
      "j2>g",
      "g>j1",
      "c>j1",
      "j1>h",
    ],
  );

  it("an inner join never closes the outer split's branch", () => {
    let bs = moveBranches(b, main("a"), "d")?.branches ?? [];
    expect(at(bs)).toEqual(["main@d", "s1_to_c@s1", "s2_to_e@s2"]);
    bs = moveBranches(b, bs, "e")?.branches ?? [];
    const inner = moveBranches(b, bs, "g", { front: MAIN });
    expect(inner?.closed).toEqual(["s2_to_e"]);
    expect(at(inner?.branches)).toEqual(["main@g", "s1_to_c@s1"]);
    expect(moveBranches(b, inner?.branches ?? [], "h")).toBeNull();
    const c = moveBranches(b, inner?.branches ?? [], "c")?.branches ?? [];
    expect(at(moveBranches(b, c, "h")?.branches)).toEqual(["main@h"]);
  });

  it("never crosses a split twice", () => {
    const bs = moveBranches(b, main("a"), "d")?.branches ?? [];
    const back: Branch[] = [...bs, { key: "other", node: "a" }];
    expect(moveBranches(b, back, "b", { front: "other" })).toBeNull();
  });
});

describe("two campaigns", () => {
  const b: ShapeBody = {
    ...body(["guide", "read", "webinar", "attended"], [], ["guide>read", "webinar>attended"]),
    campaigns: { webinar: "webinar", attended: "webinar" },
  };

  it("a cause in a campaign with no branch opens one; a second one does not", () => {
    expect(moveBranches(b, main("read"), "webinar")).toBeNull();
    expect(opensBranch(b, main("read"), "webinar")).toBe(true);
    const two: Branch[] = [...main("read"), { key: "webinar", node: "webinar" }];
    expect(opensBranch(b, two, "attended")).toBe(false);
    expect(at(moveBranches(b, two, "attended")?.branches)).toEqual([
      "main@read",
      "webinar@attended",
    ]);
    expect(opensBranch(b, main("guide"), "read")).toBe(false);
  });
});

describe("a body with no logic", () => {
  it("moves as pathOf does, and stores nothing", () => {
    const b = shape();
    const nodes = b.nodes.map((n) => n.id);
    for (const from of nodes)
      for (const to of nodes) {
        const m = moveBranches(b, branchesOf([], from), to);
        expect(m?.edges ?? null).toEqual(pathOf(b, from, to, { loops: false }));
        if (m) expect(storedOf(m.branches)).toEqual([]);
      }
  });
});

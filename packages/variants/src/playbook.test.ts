import { describe, expect, it } from "vitest";
import {
  type ContentType,
  provenChanges,
  provenId,
  provenLines,
  provenPrefix,
  reachOf,
  typesOf,
} from "./playbook.js";

const TYPES: ContentType[] = [
  { type: "short-video", kind: "video", sets: ["hooks"] },
  { type: "long-video", kind: "video", sets: [] },
  { type: "thread", kind: "text", sets: [] },
];

type Have = Map<string, { fm: Record<string, unknown>; body: string }>;
/** a change set applied the way the store would, enough for the next run */
const applied = (have: Have, cs: ReturnType<typeof provenChanges>): Have => {
  const next = new Map(have);
  for (const c of cs) {
    if (c.op === "retire") continue;
    const { op, body, ...fm } = c as Record<string, unknown>;
    const cur = op === "add" ? { fm: { status: "live" }, body: "" } : next.get(fm.id as string);
    next.set(fm.id as string, {
      fm: { ...cur?.fm, ...fm },
      body: (body as string | undefined) ?? cur?.body ?? "",
    });
  }
  return next;
};

describe("content playbook", () => {
  it("reads the type table and refuses a set the guide does not cite", () => {
    expect(
      typesOf({ types: [{ type: "thread", kind: "text", sets: ["a"] }], cites: ["a"] }),
    ).toEqual([{ type: "thread", kind: "text", sets: ["a"] }]);
    expect(() =>
      typesOf({ types: [{ type: "thread", kind: "text", sets: ["a"] }], cites: [] }),
    ).toThrow(/cite it/);
    expect(() => typesOf({ types: [{ type: "thread", kind: "sound", sets: [] }] })).toThrow(/kind/);
    expect(typesOf(null)).toEqual([]);
  });

  it("reaches the subject's type, the kind's types, or all", () => {
    expect(reachOf({ subjectId: 1, kind: null }, "thread", TYPES)).toEqual(["thread"]);
    expect(reachOf({ subjectId: 1, kind: null }, null, TYPES)).toEqual([]);
    expect(reachOf({ subjectId: null, kind: "video" }, null, TYPES)).toEqual([
      "short-video",
      "long-video",
    ]);
    expect(reachOf({ subjectId: null, kind: null }, null, TYPES)).toHaveLength(3);
  });

  it("names prefixes from the type", () => {
    expect(provenPrefix("short-video")).toBe("PSV");
    expect(provenPrefix("thread")).toBe("PTH");
  });

  it("lock → line, rerun no-op, unlock drops the line, a new lock never reuses its id", () => {
    const tip = {
      verdict: "lead-with-a-number-g1",
      text: "Lead with\none number",
      reach: ["thread"],
    };
    const add = provenChanges(new Map(), TYPES, [tip]);
    expect(add).toMatchObject([
      {
        op: "add",
        type: "rule",
        id: provenId("thread"),
        prefix: "PTH",
        last: 1,
        cites: [tip.verdict],
      },
    ]);
    let have = applied(new Map(), add);
    expect(provenLines(have.get(provenId("thread"))?.body ?? "")).toEqual([
      { id: "PTH-1", n: 1, text: "Lead with one number", verdict: tip.verdict },
    ]);
    expect(provenChanges(have, TYPES, [tip])).toEqual([]);

    const dropped = provenChanges(have, TYPES, []);
    expect(dropped).toHaveLength(1);
    have = applied(have, dropped);
    expect(provenLines(have.get(provenId("thread"))?.body ?? "")).toEqual([]);
    expect(have.get(provenId("thread"))?.fm.cites).toEqual([tip.verdict]);

    const next = { ...tip, verdict: "name-the-place-g2", text: "Name the place" };
    have = applied(have, provenChanges(have, TYPES, [next]));
    expect(provenLines(have.get(provenId("thread"))?.body ?? "")).toMatchObject([{ id: "PTH-2" }]);
  });
});

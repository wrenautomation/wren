import { describe, expect, it } from "vitest";
import { ctx, metroShape, wideShape } from "../test/fixtures.js";
import { lowerable, metroOf } from "./convert.js";
import { canonicalJson } from "./diff.js";
import { checkMetro, type MetroBody } from "./metro.js";
import { diffMetro, metroChangeLine, metroChangesOf } from "./metro-diff.js";
import {
  applyOp,
  applyOps,
  editMetro,
  type MetroOp,
  MetroOpSchema,
  opsJsonSchema,
  parseOps,
} from "./metro-ops.js";
import { Refused } from "./refused.js";

const json = (b: unknown): string => canonicalJson(b);

/** The reasons a call is refused. Fails when it is not refused. */
const refusal = (f: () => unknown): string[] => {
  try {
    f();
  } catch (e) {
    if (e instanceof Refused) return e.errors;
    throw e;
  }
  throw new Error("was not refused");
};

/** Ops from outside (parsed) applied as one batch to a fresh metro shape. */
const run = (ops: unknown, body: MetroBody = metroShape()): MetroBody =>
  applyOps(body, parseOps(ops));

const station = (b: MetroBody, id: string) => b.stations.find((s) => s.id === id);
const group = (b: MetroBody, id: string) => b.groups.find((g) => g.id === id);

const NEW_STATION = {
  id: "extra_step",
  label: "Extra step",
  kind: "att",
  line: "growth",
  column: "sales",
  action: "other",
};

describe("parseOps", () => {
  it("takes one op or a list", () => {
    const op = { op: "rename", on: "shape", name: "New" };
    expect(parseOps(op)).toEqual([op]);
    expect(parseOps([op, op])).toHaveLength(2);
  });

  it("refuses a bad envelope with the op number", () => {
    const errors = refusal(() =>
      parseOps([
        { op: "rename", on: "line", id: "growth" },
        { op: "nope", on: "line" },
        5,
        { op: "remove", on: "frame", id: "stop" },
        { op: "remove", on: "line", id: "growth", extra: 1 },
      ]),
    );
    expect(errors.every((e) => /^Op [1-5]: /.test(e))).toBe(true);
    expect(errors.some((e) => e.startsWith("Op 1: label"))).toBe(true);
    expect(errors.some((e) => e.startsWith("Op 2: op must be one of"))).toBe(true);
    expect(errors.some((e) => e.startsWith("Op 3: "))).toBe(true);
    expect(errors.some((e) => e.startsWith("Op 4: on"))).toBe(true);
    expect(errors.some((e) => e.startsWith("Op 5: "))).toBe(true);
  });

  it("refuses an empty list", () => {
    expect(refusal(() => parseOps([]))).toEqual(["Send at least one op."]);
  });

  it("refuses a field that does not belong to the op", () => {
    const bad = (op: unknown) => refusal(() => parseOps(op))[0];
    expect(bad({ op: "move", on: "track", id: "x", line: "growth" })).toContain(
      "does not take line",
    );
    expect(bad({ op: "move", on: "line", id: "growth" })).toContain("needs before");
    expect(bad({ op: "move", on: "group", id: "closing" })).toContain("needs a line");
    expect(bad({ op: "rename", on: "shape", name: "A", id: "x" })).toContain("does not take an id");
    expect(bad({ op: "rename", on: "line", id: "x", label: "A", name: "B" })).toContain("label");
    expect(bad({ op: "set", on: "station", id: "reply", field: "idleDays" })).toContain("value");
  });

  it("opsJsonSchema is a JSON object that survives a round trip", () => {
    const schema = opsJsonSchema();
    expect(typeof schema).toBe("object");
    expect(schema.type).toBe("object");
    expect(JSON.parse(JSON.stringify(schema))).toEqual(schema);
    expect(JSON.stringify(schema)).toContain("The id of the item.");
    expect(MetroOpSchema.safeParse({ op: "remove", on: "track", id: "x" }).success).toBe(true);
  });
});

describe("add", () => {
  it("adds a line, a station, a track and a group at the end of their lists", () => {
    const before = metroShape();
    const b = run([
      { op: "add", on: "line", item: { id: "extra", label: "Extra", tier: "front", colour: 3 } },
      { op: "add", on: "station", item: NEW_STATION },
      {
        op: "add",
        on: "track",
        item: { id: "prep_to_extra", from: "prep", to: "extra_step", line: "growth", by: "system" },
      },
      {
        op: "add",
        on: "group",
        item: { id: "tail", label: "Tail", line: "growth", stations: ["extra_step"] },
      },
    ]);
    expect(b.lines.at(-1)?.id).toBe("extra");
    expect(b.stations.at(-1)?.id).toBe("extra_step");
    expect(b.tracks.at(-1)?.id).toBe("prep_to_extra");
    expect(b.groups.at(-1)?.id).toBe("tail");
    expect(json(before)).toBe(json(metroShape()));
  });

  it("does not keep the item object it was given", () => {
    const item = { ...NEW_STATION };
    const b = run({ op: "add", on: "station", item });
    expect(station(b, "extra_step")).not.toBe(item);
  });

  it("refuses a taken id, the hub id, the dropped id and a missing id", () => {
    const one = (item: unknown) => refusal(() => run({ op: "add", on: "station", item }))[0];
    expect(one({ ...NEW_STATION, id: "reply" })).toContain('There is already a station "reply".');
    expect(one({ ...NEW_STATION, id: "hub" })).toContain("reserved");
    expect(one({ ...NEW_STATION, id: "dropped" })).toContain("reserved");
    expect(one({ label: "No id" })).toContain("needs an id");
    expect(
      refusal(() =>
        run({ op: "add", on: "line", item: { id: "growth", label: "X", tier: "front" } }),
      )[0],
    ).toContain('There is already a line "growth".');
  });

  it("lets a line and a station share an id (ids are unique within a kind)", () => {
    const b = run({ op: "add", on: "line", item: { id: "prep", label: "Prep", tier: "front" } });
    expect(b.lines.some((l) => l.id === "prep")).toBe(true);
  });

  it("checks the body at the end, so a join station may come before its tracks", () => {
    const join = {
      id: "j2",
      label: "Both ready",
      kind: "join",
      line: "growth",
      column: "sales",
      rule: "all",
    };
    const track = (from: string) => ({
      op: "add",
      on: "track",
      item: { id: `${from}_to_j2`, from, to: "j2", line: "growth", by: "system" },
    });
    const after = run([{ op: "add", on: "station", item: join }, track("prep"), track("docs")]);
    expect(after.tracks.filter((t) => t.to === "j2")).toHaveLength(2);
    // A track before the station it ends at also passes: only the structure is checked.
    expect(run([track("prep"), { op: "add", on: "station", item: join }]).stations).toContainEqual(
      join,
    );
  });

  it("refuses a body that is not a metro body in structure", () => {
    const errors = refusal(() =>
      run({ op: "add", on: "station", item: { ...NEW_STATION, bogus: 1 } }),
    );
    expect(errors.join(" ")).toContain("bogus is not a field");
  });
});

describe("rename", () => {
  it("renames a line, a station and a group, and trims the label", () => {
    const b = run([
      { op: "rename", on: "line", id: "growth", label: "  Growth plan  " },
      { op: "rename", on: "station", id: "reply", label: "Answer" },
      { op: "rename", on: "group", id: "closing", label: "Close" },
    ]);
    expect(b.lines.find((l) => l.id === "growth")?.label).toBe("Growth plan");
    expect(station(b, "reply")?.label).toBe("Answer");
    expect(group(b, "closing")?.label).toBe("Close");
  });

  it("renames the shape", () => {
    expect(run({ op: "rename", on: "shape", name: " Better " }).name).toBe("Better");
  });

  it("refuses an empty or long label, an empty name and an unknown id", () => {
    const one = (op: unknown) => refusal(() => run(op))[0];
    expect(one({ op: "rename", on: "line", id: "growth", label: "   " })).toContain("1 to 80");
    expect(one({ op: "rename", on: "station", id: "reply", label: "x".repeat(81) })).toContain(
      "1 to 80",
    );
    expect(one({ op: "rename", on: "shape", name: "" })).toContain("1 to 80");
    expect(one({ op: "rename", on: "group", id: "nope", label: "A" })).toBe(
      'Op 1: There is no group "nope".',
    );
    expect(run({ op: "rename", on: "station", id: "reply", label: "x".repeat(80) })).toBeTruthy();
  });
});

describe("move", () => {
  it("moves a station to another line and column", () => {
    const b = run({ op: "move", on: "station", id: "prep", line: "retain", column: "money" });
    expect(station(b, "prep")).toMatchObject({ line: "retain", column: "money" });
  });

  it("moves a station into a group at the end, out of its old group", () => {
    const b = run([
      { op: "move", on: "station", id: "prep", group: "closing" },
      { op: "move", on: "station", id: "proposal", group: null },
    ]);
    expect(group(b, "closing")?.stations).toEqual(["signed", "prep"]);
  });

  it("moves a station from one group to another", () => {
    const b = run([
      {
        op: "add",
        on: "group",
        item: { id: "prepping", label: "Prepping", line: "growth", stations: ["prep"] },
      },
      { op: "move", on: "station", id: "signed", group: "prepping" },
    ]);
    expect(group(b, "prepping")?.stations).toEqual(["prep", "signed"]);
    expect(group(b, "closing")?.stations).toEqual(["proposal"]);
  });

  it("leaves a member where it is when it joins its own group", () => {
    const b = run({ op: "move", on: "station", id: "proposal", group: "closing" });
    expect(group(b, "closing")?.stations).toEqual(["proposal", "signed"]);
  });

  it("refuses the hub, no fields, and unknown line, column, group and station", () => {
    const one = (op: unknown) => refusal(() => applyOp(metroShape(), op as MetroOp));
    expect(one({ op: "move", on: "station", id: "hub", column: "sales" })).toEqual([
      "The hub does not move.",
    ]);
    expect(one({ op: "move", on: "station", id: "prep" })[0]).toContain(
      "needs line, column or group",
    );
    expect(one({ op: "move", on: "station", id: "prep", line: "nope" })).toEqual([
      'There is no line "nope".',
    ]);
    expect(one({ op: "move", on: "station", id: "prep", column: "left" })[0]).toContain("Column");
    expect(one({ op: "move", on: "station", id: "prep", group: "nope" })).toEqual([
      'There is no group "nope".',
    ]);
    expect(one({ op: "move", on: "station", id: "nope", line: "growth" })).toEqual([
      'There is no station "nope".',
    ]);
    expect(one({ op: "move", on: "station", id: "prep", line: "x", group: "y" })).toHaveLength(2);
  });

  it("moves the ends of a track", () => {
    const b = run({ op: "move", on: "track", id: "prep_to_merge", from: "docs", to: "review" });
    expect(b.tracks.find((t) => t.id === "prep_to_merge")).toMatchObject({
      from: "docs",
      to: "review",
    });
    const one = run({ op: "move", on: "track", id: "prep_to_merge", to: "review" });
    expect(one.tracks.find((t) => t.id === "prep_to_merge")).toMatchObject({
      from: "prep",
      to: "review",
    });
  });

  it("refuses a track move with no ends, an unknown track and an unknown station", () => {
    const one = (op: unknown) => refusal(() => applyOp(metroShape(), op as MetroOp));
    expect(one({ op: "move", on: "track", id: "prep_to_merge" })[0]).toContain("needs from or to");
    expect(one({ op: "move", on: "track", id: "nope", to: "review" })).toEqual([
      'There is no track "nope".',
    ]);
    expect(one({ op: "move", on: "track", id: "prep_to_merge", from: "a", to: "b" })).toEqual([
      'There is no station "a".',
      'There is no station "b".',
    ]);
  });

  it("moves a group to another line", () => {
    const b = run({ op: "move", on: "group", id: "closing", line: "retain" });
    expect(group(b, "closing")?.line).toBe("retain");
    expect(
      refusal(() => run({ op: "move", on: "group", id: "closing", line: "nope" }))[0],
    ).toContain('There is no line "nope".');
    expect(
      refusal(() => run({ op: "move", on: "group", id: "nope", line: "growth" }))[0],
    ).toContain('There is no group "nope".');
  });

  it("moves a line before another line, or last", () => {
    const ids = (b: MetroBody) => b.lines.map((l) => l.id);
    expect(ids(run({ op: "move", on: "line", id: "retain", before: "social" }))).toEqual([
      "retain",
      "social",
      "cold",
      "list",
      "team",
      "nurture",
      "growth",
    ]);
    expect(ids(run({ op: "move", on: "line", id: "social", before: null }))).toEqual([
      "cold",
      "list",
      "team",
      "nurture",
      "growth",
      "retain",
      "social",
    ]);
    const one = (op: unknown) => refusal(() => run(op))[0];
    expect(one({ op: "move", on: "line", id: "social", before: "social" })).toContain("itself");
    expect(one({ op: "move", on: "line", id: "social", before: "nope" })).toContain('"nope"');
    expect(one({ op: "move", on: "line", id: "nope", before: null })).toContain('"nope"');
  });
});

describe("remove", () => {
  it("removes a station with its tracks, its place in a group and in a frame", () => {
    const b = run({ op: "remove", on: "station", id: "pitch_a" });
    expect(station(b, "pitch_a")).toBeUndefined();
    expect(b.tracks.some((t) => t.from === "pitch_a" || t.to === "pitch_a")).toBe(false);
    expect(b.frames[0]?.stations).toEqual(["pitch_b"]);
    const g = run({ op: "remove", on: "station", id: "proposal" });
    expect(group(g, "closing")?.stations).toEqual(["signed"]);
  });

  it("drops a group and a frame left empty, and a frame that exits there", () => {
    const b = run([
      { op: "remove", on: "station", id: "proposal" },
      { op: "remove", on: "station", id: "signed" },
      { op: "remove", on: "station", id: "gone" },
    ]);
    expect(b.groups).toEqual([]);
    expect(b.frames).toEqual([]);
  });

  it("refuses to remove the hub", () => {
    expect(refusal(() => run({ op: "remove", on: "station", id: "hub" }))).toEqual([
      "Op 1: The hub cannot be removed.",
    ]);
  });

  it("removes a line that holds nothing", () => {
    const b = run([
      { op: "add", on: "line", item: { id: "extra", label: "Extra", tier: "front" } },
      { op: "remove", on: "line", id: "extra" },
    ]);
    expect(b.lines).toEqual(metroShape().lines);
  });

  it("refuses a line that still holds things, one reason each", () => {
    const errors = refusal(() => run({ op: "remove", on: "line", id: "retain" }));
    expect(errors.every((e) => e.startsWith("Op 1: Line Retain still holds "))).toBe(true);
    expect(errors.some((e) => e.includes("station Retain start"))).toBe(true);
    expect(errors.some((e) => e.includes("track Retain start to Retainer"))).toBe(true);
    const growth = refusal(() => run({ op: "remove", on: "line", id: "growth" }));
    expect(growth.some((e) => e.includes("group Closing"))).toBe(true);
    expect(growth.some((e) => e.includes("station Nudge of flow Follow-up flow"))).toBe(true);
  });

  it("refuses a line a track names in entries", () => {
    const errors = refusal(() => run({ op: "remove", on: "line", id: "team" }));
    expect(errors.some((e) => e.includes("station Team"))).toBe(true);
    const entries = refusal(() => run({ op: "remove", on: "line", id: "cold" }));
    expect(entries.some((e) => e.includes("which names it in entries"))).toBe(true);
  });

  it("removes a track and a group", () => {
    const b = run([
      { op: "remove", on: "track", id: "renew" },
      { op: "remove", on: "group", id: "closing" },
    ]);
    expect(b.tracks.some((t) => t.id === "renew")).toBe(false);
    expect(b.groups).toEqual([]);
  });

  it("refuses an unknown id for every kind", () => {
    for (const on of ["line", "station", "track", "group"]) {
      expect(refusal(() => run({ op: "remove", on, id: "nope" }))).toEqual([
        `Op 1: There is no ${on} "nope".`,
      ]);
    }
  });
});

describe("set", () => {
  it("sets the value it is given and keeps the rest", () => {
    const b = run([
      { op: "set", on: "line", id: "growth", field: "colour", value: 4 },
      { op: "set", on: "station", id: "reply", field: "idleDays", value: 9 },
      { op: "set", on: "track", id: "renew", field: "label", value: "after 60 days" },
    ]);
    expect(b.lines.find((l) => l.id === "growth")?.colour).toBe(4);
    expect(station(b, "reply")).toMatchObject({ idleDays: 9, research: "light" });
    expect(b.tracks.find((t) => t.id === "renew")?.label).toBe("after 60 days");
  });

  it("removes the field when the value is null", () => {
    const b = run({ op: "set", on: "station", id: "reply", field: "idleDays", value: null });
    expect(station(b, "reply")).not.toHaveProperty("idleDays");
    expect(station(b, "reply")?.research).toBe("light");
  });

  it.each([
    ["line", "label"],
    ["line", "attach"],
    ["station", "label"],
    ["station", "attach"],
    ["station", "line"],
    ["station", "column"],
    ["track", "from"],
    ["track", "to"],
    ["group", "label"],
    ["group", "attach"],
    ["group", "line"],
    ["group", "stations"],
    ["line", "id"],
    ["station", "id"],
    ["track", "id"],
    ["group", "id"],
  ])("refuses to set %s %s", (on, field) => {
    const id = { line: "growth", station: "reply", track: "renew", group: "closing" }[on];
    const errors = refusal(() => run({ op: "set", on, id, field, value: "x" }));
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(
      /^Op 1: (The id cannot be set\.|Field ".+" of a .+ has its own op: .+\.)$/,
    );
  });

  it("lets a track set its own label", () => {
    expect(
      run({ op: "set", on: "track", id: "renew", field: "label", value: "later" }),
    ).toBeTruthy();
  });

  it("leaves the typing to the body check", () => {
    expect(
      refusal(() =>
        run({ op: "set", on: "station", id: "reply", field: "idleDays", value: "9" }),
      ).join(" "),
    ).toContain("idleDays is a number");
    expect(
      refusal(() => run({ op: "set", on: "station", id: "reply", field: "bogus", value: 1 })).join(
        " ",
      ),
    ).toContain("bogus is not a field");
  });

  it("refuses an unknown id", () => {
    expect(
      refusal(() => run({ op: "set", on: "track", id: "nope", field: "cond", value: "x" })),
    ).toEqual(['Op 1: There is no track "nope".']);
  });
});

describe("attach and detach", () => {
  it("attaches to a line, a station and a group", () => {
    const b = run([
      { op: "attach", on: "line", id: "nurture", ref: { kind: "sop", ref: "nurture-playbook" } },
      { op: "attach", on: "station", id: "reply", ref: { kind: "doc", ref: "reply-doc" } },
      { op: "attach", on: "group", id: "closing", ref: { kind: "page", ref: "closing-page" } },
    ]);
    expect(b.lines.find((l) => l.id === "nurture")?.attach).toEqual([
      { kind: "sop", ref: "nurture-playbook" },
    ]);
    expect(station(b, "reply")?.attach?.at(-1)).toEqual({ kind: "doc", ref: "reply-doc" });
    expect(group(b, "closing")?.attach?.at(-1)).toEqual({ kind: "page", ref: "closing-page" });
  });

  it("refuses the same kind and ref twice, and a ref with no kind", () => {
    const dup = refusal(() =>
      run({
        op: "attach",
        on: "station",
        id: "reply",
        ref: { kind: "funnel", ref: "reply-funnel" },
      }),
    );
    expect(dup[0]).toContain('already has attach funnel "reply-funnel"');
    expect(
      refusal(() => run({ op: "attach", on: "station", id: "reply", ref: { ref: "x" } }))[0],
    ).toContain("needs a kind and a ref");
    // Same ref under another kind is a different attach.
    expect(
      run({ op: "attach", on: "station", id: "reply", ref: { kind: "doc", ref: "reply-funnel" } }),
    ).toBeTruthy();
  });

  it("detaches by ref, and drops an empty list", () => {
    const b = run([
      { op: "detach", on: "station", id: "reply", ref: "reply-funnel" },
      { op: "detach", on: "station", id: "reply", ref: "book-first/opener" },
    ]);
    expect(station(b, "reply")).not.toHaveProperty("attach");
    const line = run({ op: "detach", on: "line", id: "growth", ref: "growth-playbook" });
    expect(line.lines.find((l) => l.id === "growth")?.attach).toHaveLength(2);
    const one = run({ op: "detach", on: "group", id: "closing", ref: "closing-checklist" });
    expect(group(one, "closing")?.attach).toHaveLength(1);
  });

  it("refuses a detach with no such ref", () => {
    expect(refusal(() => run({ op: "detach", on: "line", id: "retain", ref: "x" }))[0]).toContain(
      'has no attach with ref "x"',
    );
    expect(refusal(() => run({ op: "detach", on: "station", id: "reply", ref: "x" }))[0]).toContain(
      'has no attach with ref "x"',
    );
  });

  it("refuses an unknown id", () => {
    expect(
      refusal(() => run({ op: "attach", on: "line", id: "nope", ref: { kind: "doc", ref: "x" } })),
    ).toEqual(['Op 1: There is no line "nope".']);
  });
});

describe("applyOp and applyOps", () => {
  it("never change their input", () => {
    const body = metroShape();
    const ops = parseOps([
      { op: "rename", on: "line", id: "growth", label: "Renamed" },
      { op: "move", on: "station", id: "prep", group: "closing" },
      { op: "remove", on: "station", id: "pitch_a" },
      { op: "set", on: "station", id: "reply", field: "idleDays", value: null },
      { op: "detach", on: "station", id: "reply", ref: "reply-funnel" },
      { op: "move", on: "line", id: "retain", before: "social" },
    ]);
    const frozen = json(body);
    applyOps(body, ops);
    expect(json(body)).toBe(frozen);
    expect(json(ops)).toBe(json(parseOps(ops)));
    applyOp(body, ops[0] as MetroOp);
    expect(json(body)).toBe(frozen);
  });

  it("is all or nothing, and names the op that failed", () => {
    const body = metroShape();
    const frozen = json(body);
    const errors = refusal(() =>
      run(
        [
          { op: "rename", on: "line", id: "growth", label: "Fine" },
          { op: "remove", on: "station", id: "nope" },
          { op: "rename", on: "station", id: "reply", label: "Also fine" },
        ],
        body,
      ),
    );
    expect(errors).toEqual(['Op 2: There is no station "nope".']);
    expect(json(body)).toBe(frozen);
  });

  it("reports every bad op", () => {
    const errors = refusal(() =>
      run([
        { op: "remove", on: "station", id: "nope" },
        { op: "rename", on: "line", id: "growth", label: "Fine" },
        { op: "remove", on: "station", id: "hub" },
      ]),
    );
    expect(errors).toEqual([
      'Op 1: There is no station "nope".',
      "Op 3: The hub cannot be removed.",
    ]);
  });

  it("sees the earlier ops of the batch", () => {
    const b = run([
      { op: "add", on: "line", item: { id: "extra", label: "Extra", tier: "front" } },
      { op: "move", on: "station", id: "prep", line: "extra" },
      { op: "rename", on: "line", id: "extra", label: "Renamed" },
    ]);
    expect(station(b, "prep")?.line).toBe("extra");
    expect(b.lines.at(-1)?.label).toBe("Renamed");
  });

  it("checks one op's result in structure", () => {
    const op = { op: "set", on: "station", id: "reply", field: "bogus", value: 1 } as MetroOp;
    expect(refusal(() => applyOp(metroShape(), op)).join(" ")).toContain("bogus is not a field");
  });
});

describe("editMetro", () => {
  it("turns a graph body into a metro body", () => {
    const wide = wideShape();
    const drawn = metroOf(wide);
    if (!drawn.ok) throw new Error(drawn.errors.join(" "));
    const view = drawn.body;
    const id = view.stations.find((s) => s.kind === "att")?.id as string;
    const out = editMetro(wide, { op: "rename", on: "station", id, label: "Renamed step" }, ctx());
    expect(out.body.model).toBe("metro");
    expect(out.body.stations.find((s) => s.id === id)?.label).toBe("Renamed step");
    expect(out.lines).toEqual(
      metroChangesOf(diffMetro(view, out.body)).map((c) => metroChangeLine(view, out.body, c)),
    );
    expect(out.lines).toHaveLength(1);
    expect(out.lines[0]).toContain("Renamed station");
  });

  it("answers the checks as warnings, not refusals", () => {
    const body = metroShape();
    const out = editMetro(
      body,
      [
        { op: "set", on: "station", id: "reply", field: "idleDays", value: 9999 },
        {
          op: "add",
          on: "station",
          item: { id: "stop", label: "Stop", kind: "exit", column: "sales" },
        },
      ],
      ctx(),
    );
    expect(out.warnings).toEqual([
      ...new Set([...checkMetro(out.body, ctx()), ...lowerable(out.body)]),
    ]);
    expect(out.warnings.some((w) => w.includes("idleDays"))).toBe(true);
    expect(out.warnings.some((w) => w.includes("The runtime does not run exits yet."))).toBe(true);
    // Without a context only `lowerable` speaks.
    const bare = editMetro(body, { op: "rename", on: "shape", name: "Other" });
    expect(bare.warnings).toEqual(lowerable(bare.body));
    expect(bare.lines).toEqual(["Shape renamed from Metro shape to Other."]);
  });

  it("lists each warning once", () => {
    const out = editMetro(metroShape(), { op: "rename", on: "shape", name: "Other" }, ctx());
    expect(new Set(out.warnings).size).toBe(out.warnings.length);
  });

  it("refuses a bad op, a bad envelope and a body that fails in structure", () => {
    expect(
      refusal(() => editMetro(metroShape(), { op: "remove", on: "station", id: "nope" })),
    ).toEqual(['Op 1: There is no station "nope".']);
    expect(refusal(() => editMetro(metroShape(), [{ op: "x" }]))[0]).toContain("Op 1: ");
  });

  it("leaves its input alone", () => {
    const wide = wideShape();
    const frozen = json(wide);
    editMetro(wide, { op: "rename", on: "shape", name: "Other" });
    expect(json(wide)).toBe(frozen);
  });
});

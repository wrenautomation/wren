import { TRIGGER_IDS } from "@wren/core/logic";
import { planConvert } from "@wren/pipeline/convert-shape";
import { exportShape } from "@wren/pipeline/shape-file";
import { diffStored, type StoredBody } from "@wren/pipeline/stored";
import { Command, InvalidArgumentError } from "commander";
import { describe, expect, it, vi } from "vitest";
import {
  advanceArg,
  blameLines,
  blameOnArg,
  convertLines,
  diffLines,
  draftLine,
  metroLines,
  mirrorLines,
  nodeFrom,
  registerShape,
  type ShapeDeps,
  shapeLines,
  storedDiffLines,
} from "./shape.js";

const none = (async () => {
  throw new Error("no database in this test");
}) as never;

const deps = (over: Partial<ShapeDeps> = {}): ShapeDeps => ({
  withDb: none,
  writes: undefined,
  mirror: async () => ({ off: true }),
  mirrorAll: async () => [],
  ...over,
});

const program = (over: Partial<ShapeDeps> = {}) => {
  const p = new Command("wren").exitOverride().configureOutput({ writeErr: () => {} });
  registerShape(p, deps(over));
  return p;
};
const names = (c: Command) => c.commands.map((x) => x.name());
const shapeCmd = (p: Command) => p.commands[0] as Command;

describe("arguments", () => {
  it("reads an advance spec with and without settings", () => {
    expect(advanceArg("trigger.booking")).toEqual({ trigger: "trigger.booking" });
    expect(advanceArg("trigger.touch:kind=reply,channel=email")).toEqual({
      trigger: "trigger.touch",
      with: { kind: "reply", channel: "email" },
    });
    for (const bad of ["", ":kind=reply", "trigger.touch:kind", "trigger.touch:=x"])
      expect(() => advanceArg(bad)).toThrow(InvalidArgumentError);
  });

  it("builds a node of each kind and refuses a missing field", () => {
    expect(
      nodeFrom("yt", { kind: "source", name: "YouTube", via: "organic", channel: "youtube" }),
    ).toEqual({ id: "yt", name: "YouTube", kind: "source", via: "organic", channel: "youtube" });
    expect(
      nodeFrom("call", {
        kind: "step",
        name: "Call",
        action: "call",
        idleDays: 5,
        advance: [{ trigger: "trigger.booking" }],
      }),
    ).toEqual({
      id: "call",
      name: "Call",
      kind: "step",
      action: "call",
      idleDays: 5,
      advance: [{ trigger: "trigger.booking" }],
    });
    expect(
      nodeFrom("o", { kind: "offer", name: "O", offer: "offer-a", research: "light" }),
    ).toEqual({
      id: "o",
      name: "O",
      kind: "offer",
      offer: "offer-a",
      research: "light",
      advance: [],
    });
    expect(nodeFrom("p", { kind: "plan", name: "P", terms: "standard", research: "none" })).toEqual(
      {
        id: "p",
        name: "P",
        kind: "plan",
        terms: "standard",
        advance: [],
      },
    );
    expect(() => nodeFrom("x", { kind: "source", name: "X" })).toThrow(/needs --via/);
    expect(() => nodeFrom("x", { kind: "step", name: "X", action: "dance" })).toThrow(/not one of/);
    expect(() => nodeFrom("x", { kind: "offer", name: "X" })).toThrow(/needs --offer/);
    expect(() => nodeFrom("x", { kind: "plan", name: "X" })).toThrow(/needs --terms/);
    expect(() => nodeFrom("x", { kind: "hub", name: "X" })).toThrow(/not one of source/);
  });
});

describe("text", () => {
  const body = {
    name: "Test shape",
    nodes: [
      { id: "yt", kind: "source", name: "YouTube", via: "organic" },
      { id: "booked", kind: "step", name: "Booked", action: "book", advance: [] },
    ],
    edges: [
      { id: "yt_to_booked", from: "yt", to: "booked", kind: "flow" },
      { id: "booked_loop_yt", from: "booked", to: "yt", kind: "loop", label: "again" },
    ],
  } as const;

  it("prints the outline: nodes by depth with open counts, then edges", () => {
    const lines = shapeLines(
      {
        number: 3,
        createdAt: new Date("2027-01-02T00:00:00Z"),
        createdBy: "ada",
        note: "why",
        body: body as never,
      },
      { yt: 0, booked: 1 },
      new Map([["booked", 2]]),
    );
    expect(lines[0]).toBe("Test shape  v3  2027-01-02  ada");
    expect(lines).toContain("  0  yt  source  YouTube  via organic");
    expect(lines).toContain("  1  booked  step  Booked  action book  open 2");
    expect(lines).toContain("  yt_to_booked  yt -> booked");
    expect(lines).toContain('  booked_loop_yt  booked -> yt  (loop)  "again"');
  });

  it("prints a diff a line per change", () => {
    expect(
      diffLines({
        nodes: {
          added: ["a"],
          removed: ["b"],
          renamed: [{ id: "c", from: "C", to: "D" }],
          changed: ["c"],
        },
        edges: { added: ["e1"], removed: ["e2"], changed: ["e3"] },
        name: { from: "X", to: "Y" },
      }),
    ).toEqual([
      "name: X -> Y",
      "+ node a",
      "- node b",
      "~ node c renamed: C -> D",
      "~ node c changed",
      "+ edge e1",
      "- edge e2",
      "~ edge e3 changed",
    ]);
  });
});

describe("history text", () => {
  it("ends each diff line in its change key when asked", () => {
    const d = {
      nodes: {
        added: ["a"],
        removed: ["b"],
        renamed: [{ id: "c", from: "C", to: "D" }],
        changed: ["c"],
      },
      edges: { added: ["e1"], removed: ["e2"], changed: ["e3"] },
      name: { from: "X", to: "Y" },
    };
    expect(diffLines(d, true)).toEqual([
      "name: X -> Y  [name]",
      "+ node a  [node:a:added]",
      "- node b  [node:b:removed]",
      "~ node c renamed: C -> D  [node:c:renamed]",
      "~ node c changed  [node:c:changed]",
      "+ edge e1  [edge:e1:added]",
      "- edge e2  [edge:e2:removed]",
      "~ edge e3 changed  [edge:e3:changed]",
    ]);
  });

  it("says what the mirror did, one line a commit", () => {
    expect(mirrorLines({ off: true })).toEqual(["mirror off"]);
    expect(mirrorLines({ committed: [{ version: 3, sha: "0123456789abcdef" }] })).toEqual([
      "mirrored v3 0123456",
    ]);
    expect(
      mirrorLines({
        committed: [
          { version: 1, sha: "aaaaaaaaaa" },
          { version: 2, sha: "bbbbbbbbbb" },
        ],
        failed: "v3: boom",
      }),
    ).toEqual(["mirrored v1 aaaaaaa", "mirrored v2 bbbbbbb", "mirror failed: v3: boom"]);
    expect(mirrorLines({ committed: [] })).toEqual([]);
  });

  it("prints a draft and a blame line", () => {
    expect(
      draftLine({
        id: "add-a-call",
        state: "proposed",
        base: 4,
        updatedAt: new Date("2027-02-03T10:00:00Z"),
        createdBy: "ada",
        name: "Add a call",
      }),
    ).toBe("add-a-call  proposed  v4  2027-02-03  ada  Add a call");
    expect(
      blameLines([
        { version: 5, at: "2027-02-04T00:00:00.000Z", by: "bo", how: "renamed", note: "clearer" },
      ]),
    ).toEqual(["v5  2027-02-04  bo  renamed  clearer"]);
  });
});

describe("commands", () => {
  it("registers the shape commands", () => {
    expect(names(program())).toEqual(["shape"]);
    expect(names(shapeCmd(program()))).toEqual([
      "show",
      "versions",
      "diff",
      "export",
      "convert",
      "import",
      "start",
      "add-node",
      "connect",
      "remove",
      "draft",
      "blame",
      "undo",
      "tag",
      "tags",
      "mirror",
      "move",
    ]);
    const draft = shapeCmd(program()).commands.find((c) => c.name() === "draft") as Command;
    expect(names(draft)).toEqual(["new", "list", "show", "propose", "apply", "drop"]);
  });

  it("needs --name on draft new, --reason on draft drop, and a known --state", async () => {
    await expect(
      program().parseAsync(["shape", "draft", "new", "f.yaml"], { from: "user" }),
    ).rejects.toThrow(/--name/);
    await expect(
      program().parseAsync(["shape", "draft", "drop", "d"], { from: "user" }),
    ).rejects.toThrow(/--reason/);
    await expect(
      program().parseAsync(["shape", "draft", "list", "--state", "later"], { from: "user" }),
    ).rejects.toThrow(/use one of draft, proposed, applied, dropped or all/);
  });

  it("reads versions of undo, tag and diff as whole numbers", async () => {
    await expect(
      program().parseAsync(["shape", "undo", "x", "2", "name"], { from: "user" }),
    ).rejects.toThrow(/whole number/);
    await expect(
      program().parseAsync(["shape", "tag", "stable", "0"], { from: "user" }),
    ).rejects.toThrow(/whole number/);
  });

  it("needs --note on add-node, connect and remove", async () => {
    await expect(
      program().parseAsync(["shape", "add-node", "x", "--kind", "step", "--name", "X"], {
        from: "user",
      }),
    ).rejects.toThrow(/--note/);
    await expect(
      program().parseAsync(["shape", "connect", "a", "b"], { from: "user" }),
    ).rejects.toThrow(/--note/);
    await expect(program().parseAsync(["shape", "remove", "a"], { from: "user" })).rejects.toThrow(
      /--note/,
    );
  });

  it("needs --kind and --name on add-node", async () => {
    await expect(
      program().parseAsync(["shape", "add-node", "x", "--note", "n"], { from: "user" }),
    ).rejects.toThrow(/--kind/);
  });

  it("refuses remove with both --move-to and --ghost, before it reads the database", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    process.exitCode = undefined;
    await program().parseAsync(
      ["shape", "remove", "a", "--note", "n", "--move-to", "b", "--ghost"],
      { from: "user" },
    );
    expect(err).toHaveBeenCalledWith("Use --move-to or --ghost, not both.");
    expect(process.exitCode).toBe(1);
    process.exitCode = undefined;
    err.mockRestore();
  });

  it("refuses add-node with a field its kind needs missing", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    process.exitCode = undefined;
    await program().parseAsync(
      ["shape", "add-node", "x", "--kind", "plan", "--name", "X", "--note", "n"],
      { from: "user" },
    );
    expect(err).toHaveBeenCalledWith("A plan node needs --terms.");
    process.exitCode = undefined;
    err.mockRestore();
  });

  it("sends shape move through the same worker call as journeys move", async () => {
    const seen: unknown[] = [];
    const ok = async (req: unknown) => {
      seen.push(req);
      return { ok: true };
    };
    const p = program({
      writes: {
        journeys: () => ({ open: ok, move: ok, drop: ok, assign: ok, rebuild: ok }),
        client: () => "c1",
      },
    });
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await p.parseAsync(["shape", "move", "j1", "won", "--reason", "by hand"], { from: "user" });
    log.mockRestore();
    expect(seen).toMatchObject([{ client: "c1", journey: "j1", to: "won", reason: "by hand" }]);
  });
});

describe("the metro model", () => {
  /** A graph that converts: a source, a booking step, and an offer. */
  const graph = {
    name: "Test shape",
    nodes: [
      { id: "yt", kind: "source", name: "YouTube", via: "organic" },
      {
        id: "booked",
        kind: "step",
        name: "Booked",
        action: "book",
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
      { id: "yt_to_booked", from: "yt", to: "booked", kind: "flow" },
      { id: "booked_to_signed", from: "booked", to: "signed", kind: "flow" },
    ],
  } as unknown as StoredBody;

  /** What the proofs read: triggers that exist, no groups, no sourced lists, journeys open. */
  const ctx = {
    triggers: TRIGGER_IDS,
    group: () => undefined,
    source: () => undefined,
  };
  const convertBody = (stored: StoredBody, open = new Map<string, number>()) =>
    planConvert(stored, 1, ctx, open);

  it("converts a graph to a metro body and proves it", () => {
    const c = convertBody(graph);
    expect(c.already).toBe(false);
    expect(c.body.model).toBe("metro");
    expect(exportShape(c.body).startsWith("model: metro")).toBe(true);
    if (c.already) return;
    expect(c.report).toMatchObject({
      notes: [],
      checks: [],
      graphEqual: true,
      workflowEqual: true,
    });
  });

  it("prints the report, with the deal rule and the open journeys it would move", () => {
    const c = convertBody(graph, new Map([["booked", 2]]));
    expect(convertLines(c)).toEqual([
      "notes: none",
      "checks: ok",
      "graph equal: yes",
      "workflow equal: yes",
      "deal rule signed: first station booked, deal station signed, " +
        "open before the deal station: 2 (booked 2)",
    ]);
  });

  it("keeps a metro body as it is, and says so", () => {
    const first = convertBody(graph);
    const again = convertBody(first.body);
    expect(again).toMatchObject({ already: true });
    expect(again.body).toBe(first.body);
    expect(convertLines(again)).toEqual(["The shape is on the metro model already."]);
  });

  it("refuses a graph that cannot convert, with the reason", () => {
    const bad = {
      name: "Bad",
      nodes: [
        { id: "yt", kind: "source", name: "YouTube", via: "organic" },
        { id: "hub", kind: "step", name: "Hub", action: "book", advance: [] },
      ],
      edges: [{ id: "yt_to_hub", from: "yt", to: "hub", kind: "flow" }],
    } as unknown as StoredBody;
    expect(() => convertBody(bad)).toThrow(/keeps the id "hub" for its hub/);
  });

  it("prints a metro body: lines, stations by place, tracks", () => {
    const { body } = convertBody(graph);
    const lines = metroLines(
      {
        number: 2,
        createdAt: new Date("2027-01-02T00:00:00Z"),
        createdBy: "ada",
        note: "why",
        body,
      },
      { yt: 0, hub: 1, booked: 2, signed: 3 },
      new Map([["booked", 2]]),
    );
    expect(lines[0]).toBe("Test shape  v2  2027-01-02  ada");
    expect(lines).toContain("lines");
    expect(lines).toContain("  yt  out  YouTube");
    expect(lines).toContain("  signed  core  Signed  offer offer-a");
    expect(lines).toContain("  2  booked  time  Booked  line signed  action book  open 2");
    expect(lines).toContain("  yt_to_hub  yt -> hub  line yt");
    expect(lines.indexOf("lines")).toBeLessThan(lines.indexOf("stations"));
    expect(lines.indexOf("stations")).toBeLessThan(lines.indexOf("tracks"));
  });

  it("shows a metro version through shapeLines", () => {
    const { body } = convertBody(graph);
    const lines = shapeLines(
      { number: 2, createdAt: new Date(0), createdBy: "ada", note: "why", body },
      {},
      new Map(),
    );
    expect(lines).toContain("stations");
    expect(lines).not.toContain("nodes");
  });

  it("prints a metro diff as sentences, and a graph diff as before", () => {
    const a = convertBody(graph).body;
    const b = {
      ...a,
      stations: a.stations.map((x) => (x.id === "booked" ? { ...x, label: "Call" } : x)),
    };
    expect(storedDiffLines(a, b, diffStored(a, b))).toEqual(["Renamed station Booked to Call."]);
    expect(storedDiffLines(a, b, diffStored(a, b), true)).toEqual([
      "Renamed station Booked to Call.  [station:booked:renamed]",
    ]);
    const g2 = {
      ...(graph as { name: string; nodes: unknown[]; edges: unknown[] }),
      name: "Other",
    } as unknown as StoredBody;
    expect(storedDiffLines(graph, g2, diffStored(graph, g2))).toEqual([
      "name: Test shape -> Other",
    ]);
  });

  it("reads --on as a kind, and refuses a stray word", () => {
    for (const ok of ["node", "edge", "line", "station", "track", "group", "frame"])
      expect(blameOnArg(ok)).toBe(ok);
    expect(() => blameOnArg("hub")).toThrow(InvalidArgumentError);
  });

  /** What `convert` reads from the database, in one piece. */
  const reads = (versions: { number: number; body: StoredBody }[]) =>
    (async () => ({ all: versions, ctx, open: new Map<string, number>() })) as never;

  it("prints a version as a metro file and the report, without --write, and writes nothing", async () => {
    const versions = [
      { number: 1, body: graph },
      { number: 2, body: graph },
    ];
    const write = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    process.exitCode = undefined;
    await program({ withDb: reads(versions) }).parseAsync(["shape", "convert", "--version", "1"], {
      from: "user",
    });
    const out = write.mock.calls.map((c) => String(c[0])).join("");
    const report = err.mock.calls.map((c) => String(c[0]));
    write.mockRestore();
    err.mockRestore();
    expect(out.startsWith("model: metro")).toBe(true);
    // The file is alone on stdout, so a pipe stays a file; the report is on stderr.
    expect(report).toContain("checks: ok");
    expect(report).toContain("graph equal: yes");
    expect(report).toContain("workflow equal: yes");
    expect(report.some((l) => l.startsWith("deal rule signed: "))).toBe(true);
    expect(process.exitCode).toBeUndefined();
  });

  it("says when the version is missing", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    process.exitCode = undefined;
    await program({ withDb: reads([{ number: 1, body: graph }]) }).parseAsync(
      ["shape", "convert", "--version", "9"],
      { from: "user" },
    );
    expect(err).toHaveBeenCalledWith(expect.stringContaining("no version 9"));
    expect(process.exitCode).toBe(1);
    process.exitCode = undefined;
    err.mockRestore();
  });
});

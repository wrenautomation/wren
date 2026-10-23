import type { NumberRow } from "@wren/pipeline/numbers";
import { Command, InvalidArgumentError } from "commander";
import { describe, expect, it, vi } from "vitest";
import {
  dayArg,
  numberArg,
  numberLines,
  ownKinds,
  registerPipeline,
  windowArg,
} from "./pipeline.js";

describe("arguments", () => {
  it("takes a real day only", () => {
    expect(dayArg("2027-02-28")).toBe("2027-02-28");
    for (const bad of ["2027-02-30", "27-02-01", "2027/02/01", "", "tomorrow"])
      expect(() => dayArg(bad)).toThrow(InvalidArgumentError);
  });

  it("takes a whole number from 1", () => {
    expect(numberArg("3")).toBe(3);
    for (const bad of ["0", "-1", "1.5", "x"]) expect(() => numberArg(bad)).toThrow();
  });
});

describe("commands", () => {
  const program = () => {
    const p = new Command("wren").exitOverride().configureOutput({ writeErr: () => {} });
    const none = (async () => {
      throw new Error("no database in this test");
    }) as never;
    registerPipeline(p, none, none);
    return p;
  };
  const names = (c: Command) => c.commands.map((x) => x.name());

  it("registers the areas", () => {
    const p = program();
    expect(names(p)).toEqual(["offers", "terms", "journeys", "deals", "numbers"]);
    expect(names(p.commands[0] as Command)).toEqual(["sync", "list", "versions"]);
    expect(names(p.commands[1] as Command)).toEqual(["add", "show"]);
    expect(names(p.commands[2] as Command)).toEqual([
      "open",
      "move",
      "drop",
      "assign",
      "rebuild",
      "show",
      "list",
    ]);
    expect(names(p.commands[3] as Command)).toEqual(["list", "sign", "schedule"]);
  });

  it("needs --person on journeys open", async () => {
    await expect(program().parseAsync(["journeys", "open"], { from: "user" })).rejects.toThrow(
      /--person/,
    );
  });

  it("needs a node on journeys move and a reason on journeys drop", async () => {
    await expect(program().parseAsync(["journeys", "move", "j"], { from: "user" })).rejects.toThrow(
      /missing required argument/,
    );
    await expect(program().parseAsync(["journeys", "drop", "j"], { from: "user" })).rejects.toThrow(
      /--reason/,
    );
  });

  it("needs --plan on deals sign", async () => {
    await expect(program().parseAsync(["deals", "sign", "d"], { from: "user" })).rejects.toThrow(
      /--plan/,
    );
  });

  it("takes real days on numbers", async () => {
    await expect(
      program().parseAsync(["numbers", "--from", "2027-13-01"], { from: "user" }),
    ).rejects.toThrow(/YYYY-MM-DD/);
  });

  it("sends a move to the worker as the operator", async () => {
    const seen: unknown[] = [];
    const p = new Command("wren").exitOverride();
    const none = (async () => {
      throw new Error("no database in this test");
    }) as never;
    const ok = async (req: unknown) => {
      seen.push(req);
      return { ok: true };
    };
    registerPipeline(p, none, none, {
      journeys: () => ({ open: ok, move: ok, drop: ok, assign: ok, rebuild: ok }),
      client: () => "c1",
    });
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await p.parseAsync(["journeys", "move", "j1", "won"], { from: "user" });
    await p.parseAsync(["journeys", "move", "j1", "lost", "--reason", "gone cold"], {
      from: "user",
    });
    await p.parseAsync(["journeys", "open", "--person", "a@b.test", "--at", "ads"], {
      from: "user",
    });
    await p.parseAsync(["journeys", "drop", "j1", "--reason", "gone"], { from: "user" });
    await p.parseAsync(["journeys", "assign", "j1", "--to", "ada@acme.example.test"], {
      from: "user",
    });
    await p.parseAsync(["journeys", "assign", "j1", "--clear"], { from: "user" });
    log.mockRestore();
    expect(seen).toMatchObject([
      { client: "c1", journey: "j1", to: "won" },
      { client: "c1", journey: "j1", to: "lost", reason: "gone cold" },
      { client: "c1", person: "a@b.test", at: "ads" },
      { client: "c1", journey: "j1", reason: "gone" },
      { client: "c1", journey: "j1", to: "ada@acme.example.test" },
      { client: "c1", journey: "j1", to: null },
    ]);
  });

  it("takes an owner or a clear on journeys assign, never both or neither", async () => {
    const seen: unknown[] = [];
    const p = new Command("wren").exitOverride();
    const none = (async () => {
      throw new Error("no database in this test");
    }) as never;
    const ok = async (req: unknown) => {
      seen.push(req);
      return { ok: true };
    };
    registerPipeline(p, none, none, {
      journeys: () => ({ open: ok, move: ok, drop: ok, assign: ok, rebuild: ok }),
      client: () => null,
    });
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    process.exitCode = undefined;
    await p.parseAsync(["journeys", "assign", "j1"], { from: "user" });
    await p.parseAsync(["journeys", "assign", "j1", "--to", "a@b.test", "--clear"], {
      from: "user",
    });
    expect(seen).toEqual([]);
    expect(err).toHaveBeenCalledTimes(2);
    expect(process.exitCode).toBe(1);
    process.exitCode = undefined;
    err.mockRestore();
  });

  it("refuses a move when no worker is given", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    process.exitCode = undefined;
    await program().parseAsync(["journeys", "move", "j1", "won"], { from: "user" });
    expect(err).toHaveBeenCalledWith(expect.stringMatching(/No worker/));
    expect(process.exitCode).toBe(1);
    process.exitCode = undefined;
    err.mockRestore();
  });

  it("takes 7, 30, 90 or all as a window", () => {
    expect(windowArg("30")).toBe(30);
    expect(windowArg("all")).toBe("all");
    expect(() => windowArg("14")).toThrow(InvalidArgumentError);
  });

  it("prints a node, an edge, a skip and an offer row on one line each", () => {
    const blank = {
      position: 0,
      nodeKind: null,
      arrived: null,
      skipped: null,
      left: null,
      now: null,
      medianDays: null,
      reach: null,
      steps: null,
      mark: null,
      crossings: null,
      from: null,
      to: null,
      opened: null,
      deals: null,
      collected: null,
      scheduled: null,
      cost: null,
      currency: null,
      last: null,
    };
    const lines = numberLines([
      {
        ...blank,
        id: "n:a",
        kind: "node",
        label: "a",
        name: "A",
        nodeKind: "step",
        arrived: 4,
        now: 1,
        reach: 0.25,
        steps: 2,
        mark: "optional",
      },
      { ...blank, id: "e:a_to_b", kind: "edge", label: "a_to_b", name: "a b", crossings: 3 },
      {
        ...blank,
        id: "skip:a_to_c",
        kind: "skip",
        label: "a_to_c",
        name: "A over to C",
        crossings: 5,
        mark: "express",
      },
      { ...blank, id: "o:x", kind: "offer", label: "x", name: "x", deals: 2, currency: "USD" },
    ]);
    expect(lines).toHaveLength(4);
    expect(lines[0]).toMatch(/^step {2}a {2}0\. A {2}arrived 4/);
    expect(lines[0]).toMatch(/reach 25% {2}moves 2 {2}optional$/);
    expect(lines[1]).toBe("edge  a_to_b  a b  crossed 3");
    expect(lines[2]).toBe("skip  a_to_c  A over to C  made 5  express");
    expect(lines[3]).toMatch(/^offer {2}x {2}deals 2/);
  });

  it("needs --plan, --from and --file on terms add", async () => {
    await expect(program().parseAsync(["terms", "add", "o"], { from: "user" })).rejects.toThrow(
      /required option/,
    );
    await expect(
      program().parseAsync(["terms", "add", "o", "--plan", "p", "--from", "soon", "--file", "f"], {
        from: "user",
      }),
    ).rejects.toThrow(/YYYY-MM-DD/);
  });
});

describe("ownKinds", () => {
  const row = (kind: string) => ({ id: `${kind}:x`, kind }) as unknown as NumberRow;
  const kinds = (rows: NumberRow[]) => rows.map((r) => r.kind);

  it("keeps a graph newest to node, edge, skip and offer rows", () => {
    const rows = ["node", "station", "edge", "track", "line", "skip", "offer"].map(row);
    expect(kinds(ownKinds(rows))).toEqual(["node", "edge", "skip", "offer"]);
  });

  it("keeps every row of a metro newest, which has no node rows", () => {
    const rows = ["line", "station", "track", "offer"].map(row);
    expect(kinds(ownKinds(rows))).toEqual(["line", "station", "track", "offer"]);
  });
});

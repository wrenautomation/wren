import { Command, InvalidArgumentError } from "commander";
import { describe, expect, it, vi } from "vitest";
import { dayArg, funnelFile, numberArg, registerPipeline } from "./pipeline.js";

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

describe("funnelFile", () => {
  const body = { name: "T", offer: "o", stages: [], entries: [] };
  it("reads a wrapped file", () => {
    expect(funnelFile({ id: "a", name: "A", why: "w", body })).toEqual({
      id: "a",
      name: "A",
      why: "w",
      body,
    });
  });
  it("reads a bare body", () => {
    expect(funnelFile(body)).toEqual({ body });
  });
  it("refuses what is not a funnel", () => {
    expect(() => funnelFile([])).toThrow(/JSON object/);
    expect(() => funnelFile({ id: "a" })).toThrow(/stages/);
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
    expect(names(p)).toEqual(["offers", "terms", "funnels", "journeys", "deals", "numbers"]);
    expect(names(p.commands[0] as Command)).toEqual(["sync", "list", "versions"]);
    expect(names(p.commands[1] as Command)).toEqual(["add", "show"]);
    expect(names(p.commands[2] as Command)).toEqual(["list", "add", "append", "show", "off", "on"]);
    expect(names(p.commands[3] as Command)).toEqual([
      "open",
      "move",
      "drop",
      "rebuild",
      "show",
      "list",
    ]);
    expect(names(p.commands[4] as Command)).toEqual(["list", "sign", "schedule"]);
  });

  it("needs --person on journeys open", async () => {
    await expect(program().parseAsync(["journeys", "open", "f"], { from: "user" })).rejects.toThrow(
      /--person/,
    );
  });

  it("needs a stage on journeys move and a reason on journeys drop", async () => {
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
      journeys: () => ({ open: ok, move: ok, drop: ok, rebuild: ok }),
      client: () => "c1",
    });
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await p.parseAsync(["journeys", "move", "j1", "won"], { from: "user" });
    await p.parseAsync(["journeys", "drop", "j1", "--reason", "gone"], { from: "user" });
    log.mockRestore();
    expect(seen).toMatchObject([
      { client: "c1", journey: "j1", to: "won" },
      { client: "c1", journey: "j1", reason: "gone" },
    ]);
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

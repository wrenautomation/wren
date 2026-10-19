import { Command, InvalidArgumentError } from "commander";
import { describe, expect, it } from "vitest";
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

  it("registers the three areas", () => {
    const p = program();
    expect(names(p)).toEqual(["offers", "terms", "funnels"]);
    expect(names(p.commands[0] as Command)).toEqual(["sync", "list", "versions"]);
    expect(names(p.commands[1] as Command)).toEqual(["add", "show"]);
    expect(names(p.commands[2] as Command)).toEqual(["list", "add", "append", "show", "off", "on"]);
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

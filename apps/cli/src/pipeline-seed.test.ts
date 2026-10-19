import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Command } from "commander";
import { afterEach, describe, expect, it, vi } from "vitest";
import { pipelineCommand, registerPipelineSeed } from "./pipeline-seed.js";

const program = () => {
  const p = new Command("wren").exitOverride().configureOutput({ writeErr: () => {} });
  const withDb = vi.fn(async () => {
    throw new Error("no database in this test");
  });
  registerPipelineSeed(p, withDb as never);
  return { p, withDb };
};

afterEach(() => {
  process.exitCode = undefined;
  vi.restoreAllMocks();
});

describe("pipeline seed", () => {
  it("registers under one pipeline command, shared", () => {
    const { p } = program();
    expect(pipelineCommand(p)).toBe(p.commands.find((c) => c.name() === "pipeline"));
    expect(pipelineCommand(p).commands.map((c) => c.name())).toEqual(["seed"]);
  });

  it("needs --file", async () => {
    await expect(program().p.parseAsync(["pipeline", "seed"], { from: "user" })).rejects.toThrow(
      /--file/,
    );
  });

  it("refuses a file that still asks, before it opens the database", async () => {
    const file = join(mkdtempSync(join(tmpdir(), "seed-")), "s.json");
    writeFileSync(
      file,
      JSON.stringify({
        offer: "o",
        funnels: [],
        terms: [],
        journeys: [],
        deals: [],
        note: "ASK_WILLIAM",
      }),
    );
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const { p, withDb } = program();
    await p.parseAsync(["pipeline", "seed", "--file", file], { from: "user" });
    expect(withDb).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
    expect(err.mock.calls.flat().join("\n")).toMatch(/note/);
  });

  it("refuses a file that is not JSON", async () => {
    const file = join(mkdtempSync(join(tmpdir(), "seed-")), "s.json");
    writeFileSync(file, "{");
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    await program().p.parseAsync(["pipeline", "seed", "--file", file], { from: "user" });
    expect(process.exitCode).toBe(1);
    expect(err.mock.calls.flat().join("\n")).toMatch(/Cannot read/);
  });
});

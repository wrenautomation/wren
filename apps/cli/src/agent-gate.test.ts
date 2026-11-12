/**
 * The gated list (`./agent-gate.ts`) against the CLI's sources: each gated command's words are
 * still commands somewhere, so a rename can't drop a gate unseen. `wren autonomy check` walks the
 * live tree for full paths.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { RISKY } from "./agent-gate.js";

const dir = import.meta.dirname;
const source = readdirSync(dir)
  .filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"))
  .map((f) => readFileSync(join(dir, f), "utf8"))
  .join("\n");

describe("gated commands", () => {
  it("names only words the CLI declares as commands", () => {
    const missing = Object.keys(RISKY).flatMap((path) =>
      path
        .split(" ")
        .filter((w) => !new RegExp(`command\\(["'\`]${w}[ "'\`]`).test(source))
        .map((w) => `${path}: ${w}`),
    );
    expect(missing).toEqual([]);
  });
});

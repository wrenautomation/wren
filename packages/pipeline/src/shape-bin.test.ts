/** The Map chat's `shape` bin: reads and draft writes pass, every write to the live shape is refused. */
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const bin = fileURLToPath(new URL("../bin/shape.mjs", import.meta.url));
const run = (...args: string[]) =>
  spawnSync(process.execPath, [bin, ...args], { encoding: "utf8" });

describe("shape bin", () => {
  it.each([
    ["draft", "apply", "d1"],
    ["draft", "drop", "d1"],
    ["import", "f.yaml"],
    ["undo", "1", "2", "k"],
    ["tag", "v", "1"],
    ["remove", "x"],
    ["--client", "c1", "draft", "apply", "d1"],
    [],
  ])("refuses %s %s", (...args) => {
    const r = run(...args.filter((a): a is string => typeof a === "string"));
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/A person applies or drops a draft/);
  });
});

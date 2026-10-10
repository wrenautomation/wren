import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { defaultPath, loadDefaults, writeDefaultFile } from "./template-defaults.js";

describe("writeDefaultFile", () => {
  let dir = "";
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("writes a client's words where the loader reads them back, the same", () => {
    dir = mkdtempSync(join(tmpdir(), "promote-"));
    const ref = { kind: "prompt" as const, system: "content", name: "asks/hook" };
    const path = writeDefaultFile(dir, ref, "Write one hook.\nKeep it short.");
    expect(path).toBe(join(dir, "prompt", "content", "asks", "hook.prompt"));
    expect(defaultPath(dir, ref)).toBe(path);
    expect(readFileSync(path, "utf8")).toBe("Write one hook.\nKeep it short.\n");
    expect(loadDefaults(dir)).toMatchObject([{ ref, source: "Write one hook.\nKeep it short." }]);
  });
});

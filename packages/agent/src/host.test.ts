import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { hostSetups } from "./host.js";
import { SETUPS } from "./setups.js";

const folder = (files: Record<string, unknown>) => {
  const dir = mkdtempSync(join(tmpdir(), "wren-host-"));
  for (const [f, v] of Object.entries(files))
    writeFileSync(join(dir, f), typeof v === "string" ? v : JSON.stringify(v));
  return dir;
};
const maker = {
  title: "Site maker",
  app: "campaigns",
  cwd: "/work/site",
  model: "sonnet",
  tools: ["Bash"],
};

describe("hostSetups", () => {
  it("reads a record and its append; always owner-only, on the plan", () => {
    const dir = folder({
      "site-maker.json": { ...maker, sandbox: { enabled: true }, allow: ["Bash(npx astro *)"] },
      "site-maker.md": "Build one sample.\n",
      "notes.txt": "not a setup",
    });
    expect(hostSetups(dir, SETUPS)).toEqual([
      {
        name: "site-maker",
        ...maker,
        skills: [],
        plugins: [],
        allow: ["Bash(npx astro *)"],
        passEnv: [],
        sandbox: { enabled: true },
        append: "Build one sample.",
        credentials: ["plan"],
        connection: "sdk",
        owner: true,
      },
    ]);
  });

  it("gives none for a missing folder", () => {
    expect(hostSetups(join(tmpdir(), "wren-host-none"))).toEqual([]);
  });

  it("refuses an unknown key, an owner switch, a built-in name or title, and bad JSON", () => {
    expect(() => hostSetups(folder({ "a.json": { ...maker, alow: [] } }))).toThrow(
      /a\.json.*alow/s,
    );
    expect(() => hostSetups(folder({ "a.json": { ...maker, owner: false } }))).toThrow(/owner/);
    expect(() => hostSetups(folder({ "vireo.json": maker }), SETUPS)).toThrow(/built-in/);
    expect(() => hostSetups(folder({ "a.json": { ...maker, title: "Vireo" } }), SETUPS)).toThrow(
      /built-in/,
    );
    expect(() => hostSetups(folder({ "a.json": "{" }))).toThrow(/a\.json/);
    expect(() => hostSetups(folder({ "A b.json": maker }))).toThrow(/file name/);
  });
});

/**
 * The `--client` guard on the CLI. `wren audit sealer` runs across every
 * database, so it refuses `--client`; `wren audit seal` is per-database, so it
 * accepts it. Spawned as a real process against an unreachable database, so the
 * guard is what we see, not a connection. Nothing here is expected to fail.
 */
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const srcDir = import.meta.dirname;
const mainTs = join(srcDir, "main.ts");
// apps/cli/src -> repo root -> a tsx that resolves the workspace packages.
const tsx = join(srcDir, "..", "..", "..", "packages", "db", "node_modules", ".bin", "tsx");

let root = "";
let home = "";
let work = "";

/** Run the CLI with a minimal env and an unreachable database; never a real .env. */
function runCli(args: string[]): Promise<{ code: number; out: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(tsx, [mainTs, ...args], {
      cwd: work,
      env: {
        PATH: process.env.PATH,
        HOME: home,
        WREN_ROOT: root,
        WREN_DATABASE_URL: "postgres://x:y@127.0.0.1:1/none",
      },
    });
    let out = "";
    child.stdout.on("data", (d) => {
      out += d;
    });
    child.stderr.on("data", (d) => {
      out += d;
    });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code: code ?? -1, out }));
  });
}

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "wren-cli-root-"));
  home = await mkdtemp(join(tmpdir(), "wren-cli-home-"));
  work = await mkdtemp(join(tmpdir(), "wren-cli-work-"));
});
afterAll(async () => {
  for (const d of [root, home, work]) if (d) await rm(d, { recursive: true, force: true });
});

const REFUSAL = "`wren audit sealer` does not take --client";

describe("`wren audit sealer` covers every database, so it refuses --client", () => {
  it("refuses `--client` on `audit sealer status`", async () => {
    const { code, out } = await runCli(["--client", "acme", "audit", "sealer", "status"]);
    expect(out).toContain(REFUSAL);
    expect(code).toBe(1);
  }, 60_000);

  it("refuses `--client` on `audit sealer start`", async () => {
    const { code, out } = await runCli(["--client", "acme", "audit", "sealer", "start"]);
    expect(out).toContain(REFUSAL);
    expect(code).toBe(1);
  }, 60_000);
});

describe("`wren audit seal` is per-database, so --client is allowed", () => {
  it("does not refuse `--client` on `audit seal` (it reaches the database instead)", async () => {
    const { out } = await runCli(["audit", "seal", "--client", "acme"]);
    expect(out).not.toContain("does not take --client");
  }, 60_000);
});

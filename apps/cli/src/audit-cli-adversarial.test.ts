/**
 * The `--client` guard on the CLI. `wren audit sealer` runs across every database, so it refuses
 * `--client`; `wren audit seal` is per-database, so it accepts it. The guard runs on a commander
 * program shaped like the CLI's, in process: spawning the whole CLI under tsx took most of a
 * minute on a loaded machine.
 */
import { Command } from "commander";
import { describe, expect, it } from "vitest";
import { guardClient } from "./client-scope.js";

/** `args` parsed by a program with the CLI's audit commands; what ran, and the path it saw. */
async function run(args: string[]): Promise<{ ran: string[]; path: string[] }> {
  const ran: string[] = [];
  let path: string[] = [];
  const program = new Command("wren").option("--client <id>").exitOverride();
  guardClient(program, (p) => {
    path = p;
  });
  const audit = program.command("audit");
  audit.command("seal").action(() => ran.push("seal"));
  const sealer = audit.command("sealer");
  for (const verb of ["status", "start"]) sealer.command(verb).action(() => ran.push(verb));
  program.command("status").action(() => ran.push("content status"));
  await program.parseAsync(args, { from: "user" });
  return { ran, path };
}

const REFUSAL = "`wren audit sealer` does not take --client";

describe("`wren audit sealer` covers every database, so it refuses --client", () => {
  it.each(["status", "start"])("refuses `--client` on `audit sealer %s`", async (verb) => {
    await expect(run(["--client", "acme", "audit", "sealer", verb])).rejects.toThrow(REFUSAL);
  });

  it("runs `audit sealer status` without --client", async () => {
    expect(await run(["audit", "sealer", "status"])).toEqual({
      ran: ["status"],
      path: ["audit", "sealer", "status"],
    });
  });
});

describe("`wren audit seal` is per-database, so --client is allowed", () => {
  it("does not refuse `--client` on `audit seal`", async () => {
    expect((await run(["audit", "seal", "--client", "acme"])).ran).toEqual(["seal"]);
  });
});

describe("a command outside the client-scoped set", () => {
  it("refuses `--client` rather than ignore it", async () => {
    await expect(run(["--client", "acme", "status"])).rejects.toThrow(
      "`wren status` does not take --client",
    );
  });
});

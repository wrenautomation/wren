import { Command } from "commander";
import { describe, expect, it } from "vitest";
import { guardClient } from "./client-scope.js";
import { registerGroups } from "./groups.js";

/**
 * `wren --client <id> groups …` (designs/2026-10-15-channel-stats.md): the root option reaches
 * every groups command through `withDb`. Here `withDb` records the client it was asked for and
 * stops, so no database opens. main.ts's `withDb` reads the same `program.opts().client`.
 */
const program = () => {
  const asked: Array<string | undefined> = [];
  const p = new Command("wren")
    .option("--client <id>", "run against this client's database")
    .exitOverride()
    .configureOutput({ writeErr: () => {} });
  guardClient(p);
  registerGroups(p, {
    withDb: async () => {
      asked.push(p.opts<{ client?: string }>().client);
      throw new Error("stop: no database in this test");
    },
  });
  p.command("status").action(() => {});
  return { p, asked };
};

const run = (args: string[]) => {
  const t = program();
  return { ...t, done: t.p.parseAsync(args, { from: "user" }) };
};

describe("wren --client <id> groups", () => {
  it("opens the client's database for every groups command and for channels", async () => {
    for (const args of [
      ["groups", "list"],
      ["groups", "show", "Warm owners"],
      ["groups", "check", 'all(trait persona is "owner")'],
      ["groups", "count", 'all(trait persona is "owner")'],
      ["groups", "save", "Warm owners", "--rule", 'all(trait persona is "owner")'],
      ["groups", "members", "3"],
      ["groups", "history", "3"],
      ["groups", "in", "3", "ada@example.test"],
      ["channels"],
    ]) {
      const { asked, done } = run(["--client", "acme", ...args]);
      await expect(done, args.join(" ")).rejects.toThrow(/^stop/);
      expect(asked, args.join(" ")).toEqual(["acme"]);
    }
  });

  it("takes --client after the command too", async () => {
    const { asked, done } = run(["groups", "list", "--client", "acme"]);
    await expect(done).rejects.toThrow(/^stop/);
    expect(asked).toEqual(["acme"]);
  });

  it("asks for Wren's own database without --client", async () => {
    const { asked, done } = run(["groups", "list"]);
    await expect(done).rejects.toThrow(/^stop/);
    expect(asked).toEqual([undefined]);
  });

  it("still refuses --client on a command that does not take it", async () => {
    const { asked, done } = run(["--client", "acme", "status"]);
    await expect(done).rejects.toThrow("`wren status` does not take --client");
    expect(asked).toEqual([]);
  });
});

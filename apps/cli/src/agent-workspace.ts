/**
 * `wren agent workspace …` (designs/2026-11-05-variants.md, 11-17, W4): the project folders Vireo
 * runs build in, as rows in `agent_workspaces`. Run on the Mac through scripts/prod-wren.mjs.
 * The relay reads `get` per run; only a terminal writes.
 */
import { readFileSync } from "node:fs";
import { RUN_ENV, WORKSPACE_NAME, type Workspace, WorkspaceRules } from "@wren/agent";
import { agentWorkspaces } from "@wren/core/agent-workspaces-schema";
import type { Db } from "@wren/db";
import type { Command } from "commander";
import { eq, sql } from "drizzle-orm";

type WithDb = <T>(fn: (db: Db) => Promise<T>) => Promise<T>;

const json = (v: unknown) => console.log(JSON.stringify(v, null, 2));
const asWorkspace = (r: { name: string; rules: unknown }): Workspace => ({
  ...WorkspaceRules.parse(r.rules),
  name: r.name,
});

// a relay chat could widen its own allow list; the env check is a tripwire, the real line is the
// setups' tool rules and prod.env staying off their paths
function terminalOnly(): void {
  if (process.env[RUN_ENV.url])
    throw new Error("workspace rules change from a terminal only, not from an agent chat");
}

export function registerWorkspace(agent: Command, withMainDb: WithDb, actor: string): void {
  const ws = agent
    .command("workspace")
    .description("project folders Vireo builds subjects in, and the rules runs get there");

  ws.command("list")
    .description("every workspace, as JSON")
    .action(async () =>
      json(
        await withMainDb(async (db) =>
          (await db.select().from(agentWorkspaces).orderBy(agentWorkspaces.name)).map(asWorkspace),
        ),
      ),
    );

  ws.command("get")
    .description("the workspace that builds a subject, as JSON; null when none")
    .argument("<subject>", "Vireo subject slug")
    .action(async (subject: string) => {
      const rows = await withMainDb((db) =>
        db
          .select()
          .from(agentWorkspaces)
          .where(sql`${agentWorkspaces.rules} -> 'subjects' ? ${subject}`),
      );
      json(rows[0] ? asWorkspace(rows[0]) : null);
    });

  ws.command("set")
    .description("add or replace a workspace from a JSON rules file (cwd, subjects, allow, …)")
    .argument("<name>", "lower case: a-z, 0-9, -")
    .argument("<file>", "rules JSON")
    .action(async (name: string, file: string) => {
      terminalOnly();
      if (!WORKSPACE_NAME.test(name))
        throw new Error(`name ${name}: a-z, 0-9 and -, a letter first`);
      const rules = WorkspaceRules.parse(JSON.parse(readFileSync(file, "utf8")));
      await withMainDb(async (db) => {
        const others = await db.select().from(agentWorkspaces);
        for (const o of others) {
          if (o.name === name) continue;
          const taken = asWorkspace(o).subjects.filter((s) => rules.subjects.includes(s));
          if (taken.length) throw new Error(`${o.name} already builds ${taken.join(", ")}`);
        }
        await db
          .insert(agentWorkspaces)
          .values({ name, rules, updatedBy: actor })
          .onConflictDoUpdate({
            target: agentWorkspaces.name,
            set: { rules, updatedBy: actor, updatedAt: new Date() },
          });
      });
      json({ ...rules, name });
    });

  ws.command("rm")
    .description("remove a workspace; its subjects get no runs")
    .argument("<name>")
    .action(async (name: string) => {
      terminalOnly();
      const gone = await withMainDb((db) =>
        db
          .delete(agentWorkspaces)
          .where(eq(agentWorkspaces.name, name))
          .returning({ name: agentWorkspaces.name }),
      );
      if (!gone.length) throw new Error(`no workspace ${name}`);
      json({ removed: name });
    });
}

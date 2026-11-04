/**
 * `wren loops …`: every self-rescheduling loop's health (designs/2026-10-16-loop-watchdog.md),
 * read from Restate's admin SQL (`WREN_RESTATE_ADMIN_URL`), and the `LoopRevive` loop that wakes a
 * dead one and names a stuck one; the units its passes hold (Checks' `unit_holds`). `--json`, so
 * an agent reads what a person does.
 */
import * as clients from "@restatedev/restate-sdk-clients";
import { ingressOf, type Settings } from "@wren/config";
import { release } from "@wren/core/checks";
import { restateAdmin } from "@wren/core/console";
import { LOOP_WATCH_KEY, type LoopRevive, loopHealth } from "@wren/core/loop-watch";
import { type Db, serializable, setAuditActor } from "@wren/db";
import type { Command } from "commander";
import { sql } from "drizzle-orm";

type WithDb = <T>(fn: (db: Db) => Promise<T>) => Promise<T>;

const when = (at: string | null) => (at ? at.slice(0, 16).replace("T", " ") : "-");

export function registerLoops(program: Command, withMainDb: WithDb, settings: Settings) {
  const watch = () =>
    clients
      .connect(ingressOf(settings))
      .objectClient<LoopRevive>({ name: "LoopRevive" }, LOOP_WATCH_KEY);

  const cmd = program
    .command("loops")
    .description("every loop's health: alive, dead (no next pass) or stuck behind a call")
    .option("--all", "stopped loops too")
    .option("--json", "rows as JSON")
    .action(async (o: { all?: boolean; json?: boolean }) => {
      if (!settings.restateAdminUrl) throw new Error("needs WREN_RESTATE_ADMIN_URL");
      const rows = (
        await loopHealth(
          restateAdmin(settings.restateAdminUrl, settings.restateAuthToken),
          new Date(),
        )
      ).filter((h) => o.all || h.health !== "stopped");
      if (o.json) return console.log(JSON.stringify(rows, null, 2));
      for (const h of rows) {
        console.log(
          `${h.health.padEnd(7)} ${h.id}  last ${when(h.lastAt)}, next ${when(h.nextAt)}  ${h.why}${h.blocker ? `  [${h.blocker.id}]` : ""}`,
        );
        // The last pass's calls past their limit: each unit skipped, held ones in Checks.
        for (const t of h.timeouts)
          console.log(
            `        timed out ${t.call}${t.unit ? ` (${t.unit})` : ""} after ${Math.round(t.ms / 1000)} s${t.held ? ", held" : ""}`,
          );
      }
      const bad = rows.filter((h) => h.health === "dead" || h.health === "stuck").length;
      console.log(bad ? `${bad} need a look` : "all running loops alive");
    });

  cmd
    .command("holds")
    .description("Units a loop holds after timeouts (Console → Checks): id, loop, unit, why, until")
    .option("--json", "rows as JSON")
    .action(async (o: { json?: boolean }) => {
      const rows = await withMainDb((db) =>
        db.execute<{ id: number; stage: string; subject: string; reason: string; until: string }>(
          sql`select id, stage, subject, reason, until::text from unit_holds
              where stage like 'loop.%' and released_at is null order by held_at`,
        ),
      );
      if (o.json) return console.log(JSON.stringify(rows, null, 2));
      for (const h of rows)
        console.log(
          `${h.id}  ${h.stage}  ${h.subject}  until ${h.until.slice(0, 16)}  ${h.reason}`,
        );
      console.log(`${rows.length} held`);
    });

  cmd
    .command("release <ids...>")
    .description("Let holds go, as Console → Checks does: each unit runs on its next pass")
    .action(async (ids: string[]) => {
      const n = ids.map(Number);
      if (n.some((id) => !Number.isInteger(id) || id <= 0)) throw new Error("ids are hold numbers");
      const done = await withMainDb((db) =>
        serializable(db, async (tx) => {
          await setAuditActor(tx, "cli");
          return release(tx, n, "cli");
        }),
      );
      console.log(`released ${done.map((r) => r.id).join(", ") || "none"}`);
    });

  const w = cmd
    .command("watch")
    .description("The LoopRevive loop: a check every 10 minutes, dead loops woken");
  for (const [name, text] of [
    ["status", "Its last check and open incidents"],
    ["start", "Loop: check, then again in 10 minutes"],
    ["stop", "Stop looping"],
    ["sync", "One check now"],
  ] as const)
    w.command(name)
      .description(text)
      .action(async () => console.log(JSON.stringify(await watch()[name](), null, 2)));
}

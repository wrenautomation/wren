/**
 * `wren dlq …`: the dead-letter queue (designs/2026-10-11-dead-letters.md). Every Restate
 * invocation that used up its retries and paused, filed by the `DeadLetters` loop. Reads go to
 * the database; `retry` and `kill` go to Restate's admin API (`WREN_RESTATE_ADMIN_URL`).
 * `--json` everywhere, so an agent reads the same rows a person does.
 */
import { userInfo } from "node:os";
import * as clients from "@restatedev/restate-sdk-clients";
import { ingressOf, type Settings } from "@wren/config";
import { type RestateAdmin, restateAdmin } from "@wren/core/console";
import {
  DEAD_LETTERS_KEY,
  type DeadLetterAct,
  type DeadLetters,
  deadLetter,
  deadLetterList,
  endDeadLetter,
  journalOf,
  letterLine,
  restateAdminPatch,
} from "@wren/core/dead-letters";
import type { Db } from "@wren/db";
import type { Command } from "commander";

type WithDb = <T>(fn: (db: Db) => Promise<T>) => Promise<T>;

const ago = (d: Date) => {
  const h = Math.round((Date.now() - d.getTime()) / 3_600_000);
  return h < 48 ? `${h}h ago` : `${Math.round(h / 24)}d ago`;
};

export function registerDlq(program: Command, withMainDb: WithDb, settings: Settings) {
  const admin = (): { query: RestateAdmin; patch: ReturnType<typeof restateAdminPatch> } => {
    if (!settings.restateAdminUrl) throw new Error("needs WREN_RESTATE_ADMIN_URL");
    return {
      query: restateAdmin(settings.restateAdminUrl, settings.restateAuthToken),
      patch: restateAdminPatch(settings.restateAdminUrl, settings.restateAuthToken),
    };
  };
  const loop = () =>
    clients
      .connect(ingressOf(settings))
      .objectClient<DeadLetters>({ name: "DeadLetters" }, DEAD_LETTERS_KEY);

  const cmd = program
    .command("dlq")
    .description("dead letters: calls Restate gave up on (paused after their retries)");

  cmd
    .command("list")
    .description("Open letters, oldest first")
    .option("--all", "ended ones too, newest first")
    .option("--json", "rows as JSON")
    .action(async (o: { all?: boolean; json?: boolean }) => {
      const rows = await withMainDb((db) => deadLetterList(db, o.all === true));
      if (o.json) return console.log(JSON.stringify(rows, null, 2));
      for (const l of rows)
        console.log(
          `${letterLine(l)}  [${l.end ?? "open"}, paused ${ago(l.pausedAt)}${l.invokedBy ? `, from ${l.invokedBy}` : ""}]`,
        );
      if (!rows.length) console.log(o.all ? "no dead letters ever" : "no open dead letters");
    });

  cmd
    .command("show <id>")
    .description("One letter, and its journal from Restate while Restate still keeps it")
    .option("--json", "as JSON")
    .action(async (id: string, o: { json?: boolean }) => {
      const row = await withMainDb((db) => deadLetter(db, Number(id)));
      if (!row) throw new Error(`no dead letter #${id}`);
      const journal = settings.restateAdminUrl
        ? await journalOf(admin().query, row.invocationId).catch((e: Error) => {
            console.error(`journal: ${e.message} (Restate keeps it while the call is paused)`);
            return [];
          })
        : [];
      if (o.json) return console.log(JSON.stringify({ ...row, journal }, null, 2));
      console.log(letterLine(row));
      console.log(
        `invocation ${row.invocationId}, from ${row.invokedBy ?? "?"}, paused ${row.pausedAt.toISOString()}`,
      );
      if (row.endedAt)
        console.log(`ended ${row.end} by ${row.endedBy} ${row.endedAt.toISOString()}`);
      if (row.error) console.log(`\n${row.error}\n`);
      for (const e of journal)
        console.log(
          `  ${e.index} ${e.type}${e.name ? ` "${e.name}"` : ""}${e.failure ? ` → ${e.failure}` : ""}`,
        );
    });

  const act = (verb: DeadLetterAct, what: string) =>
    cmd
      .command(`${verb} <id>`)
      .description(what)
      .action(async (id: string) => {
        const patch = verb === "drop" ? undefined : admin().patch;
        const row = await withMainDb((db) =>
          endDeadLetter(
            { main: db, ...(patch ? { patch } : {}) },
            Number(id),
            verb,
            userInfo().username,
          ),
        );
        console.log(`${letterLine(row)}: ${row.end}`);
      });
  act("retry", "Resume it where it stopped; if it pauses again it comes back as the same letter");
  act("kill", "Give up on it: Restate ends it with an error its caller sees");
  act("drop", "Close the letter only (handled some other way); Restate is left alone");

  const sweep = cmd.command("sweep").description("The DeadLetters loop: a sweep every 10 minutes");
  for (const [name, what] of [
    ["status", "Its last sweep"],
    ["start", "Loop: sweep, then again in 10 minutes"],
    ["stop", "Stop looping"],
    ["sync", "One sweep now"],
  ] as const)
    sweep
      .command(name)
      .description(what)
      .action(async () => console.log(JSON.stringify(await loop()[name](), null, 2)));
}

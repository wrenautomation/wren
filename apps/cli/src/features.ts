/**
 * `wren features …`: feature flags, off the portal since Loops left it (designs/2026-11-04-portal-places.md).
 * Same store as the old page: edits write a `changes` row (History, Undo), site flags push to the
 * lander's edge when `WREN_SITE_EDGE_TOKEN` is set.
 */
import type { Settings } from "@wren/config";
import { editRecord } from "@wren/core/edits";
import { addFlag, flagRecord, removeFlags, siteEdge } from "@wren/core/flag-store";
import { formatRules } from "@wren/core/flags";
import { flags } from "@wren/core/schema";
import { type Db, type Queryable, serializable, setAuditActor } from "@wren/db";
import type { Command } from "commander";
import { asc } from "drizzle-orm";

type WithDb = <T>(fn: (db: Db) => Promise<T>) => Promise<T>;

const BY = "cli";

export function registerFeatures(program: Command, withMainDb: WithDb, settings: Settings) {
  const push = settings.siteEdgeToken
    ? siteEdge(settings.siteBaseUrl, settings.siteEdgeToken)
    : undefined;
  const record = flagRecord(push);
  // The audit actor is transaction-local: every write runs inside one.
  const write = <T>(fn: (tx: Queryable) => Promise<T>) =>
    withMainDb((db) =>
      serializable(db, async (tx) => {
        await setAuditActor(tx, BY);
        return fn(tx);
      }),
    );
  const edit = async (key: string, patch: Record<string, string>) => {
    const r = await write((tx) => editRecord(tx, record, key, { patch, by: BY }));
    console.log(r.change ? `${key}: change ${r.change}` : `${key}: no change`);
  };

  const cmd = program
    .command("features")
    .description("feature flags: key, state, who reads it, rules (first match wins), fallback")
    .option("--json", "rows as JSON")
    .action(async (o: { json?: boolean }) => {
      const rows = await withMainDb((db) => db.select().from(flags).orderBy(asc(flags.key)));
      if (o.json) return console.log(JSON.stringify(rows, null, 2));
      for (const f of rows) {
        console.log(
          `${f.key}  ${f.killed ? "KILLED" : "live"}  ${f.surface}  [${f.variants.join(", ")}] else ${f.fallback}${f.about ? `  ${f.about}` : ""}`,
        );
        for (const line of formatRules(f.rules).split("\n").filter(Boolean))
          console.log(`  ${line}`);
      }
      console.log(`${rows.length} feature flags`);
    });

  cmd
    .command("add <key>")
    .description("a new flag; off, on when --variants is left out")
    .option("--about <text>", "what it's for")
    .option("--surface <s>", "portal, site or both", "portal")
    .option("--variants <list>", "comma between each; the first is the fallback")
    .action(async (key: string, o: { about?: string; surface?: string; variants?: string }) => {
      const made = await write((tx) =>
        addFlag(
          tx,
          { key, about: o.about, surface: o.surface as "portal", variants: o.variants },
          BY,
          push,
        ),
      );
      console.log(`added ${made.key}`);
    });

  cmd
    .command("set <key>")
    .description(
      "change rules, fallback, about or surface; rules one per line: `on: clients 12; 10%`",
    )
    .option("--rules <text>", "the whole rule set; an empty string clears it")
    .option("--fallback <variant>", "what everyone else gets")
    .option("--about <text>", "what it's for")
    .option("--surface <s>", "portal, site or both")
    .action(async (key: string, o: Record<string, string | undefined>) => {
      const patch = Object.fromEntries(
        Object.entries(o).filter((e): e is [string, string] => typeof e[1] === "string"),
      );
      if (!Object.keys(patch).length) throw new Error("nothing to set");
      await edit(key, patch);
    });

  cmd
    .command("kill <key>")
    .description("kill switch: everyone gets the fallback")
    .action((key: string) => edit(key, { state: "killed" }));
  cmd
    .command("live <key>")
    .description("undo the kill switch: the rules apply again")
    .action((key: string) => edit(key, { state: "live" }));

  cmd
    .command("rm <keys...>")
    .description("delete flags; code that asks for one gets off")
    .action(async (keys: string[]) => {
      const gone = await write((tx) => removeFlags(tx, keys, push));
      console.log(`deleted ${gone.join(", ") || "none"}`);
    });
}

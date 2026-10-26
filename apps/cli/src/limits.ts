/**
 * `wren limits …`: the limits over the code's defaults (designs/2026-10-26-limits.md). Edits go
 * to main's `limits` table; the audit log keeps who and when.
 */
import { getClient } from "@wren/core/clients";
import { limitsView, setLimit, unsetLimit } from "@wren/core/limits";
import type { Db } from "@wren/db";
import { WREN_LIMITS } from "@wren/outreach/limits";
import type { Command } from "commander";

type WithDb = <T>(fn: (db: Db) => Promise<T>) => Promise<T>;
const BY = "cli";

const whole = (s: string) => {
  const n = Number(s);
  if (!Number.isInteger(n)) throw new Error(`not a whole number: ${s}`);
  return n;
};
const shown = (l: { perDay: number; burst: number | null } | null) =>
  l ? `${l.perDay}/day${l.burst === null ? "" : `, burst ${l.burst}`}` : "none";

export function registerLimits(program: Command, withMainDb: WithDb) {
  const cmd = program
    .command("limits")
    .description("Daily limits over the code's defaults, Wren-wide or per client")
    .option("--client <id>", "as they hold for this client")
    .action(async (opts: { client?: string }) => {
      const client = opts.client ?? null;
      const rows = await withMainDb(async (db) => {
        if (client) await getClient(db, client);
        return limitsView(db, client, WREN_LIMITS);
      });
      for (const r of rows)
        console.log(
          [
            r.def.name,
            shown(r.holds),
            `from ${r.from}`,
            r.def.scope,
            `${r.def.unit}: ${r.def.why}`,
          ].join("\t"),
        );
    });

  cmd
    .command("set")
    .argument("<name>", "a name from `wren limits`")
    .argument("<perDay>", "a day")
    .option("--burst <n>", "the most at once; the default's share of a day when left out")
    .option("--client <id>", "this client only; Wren-wide when left out")
    .description("Set one limit")
    .action(async (name: string, perDay: string, opts: { burst?: string; client?: string }) => {
      const client = opts.client ?? null;
      const r = await withMainDb(async (db) => {
        if (client) await getClient(db, client);
        return setLimit(db, WREN_LIMITS, {
          client,
          name,
          perDay: whole(perDay),
          ...(opts.burst === undefined ? {} : { burst: whole(opts.burst) }),
          by: BY,
        });
      });
      console.log(`${name} (${client ?? "Wren-wide"}): ${shown(r.before)} -> ${shown(r.after)}`);
      console.log("Each run reads it at its next start.");
    });

  cmd
    .command("unset")
    .argument("<name>")
    .option("--client <id>", "this client's own row; the Wren-wide one when left out")
    .description("Drop one limit's row: the next one down holds")
    .action(async (name: string, opts: { client?: string }) => {
      const client = opts.client ?? null;
      const r = await withMainDb((db) => unsetLimit(db, WREN_LIMITS, { client, name }));
      console.log(`${name} (${client ?? "Wren-wide"}): ${shown(r.before)} -> unset`);
    });
}

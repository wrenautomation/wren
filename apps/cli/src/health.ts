/**
 * `wren health …` and `wren flags …` (designs/2026-10-07-health.md): each client's score, its
 * parts and inputs, its days; Wren's rating and an override; and the one list of flags. The same
 * domain calls as the Clients app, on the main database. Alerts go out on DeliveryWatch's pass.
 */
import type { Settings } from "@wren/config";
import { atomic, type Db, type Tx } from "@wren/db";
import {
  addressFlag,
  clearFlag,
  clearOverride,
  FLAG_SIDES,
  type FlagSide,
  healthPass,
  overrideHealth,
  ownFlag,
  raiseFlag,
  rateClient,
  syncFlags,
} from "@wren/delivery/health";
import type { Command } from "commander";
import { sql } from "drizzle-orm";
import { authorOf } from "./delivery.js";

type WithDb = <T>(fn: (db: Db) => Promise<T>) => Promise<T>;
type Row = Record<string, unknown>;

const s = (v: unknown) => (v === null || v === undefined ? "" : String(v));
const day = (v: unknown) => (v instanceof Date ? v.toISOString().slice(0, 10) : s(v).slice(0, 10));
/** Rows as aligned columns; nothing says "none". */
function table(rows: Row[], cols: [key: string, head: string][]): void {
  if (!rows.length) return void console.log("none");
  const cells = rows.map((r) => cols.map(([k]) => s(r[k])));
  const widths = cols.map(([, h], i) =>
    Math.max(h.length, ...cells.map((c) => (c[i] ?? "").length)),
  );
  const line = (c: string[]) =>
    c
      .map((x, i) => x.padEnd(widths[i] ?? 0))
      .join("  ")
      .trimEnd();
  console.log(line(cols.map(([, h]) => h)));
  for (const c of cells) console.log(line(c));
}
const whole = (v: string, what: string) => {
  const n = Number(v);
  if (!Number.isInteger(n)) throw new Error(`${what} is a whole number`);
  return n;
};
const flagId = (v: string) => {
  const n = Number(v);
  if (!Number.isSafeInteger(n) || n <= 0) throw new Error(`no flag ${v}`);
  return n;
};

export function registerHealth(program: Command, withMainDb: WithDb, settings: Settings): void {
  const by = (c: Command) =>
    c.option("--by <email>", "who's doing it (an operator; default: the only one)");
  const write = <T>(opts: { by?: string }, fn: (tx: Tx, who: string) => Promise<T>) =>
    withMainDb(async (main) => {
      const who = await authorOf(main, opts.by);
      return atomic(main, (tx) => fn(tx, who));
    });

  const health = program
    .command("health")
    .description("Client health: score, parts, inputs, days; rate and override");

  health
    .command("sync")
    .description(
      "Score every running client now and sync health's flags; alerts wait for the watch",
    )
    .action(() =>
      withMainDb(async (main) => {
        const now = new Date();
        const pass = await healthPass(main, settings.sendTimezone, now);
        const flags = await syncFlags(main, "health", pass.flags, now);
        console.log(
          `scored ${pass.scored}; flags raised ${flags.raised}, cleared ${flags.cleared}`,
        );
      }),
    );

  health
    .command("show [client]")
    .description("Every client's score, lowest first; with a client, its parts and inputs")
    .action((client?: string) =>
      withMainDb(async (main) => {
        if (!client) {
          const rows = await main.execute<Row>(sql`select id, score, band, model, override,
              results, engagement, sentiment, money, stale_parts, risks, opportunities
            from delivery.console_health order by score nulls first, id`);
          return table(rows, [
            ["id", "client"],
            ["score", "score"],
            ["band", "band"],
            ["model", "model"],
            ["override", "by hand"],
            ["results", "results"],
            ["engagement", "engagement"],
            ["sentiment", "sentiment"],
            ["money", "money"],
            ["stale_parts", "stale"],
            ["risks", "risks"],
            ["opportunities", "opps"],
          ]);
        }
        const [h] = await main.execute<Row>(
          sql`select * from delivery.console_health where id = ${client}`,
        );
        if (!h) throw new Error(`no score for ${client} yet: it's scored on the next pass`);
        console.log(`${s(h.name)}: ${s(h.score)} (${s(h.band)}), model ${s(h.model)}`);
        if (h.override !== null)
          console.log(`set by hand: ${s(h.override)} by ${s(h.override_by)}, ${s(h.reason)}`);
        console.log(`weights: ${s(h.weights)}`);
        if (s(h.stale_parts)) console.log(`stale: ${s(h.stale_parts)}`);
        for (const p of ["results", "engagement", "sentiment", "money"])
          console.log(`  ${p.padEnd(11)} ${s(h[p]).padStart(3)}  ${s(h[`${p}_why`])}`);
        console.log("");
        table(
          await main.execute<Row>(sql`select part, what, value, at, age, "rows"
            from delivery.console_health_inputs where client = ${client} order by id`),
          [
            ["part", "part"],
            ["what", "input"],
            ["value", "value"],
            ["age", "age"],
            ["rows", "rows"],
          ],
        );
      }),
    );

  health
    .command("history <client>")
    .description("A client's score a day, newest first")
    .option("--days <n>", "how many days", "30")
    .action((client: string, opts: { days: string }) =>
      withMainDb(async (main) => {
        const rows = await main.execute<Row>(sql`select day, score, model, override, band,
            results, engagement, sentiment, money, visited, stale_parts
          from delivery.console_health_days where client = ${client}
          order by day desc limit ${whole(opts.days, "--days")}`);
        table(
          rows.map((r) => ({ ...r, day: day(r.day) })),
          [
            ["day", "day"],
            ["score", "score"],
            ["model", "model"],
            ["override", "by hand"],
            ["band", "band"],
            ["results", "results"],
            ["engagement", "engagement"],
            ["sentiment", "sentiment"],
            ["money", "money"],
            ["visited", "visit"],
            ["stale_parts", "stale"],
          ],
        );
      }),
    );

  by(health.command("rate <client> <score>"))
    .description("Wren's 1 to 5 read of a client; it counts in sentiment from the next pass")
    .option("--note <text>", "why")
    .action((client: string, score: string, opts: { by?: string; note?: string }) =>
      write(opts, (db, who) =>
        rateClient(db, {
          clientId: client,
          score: whole(score, "a rating"),
          note: opts.note ?? null,
          by: who,
        }),
      ).then(() => console.log("rated")),
    );

  by(health.command("override <client> <score>"))
    .description("A score over the model's, shown beside it until cleared")
    .requiredOption("--reason <text>", "why")
    .action((client: string, score: string, opts: { by?: string; reason: string }) =>
      write(opts, (db, who) =>
        overrideHealth(db, {
          clientId: client,
          score: whole(score, "an override"),
          reason: opts.reason,
          by: who,
        }),
      ).then(() => console.log("set")),
    );

  by(health.command("clear-override <client>"))
    .description("Back to the model's score")
    .action((client: string, opts: { by?: string }) =>
      write(opts, (db, who) => clearOverride(db, client, who)).then(() => console.log("cleared")),
    );

  const flags = program
    .command("flags")
    .description("Client flags: risks and opportunities, raised to cleared");

  flags
    .command("list")
    .description("Open flags, newest first")
    .option("--all", "cleared ones too")
    .option("--for <client>", "one client's")
    .action((opts: { all?: boolean; for?: string }) =>
      withMainDb(async (main) => {
        const rows = await main.execute<Row>(sql`select id, client, side, state, source, urgent,
            owner, raised, what from delivery.console_flags
          where (${opts.all ?? false} or state <> 'cleared')
            and (${opts.for ?? null}::text is null or client = ${opts.for ?? null})
          order by raised desc, id desc`);
        table(
          rows.map((r) => ({ ...r, raised: day(r.raised) })),
          [
            ["id", "id"],
            ["client", "client"],
            ["side", "side"],
            ["state", "state"],
            ["source", "from"],
            ["urgent", "urgent"],
            ["owner", "owner"],
            ["raised", "raised"],
            ["what", "flag"],
          ],
        );
      }),
    );

  by(flags.command("raise <client> <side> <what...>"))
    .description("A person's flag: side is risk or opportunity")
    .option("--owner <email>", "who owns it; blank is the team")
    .action(
      (client: string, side: string, what: string[], opts: { by?: string; owner?: string }) => {
        if (!FLAG_SIDES.includes(side as FlagSide)) throw new Error("side is risk or opportunity");
        return write(opts, (db, who) =>
          raiseFlag(db, {
            clientId: client,
            side: side as FlagSide,
            what: what.join(" "),
            owner: opts.owner ?? null,
            by: who,
          }),
        ).then((f) => console.log(`flag ${f.id}`));
      },
    );

  by(flags.command("own <id> [email]"))
    .description("Assign a flag; no email is the team's")
    .action((id: string, email: string | undefined, opts: { by?: string }) =>
      write(opts, (db) => ownFlag(db, flagId(id), email ?? null)).then(() =>
        console.log("assigned"),
      ),
    );

  by(flags.command("address <id>"))
    .description(
      "Mark a flag addressed; it stays open until its cause clears or a person clears it",
    )
    .option("--note <text>", "what was done")
    .action((id: string, opts: { by?: string; note?: string }) =>
      write(opts, (db, who) => addressFlag(db, flagId(id), who, opts.note ?? null)).then(() =>
        console.log("addressed"),
      ),
    );

  by(flags.command("clear <id>"))
    .description("Clear a flag; it's kept with who cleared it")
    .action((id: string, opts: { by?: string }) =>
      write(opts, (db, who) => clearFlag(db, flagId(id), who)).then(() => console.log("cleared")),
    );
}

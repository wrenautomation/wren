/**
 * `wren offers|terms|journeys|deals|numbers …` (designs/2026-10-19-business-map.md): the version
 * store, the journeys and the numbers. Offers sync from the code registry (main only). The rest
 * follow `--client`. Amounts are read from the database and printed; none is written here, except
 * a deal's terms (`deals sign`). The shape itself is `wren shape` (`shape.ts`).
 *
 * Moves on a journey (`open`, `move`, `drop`, `assign`, `rebuild`) go through the worker's `Journeys`
 * service, so the shape's own step writes the row. Reads go to the database.
 *
 * `wren deals` is new here. The older Opportunities deals have no command, so nothing clashes.
 */
import { readFileSync } from "node:fs";
import { userInfo } from "node:os";
import type { Db } from "@wren/db";
import { OFFER_IDS, OFFERS, type Terms } from "@wren/offers";
import { signDeal } from "@wren/pipeline/moves";
import {
  dealScheduleOf,
  type NumberRow,
  type NumberWindow,
  numberRows,
} from "@wren/pipeline/numbers";
import { dealRows, journeyRows, trailOf } from "@wren/pipeline/records";
import type {
  AssignRequest,
  DropRequest,
  MoveRequest,
  OpenRequest,
  RebuildRequest,
} from "@wren/pipeline/restate";
import {
  addTerms,
  liveTerms,
  newestOffers,
  offerVersionsOf,
  Refused,
  syncOffers,
  termsHistory,
} from "@wren/pipeline/store";
import { type Command, InvalidArgumentError } from "commander";

type WithDb = <T>(fn: (db: Db) => Promise<T>) => Promise<T>;

/** How the CLI reaches the worker's `Journeys` service, and the workspace it acts in. */
export interface PipelineWrites {
  journeys(): {
    open(req: OpenRequest): Promise<unknown>;
    move(req: MoveRequest): Promise<unknown>;
    drop(req: DropRequest): Promise<unknown>;
    assign(req: AssignRequest): Promise<unknown>;
    rebuild(req: RebuildRequest): Promise<unknown>;
  };
  /** The client id the command acts for; null is Wren's. */
  client(): string | null;
}

/** `YYYY-MM-DD`, a real day. */
export function dayArg(v: string): string {
  const t = new Date(`${v}T00:00:00Z`).getTime();
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(v) ||
    Number.isNaN(t) ||
    new Date(t).toISOString().slice(0, 10) !== v
  )
    throw new InvalidArgumentError("use YYYY-MM-DD");
  return v;
}

/** A whole number, 1 or more. */
export function numberArg(v: string): number {
  const n = Number(v);
  if (!Number.isSafeInteger(n) || n < 1)
    throw new InvalidArgumentError("use a whole number, 1 or more");
  return n;
}

/** A JSON file's value. The message names the file. */
export function readJson(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (e) {
    throw new Error(`cannot read ${path} as JSON: ${(e as Error).message}`);
  }
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);

export const who = () => userInfo().username;
const day = (d: Date) => d.toISOString().slice(0, 10);

/** Run a store call; print a refusal's reasons, one per line, and set the exit code. */
export async function plain(fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
  } catch (e) {
    if (!(e instanceof Refused)) throw e;
    for (const m of e.errors) console.error(m);
    process.exitCode = 1;
  }
}

/** The worker's Journeys service, or a refusal when this CLI has no worker to call. */
function worker(writes: PipelineWrites | undefined) {
  if (!writes) throw new Refused(["No worker to call. Moves go through the Journeys service."]);
  return { api: writes.journeys(), client: writes.client() };
}

/** A worker call; its terminal error prints as a refusal. */
async function call(fn: () => Promise<unknown>) {
  try {
    console.log(JSON.stringify(await fn(), null, 2));
  } catch (e) {
    if (e instanceof Refused) throw e;
    console.error((e as Error).message);
    process.exitCode = 1;
  }
}

/**
 * `move <journey> <node> [--reason <text>]`: the one handler behind `wren journeys move` and
 * `wren shape move`. A move follows the edges of the journey's own shape version. With no path,
 * `--reason` forces it and the reason is kept on the trail.
 */
export function addMove(parent: Command, writes: PipelineWrites | undefined): void {
  parent
    .command("move <journey> <node>")
    .description("Move an open journey to a node: along the shape's edges, or forced with --reason")
    .option("--reason <text>", "why, when no edge path leads there: the move is forced")
    .action((journey: string, node: string, o: { reason?: string }) =>
      plain(async () => {
        const { api, client } = worker(writes);
        await call(() =>
          api.move({
            client,
            journey,
            to: node,
            by: who(),
            ...(o.reason ? { reason: o.reason } : {}),
          }),
        );
      }),
    );
}

export function registerPipeline(
  program: Command,
  withDb: WithDb,
  withMainDb: WithDb,
  writes?: PipelineWrites,
): void {
  const offers = program
    .command("offers")
    .description("offer versions: each shape the code registry has had (main database)");
  offers
    .command("sync")
    .description("Add a version for each registry offer whose shape changed; again changes nothing")
    .action(() =>
      plain(async () => {
        const r = await withMainDb((db) => syncOffers(db, OFFERS, who()));
        for (const a of r.added) console.log(`${a.offer}: version ${a.number}`);
        console.log(`${r.added.length} added, ${r.unchanged} unchanged`);
      }),
    );
  offers
    .command("list")
    .description("The newest version of each offer")
    .action(async () => {
      const rows = await withMainDb((db) => newestOffers(db));
      for (const r of rows)
        console.log(`${r.offer}  v${r.number}  ${r.hash.slice(0, 8)}  ${day(r.createdAt)}`);
      if (!rows.length) console.log("no versions; run `wren offers sync`");
    });
  offers
    .command("versions <offer>")
    .description("Every version of one offer, oldest first")
    .option("--json", "print each body")
    .action(async (offer: string, o: { json?: boolean }) => {
      const rows = await withMainDb((db) => offerVersionsOf(db, offer));
      for (const r of rows) {
        console.log(
          `v${r.number}  ${r.hash.slice(0, 8)}  ${day(r.createdAt)}  ${r.createdBy}  ${r.why}`,
        );
        if (o.json) console.log(JSON.stringify(r.body, null, 2));
      }
      if (!rows.length) console.log(`no versions of ${offer}`);
    });

  const terms = program
    .command("terms")
    .description("terms versions: one plan of one offer from one date");
  terms
    .command("add <offer>")
    .description("Add the next version of a plan. The file holds the Terms JSON")
    .requiredOption("--plan <plan>", "plan slug: standard, flat, partner-1")
    .requiredOption("--from <date>", "first day it applies, YYYY-MM-DD", dayArg)
    .requiredOption("--file <json>", "a file with the Terms JSON")
    .option("--why <text>", "the reason", "added by cli")
    .action((offer: string, o: { plan: string; from: string; file: string; why: string }) =>
      plain(async () => {
        if (!OFFER_IDS.has(offer)) throw new Refused([`"${offer}" is not in the offer registry.`]);
        const body = readJson(o.file);
        if (!isObject(body)) throw new Refused(["The file must hold a Terms JSON object."]);
        const row = await withDb((db) =>
          addTerms(db, {
            offer,
            plan: o.plan,
            from: o.from,
            body: body as unknown as Terms,
            why: o.why,
            by: who(),
          }),
        );
        console.log(`${offer} ${row.plan} v${row.number} from ${row.effectiveFrom}`);
      }),
    );
  terms
    .command("show <offer>")
    .description("A plan's versions, or the one live on a date")
    .option("--plan <plan>", "one plan")
    .option("--at <date>", "the version live on this day", dayArg)
    .action(async (offer: string, o: { plan?: string; at?: string }) => {
      await withDb(async (db) => {
        const all = await termsHistory(db, offer, o.plan);
        if (!all.length) {
          console.log(`no terms for ${offer}${o.plan ? ` ${o.plan}` : ""}`);
          return;
        }
        const rows = o.at
          ? (
              await Promise.all(
                [...new Set(all.map((r) => r.plan))].map((p) =>
                  liveTerms(db, offer, p, o.at ?? ""),
                ),
              )
            ).flatMap((r) => (r ? [r] : []))
          : all;
        if (!rows.length) console.log(`nothing live on ${o.at}`);
        for (const r of rows) {
          console.log(`${r.plan} v${r.number} from ${r.effectiveFrom}  ${r.createdBy}  ${r.why}`);
          console.log(JSON.stringify(r.body, null, 2));
        }
      });
    });

  const journeys = program
    .command("journeys")
    .description("journeys: one person's way through the shape");
  journeys
    .command("open")
    .description("Open a journey at a source node that takes people by hand, or the first")
    .requiredOption("--person <key>", "profile id, email, +phone, or kind:value")
    .option("--at <node>", "a source node id; the first when left out")
    .option("--entry <id>", "how they came: a source node id")
    .action((o: { person: string; at?: string; entry?: string }) =>
      plain(async () => {
        const { api, client } = worker(writes);
        await call(() =>
          api.open({
            client,
            person: o.person,
            by: who(),
            ...(o.at ? { at: o.at } : {}),
            ...(o.entry ? { entry: o.entry } : {}),
          }),
        );
      }),
    );
  addMove(journeys, writes);
  journeys
    .command("drop <journey>")
    .description("End an open journey")
    .requiredOption("--reason <text>", "why it ends here")
    .action((journey: string, o: { reason: string }) =>
      plain(async () => {
        const { api, client } = worker(writes);
        await call(() => api.drop({ client, journey, reason: o.reason, by: who() }));
      }),
    );
  journeys
    .command("assign <journey>")
    .description("Give a journey to a team member, or to nobody")
    .option("--to <email>", "a team member's email")
    .option("--clear", "give it to nobody")
    .action((journey: string, o: { to?: string; clear?: boolean }) =>
      plain(async () => {
        if (!o.to === !o.clear) throw new Refused(["Give --to <email> or --clear, not both."]);
        const { api, client } = worker(writes);
        await call(() =>
          api.assign({ client, journey, to: o.clear ? null : (o.to ?? null), by: who() }),
        );
      }),
    );
  journeys
    .command("rebuild <journey>")
    .description("Recompute the journey row from its spine events")
    .action((journey: string) =>
      plain(async () => {
        const { api, client } = worker(writes);
        await call(() => api.rebuild({ client, journey }));
      }),
    );
  journeys
    .command("show <journey>")
    .description("One journey: its row, its trail of arrivals, its deal")
    .action(async (id: string) => {
      const found = await withDb(async (db) => {
        const [row] = await journeyRows(db, { id });
        if (!row) return null;
        return {
          row,
          trail: await trailOf(db, id),
          deals: (await dealRows(db)).filter((d) => d.journey === id),
        };
      });
      if (!found) {
        console.error(`no journey ${id}`);
        process.exitCode = 1;
        return;
      }
      console.log(JSON.stringify(found.row, null, 2));
      for (const t of found.trail)
        console.log(
          `${t.at.toISOString()}  ${t.node.replace(/^s_/, "")}  ${t.cause ?? "-"}${t.ref ? ` ${t.ref}` : ""}  ${t.workflow}`,
        );
      for (const d of found.deals) console.log(`deal ${d.id}  ${d.offer}  ${d.status}`);
    });
  journeys
    .command("list")
    .description("Journeys, newest move first")
    .option("--node <id>", "one node")
    .option("--status <status>", "open, done or dropped")
    .option("--ghost", "only journeys on a node the newest shape no longer has")
    .option("--limit <n>", "how many", numberArg, 50)
    .action(async (o: { node?: string; status?: string; ghost?: boolean; limit: number }) => {
      const rows = (await withDb((db) => journeyRows(db)))
        .filter(
          (r) =>
            (!o.node || r.node === o.node) &&
            (!o.status || r.status === o.status) &&
            (!o.ghost || r.ghost),
        )
        .slice(0, o.limit);
      for (const r of rows)
        console.log(
          `${r.id}  ${r.name}  v${r.version ?? "-"}  ${r.node_name} (${r.node})  ${r.status}${r.flag ? ` (${r.flag})` : ""}${r.ghost ? ` (${r.ghost})` : ""}  ${r.days_at_node}d${r.owner ? `  ${r.owner}` : ""}`,
        );
      if (!rows.length) console.log("no journeys");
    });

  const deals = program.command("deals").description("pipeline deals: offer, terms and money");
  deals
    .command("list")
    .description("Deals, newest first")
    .option("--status <status>", "one status")
    .action(async (o: { status?: string }) => {
      const rows = (await withDb((db) => dealRows(db))).filter(
        (d) => !o.status || d.status === o.status,
      );
      for (const d of rows)
        console.log(
          `${d.id}  ${d.name}  ${d.offer} v${d.offer_version}  ${d.plan ? `${d.plan} v${d.terms_number}` : "no terms"}  ${d.status}  collected ${d.collected} ${d.currency}`,
        );
      if (!rows.length) console.log("no deals");
    });
  deals
    .command("sign <deal>")
    .description("Set a deal's terms from a plan's live terms. Terms are set once")
    .requiredOption("--plan <plan>", "plan slug: standard, flat, partner-1")
    .option("--force", "change terms already set; the change is audited")
    .action((deal: string, o: { plan: string; force?: boolean }) =>
      plain(async () => {
        const r = await withDb((db) =>
          signDeal(db, { deal, plan: o.plan, force: o.force === true }),
        );
        console.log(r.changed ? `${r.deal}: terms ${r.termsVersion}` : `${r.deal}: no change`);
      }),
    );
  deals
    .command("schedule <deal>")
    .description("The dated lines a deal's signed terms imply")
    .action(async (id: string) => {
      const r = await withDb((db) => dealScheduleOf(db, id));
      if (!r) {
        console.error(`no deal ${id}`);
        process.exitCode = 1;
        return;
      }
      if (!r.signed) console.log("no terms signed yet; run `wren deals sign`");
      for (const l of r.lines) {
        if (l.kind === "setup" || l.kind === "monthly")
          console.log(
            `${l.on}  ${l.kind}${l.kind === "setup" && l.part ? ` ${l.part.n}/${l.part.of}` : ""}  ${(l.cents / 100).toFixed(2)} ${l.currency}`,
          );
        else if (l.kind === "unit")
          console.log(
            `as it happens  ${l.unit ?? "unit"}  ${(l.centsEach / 100).toFixed(2)} ${l.currency} each${l.capCents === null ? "" : `, cap ${(l.capCents / 100).toFixed(2)}`}`,
          );
        else console.log(`on reported revenue  ${l.bps / 100}%  ${l.currency}`);
      }
    });

  program
    .command("numbers")
    .description("Shape numbers: per node, per edge, per offer. All time unless cut")
    .option("--source <id>", "one source node: its opened journeys, deals and cost")
    .option("--offer <id>", "one offer")
    .option("--window <days>", "the last 7, 30 or 90 days, or all", windowArg)
    .option("--from <date>", "first day, YYYY-MM-DD", dayArg)
    .option("--to <date>", "last day, YYYY-MM-DD", dayArg)
    .option("--json", "print rows as JSON")
    .action(
      async (o: {
        source?: string;
        offer?: string;
        window?: NumberWindow;
        from?: string;
        to?: string;
        json?: boolean;
      }) => {
        const rows = ownKinds(
          await withDb((db) =>
            numberRows(db, {
              ...(o.source ? { source: o.source } : {}),
              ...(o.offer ? { offer: o.offer } : {}),
              ...(o.window ? { window: o.window } : {}),
              ...(o.from ? { from: o.from } : {}),
              ...(o.to ? { to: o.to } : {}),
            }),
          ),
        );
        if (o.json) {
          console.log(JSON.stringify(rows, null, 2));
          return;
        }
        for (const line of numberLines(rows)) console.log(line);
        if (!rows.length) console.log("no numbers");
      },
    );
}

/**
 * The rows a shape lists as it is stored. A graph newest also answers station, track and line rows
 * for the Map; here they would repeat its node and edge rows, so they go. A metro newest has no
 * node rows and keeps its own.
 */
export function ownKinds(rows: readonly NumberRow[]): NumberRow[] {
  if (!rows.some((r) => r.kind === "node")) return [...rows];
  return rows.filter((r) => r.kind === "node" || r.kind === "edge" || r.kind === "offer");
}

/** `7`, `30`, `90` or `all`. */
export function windowArg(v: string): NumberWindow {
  if (v === "all") return "all";
  if (v === "7" || v === "30" || v === "90") return Number(v) as NumberWindow;
  throw new InvalidArgumentError("use 7, 30, 90 or all");
}

/** The numbers as text lines, one per row. */
export function numberLines(rows: readonly NumberRow[]): string[] {
  const pct = (n: number | null) => (n === null ? "-" : String(n));
  const days = (n: number | null) => (n === null ? "-" : `${Math.round(n * 10) / 10}d`);
  return rows.map((r) => {
    if (r.kind === "edge") return `edge  ${r.label}  ${r.name}  crossed ${pct(r.crossings)}`;
    if (r.kind === "offer")
      return `offer  ${r.label}  deals ${pct(r.deals)}  collected ${pct(r.collected)}  scheduled ${pct(r.scheduled)} ${r.currency ?? ""}`.trimEnd();
    if (r.nodeKind === "source")
      return `source  ${r.label}  ${r.name}  opened ${pct(r.opened)}  deals ${pct(r.deals)}  collected ${pct(r.collected)}  cost ${pct(r.cost)}`;
    const plan =
      r.deals === null
        ? ""
        : `  deals ${pct(r.deals)}  collected ${pct(r.collected)}  scheduled ${pct(r.scheduled)} ${r.currency ?? ""}`.trimEnd();
    return `${r.nodeKind ?? "node"}  ${r.label}  ${r.position}. ${r.name}  arrived ${pct(r.arrived)}  skipped ${pct(r.skipped)}  left ${pct(r.left)}  now ${pct(r.now)}  median ${days(r.medianDays)}${plan ? `  ${plan.trim()}` : ""}`;
  });
}

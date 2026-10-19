/**
 * `wren offers|terms|funnels|journeys|deals|pipeline|numbers …` (designs/2026-10-18-journeys.md): the
 * version store, the journeys and the numbers. Offers sync from the code registry (main only).
 * The rest follow `--client`. Amounts are read from the database and printed; none is written
 * here, except a deal's terms (`deals sign`).
 *
 * Moves on a journey (`open`, `move`, `drop`, `rebuild`) go through the worker's `Journeys`
 * service, so the funnel's own step writes the row. Reads go to the database.
 *
 * `wren deals` is new here. The older Opportunities deals have no command, so nothing clashes.
 */
import { readFileSync } from "node:fs";
import { userInfo } from "node:os";
import { LOGIC } from "@wren/core/logic";
import type { Db } from "@wren/db";
import { OFFER_IDS, OFFERS, type Terms } from "@wren/offers";
import type { FunnelBody } from "@wren/pipeline/model";
import { signDeal } from "@wren/pipeline/moves";
import { dealScheduleOf, numberRows } from "@wren/pipeline/numbers";
import { dealRows, journeyRows, trailOf } from "@wren/pipeline/records";
import type { DropRequest, MoveRequest, OpenRequest, RebuildRequest } from "@wren/pipeline/restate";
import {
  addFunnel,
  addTerms,
  appendFunnel,
  funnelVersionsOf,
  liveTerms,
  newestOffers,
  offerVersionsOf,
  Refused,
  setFunnelStatus,
  syncOffers,
  termsHistory,
} from "@wren/pipeline/store";
import { type Command, InvalidArgumentError } from "commander";
import { type OnClient, registerPipelineFold } from "./pipeline-fold.js";
import { registerPipelineSeed } from "./pipeline-seed.js";

type WithDb = <T>(fn: (db: Db) => Promise<T>) => Promise<T>;

/** How the CLI reaches the worker's `Journeys` service, and the workspace it acts in. */
export interface PipelineWrites {
  journeys(): {
    open(req: OpenRequest): Promise<unknown>;
    move(req: MoveRequest): Promise<unknown>;
    drop(req: DropRequest): Promise<unknown>;
    rebuild(req: RebuildRequest): Promise<unknown>;
  };
  /** The client id the command acts for; null is Wren's. */
  client(): string | null;
}

/** Trigger component ids a stage may name. */
const triggerIds = (): ReadonlySet<string> =>
  new Set(LOGIC.filter((l) => l.group === "trigger").map((l) => l.id));

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

/**
 * A funnel file is `{ id, name?, why?, body }` for `add`. For `append` it is the body itself or
 * `{ why?, body }`. A value with `stages` is taken as the body.
 */
export function funnelFile(raw: unknown): {
  id?: string;
  name?: string;
  why?: string;
  body: FunnelBody;
} {
  if (!isObject(raw)) throw new Error("the file must hold a JSON object");
  const bare = Array.isArray(raw.stages);
  const body = bare ? raw : raw.body;
  if (!isObject(body) || !Array.isArray(body.stages))
    throw new Error("the file needs a body with stages");
  const str = (k: string) => (!bare && typeof raw[k] === "string" ? (raw[k] as string) : undefined);
  const id = str("id");
  const name = str("name");
  const why = str("why");
  return {
    ...(id ? { id } : {}),
    ...(name ? { name } : {}),
    ...(why ? { why } : {}),
    body: body as unknown as FunnelBody,
  };
}

const who = () => userInfo().username;
const day = (d: Date) => d.toISOString().slice(0, 10);

/** Run a store call; print a refusal's reasons, one per line, and set the exit code. */
async function plain(fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
  } catch (e) {
    if (!(e instanceof Refused)) throw e;
    for (const m of e.errors) console.error(m);
    process.exitCode = 1;
  }
}

export function registerPipeline(
  program: Command,
  withDb: WithDb,
  withMainDb: WithDb,
  writes?: PipelineWrites,
  onClient?: OnClient,
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

  const funnels = program.command("funnels").description("funnels and their versions");
  funnels
    .command("list")
    .description("Each funnel: status and newest version")
    .action(async () => {
      const rows = await withDb((db) => funnelVersionsOf(db, { newest: true }));
      for (const r of rows)
        console.log(
          `${r.funnel}  ${r.status}  v${r.number}  ${r.body.stages.length} stages  ${r.name}`,
        );
      if (!rows.length) console.log("no funnels");
    });
  funnels
    .command("add")
    .description("A new funnel and its version 1. The file holds { id, name?, why?, body }")
    .requiredOption("--file <json>", "the funnel file")
    .action((o: { file: string }) =>
      plain(async () => {
        const f = funnelFile(readJson(o.file));
        if (!f.id) throw new Refused(["The file needs an id."]);
        const id = f.id;
        const row = await withDb((db) =>
          addFunnel(db, {
            id,
            name: f.name ?? f.body.name,
            body: f.body,
            why: f.why ?? "added by cli",
            by: who(),
            triggers: triggerIds(),
          }),
        );
        console.log(`${row.funnel} v${row.number}`);
      }),
    );
  funnels
    .command("append <funnel>")
    .description("The next version. The file is the body, or { why?, body }")
    .requiredOption("--file <json>", "the funnel file")
    .option("--why <text>", "the reason")
    .action((id: string, o: { file: string; why?: string }) =>
      plain(async () => {
        const f = funnelFile(readJson(o.file));
        const row = await withDb((db) =>
          appendFunnel(db, id, f.body, o.why ?? f.why ?? "appended by cli", who(), triggerIds()),
        );
        console.log(`${row.funnel} v${row.number}`);
      }),
    );
  funnels
    .command("show <funnel>")
    .description("A funnel's newest version, or --version n")
    .option("--version <n>", "a version number", numberArg)
    .action(async (id: string, o: { version?: number }) => {
      const rows = await withDb((db) => funnelVersionsOf(db, { funnel: id }));
      const r = o.version ? rows.find((x) => x.number === o.version) : rows.at(-1);
      if (!r) {
        console.error(rows.length ? `${id} has no version ${o.version}` : `no funnel ${id}`);
        process.exitCode = 1;
        return;
      }
      console.log(`${r.funnel} v${r.number} (${r.status})  ${r.createdBy}  ${r.why}`);
      console.log(JSON.stringify(r.body, null, 2));
    });
  for (const [name, status, blurb] of [
    ["off", "off", "Stop new journeys. Open ones still move"],
    ["on", "live", "Let new journeys open again"],
  ] as const)
    funnels
      .command(`${name} <funnel>`)
      .description(blurb)
      .action((id: string) =>
        plain(async () => {
          const f = await withDb((db) => setFunnelStatus(db, id, status));
          console.log(`${f.id} is ${f.status}`);
        }),
      );

  /** The worker's Journeys service, or a refusal when this CLI has no worker to call. */
  const worker = () => {
    if (!writes) throw new Refused(["No worker to call. Moves go through the Journeys service."]);
    return { api: writes.journeys(), client: writes.client() };
  };
  /** A worker call; its terminal error prints as a refusal. */
  const call = async (fn: () => Promise<unknown>) => {
    try {
      console.log(JSON.stringify(await fn(), null, 2));
    } catch (e) {
      if (e instanceof Refused) throw e;
      console.error((e as Error).message);
      process.exitCode = 1;
    }
  };

  const journeys = program
    .command("journeys")
    .description("journeys: one person's way through a funnel");
  journeys
    .command("open <funnel>")
    .description("Open a journey at an entry stage of the funnel's newest version")
    .requiredOption("--person <key>", "profile id, email, +phone, or kind:value")
    .option("--at <stage>", "an entry stage; the first when left out")
    .option("--entry <id>", "how they came: an entry id of the funnel")
    .action((funnel: string, o: { person: string; at?: string; entry?: string }) =>
      plain(async () => {
        const { api, client } = worker();
        await call(() =>
          api.open({
            client,
            funnel,
            person: o.person,
            by: who(),
            ...(o.at ? { at: o.at } : {}),
            ...(o.entry ? { entry: o.entry } : {}),
          }),
        );
      }),
    );
  journeys
    .command("move <journey> <stage>")
    .description("Move an open journey forward to a later stage")
    .action((journey: string, stage: string) =>
      plain(async () => {
        const { api, client } = worker();
        await call(() => api.move({ client, journey, to: stage, by: who() }));
      }),
    );
  journeys
    .command("drop <journey>")
    .description("End an open journey")
    .requiredOption("--reason <text>", "why it ends here")
    .action((journey: string, o: { reason: string }) =>
      plain(async () => {
        const { api, client } = worker();
        await call(() => api.drop({ client, journey, reason: o.reason, by: who() }));
      }),
    );
  journeys
    .command("rebuild <journey>")
    .description("Recompute the journey row from its spine events")
    .action((journey: string) =>
      plain(async () => {
        const { api, client } = worker();
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
    .option("--funnel <id>", "one funnel")
    .option("--stage <stage>", "one stage")
    .option("--status <status>", "open, done or dropped")
    .option("--limit <n>", "how many", numberArg, 50)
    .action(async (o: { funnel?: string; stage?: string; status?: string; limit: number }) => {
      const rows = (await withDb((db) => journeyRows(db)))
        .filter(
          (r) =>
            (!o.funnel || r.funnel === o.funnel) &&
            (!o.stage || r.stage === o.stage) &&
            (!o.status || r.status === o.status),
        )
        .slice(0, o.limit);
      for (const r of rows)
        console.log(
          `${r.id}  ${r.name}  ${r.funnel} v${r.version}  ${r.stage}  ${r.status}${r.flag ? ` (${r.flag})` : ""}  ${r.days_in_stage}d`,
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

  registerPipelineSeed(program, withDb, writes);
  if (onClient) registerPipelineFold(program, withMainDb, onClient);

  program
    .command("numbers")
    .description("Journey numbers: per funnel stage, per entry, per offer. All time unless cut")
    .option("--funnel <id>", "one funnel")
    .option("--entry <id>", "one entry")
    .option("--offer <id>", "one offer")
    .option("--from <date>", "first day, YYYY-MM-DD", dayArg)
    .option("--to <date>", "last day, YYYY-MM-DD", dayArg)
    .option("--json", "print rows as JSON")
    .action(
      async (o: {
        funnel?: string;
        entry?: string;
        offer?: string;
        from?: string;
        to?: string;
        json?: boolean;
      }) => {
        const rows = await withDb((db) =>
          numberRows(db, {
            ...(o.funnel ? { funnel: o.funnel } : {}),
            ...(o.entry ? { entry: o.entry } : {}),
            ...(o.offer ? { offer: o.offer } : {}),
            ...(o.from ? { from: o.from } : {}),
            ...(o.to ? { to: o.to } : {}),
          }),
        );
        if (o.json) {
          console.log(JSON.stringify(rows, null, 2));
          return;
        }
        const pct = (n: number | null) => (n === null ? "-" : `${Math.round(n * 100)}%`);
        const n = (v: number | null) => (v === null ? "-" : String(v));
        for (const r of rows) {
          if (r.kind === "stage")
            console.log(
              `stage  ${r.funnel}  ${r.position}. ${r.label}  entered ${n(r.entered)}  skipped ${n(r.skipped)}  on ${pct(r.conversion)}  median ${r.medianSeconds === null ? "-" : `${Math.round(r.medianSeconds / 3600)}h`}`,
            );
          else if (r.kind === "entry")
            console.log(
              `entry  ${r.funnel}  ${r.label}  opened ${n(r.opened)}  deals ${n(r.deals)}  collected ${n(r.collected)}  cost ${n(r.cost)}`,
            );
          else
            console.log(
              `offer  ${r.label}  deals ${n(r.deals)}  collected ${n(r.collected)}  scheduled ${n(r.scheduled)} ${r.currency ?? ""}`,
            );
        }
        if (!rows.length) console.log("no numbers");
      },
    );
}

/**
 * `wren offers|terms|funnels …` (designs/2026-10-18-journeys.md): the version store. Offers sync
 * from the code registry (main only). Terms and funnels follow `--client`. Amounts are read from
 * the database and printed; none is written here.
 */
import { readFileSync } from "node:fs";
import { userInfo } from "node:os";
import { LOGIC } from "@wren/core/logic";
import type { Db } from "@wren/db";
import { OFFER_IDS, OFFERS, type Terms } from "@wren/offers";
import type { FunnelBody } from "@wren/pipeline/model";
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

type WithDb = <T>(fn: (db: Db) => Promise<T>) => Promise<T>;

/** Trigger component ids a stage may name. */
const triggerIds = (): ReadonlySet<string> =>
  new Set(LOGIC.filter((l) => l.group === "trigger").map((l) => l.id));

/** `YYYY-MM-DD`, a real day. */
export function dayArg(v: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v) || new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) !== v)
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

export function registerPipeline(program: Command, withDb: WithDb, withMainDb: WithDb): void {
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
        for (const a of r.reverted)
          console.log(`${a.offer}: back to the shape of version ${a.number}; no row written`);
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
}

/**
 * `wren lake …`: Wren's data lake and warehouse (designs/2026-10-11-lake.md). `sync` copies what
 * changed in every database, `build` runs the warehouse's models, `sql` asks anything (as of any
 * time), `status` says what's there. CI runs `sync --public` then `build` nightly
 * (`.github/workflows/lake.yml`); its logs are public, so `--public` names no client.
 */
import { resolve } from "node:path";
import type { Settings } from "@wren/config";
import { listClients } from "@wren/core/clients";
import { clientAdminUrl, createDb, type Db } from "@wren/db";
import type { Command } from "commander";
import { sql } from "drizzle-orm";
import {
  buildModels,
  compact,
  type Lake,
  openLake,
  query,
  status,
  syncDatabase,
} from "./lake-sync.js";

type WithDb = <T>(fn: (db: Db) => Promise<T>) => Promise<T>;
const CATALOG = "wren_lake";

/** The catalog's URL: the setting, else `wren_lake` beside the main database. */
export function catalogUrl(settings: Settings): string {
  if (settings.lakeCatalogUrl) return settings.lakeCatalogUrl;
  const url = new URL(settings.databaseUrl);
  url.pathname = `/${CATALOG}`;
  return url.toString();
}

/** The catalog database, made once beside main (closed to every other login, as client databases are). */
async function ensureCatalog(settings: Settings) {
  if (settings.lakeCatalogUrl) return;
  const h = createDb(settings.databaseUrl, { max: 1, app: "wren-lake" });
  try {
    const found = await h.db.execute(sql`select 1 from pg_database where datname = ${CATALOG}`);
    if (found.length > 0) return;
    await h.db.execute(sql.raw(`CREATE DATABASE "${CATALOG}"`));
    await h.db.execute(sql.raw(`REVOKE CONNECT, TEMPORARY ON DATABASE "${CATALOG}" FROM PUBLIC`));
  } finally {
    await h.close();
  }
}

async function withLake<T>(
  settings: Settings,
  o: { readOnly?: boolean; at?: string },
  fn: (lake: Lake) => Promise<T>,
): Promise<T> {
  if (!settings.lakePath) throw new Error("needs WREN_LAKE_PATH (s3://<bucket>/ or a directory)");
  if (!o.readOnly) await ensureCatalog(settings);
  const lake = await openLake({
    dataPath: settings.lakePath,
    catalogUrl: catalogUrl(settings),
    ...(settings.lakeTrackPath ? { trackPath: settings.lakeTrackPath } : {}),
    ...o,
  });
  try {
    return await fn(lake);
  } finally {
    lake.close();
  }
}

const mb = (b: unknown) => `${(Number(b) / 1_048_576).toFixed(1)} MB`;

export function registerLake(program: Command, withMainDb: WithDb, settings: Settings) {
  const cmd = program
    .command("lake")
    .description("the data lake and warehouse: every database, all history");

  cmd
    .command("sync")
    .description("Copy what changed in Wren's database and every client's into the lake")
    .option("--main", "only Wren's database (with --client: only that client's)")
    .option("--table <name>", "only tables of this name")
    .option("--public", "logs others can read: no client ids, no table names")
    .option("--json", "results as JSON")
    .action(async (o: { main?: boolean; table?: string; public?: boolean; json?: boolean }) => {
      const client = program.opts<{ client?: string }>().client;
      const clients = o.main && !client ? [] : await withMainDb((db) => listClients(db));
      const targets: { owner: string | null; url: string }[] = [];
      if (!client) targets.push({ owner: null, url: settings.databaseUrl });
      for (const c of clients)
        if (!client || c.id === client)
          targets.push({ owner: c.id, url: clientAdminUrl(settings.databaseUrl, c.database) });
      if (client && targets.length === 0) throw new Error(`no client ${client}`);
      const only = o.table ? (t: { name: string }) => t.name === o.table : undefined;
      const results = await withLake(settings, {}, async (lake) => {
        const out = [];
        for (const [i, t] of targets.entries()) {
          const db = t.owner === null ? "wren" : o.public ? `client ${i}` : `client ${t.owner}`;
          let n = 0;
          // Progress on stderr, so --json stays clean. Public logs get no table names.
          const progress = (r: { table: string; result: string }, ms: number) =>
            console.error(`  ${db} ${++n}: ${o.public ? "" : `${r.table} `}${r.result}, ${ms} ms`);
          out.push(await syncDatabase(lake, t.url, t.owner, only, progress));
        }
        const began = Date.now();
        await compact(lake);
        console.error(`  compacted, ${Date.now() - began} ms`);
        return out;
      });
      if (o.json) return console.log(JSON.stringify(results, null, 2));
      let failed = 0;
      for (const [i, r] of results.entries()) {
        const n = (k: string) => r.tables.filter((t) => t.result === k).length;
        const sum = (k: "upserted" | "removed") => r.tables.reduce((a, t) => a + t[k], 0);
        const name = r.owner === null ? "wren" : o.public ? `client ${i}` : `client ${r.owner}`;
        console.log(
          `${name}: ${r.tables.length} tables, ${n("created")} created, ${n("changed")} changed, ${n("unchanged")} unchanged, ${n("failed")} failed; ${sum("upserted")} rows in, ${sum("removed")} out; ${Math.round(r.ms / 1000)} s`,
        );
        for (const t of r.tables.filter((t) => t.result === "failed")) {
          failed++;
          console.log(o.public ? "  a table failed" : `  ${t.table}: ${t.error}`);
        }
      }
      if (failed) process.exitCode = 1;
    });

  cmd
    .command("build")
    .description("Rebuild the warehouse: every model in lake/models, in name order")
    .option("--dir <dir>", "the models", "lake/models")
    .action(async (o: { dir: string }) => {
      const built = await withLake(settings, {}, (lake) =>
        buildModels(lake, resolve(o.dir), {
          ...(settings.lakeTrackPath ? { trackPath: settings.lakeTrackPath } : {}),
          onSkip: (model, why) => console.log(`${model}: skipped, ${why}`),
        }),
      );
      for (const m of built) console.log(`${m.model}: ${m.ms} ms`);
    });

  cmd
    .command("sql <query>")
    .description(
      "Ask the lake. Tables are <schema>.<table>: wren.runs, client_<id>.leads, warehouse.<model>",
    )
    .option("--at <when>", "as it was: an ISO time or a snapshot number")
    .option("--json", "rows as JSON")
    .action(async (q: string, o: { at?: string; json?: boolean }) => {
      const got = await withLake(
        settings,
        { readOnly: true, ...(o.at ? { at: o.at } : {}) },
        (lake) => query(lake, q),
      );
      if (o.json) return console.log(JSON.stringify(got, null, 2));
      if (!got.length) return console.log("(no rows)");
      console.table(got);
    });

  cmd
    .command("status")
    .description("What the lake holds: tables by size, the newest snapshot")
    .option("--json", "as JSON")
    .action(async (o: { json?: boolean }) => {
      const s = await withLake(settings, { readOnly: true }, (lake) => status(lake));
      if (o.json) return console.log(JSON.stringify(s, null, 2));
      const bytes = s.tables.reduce((a, t) => a + Number(t.bytes), 0);
      console.log(
        `${s.tables.length} tables, ${mb(bytes)}; newest snapshot ${s.last?.snapshot_id ?? "-"} at ${s.last?.snapshot_time ?? "-"}`,
      );
      for (const t of s.tables.slice(0, 15))
        console.log(`  ${t.schema}.${t.table}: ${t.files} files, ${mb(t.bytes)}`);
    });
}

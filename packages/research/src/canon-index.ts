/**
 * Canon's prod index (designs/2026-11-12-canon-references.md, D1 option C). Git is the truth; schema
 * `canon` is a copy any pass can rebuild. The box keeps a bare clone, fetches `main` on each push
 * (GitHub webhook → phone Worker → `CanonIndexSync/<repo>/sync`) and hourly, then runs knowledge's
 * diff sync as `canon_index`: a login that writes schema `canon` only. Main reads it.
 */
import { execFileSync } from "node:child_process";
import { createHmac } from "node:crypto";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import type { Notifier } from "@wren/core/notify";
import { exclusiveHandler, makeLoopObject, NO_INPUT, runPass } from "@wren/core/restate";
import { createDb, type Db, scramVerifier } from "@wren/db";
import * as restate from "@wren/runtime";
import { type Db as IndexDb, RecordIndex, type Synced } from "@wrenautomation/knowledge";
import { sql } from "drizzle-orm";

export const CANON_SCHEMA = "canon";
export const CANON_ROLE = "canon_index";
const HOUR_MS = 3_600_000;

/** Derived from main's password, as client logins are: no secret to store or rotate. */
export function canonIndexUrl(mainUrl: string): string {
  const url = new URL(mainUrl);
  if (!url.password)
    throw new Error("main's database URL has no password; canon_index derives its own");
  const password = createHmac("sha256", decodeURIComponent(url.password))
    .update(`wren canon index:${CANON_ROLE}`)
    .digest("hex");
  url.username = CANON_ROLE;
  url.password = password;
  return url.toString();
}

/**
 * Schema, login and grants, as main (a superuser). Safe to run each pass. `canon_index` owns what it
 * makes, sees only `canon` (search_path), and every table it makes is readable by main, a rebuild's
 * new tables too (default privileges).
 */
export async function ensureCanonIndex(main: Db, mainUrl: string): Promise<void> {
  const reader = new URL(mainUrl).username;
  const password = new URL(canonIndexUrl(mainUrl)).password;
  const run = (text: string) => main.execute(sql.raw(text));
  const attrs = "LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS";
  const found = await main.execute(sql`select 1 from pg_roles where rolname = ${CANON_ROLE}`);
  if (found.length === 0) await run(`CREATE ROLE ${CANON_ROLE} ${attrs}`);
  await run(`ALTER ROLE ${CANON_ROLE} ${attrs} PASSWORD '${scramVerifier(password)}'`);
  await run(`ALTER ROLE ${CANON_ROLE} SET search_path = ${CANON_SCHEMA}`);
  await run(`CREATE SCHEMA IF NOT EXISTS ${CANON_SCHEMA}`);
  const [db] = await main.execute<{ name: string }>(sql`select current_database() as name`);
  await run(
    `GRANT CONNECT ON DATABASE "${(db?.name ?? "").replaceAll('"', '""')}" TO ${CANON_ROLE}`,
  );
  await run(`GRANT USAGE, CREATE ON SCHEMA ${CANON_SCHEMA} TO ${CANON_ROLE}`);
  const as = `"${reader.replaceAll('"', '""')}"`;
  await run(
    `ALTER DEFAULT PRIVILEGES FOR ROLE ${CANON_ROLE} IN SCHEMA ${CANON_SCHEMA} GRANT SELECT ON TABLES TO ${as}`,
  );
  await run(`GRANT SELECT ON ALL TABLES IN SCHEMA ${CANON_SCHEMA} TO ${as}`);
}

export interface CanonCheckout {
  /** Where bare clones live; one folder per repo. */
  dir: string;
  /** `https://github.com/<owner>/<repo>.git`, or a local path (tests). */
  remote: string;
  /** A GitHub token with contents read on the repo; null for a local path. */
  token: string | null;
}

/** The bare clone at `main`'s tip: cloned once, then fetched (new objects only). */
export function fetchCanon(repo: string, c: CanonCheckout): string {
  mkdirSync(c.dir, { recursive: true, mode: 0o700 });
  // the token rides in env-only git config: never in argv, the remote URL or the clone's config
  const auth = c.token
    ? {
        GIT_CONFIG_COUNT: "1",
        GIT_CONFIG_KEY_0: "http.extraHeader",
        GIT_CONFIG_VALUE_0: `Authorization: Basic ${Buffer.from(`x-access-token:${c.token}`).toString("base64")}`,
      }
    : {};
  const env = { ...process.env, GIT_TERMINAL_PROMPT: "0", ...auth };
  const git = (args: string[], cwd?: string) =>
    execFileSync("git", args, { env, ...(cwd ? { cwd } : {}), stdio: ["ignore", "pipe", "pipe"] });
  const bare = join(c.dir, `${repo}.git`);
  if (!existsSync(join(bare, "HEAD")))
    git(["clone", "--bare", "--single-branch", "--branch", "main", c.remote, bare]);
  else git(["fetch", "--prune", "origin", "+refs/heads/main:refs/heads/main"], bare);
  return bare;
}

/** What a pass reports: small, it goes into the journal. */
export interface CanonSynced extends Omit<Synced, "broken"> {
  broken: number;
  /** The first few broken files, for the log. */
  brokenFiles: string[];
}

/** Fetch, then bring schema `canon` up to `main` as `canon_index`. */
export async function syncCanonIndex(
  main: Db,
  mainUrl: string,
  repo: string,
  c: CanonCheckout,
  o: { full?: boolean } = {},
): Promise<CanonSynced> {
  await ensureCanonIndex(main, mainUrl);
  const bare = fetchCanon(repo, c);
  const h = createDb(canonIndexUrl(mainUrl), { max: 1, app: "wren-canon-index" });
  const index = new RecordIndex(h.db as unknown as IndexDb, h.close);
  try {
    const s = await index.sync(bare, repo, o.full ? { full: true } : {});
    return {
      ...s,
      broken: s.broken.length,
      brokenFiles: s.broken.slice(0, 5).map((b) => b.path),
    };
  } finally {
    await index.close();
  }
}

export interface CanonIndexSyncDeps {
  db: Db;
  databaseUrl: string;
  checkout: CanonCheckout | null;
  notifier?: Notifier;
}

const needCheckout = (c: CanonCheckout | null): CanonCheckout => {
  if (!c)
    throw new restate.TerminalError(
      "Canon index off: no WREN_SHAPES_GITHUB_TOKEN (contents read on Canon)",
    );
  return c;
};

/**
 * `CanonIndexSync/<repo>`: `sync` on each push (the webhook) and `start` for the hourly backstop.
 * Exclusive per repo, so two pushes run one after the other. `rebuild` drops nothing: it rereads
 * every file at `main` (after a force push, or to repair).
 */
export function makeCanonIndexSync(deps: CanonIndexSyncDeps) {
  return makeLoopObject(
    "CanonIndexSync",
    async (ctx: restate.ObjectContext) =>
      runPass<CanonSynced>(ctx, deps.db, {
        name: "sync",
        ledger: { command: "canon index sync", argv: { repo: ctx.key, daemon: true } },
        body: () => syncCanonIndex(deps.db, deps.databaseUrl, ctx.key, needCheckout(deps.checkout)),
        delayAfter: () => HOUR_MS,
        retryMs: HOUR_MS,
        ...(deps.notifier ? { notifier: deps.notifier } : {}),
      }),
    {
      extra: {
        rebuild: exclusiveHandler(
          { input: NO_INPUT },
          async (ctx: restate.ObjectContext): Promise<CanonSynced> =>
            ctx.run("rebuild", () =>
              syncCanonIndex(deps.db, deps.databaseUrl, ctx.key, needCheckout(deps.checkout), {
                full: true,
              }),
            ),
        ),
      },
    },
  );
}

export type CanonIndexSync = ReturnType<typeof makeCanonIndexSync>;

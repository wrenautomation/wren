/**
 * `AuditSealer/all`: every 15 minutes, seals the audit log in main and in each
 * client's database (through the client's own login). Each seal's hash also
 * goes to the worker's log, a copy outside Postgres: a log rewritten by someone
 * who could also rewrite the seals still no longer matches it.
 */
import type * as restate from "@restatedev/restate-sdk";
import { clientDatabases, type Db, sealAudit } from "@wren/db";
import type { Notifier } from "./notify.js";
import { makeLoopObject, type PassOutcome, runPass } from "./restate/index.js";

export const SEALER_KEY = "all";
export const SEALER_COMMAND = "audit seal";
export const SEAL_EVERY_MS = 15 * 60_000;
/** Databases sealed at once: a stuck one holds up only its own slot. */
export const SEAL_AT_ONCE = 4;

export interface SealerStats {
  /** Databases with new events, sealed this pass. */
  sealed: number;
  /** Events those seals cover. */
  events: number;
  /** Databases looked at: main and every registered client. */
  databases: number;
}

export interface AuditSealerDeps {
  main: Db;
  /** A client's database through its own login. */
  open: (client: { database: string }) => Db;
  notifier?: Notifier;
  /** Where each seal's line goes; the worker's log by default. */
  log?: (line: string) => void;
}

/** Why a seal failed: the driver's reason (no such database, bad password), not drizzle's "Failed query". */
function reason(err: unknown): string {
  if (!(err instanceof Error)) return String(err);
  return err.cause instanceof Error ? err.cause.message : err.message;
}

/**
 * Seal main and every client, `SEAL_AT_ONCE` at a time; a seal waits for
 * another's lock only so long (`sealAudit`). One database failing does not stop
 * the rest; the pass then fails naming each, so the loop retries and says so once.
 */
export async function sealEverywhere(deps: AuditSealerDeps): Promise<SealerStats> {
  const log = deps.log ?? ((line: string) => console.log(line));
  const targets: Array<[string, () => Db]> = [["main", () => deps.main]];
  for (const database of await clientDatabases(deps.main))
    targets.push([database, () => deps.open({ database })]);
  const stats: SealerStats = { sealed: 0, events: 0, databases: targets.length };
  const failed: string[] = [];
  const seal = async ([name, db]: [string, () => Db]) => {
    try {
      const made = await sealAudit(db());
      if (!made) return;
      stats.sealed++;
      stats.events += made.events;
      log(
        `audit seal ${name} #${made.id} from ${made.fromEra}.${made.fromTx} ` +
          `through ${made.throughEra}.${made.throughTx} events ${made.events} hash ${made.hash}`,
      );
    } catch (err) {
      failed.push(`${name}: ${reason(err)}`);
    }
  };
  const queue = [...targets];
  await Promise.all(
    Array.from({ length: Math.min(SEAL_AT_ONCE, queue.length) }, async () => {
      for (let next = queue.shift(); next; next = queue.shift()) await seal(next);
    }),
  );
  if (failed.length) throw new Error(`audit seal failed for ${failed.sort().join("; ")}`);
  return stats;
}

export function makeAuditSealer(deps: AuditSealerDeps) {
  return makeLoopObject("AuditSealer", async (ctx: restate.ObjectContext) => {
    const now = new Date(await ctx.date.now());
    return runPass<SealerStats>(ctx, deps.main, now, {
      name: "seal",
      ledger: { command: SEALER_COMMAND, argv: { daemon: true } },
      body: () => sealEverywhere(deps),
      delayAfter: () => SEAL_EVERY_MS,
      retryMs: SEAL_EVERY_MS,
      ...(deps.notifier ? { notifier: deps.notifier } : {}),
    }) as Promise<PassOutcome<SealerStats>>;
  });
}

export type AuditSealer = ReturnType<typeof makeAuditSealer>;

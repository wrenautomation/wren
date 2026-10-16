/**
 * The dead-letter queue (designs/2026-10-11-dead-letters.md). Restate retries a failing
 * handler, and when the retries run out it pauses the invocation: the work is neither done
 * nor dropped, its object's lock is held, and nothing moves until someone acts. Each such
 * invocation is a dead letter. The `DeadLetters` loop files every one as a row, tells the
 * Discord channel once per new letter, and closes a row whose invocation left the paused
 * state by other means. `wren dlq` lists, shows, retries (resume where it stopped), kills
 * (give up, its caller is told) or drops (handled elsewhere) them.
 *
 * What is not a letter: a handler's terminal error goes back to whoever called it, and a
 * spine step's error waits on its event (`failedRuns`, Replay). Both already have an owner.
 */
import type * as restate from "@restatedev/restate-sdk";
import type { Db } from "@wren/db";
import { and, asc, desc, eq, inArray, isNotNull, isNull, notInArray, sql } from "drizzle-orm";
import type { RestateAdmin } from "./console.js";
import { type DeadLetterEnd, type DeadLetterRow, deadLetters } from "./dead-letter-schema.js";
import type { Notifier } from "./notify.js";
import { makeLoopObject, type PassOutcome, runPass } from "./restate/loop.js";

export const DEAD_LETTERS_KEY = "all";
export const DEAD_LETTERS_EVERY_MS = 10 * 60_000;

/** A write to Restate's admin API: `PATCH <admin>/invocations/<id>/resume?deployment=latest`. */
export type RestateAdminPatch = (path: string) => Promise<void>;
/** A resume or kill is one small admin write. */
const ADMIN_PATCH_LIMIT_MS = 30_000;

export const restateAdminPatch =
  (url: string, token?: string): RestateAdminPatch =>
  async (path) => {
    const res = await fetch(`${url.replace(/\/$/, "")}${path}`, {
      method: "PATCH",
      signal: AbortSignal.timeout(ADMIN_PATCH_LIMIT_MS),
      headers: token ? { authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) throw new Error(`restate admin ${path}: ${res.status} ${await res.text()}`);
  };

const PAUSED_SQL = `SELECT id, target, target_service_key, last_failure, invoked_by, invoked_by_target, modified_at
FROM sys_invocation WHERE status = 'paused'`;

export interface Paused {
  invocationId: string;
  target: string;
  key: string | null;
  error: string | null;
  invokedBy: string | null;
  pausedAt: Date;
}

const str = (v: unknown): string | null => (typeof v === "string" && v !== "" ? v : null);

/** Restate's rows as letters to file. */
export function pausedOf(rows: readonly Record<string, unknown>[]): Paused[] {
  return rows.flatMap((r) => {
    const id = str(r.id);
    const target = str(r.target);
    if (!id || !target) return [];
    return [
      {
        invocationId: id,
        target,
        key: str(r.target_service_key),
        error: str(r.last_failure)?.slice(0, 2000) ?? null,
        invokedBy: str(r.invoked_by_target) ?? str(r.invoked_by),
        pausedAt: new Date(str(r.modified_at) ?? Date.now()),
      },
    ];
  });
}

/** The failure in a journal entry's JSON (a call or step that failed), or null. */
export function failureOf(entryJson: unknown): string | null {
  if (typeof entryJson !== "string") return null;
  const m = /"Failure":\{"code":(\d+),"message":"((?:[^"\\]|\\.)*)"/.exec(entryJson);
  return m ? `[${m[1]}] ${JSON.parse(`"${m[2]}"`)}` : null;
}

/** The journal's id: Restate's `inv_` ids are word characters only. */
const safeId = (id: string) => id.replace(/[^\w]/g, "");

/** The failure a `Paused` journal event carries, or null. */
export function pausedFailureOf(eventJson: unknown): string | null {
  if (typeof eventJson !== "string") return null;
  try {
    const f = (
      JSON.parse(eventJson) as { last_failure?: { error_code?: number; error_message?: string } }
    ).last_failure;
    return f?.error_message ? `[${f.error_code ?? "?"}] ${f.error_message}` : null;
  } catch {
    return null;
  }
}

/**
 * The last failure the invocation's journal holds: Restate often keeps none on the row. A call
 * that never reached its handler (the deployment unreachable) has no failed entry, only the
 * `Paused` event's last failure.
 */
async function journalFailure(admin: RestateAdmin, id: string): Promise<string | null> {
  const rows = await admin(
    `SELECT entry_json FROM sys_journal WHERE id = '${safeId(id)}' AND entry_json LIKE '%"Failure"%' ORDER BY index DESC LIMIT 1`,
  );
  const found = failureOf(rows[0]?.entry_json);
  if (found) return found;
  const events = await admin(
    `SELECT event_json FROM sys_journal_events WHERE id = '${safeId(id)}' AND event_type = 'Paused' ORDER BY appended_at DESC LIMIT 1`,
  );
  return pausedFailureOf(events[0]?.event_json);
}

/**
 * A desk call Restate could not deliver: the Mac worker was off the network (asleep, lid shut,
 * tunnel down). Only Restate's own transport errors match; a desk handler that answered with
 * an error, or a letter with no error, stays a loud letter.
 */
export function deskUnreachable(l: Pick<DeadLetterRow, "target" | "error">): boolean {
  return (
    l.target.startsWith("desk/") &&
    /error when calling '[^']*': .*(connection (reset|refused|closed|error)|connect(ion)? timed? ?out|network is unreachable|tcp connect error)/i.test(
      l.error ?? "",
    )
  );
}

/** Every entry of an invocation's journal: type, name, and a failure when one is there. */
export async function journalOf(
  admin: RestateAdmin,
  id: string,
): Promise<{ index: number; type: string; name: string; failure: string | null }[]> {
  const rows = await admin(
    `SELECT index, entry_type, name, entry_json FROM sys_journal WHERE id = '${safeId(id)}' ORDER BY index`,
  );
  return rows.map((r) => ({
    index: Number(r.index),
    type: String(r.entry_type ?? ""),
    name: String(r.name ?? ""),
    failure: failureOf(r.entry_json),
  }));
}

/** One line per letter for the alert: a pointer, the error cut short. */
export function letterLine(l: Pick<DeadLetterRow, "id" | "target" | "key" | "error">): string {
  const what = l.key ? `${l.target} (${l.key})` : l.target;
  return `#${l.id} ${what}${l.error ? `: ${l.error.replace(/\s+/g, " ").slice(0, 120)}` : ""}`;
}

export interface DeadLetterDeps {
  main: Db;
  admin: RestateAdmin;
  patch?: RestateAdminPatch;
  /** Where new letters are told, and the loop's own failures. */
  notifier?: Notifier;
}

export interface DeadLetterPass {
  paused: number;
  filed: number;
  cleared: number;
  told: number;
}

/** One sweep: file what is paused, close what no longer is, tell what is new. */
export async function deadLetterPass(deps: DeadLetterDeps, now: Date): Promise<DeadLetterPass> {
  const paused = pausedOf(await deps.admin(PAUSED_SQL));
  for (const p of paused) p.error ??= await journalFailure(deps.admin, p.invocationId);
  const filed = paused.length
    ? await deps.main
        .insert(deadLetters)
        .values(paused)
        .onConflictDoUpdate({
          // Paused again after a retry: the same invocation, open once more.
          target: deadLetters.invocationId,
          set: {
            error: sql`excluded.error`,
            pausedAt: sql`excluded.paused_at`,
            seenAt: now,
            toldAt: null,
            endedAt: null,
            end: null,
            endedBy: null,
          },
          setWhere: isNotNull(deadLetters.endedAt),
        })
        .returning({ id: deadLetters.id })
    : [];
  const ids = paused.map((p) => p.invocationId);
  const cleared = await deps.main
    .update(deadLetters)
    .set({ endedAt: now, end: "cleared", endedBy: "sweep" })
    .where(
      and(
        isNull(deadLetters.endedAt),
        ids.length ? notInArray(deadLetters.invocationId, ids) : undefined,
      ),
    )
    .returning({ id: deadLetters.id });
  const untold = await deps.main
    .select()
    .from(deadLetters)
    .where(and(isNull(deadLetters.endedAt), isNull(deadLetters.toldAt)))
    .orderBy(asc(deadLetters.id));
  // Desk calls lost to the Mac sleeping are posted silent; everything else pings.
  const asleep = untold.filter(deskUnreachable);
  const loud = untold.filter((l) => !deskUnreachable(l));
  const tell = async (
    letters: DeadLetterRow[],
    title: string,
    footer: string,
    level: "info" | "warning",
  ): Promise<number> => {
    if (!letters.length || !deps.notifier) return 0;
    const sent = await deps.notifier.notify(
      title,
      [
        ...letters.slice(0, 10).map(letterLine),
        letters.length > 10 ? `…and ${letters.length - 10} more` : null,
        footer,
      ]
        .filter(Boolean)
        .join("\n"),
      level,
    );
    if (!sent) return 0;
    await deps.main
      .update(deadLetters)
      .set({ toldAt: now })
      .where(
        inArray(
          deadLetters.id,
          letters.map((l) => l.id),
        ),
      );
    return letters.length;
  };
  const n = (k: number, one: string, many: string) => `${k} ${k === 1 ? one : many}`;
  const told =
    (await tell(
      loud,
      `${n(loud.length, "dead letter", "dead letters")}: Restate gave up on ${loud.length === 1 ? "a call" : "calls"}`,
      "`wren dlq show <id>`, then `retry`, `kill` or `drop`.",
      "warning",
    )) +
    (await tell(
      asleep,
      `${n(asleep.length, "desk call", "desk calls")} parked: the Mac worker was unreachable (likely asleep or offline)`,
      "Loops read again on their next pass. Clear with `wren dlq kill <id>` once the Mac is back.",
      "info",
    ));
  return { paused: paused.length, filed: filed.length, cleared: cleared.length, told };
}

/** Open letters, oldest first; with `all`, the ended ones too, newest first. */
export async function deadLetterList(main: Db, all = false): Promise<DeadLetterRow[]> {
  return all
    ? main.select().from(deadLetters).orderBy(desc(deadLetters.id)).limit(200)
    : main
        .select()
        .from(deadLetters)
        .where(isNull(deadLetters.endedAt))
        .orderBy(asc(deadLetters.pausedAt));
}

export async function deadLetter(main: Db, id: number): Promise<DeadLetterRow | null> {
  const [row] = await main.select().from(deadLetters).where(eq(deadLetters.id, id));
  return row ?? null;
}

export type DeadLetterAct = "retry" | "kill" | "drop";
const ENDS: Record<DeadLetterAct, DeadLetterEnd> = {
  retry: "retried",
  kill: "killed",
  drop: "dropped",
};
// A retry runs on the newest deployment: pinned to the one it started on, a call replays the bug
// the fix shipped for and pauses again (10-11, 10-13, 10-15).
const ADMIN: Partial<Record<DeadLetterAct, string>> = {
  retry: "resume?deployment=latest",
  kill: "kill",
};

/**
 * End one open letter. `retry` resumes the invocation where it stopped, on the newest
 * deployment (a journal the new code can't replay pauses it again); `kill` ends it with an error its caller sees; `drop` only closes the
 * row. A retry that pauses again comes back as the same letter, reopened.
 */
export async function endDeadLetter(
  deps: Pick<DeadLetterDeps, "main" | "patch">,
  id: number,
  act: DeadLetterAct,
  by: string,
  now: Date = new Date(),
): Promise<DeadLetterRow> {
  const row = await deadLetter(deps.main, id);
  if (!row) throw new Error(`no dead letter #${id}`);
  if (row.endedAt) throw new Error(`#${id} already ended: ${row.end} by ${row.endedBy}`);
  const verb = ADMIN[act];
  if (verb) {
    if (!deps.patch) throw new Error(`${act} needs the Restate admin URL (WREN_RESTATE_ADMIN_URL)`);
    await deps.patch(`/invocations/${encodeURIComponent(row.invocationId)}/${verb}`);
  }
  const [ended] = await deps.main
    .update(deadLetters)
    .set({ endedAt: now, end: ENDS[act], endedBy: by })
    .where(and(eq(deadLetters.id, id), isNull(deadLetters.endedAt)))
    .returning();
  if (!ended) throw new Error(`#${id} ended while this ran`);
  return ended;
}

/** `DeadLetters/all`: one sweep every ten minutes. */
export function makeDeadLetters(deps: DeadLetterDeps) {
  return makeLoopObject("DeadLetters", async (ctx: restate.ObjectContext) => {
    const now = new Date(await ctx.date.now());
    return (await runPass<DeadLetterPass>(ctx, deps.main, now, {
      name: "sweep",
      ledger: { command: "dlq sweep", argv: { daemon: true } },
      body: () => deadLetterPass(deps, now),
      delayAfter: () => DEAD_LETTERS_EVERY_MS,
      retryMs: DEAD_LETTERS_EVERY_MS,
      ...(deps.notifier ? { notifier: deps.notifier } : {}),
    })) as PassOutcome<DeadLetterPass>;
  });
}

export type DeadLetters = ReturnType<typeof makeDeadLetters>;

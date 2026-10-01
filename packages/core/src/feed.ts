/**
 * A run's feed: what a stage is doing, in plain words, as it works. Stages
 * `emit`; a viewer reads the lines after the last `seq` it saw, every second
 * or two while the run is open. Any product, any stage: the line is the
 * product's words, the shape is shared.
 *
 * Writing a line never stops the work: a feed that can't write says so once
 * and the run goes on without it.
 */
import type { Queryable } from "@wren/db";
import { and, asc, desc, eq, gt, inArray } from "drizzle-orm";
import { type Run, type RunEventKind, runEvents, runs } from "./schema.js";

export interface FeedSource {
  label: string;
  href?: string | null;
}

export interface FeedEvent {
  step: string;
  kind: RunEventKind;
  line: string;
  subject?: string | null;
  count?: number | null;
  source?: FeedSource | null;
  /** The technical why (an error message), for operators only. */
  detail?: string | null;
  traceId?: string | null;
}

export interface Feed {
  emit(e: FeedEvent): Promise<void>;
}

/** No one is watching: tests, one-off scripts. */
export const NO_FEED: Feed = { emit: async () => {} };

const LINE_LIMIT = 300;
const DETAIL_LIMIT = 500;
/** Postgres refuses a NUL in text or jsonb; an error's message can carry one. */
const clean = (s: string) => s.replaceAll("\u0000", "");
/** At most `n` characters, counting an emoji as one, so none is split. */
const cut = (s: string, n: number) => {
  const chars = [...clean(s)];
  return chars.length > n ? `${chars.slice(0, n - 1).join("")}…` : chars.join("");
};
/** Why a write failed, without the query's values (names, emails). */
const whyFailed = (err: unknown) => {
  const cause = err instanceof Error ? err.cause : null;
  return cause instanceof Error ? cause.message : err instanceof Error ? err.name : String(err);
};

/** The feed of one `runs` row. */
export function runFeed(db: Queryable, runId: string, warn = console.warn): Feed {
  let broken = false;
  return {
    async emit(e) {
      if (broken) return;
      try {
        await db.insert(runEvents).values({
          runId,
          step: e.step,
          kind: e.kind,
          line: cut(e.line, LINE_LIMIT),
          subject: e.subject ? clean(e.subject) : null,
          count: e.count ?? null,
          source: e.source
            ? {
                ...e.source,
                label: clean(e.source.label),
                ...(e.source.href ? { href: clean(e.source.href) } : {}),
              }
            : null,
          detail: e.detail ? cut(e.detail, DETAIL_LIMIT) : null,
          traceId: e.traceId ?? null,
        });
      } catch (err) {
        broken = true;
        warn(`feed for run ${runId} stopped: ${whyFailed(err)}`);
      }
    },
  };
}

/** The message of whatever was thrown, for a line's `detail`. */
export const errorText = (err: unknown): string =>
  err instanceof Error ? `${err.name}: ${err.message}` : String(err);

export interface FeedLine extends Required<Omit<FeedEvent, "traceId">> {
  seq: number;
  at: string;
}

/** A run's lines after `after`, oldest first. */
export async function readFeed(
  db: Queryable,
  runId: string,
  opts: { after?: number; limit?: number } = {},
): Promise<FeedLine[]> {
  const rows = await db
    .select()
    .from(runEvents)
    .where(and(eq(runEvents.runId, runId), gt(runEvents.seq, opts.after ?? 0)))
    .orderBy(asc(runEvents.seq))
    .limit(opts.limit ?? 500);
  return rows.map((r) => ({
    seq: r.seq,
    at: r.at.toISOString(),
    step: r.step,
    kind: r.kind,
    line: r.line,
    subject: r.subject,
    count: r.count,
    source: (r.source as FeedSource | null) ?? null,
    detail: r.detail,
  }));
}

/** The newest run of these commands: the one a viewer should watch. */
export async function latestRun(db: Queryable, commands: readonly string[]): Promise<Run | null> {
  const [row] = await db
    .select()
    .from(runs)
    .where(inArray(runs.command, [...commands]))
    .orderBy(desc(runs.startedAt))
    .limit(1);
  return row ?? null;
}

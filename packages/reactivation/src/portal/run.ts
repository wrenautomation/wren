/**
 * The Run page (P5): the run being watched, line by line, and the replay of
 * what was done on the list. The watched run is the newest one that wrote a
 * line; a viewer polls with the `run` and `after` it last got and gets only
 * what is new, or the whole of a newer run. The replay comes on first load
 * only (no `after`). `detail` (the technical why) is for operators.
 */
import { type FeedLine, readFeed } from "@wren/core";
import type { Queryable } from "@wren/db";
import { sql } from "drizzle-orm";
import { portalStory, type Story } from "./story.js";
import { iso } from "./views.js";

/** A run that wrote nothing for this long is not shown as running, finished or not. */
const QUIET_MINUTES = 10;

export interface LiveRun {
  run: string;
  command: string;
  startedAt: string;
  finishedAt: string | null;
  /** Still going: not finished and a line in the last few minutes. */
  open: boolean;
  /** Lines after the `after` sent, oldest first. */
  lines: FeedLine[];
  /** Send back as `after`. */
  last: number;
}

export interface RunPage {
  /** Null until some run writes a line. */
  live: LiveRun | null;
  /** On first load only. */
  story: Story | null;
}

export interface RunQuery {
  run?: string | undefined;
  after?: number | undefined;
  operator: boolean;
}

export async function portalRun(db: Queryable, q: RunQuery): Promise<RunPage> {
  const [r] = await db.execute<{
    run_id: string;
    command: string;
    started_at: unknown;
    finished_at: unknown;
    open: boolean;
  }>(sql`
    select r.id run_id, r.command, r.started_at, r.finished_at,
      r.finished_at is null and e.at > now() - make_interval(mins => ${QUIET_MINUTES}) open
    from (select run_id, at from run_events order by seq desc limit 1) e
    join runs r on r.id = e.run_id`);
  const story = q.after === undefined ? await portalStory(db) : null;
  if (!r) return { live: null, story };
  // A newer run than the one the viewer has: send all of it.
  const after = q.run === r.run_id ? (q.after ?? 0) : 0;
  const lines = (await readFeed(db, r.run_id, { after })).map((l) =>
    q.operator ? l : { ...l, detail: null },
  );
  return {
    live: {
      run: r.run_id,
      command: r.command,
      startedAt: iso(r.started_at) ?? "",
      finishedAt: iso(r.finished_at),
      open: r.open,
      lines,
      last: lines.at(-1)?.seq ?? after,
    },
    story,
  };
}

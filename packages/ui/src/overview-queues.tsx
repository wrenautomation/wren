/**
 * Overview E (artifact section 15, `.ix-e`): the Inbox's number first. The total that waits on
 * the viewer, one bar split by queue, and the queues ranked by their oldest wait. Each queue is
 * one list read of its view, oldest first, one row: the count is the view's total, the wait is
 * that row's date. Late is a wait past the queue's promise, said in amber text, never a fill.
 */
import { hoursSince, lateOf } from "@wren/core/promise";
import { useLoad } from "./data/query.js";
import { LoadFailed } from "./feedback.js";
import { num, waited } from "./format.js";
import type { IconName } from "./icons.js";
import type { RecordsApi } from "./records.js";
import { SplitGhost, SplitPanel, type SplitRow } from "./split.js";

export interface OverviewQueue {
  label: string;
  record: string;
  /** The view whose rows are waiting: its total is the count. */
  view: string;
  /** The list it opens. */
  href: string;
  icon: IconName;
  /** A line colour, `var(--ui-line-N)`; left out, ink-3. */
  line?: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;
  /** The date field a wait counts from. */
  wait: string;
  /** How long a person may wait: "24h". Past it, the queue is late. */
  promise: string;
}

/** What one queue's read answered: how many wait and since when, or why it failed. */
export type QueueRead = { total: number; oldest: string | null } | { error: string };

export interface RankedQueue {
  queue: OverviewQueue;
  total: number;
  oldest: string | null;
  /** Hours the oldest has waited; null with nothing waiting or no readable date. */
  hours: number | null;
  late: boolean;
  error: string | null;
}

/**
 * One list read per queue, the oldest row first. A queue that fails is told apart, not dropped;
 * when every one fails, the whole read does, so the page offers Retry.
 */
export async function readQueues(
  api: RecordsApi,
  queues: readonly OverviewQueue[],
): Promise<QueueRead[]> {
  const reads = await Promise.allSettled(
    queues.map(async (q): Promise<QueueRead> => {
      const page = await api.list({ record: q.record, view: q.view, sort: q.wait, limit: 1 });
      const at = page.rows[0]?.[q.wait];
      return { total: page.total, oldest: typeof at === "string" ? at : null };
    }),
  );
  const failed = reads.filter((r): r is PromiseRejectedResult => r.status === "rejected");
  if (failed.length && failed.length === reads.length) throw failed[0]?.reason;
  return reads.map((r) =>
    r.status === "fulfilled"
      ? r.value
      : { error: r.reason instanceof Error ? r.reason.message : "Couldn't load" },
  );
}

/**
 * The queues in the order the list shows them: what waits, longest wait first (a tie keeps the
 * order they were declared in); then the empty ones; then any that failed.
 */
export function rankQueues(
  queues: readonly OverviewQueue[],
  reads: readonly QueueRead[],
  now: Date,
): RankedQueue[] {
  const group = (r: RankedQueue) => (r.error ? 2 : r.total > 0 ? 0 : 1);
  return queues
    .flatMap((queue, i): [number, RankedQueue][] => {
      const read = reads[i];
      if (!read) return [];
      if ("error" in read)
        return [
          [i, { queue, total: 0, oldest: null, hours: null, late: false, error: read.error }],
        ];
      const oldest = read.total > 0 ? read.oldest : null;
      return [
        [
          i,
          {
            queue,
            total: read.total,
            oldest,
            hours: hoursSince(oldest, now),
            late: lateOf(oldest, queue.promise, now),
            error: null,
          },
        ],
      ];
    })
    .sort(([i, a], [j, b]) => group(a) - group(b) || (b.hours ?? -1) - (a.hours ?? -1) || i - j)
    .map(([, r]) => r);
}

/** The line the total sits on: how many queues are late, and the longest wait of all. */
export function sumQueues(ranked: readonly RankedQueue[]) {
  return {
    total: ranked.reduce((n, r) => n + r.total, 0),
    late: ranked.filter((r) => r.late).length,
    hours: ranked.reduce<number | null>(
      (m, r) => (r.hours === null ? m : Math.max(m ?? 0, r.hours)),
      null,
    ),
  };
}

const colorOf = (q: OverviewQueue) =>
  q.line === undefined ? "var(--ui-ink-3)" : `var(--ui-line-${q.line})`;

/** A ranked queue as a row of the split: its count, and its oldest wait or why it's quiet. */
const rowOf = (r: RankedQueue): SplitRow => ({
  key: r.queue.label,
  label: r.queue.label,
  icon: r.queue.icon,
  color: colorOf(r.queue),
  href: r.queue.href,
  weight: r.total,
  value: r.error ? "–" : num(r.total),
  note: r.error
    ? "Couldn't load"
    : r.total === 0
      ? "Nothing waiting"
      : `oldest ${r.hours === null ? "unknown" : waited(r.hours)}`,
  noteTone: r.error ? "bad" : r.late ? "late" : undefined,
});

/** Overview E's left side: the total, the bar, the ranked queues. */
export function QueuePanel({
  queues,
  api,
  ready,
}: {
  queues: readonly OverviewQueue[];
  /** Where the queues read. */
  api: RecordsApi;
  /** The record types are known, so `queues` holds only the ones installed. */
  ready: boolean;
}) {
  const load = useLoad(
    ready && queues.length ? JSON.stringify(queues.map((q) => [q.record, q.view, q.wait])) : null,
    () => readQueues(api, queues),
    api,
  );
  if (load.error && !load.data) return <LoadFailed error={load.error} onRetry={load.retry} />;
  if (!ready || load.pending || !load.data)
    return <SplitGhost label="What waits on you" lines={queues.length || 6} />;
  const ranked = rankQueues(queues, load.data, new Date());
  const sum = sumQueues(ranked);
  return (
    <SplitPanel
      label="What waits on you"
      total={num(sum.total)}
      line={
        sum.total === 0 ? (
          "Nothing waits on you"
        ) : (
          <>
            wait on you
            {sum.late ? (
              <>
                {" · "}
                <span data-late="">
                  {sum.late} {sum.late === 1 ? "queue" : "queues"} late
                </span>
              </>
            ) : null}
            {sum.hours !== null ? ` · oldest ${waited(sum.hours)}` : null}
          </>
        )
      }
      rows={ranked.map(rowOf)}
    />
  );
}

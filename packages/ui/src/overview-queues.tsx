/**
 * Overview E (artifact section 15, `.ix-e`): the Inbox's number first. The total that waits on
 * the viewer, one bar split by queue, and the queues ranked by their oldest wait. Each queue is
 * one list read of its view, oldest first, one row: the count is the view's total, the wait is
 * that row's date. Late is a wait past the queue's promise, said in amber text, never a fill.
 */
import { hoursSince, lateOf } from "@wren/core/promise";
import { cn } from "cn";
import { Skeleton } from "./components/ui/skeleton.js";
import { useLoad } from "./data/query.js";
import { LoadFailed, Loading } from "./feedback.js";
import { num, waited } from "./format.js";
import { Icon, type IconName } from "./icons.js";
import { FRAME } from "./layout.js";
import type { RecordsApi } from "./records.js";

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
const LATE = "text-(--ui-warn-ink)";

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
  if (!ready || load.pending || !load.data) return <QueuesGhost lines={queues.length || 6} />;
  const ranked = rankQueues(queues, load.data, new Date());
  const sum = sumQueues(ranked);
  const bar = ranked.filter((r) => r.total > 0);
  return (
    <section
      aria-label="What waits on you"
      className={cn(FRAME, "grid gap-3 px-3.5 pt-[18px] pb-2")}
    >
      <div className="mx-1.5 flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
        <b className="text-[48px] leading-[.9] font-[750] tracking-[-0.04em] tabular-nums">
          {num(sum.total)}
        </b>
        <span className="text-[15px] text-(--ui-ink-2)">
          {sum.total === 0 ? (
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
          )}
        </span>
      </div>
      <div className="mx-1.5 flex h-2.5 gap-0.5" aria-hidden="true">
        {bar.length ? (
          bar.map((r) => (
            <i
              key={r.queue.label}
              className="block min-w-1 rounded-[2px_6px_2px_6px]"
              style={{ flex: r.total, background: colorOf(r.queue) }}
            />
          ))
        ) : (
          <i className="block flex-1 rounded-[2px_6px_2px_6px] bg-(--ui-fill)" />
        )}
      </div>
      <ul className="m-0 grid list-none p-0 [&>li+li>a]:shadow-[0_-1px_0_var(--ui-hair)]">
        {ranked.map((r) => (
          <li key={r.queue.label}>
            <QueueRow r={r} />
          </li>
        ))}
      </ul>
    </section>
  );
}

function QueueRow({ r }: { r: RankedQueue }) {
  const { queue: q } = r;
  const quiet = r.total === 0;
  return (
    <a
      href={q.href}
      className={cn(
        "grid grid-cols-[10px_18px_minmax(0,1fr)_auto_12px] items-center gap-3 px-3 py-2.5 text-[15px] no-underline transition-[background-color] duration-200 outline-none [border-radius:4px_12px_4px_12px] hover:bg-(--ui-accent-wash) focus-visible:bg-(--ui-accent-wash) motion-reduce:transition-none",
        quiet ? "text-(--ui-ink-3)" : "text-(--ui-ink)",
      )}
    >
      <i
        aria-hidden="true"
        className={cn("size-2.5 [border-radius:2px_5px_2px_5px]", quiet && "opacity-50")}
        style={{ background: colorOf(q) }}
      />
      <Icon
        name={q.icon}
        size={18}
        className={cn("[stroke-width:1.8]", quiet ? "text-(--ui-ink-3)" : "text-(--ui-ink-2)")}
      />
      <span className="grid min-w-0 leading-[1.3]">
        <span className="truncate">{q.label}</span>
        {r.error ? (
          <small className="truncate text-[12.5px] text-(--ui-bad)">Couldn't load</small>
        ) : quiet ? (
          <small className="text-[12.5px] text-(--ui-ink-3)">Nothing waiting</small>
        ) : (
          <small
            data-late={r.late ? "" : undefined}
            className={cn("truncate text-[12.5px]", r.late ? LATE : "text-(--ui-ink-3)")}
          >
            oldest {r.hours === null ? "unknown" : waited(r.hours)}
          </small>
        )}
      </span>
      <b
        className={cn(
          "min-w-7 px-2 py-0.5 text-center text-[15px] font-bold tabular-nums [border-radius:3px_10px_3px_10px]",
          quiet ? "text-(--ui-ink-3)" : "bg-(--ui-fill)",
        )}
      >
        {r.error ? "–" : num(r.total)}
      </b>
      <svg
        viewBox="0 0 12 12"
        aria-hidden="true"
        className="size-3 fill-none stroke-(--ui-ink-3) [stroke-width:2]"
      >
        <path d="M4 2l4 4-4 4" />
      </svg>
    </a>
  );
}

/** The panel's shape while the first read is out: the number, the bar, a row per queue. */
function QueuesGhost({ lines }: { lines: number }) {
  return (
    <section
      aria-busy="true"
      aria-label="What waits on you"
      className={cn(FRAME, "grid gap-3 px-3.5 pt-[18px] pb-2")}
    >
      <Skeleton className="mx-1.5 h-[43px] w-44" />
      <Skeleton className="mx-1.5 h-2.5" />
      <Loading shape="rows" lines={lines} label="Loading what waits on you" className="py-0" />
    </section>
  );
}

/**
 * Aerie › History (aerie D16 History table): every task event, newest first, grouped by the viewer's
 * own day. Page one is live and merged by seq (data.ts `readFeed`); Show older reads below the lowest
 * seq held, and the pages it read are held per words and epoch, so new words or a gap start over.
 */

import {
  Button,
  cx,
  Empty,
  Icon,
  type IconName,
  Leaves,
  LoadFailed,
  Loading,
  SearchField,
  useSeen,
} from "@wren/ui";
import { type ReactNode, useMemo, useState } from "react";
import type { PageProps } from "../../module.js";
import { href, navigate } from "../../route.js";
import { dayLabel } from "../work/bits.js";
import { TASKS } from "./address.js";
import { FEED_PAGE, type FeedRow, mergeFeed, readOlder, useFeed } from "./data.js";
import { eventSays, eventText, who } from "./look.js";
import { isNoActor, NoActor } from "./no-actor.js";

const HISTORY = "/aerie/history";

const pad = (n: number) => String(n).padStart(2, "0");
/** the viewer's day, not UTC's: an evening event stays on its evening */
const localDay = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
function dayHead(day: string, now = new Date()): string {
  if (day === localDay(now)) return "Today";
  const y = new Date(now);
  y.setDate(y.getDate() - 1);
  return day === localDay(y) ? "Yesterday" : dayLabel(day);
}
const timeOf = (d: Date) => d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

/** the marker: what kind of change, at a glance; a failed run in the bad tint */
function markOf(e: FeedRow): { icon: IconName; tone?: string } {
  const body = (e.body ?? {}) as Record<string, unknown>;
  switch (e.kind) {
    case "create":
      return { icon: "plus" };
    case "import":
      return { icon: "download" };
    case "filed":
      return { icon: "inbox" };
    case "routed":
      return { icon: "send" };
    case "run.start":
      return { icon: "play" };
    case "run.result":
      return body.outcome === "failed"
        ? { icon: "warn", tone: "text-(--ui-bad)" }
        : body.outcome === "needs-input"
          ? { icon: "help", tone: "text-(--ui-warn-ink)" }
          : body.outcome === "done"
            ? { icon: "check", tone: "text-(--ui-good-ink)" }
            : { icon: "stop" };
    case "edit":
      return "status" in body ? { icon: "cycle" } : { icon: "edit" };
    default:
      return { icon: "dot" };
  }
}

export function HistoryPage({ params }: PageProps) {
  const words = params.get("q")?.trim() ?? "";
  const got = useFeed(words);
  useSeen("list", {
    label: "History",
    icon: "history",
    text: `Aerie history${words ? `, "${words}"` : ""}`,
  });
  // pages from Show older, held per words and epoch: new words or a gap start over
  const scope = `${words}:${got.data?.epoch ?? 0}`;
  const [older, setOlder] = useState<{ scope: string; rows: FeedRow[]; end: boolean }>({
    scope,
    rows: [],
    end: false,
  });
  const extra = older.scope === scope ? older : { rows: [], end: false };
  const [reading, setReading] = useState(false);
  const [olderFailed, setOlderFailed] = useState(false);

  const rows = useMemo(
    () =>
      got.data &&
      (extra.rows.length ? mergeFeed([...got.data.rows, ...extra.rows]) : got.data.rows),
    [got.data, extra.rows],
  );
  const days = useMemo(() => {
    const out: { day: string; rows: FeedRow[] }[] = [];
    for (const r of rows ?? []) {
      const day = localDay(new Date(r.at));
      const last = out.at(-1);
      if (last?.day === day) last.rows.push(r);
      else out.push({ day, rows: [r] });
    }
    return out;
  }, [rows]);
  const end = !got.data || (extra.rows.length ? extra.end : got.data.end);

  const showOlder = async () => {
    const last = rows?.at(-1);
    if (!last) return;
    setReading(true);
    setOlderFailed(false);
    try {
      const page = await readOlder(words, last.seq);
      setOlder((o) => ({
        scope,
        rows: [...(o.scope === scope ? o.rows : []), ...page],
        end: page.length < FEED_PAGE,
      }));
    } catch {
      setOlderFailed(true);
    } finally {
      setReading(false);
    }
  };

  if (isNoActor(got.error))
    return (
      <div className="w-full max-w-[720px] min-w-0">
        <NoActor error={got.error} />
      </div>
    );

  const ask = (text: string | null) => navigate(href(HISTORY, { q: text || null }, params));
  let body: ReactNode;
  const kind =
    got.error && !got.data
      ? "failed"
      : !rows
        ? "loading"
        : rows.length
          ? "list"
          : words
            ? "nohits"
            : "empty";
  if (kind === "failed") body = <LoadFailed error={got.error} onRetry={got.retry} />;
  else if (!rows) body = <Loading shape="rows" lines={6} label="Loading history" />;
  else if (!rows.length)
    body = words ? (
      <Empty
        title={`Nothing matches “${words}”`}
        action={
          <Button size="dense" tone="quiet" onClick={() => ask(null)}>
            Clear
          </Button>
        }
      >
        Words match the task title, the why and the change.
      </Empty>
    ) : (
      <Empty title="Nothing has happened yet" waits>
        Each change to a task shows here.
      </Empty>
    );
  else
    body = (
      <div className={cx("grid gap-6", got.placeholder && "opacity-60 transition-opacity")}>
        <Leaves items={days} keyOf={(d) => d.day} className="grid gap-7">
          {(d) => (
            <section aria-labelledby={`day-${d.day}`} className="grid gap-1">
              <h3
                id={`day-${d.day}`}
                className="m-0 px-3 pb-1 text-[15px] leading-[20px] font-semibold text-(--ui-ink)"
              >
                {dayHead(d.day)}
              </h3>
              <Leaves items={d.rows} keyOf={(r) => String(r.seq)} className="m-0 grid p-0">
                {(r) => <FeedLine e={r} />}
              </Leaves>
            </section>
          )}
        </Leaves>
        {!end && (
          <div className="flex flex-wrap items-center gap-3 px-3">
            <Button size="dense" tone="quiet" disabled={reading} onClick={showOlder}>
              {reading ? "Loading…" : olderFailed ? "Try again" : "Show older"}
            </Button>
            {olderFailed && (
              <span
                role="alert"
                className="text-[13px] text-(--ui-bad) [animation:ui-fade_.15s_both]"
              >
                Older events didn't load.
              </span>
            )}
          </div>
        )}
      </div>
    );

  return (
    <section aria-labelledby="aerie-history" className="grid w-full max-w-[720px] min-w-0 gap-4">
      {/* the breadcrumb names the page; the heading is for screen readers */}
      <h2 id="aerie-history" className="sr-only">
        Every change
      </h2>
      <div className="flex items-center">
        <SearchField
          asked={words}
          ask={ask}
          label="history"
          busy={got.loading && got.placeholder}
          failed={words && got.error ? { retry: got.retry } : undefined}
        />
      </div>
      {/* a new state (loading, failed, empty, no hits, list) fades in */}
      <div key={kind} className="[animation:ui-fade_.15s_both]">
        {body}
      </div>
    </section>
  );
}

/** one event: marker, who + what + time, the task, its own words */
function FeedLine({ e }: { e: FeedRow }) {
  const mark = markOf(e);
  const text = eventText(e);
  const at = new Date(e.at);
  return (
    <article className="grid grid-cols-[20px_minmax(0,1fr)] gap-x-2.5 rounded-(--ui-leaf-button) px-3 py-2.5 text-[13.5px] leading-[20px]">
      <Icon
        name={mark.icon}
        aria-hidden
        className={cx("mt-[3px] size-3.5", mark.tone ?? "text-(--ui-ink-3)")}
      />
      <div className="grid min-w-0 gap-0.5">
        <p className="m-0 flex flex-wrap items-baseline gap-x-2 text-(--ui-ink)">
          <span className="wrap-anywhere">
            <span className="font-semibold">{who(e.by)}</span> {eventSays(e)}
          </span>
          <time dateTime={e.at} className="text-[12.5px] text-(--ui-ink-3) tabular-nums">
            {timeOf(at)}
          </time>
        </p>
        <p className="m-0 wrap-anywhere">
          {e.title ? (
            <a
              href={href(TASKS, { task: e.taskId })}
              className="font-medium text-(--ui-link) no-underline underline-offset-2 hover:underline focus-visible:underline"
            >
              <span className="text-(--ui-ink-3)">{e.taskId}</span> {e.title}
            </a>
          ) : (
            <span className="text-(--ui-ink-3)">{e.taskId}</span>
          )}
        </p>
        {text && (
          <p className="m-0 text-[13px] leading-[19px] text-pretty wrap-anywhere text-(--ui-ink)">
            {text}
          </p>
        )}
      </div>
    </article>
  );
}

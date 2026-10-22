/**
 * The Timeline template: a record with a date field drawn as an axis you move through. Days as
 * sections, newest on top, each head sticky with its count by kind; a strip of bars over the
 * range to jump by; zoom to a row per day or per week. Lines load a day at a time, a page at a
 * time, only when their day comes on screen. Filters, views and saved views are the List's own
 * (`ListBar`), and `as=rows` is the List itself. Math in `./timeline-axis.ts`.
 */

import type { FieldMeta, RecordMeta, State } from "@wren/core/records";
import type { ListAsk, RecordsPage, RecordsStat, Row } from "@wren/core/records/serve";
import { cn } from "cn";
import { ChevronLeft, ChevronRight, GitCommitVertical, Rows3 } from "lucide-react";
import { type ReactNode, type RefObject, useEffect, useMemo, useRef, useState } from "react";
import { Button, ButtonLink } from "./controls.js";
import { listChanged } from "./data/delta.js";
import { Empty, LoadFailed } from "./feedback.js";
import { Cue, dateOf } from "./fields.js";
import { num } from "./format.js";
import { tipProps } from "./hint.js";
import { Icon, type IconName } from "./icons.js";
import { NoLink, SourceLink } from "./item-link.js";
import { PageTitle } from "./layout.js";
import { ListBar, useLastUsed, useNarrow, useSavedViews, ViewTabs } from "./list-bar.js";
import { tintColor } from "./marks.js";
import {
  askOf,
  facetsOf,
  ListSkeleton,
  NotHere,
  type Place,
  type RecordsApi,
  ROOT,
  textOf,
  titleOf,
  useLoad,
  useTypes,
} from "./records.js";
import {
  anchorOf,
  barOf,
  countsOf,
  DAY_PAGE,
  type DayCount,
  dayFrom,
  dayKey,
  dayWhere,
  earlierOf,
  monthsOf,
  rangeOf,
  stepOf,
  stretchesOf,
  topOf,
  type WeekCount,
  weeksOf,
  ZOOMS,
  type Zoom,
  zoomOf,
} from "./timeline-axis.js";

/** Which of a record's fields the timeline reads. Only `at` is needed. */
export interface TimelineSpec {
  /** The date field that puts a line on the axis. */
  at: string;
  /** A status field: each line's icon and tint, and each day's count by it. */
  kind?: string;
  /** A status field with marks: where the line happened. */
  channel?: string;
  /** Whose line it is, and the link field to them. */
  who?: string;
  whoLink?: string;
  /** A link field: the line's own source, opened beside. */
  link?: string;
  /** A link field: where the line sits (the post it is on); shown when it has no `link`. */
  context?: string;
  /** A text field: said in place of the link when a line should have one and has none. */
  note?: string;
  /** The kit icon each kind draws on its node; the tint alone where one has none. */
  icons?: Readonly<Record<string, IconName>>;
}

export interface RecordTimelineProps {
  record: string;
  title?: string | undefined;
  api: RecordsApi;
  place: Place;
  spec: TimelineSpec;
  /** What fills it, said when nothing has happened in the range. */
  empty?: string | undefined;
}

const TIME: Intl.DateTimeFormatOptions = { hour: "numeric", minute: "2-digit" };
const LONG: Intl.DateTimeFormatOptions = { weekday: "short", month: "short", day: "numeric" };
const SHORT: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" };
const zone = () => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return "UTC";
  }
};
const said = (day: string, o: Intl.DateTimeFormatOptions) =>
  (dayFrom(day) as Date).toLocaleDateString("en-US", o);
const lines = (n: number) => `${num(n)} ${n === 1 ? "line" : "lines"}`;

/** Timeline or List, in the bar of both: two links, the one on pressed. */
export function TimelineSwitch({ on, place }: { on: "timeline" | "list"; place: Place }) {
  const one =
    "grid size-8 pointer-coarse:size-11 place-items-center text-(--ui-ink-3) no-underline transition-colors duration-150 hover:text-(--ui-ink) aria-[current=page]:bg-(--ui-fill) aria-[current=page]:text-(--ui-ink)";
  return (
    <nav
      aria-label="Timeline or list"
      className="inline-flex shrink-0 overflow-hidden rounded-(--ui-radius) border border-(--ui-hair) bg-(--ui-paper)"
    >
      <a
        href={place.link({ as: "timeline", pg: null })}
        aria-current={on === "timeline" ? "page" : undefined}
        aria-label="Timeline"
        {...tipProps("Timeline")}
        className={one}
      >
        <GitCommitVertical className="size-3.5" />
      </a>
      <a
        href={place.link({ as: "rows", zoom: null, day: null })}
        aria-current={on === "list" ? "page" : undefined}
        aria-label="List"
        {...tipProps("List")}
        className={cn(one, "border-l border-(--ui-hair)")}
      >
        <Rows3 className="size-3.5" />
      </a>
    </nav>
  );
}

export function RecordTimeline(props: RecordTimelineProps) {
  const types = useTypes(props.api);
  const meta = types.data?.find((t) => t.id === props.record);
  if (types.error && !types.data) return <LoadFailed error={types.error} onRetry={types.retry} />;
  if (!types.data) return <ListSkeleton />;
  if (!meta) return <NotHere />;
  return <Timeline {...props} meta={meta} />;
}

/** A line's state of a field, when it has one. */
const stateOf = (f: FieldMeta | undefined, row: Row): [string, State] | null => {
  const k = f ? textOf(row[f.key]) : "";
  const s = k ? f?.states?.[k] : undefined;
  return s ? [k, s] : null;
};

function Timeline({
  meta,
  title,
  api,
  place,
  spec,
  empty,
}: RecordTimelineProps & { meta: RecordMeta }) {
  const { params } = place;
  const narrow = useNarrow();
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const todayKey = dayKey(today);
  const zoom = zoomOf(params);
  const anchor = anchorOf(params, today);
  const anchorKey = dayKey(anchor);
  const days = useMemo(() => rangeOf(dayFrom(anchorKey) as Date, zoom), [anchorKey, zoom]);
  const field = (k: string | undefined) => (k ? meta.fields.find((f) => f.key === k) : undefined);
  const kindField = field(spec.kind);

  // The list's own ask, its date left to the axis.
  const ask = askOf(meta, params);
  const where = { ...((ask.where as Record<string, unknown> | undefined) ?? {}) };
  delete where[spec.at];
  const base: ListAsk = { ...ask, where };
  const statAsk = {
    record: meta.id,
    ...(ask.view ? { view: ask.view } : {}),
    ...(Object.keys(where).length ? { where } : {}),
    ...(ask.q ? { q: ask.q } : {}),
    at: spec.at,
    period: days.length,
    until: anchorKey,
    zone: zone(),
    ...(kindField?.states ? { by: kindField.key } : {}),
  };
  const stats = useLoad<RecordsStat | null>(
    `timeline:${JSON.stringify(statAsk)}`,
    () => (api.stats ? api.stats(statAsk) : Promise.resolve(null)),
    api,
  );
  const counts = useMemo(
    () => (stats.data ? countsOf(days, stats.data.series) : null),
    [stats.data, days],
  );
  const total = counts?.reduce((n, d) => n + d.n, 0) ?? null;

  const saved = useSavedViews(api.keep, meta.id);
  useLastUsed(api.keep, meta, place, saved);

  // A jump in day zoom: the day's section comes to the top and washes once.
  const [landed, setLanded] = useState<{ day: string; n: number } | null>(null);
  const jump = (day: string) => setLanded((l) => ({ day, n: (l?.n ?? 0) + 1 }));
  useEffect(() => {
    if (!landed) return;
    const el = document.getElementById(`tl-${landed.day}`);
    const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
    el?.scrollIntoView({ block: "start", behavior: still ? "auto" : "smooth" });
  }, [landed]);
  const go = (to: Date | null, z: Zoom = zoom) =>
    to
      ? place.link({
          day: dayKey(to) === todayKey ? null : dayKey(to),
          zoom: z === "day" ? null : z,
        })
      : null;
  const before = stepOf(anchor, zoom, -1, today);
  const after = stepOf(anchor, zoom, 1, today);
  const stepWord = zoom === "day" ? "Day" : zoom === "week" ? "Week" : "Month";

  return (
    <div className={cn(ROOT, "grid min-w-0 gap-4")}>
      <header className="flex flex-wrap items-start justify-between gap-3">
        <PageTitle title={title ?? meta.name.many} />
        <div className="flex items-center gap-1">
          <ButtonLink
            href={go(before) ?? undefined}
            tone="quiet"
            size="dense"
            aria-label={`${stepWord} before`}
            {...tipProps(`${stepWord} before`)}
          >
            <ChevronLeft className="size-4" />
          </ButtonLink>
          <ButtonLink
            href={go(today) ?? undefined}
            tone="quiet"
            size="dense"
            aria-current={anchorKey === todayKey ? "date" : undefined}
          >
            Today
          </ButtonLink>
          <ButtonLink
            href={go(after) ?? undefined}
            tone="quiet"
            size="dense"
            aria-label={`${stepWord} after`}
            aria-disabled={after ? undefined : true}
            className={after ? undefined : "pointer-events-none opacity-40"}
            {...tipProps(`${stepWord} after`)}
          >
            <ChevronRight className="size-4" />
          </ButtonLink>
          <input
            type="date"
            aria-label="Go to a day"
            value={anchorKey}
            max={todayKey}
            onChange={(e) => {
              const d = dayFrom(e.target.value);
              const to = d ? go(d) : null;
              if (to) place.go(to, true);
            }}
            className="h-8 rounded-(--ui-radius) border border-(--ui-edge) bg-(--ui-paper) px-2 text-[13px] text-(--ui-ink)"
          />
        </div>
      </header>

      <div className="grid gap-3">
        <ViewTabs
          meta={meta}
          current={ask.view}
          counts={undefined}
          place={place}
          saved={saved}
          keep={api.keep}
        />
        <ListBar
          meta={meta}
          place={place}
          shown={new Set([spec.kind, spec.channel, spec.who].filter((k): k is string => !!k))}
          keep={api.keep}
          saved={saved}
          facets={facetsOf(api, base)}
          display={
            <>
              <ZoomSwitch zoom={zoom} place={place} />
              <TimelineSwitch on="timeline" place={place} />
            </>
          }
          end={total === null ? "" : `${lines(total)} ${rangeWords(days)}`}
        />
      </div>

      {stats.error && !stats.data ? (
        <LoadFailed error={stats.error} onRetry={stats.retry} />
      ) : (
        <>
          <Strip
            zoom={zoom}
            counts={counts}
            today={todayKey}
            onDay={(d) => (zoom === "day" ? jump(d) : place.go(go(dayFrom(d), "day") as string))}
            onWeek={(w) => place.go(go(dayFrom(w.last), "week") as string)}
          />
          {!counts ? (
            <ListSkeleton />
          ) : total === 0 ? (
            <Empty>
              {params.has("q") || Object.keys(where).length
                ? `Nothing matches ${rangeWords(days)}.`
                : (empty ?? `Nothing happened ${rangeWords(days)}.`)}
            </Empty>
          ) : zoom === "day" ? (
            <Days
              meta={meta}
              api={api}
              base={base}
              spec={spec}
              place={place}
              counts={counts}
              today={todayKey}
              landed={landed}
              narrow={narrow}
            />
          ) : zoom === "week" ? (
            <WeekRows meta={meta} spec={spec} place={place} counts={counts} go={go} />
          ) : (
            <MonthRows meta={meta} spec={spec} place={place} counts={counts} go={go} />
          )}
          {counts ? (
            <div className="flex justify-center">
              <ButtonLink href={go(earlierOf(days)) ?? undefined} tone="secondary" size="dense">
                Earlier: {said(dayKey(earlierOf(days) as Date), SHORT)} and before
              </ButtonLink>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}

/** "in the 14 days to Oct 14": the range in words. */
const rangeWords = (days: readonly Date[]) => {
  const first = days[0];
  const last = days.at(-1);
  if (!first || !last) return "";
  return `from ${first.toLocaleDateString("en-US", SHORT)} to ${last.toLocaleDateString("en-US", SHORT)}`;
};

function ZoomSwitch({ zoom, place }: { zoom: Zoom; place: Place }) {
  return (
    <nav
      aria-label="Zoom"
      className="inline-flex h-8 shrink-0 overflow-hidden rounded-(--ui-radius) border border-(--ui-hair) bg-(--ui-paper) pointer-coarse:h-11"
    >
      {ZOOMS.map(([z, label], i) => (
        <a
          key={z}
          href={place.link({ zoom: z === "day" ? null : z })}
          aria-current={z === zoom ? "page" : undefined}
          className={cn(
            "grid place-items-center px-2.5 text-[12.5px] font-medium text-(--ui-ink-2) no-underline transition-colors duration-150 hover:text-(--ui-ink) aria-[current=page]:bg-(--ui-fill) aria-[current=page]:text-(--ui-ink)",
            i > 0 && "border-l border-(--ui-hair)",
          )}
        >
          {label}
        </a>
      ))}
    </nav>
  );
}

/**
 * Bars for the range: a day each, or a week each zoomed to months. Pressed, a day comes to the
 * top (day zoom) or opens zoomed in. Heights by square root, so a huge day leaves the rest seen.
 */
function Strip({
  zoom,
  counts,
  today,
  onDay,
  onWeek,
}: {
  zoom: Zoom;
  counts: DayCount[] | null;
  today: string;
  onDay: (day: string) => void;
  onWeek: (w: WeekCount) => void;
}) {
  const weeks = zoom === "month" && counts ? weeksOf(counts) : null;
  const bars: { key: string; n: number; tip: string; label: string | null; press: () => void }[] =
    weeks
      ? weeks.map((w, i) => ({
          key: w.week,
          n: w.n,
          tip: `${said(w.week, SHORT)} to ${said(w.last, SHORT)}: ${lines(w.n)}`,
          label:
            i === 0 || w.week.slice(5, 7) !== weeks[i - 1]?.week.slice(5, 7)
              ? said(w.week, { month: "short" })
              : null,
          press: () => onWeek(w),
        }))
      : (counts ?? []).map((d, i, all) => ({
          key: d.day,
          n: d.n,
          tip: `${said(d.day, LONG)}: ${lines(d.n)}`,
          label:
            zoom === "day"
              ? (dayFrom(d.day) as Date).getDate().toString()
              : i === 0 || d.day.slice(5, 7) !== all[i - 1]?.day.slice(5, 7)
                ? said(d.day, SHORT)
                : null,
          press: () => onDay(d.day),
        }));
  const max = Math.max(0, ...bars.map((b) => b.n));
  return (
    <nav aria-label="Lines by day" className="pt-1 pb-2">
      <div className={cn("flex h-14 items-end", zoom === "day" ? "gap-1.5" : "gap-px sm:gap-0.5")}>
        {counts
          ? bars.map((b) => (
              <button
                key={b.key}
                type="button"
                onClick={b.press}
                aria-label={b.tip}
                {...tipProps(b.tip)}
                className="group flex h-full min-w-0 flex-1 cursor-pointer items-end border-0 bg-transparent p-0"
              >
                <span
                  className={cn(
                    "block w-full rounded-t-[2px] transition-colors duration-150 group-hover:bg-(--ui-ink-2)",
                    b.key === today || (weeks && b.key === weeks.at(-1)?.week)
                      ? "bg-(--ui-active)"
                      : "bg-(--ui-ink-3)",
                    b.n === 0 && "h-px! bg-(--ui-hair)",
                  )}
                  style={{ height: `${barOf(b.n, max) * 100}%` }}
                />
              </button>
            ))
          : Array.from({ length: 14 }, (_, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: placeholders have no identity.
              <span key={i} className="h-1/3 flex-1 animate-pulse bg-(--ui-wash)" />
            ))}
      </div>
      <div className={cn("mt-1 flex", zoom === "day" ? "gap-1.5" : "gap-px sm:gap-0.5")}>
        {bars.map((b) => (
          <span
            key={b.key}
            aria-hidden
            className="min-w-0 flex-1 overflow-visible text-[11px] whitespace-nowrap text-(--ui-ink-3) tabular-nums"
          >
            {b.label}
          </span>
        ))}
      </div>
    </nav>
  );
}

/** A count's kinds as chips, each a link to the timeline narrowed to it. */
function KindChips({
  by,
  kindField,
  place,
  max,
}: {
  by: Record<string, number>;
  kindField: FieldMeta | undefined;
  place: Place;
  max: number;
}) {
  if (!kindField) return null;
  const { top, rest } = topOf(by, max);
  return (
    <span className="flex min-w-0 flex-wrap items-center gap-1.5">
      {top.map(([k, n]) => {
        const s = kindField.states?.[k] ?? { label: k, tone: "neutral" as const };
        return (
          <a
            key={k}
            href={place.link({ [kindField.key]: k, zoom: null })}
            {...tipProps(`${s.label}: ${lines(n)}`)}
            className="inline-flex items-center gap-1.5 rounded-(--ui-radius) border border-(--ui-hair) bg-(--ui-paper) px-1.5 py-0.5 text-[12px] font-medium whitespace-nowrap text-(--ui-ink-2) no-underline hover:text-(--ui-ink)"
          >
            <Cue state={s} />
            <span>{s.label}</span>
            <span className="tabular-nums">{num(n)}</span>
          </a>
        );
      })}
      {rest ? (
        <span className="text-[12px] text-(--ui-ink-3) tabular-nums">+{num(rest)} more</span>
      ) : null}
    </span>
  );
}

/** Day zoom: a section per day with lines, empty runs folded, newest on top. */
function Days({
  meta,
  api,
  base,
  spec,
  place,
  counts,
  today,
  landed,
  narrow,
}: {
  meta: RecordMeta;
  api: RecordsApi;
  base: ListAsk;
  spec: TimelineSpec;
  place: Place;
  counts: DayCount[];
  today: string;
  landed: { day: string; n: number } | null;
  narrow: boolean;
}) {
  const keep = useMemo(() => new Set([today, ...(landed ? [landed.day] : [])]), [today, landed]);
  const stretches = stretchesOf(counts, keep);
  return (
    <div className="grid gap-3">
      {stretches.map((s) =>
        "quiet" in s ? (
          <p
            key={`q${s.quiet.to}`}
            className="flex items-center gap-2 px-1 text-[13px] text-(--ui-ink-3)"
          >
            <span aria-hidden className="h-px w-6 bg-(--ui-hair)" />
            Nothing{" "}
            {s.quiet.days === 1
              ? `on ${said(s.quiet.from, LONG)}`
              : `from ${said(s.quiet.from, SHORT)} to ${said(s.quiet.to, SHORT)}`}
          </p>
        ) : (
          <DaySection
            key={s.day.day}
            meta={meta}
            api={api}
            base={base}
            spec={spec}
            place={place}
            count={s.day}
            today={today}
            landed={landed?.day === s.day.day ? landed.n : 0}
            narrow={narrow}
          />
        ),
      )}
    </div>
  );
}

/** Mounts its body once it nears the screen, and keeps it. */
function useSeen<T extends Element>(): [RefObject<T | null>, boolean] {
  const ref = useRef<T | null>(null);
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    if (seen) return;
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") {
      setSeen(true);
      return;
    }
    const io = new IntersectionObserver(
      (es) => {
        if (es.some((e) => e.isIntersecting)) setSeen(true);
      },
      { rootMargin: "600px 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [seen]);
  return [ref, seen];
}

function DaySection({
  meta,
  api,
  base,
  spec,
  place,
  count,
  today,
  landed,
  narrow,
}: {
  meta: RecordMeta;
  api: RecordsApi;
  base: ListAsk;
  spec: TimelineSpec;
  place: Place;
  count: DayCount;
  today: string;
  landed: number;
  narrow: boolean;
}) {
  const [ref, seen] = useSeen<HTMLElement>();
  const kindField = spec.kind ? meta.fields.find((f) => f.key === spec.kind) : undefined;
  // A jump's landing washes the head once; a second jump to the same day washes again.
  const [wash, setWash] = useState(0);
  useEffect(() => {
    if (landed) setWash(landed);
  }, [landed]);
  return (
    <section
      ref={ref}
      id={`tl-${count.day}`}
      aria-label={said(count.day, LONG)}
      className="-mx-4 scroll-mt-[calc(var(--phone-bar,0px)+8px)]"
    >
      <header
        key={wash}
        className={cn(
          "sticky top-(--phone-bar,0px) z-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-(--ui-hair) bg-(--ui-canvas) px-4 py-2.5",
          wash > 0 && "animate-ui-changed",
        )}
      >
        <h2 className="m-0 flex items-baseline gap-2 text-[15px] leading-[22px] font-semibold">
          {said(count.day, LONG)}
          {count.day === today ? (
            <span className="text-[12px] font-semibold text-(--ui-active)">Today</span>
          ) : null}
        </h2>
        <KindChips by={count.by} kindField={kindField} place={place} max={narrow ? 2 : 4} />
        <span className="ml-auto text-[12px] font-medium whitespace-nowrap text-(--ui-ink-2) tabular-nums">
          {lines(count.n)}
        </span>
      </header>
      {count.n === 0 ? (
        <p className="m-0 px-4 py-3 text-[13px] text-(--ui-ink-3)">Nothing this day.</p>
      ) : seen ? (
        <DayLines
          meta={meta}
          api={api}
          base={base}
          spec={spec}
          place={place}
          day={count.day}
          n={count.n}
          narrow={narrow}
        />
      ) : (
        <LinesHold n={Math.min(count.n, 4)} />
      )}
    </section>
  );
}

function LinesHold({ n }: { n: number }) {
  return (
    <ol className="m-0 grid list-none gap-2 px-4 py-3" aria-busy="true">
      {Array.from({ length: n }, (_, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: placeholders have no identity.
        <li key={i} className="h-11 animate-pulse rounded-(--ui-radius) bg-(--ui-wash)" />
      ))}
    </ol>
  );
}

/** One day's lines, a page at a time, newest first. */
function DayLines({
  meta,
  api,
  base,
  spec,
  place,
  day,
  n,
  narrow,
}: {
  meta: RecordMeta;
  api: RecordsApi;
  base: ListAsk;
  spec: TimelineSpec;
  place: Place;
  day: string;
  n: number;
  narrow: boolean;
}) {
  const ask: ListAsk = {
    ...base,
    where: { ...((base.where as object | undefined) ?? {}), [spec.at]: dayWhere(day) },
    sort: `-${spec.at}`,
    limit: DAY_PAGE,
  };
  const key = JSON.stringify(ask);
  const first = useLoad<RecordsPage>(
    `tl:${key}`,
    (before) => listChanged((a) => api.list(a), ask, before),
    api,
  );
  const [more, setMore] = useState<{ key: string; rows: Row[]; next: string | null } | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<Error | null>(null);
  // Lines that weren't there on the read before arrive with a wash.
  const known = useRef<Set<string> | null>(null);
  const fresh = useMemo(() => {
    const ids = (first.data?.rows ?? []).map((r) => String(r.id));
    const was = known.current;
    if (first.data && !first.loading) known.current = new Set(ids);
    return was ? new Set(ids.filter((id) => !was.has(id))) : new Set<string>();
  }, [first.data, first.loading]);
  const extra = more?.key === key ? more : null;
  const rows = [...(first.data?.rows ?? []), ...(extra?.rows ?? [])];
  const next = extra ? extra.next : (first.data?.next ?? null);
  const readMore = async () => {
    if (!next) return;
    setBusy(true);
    setFailed(null);
    try {
      const got = await api.list({ ...ask, cursor: next });
      setMore({ key, rows: [...(extra?.rows ?? []), ...got.rows], next: got.next });
    } catch (err) {
      setFailed(err instanceof Error ? err : new Error(String(err)));
    } finally {
      setBusy(false);
    }
  };
  if (first.error && !first.data)
    return (
      <div className="px-4 py-3">
        <LoadFailed error={first.error} onRetry={first.retry} />
      </div>
    );
  if (!first.data) return <LinesHold n={Math.min(n, 4)} />;
  const left = Math.max(0, n - rows.length);
  return (
    <>
      <ol
        className={cn(
          "relative m-0 grid list-none px-4 py-2",
          // The rail: one rule down the node column.
          "before:absolute before:top-0 before:bottom-0 before:w-px before:bg-(--ui-hair) before:content-['']",
          narrow ? "before:left-[calc(16px+11px)]" : "before:left-[calc(16px+64px+12px+11px)]",
        )}
      >
        {rows.map((r) => (
          <Line
            key={String(r.id)}
            meta={meta}
            row={r}
            spec={spec}
            place={place}
            narrow={narrow}
            fresh={fresh.has(String(r.id))}
          />
        ))}
      </ol>
      {next && left > 0 ? (
        <div className="flex flex-wrap items-center gap-3 border-t border-(--ui-hair) px-4 py-2.5">
          <Button size="dense" tone="secondary" busy={busy} onClick={() => void readMore()}>
            Show {num(Math.min(DAY_PAGE, left))} more
          </Button>
          <span className="text-[12px] text-(--ui-ink-3) tabular-nums">
            {num(left)} left this day
          </span>
          {failed ? (
            <span className="text-[12px] text-(--ui-warn-ink)">{failed.message}</span>
          ) : null}
        </div>
      ) : null}
    </>
  );
}

/** One line on the rail: its time, its kind's node, and its card. */
function Line({
  meta,
  row,
  spec,
  place,
  narrow,
  fresh,
}: {
  meta: RecordMeta;
  row: Row;
  spec: TimelineSpec;
  place: Place;
  narrow: boolean;
  fresh: boolean;
}) {
  const field = (k: string | undefined) => (k ? meta.fields.find((f) => f.key === k) : undefined);
  const kind = stateOf(field(spec.kind), row);
  const channel = stateOf(field(spec.channel), row);
  const raw = textOf(row[spec.at]);
  const at = raw ? dateOf(raw) : null;
  const time = at?.toLocaleTimeString("en-US", TIME) ?? "";
  const who = spec.who ? textOf(row[spec.who]) : "";
  const whoHref = spec.whoLink ? textOf(row[spec.whoLink]) : "";
  const source = spec.link ? textOf(row[spec.link]) : "";
  const context = spec.context ? textOf(row[spec.context]) : "";
  const note = spec.note ? textOf(row[spec.note]) : "";
  const tint = kind?.[1].tint;
  const color = tint === undefined ? "var(--ui-ink-3)" : tintColor(tint);
  const icon = kind ? spec.icons?.[kind[0]] : undefined;
  const summary = titleOf(meta, row);
  return (
    <li
      className={cn(
        "relative grid items-start gap-x-3 py-1.5",
        narrow ? "grid-cols-[22px_minmax(0,1fr)]" : "grid-cols-[64px_22px_minmax(0,1fr)]",
      )}
    >
      {narrow ? null : (
        <time
          dateTime={at?.toISOString()}
          className="pt-2.5 text-right text-[12px] text-(--ui-ink-3) tabular-nums"
        >
          {time}
        </time>
      )}
      <span
        aria-hidden
        className="relative z-1 mt-2 grid size-[22px] place-items-center rounded-full border bg-(--ui-paper)"
        style={{ color, borderColor: `color-mix(in srgb, ${color} 45%, transparent)` }}
      >
        {icon ? (
          <Icon name={icon} size={12} />
        ) : (
          <span className="size-2 rounded-full" style={{ background: color }} />
        )}
      </span>
      <div
        className={cn(
          "group relative min-w-0 rounded-(--ui-radius) border border-(--ui-hair) bg-(--ui-paper) px-3 py-2 transition-[background-color] duration-150 hover:bg-(--ui-hover)",
          fresh && "animate-ui-changed",
        )}
      >
        <div className="flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-0.5 text-[12px] text-(--ui-ink-2)">
          {kind ? <span className="font-medium whitespace-nowrap">{kind[1].label}</span> : null}
          {channel ? (
            <span className="inline-flex items-center gap-1 whitespace-nowrap">
              <Cue state={channel[1]} size={12} />
              {channel[1].label}
            </span>
          ) : null}
          {who ? (
            whoHref ? (
              <a
                href={whoHref}
                className="relative z-1 min-w-0 wrap-anywhere whitespace-normal font-medium text-(--ui-ink) no-underline hover:underline"
              >
                {who}
              </a>
            ) : (
              <span className="min-w-0 wrap-anywhere whitespace-normal font-medium text-(--ui-ink)">
                {who}
              </span>
            )
          ) : null}
          {narrow ? (
            <time dateTime={at?.toISOString()} className="ml-auto text-(--ui-ink-3) tabular-nums">
              {time}
            </time>
          ) : null}
        </div>
        <div className="flex min-w-0 items-center gap-2">
          {/* The whole card opens the line; the person and the source stay their own links. */}
          <a
            href={place.page(row.id)}
            className="min-w-0 flex-1 wrap-anywhere whitespace-normal text-[13.5px] text-(--ui-ink) no-underline after:absolute after:inset-0 after:content-['']"
          >
            {summary || "-"}
          </a>
          {source ? (
            <SourceLink href={source} className="relative z-1 pointer-coarse:size-9" />
          ) : null}
        </div>
        {!source && note ? <NoLink note={note} context={context} className="relative z-1" /> : null}
      </div>
    </li>
  );
}

/** A dense row: when, a bar, a count, and its kinds; pressed, it zooms in. */
function CountRow({
  href,
  when,
  n,
  max,
  by,
  kindField,
  place,
  current,
}: {
  href: string;
  when: ReactNode;
  n: number;
  max: number;
  by: Record<string, number>;
  kindField: FieldMeta | undefined;
  place: Place;
  current: boolean;
}) {
  return (
    <li className="grid grid-cols-[minmax(84px,120px)_minmax(0,1fr)] items-center gap-x-3 gap-y-1 border-b border-(--ui-hair) px-4 py-2 last:border-b-0 sm:grid-cols-[120px_minmax(80px,200px)_56px_minmax(0,1fr)]">
      <a
        href={href}
        className={cn(
          "text-[13px] whitespace-nowrap no-underline hover:underline",
          current ? "font-semibold text-(--ui-active)" : "text-(--ui-ink)",
        )}
      >
        {when}
      </a>
      <span aria-hidden className="h-2 overflow-hidden rounded-full bg-(--ui-wash) max-sm:hidden">
        <span
          className="block h-full rounded-full bg-(--ui-ink-3)"
          style={{ width: `${barOf(n, max) * 100}%` }}
        />
      </span>
      <span
        className={cn(
          "text-right text-[13px] tabular-nums max-sm:text-left",
          n ? "text-(--ui-ink)" : "text-(--ui-ink-3)",
        )}
      >
        {n ? num(n) : "-"}
      </span>
      <span className="min-w-0 max-sm:col-span-2">
        <KindChips by={by} kindField={kindField} place={place} max={3} />
      </span>
    </li>
  );
}

function WeekRows({
  meta,
  spec,
  place,
  counts,
  go,
}: {
  meta: RecordMeta;
  spec: TimelineSpec;
  place: Place;
  counts: DayCount[];
  go: (to: Date | null, z?: Zoom) => string | null;
}) {
  const kindField = spec.kind ? meta.fields.find((f) => f.key === spec.kind) : undefined;
  const weeks = weeksOf(counts).reverse();
  const max = Math.max(0, ...counts.map((d) => d.n));
  const today = dayKey(new Date());
  return (
    <div className="grid gap-3">
      {weeks.map((w) => (
        <section key={w.week} aria-label={`Week of ${said(w.week, SHORT)}`} className="-mx-4">
          <header className="sticky top-(--phone-bar,0px) z-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-(--ui-hair) bg-(--ui-canvas) px-4 py-2.5">
            <h2 className="m-0 text-[15px] leading-[22px] font-semibold">
              {said(w.week, SHORT)} to {said(w.last, SHORT)}
            </h2>
            <span className="ml-auto text-[12px] font-medium text-(--ui-ink-2) tabular-nums">
              {lines(w.n)}
            </span>
          </header>
          <ol className="m-0 list-none p-0">
            {[...w.days].reverse().map((d) => (
              <CountRow
                key={d.day}
                href={go(dayFrom(d.day), "day") ?? ""}
                when={said(d.day, LONG)}
                n={d.n}
                max={max}
                by={d.by}
                kindField={kindField}
                place={place}
                current={d.day === today}
              />
            ))}
          </ol>
        </section>
      ))}
    </div>
  );
}

function MonthRows({
  meta,
  spec,
  place,
  counts,
  go,
}: {
  meta: RecordMeta;
  spec: TimelineSpec;
  place: Place;
  counts: DayCount[];
  go: (to: Date | null, z?: Zoom) => string | null;
}) {
  const kindField = spec.kind ? meta.fields.find((f) => f.key === spec.kind) : undefined;
  const weeks = weeksOf(counts);
  const months = monthsOf(weeks).reverse();
  const max = Math.max(0, ...weeks.map((w) => w.n));
  const thisWeek = weeks.at(-1)?.week;
  return (
    <div className="grid gap-3">
      {months.map((m) => {
        const n = m.weeks.reduce((s, w) => s + w.n, 0);
        return (
          <section key={m.month} aria-label={m.month} className="-mx-4">
            <header className="sticky top-(--phone-bar,0px) z-2 flex items-center gap-3 border-b border-(--ui-hair) bg-(--ui-canvas) px-4 py-2.5">
              <h2 className="m-0 text-[15px] leading-[22px] font-semibold">
                {said(`${m.month}-01`, { month: "long", year: "numeric" })}
              </h2>
              <span className="ml-auto text-[12px] font-medium text-(--ui-ink-2) tabular-nums">
                {lines(n)}
              </span>
            </header>
            <ol className="m-0 list-none p-0">
              {[...m.weeks].reverse().map((w) => (
                <CountRow
                  key={w.week}
                  href={go(dayFrom(w.last), "week") ?? ""}
                  when={`${said(w.week, SHORT)} to ${said(w.last, SHORT)}`}
                  n={w.n}
                  max={max}
                  by={w.by}
                  kindField={kindField}
                  place={place}
                  current={w.week === thisWeek}
                />
              ))}
            </ol>
          </section>
        );
      })}
    </div>
  );
}

/** One line on a short rail: a person's page's newest lines. */
export interface MiniLine {
  id: string;
  /** ISO. */
  at: string;
  summary: string;
  /** The line's own page. */
  href: string;
  /** Its source, opened beside. */
  source?: string | null;
  /** Where it sits, offered when it has no source. */
  context?: string | null;
  /** Said in place of a source when it should have one and has none. */
  note?: string | null;
  kind?: State | null;
  /** The kind's key, for its icon. */
  kindKey?: string | null;
  channel?: State | null;
}

/** A person's own lines, newest first, on a short rail; "See all" opens the full timeline. */
export function TimelineMini({
  lines: items,
  icons,
  all,
}: {
  lines: readonly MiniLine[];
  icons?: Readonly<Record<string, IconName>>;
  all?: { href: string; label: string } | undefined;
}) {
  return (
    <div className="grid gap-2">
      <ol className="relative m-0 grid list-none p-0 before:absolute before:top-2 before:bottom-2 before:left-[10px] before:w-px before:bg-(--ui-hair) before:content-['']">
        {items.map((l) => {
          const color = l.kind?.tint === undefined ? "var(--ui-ink-3)" : tintColor(l.kind.tint);
          const icon = l.kindKey ? icons?.[l.kindKey] : undefined;
          const at = dateOf(l.at);
          return (
            <li key={l.id} className="relative grid grid-cols-[22px_minmax(0,1fr)] gap-x-3 py-1">
              <span
                aria-hidden
                className="relative z-1 mt-0.5 grid size-[22px] place-items-center rounded-full border bg-(--ui-paper)"
                style={{ color, borderColor: `color-mix(in srgb, ${color} 45%, transparent)` }}
              >
                {icon ? (
                  <Icon name={icon} size={12} />
                ) : (
                  <span className="size-2 rounded-full" style={{ background: color }} />
                )}
              </span>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-x-2 text-[12px] text-(--ui-ink-2)">
                  {l.kind ? <span className="font-medium">{l.kind.label}</span> : null}
                  {l.channel ? (
                    <span className="inline-flex items-center gap-1">
                      <Cue state={l.channel} size={12} />
                      {l.channel.label}
                    </span>
                  ) : null}
                  <time dateTime={l.at} className="text-(--ui-ink-3) tabular-nums">
                    {at?.toLocaleString("en-US", { ...SHORT, ...TIME }) ?? ""}
                  </time>
                </div>
                <div className="flex min-w-0 items-start gap-2">
                  {/* Whole: only a huge post's paragraph is cut, at eight lines. */}
                  <a
                    href={l.href}
                    className="min-w-0 flex-1 text-[13.5px] wrap-anywhere whitespace-normal text-(--ui-ink) no-underline hover:underline"
                  >
                    {l.summary || "-"}
                  </a>
                  {l.source ? <SourceLink href={l.source} /> : null}
                </div>
                {!l.source && l.note ? <NoLink note={l.note} context={l.context} /> : null}
              </div>
            </li>
          );
        })}
      </ol>
      {all ? (
        <ButtonLink href={all.href} tone="secondary" size="dense" className="justify-self-start">
          {all.label}
        </ButtonLink>
      ) : null}
    </div>
  );
}

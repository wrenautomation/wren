/**
 * The Overview template (console standard): an app's numbers first, each one a link to the rows
 * behind it, then its top records. A tile with a period counts or adds up a view's rows by date,
 * against the same stretch of the period before, with a bar per day (`recordsStats`). A tile
 * without one counts the rows there now: a state keeps no history, so it has no change to show.
 * Under the tiles, the period tiles' days as one chart, a tab each.
 */
import type { RecordMeta } from "@wren/core/records";
import type { Period, RecordsStat, Row } from "@wren/core/records/serve";
import { cn } from "cn";
import { useEffect, useState } from "react";
import { TrendChart } from "./charts/index.js";
import { arrangeTiles, TilesMenu, type TilesPref, usePref } from "./customize.js";
import { Empty, LoadFailed, Loading } from "./feedback.js";
import { FieldCell } from "./fields.js";
import { duration, money, month, num } from "./format.js";
import { clipProps, tipProps } from "./hint.js";
import { FRAME, FRAME_BODY, FRAME_HEAD, PageTitle, SECTION_TITLE } from "./layout.js";
import { useNarrow } from "./list-bar.js";
import { type OverviewQueue, QueuePanel } from "./overview-queues.js";
import {
  askOf,
  cap,
  type RecordsApi,
  ROOT,
  textOf,
  titleOf,
  useLoad,
  useTypes,
} from "./records.js";
import { Sweep } from "./sweep.js";

export type { OverviewQueue } from "./overview-queues.js";

export interface OverviewTile {
  label: string;
  record: string;
  /** The list it opens, with the view and filters it reads: "/inbox/replies?view=all". */
  href: string;
  /** Days back (today counts), or the month so far. Left out: the rows there now. */
  period?: Period;
  /** The date field the period runs on; the view's `at` when left out. */
  at?: string;
  /** A number or money field to add up; rows are counted when left out. */
  sum?: string;
  /**
   * A number or duration field's median over the period, with the newest row's beside it: how
   * long a lead waits for the first text. Takes a period.
   */
  median?: string;
  /** Rows waiting on someone: the number shows amber while above zero. */
  needs?: true;
  /**
   * A field read off the newest row, for a type with a row a month: its month, the change from
   * the row before, and a bar a month. Takes no period.
   */
  pick?: string;
  /** Said in place of a pick with no value: "No paying clients yet". */
  none?: string;
}

export interface OverviewTop {
  label: string;
  record: string;
  /** The list, with the view it shows the first rows of. */
  href: string;
  /** The fields beside each title. */
  fields: string[];
  /** A field read in full under each title: why this one is first. */
  line?: string;
  /** Words after a field's value, in place of its label: "3h to reply", "2 of 12 to DM". */
  units?: Readonly<Record<string, string>>;
  /** Said while it's empty. */
  empty: string;
}

export interface OverviewProps {
  title: string;
  /** "section": a block inside another page (Today), its title a section's, not the page's. */
  as?: "section" | undefined;
  api: RecordsApi;
  tiles: OverviewTile[];
  /**
   * What waits on the viewer, by queue: with these, the page draws Overview E (the total, a bar,
   * the queues ranked by their oldest wait) and its period tiles as trend cards beside it.
   */
  queues?: OverviewQueue[] | undefined;
  top?: OverviewTop[] | undefined;
  /** The pref his tile order and hidden tiles are kept under ("tiles:inbox.overview"). */
  keepAs?: string | undefined;
}

const ZONE = Intl.DateTimeFormat().resolvedOptions().timeZone;
const TOP = 5;
const blank = (c: unknown) => c === null || c === undefined || c === "";

const split = (href: string) => {
  const [path = "", query = ""] = href.split("?");
  return { path, params: new URLSearchParams(query) };
};
/** The list ask `href` makes, minus its sort and page. A link to another record's page keeps no view. */
export const askFor = (meta: RecordMeta, href: string) => {
  const { params } = split(href);
  const view = params.get("view");
  if (view && !meta.views.some((v) => v.id === view)) params.delete("view");
  const { sort: _, cursor: __, ...ask } = askOf(meta, params);
  return ask;
};
const day = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
/** The first day a period counts, here: "2026-10-01" for the month. */
export function periodStart(period: Period, now = new Date()): string {
  if (period === "month") return day(new Date(now.getFullYear(), now.getMonth(), 1));
  return day(new Date(now.getFullYear(), now.getMonth(), now.getDate() - (period - 1)));
}
const daysIn = (d: Date) => new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
const periodName = (p: Period) =>
  p === "month" ? "This month" : p === 1 ? "Today" : p === 7 ? "This week" : `Last ${p} days`;
const priorName = (p: Period) =>
  p === "month"
    ? "last month"
    : p === 1
      ? "yesterday"
      : p === 7
        ? "the week before"
        : `the ${p} days before`;

/** The tile's link: its list, narrowed to the period's days when it has one. */
export function tileHref(tile: OverviewTile, meta: RecordMeta, now = new Date()): string {
  if (!tile.period) return tile.href;
  const { path, params } = split(tile.href);
  const view = meta.views.find((v) => v.id === (params.get("view") ?? meta.views[0]?.id));
  const at = tile.at ?? view?.at;
  if (at) params.set(at, `${periodStart(tile.period, now)}..`);
  return `${path}?${params}`;
}

export function RecordOverview({
  title,
  as,
  api,
  tiles: all,
  queues = [],
  top = [],
  keepAs,
}: OverviewProps) {
  const types = useTypes(api);
  const narrow = useNarrow();
  const keep = keepAs ? api.keep : undefined;
  const pref = usePref<TilesPref>(keep, keepAs ?? "tiles");
  // A tile whose record isn't here (its part not installed) is left out, not a ghost forever.
  const here = (t: { record: string }) => !types.data || types.data.some((m) => m.id === t.record);
  const tiles = arrangeTiles(all, pref.value).shown.filter(here);
  // Queues too: one whose record isn't here is left out. With none left, the tiles stand alone.
  const queuesHere = types.data ? queues.filter(here) : queues;
  const asE = queuesHere.length > 0;
  // Each period tile's answer, for the chart under them: asked once, by the tile.
  const [stats, setStats] = useState<Readonly<Record<string, Shown>>>({});
  // Each tile says once it reads nothing (zero now and before, or no figure): once every tile
  // has answered, those fold into one quiet line, so a wall of zeros never hides what moved.
  const [blank, setBlank] = useState<Readonly<Record<string, boolean>>>({});
  if (types.error && !types.data) return <LoadFailed error={types.error} onRetry={types.retry} />;
  const metaOf = (id: string) => types.data?.find((t) => t.id === id);
  const settled = tiles.length > 0 && tiles.every((t) => t.label in blank);
  const folded = settled ? tiles.filter((t) => blank[t.label]) : [];
  const shown = tiles.filter((t) => !folded.includes(t));
  const told = (label: string, shown: Shown) =>
    setStats((s) => (s[label]?.stat === shown.stat ? s : { ...s, [label]: shown }));
  const said = (label: string, empty: boolean) =>
    setBlank((b) => (b[label] === empty ? b : { ...b, [label]: empty }));
  return (
    <div className={cn(ROOT, "mx-auto grid w-full max-w-[1200px] grid-cols-[minmax(0,1fr)] gap-8")}>
      {title || (keep && all.length > 1) ? (
        <div className="flex items-center justify-between gap-3">
          {!title ? (
            <span />
          ) : as === "section" ? (
            <h2 className={SECTION_TITLE}>{title}</h2>
          ) : (
            <PageTitle title={title} />
          )}
          {keep && all.length > 1 ? (
            <TilesMenu labels={all.map((t) => t.label)} pref={pref.value} onChange={pref.set} />
          ) : null}
        </div>
      ) : null}
      {asE ? (
        <div
          className={cn(
            "grid items-start gap-3.5",
            narrow ? "grid-cols-[minmax(0,1fr)]" : "grid-cols-[minmax(0,3fr)_minmax(0,2fr)]",
          )}
        >
          <QueuePanel queues={queuesHere} api={api} ready={!!types.data} />
          <div className={cn("grid gap-2.5", !shown.length && "hidden")}>
            {tiles.map((t) => {
              const meta = metaOf(t.record);
              return (
                <div key={t.label} className={cn("grid", !shown.includes(t) && "hidden")}>
                  {meta && pref.ready ? (
                    <TrendCard tile={t} meta={meta} api={api} onStat={told} onBlank={said} />
                  ) : (
                    <TileGhost />
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        <div
          className={cn(
            "grid grid-cols-[repeat(auto-fit,minmax(min(100%,220px),1fr))] gap-2.5",
            !shown.length && "hidden",
          )}
        >
          {tiles.map((t) => {
            const meta = metaOf(t.record);
            return (
              <div key={t.label} className={cn("grid", !shown.includes(t) && "hidden")}>
                {meta && pref.ready ? (
                  <Tile tile={t} meta={meta} api={api} onStat={told} onBlank={said} />
                ) : (
                  <TileGhost />
                )}
              </div>
            );
          })}
        </div>
      )}
      {folded.length ? (
        <p className="m-0 -mt-4 text-[13.5px] text-(--ui-ink-2)">
          Nothing yet:{" "}
          {folded.map((t, i) => (
            <span key={t.label}>
              {i ? ", " : ""}
              <a className="text-(--ui-ink-2) underline-offset-2 hover:underline" href={t.href}>
                {i ? t.label.charAt(0).toLowerCase() + t.label.slice(1) : t.label}
              </a>
            </span>
          ))}
          .
        </p>
      ) : null}
      {types.data && !asE && !tiles.length && !top.some(here) ? (
        <Empty>These numbers show once the parts that count them are installed.</Empty>
      ) : null}
      {/* E draws its trends as cards beside the queues; the chart by day is the tiles' own. */}
      {asE ? null : <Trends tiles={tiles} stats={stats} />}
      {top.length ? (
        <div
          className={cn(
            "grid grid-cols-[minmax(0,1fr)] gap-8",
            /* One list takes the full width; two sit side by side. */
            top.length > 1 && "lg:grid-cols-2",
          )}
        >
          {top.map((t) => {
            const meta = metaOf(t.record);
            return meta ? <Top key={t.label} top={t} meta={meta} api={api} /> : null;
          })}
        </div>
      ) : null}
    </div>
  );
}

// A tile is the artifact's trend card (`.ix .tr`): a raised leaf, no hairline.
const TILE =
  "grid content-start gap-1 bg-(--ui-paper) px-3.5 py-3 shadow-(--ui-raise) [border-radius:6px_18px]";

function TileGhost() {
  return (
    <div className={TILE} aria-busy="true">
      <div className="h-4 w-24 animate-pulse bg-(--ui-fill)" />
      <div className="h-9 w-16 animate-pulse bg-(--ui-fill)" />
    </div>
  );
}

/** A period tile's answer and how its numbers read, for the chart under the tiles. */
interface Shown {
  stat: RecordsStat;
  format: (n: number) => string;
}

/** One tile's read and how its numbers read: the same under a tile and under a trend card. */
function useTileStat(
  tile: OverviewTile,
  meta: RecordMeta,
  api: RecordsApi,
  onStat: (label: string, shown: Shown) => void,
  onBlank: (label: string, empty: boolean) => void,
) {
  const ask = askFor(meta, tile.href);
  const { period, pick } = tile;
  const load = useLoad(
    JSON.stringify([tile, ask]),
    async (): Promise<RecordsStat> => {
      if (pick) {
        if (!api.stats) throw new Error("No numbers here.");
        return api.stats({ ...ask, pick, zone: ZONE, ...(tile.at ? { at: tile.at } : {}) });
      }
      if (period) {
        if (!api.stats) throw new Error("No numbers here.");
        return api.stats({
          ...ask,
          period,
          zone: ZONE,
          ...(tile.at ? { at: tile.at } : {}),
          ...(tile.sum ? { sum: tile.sum } : {}),
          ...(tile.median ? { median: tile.median } : {}),
        });
      }
      const page = await api.list({ ...ask, limit: 1 });
      return {
        record: meta.id,
        view: page.view,
        value: page.total,
        prior: 0,
        series: [],
        currency: null,
      };
    },
    api,
  );
  const s = load.data;
  const read = pick ?? tile.median;
  const kind = read ? meta.fields.find((f) => f.key === read)?.kind : undefined;
  const fmt = (n: number) =>
    s?.currency
      ? money(n, s.currency, true)
      : kind === "duration"
        ? duration(n)
        : kind === "percent"
          ? `${Math.round(n * 1000) / 10}%`
          : pick
            ? n.toLocaleString("en-US", { maximumFractionDigits: 1 })
            : num(n);
  const delta = s?.value != null && s.prior != null ? s.value - s.prior : null;
  // biome-ignore lint/correctness/useExhaustiveDependencies: the answer is the cue; `fmt` reads it.
  useEffect(() => {
    if (s && period && !pick && s.series.length > 1) onStat(tile.label, { stat: s, format: fmt });
    if (s) onBlank(tile.label, !s.value && !s.prior && !s.latest && !s.series.some((x) => x.value));
    else if (load.error) onBlank(tile.label, false);
  }, [s, load.error]);
  return { load, s, fmt, delta };
}

/**
 * A period tile under Overview E (artifact `.tr`): a leaf card with its label and stretch, the
 * number, a bar a day and the change against the stretch before.
 */
function TrendCard({
  tile,
  meta,
  api,
  onStat,
  onBlank,
}: {
  tile: OverviewTile;
  meta: RecordMeta;
  api: RecordsApi;
  onStat: (label: string, shown: Shown) => void;
  onBlank: (label: string, empty: boolean) => void;
}) {
  const { load, s, fmt, delta } = useTileStat(tile, meta, api, onStat, onBlank);
  if (!load.data && !load.error) return <TileGhost />;
  const { period } = tile;
  const before = period ? priorName(period) : "";
  const slots = period === "month" ? daysIn(new Date()) : (s?.series.length ?? 0);
  return (
    <a
      href={tileHref(tile, meta)}
      className="grid content-start gap-1 bg-(--ui-paper) px-3.5 py-3 text-(--ui-ink) no-underline shadow-(--ui-raise) outline-none transition-[background-color] duration-200 [border-radius:6px_18px] hover:bg-(--ui-accent-wash) focus-visible:bg-(--ui-accent-wash) motion-reduce:transition-none"
    >
      <span className="text-[12.5px] text-(--ui-ink-3)">
        {tile.label}
        {period ? ` · ${periodName(period).toLowerCase()}` : ""}
      </span>
      {s ? (
        <>
          <span className="text-[24px] font-semibold tracking-[-0.02em] tabular-nums">
            {s.value === null ? (tile.none ?? "No figure yet") : fmt(s.value)}
          </span>
          {period ? (
            <>
              <Spark series={s.series} slots={slots} />
              <span className="text-[12.5px] text-(--ui-ink-3)">
                {delta === null ? null : delta === 0 ? (
                  `Same as ${before}`
                ) : (
                  <>
                    <b
                      className={cn(
                        "font-semibold",
                        delta > 0 ? "text-(--ui-good)" : "text-(--ui-ink)",
                      )}
                    >
                      {delta > 0 ? "+" : "−"}
                      {fmt(Math.abs(delta))}
                    </b>
                    {` vs ${before}`}
                  </>
                )}
              </span>
            </>
          ) : null}
        </>
      ) : (
        <span className="text-[13px] text-(--ui-bad)">{load.error?.message}</span>
      )}
    </a>
  );
}

function Tile({
  tile,
  meta,
  api,
  onStat,
  onBlank,
}: {
  tile: OverviewTile;
  meta: RecordMeta;
  api: RecordsApi;
  onStat: (label: string, shown: Shown) => void;
  /** Once loaded: whether it reads nothing at all, now or before. A failed tile stays. */
  onBlank: (label: string, empty: boolean) => void;
}) {
  const { period, pick } = tile;
  const { load, s, fmt, delta } = useTileStat(tile, meta, api, onStat, onBlank);
  if (!load.data && !load.error) return <TileGhost />;
  // A pick names its row's month and compares with the row before.
  const newest = pick ? month(s?.series.at(-1)?.at ?? null) : "";
  const before = pick ? month(s?.series.at(-2)?.at ?? null) : period ? priorName(period) : "";
  return (
    <a
      href={tileHref(tile, meta)}
      className={cn(
        TILE,
        "text-(--ui-ink) no-underline outline-none transition-[background-color] duration-200 hover:bg-(--ui-accent-wash) focus-visible:bg-(--ui-accent-wash) motion-reduce:transition-none",
        // Waiting on you: an amber rule and wash, so it reads before the outcome tiles.
        tile.needs &&
          (s?.value ?? 0) > 0 &&
          "bg-(--ui-warn-tint) shadow-[inset_0_3px_0_var(--ui-warn)] hover:bg-(--ui-warn-tint)",
      )}
    >
      <span className="text-[12.5px] text-(--ui-ink-3)">
        {tile.label}
        {pick
          ? newest && ` · ${newest}`
          : period
            ? ` · ${tile.median ? "median, " : ""}${periodName(period).toLowerCase()}`
            : ""}
      </span>
      {s ? (
        <>
          <span
            className={cn(
              "text-[24px] font-semibold tracking-[-0.02em] tabular-nums",
              tile.needs && (s.value ?? 0) > 0 && "text-(--ui-warn-ink)",
              s.value === null && "text-[15px] leading-6 font-normal text-(--ui-ink-2)",
            )}
          >
            {s.value === null ? (tile.none ?? "No figure yet") : fmt(s.value)}
          </span>
          {period || pick ? (
            <>
              <Spark
                series={s.series}
                slots={period === "month" ? daysIn(new Date()) : s.series.length}
              />
              <span className="text-[12.5px] text-(--ui-ink-3)">
                {s.latest != null ? `Newest ${fmt(s.latest)}` : null}
                {s.latest != null && delta !== null && before ? " · " : null}
                {delta === null || !before ? null : delta === 0 ? (
                  `Same as ${before}`
                ) : (
                  <>
                    <b
                      className={cn(
                        "font-semibold",
                        delta > 0 ? "text-(--ui-good)" : "text-(--ui-ink)",
                      )}
                    >
                      {delta > 0 ? "+" : "−"}
                      {fmt(Math.abs(delta))}
                    </b>
                    {` vs ${before}`}
                  </>
                )}
              </span>
            </>
          ) : null}
        </>
      ) : (
        <span className="text-[13px] text-(--ui-bad)">{load.error?.message}</span>
      )}
    </a>
  );
}

/**
 * The period tiles by day, one chart with a tab each: what moved when. Shows once one has days.
 */
function Trends({
  tiles,
  stats,
}: {
  tiles: readonly OverviewTile[];
  stats: Readonly<Record<string, Shown>>;
}) {
  // A flat line at zero says nothing a tile's 0 doesn't: only numbers that moved get a tab.
  const shown = tiles.filter((t) => stats[t.label]?.stat.series.some((p) => (p.value ?? 0) !== 0));
  const [pick, setPick] = useState<string | null>(null);
  const on = shown.find((t) => t.label === pick) ?? shown[0];
  const got = on ? stats[on.label] : undefined;
  if (!on || !got) return null;
  return (
    <section className={cn("grid grid-cols-[minmax(0,1fr)]", FRAME)} aria-label="By day">
      <Sweep />
      <div className={FRAME_HEAD}>
        <h2 className={SECTION_TITLE}>By day</h2>
        <div role="tablist" aria-label="Which number" className="flex flex-wrap gap-1">
          {shown.map((t) => (
            <button
              key={t.label}
              type="button"
              role="tab"
              aria-selected={t === on}
              onClick={() => setPick(t.label)}
              className={cn(
                "cursor-pointer border-0 px-[9px] py-1.5 text-[13px] font-semibold transition-colors duration-150 [border-radius:4px_10px_4px_10px] outline-none focus-visible:outline-2 focus-visible:outline-(--ui-focus)",
                t === on
                  ? "bg-(--ui-accent-tint) text-(--ui-active)"
                  : "bg-transparent text-(--ui-ink-3) hover:bg-(--ui-accent-wash) hover:text-(--ui-ink)",
              )}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>
      <div className={FRAME_BODY}>
        <TrendChart series={got.stat.series} label={on.label} format={got.format} />
      </div>
    </section>
  );
}

/** How many bars a trend card draws, whatever its stretch: the artifact's `.spark` has seven. */
const SPARK = 7;

/**
 * A trend card's bars (artifact `.spark`): the stretch cut in seven, each bar the sum of its days,
 * the tallest at full height. A month keeps a slot for each of its days, so days still to come
 * draw a quiet stub.
 */
export function Spark({ series, slots }: { series: RecordsStat["series"]; slots: number }) {
  const days = Math.max(slots, series.length, 1);
  const sums = Array.from({ length: SPARK }, () => 0);
  series.forEach((p, i) => {
    const at = Math.min(SPARK - 1, Math.floor((i * SPARK) / days));
    sums[at] = (sums[at] ?? 0) + Math.max(0, p.value ?? 0);
  });
  const max = Math.max(0, ...sums);
  return (
    <div aria-hidden="true" className="flex h-[26px] items-end gap-[3px]">
      {sums.map((v, i) => (
        <i
          // biome-ignore lint/suspicious/noArrayIndexKey: the seven slots never move
          key={i}
          className={cn(
            "block flex-1 rounded-[1px_3px_1px_3px]",
            v ? "bg-(--ui-chart-1) opacity-75" : "h-0.5 bg-(--ui-fill)",
          )}
          style={v ? { height: `${Math.round((v / max) * 100)}%` } : undefined}
        />
      ))}
    </div>
  );
}

function Top({ top, meta, api }: { top: OverviewTop; meta: RecordMeta; api: RecordsApi }) {
  const ask = askFor(meta, top.href);
  const sort = split(top.href).params.get("sort");
  const page = useLoad(
    JSON.stringify([top.href, ask]),
    () => api.list({ ...ask, ...(sort ? { sort } : {}), limit: TOP }),
    api,
  );
  const fields = top.fields.flatMap((k) => meta.fields.find((f) => f.key === k) ?? []);
  const line = top.line ? meta.fields.find((f) => f.key === top.line) : undefined;
  const rows: Row[] = page.data?.rows ?? [];
  const open = (r: Row) => {
    const { path, params } = split(top.href);
    params.set(meta.name.one, String(r.id));
    return `${path}?${params}`;
  };
  return (
    <section className={cn("grid grid-cols-[minmax(0,1fr)] content-start", FRAME)}>
      <Sweep />
      <div className={FRAME_HEAD}>
        <h2 className={SECTION_TITLE}>{top.label}</h2>
        <a href={top.href} className="text-[13px] text-(--ui-ink-2) hover:text-(--ui-ink)">
          All {meta.name.many}
          {page.data ? ` (${num(page.data.total)})` : ""}
        </a>
      </div>
      {page.error && !page.data ? (
        <LoadFailed className="mx-5 mt-3 mb-5" error={page.error} onRetry={page.retry} />
      ) : !page.data ? (
        <Loading
          shape="rows"
          lines={3}
          label={`Loading ${top.label}`}
          className="px-5 pt-0.5 pb-2"
        />
      ) : !rows.length ? (
        <p className="px-5 pt-3 pb-4 text-[13px] text-(--ui-ink-2)">{top.empty}</p>
      ) : (
        <ul className="m-0 mt-3 grid grid-cols-[minmax(0,1fr)] list-none p-0 text-[13px]">
          {rows.map((r) => (
            <li key={String(r.id)}>
              <a
                href={open(r)}
                // Counts that don't fit beside the title go under it, as on a phone.
                className={cn(
                  "mx-2 flex flex-wrap items-center gap-x-4 gap-y-0.5 px-3 text-(--ui-ink) no-underline outline-none transition-[background-color] duration-150 [border-radius:4px_10px_4px_10px] hover:bg-(--ui-accent-wash) focus-visible:bg-(--ui-accent-wash)",
                  line ? "py-2.5" : "min-h-10 py-1.5",
                )}
              >
                <span className="grid min-w-0 flex-1 basis-40 gap-0.5">
                  <span className="truncate font-medium" {...clipProps()}>
                    {cap(titleOf(meta, r) || textOf(r.id))}
                  </span>
                  {line && r[line.key] ? (
                    <span className="line-clamp-2 text-pretty text-(--ui-ink-2)" {...clipProps()}>
                      <FieldCell field={line} cell={r[line.key]} />
                    </span>
                  ) : null}
                </span>
                {fields.length && fields.every((f) => blank(r[f.key])) ? (
                  <span className="shrink-0 text-(--ui-ink-3)">No figure yet</span>
                ) : null}
                {/* A blank count with its unit reads "to reply" alone: left out instead. */}
                {fields
                  .filter(
                    (f) =>
                      !blank(r[f.key]) ||
                      (f.kind === "money" && fields.some((g) => !blank(r[g.key]))),
                  )
                  .map((f) => (
                    <span
                      key={f.key}
                      className="max-w-full shrink-0 truncate text-(--ui-ink-2)"
                      {...tipProps(f.label)}
                    >
                      {/* A bare amount says nothing: it reads "Per reply: CA$12", or "none". */}
                      {f.kind === "money" ? `${f.label}: ` : null}
                      {f.kind === "money" && blank(r[f.key]) ? (
                        "none"
                      ) : (
                        <FieldCell field={f} cell={r[f.key]} />
                      )}
                      {/* A bare count says nothing: "3" reads "3 members". */}
                      {top.units?.[f.key]
                        ? ` ${top.units[f.key]}`
                        : f.kind === "number"
                          ? ` ${f.label.toLowerCase()}`
                          : null}
                    </span>
                  ))}
              </a>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

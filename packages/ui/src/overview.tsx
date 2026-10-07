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
import { Sparkline, TrendChart } from "./charts/index.js";
import { arrangeTiles, TilesMenu, type TilesPref, usePref } from "./customize.js";
import { Alert } from "./feedback.js";
import { FieldCell } from "./fields.js";
import { duration, money, month, num } from "./format.js";
import { FRAME, FRAME_HEAD, PAGE_TITLE, SECTION_TITLE } from "./layout.js";
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
  /** Said while it's empty. */
  empty: string;
}

export interface OverviewProps {
  title: string;
  api: RecordsApi;
  tiles: OverviewTile[];
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

/** Tiles on each full-width row: at most four, as even as they go, so no tile sits alone. */
export function perRow(n: number): number[] {
  const rows = Math.ceil(n / 4);
  return Array.from({ length: rows }, (_, r) => Math.floor(n / rows) + (r < n % rows ? 1 : 0));
}
const SPAN = ["", "lg:col-span-12", "lg:col-span-6", "lg:col-span-4", "lg:col-span-3"];

export function RecordOverview({ title, api, tiles: all, top = [], keepAs }: OverviewProps) {
  const types = useTypes(api);
  const keep = keepAs ? api.keep : undefined;
  const pref = usePref<TilesPref>(keep, keepAs ?? "tiles");
  const tiles = arrangeTiles(all, pref.value).shown;
  // Each period tile's answer, for the chart under them: asked once, by the tile.
  const [stats, setStats] = useState<Readonly<Record<string, Shown>>>({});
  if (types.error && !types.data) return <Alert onRetry={types.retry}>{types.error.message}</Alert>;
  const metaOf = (id: string) => types.data?.find((t) => t.id === id);
  const spans = perRow(tiles.length).flatMap((k) => Array<string>(k).fill(SPAN[k] ?? ""));
  const told = (label: string, shown: Shown) =>
    setStats((s) => (s[label]?.stat === shown.stat ? s : { ...s, [label]: shown }));
  return (
    <div className={cn(ROOT, "mx-auto grid w-full max-w-[1200px] grid-cols-[minmax(0,1fr)] gap-8")}>
      <div className="flex items-center justify-between gap-3">
        <h1 className={PAGE_TITLE}>{title}</h1>
        {keep && all.length > 1 ? (
          <TilesMenu labels={all.map((t) => t.label)} pref={pref.value} onChange={pref.set} />
        ) : null}
      </div>
      <div className="grid grid-cols-2 gap-px p-px lg:grid-cols-12">
        {tiles.map((t, i) => {
          const meta = metaOf(t.record);
          // Two to a row on a phone; an odd last one takes the whole row.
          const wide = i === tiles.length - 1 && tiles.length % 2 === 1;
          return (
            <div key={t.label} className={cn("grid", spans[i], wide && "max-lg:col-span-2")}>
              {meta && pref.ready ? (
                <Tile tile={t} meta={meta} api={api} onStat={told} />
              ) : (
                <TileGhost />
              )}
            </div>
          );
        })}
      </div>
      <Trends tiles={tiles} stats={stats} />
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

// Each tile draws its own hairline (an outline over the 1px gap).
const TILE = "grid content-start gap-1 bg-(--ui-paper) p-4 outline outline-(--ui-hair)";

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

function Tile({
  tile,
  meta,
  api,
  onStat,
}: {
  tile: OverviewTile;
  meta: RecordMeta;
  api: RecordsApi;
  onStat: (label: string, shown: Shown) => void;
}) {
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
  }, [s]);
  if (!load.data && !load.error) return <TileGhost />;
  // A pick names its row's month and compares with the row before.
  const newest = pick ? month(s?.series.at(-1)?.at ?? null) : "";
  const before = pick ? month(s?.series.at(-2)?.at ?? null) : period ? priorName(period) : "";
  return (
    <a
      href={tileHref(tile, meta)}
      className={cn(
        TILE,
        "text-(--ui-ink) no-underline hover:bg-(--ui-wash)",
        // Waiting on you: an amber rule and wash, so it reads before the outcome tiles.
        tile.needs &&
          (s?.value ?? 0) > 0 &&
          "bg-(--ui-warn-tint) shadow-[inset_0_3px_0_var(--ui-warn)] hover:bg-(--ui-warn-tint)",
      )}
    >
      <span className="flex flex-wrap items-baseline justify-between gap-x-2 text-[13px] text-(--ui-ink-2)">
        <span className="font-medium text-(--ui-ink)">{tile.label}</span>
        <span>
          {pick
            ? newest
            : period
              ? tile.median
                ? `Median, ${periodName(period).toLowerCase()}`
                : periodName(period)
              : "Now"}
        </span>
      </span>
      {s ? (
        <>
          <span
            className={cn(
              "text-[28px] leading-9 font-semibold tracking-[-0.02em]",
              tile.needs && (s.value ?? 0) > 0 && "text-[36px] leading-10 text-(--ui-warn-ink)",
              s.value === null && "text-[15px] leading-6 font-normal text-(--ui-ink-2)",
            )}
          >
            {s.value === null ? (tile.none ?? "No figure yet") : fmt(s.value)}
          </span>
          {period || pick ? (
            <>
              <span className="text-[13px] text-(--ui-ink-2)">
                {[
                  s.latest != null ? `Newest ${fmt(s.latest)}` : "",
                  delta === null || !before
                    ? ""
                    : delta === 0
                      ? `Same as ${before}`
                      : `${delta > 0 ? "+" : "−"}${fmt(Math.abs(delta))} vs ${before}`,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </span>
              <Sparkline
                series={s.series}
                slots={period === "month" ? daysIn(new Date()) : s.series.length}
                label={tile.label}
                format={fmt}
                fallback={
                  <Bars
                    series={s.series}
                    slots={period === "month" ? daysIn(new Date()) : s.series.length}
                  />
                }
              />
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
  const shown = tiles.filter((t) => stats[t.label]);
  const [pick, setPick] = useState<string | null>(null);
  const on = shown.find((t) => t.label === pick) ?? shown[0];
  const got = on ? stats[on.label] : undefined;
  if (!on || !got) return null;
  return (
    <section className={cn("grid grid-cols-[minmax(0,1fr)]", FRAME)} aria-label="By day">
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
                "h-7 cursor-pointer border-0 px-2.5 text-[13px]",
                t === on
                  ? "bg-(--ui-ink) text-(--ui-paper)"
                  : "bg-transparent text-(--ui-ink-2) shadow-[inset_0_0_0_1px_var(--ui-hair)] hover:text-(--ui-ink)",
              )}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>
      <div className="p-4">
        <TrendChart series={got.stat.series} label={on.label} format={got.format} />
      </div>
    </section>
  );
}

/** A bar a day (a pick's, a month), the tallest at full height; a quiet line under days with
 * none. A month keeps a slot for each of its days, so the bars fill in as it goes. */
function Bars({ series, slots }: { series: RecordsStat["series"]; slots: number }) {
  const max = Math.max(0, ...series.map((p) => p.value ?? 0));
  const w = 100 / Math.max(1, slots, series.length);
  return (
    <svg
      viewBox="0 0 100 28"
      preserveAspectRatio="none"
      className="mt-2 h-7 w-full"
      aria-hidden="true"
    >
      <rect x="0" y="27" width="100" height="1" fill="var(--ui-fill)" />
      {max
        ? series.map((p, i) => {
            const h = p.value && p.value > 0 ? Math.max(2, (p.value / max) * 28) : 0;
            return (
              <rect
                key={p.at}
                x={i * w + w * 0.15}
                width={w * 0.7}
                y={28 - h}
                height={h}
                fill="var(--chart-1)"
              />
            );
          })
        : null}
    </svg>
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
      <div className={FRAME_HEAD}>
        <h2 className={SECTION_TITLE}>{top.label}</h2>
        <a href={top.href} className="text-[13px] text-(--ui-ink-2) hover:text-(--ui-ink)">
          All {meta.name.many}
          {page.data ? ` (${num(page.data.total)})` : ""}
        </a>
      </div>
      {page.error && !page.data ? (
        <Alert className="m-4" onRetry={page.retry}>
          {page.error.message}
        </Alert>
      ) : !page.data ? (
        <div className="m-4 h-32 animate-pulse bg-(--ui-fill)" aria-busy="true" />
      ) : !rows.length ? (
        <p className="px-4 py-3.5 text-[13px] text-(--ui-ink-2)">{top.empty}</p>
      ) : (
        <ul className="m-0 grid grid-cols-[minmax(0,1fr)] list-none p-0 text-[13px]">
          {rows.map((r) => (
            <li key={String(r.id)} className="border-t border-(--ui-hair) first:border-t-0">
              <a
                href={open(r)}
                // Counts that don't fit beside the title go under it, as on a phone.
                className={cn(
                  "flex flex-wrap items-center gap-x-4 gap-y-0.5 px-4 text-(--ui-ink) no-underline hover:bg-(--ui-wash)",
                  line ? "py-2.5" : "min-h-10 py-1.5",
                )}
              >
                <span className="grid min-w-0 flex-1 basis-40 gap-0.5">
                  <span className="truncate font-medium">
                    {cap(titleOf(meta, r) || textOf(r.id))}
                  </span>
                  {line && r[line.key] ? (
                    <span className="text-pretty text-(--ui-ink-2)">
                      <FieldCell field={line} cell={r[line.key]} />
                    </span>
                  ) : null}
                </span>
                {fields.map((f) => (
                  <span
                    key={f.key}
                    className="max-w-full shrink-0 truncate text-(--ui-ink-2)"
                    title={f.label}
                  >
                    {/* A bare amount says nothing: it reads "Per reply: CA$12", or "none". */}
                    {f.kind === "money" ? `${f.label}: ` : null}
                    {f.kind === "money" && blank(r[f.key]) ? (
                      "none"
                    ) : (
                      <FieldCell field={f} cell={r[f.key]} />
                    )}
                    {/* A bare count says nothing: "3" reads "3 members". */}
                    {f.kind === "number" ? ` ${f.label.toLowerCase()}` : null}
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

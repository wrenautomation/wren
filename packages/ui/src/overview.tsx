/**
 * The Overview template (console standard): an app's numbers first, each one a link to the rows
 * behind it, then its top records. A tile with a period counts or adds up a view's rows by date,
 * against the same stretch of the period before, with a bar per day (`recordsStats`). A tile
 * without one counts the rows there now: a state keeps no history, so it has no change to show.
 */
import type { RecordMeta } from "@wren/core/records";
import type { Period, RecordsStat, Row } from "@wren/core/records/serve";
import { cn } from "cn";
import { Alert } from "./feedback.js";
import { FieldCell } from "./fields.js";
import { num } from "./format.js";
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
  /** Rows waiting on someone: the number shows amber while above zero. */
  needs?: true;
}

export interface OverviewTop {
  label: string;
  record: string;
  /** The list, with the view it shows the first rows of. */
  href: string;
  /** The fields beside each title. */
  fields: string[];
  /** Said while it's empty. */
  empty: string;
}

export interface OverviewProps {
  title: string;
  api: RecordsApi;
  tiles: OverviewTile[];
  top?: OverviewTop[] | undefined;
}

const ZONE = Intl.DateTimeFormat().resolvedOptions().timeZone;
const TOP = 5;

const split = (href: string) => {
  const [path = "", query = ""] = href.split("?");
  return { path, params: new URLSearchParams(query) };
};
/** The list ask `href` makes, minus its sort and page. */
const askFor = (meta: RecordMeta, href: string) => {
  const { sort: _, cursor: __, ...ask } = askOf(meta, split(href).params);
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

export function RecordOverview({ title, api, tiles, top = [] }: OverviewProps) {
  const types = useTypes(api);
  if (types.error && !types.data) return <Alert onRetry={types.retry}>{types.error.message}</Alert>;
  const metaOf = (id: string) => types.data?.find((t) => t.id === id);
  return (
    <div className={cn(ROOT, "mx-auto grid w-full max-w-[1200px] gap-8")}>
      <h1 className="text-[20px] leading-7 font-semibold tracking-[-0.01em]">{title}</h1>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-px p-px">
        {tiles.map((t) => {
          const meta = metaOf(t.record);
          return meta ? (
            <Tile key={t.label} tile={t} meta={meta} api={api} />
          ) : (
            <TileGhost key={t.label} />
          );
        })}
      </div>
      {top.length ? (
        <div className="grid gap-8 lg:grid-cols-2">
          {top.map((t) => {
            const meta = metaOf(t.record);
            return meta ? <Top key={t.label} top={t} meta={meta} api={api} /> : null;
          })}
        </div>
      ) : null}
    </div>
  );
}

// Each tile draws its own hairline (an outline over the 1px gap), so cells past the last tile stay blank.
const TILE = "grid content-start gap-1 bg-(--ui-paper) p-4 outline outline-(--ui-hair)";

function TileGhost() {
  return (
    <div className={TILE} aria-busy="true">
      <div className="h-4 w-24 animate-pulse bg-(--ui-fill)" />
      <div className="h-9 w-16 animate-pulse bg-(--ui-fill)" />
    </div>
  );
}

function Tile({ tile, meta, api }: { tile: OverviewTile; meta: RecordMeta; api: RecordsApi }) {
  const ask = askFor(meta, tile.href);
  const { period } = tile;
  const load = useLoad(JSON.stringify([tile, ask]), async (): Promise<RecordsStat> => {
    if (period) {
      if (!api.stats) throw new Error("No numbers here.");
      return api.stats({
        ...ask,
        period,
        zone: ZONE,
        ...(tile.at ? { at: tile.at } : {}),
        ...(tile.sum ? { sum: tile.sum } : {}),
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
  });
  if (!load.data && !load.error) return <TileGhost />;
  const s = load.data;
  const fmt = (n: number) =>
    s?.currency
      ? n.toLocaleString("en-US", {
          style: "currency",
          currency: s.currency,
          maximumFractionDigits: 0,
        })
      : num(n);
  const delta = s ? s.value - s.prior : 0;
  return (
    <a
      href={tileHref(tile, meta)}
      className={cn(TILE, "text-(--ui-ink) no-underline hover:bg-(--ui-wash)")}
    >
      <span className="flex items-baseline justify-between gap-2 text-[13px] text-(--ui-ink-2)">
        <span className="font-medium text-(--ui-ink)">{tile.label}</span>
        <span>{period ? periodName(period) : "Now"}</span>
      </span>
      {s ? (
        <>
          <span
            className={cn(
              "text-[28px] leading-9 font-semibold tracking-[-0.02em]",
              tile.needs && s.value > 0 && "text-(--warn)",
            )}
          >
            {fmt(s.value)}
          </span>
          {period ? (
            <>
              <span className="text-[13px] text-(--ui-ink-2)">
                {delta === 0
                  ? `Same as ${priorName(period)}`
                  : `${delta > 0 ? "+" : "−"}${fmt(Math.abs(delta))} vs ${priorName(period)}`}
              </span>
              <Bars
                series={s.series}
                slots={period === "month" ? daysIn(new Date()) : s.series.length}
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

/** A bar a day, the tallest at full height; a quiet line under days with none. A month keeps a
 * slot for each of its days, so the bars fill in as it goes. */
function Bars({ series, slots }: { series: { at: string; value: number }[]; slots: number }) {
  const max = Math.max(0, ...series.map((p) => p.value));
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
            const h = p.value ? Math.max(2, (p.value / max) * 28) : 0;
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
  const page = useLoad(JSON.stringify([top.href, ask]), () =>
    api.list({ ...ask, ...(sort ? { sort } : {}), limit: TOP }),
  );
  const fields = top.fields.flatMap((k) => meta.fields.find((f) => f.key === k) ?? []);
  const rows: Row[] = page.data?.rows ?? [];
  const open = (r: Row) => {
    const { path, params } = split(top.href);
    params.set(meta.name.one, String(r.id));
    return `${path}?${params}`;
  };
  return (
    <section className="grid content-start gap-2">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-[14px] font-semibold">{top.label}</h2>
        <a href={top.href} className="text-[13px] text-(--ui-ink-2) hover:text-(--ui-ink)">
          All {meta.name.many}
          {page.data ? ` (${num(page.data.total)})` : ""}
        </a>
      </div>
      {page.error && !page.data ? (
        <Alert onRetry={page.retry}>{page.error.message}</Alert>
      ) : !page.data ? (
        <div className="h-40 animate-pulse bg-(--ui-fill)" aria-busy="true" />
      ) : !rows.length ? (
        <p className="border-t border-(--ui-hair) py-3 text-[13px] text-(--ui-ink-2)">
          {top.empty}
        </p>
      ) : (
        <ul className="m-0 grid list-none p-0 text-[13px]">
          {rows.map((r) => (
            <li key={String(r.id)} className="border-t border-(--ui-hair)">
              <a
                href={open(r)}
                className="flex h-10 items-center gap-4 px-1 text-(--ui-ink) no-underline hover:bg-(--ui-wash)"
              >
                <span className="min-w-0 flex-1 truncate font-medium">
                  {cap(titleOf(meta, r) || textOf(r.id))}
                </span>
                {fields.map((f) => (
                  <span
                    key={f.key}
                    className="max-w-[40%] shrink-0 truncate text-(--ui-ink-2)"
                    title={f.label}
                  >
                    <FieldCell field={f} cell={r[f.key]} />
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

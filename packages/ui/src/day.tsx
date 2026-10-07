/**
 * The Day template: one day of work across record types, grouped by one field under its cue
 * (Content's platforms). Today, back, next, pick a day, and a week strip with a dot on each day
 * that has work. Each row keeps its main action from the page's own actions, and Open.
 */

import type { RecordMeta, State } from "@wren/core/records";
import type { Row } from "@wren/core/records/serve";
import { cn } from "cn";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { type Action, applies, useRun } from "./action.js";
import { Button, ButtonLink } from "./controls.js";
import { Alert, Empty } from "./feedback.js";
import { Cue, dateOf } from "./fields.js";
import { num } from "./format.js";
import {
  actsOf,
  ListSkeleton,
  type Place,
  type RecordActs,
  type RecordsApi,
  ROOT,
  startOf,
  subtitleOf,
  textOf,
  titleOf,
  useLoad,
  useTypes,
} from "./records.js";
import { choicesOf, holds } from "./switch-bar.js";

/** One kind of work on the day: a record, the view it's read in, and its date field. */
export interface DaySource {
  record: string;
  /** Its heading in a group: "Scheduled", "Drafts waiting". */
  label: string;
  view?: string;
  /** The date field that puts a row on a day. */
  at: string;
  /** Rows dated before today (or with no date) still wait: they show on today, not their day. */
  carry?: true;
  /** Its main action's id, from the page's actions. */
  action?: string;
  /** The page a row opens on: "/marketing/drafts". */
  open: string;
}

export interface RecordDayProps {
  title: string;
  api: RecordsApi;
  place: Place;
  sources: readonly DaySource[];
  /** The field rows are grouped by, and the address's param that narrows to one: "platform". */
  by: string;
  acts?: RecordActs | undefined;
}

const pad = (n: number) => String(n).padStart(2, "0");
/** A local day as "2026-10-07". */
export const dayKey = (d: Date) =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const dayFrom = (s: string | null) => {
  const m = /^(\d{4})-(\d\d)-(\d\d)$/.exec(s ?? "");
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null;
};
const plus = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
/** The Monday the week of `d` starts on. */
const monday = (d: Date) => plus(d, -((d.getDay() + 6) % 7));

/** What a source read: its rows in the week, and (carried) the ones before today. */
export interface Read {
  week: Row[];
  before: Row[];
}

export interface DayItem {
  source: number;
  row: Row;
  /** Its date, or null when it has none. */
  at: Date | null;
  /** It sits here from an earlier day (or none): it still waits. */
  carried: boolean;
}

/** Each row's day: its own, or today when a carried source's row is from before today. */
export function placeRows(
  sources: readonly DaySource[],
  reads: readonly (Read | null)[],
  today: string,
): Map<string, DayItem[]> {
  const days = new Map<string, DayItem[]>();
  sources.forEach((s, i) => {
    const read = reads[i];
    if (!read) return;
    const seen = new Set<string>();
    for (const row of [...read.week, ...(s.carry ? read.before : [])]) {
      const id = String(row.id);
      if (seen.has(id)) continue;
      seen.add(id);
      const raw = textOf(row[s.at]);
      const at = raw ? dateOf(raw) : null;
      const own = at ? dayKey(at) : null;
      if (!own && !s.carry) continue;
      const carried = !!s.carry && (!own || own < today);
      const key = carried ? today : (own as string);
      days.set(key, [...(days.get(key) ?? []), { source: i, row, at, carried }]);
    }
  });
  return days;
}

/** A row's group: its `by` value, or the one platform its whole type is. */
const groupOf = (meta: RecordMeta | undefined, row: Row, by: string) =>
  textOf(row[by]) || (typeof meta?.channel === "string" ? meta.channel : "");

export function RecordDay(props: RecordDayProps) {
  const types = useTypes(props.api);
  if (types.error && !types.data) return <Alert onRetry={types.retry}>{types.error.message}</Alert>;
  if (!types.data) return <ListSkeleton />;
  return <Day {...props} types={types.data} />;
}

const TIME: Intl.DateTimeFormatOptions = { hour: "numeric", minute: "2-digit" };
const SHORT: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" };

function Day({
  title,
  api,
  place,
  sources,
  by,
  acts,
  types,
}: RecordDayProps & { types: RecordMeta[] }) {
  const { params } = place;
  const now = new Date();
  const today = dayKey(now);
  const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const day = dayFrom(params.get("day")) ?? midnight;
  const key = dayKey(day);
  const start = monday(day);
  const week = Array.from({ length: 7 }, (_, i) => plus(start, i));
  const pick = params.get(by);
  const metas = sources.map((s) => types.find((t) => t.id === s.record));
  const choices = choicesOf(
    types,
    sources.map((s) => s.record),
    by,
  );
  const picked = choices.find(([k]) => k === pick)?.[1];
  // Narrowed to one, a source whose rows can't be there isn't read.
  const asks = sources.map((s, i) => {
    const meta = metas[i];
    if (!meta || (picked && pick && !holds(meta, by, pick))) return null;
    const narrow = picked && meta.fields.some((f) => f.key === by) ? { [by]: [pick] } : {};
    const base = { record: s.record, limit: 200, ...(s.view ? { view: s.view } : {}) };
    const range = {
      gte: start.toISOString(),
      lte: new Date(plus(start, 7).getTime() - 1).toISOString(),
    };
    return {
      week: { ...base, where: { ...narrow, [s.at]: range } },
      before: s.carry
        ? {
            ...base,
            where: { ...narrow, [s.at]: { lte: new Date(midnight.getTime() - 1).toISOString() } },
          }
        : null,
      // A row with no date yet still waits.
      undated: s.carry ? { ...base, where: { ...narrow, [s.at]: { empty: true } } } : null,
    };
  });
  const load = useLoad(
    `day:${today}:${JSON.stringify(asks)}`,
    () =>
      Promise.all(
        asks.map(async (a) => {
          if (!a) return null;
          const [w, b, u] = await Promise.all([
            rowsOf(api, a.week),
            a.before ? rowsOf(api, a.before) : [],
            a.undated ? rowsOf(api, a.undated) : [],
          ]);
          return { week: w, before: [...b, ...u] } satisfies Read;
        }),
      ),
    api,
  );
  const { run, running, dialog } = useRun(
    acts?.call ?? (() => Promise.reject(new Error("Read only."))),
    () => load.retry(),
    { one: "item", many: "items" },
  );

  const days = placeRows(sources, load.data ?? [], today);
  const items = days.get(key) ?? [];
  const groups = new Map<string, DayItem[]>();
  for (const it of items) {
    const g = groupOf(metas[it.source], it.row, by);
    groups.set(g, [...(groups.get(g) ?? []), it]);
  }
  const order = choices.map(([k]) => k).filter((k) => !pick || !picked || k === pick);
  const busy = order.filter((k) => groups.has(k));
  const quiet = order.filter((k) => !groups.has(k));
  const label = (k: string): State =>
    choices.find(([c]) => c === k)?.[1] ?? { label: k, tone: "neutral" };
  const link = (d: string | null) => place.link({ day: d === today ? null : d });
  const named =
    key === today ? title : day.toLocaleDateString("en-US", { weekday: "short", ...SHORT });

  const act = (a: Action, row: Row) => run(a, [row.id], startOf(a, row));

  return (
    <div className={cn(ROOT, "grid min-w-0 grid-cols-1 gap-5")}>
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-[20px] leading-7 font-semibold tracking-[-0.01em]">{named}</h1>
        <div className="flex items-center gap-1">
          <ButtonLink
            href={link(dayKey(plus(day, -1)))}
            tone="quiet"
            size="dense"
            aria-label="Day before"
          >
            <ChevronLeft className="size-4" />
          </ButtonLink>
          <ButtonLink
            href={link(today)}
            tone="quiet"
            size="dense"
            aria-current={key === today ? "date" : undefined}
          >
            Today
          </ButtonLink>
          <ButtonLink
            href={link(dayKey(plus(day, 1)))}
            tone="quiet"
            size="dense"
            aria-label="Day after"
          >
            <ChevronRight className="size-4" />
          </ButtonLink>
          <input
            type="date"
            aria-label="Pick a day"
            value={key}
            onChange={(e) => {
              const d = dayFrom(e.target.value);
              if (d) place.go(link(dayKey(d)), true);
            }}
            className="h-8 rounded-(--ui-radius) border border-(--ui-hair) bg-(--ui-paper) px-2 text-[13px] text-(--ui-ink)"
          />
        </div>
      </header>

      <nav aria-label="Week" className="grid grid-cols-7 gap-1">
        {week.map((d) => {
          const k = dayKey(d);
          const has = (days.get(k)?.length ?? 0) > 0;
          return (
            <a
              key={k}
              href={link(k)}
              aria-current={k === key ? "date" : undefined}
              className={cn(
                "flex flex-col items-center gap-0.5 rounded-(--ui-radius) py-1.5 text-[12px] no-underline transition-[background-color] duration-150 ease-(--ui-ease)",
                k === key
                  ? "bg-(--ui-fill) text-(--ui-ink)"
                  : "text-(--ui-ink-2) hover:bg-(--ui-hover)",
              )}
            >
              <span>{d.toLocaleDateString("en-US", { weekday: "short" })}</span>
              <span
                className={cn(
                  "text-[15px] font-semibold tabular-nums",
                  k === today && "text-(--ui-accent)",
                )}
              >
                {d.getDate()}
              </span>
              {has ? <span className="sr-only">, has work</span> : null}
              <span
                aria-hidden
                className={cn("size-1.5 rounded-full", has ? "bg-(--ui-accent)" : "bg-transparent")}
              />
            </a>
          );
        })}
      </nav>

      {load.error && !load.data ? (
        <Alert onRetry={load.retry}>{load.error.message}</Alert>
      ) : !load.data ? (
        <ListSkeleton />
      ) : !busy.length ? (
        <Empty>
          Nothing {picked ? `on ${picked.label} ` : ""}
          {key === today ? "today" : "this day"}.
        </Empty>
      ) : (
        <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-2 2xl:grid-cols-3">
          {busy.map((g) => {
            const its = groups.get(g) ?? [];
            const s = label(g);
            return (
              <section
                key={g}
                aria-label={s.label}
                className="min-w-0 rounded-(--ui-radius) border border-(--ui-hair) bg-(--ui-paper)"
              >
                <h2 className="flex items-center gap-2 border-b border-(--ui-hair) px-4 py-3 text-[15px] font-semibold">
                  <Cue state={s} size={18} />
                  {s.label}
                  <span className="ml-auto text-[12px] font-normal text-(--ui-ink-3) tabular-nums">
                    {num(its.length)}
                  </span>
                </h2>
                {sources.map((src, i) => {
                  const mine = its.filter((it) => it.source === i);
                  const meta = metas[i];
                  if (!mine.length || !meta) return null;
                  const main = actsOf(meta, acts).find((a) => a.id === src.action);
                  return (
                    <div
                      key={src.record + src.label}
                      className="px-4 py-3 [&+&]:border-t [&+&]:border-(--ui-hair)"
                    >
                      <h3 className="mb-1 text-[12px] font-semibold text-(--ui-ink-3)">
                        {src.label}
                      </h3>
                      <ul className="grid grid-cols-1">
                        {mine.map((it) => {
                          const href = `${src.open}/${encodeURIComponent(String(it.row.id))}`;
                          const sub = meta.subtitle === by ? "" : subtitleOf(meta, it.row);
                          const can = main && applies(main, it.row) ? main : null;
                          const when = it.carried
                            ? it.at
                              ? `Since ${it.at.toLocaleDateString("en-US", SHORT)}`
                              : "No date"
                            : (it.at?.toLocaleTimeString("en-US", TIME) ?? "");
                          return (
                            <li key={String(it.row.id)} className="flex items-center gap-3 py-1.5">
                              <span className="w-16 shrink-0 text-[12px] text-(--ui-ink-3) tabular-nums max-sm:hidden">
                                {when}
                              </span>
                              <a
                                href={href}
                                className="min-w-0 flex-1 text-inherit no-underline hover:underline"
                              >
                                {/* A phone has no room for the time's own column. */}
                                <span className="block text-[12px] text-(--ui-ink-3) sm:hidden">
                                  {when}
                                </span>
                                <span className="block truncate">{titleOf(meta, it.row)}</span>
                                {sub ? (
                                  <span className="block truncate text-[13px] text-(--ui-ink-2)">
                                    {sub}
                                  </span>
                                ) : null}
                              </a>
                              <span className="flex shrink-0 items-center gap-1">
                                {can ? (
                                  <Button
                                    size="dense"
                                    tone="secondary"
                                    busy={
                                      running?.action === can.id && running.ids.includes(it.row.id)
                                    }
                                    onClick={() => act(can, it.row)}
                                  >
                                    {can.label}
                                  </Button>
                                ) : null}
                                <ButtonLink href={href} size="dense" tone="quiet">
                                  Open
                                </ButtonLink>
                              </span>
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  );
                })}
              </section>
            );
          })}
        </div>
      )}
      {load.data && quiet.length && busy.length ? (
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-(--ui-ink-2)">
          <span>Nothing {key === today ? "today" : "this day"} on</span>
          {quiet.map((k) => (
            <span key={k} className="inline-flex items-center gap-1.5">
              <Cue state={label(k)} />
              {label(k).label}
            </span>
          ))}
        </p>
      ) : null}
      {dialog}
    </div>
  );
}

/** A list ask's rows, up to its limit: one page is enough for a day. */
const rowsOf = (api: RecordsApi, ask: Parameters<RecordsApi["list"]>[0]) =>
  api.list(ask).then((p) => p.rows);

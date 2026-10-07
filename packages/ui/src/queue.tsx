/**
 * The Queue template, for anything waiting on a person: items on the left, the open one on the
 * right with its context and an action bar on keys. "3 of 6"; the next item opens after each
 * action. J and K move.
 */

import type { RecordMeta } from "@wren/core/records";
import { cn } from "cn";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { type Action, applies, useRun } from "./action.js";
import { Button } from "./controls.js";
import { Alert } from "./feedback.js";
import { relative } from "./fields.js";
import { num } from "./format.js";
import { ListBar, useLastUsed, useSaved, ViewTabs } from "./list-bar.js";
import {
  actsOf,
  askOf,
  Bulk,
  cap,
  emptyOf,
  facetsOf,
  Kbd,
  KeyHints,
  keyed,
  ListSkeleton,
  RecordBody,
  type RecordTemplateProps,
  ROOT,
  startOf,
  subtitleOf,
  titleOf,
  typing,
  useLoad,
  useTypes,
} from "./records.js";

const NAV =
  "inline-flex size-8 items-center justify-center text-(--ui-ink-2) hover:bg-(--ui-hover) hover:text-(--ui-ink) disabled:opacity-30 transition-[background-color,color,scale] duration-150 ease-(--ui-ease) active:scale-[0.94]";

export function RecordQueue(props: RecordTemplateProps) {
  const types = useTypes(props.api);
  const meta = types.data?.find((t) => t.id === props.record);
  if (types.error && !types.data) return <Alert onRetry={types.retry}>{types.error.message}</Alert>;
  if (!meta || !types.data) return <ListSkeleton />;
  return <Queue {...props} meta={meta} types={types.data} />;
}

function Queue({
  meta,
  types,
  api,
  place,
  empty,
  example,
  extras,
  acts,
  title,
}: RecordTemplateProps & { meta: RecordMeta; types: RecordMeta[] }) {
  const { params } = place;
  const one = meta.name.one;
  const ask = askOf(meta, params);
  const page = useLoad(JSON.stringify(ask), () => api.list(ask), api);
  const rows = page.data?.rows ?? [];
  const asked = params.get(one);
  const at = Math.max(
    0,
    rows.findIndex((r) => String(r.id) === asked),
  );
  const row = rows[at];
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [rev, setRev] = useState(0);
  const actions = actsOf(meta, acts);
  const dated = meta.fields.find((f) => f.kind === "date");
  const list = useRef<HTMLUListElement>(null);
  const saved = useSaved(api.keep, meta.id);
  useLastUsed(api.keep, meta, place, saved);

  const open = (i: number) => {
    const r = rows[i];
    if (r) place.go(place.link({ [one]: String(r.id), tab: null }), true);
  };
  /** After an action on the open item, the next one opens. */
  const next = useRef<string | null>(null);
  const acted = () => {
    if (next.current !== null) place.go(place.link({ [one]: next.current, tab: null }), true);
    next.current = null;
    page.retry();
    setRev((n) => n + 1);
    setPicked(new Set());
  };
  const { run, busy, running, dialog } = useRun(
    acts?.call ?? (() => Promise.reject()),
    acted,
    meta.name,
  );
  const act = (a: Action) => {
    if (!row) return;
    const after = rows[at + 1] ?? rows[at - 1];
    next.current = after ? String(after.id) : null;
    run(a, [row.id], startOf(a, row));
  };

  const keys = useRef({ at, open, act, actions, row, n: rows.length });
  keys.current = { at, open, act, actions, row, n: rows.length };
  useEffect(() => {
    const press = (e: KeyboardEvent) => {
      if (typing(e)) return;
      const k = keys.current;
      if (e.key === "j" || e.key === "k") {
        const to = Math.max(0, Math.min(k.n - 1, k.at + (e.key === "j" ? 1 : -1)));
        k.open(to);
        list.current?.children[to]?.scrollIntoView({ block: "nearest" });
        return;
      }
      const a = keyed(e, k.actions, k.row);
      if (a) {
        e.preventDefault();
        k.act(a);
      }
    };
    addEventListener("keydown", press);
    return () => removeEventListener("keydown", press);
  }, []);

  const pick = (id: string) =>
    setPicked((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const here = row ? actions.filter((a) => applies(a, row)) : [];
  const inItem = asked !== null;

  return (
    <div className={cn(ROOT, "grid min-w-0 gap-4")}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-[20px] leading-7 font-semibold tracking-[-0.01em]">
          {title ?? cap(meta.name.many)}
        </h1>
        {actions.map((a) =>
          a.form && !a.each ? (
            <Button key={a.id} tone="secondary" size="dense" onClick={() => run(a, [])}>
              {a.label}
            </Button>
          ) : null,
        )}
      </div>
      <div className="grid gap-3">
        <ViewTabs
          meta={meta}
          current={ask.view}
          counts={page.data?.counts}
          place={place}
          saved={saved}
          keep={api.keep}
        />
        <ListBar
          meta={meta}
          place={place}
          shown={new Set(meta.fields.filter((f) => f.column).map((f) => f.key))}
          keep={api.keep}
          saved={saved}
          facets={facetsOf(api, ask)}
        />
      </div>

      {page.error && !page.data ? (
        <Alert onRetry={page.retry}>{page.error.message}</Alert>
      ) : !page.data ? (
        <ListSkeleton />
      ) : !rows.length ? (
        ((ask.q || ask.where ? null : example) ?? (
          <p className="py-10 text-center text-[13px] text-(--ui-ink-2)">
            {ask.q || ask.where
              ? `No ${meta.name.many} match these filters.`
              : emptyOf(empty, ask.view, meta.name.many)}
          </p>
        ))
      ) : (
        <div className="grid min-w-0 gap-6 md:grid-cols-[minmax(240px,320px)_minmax(0,1fr)]">
          <div className={cn("grid content-start gap-2", inItem && "max-md:hidden")}>
            <div className="flex h-8 items-center text-[13px] text-(--ui-ink-2)">
              {picked.size ? (
                <Bulk
                  actions={actions}
                  rows={rows}
                  picked={picked}
                  run={(a, ids) => {
                    next.current = null;
                    run(a, ids);
                  }}
                  busy={busy}
                  running={running}
                  clear={() => setPicked(new Set())}
                />
              ) : (
                `${num(page.data.total)} ${page.data.total === 1 ? one : meta.name.many}`
              )}
            </div>
            <ul
              ref={list}
              className={cn(
                "max-h-[calc(100dvh-260px)] overflow-auto border-t border-(--ui-hair) transition-opacity",
                page.loading && "opacity-60",
              )}
            >
              {rows.map((r, i) => {
                const id = String(r.id);
                const on = i === at;
                return (
                  <li
                    key={id}
                    className={cn(
                      "flex items-start gap-2.5 border-b border-(--ui-hair) px-2.5 py-2.5",
                      on ? "bg-(--ui-fill)" : "hover:bg-(--ui-hover)",
                    )}
                  >
                    <input
                      type="checkbox"
                      aria-label={`Select ${titleOf(meta, r)}`}
                      checked={picked.has(id)}
                      onChange={() => pick(id)}
                      className="mt-1 size-3.5 accent-(--ui-ink)"
                    />
                    <a
                      href={place.link({ [one]: id, tab: null })}
                      aria-current={on ? "true" : undefined}
                      className="grid min-w-0 flex-1 grid-cols-[minmax(0,1fr)] gap-0.5 text-[13px] text-(--ui-ink) no-underline"
                    >
                      <span className="flex items-baseline justify-between gap-2">
                        <span className="truncate text-[14px] font-medium">{titleOf(meta, r)}</span>
                        {dated && r[dated.key] ? (
                          <span className="shrink-0 text-[12px] text-(--ui-ink-2)">
                            {relative(new Date(String(r[dated.key])))}
                          </span>
                        ) : null}
                      </span>
                      {meta.subtitle && r[meta.subtitle] ? (
                        <span className="truncate text-(--ui-ink-2)">{subtitleOf(meta, r)}</span>
                      ) : null}
                    </a>
                  </li>
                );
              })}
            </ul>
            <p className="text-[12px] text-(--ui-ink-2) max-sm:hidden">
              <Kbd>J</Kbd> <Kbd>K</Kbd> to move
              <KeyHints actions={actions} row={row} />
            </p>
          </div>

          <section className={cn("grid min-w-0 content-start gap-4", !inItem && "max-md:hidden")}>
            <div className="flex flex-wrap items-center gap-2 border-b border-(--ui-hair) pb-3">
              <a
                href={place.link({ [one]: null, tab: null })}
                className="mr-1 text-[13px] text-(--ui-ink-2) no-underline md:hidden"
              >
                All {meta.name.many}
              </a>
              <span className="text-[13px] text-(--ui-ink-2)">
                {num(at + 1)} of {num(rows.length)}
              </span>
              <button
                type="button"
                className={NAV}
                aria-label={`Previous ${one}`}
                disabled={at === 0}
                onClick={() => open(at - 1)}
              >
                <ChevronLeft className="size-4" />
              </button>
              <button
                type="button"
                className={NAV}
                aria-label={`Next ${one}`}
                disabled={at >= rows.length - 1}
                onClick={() => open(at + 1)}
              >
                <ChevronRight className="size-4" />
              </button>
              <span className="ml-auto flex flex-wrap items-center gap-2">
                {here.map((a, i) => (
                  <Button
                    key={a.id}
                    tone={i === 0 ? "primary" : "secondary"}
                    size={i === 0 ? "next" : "dense"}
                    busy={running?.action === a.id}
                    disabled={busy}
                    onClick={() => act(a)}
                  >
                    {a.label}
                    {a.key ? (
                      <span className="ml-1.5 opacity-60 max-sm:hidden">{a.key.toUpperCase()}</span>
                    ) : null}
                  </Button>
                ))}
              </span>
            </div>
            {row ? (
              <RecordBody
                key={String(row.id)}
                meta={meta}
                types={types}
                id={String(row.id)}
                api={api}
                place={place}
                extras={extras}
                rev={rev}
              />
            ) : null}
          </section>
        </div>
      )}
      {dialog}
    </div>
  );
}

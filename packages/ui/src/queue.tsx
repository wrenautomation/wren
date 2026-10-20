/**
 * The Queue template, for anything waiting on a person: items on the left, the open one on the
 * right with its context and an action bar on keys. "3 of 6"; the next item opens after each
 * action. ↑ and ↓ (or J and K) move.
 */

import type { RecordMeta } from "@wren/core/records";
import type { RecordsPage } from "@wren/core/records/serve";
import { cn } from "cn";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
  type Action,
  applies,
  blockedOf,
  runningOn,
  sayBlocked,
  useHeld,
  useRun,
} from "./action.js";
import { Button } from "./controls.js";
import { listChanged } from "./data/delta.js";
import { LoadFailed } from "./feedback.js";
import { Cue, dateTip, relative } from "./fields.js";
import { num } from "./format.js";
import { usePageKeys } from "./frame.js";
import { clipProps, tipProps } from "./hint.js";
import { Why } from "./hint-layer.js";
import { PageTitle } from "./layout.js";
import { ListBar, useLastUsed, useSavedViews, ViewTabs } from "./list-bar.js";
import {
  actionKeys,
  actsOf,
  askOf,
  Bulk,
  cap,
  emptyOf,
  facetsOf,
  keyed,
  ListSkeleton,
  NotHere,
  RecordBody,
  type RecordTemplateProps,
  ROOT,
  shownVersion,
  startOf,
  subtitleCue,
  subtitleOf,
  titleOf,
  typing,
  useLoad,
  useTypes,
  versionIn,
  walkKey,
} from "./records.js";

const NAV =
  "inline-flex size-8 items-center justify-center text-(--ui-ink-2) hover:bg-(--ui-hover) hover:text-(--ui-ink) disabled:opacity-30 transition-[background-color,color,scale] duration-150 ease-(--ui-ease) active:scale-[0.94]";

export function RecordQueue(props: RecordTemplateProps) {
  const types = useTypes(props.api);
  const meta = types.data?.find((t) => t.id === props.record);
  if (types.error && !types.data) return <LoadFailed error={types.error} onRetry={types.retry} />;
  if (!types.data) return <ListSkeleton />;
  if (!meta) return <NotHere />;
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
  const page = useLoad<RecordsPage>(
    JSON.stringify(ask),
    (before) => listChanged((a) => api.list(a), ask, before),
    api,
  );
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [rev, setRev] = useState(0);
  const actions = actsOf(meta, acts);
  const dated = meta.fields.find((f) => f.kind === "date");
  const list = useRef<HTMLUListElement>(null);
  const saved = useSavedViews(api.keep, meta.id);
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
    {
      // The open item's version, as its body draws it: a yes over newer words is refused.
      versionOf: (id) =>
        shownVersion(meta.id, id) ??
        versionIn(
          null,
          page.data?.rows.find((r) => String(r.id) === String(id)),
        ),
    },
  );
  // An optimistic or set-aside action's items leave at once; a refusal brings them back.
  const held = useHeld(meta.name.many);
  const rows = (page.data?.rows ?? []).filter((r) => !held.ids.has(String(r.id)));
  const asked = params.get(one);
  const at = Math.max(
    0,
    rows.findIndex((r) => String(r.id) === asked),
  );
  const row = rows[at];
  const act = (a: Action) => {
    if (!row || sayBlocked(a, row)) return;
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
      const step = walkKey(e);
      if (step) {
        e.preventDefault();
        const to = Math.max(0, Math.min(k.n - 1, k.at + step));
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
  // Its keys sit in the sheet on ?, not under the list.
  const keyLines = actionKeys(actions, row ? [row] : rows);
  usePageKeys(keyLines.length ? { title: `On ${meta.name.many}`, keys: keyLines } : null);

  return (
    <div className={cn(ROOT, "grid min-w-0 gap-4")}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <PageTitle title={title ?? cap(meta.name.many)} />
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
        <LoadFailed error={page.error} onRetry={page.retry} />
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
                page.placeholder && "opacity-60",
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
                        <span className="truncate text-[14px] font-medium" {...clipProps()}>
                          {titleOf(meta, r)}
                        </span>
                        {dated && r[dated.key] ? (
                          <span
                            className="shrink-0 text-[12px] text-(--ui-ink-2)"
                            {...dateTip(new Date(String(r[dated.key])))}
                          >
                            {relative(new Date(String(r[dated.key])))}
                          </span>
                        ) : null}
                      </span>
                      {meta.subtitle && r[meta.subtitle] ? (
                        <span className="flex min-w-0 items-center gap-1.5 text-(--ui-ink-2)">
                          {(() => {
                            const cue = subtitleCue(meta, r);
                            return cue ? <Cue state={cue} /> : null;
                          })()}
                          <span className="truncate" {...clipProps()}>
                            {subtitleOf(meta, r)}
                          </span>
                        </span>
                      ) : null}
                    </a>
                  </li>
                );
              })}
            </ul>
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
                {...tipProps(`Previous ${one}`, { as: "none" })}
                disabled={at === 0}
                onClick={() => open(at - 1)}
              >
                <ChevronLeft className="size-4" />
              </button>
              <button
                type="button"
                className={NAV}
                aria-label={`Next ${one}`}
                {...tipProps(`Next ${one}`, { as: "none" })}
                disabled={at >= rows.length - 1}
                onClick={() => open(at + 1)}
              >
                <ChevronRight className="size-4" />
              </button>
              <span className="ml-auto flex flex-wrap items-center gap-2">
                {here.map((a, i) => (
                  <Why key={a.id} text={row ? blockedOf(a, row) : null}>
                    <Button
                      tone={i === 0 ? "primary" : "secondary"}
                      size={i === 0 ? "next" : "dense"}
                      busy={!!row && runningOn(running, a.id, [row.id])}
                      disabled={busy || !!(row && blockedOf(a, row))}
                      onClick={() => act(a)}
                    >
                      {a.label}
                      {a.key ? (
                        <span className="ml-1.5 opacity-60 max-sm:hidden">
                          {a.key.toUpperCase()}
                        </span>
                      ) : null}
                    </Button>
                  </Why>
                ))}
              </span>
            </div>
            {row
              ? here.map((a) => {
                  const why = blockedOf(a, row);
                  return why ? (
                    <p key={a.id} className="m-0 text-[13px] text-(--ui-ink-2)">
                      {why}
                    </p>
                  ) : null;
                })
              : null}
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

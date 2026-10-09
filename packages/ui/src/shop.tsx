/**
 * The Shop template, for browsing a catalog: facets down the side with how many each would show,
 * search on top, a card per record. A facet is every field with states (a status or tags);
 * picking several states of one ORs them, and facets AND together. A card opens beside the
 * grid, like the List's. The address holds every pick, so a filtered shop is a link.
 */
import type { FieldMeta, RecordMeta } from "@wren/core/records";
import type { Row } from "@wren/core/records/serve";
import { cn } from "cn";
import { useState } from "react";
import { Button } from "./controls.js";
import { LoadFailed } from "./feedback.js";
import { Cue, cueOf, FieldCell, filterShape } from "./fields.js";
import { num } from "./format.js";
import { Icon, type IconName } from "./icons.js";
import { PAGE_TITLE } from "./layout.js";
import {
  askOf,
  cap,
  emptyOf,
  ListSkeleton,
  NotHere,
  Panel,
  type RecordTemplateProps,
  ROOT,
  SearchBox,
  type ShopSections,
  textOf,
  titleOf,
  useLoad,
  useTypes,
  ViewTabs,
} from "./records.js";

export function RecordShop(props: RecordTemplateProps) {
  const types = useTypes(props.api);
  const meta = types.data?.find((t) => t.id === props.record);
  if (types.error && !types.data) return <LoadFailed error={types.error} onRetry={types.retry} />;
  if (!types.data) return <ListSkeleton />;
  if (!meta) return <NotHere />;
  return <Shop {...props} meta={meta} types={types.data} />;
}

function Shop({
  meta,
  types,
  api,
  place,
  empty,
  columns,
  extras,
  acts,
  title,
  sections,
}: RecordTemplateProps & { meta: RecordMeta; types: RecordMeta[] }) {
  const { params } = place;
  // ponytail: one page of 200; a cursor when a catalog outgrows it.
  const ask = { ...askOf(meta, params), facets: true, limit: 200 };
  const page = useLoad(JSON.stringify(ask), () => api.list(ask), api);
  const [rev, setRev] = useState(0);
  const [sideOpen, setSideOpen] = useState(false);
  const rows = page.data?.rows ?? [];
  const facets = meta.fields.filter((f) => filterShape(f) === "states");
  const chips = (columns ?? []).flatMap((k) => meta.fields.filter((f) => f.key === k));
  const narrowed = !!ask.q || !!ask.where;
  const many = meta.name.many;
  const one = meta.name.one;
  const openId = params.get(one);
  const openIndex = openId === null ? -1 : rows.findIndex((r) => String(r.id) === openId);
  const clear = place.link({ q: null, ...Object.fromEntries(facets.map((f) => [f.key, null])) });

  return (
    <div className={cn(ROOT, "grid min-w-0 gap-4")}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className={PAGE_TITLE}>{title ?? cap(many)}</h1>
        <span className="text-[13px] text-(--ui-ink-2)">
          {page.data ? `${num(page.data.total)} ${page.data.total === 1 ? one : many}` : ""}
        </span>
      </div>
      <ViewTabs meta={meta} current={ask.view} counts={page.data?.counts} place={place} />
      <div className="flex flex-wrap items-center gap-2">
        <SearchBox place={place} label={many} />
        <Button
          tone="secondary"
          size="dense"
          className="md:hidden"
          aria-expanded={sideOpen}
          onClick={() => setSideOpen((o) => !o)}
        >
          Filters
        </Button>
        {narrowed ? (
          <a
            href={clear}
            className="px-1 text-[13px] text-(--ui-ink-2) no-underline hover:text-(--ui-ink)"
          >
            Clear
          </a>
        ) : null}
      </div>

      <div className="grid items-start gap-6 md:grid-cols-[200px_minmax(0,1fr)]">
        <aside
          aria-label="Filters"
          className={cn("grid gap-5 max-md:pb-2", !sideOpen && "max-md:hidden")}
        >
          {facets.map((f) => (
            <Facet
              key={f.key}
              field={f}
              counts={page.data?.facets?.[f.key]}
              picked={params.get(f.key)}
              to={(v) => place.link({ [f.key]: v })}
              go={(to) => place.go(to)}
            />
          ))}
        </aside>

        {page.error && !page.data ? (
          <LoadFailed error={page.error} onRetry={page.retry} />
        ) : !page.data ? (
          <ul className={GRID} aria-busy="true">
            {Array.from({ length: 9 }, (_, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: placeholders have no identity.
              <li key={i} className="h-36 animate-pulse bg-(--ui-fill)" />
            ))}
          </ul>
        ) : rows.length ? (
          <div className={cn("grid gap-8 transition-opacity", page.loading && "opacity-60")}>
            {groupsOf(rows, sections).map((g) => (
              <section key={g.id} aria-label={g.name ?? undefined} className="grid gap-3">
                {g.name ? (
                  <header className="grid gap-0.5">
                    <h2 className="flex items-baseline gap-2 text-[15px] leading-6 font-semibold">
                      {(() => {
                        const cue = cueOf(
                          meta.fields.find((f) => f.key === sections?.field),
                          g.id,
                        );
                        return cue ? (
                          <span className="self-center">
                            <Cue state={cue} size={15} />
                          </span>
                        ) : null;
                      })()}
                      {g.name}
                      <span className="text-[13px] font-normal text-(--ui-ink-3) tabular-nums">
                        {num(g.rows.length)}
                      </span>
                    </h2>
                    {g.blurb ? (
                      <p className="text-[13px] text-pretty text-(--ui-ink-2)">{g.blurb}</p>
                    ) : null}
                  </header>
                ) : null}
                <ul className={GRID}>
                  {g.rows.map((r) => (
                    <Card
                      key={String(r.id)}
                      meta={meta}
                      row={r}
                      chips={chips.filter((f) => f.key !== sections?.field)}
                      open={String(r.id) === openId}
                      href={place.link({ [one]: String(r.id), tab: null })}
                    />
                  ))}
                </ul>
              </section>
            ))}
          </div>
        ) : (
          <div className="grid justify-items-start gap-2 py-10 text-[14px] text-(--ui-ink-2)">
            {narrowed ? `No ${many} match these filters.` : emptyOf(empty, ask.view, many)}
            {narrowed ? (
              <a
                href={clear}
                className="text-[13px] text-(--ui-ink) underline decoration-(--ui-hair) underline-offset-2"
              >
                Clear filters
              </a>
            ) : null}
          </div>
        )}
      </div>

      {openId ? (
        <Panel
          key={openId}
          meta={meta}
          types={types}
          id={openId}
          api={api}
          place={place}
          extras={extras}
          acts={acts}
          index={openIndex}
          count={rows.length}
          step={(d) => {
            const r = rows[openIndex + d];
            if (r) place.go(place.link({ [one]: String(r.id), tab: null }), true);
          }}
          rev={rev}
          onActed={() => {
            page.retry();
            setRev((n) => n + 1);
          }}
        />
      ) : null}
    </div>
  );
}

/**
 * The rows in their groups: each value of the field in order, then any other value after, each
 * with rows. No groups asked: one group with no heading.
 */
function groupsOf(rows: Row[], sections: ShopSections | undefined) {
  if (!sections) return [{ id: "all", name: null, blurb: null, rows }];
  const keyOf = (r: Row) => textOf(r[sections.field]);
  const ids = [...new Set([...sections.order, ...rows.map(keyOf)])];
  return ids.flatMap((id) => {
    const these = rows.filter((r) => keyOf(r) === id);
    return these.length
      ? [
          {
            id,
            name: sections.names[id] ?? cap(id),
            blurb: sections.blurbs?.[id] ?? null,
            rows: these,
          },
        ]
      : [];
  });
}

const GRID = "grid list-none grid-cols-[repeat(auto-fill,minmax(min(100%,260px),1fr))] gap-3";

/**
 * One field's states as checkboxes, each with how many rows it would show under every other
 * pick. A state nothing has is left out unless it's picked.
 */
function Facet({
  field: f,
  counts,
  picked,
  to,
  go,
}: {
  field: FieldMeta;
  counts: Record<string, number> | undefined;
  picked: string | null;
  to: (value: string | null) => string;
  go: (to: string) => void;
}) {
  const on = new Set(picked?.split(",").filter(Boolean));
  const states = Object.entries(f.states ?? {}).filter(
    ([id]) => on.has(id) || !counts || (counts[id] ?? 0) > 0,
  );
  if (!states.length) return null;
  const flip = (id: string) => {
    const next = new Set(on);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return to(next.size ? [...next].join(",") : null);
  };
  return (
    <fieldset className="m-0 grid min-w-0 gap-1 border-0 p-0">
      <legend className="mb-1.5 p-0 text-[12px] font-semibold tracking-(--ui-label-tracking) text-(--ui-ink-2) [text-transform:var(--ui-label-case)]">
        {f.label}
      </legend>
      {states.map(([id, st]) => (
        <label
          key={id}
          className="flex cursor-pointer items-center gap-2 py-0.5 text-[13.5px] text-(--ui-ink)"
        >
          <input
            type="checkbox"
            checked={on.has(id)}
            onChange={() => go(flip(id))}
            className="size-3.5 shrink-0 accent-(--ui-ink)"
          />
          <span className="min-w-0 flex-1 truncate">{st.label}</span>
          <span className="text-[12px] text-(--ui-ink-3) tabular-nums">
            {counts ? num(counts[id] ?? 0) : ""}
          </span>
        </label>
      ))}
    </fieldset>
  );
}

/** One record as a card: its icon (an `icon` field), title, subtitle, and the page's chips. */
function Card({
  meta,
  row,
  chips,
  open,
  href,
}: {
  meta: RecordMeta;
  row: Row;
  chips: FieldMeta[];
  open: boolean;
  href: string;
}) {
  const icon = textOf(row.icon);
  // A text column reads as one quiet line under the name ("In place of Calendly"); the rest
  // are chips at the foot.
  const lines = chips.filter((f) => f.kind === "text" && textOf(row[f.key]));
  const tags = chips.filter((f) => !lines.includes(f));
  return (
    <li>
      <a
        href={href}
        aria-current={open ? "true" : undefined}
        className={cn(
          "flex h-full flex-col gap-2 rounded-(--ui-radius) p-4 no-underline shadow-[inset_0_0_0_1px_var(--ui-hair)] transition-colors duration-200 ease-(--ui-ease)",
          open ? "bg-(--ui-fill)" : "bg-(--ui-paper) hover:bg-(--ui-wash)",
        )}
      >
        <span className="flex items-center gap-3">
          {icon ? (
            <span
              aria-hidden
              className="grid size-8 flex-none place-items-center rounded-(--ui-radius) bg-(--ui-accent-wash) text-(--ui-accent)"
            >
              <Icon name={icon as IconName} size={16} />
            </span>
          ) : null}
          <span className="min-w-0 text-[15px] leading-5 font-semibold text-(--ui-ink)">
            {titleOf(meta, row)}
          </span>
        </span>
        {lines.map((f) => (
          <span key={f.key} className="-mt-1 text-[12px] text-(--ui-ink-3)">
            {f.label} {textOf(row[f.key])}
          </span>
        ))}
        {meta.subtitle ? (
          <span className="line-clamp-3 text-[13px]/[1.45] text-pretty text-(--ui-ink-2)">
            {textOf(row[meta.subtitle])}
          </span>
        ) : null}
        {tags.length ? (
          <span className="mt-auto flex flex-wrap gap-x-3 gap-y-1 pt-1 text-[12px] text-(--ui-ink-2)">
            {tags.map((f) =>
              row[f.key] === null || row[f.key] === undefined ? null : (
                <FieldCell key={f.key} field={f} cell={row[f.key]} />
              ),
            )}
          </span>
        ) : null}
      </a>
    </li>
  );
}

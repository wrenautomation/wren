/**
 * A filter across the top of every page that carries it, one field's states as marks with what
 * waits in each: Content's platforms (designs/2026-10-07-visual-cues.md). It is the list's own
 * filter in the address, so moving between pages keeps it.
 */

import { cued, markOf, type RecordMeta, type State } from "@wren/core/records";
import { cn } from "cn";
import type { ReactNode } from "react";
import { Empty } from "./feedback.js";
import { Cue } from "./fields.js";
import { num } from "./format.js";
import { markName } from "./marks.js";
import { type Place, type RecordsApi, useLoad, useTypes } from "./records.js";

/** What counts as waiting in one record: its view, counted by the switch's field. */
export interface SwitchWait {
  record: string;
  view: string;
}

/** Each state of `field` across these types, in the order they first come. */
export function choicesOf(
  types: readonly RecordMeta[],
  records: readonly string[],
  field: string,
): Array<[string, State]> {
  const seen = new Map<string, State>();
  for (const id of records) {
    const meta = types.find((t) => t.id === id);
    const f = meta?.fields.find((x) => x.key === field);
    for (const [k, s] of Object.entries(f?.states ?? {})) if (!seen.has(k)) seen.set(k, s);
    // A type that is one platform throughout (Videos) adds that one.
    if (meta && typeof meta.channel === "string" && !seen.has(meta.channel))
      seen.set(
        meta.channel,
        cued({ [meta.channel]: { label: nameOf(meta.channel), tone: "neutral" } })[
          meta.channel
        ] as State,
      );
  }
  return [...seen];
}

const nameOf = (key: string) => {
  const m = markOf(key);
  return m ? markName(m) : key;
};

/** Whether a record's rows can be on `pick`: its field has the state, or the type is all of it. */
export function holds(meta: RecordMeta | undefined, field: string, pick: string): boolean {
  if (!meta) return false;
  if (typeof meta.channel === "string") return meta.channel === pick;
  return !!meta.fields.find((f) => f.key === field)?.states?.[pick];
}

export function RecordSwitch({
  api,
  place,
  field,
  waits,
  record,
  label,
  children,
}: {
  api: RecordsApi;
  place: Place;
  /** The field and the address's param: "platform". */
  field: string;
  waits: readonly SwitchWait[];
  /** This page's record type, when it's a list: a pick its rows can't be on says so. */
  record?: string | undefined;
  /** What the switch is called for a screen reader: "Platform". */
  label: string;
  children: ReactNode;
}) {
  const types = useTypes(api);
  const pick = place.params.get(field);
  const counts = useLoad(
    `switch:${field}:${waits.map((w) => `${w.record}/${w.view}`).join(",")}`,
    () =>
      Promise.all(
        waits.map((w) =>
          api.list({ record: w.record, view: w.view, facets: true, limit: 1 }).then(
            (p) => ({ record: w.record, total: p.total, by: p.facets?.[field] }),
            () => null,
          ),
        ),
      ),
    api,
  );
  if (!types.data) return <>{children}</>;
  const choices = choicesOf(types.data, [...waits.map((w) => w.record), record ?? ""], field);
  const n: Record<string, number> = {};
  for (const p of counts.data ?? []) {
    if (!p) continue;
    const one = types.data.find((t) => t.id === p.record)?.channel;
    const by = p.by ?? (typeof one === "string" ? { [one]: p.total } : {});
    for (const [k, c] of Object.entries(by)) n[k] = (n[k] ?? 0) + c;
  }
  const all = Object.values(n).reduce((a, b) => a + b, 0);
  const meta = record ? types.data.find((t) => t.id === record) : undefined;
  const picked = choices.find(([k]) => k === pick)?.[1];
  const link = (to: string | null) => place.link({ [field]: to, after: null });

  return (
    <>
      <nav
        aria-label={label}
        className="mb-5 -mt-1 flex min-w-0 gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        <Chip href={link(null)} on={!picked} count={all}>
          All
        </Chip>
        {choices.map(([k, s]) => (
          <Chip key={k} href={link(k)} on={k === pick} count={n[k] ?? 0}>
            <Cue state={s} />
            {s.label}
          </Chip>
        ))}
      </nav>
      {picked && meta && !holds(meta, field, pick ?? "") ? (
        <Empty>
          No {picked.label} {meta.name.many} here.
        </Empty>
      ) : (
        children
      )}
    </>
  );
}

function Chip({
  href,
  on,
  count,
  children,
}: {
  href: string;
  on: boolean;
  count: number;
  children: ReactNode;
}) {
  return (
    <a
      href={href}
      aria-current={on ? "page" : undefined}
      className={cn(
        "inline-flex h-8 shrink-0 items-center gap-1.5 rounded-(--ui-radius) px-2.5 text-[13px] whitespace-nowrap no-underline transition-[background-color,color] duration-150 ease-(--ui-ease)",
        on
          ? "bg-(--ui-fill) font-semibold text-(--ui-ink)"
          : "text-(--ui-ink-2) hover:bg-(--ui-hover) hover:text-(--ui-ink)",
      )}
    >
      {children}
      {count ? (
        <span className="text-[12px] font-semibold text-(--ui-accent) tabular-nums">
          {num(count)}
        </span>
      ) : null}
    </a>
  );
}

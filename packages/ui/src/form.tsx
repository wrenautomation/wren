/**
 * The Form template: a record type read as one form, a line per record, in sections by its first
 * status field. The title labels each line, the `columns` fields are its value and wrap, and an
 * action that applies shows on its line (Setup's Change). Nothing to pick, sort or export.
 */
import { cn } from "cn";
import { applies, useRun } from "./action.js";
import { Button } from "./controls.js";
import { Alert } from "./feedback.js";
import { FieldCell } from "./fields.js";
import {
  actsOf,
  cap,
  emptyOf,
  ListSkeleton,
  type RecordTemplateProps,
  ROOT,
  startOf,
  titleOf,
  useLoad,
  useTypes,
} from "./records.js";

const NO_CALL = () => Promise.reject(new Error("Nothing to run this."));

export function RecordForm({ record, api, columns, acts, empty, title }: RecordTemplateProps) {
  const types = useTypes(api);
  const meta = types.data?.find((t) => t.id === record);
  // ponytail: one page of 200 lines; a form that long wants a List.
  const page = useLoad(record, () => api.list({ record, limit: 200 }));
  const names = meta?.name ?? { one: "item", many: "items" };
  const { run, busy, dialog } = useRun(acts?.call ?? NO_CALL, page.retry, names);
  const error = (types.error && !types.data) || (page.error && !page.data);
  if (error) return <Alert onRetry={types.retry}>{(types.error ?? page.error)?.message}</Alert>;
  if (!meta || !page.data) return <ListSkeleton />;

  const actions = actsOf(meta, acts);
  const shown = meta.fields.filter((f) => columns?.includes(f.key) && f.kind !== "status");
  const part = meta.fields.find((f) => f.kind === "status");
  const rows = page.data.rows;
  const sections = part?.states
    ? Object.entries(part.states)
        .map(([k, s]) => ({ key: k, label: s.label, rows: rows.filter((r) => r[part.key] === k) }))
        .filter((s) => s.rows.length)
    : [{ key: "all", label: "", rows }];

  return (
    <div className={cn(ROOT, "grid max-w-[760px] min-w-0 gap-6")}>
      <h1 className="text-[20px] leading-7 font-semibold tracking-[-0.01em]">
        {title ?? cap(meta.name.many)}
      </h1>
      {!rows.length ? (
        <p className="text-[14px] text-(--ui-ink-2)">
          {emptyOf(empty, meta.views[0]?.id, meta.name.many)}
        </p>
      ) : null}
      {sections.map((s) => (
        <section key={s.key} className="grid gap-1">
          {s.label ? <h2 className="text-[14px] font-semibold">{s.label}</h2> : null}
          <dl className="m-0 grid">
            {s.rows.map((r) => {
              const here = actions.filter((a) => applies(a, r));
              return (
                <div
                  key={String(r.id)}
                  className="grid grid-cols-[minmax(0,1fr)] gap-x-6 gap-y-0.5 border-b border-(--ui-hair) py-2.5 sm:grid-cols-[180px_minmax(0,1fr)_auto]"
                >
                  <dt className="text-[13px] text-(--ui-ink-2)">{titleOf(meta, r)}</dt>
                  <dd className="m-0 text-[14px] break-words whitespace-pre-wrap">
                    {shown.map((f) => (
                      <FieldCell key={f.key} field={f} cell={r[f.key]} />
                    ))}
                  </dd>
                  {here.length ? (
                    <div className="flex gap-2 max-sm:mt-1 sm:justify-end">
                      {here.map((a) => (
                        <Button
                          key={a.id}
                          tone="secondary"
                          size="dense"
                          disabled={busy}
                          onClick={() => run(a, [r.id], startOf(a, r))}
                        >
                          {a.label}
                        </Button>
                      ))}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </dl>
        </section>
      ))}
      {dialog}
    </div>
  );
}

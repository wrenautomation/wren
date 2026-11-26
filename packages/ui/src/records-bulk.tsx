/** The bulk bar over a records list: the count, each bulk action with what it skips, Clear. */
import type { Row } from "@wren/core/records/serve";
import { type Action, applies, blockedOf, runningOn, runs } from "./action.js";
import { Button } from "./controls.js";
import { num } from "./format.js";

/** "3 selected", what each bulk action would do to them, and a way out. */
export function Bulk({
  actions,
  rows,
  picked,
  run,
  busy,
  running,
  clear,
}: {
  actions: readonly Action[];
  rows: Row[];
  picked: Set<string>;
  run: (action: Action, ids: (string | number)[]) => void;
  busy: boolean;
  running: { action: string; ids: readonly (string | number)[] } | null;
  clear: () => void;
}) {
  const chosen = rows.filter((r) => picked.has(String(r.id)));
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <span>{num(picked.size)} selected</span>
      {actions
        .filter((a) => a.bulk)
        .map((a) => {
          const ids = chosen.filter((r) => runs(a, r)).map((r) => r.id);
          // Rows it would apply to but can't run on yet: skipped, each reason said once.
          const reasons = chosen.flatMap((r) => (applies(a, r) ? (blockedOf(a, r) ?? []) : []));
          const skipped = reasons.length;
          const why = [...new Set(reasons)];
          return ids.length || skipped ? (
            <span key={a.id} className="inline-flex flex-wrap items-center gap-2">
              {ids.length ? (
                <Button
                  tone="secondary"
                  size="dense"
                  busy={runningOn(running, a.id, ids)}
                  disabled={busy}
                  onClick={() => run(a, ids)}
                >
                  {a.label} {num(ids.length)}
                </Button>
              ) : null}
              {skipped ? (
                <span className="text-(--ui-ink-2)">
                  {a.label} skips {num(skipped)}. {why.join(" ")}
                </span>
              ) : null}
            </span>
          ) : null;
        })}
      <button
        type="button"
        onClick={clear}
        className="border-0 bg-transparent p-0 text-(--ui-ink) underline decoration-(--ui-hair) underline-offset-2"
      >
        Clear
      </button>
    </span>
  );
}

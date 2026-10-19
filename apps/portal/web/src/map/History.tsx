/**
 * The Map's History (read only): the shape's versions newest first, number, note, author and
 * date. Pick two and the Map draws the difference, with the list of changes under them.
 */
import { Button, cx, Icon, LoadFailed, Loading } from "@wren/ui";
import { call } from "../api.js";
import { useCall } from "../load.js";
import { type DiffAnswer, diffLines } from "./diff.js";
import type { Version } from "./model.js";

const DAY = new Intl.DateTimeFormat("en-CA", { dateStyle: "medium", timeZone: "America/Toronto" });
const dayOf = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : DAY.format(d);
};

/** The diff of two versions, older first, read when both are picked. */
export function useDiff(at: Record<string, string>, picked: readonly number[]) {
  const [a, b] = [...picked].sort((x, y) => x - y);
  const key = a !== undefined && b !== undefined && picked.length === 2 ? `${a}:${b}` : null;
  return useCall<DiffAnswer>(key ? `map-diff:${JSON.stringify(at)}:${key}` : null, () =>
    call<DiffAnswer>("pipeline/shapeDiff", { ...at, a, b }),
  );
}

export function History({
  versions,
  picked,
  onPick,
  diff,
  onClose,
}: {
  versions: readonly Version[];
  picked: readonly number[];
  onPick: (n: number) => void;
  diff: ReturnType<typeof useDiff>;
  onClose: () => void;
}) {
  const sorted = [...versions].sort((x, y) => y.number - x.number);
  return (
    <section
      aria-label="History"
      className="flex min-w-0 flex-col gap-4 border-(--ui-hair) p-5 text-[14px] text-(--ui-ink) max-[900px]:border-t min-[901px]:w-80 min-[901px]:shrink-0 min-[901px]:border-l"
    >
      <header className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <h2 className="text-[17px]/6 font-semibold">History</h2>
          <p className="text-[13px] text-(--ui-ink-3)">Pick two versions to see what changed.</p>
        </div>
        <Button tone="quiet" size="sm" icon="close" onClick={onClose}>
          Close
        </Button>
      </header>
      <ul className="list-none">
        {sorted.map((v) => {
          const on = picked.includes(v.number);
          return (
            <li key={v.number}>
              <button
                type="button"
                aria-pressed={on}
                onClick={() => onPick(v.number)}
                className={cx(
                  "flex min-h-11 w-full cursor-pointer items-start gap-2 border-0 bg-transparent px-1 py-1.5 text-left text-(--ui-ink) hover:bg-(--ui-hover)",
                  on && "bg-(--ui-tile)",
                )}
              >
                <Icon
                  name={on ? "check" : "stack"}
                  size={15}
                  className="mt-0.5 text-(--ui-ink-2)"
                />
                <span className="min-w-0 flex-1">
                  <span className="block font-semibold">Version {v.number}</span>
                  <span className="block truncate text-(--ui-ink-2)">{v.note || "No note"}</span>
                  <span className="block text-[12.5px] text-(--ui-ink-3)">
                    {[v.by, dayOf(v.at)].filter(Boolean).join(" · ")}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      {picked.length === 2 ? (
        diff.error && !diff.data ? (
          <LoadFailed error={diff.error} onRetry={diff.retry} what="difference" />
        ) : diff.data ? (
          <section aria-label="Changes">
            <h3 className="mb-1.5 text-[13px] font-semibold text-(--ui-ink-2)">
              Version {diff.data.a} to {diff.data.b}
            </h3>
            {(() => {
              const lines = diffLines(diff.data.bodies[0], diff.data.bodies[1], diff.data.diff);
              return lines.length ? (
                <ul className="list-none space-y-0.5 text-(--ui-ink-2)">
                  {lines.map((l) => (
                    <li key={l}>{l}</li>
                  ))}
                </ul>
              ) : (
                <p className="text-(--ui-ink-3)">The two are the same.</p>
              );
            })()}
          </section>
        ) : (
          <Loading lines={3} />
        )
      ) : null}
    </section>
  );
}

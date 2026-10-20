/**
 * The Map's History, a card over the canvas: the shape's versions newest first, number, note,
 * author and date. Pick two and the Map draws the difference, with the list of changes under
 * them. "Restore" on an older version shows what it would change, then saves a new version with
 * that version's body (the old versions stay; history only grows).
 */
import { diffShapes } from "@wren/pipeline/diff";
import type { ShapeBody } from "@wren/pipeline/model";
import { Alert, Button, cx, Icon, LoadFailed, Loading } from "@wren/ui";
import { useState } from "react";
import { call } from "../api.js";
import { useCall } from "../load.js";
import { type DiffAnswer, diffLines } from "./diff.js";
import type { Version } from "./model.js";
import { OVER_RIGHT } from "./overlay.js";

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

/** The note a restore carries. */
export const restoreNote = (n: number) => `Restore v${n}`;

/** What restoring version `n` would change, and the button that does it. */
function Restore({
  n,
  newest,
  at,
  onSaved,
  onCancel,
}: {
  n: number;
  newest: number;
  at: Record<string, string>;
  /** The newest version was saved: read the Map again. */
  onSaved: () => void;
  onCancel: () => void;
}) {
  const diff = useDiff(at, [n, newest]);
  const [busy, setBusy] = useState(false);
  const [refused, setRefused] = useState<string | null>(null);
  const body: ShapeBody | undefined = diff.data?.bodies[0];
  const save = async () => {
    if (!body) return;
    setBusy(true);
    setRefused(null);
    try {
      await call("pipeline/shapeVersion", { ...at, body, note: restoreNote(n) });
      onSaved();
    } catch (err) {
      setRefused(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };
  // The difference reads from the newest shape to version `n`: that is what the restore changes.
  const lines = diff.data
    ? diffLines(
        diff.data.bodies[1],
        diff.data.bodies[0],
        diffShapes(diff.data.bodies[1], diff.data.bodies[0]),
      )
    : [];
  return (
    <section
      aria-label={`Restore version ${n}`}
      className="grid gap-2 rounded-(--ui-radius) bg-(--ui-wash) p-3"
    >
      <h3 className="text-[13px] font-semibold text-(--ui-ink)">Restore version {n}</h3>
      {diff.error && !diff.data ? (
        <LoadFailed error={diff.error} onRetry={diff.retry} what="difference" />
      ) : !diff.data ? (
        <Loading lines={3} />
      ) : lines.length ? (
        <>
          <p className="text-[12.5px] text-(--ui-ink-2)">
            This saves a new version with the shape as it was. It changes:
          </p>
          <ul className="list-none space-y-0.5 text-(--ui-ink-2)">
            {lines.map((l) => (
              <li key={l}>{l}</li>
            ))}
          </ul>
        </>
      ) : (
        <p className="text-(--ui-ink-3)">
          Version {n} is the same as the newest. Nothing to restore.
        </p>
      )}
      {refused ? <Alert className="mb-0">{refused}</Alert> : null}
      <div className="flex gap-2">
        <Button
          tone="primary"
          size="dense"
          busy={busy}
          disabled={!body || lines.length === 0}
          onClick={() => void save()}
        >
          Restore
        </Button>
        <Button tone="quiet" size="dense" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </section>
  );
}

export function History({
  versions,
  picked,
  onPick,
  diff,
  at,
  canEdit,
  onSaved,
  onClose,
}: {
  versions: readonly Version[];
  picked: readonly number[];
  onPick: (n: number) => void;
  diff: ReturnType<typeof useDiff>;
  /** The workspace as a call's params. */
  at: Record<string, string>;
  /** The viewer may save a version: Restore shows. */
  canEdit: boolean;
  onSaved: () => void;
  onClose: () => void;
}) {
  const sorted = [...versions].sort((x, y) => y.number - x.number);
  const newest = sorted[0]?.number ?? 0;
  const [restoring, setRestoring] = useState<number | null>(null);
  return (
    <section aria-label="History" className={cx(OVER_RIGHT, "text-[14px] text-(--ui-ink)")}>
      <header className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <h2 className="text-[17px]/6 font-semibold">History</h2>
          <p className="text-[13px] text-(--ui-ink-3)">Pick two versions to see what changed.</p>
        </div>
        <Button tone="quiet" size="dense" icon="close" onClick={onClose}>
          Close
        </Button>
      </header>
      <ul className="list-none">
        {sorted.map((v) => {
          const on = picked.includes(v.number);
          return (
            <li key={v.number} className="flex items-start">
              <button
                type="button"
                aria-pressed={on}
                onClick={() => onPick(v.number)}
                className={cx(
                  "flex min-h-11 min-w-0 flex-1 cursor-pointer items-start gap-2 border-0 bg-transparent px-1 py-1.5 text-left text-(--ui-ink) hover:bg-(--ui-hover)",
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
              {canEdit && v.number !== newest ? (
                <Button
                  tone="quiet"
                  size="dense"
                  aria-label={`Restore version ${v.number}`}
                  aria-pressed={restoring === v.number}
                  onClick={() => setRestoring(restoring === v.number ? null : v.number)}
                >
                  Restore
                </Button>
              ) : null}
            </li>
          );
        })}
      </ul>
      {restoring !== null ? (
        <Restore
          key={restoring}
          n={restoring}
          newest={newest}
          at={at}
          onSaved={() => {
            setRestoring(null);
            onSaved();
          }}
          onCancel={() => setRestoring(null)}
        />
      ) : null}
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

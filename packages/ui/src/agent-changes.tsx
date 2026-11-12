/**
 * What the agent changed in this chat (designs/2026-11-11-agent-panel.md, D1): one group per turn,
 * a line per row it changed, in words from `audit_changes`. Undo a line or a whole turn; a refusal
 * stays on its line. Undone lines keep their place, struck. The turn's foot carries a tally.
 */
import { useState } from "react";
import { Ring } from "./busy.js";
import { Button } from "./controls.js";
import { relative } from "./fields.js";
import { cx } from "./format.js";
import { Icon, type IconName } from "./icons.js";

export interface AgentChange {
  /** The audit event id. */
  id: string;
  at: string;
  op: "insert" | "update" | "delete";
  /** The record in words: "Deal · Acme Bakery". */
  what: string;
  /** What changed: "stage: Lead → Won"; empty for an add or a remove. */
  change?: string | undefined;
  /** money, client, team or data (`audit_changes.area`). */
  area?: "money" | "client" | "team" | "data" | undefined;
  href?: string | undefined;
  undone?: boolean | undefined;
  /** Why it can't be undone, when it can't. */
  fixed?: string | undefined;
}

export interface AgentChangeTurn {
  id: string;
  /** What you asked, first line. */
  said: string;
  at: string;
  lines: AgentChange[];
}

/** An undo: one line or a whole turn. A refusal comes back as its sentence. */
export type UndoChange = (t: { line: string } | { turn: string }) => Promise<string | null>;

const OP: Record<AgentChange["op"], [IconName, string]> = {
  insert: ["plus", "Added"],
  update: ["edit", "Changed"],
  delete: ["trash", "Removed"],
};

function Line({ c, onUndo }: { c: AgentChange; onUndo: UndoChange }) {
  const [busy, setBusy] = useState(false);
  const [no, setNo] = useState<string | null>(null);
  const [icon, verb] = OP[c.op];
  const undo = async () => {
    setBusy(true);
    setNo(await onUndo({ line: c.id }).catch((e: Error) => e.message));
    setBusy(false);
  };
  return (
    <li className="group/line grid grid-cols-[20px_1fr_auto] items-start gap-x-2.5 py-2">
      <span
        className={cx(
          "mt-px grid size-5 place-items-center rounded-full",
          c.undone
            ? "bg-(--ui-fill) text-(--ui-ink-3)"
            : c.area === "money"
              ? "bg-(--ui-warn-tint) text-(--ui-warn-ink)"
              : "bg-(--ui-accent-tint) text-(--ui-live)",
        )}
      >
        <Icon name={c.undone ? "undo" : icon} size={11} />
      </span>
      <span className="grid min-w-0 gap-0.5">
        <span
          className={cx(
            "text-[13.5px]/[1.45] wrap-anywhere text-(--ui-ink)",
            c.undone && "text-(--ui-ink-3) line-through decoration-(--ui-ink-3)",
          )}
        >
          <span className="text-(--ui-ink-2)">{verb} </span>
          {c.href ? (
            <a href={c.href} className="font-medium hover:underline">
              {c.what}
            </a>
          ) : (
            <span className="font-medium">{c.what}</span>
          )}
        </span>
        {c.change ? (
          <span
            className={cx(
              "text-[12.5px]/[1.45] wrap-anywhere text-(--ui-ink-2)",
              c.undone && "text-(--ui-ink-3) line-through",
            )}
          >
            {c.change}
          </span>
        ) : null}
        {no ? (
          <span className="mt-1 w-fit rounded-[8px] bg-(--ui-warn-tint) px-2 py-1 text-[12.5px] text-(--ui-warn-ink) [animation:ui-fade_.15s_both]">
            {no}
          </span>
        ) : null}
      </span>
      <span className="flex min-h-6 items-center">
        {c.undone ? (
          <span className="text-[12px] font-medium text-(--ui-ink-3)">Undone</span>
        ) : c.fixed ? (
          <span className="text-[12px] text-(--ui-ink-3)" title={c.fixed}>
            Can't undo
          </span>
        ) : (
          <button
            type="button"
            disabled={busy}
            onClick={undo}
            className="inline-flex min-h-7 items-center gap-1 rounded-[8px] px-2 text-[12.5px] font-medium text-(--ui-link) transition-colors hover:bg-(--ui-fill) disabled:opacity-50 pointer-coarse:min-h-11"
          >
            {busy ? <Ring /> : <Icon name="undo" size={12} />}
            Undo
          </button>
        )}
      </span>
    </li>
  );
}

/** Lines shown before a fold; one over shows whole (a "1 more" fold saves nothing). */
const FOLD = 5;

function Turn({ t, onUndo }: { t: AgentChangeTurn; onUndo: UndoChange }) {
  const [busy, setBusy] = useState(false);
  const [no, setNo] = useState<string | null>(null);
  const [all, setAll] = useState(t.lines.length <= FOLD + 1);
  const open = t.lines.filter((l) => !l.undone && !l.fixed).length;
  const undoAll = async () => {
    setBusy(true);
    setNo(await onUndo({ turn: t.id }).catch((e: Error) => e.message));
    setBusy(false);
  };
  return (
    <section className="grid gap-1 border-t border-(--ui-hair) pt-3 first:border-t-0 first:pt-0">
      <header className="flex items-start gap-3">
        <span className="grid min-w-0 flex-1 gap-0.5">
          <span className="text-[13px]/[1.45] font-medium wrap-anywhere text-(--ui-ink)">
            {t.said}
          </span>
          <span className="text-[12px] text-(--ui-ink-3)">
            {relative(new Date(t.at))} · {t.lines.length}{" "}
            {t.lines.length === 1 ? "change" : "changes"}
          </span>
        </span>
        {open > 1 ? (
          <Button size="sm" tone="secondary" busy={busy} onClick={undoAll}>
            Undo all {open}
          </Button>
        ) : null}
      </header>
      {no ? (
        <span className="w-fit rounded-[8px] bg-(--ui-warn-tint) px-2 py-1 text-[12.5px] text-(--ui-warn-ink)">
          {no}
        </span>
      ) : null}
      <ul className="m-0 grid list-none p-0">
        {(all ? t.lines : t.lines.slice(0, FOLD)).map((c) => (
          <Line key={c.id} c={c} onUndo={onUndo} />
        ))}
      </ul>
      {t.lines.length > FOLD + 1 ? (
        <button
          type="button"
          aria-expanded={all}
          onClick={() => setAll(!all)}
          className="flex min-h-8 w-fit items-center gap-1 rounded-[8px] px-2 text-[12.5px] font-medium text-(--ui-ink-2) transition-colors hover:bg-(--ui-fill) hover:text-(--ui-ink) pointer-coarse:min-h-11"
        >
          <Icon name={all ? "up" : "down"} size={12} />
          {all ? "Show fewer" : `Show ${t.lines.length - FOLD} more`}
        </button>
      ) : null}
    </section>
  );
}

/** Every change of one chat, newest turn first. */
export function AgentChanges({
  turns,
  onUndo,
}: {
  turns: readonly AgentChangeTurn[];
  onUndo: UndoChange;
}) {
  if (!turns.length)
    return (
      <p className="m-0 py-6 text-center text-[13.5px] text-(--ui-ink-3)">
        Nothing changed in this chat yet. What the agent changes shows here, with Undo.
      </p>
    );
  return (
    <div className="grid gap-4">
      {turns.map((t) => (
        <Turn key={t.id} t={t} onUndo={onUndo} />
      ))}
    </div>
  );
}

/** At a turn's foot: what it changed, in one line, and the way to the list. */
export function ChangesTally({
  lines,
  onOpen,
}: {
  lines: readonly AgentChange[];
  onOpen: () => void;
}) {
  const records = new Set(lines.filter((l) => !l.undone).map((l) => l.what)).size;
  if (!records) return null;
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex w-fit items-center gap-2 rounded-[10px] bg-(--ui-fill) py-1.5 pr-2.5 pl-2 text-[12.5px] text-(--ui-ink-2) transition-colors hover:bg-(--ui-hover) hover:text-(--ui-ink)"
    >
      <Icon name="history" size={13} />
      <span>
        Changed {records} {records === 1 ? "record" : "records"}
      </span>
      <span className="font-medium text-(--ui-ink)">Review</span>
    </button>
  );
}

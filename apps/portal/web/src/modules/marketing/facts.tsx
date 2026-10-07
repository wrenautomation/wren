/**
 * Marketing → Facts: what every draft may claim about William and Wren (`@wren/core/facts`), one
 * fact a row. Type in place, add, delete, drag or move to reorder; nothing lands until Save, which
 * goes through the record edits path (`marketing.facts`): checked, compare-and-swapped on the
 * version it opened, and a History line with who and Undo. Reset shows the diff from the default
 * before it touches the list. `wren drafts facts` saves the same way.
 */
import type { ChangeLine, Edited, EditState } from "@wren/core/edits";
import {
  DEFAULT_FACTS,
  FACT_MAX,
  FACTS_CAP,
  FACTS_DROP,
  FACTS_PAGE,
  factsChange,
  factsChangeText,
  factsOf,
  factsProblem,
  factsText,
} from "@wren/core/facts-list";
import type { RecordAnswer } from "@wren/core/records/serve";
import {
  Alert,
  Button,
  cx,
  Diff,
  Empty,
  exact,
  Icon,
  Loading,
  PageHeader,
  relative,
  Section,
  say,
  Tag,
} from "@wren/ui";
import {
  type DragEvent,
  type KeyboardEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { call, viewingAs } from "../../api.js";
import { useCall } from "../../load.js";
import type { ListPage, PageProps } from "../../module.js";
import { QUIET } from "../work/bits.js";

/** Where a drop for made-up facts, or his own "Wrong facts", sends him. */
export function FactsLink() {
  return (
    <a href={FACTS_PAGE} className="whitespace-nowrap font-medium">
      Edit facts
    </a>
  );
}

/** A row's drop reason with the link when the facts guard dropped it; its line replaces the field's. */
export const factsDropped =
  (field: string, label: string): NonNullable<ListPage["extras"]> =>
  (_detail, at) => {
    const why = at.row[field];
    return typeof why === "string" && why.startsWith(FACTS_DROP)
      ? {
          facts: [
            [
              label,
              <span key={field}>
                {why} <FactsLink />
              </span>,
            ],
          ],
        }
      : {};
  };

const RECORD = "marketing.facts";
const ID = "wren";
/** The count shows once a fact is this close to the cap, or while it's being typed. */
const NEAR = 40;

interface Row {
  key: number;
  text: string;
}
interface Saved {
  facts: string[];
  version: string;
  history: ChangeLine[];
  /** Who saved last and when; null on the default. */
  by: string | null;
  at: string | null;
}

let next = 0;
const rowsOf = (facts: readonly string[]): Row[] => facts.map((text) => ({ key: next++, text }));
const kept = (rows: readonly Row[]) => rows.map((r) => r.text.trim()).filter(Boolean);
const same = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((f, i) => f === b[i]);

function savedOf(a: RecordAnswer): Saved | null {
  const e = a.edit as EditState | null | undefined;
  if (!e) return null;
  const at = a.row.updatedAt;
  return {
    facts: factsOf(String(e.values.facts ?? "")),
    version: e.version,
    history: e.history,
    by: typeof a.row.updatedBy === "string" ? a.row.updatedBy : null,
    at: typeof at === "string" ? at : null,
  };
}

/** Who made a change: a teammate by email, a save from a terminal as the CLI. */
const byName = (by: string) => (by === "cli" ? "the CLI" : by);
const whoLine = (c: ChangeLine) => {
  const who = byName(c.by);
  const line =
    c.undoes !== null
      ? `${who} undid a change`
      : c.via === "claude"
        ? `Claude's change, accepted by ${who}`
        : who;
  return c.by === "cli" ? line.charAt(0).toUpperCase() + line.slice(1) : line;
};
const listOf = (v: unknown) => factsOf(typeof v === "string" ? v : "");

const ICON_BUTTON =
  "grid size-7 place-items-center rounded-(--ui-radius) border-0 sm:size-8 bg-transparent text-(--ui-ink-3) hover:bg-(--ui-hover) hover:text-(--ui-ink) focus-visible:bg-(--ui-hover) focus-visible:text-(--ui-ink) focus-visible:outline-none disabled:pointer-events-none disabled:opacity-30";

function FactRow({
  row,
  n,
  last,
  fresh,
  writes,
  over,
  armed,
  onText,
  onKey,
  onMove,
  onRemove,
  onArm,
  drag,
  setRef,
}: {
  row: Row;
  n: number;
  last: boolean;
  /** Not in the saved list: new or changed. */
  fresh: boolean;
  writes: boolean;
  /** A drag hovers here, from above ("below") or below ("above"). */
  over: "above" | "below" | null;
  armed: boolean;
  onText: (t: string) => void;
  onKey: (e: KeyboardEvent<HTMLTextAreaElement>) => void;
  onMove: (by: -1 | 1) => void;
  onRemove: () => void;
  onArm: (on: boolean) => void;
  drag: {
    start: (e: DragEvent) => void;
    over: (e: DragEvent) => void;
    leave: () => void;
    drop: (e: DragEvent) => void;
    end: () => void;
  };
  setRef: (el: HTMLTextAreaElement | null) => void;
}) {
  const [focused, setFocused] = useState(false);
  const len = row.text.trim().length;
  const long = len > FACT_MAX;
  const label = `Fact ${n}`;
  return (
    <li
      draggable={armed}
      onDragStart={drag.start}
      onDragOver={drag.over}
      onDragLeave={drag.leave}
      onDrop={drag.drop}
      onDragEnd={drag.end}
      className={cx(
        "group/fact relative grid grid-cols-[28px_minmax(0,1fr)] items-start gap-x-1 border-b border-(--ui-hair) py-2 sm:grid-cols-[28px_minmax(0,1fr)_auto]",
        over === "above" && "shadow-[inset_0_2px_0_var(--ui-accent)]",
        over === "below" && "shadow-[inset_0_-2px_0_var(--ui-accent)]",
      )}
    >
      {fresh ? (
        <span
          aria-hidden
          className="absolute top-2 bottom-2 -left-3 w-0.5 rounded-full bg-(--ui-accent)"
        />
      ) : null}
      {writes ? (
        <button
          type="button"
          aria-label={`Drag ${label}`}
          title="Drag to reorder"
          onPointerDown={() => onArm(true)}
          onPointerUp={() => onArm(false)}
          className="mt-1.5 grid h-7 w-7 cursor-grab place-items-center rounded-(--ui-radius) border-0 bg-transparent text-[12.5px] text-(--ui-ink-3) tabular-nums hover:bg-(--ui-hover) active:cursor-grabbing"
        >
          <span className="group-hover/fact:hidden">{n}</span>
          <Icon name="menu" size={14} className="hidden group-hover/fact:block" />
        </button>
      ) : (
        <span className="mt-1.5 grid h-7 w-7 place-items-center text-[12.5px] text-(--ui-ink-3) tabular-nums">
          {n}
        </span>
      )}
      <div className="min-w-0">
        {writes ? (
          <textarea
            ref={setRef}
            aria-label={label}
            aria-invalid={long || undefined}
            rows={1}
            value={row.text}
            placeholder="One thing that is true, in your words"
            onChange={(e) => onText(e.target.value.replace(/\r?\n/g, " "))}
            onKeyDown={onKey}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            className={cx(
              "block w-full resize-none rounded-(--ui-radius) border border-transparent bg-transparent px-2 py-1.5 text-[15px] leading-[1.55] text-pretty [field-sizing:content] placeholder:text-(--ui-ink-3) hover:bg-(--ui-hover) focus:border-(--ui-hair) focus:bg-(--ui-paper) focus:outline-none",
              long && "border-(--ui-bad)/50 focus:border-(--ui-bad)",
            )}
          />
        ) : (
          <p className="px-2 py-1.5 text-[15px] leading-[1.55] text-pretty">{row.text}</p>
        )}
        {writes && (focused || long || len > FACT_MAX - NEAR) ? (
          <p
            className={cx(
              "px-2 pt-0.5 text-[12px] tabular-nums",
              long ? "text-(--ui-bad)" : "text-(--ui-ink-3)",
            )}
            aria-live="polite"
          >
            {len} / {FACT_MAX}
            {long ? `, ${len - FACT_MAX} over` : ""}
          </p>
        ) : null}
      </div>
      {writes ? (
        <div className="col-start-2 -mt-1 flex items-center justify-end gap-0.5 opacity-100 sm:col-start-3 sm:mt-0 sm:opacity-60 sm:group-focus-within/fact:opacity-100 sm:group-hover/fact:opacity-100">
          <button
            type="button"
            className={ICON_BUTTON}
            aria-label={`Move ${label} up`}
            title="Move up (Alt+Up)"
            disabled={n === 1}
            onClick={() => onMove(-1)}
          >
            <Icon name="down" size={14} className="rotate-180" />
          </button>
          <button
            type="button"
            className={ICON_BUTTON}
            aria-label={`Move ${label} down`}
            title="Move down (Alt+Down)"
            disabled={last}
            onClick={() => onMove(1)}
          >
            <Icon name="down" size={14} />
          </button>
          <button
            type="button"
            className={cx(ICON_BUTTON, "hover:text-(--ui-bad)")}
            aria-label={`Delete ${label}`}
            title="Delete"
            onClick={onRemove}
          >
            <Icon name="close" size={14} />
          </button>
        </div>
      ) : null}
    </li>
  );
}

/** One save in History: who, when, what it did, Undo, and the change as a diff. */
function Change({
  c,
  now,
  canUndo,
  onUndo,
}: {
  c: ChangeLine;
  now: string;
  canUndo: boolean;
  onUndo: (id: number) => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const before = listOf(c.before.facts);
  const after = listOf(c.after.facts);
  // Undo puts the before back only while what it set still stands.
  const stands = typeof c.after.facts === "string" && c.after.facts === now;
  return (
    <li className="grid gap-1.5 border-b border-(--ui-hair) py-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <span className="min-w-0 text-[14px]">
          <span className="font-medium break-all">{whoLine(c)}</span>
          <span className={QUIET}> · {factsChangeText(factsChange(before, after))}</span>
        </span>
        <span className="flex items-center gap-2">
          <time className={cx(QUIET, "text-[13px]")} dateTime={c.at} title={exact(new Date(c.at))}>
            {relative(new Date(c.at))}
          </time>
          {c.undone ? (
            <Tag>Undone</Tag>
          ) : canUndo && stands ? (
            <Button
              tone="quiet"
              size="dense"
              busy={busy}
              onClick={async () => {
                setBusy(true);
                await onUndo(c.id);
                setBusy(false);
              }}
            >
              Undo
            </Button>
          ) : null}
        </span>
      </div>
      <details className="group/diff">
        <summary className="w-fit cursor-pointer list-none text-[13px] text-(--ui-ink-2) hover:text-(--ui-ink) [&::-webkit-details-marker]:hidden">
          <span className="inline-flex items-center gap-1">
            <Icon
              name="right"
              size={12}
              className="transition-transform group-open/diff:rotate-90"
            />
            Show the change
          </span>
        </summary>
        <Diff
          className="mt-2"
          a={factsText(before)}
          b={factsText(after)}
          names={["Before", "After"]}
        />
      </details>
    </li>
  );
}

export function FactsPage({ demo, can }: PageProps) {
  const [nonce, setNonce] = useState(0);
  const got = useCall(`facts:${nonce}`, () =>
    call<RecordAnswer>("console/recordsGet", { record: RECORD, id: ID }),
  );
  const saved = got.data ? savedOf(got.data) : null;
  const writes = !demo && !viewingAs && (can?.includes("manage") ?? true);

  const [rows, setRows] = useState<Row[] | null>(null);
  /** The version his rows started from, and its facts: what Save names and what dirty means. */
  const [base, setBase] = useState<{ version: string; facts: string[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const [reset, setReset] = useState(false);
  const [armed, setArmed] = useState<number | null>(null);
  const [over, setOver] = useState<number | null>(null);
  const from = useRef<number | null>(null);
  const refs = useRef(new Map<number, HTMLTextAreaElement>());
  const focusKey = useRef<{ key: number; at: "end" | "start" } | null>(null);

  const start = useCallback((version: string, facts: string[]) => {
    setRows(rowsOf(facts));
    setBase({ version, facts });
  }, []);
  // A fresh read replaces the list, unless he has changes of his own on it: then Save names the
  // version he started from, and a save made meanwhile is refused, never written over.
  const dirty = !!rows && !!base && !same(kept(rows), base.facts);
  useEffect(() => {
    if (saved && !dirty && base?.version !== saved.version) start(saved.version, saved.facts);
  }, [saved, base, dirty, start]);

  // After a row is added, moved or removed, the caret goes where it was asked to.
  useEffect(() => {
    const f = focusKey.current;
    if (!f) return;
    const el = refs.current.get(f.key);
    if (!el) return;
    focusKey.current = null;
    el.focus();
    const at = f.at === "end" ? el.value.length : 0;
    el.setSelectionRange(at, at);
  });

  const reload = useCallback(() => setNonce((n) => n + 1), []);

  if (got.error && !got.data) return <Alert onRetry={got.retry}>{got.error.message}</Alert>;
  if (!saved || !rows || !base)
    return (
      <>
        <PageHeader title="Facts" />
        <Loading lines={6} />
      </>
    );

  const list = kept(rows);
  const problem = factsProblem(rows.map((r) => r.text));
  const savedSet = new Set(base.facts);
  const full = rows.length >= FACTS_CAP;

  const change = (fn: (rs: Row[]) => Row[]) => setRows((rs) => (rs ? fn(rs) : rs));
  const add = (after: number = rows.length - 1, text = "") => {
    if (full) return;
    const row = { key: next++, text };
    focusKey.current = { key: row.key, at: "end" };
    change((rs) => [...rs.slice(0, after + 1), row, ...rs.slice(after + 1)]);
  };
  const remove = (i: number) => {
    const prev = rows[i - 1] ?? rows[i + 1];
    if (prev) focusKey.current = { key: prev.key, at: "end" };
    change((rs) => rs.filter((_, j) => j !== i));
  };
  const move = (i: number, to: number) => {
    if (to < 0 || to >= rows.length || to === i) return;
    const row = rows[i];
    if (row) focusKey.current = { key: row.key, at: "end" };
    change((rs) => {
      const out = [...rs];
      const [it] = out.splice(i, 1);
      if (it) out.splice(to, 0, it);
      return out;
    });
  };

  const save = async () => {
    if (!dirty || problem || busy) return;
    setBusy(true);
    try {
      const out = await call<Edited>("console/recordsEdit", {
        record: RECORD,
        id: ID,
        patch: { facts: factsText(list) },
        expect: base?.version ?? saved.version,
      });
      start(out.version, listOf(out.values.facts));
      say.done("Facts saved. The next draft uses them.");
      reload();
    } catch (err) {
      say.failed(err);
    } finally {
      setBusy(false);
    }
  };
  const discard = () => start(saved.version, saved.facts);
  const undo = async (change: number) => {
    try {
      await call<Edited>("console/recordsUndo", { record: RECORD, id: ID, change });
      say.done("Undone");
      reload();
    } catch (err) {
      say.failed(err);
    }
  };

  const keys = (i: number) => (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.nativeEvent.isComposing) return;
    const row = rows[i];
    if ((e.metaKey || e.ctrlKey) && e.key === "s") {
      e.preventDefault();
      void save();
    } else if (e.altKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
      e.preventDefault();
      move(i, i + (e.key === "ArrowUp" ? -1 : 1));
    } else if (e.key === "Enter") {
      // Enter starts the next fact; what's after the caret goes with it.
      e.preventDefault();
      if (!row || full) return;
      const at = e.currentTarget.selectionStart;
      const head = row.text.slice(0, at).trimEnd();
      const tail = row.text.slice(at).trimStart();
      change((rs) => rs.map((r, j) => (j === i ? { ...r, text: head } : r)));
      add(i, tail);
      if (focusKey.current) focusKey.current.at = "start";
    } else if (e.key === "Backspace" && row && !row.text && rows.length > 1) {
      e.preventDefault();
      remove(i);
    }
  };

  const drag = (i: number) => ({
    start: (e: DragEvent) => {
      from.current = i;
      e.dataTransfer.effectAllowed = "move";
    },
    over: (e: DragEvent) => {
      if (from.current === null) return;
      e.preventDefault();
      setOver(i);
    },
    leave: () => setOver((o) => (o === i ? null : o)),
    drop: (e: DragEvent) => {
      e.preventDefault();
      if (from.current !== null) move(from.current, i);
      from.current = null;
      setOver(null);
      setArmed(null);
    },
    end: () => {
      from.current = null;
      setOver(null);
      setArmed(null);
    },
  });

  const isDefault = same(list, DEFAULT_FACTS);
  const count = (
    <span className={cx("tabular-nums", list.length > FACTS_CAP && "text-(--ui-bad)")}>
      {list.length} of {FACTS_CAP}
    </span>
  );
  const status =
    got.data?.row.source === "default" ? (
      "The default list"
    ) : saved.at ? (
      <>
        Saved <time title={exact(new Date(saved.at))}>{relative(new Date(saved.at))}</time>
        {saved.by ? ` by ${byName(saved.by)}` : ""}
      </>
    ) : null;

  return (
    <div className="max-w-[760px]">
      <PageHeader
        title="Facts"
        lede="What drafts may say about you and Wren. A draft that claims anything else is written again once, then dropped."
        actions={
          writes ? (
            <Button
              tone="quiet"
              size="dense"
              aria-expanded={reset}
              onClick={() => setReset((r) => !r)}
            >
              Reset to default
            </Button>
          ) : null
        }
      />

      {reset ? (
        <Section
          title="Reset to the default"
          note={
            isDefault
              ? "Your list is the default already."
              : "Your list on the left, the default on the right. Nothing changes until you save."
          }
          className="mb-8 rounded-(--ui-radius) border border-(--ui-hair) p-4"
        >
          {isDefault ? null : (
            <Diff a={factsText(list)} b={factsText(DEFAULT_FACTS)} names={["Yours", "Default"]} />
          )}
          <div className="mt-4 flex flex-wrap gap-2">
            {isDefault ? null : (
              <Button
                size="dense"
                onClick={() => {
                  setRows(rowsOf(DEFAULT_FACTS));
                  setReset(false);
                }}
              >
                Use the default
              </Button>
            )}
            <Button tone="quiet" size="dense" onClick={() => setReset(false)}>
              {isDefault ? "Close" : "Cancel"}
            </Button>
          </div>
        </Section>
      ) : null}

      <Section>
        <p className={cx(QUIET, "mb-2 flex flex-wrap gap-x-3 text-[13px]")}>
          <span>{count} facts</span>
          {status ? <span>{status}</span> : null}
        </p>
        {rows.length ? (
          <ol className="list-none border-t border-(--ui-hair) p-0 pl-3 sm:pl-0">
            {rows.map((r, i) => (
              <FactRow
                key={r.key}
                row={r}
                n={i + 1}
                last={i === rows.length - 1}
                fresh={!!r.text.trim() && !savedSet.has(r.text.trim())}
                writes={writes}
                over={
                  over === i && from.current !== null && from.current !== i
                    ? from.current < i
                      ? "below"
                      : "above"
                    : null
                }
                armed={armed === r.key}
                onArm={(on) => setArmed(on ? r.key : null)}
                onText={(text) =>
                  change((rs) => rs.map((x) => (x.key === r.key ? { ...x, text } : x)))
                }
                onKey={keys(i)}
                onMove={(by) => move(i, i + by)}
                onRemove={() => remove(i)}
                drag={drag(i)}
                setRef={(el) => {
                  if (el) refs.current.set(r.key, el);
                  else refs.current.delete(r.key);
                }}
              />
            ))}
          </ol>
        ) : (
          <Empty
            action={
              writes ? (
                <Button size="dense" onClick={() => add()}>
                  Add a fact
                </Button>
              ) : null
            }
          >
            No facts. Drafts claim nothing about you or Wren until you add one.
          </Empty>
        )}
        {writes && rows.length ? (
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <Button tone="quiet" size="dense" disabled={full} onClick={() => add()}>
              Add a fact
            </Button>
            <span className={cx(QUIET, "text-[13px]")}>
              {full
                ? `${FACTS_CAP} is the most a list holds.`
                : "Enter starts the next fact. Alt+Up and Alt+Down move one."}
            </span>
          </div>
        ) : null}
      </Section>

      {writes && dirty ? (
        <div className="sticky bottom-0 z-10 -mx-4 mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-(--ui-hair) bg-(--ui-paper) px-4 py-3 sm:mx-0 sm:rounded-(--ui-radius) sm:border sm:shadow-sm">
          <span
            className={cx("min-w-0 text-[14px]", problem ? "text-(--ui-bad)" : QUIET)}
            role={problem ? "alert" : undefined}
          >
            {problem ?? factsChangeText(factsChange(base.facts, list))}. Not saved yet.
          </span>
          <span className="flex gap-2">
            <Button tone="quiet" size="dense" onClick={discard} disabled={busy}>
              Discard
            </Button>
            <Button size="dense" busy={busy} disabled={!!problem} onClick={() => void save()}>
              Save
            </Button>
          </span>
        </div>
      ) : null}

      <Section
        title="History"
        note="Every save, with who made it. Undo puts a change back."
        className="mt-12"
      >
        {saved.history.length ? (
          <ol className="list-none border-t border-(--ui-hair) p-0">
            {saved.history.map((c) => (
              <Change
                key={c.id}
                c={c}
                now={factsText(saved.facts)}
                canUndo={writes && !dirty}
                onUndo={undo}
              />
            ))}
          </ol>
        ) : (
          <p className={cx(QUIET, "text-[14px]")}>
            No saves here yet. Each one shows with who made it.
          </p>
        )}
      </Section>
    </div>
  );
}

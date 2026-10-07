/**
 * A record's edits, drawn from its declaration (designs/2026-10-06-edits-claude-templates.md, 1
 * and 2), never per page: each field it lets a person change edits in place, History lists every
 * change with Undo, and Ask Claude answers with a patch shown as a diff that Accept applies
 * through the same edit path. Every save names the version it started from, so a change made
 * meanwhile is never written over.
 */
import type { AskTurn, ChangeLine, EditState, Values } from "@wren/core/edits";
import type { FieldMeta, RecordMeta } from "@wren/core/records";
import { cn } from "cn";
import { Pencil } from "lucide-react";
import { type KeyboardEvent, type ReactNode, useEffect, useId, useRef, useState } from "react";
import { toast } from "sonner";
import { UNDO_MS } from "./action.js";
import { Input } from "./components/ui/input.js";
import { Textarea } from "./components/ui/textarea.js";
import { Button, Tag } from "./controls.js";
import { DictateField } from "./dictate.js";
import { InsertSnippet } from "./snippets.js";

/** What a record's page does with its edits; each throws what the server refused. */
export interface Editing {
  /** Save a patch over the values the page read; the change's id, null when nothing changed. */
  save(patch: Values, run?: string): Promise<number | null>;
  undo(change: number): Promise<void>;
  ask(message: string): Promise<void>;
}

const when = (at: string) =>
  new Date(at).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

/** A value as words: a list joined, a state by its label, anything else as JSON; empty is "". */
export function valueText(v: unknown, field?: FieldMeta): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "string") return field?.states?.[v]?.label ?? v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (Array.isArray(v) && v.every((x) => typeof x === "string")) return v.join(", ");
  return JSON.stringify(v, null, 1);
}

const labelOf = (meta: RecordMeta, key: string) =>
  meta.fields.find((f) => f.key === key)?.label ??
  key.charAt(0).toUpperCase() + key.slice(1).replace(/[A-Z_]/g, (c) => ` ${c.toLowerCase()}`);

/** What an input holds for a value, and the value back from what's typed. */
function inputOf(f: FieldMeta, v: unknown): string {
  if (v === null || v === undefined) return "";
  if (f.kind === "tags" && Array.isArray(v)) return v.join(", ");
  if (f.kind === "date" && typeof v === "string") return v.slice(0, 16);
  return typeof v === "string" ? v : String(v);
}
function typedValue(f: FieldMeta, typed: string): unknown {
  const t = f.kind === "prose" ? typed : typed.trim();
  if (f.kind === "number") return t === "" ? null : Number(t);
  if (f.kind === "tags")
    return t
      .split(",")
      .map((x) => x.trim())
      .filter(Boolean);
  if (f.kind === "date") return t ? new Date(t).toISOString() : null;
  return t;
}

const FIELD =
  "w-full rounded-(--ui-radius) border border-(--ui-hair) bg-(--ui-paper) px-2.5 py-1.5 text-[14px] outline-none focus-visible:border-(--ui-ink-3)";

/** One field, its value until pressed, then its input: Enter (⌘S in long text) saves, Esc doesn't. */
export function EditField({
  field,
  value,
  save,
  children,
}: {
  field: FieldMeta;
  value: unknown;
  save: (v: unknown) => Promise<boolean>;
  /** How the value reads when not editing; its words when left out. */
  children?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState(() => inputOf(field, value));
  const [busy, setBusy] = useState(false);
  const id = useId();
  const area = useRef<HTMLTextAreaElement>(null);
  const long = field.kind === "prose";
  const begin = () => {
    setTyped(inputOf(field, value));
    setOpen(true);
  };
  const commit = async () => {
    if (busy) return;
    const next = typedValue(field, typed);
    if (JSON.stringify(next ?? "") === JSON.stringify(value ?? "")) return void setOpen(false);
    setBusy(true);
    const ok = await save(next);
    setBusy(false);
    if (ok) setOpen(false);
  };
  // The input takes focus as it opens.
  useEffect(() => {
    if (open) document.getElementById(id)?.focus();
  }, [open, id]);
  const keys = (e: KeyboardEvent<HTMLElement>) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      setOpen(false);
    } else if (
      (e.key === "Enter" && !long && !e.nativeEvent.isComposing) ||
      ((e.metaKey || e.ctrlKey) && (e.key === "s" || e.key === "Enter"))
    ) {
      e.preventDefault();
      void commit();
    }
  };

  if (!open)
    return (
      <button
        type="button"
        onClick={begin}
        aria-label={`Edit ${field.label}`}
        className="group/edit -mx-1.5 -my-0.5 flex w-[calc(100%+12px)] min-w-0 items-start gap-2 rounded-(--ui-radius) px-1.5 py-0.5 text-left hover:bg-(--ui-wash) focus-visible:bg-(--ui-wash) focus-visible:outline-none"
      >
        <span
          className={cn(
            "min-w-0 flex-1 break-words",
            long && "text-[14px] leading-[1.65] text-pretty whitespace-pre-line",
          )}
        >
          {children ??
            (valueText(value, field) || <span className="text-(--ui-ink-3)">Empty</span>)}
        </span>
        <Pencil
          aria-hidden
          className="mt-1 size-3.5 shrink-0 text-(--ui-ink-3) opacity-0 group-hover/edit:opacity-100 group-focus-visible/edit:opacity-100 max-sm:opacity-100"
        />
      </button>
    );

  return (
    <div className="grid min-w-0 gap-2">
      {long ? (
        <DictateField target={area}>
          <Textarea
            ref={area}
            id={id}
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            onKeyDown={keys}
            rows={6}
            aria-label={field.label}
            className="min-h-28 text-[14px] leading-[1.6]"
          />
        </DictateField>
      ) : field.kind === "status" ? (
        <select
          id={id}
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          onKeyDown={keys}
          aria-label={field.label}
          className={FIELD}
        >
          {Object.entries(field.states ?? {}).map(([k, s]) => (
            <option key={k} value={k}>
              {s.label}
            </option>
          ))}
        </select>
      ) : (
        <Input
          id={id}
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          onKeyDown={keys}
          aria-label={field.label}
          type={
            field.kind === "number"
              ? "number"
              : field.kind === "date"
                ? "datetime-local"
                : field.kind === "link"
                  ? "url"
                  : "text"
          }
          placeholder={field.kind === "tags" ? "Comma between each" : undefined}
        />
      )}
      <div className="flex items-center gap-2">
        <Button size="dense" busy={busy} onClick={() => void commit()}>
          Save
        </Button>
        <Button size="dense" tone="quiet" disabled={busy} onClick={() => setOpen(false)}>
          Cancel
        </Button>
        {long ? <InsertSnippet box={area} value={typed} onChange={setTyped} /> : null}
        <span className="text-[12px] text-(--ui-ink-3) max-sm:hidden">
          {long ? "⌘S saves · Esc cancels" : "Enter saves · Esc cancels"}
        </span>
      </div>
    </div>
  );
}

const DL = "grid grid-cols-[minmax(0,140px)_minmax(0,1fr)] gap-x-4 text-[14px]";

/** The fields a person changes here, each in place; long text as its own section. */
export function EditFields({
  meta,
  state,
  editing,
  read,
}: {
  meta: RecordMeta;
  state: EditState;
  editing: Editing;
  /** A field's value as the page draws it (a state as its tag); its words when it gives none. */
  read?: (field: FieldMeta) => ReactNode;
}) {
  const fields = (meta.edits ?? []).flatMap((k) => meta.fields.filter((f) => f.key === k));
  const saveOf = (f: FieldMeta) => async (v: unknown) => {
    try {
      const change = await editing.save({ [f.key]: v });
      if (change !== null)
        toast.success(`${f.label} saved`, {
          duration: UNDO_MS,
          action: {
            label: "Undo",
            onClick: () =>
              void editing.undo(change).then(
                () => toast.success("Undone"),
                (err: unknown) => toast.error(err instanceof Error ? err.message : String(err)),
              ),
          },
        });
      return true;
    } catch (err) {
      toast.error(
        `${err instanceof Error ? err.message : String(err)}. What you typed is still there.`,
      );
      return false;
    }
  };
  const short = fields.filter((f) => f.kind !== "prose");
  return (
    <>
      {fields
        .filter((f) => f.kind === "prose")
        .map((f) => (
          <section key={f.key} className="grid gap-1.5">
            <h3 className="text-[13px] font-medium text-(--ui-ink-2)">{f.label}</h3>
            <EditField field={f} value={state.values[f.key]} save={saveOf(f)} />
          </section>
        ))}
      {short.length ? (
        <dl className={DL}>
          {short.map((f) => (
            <div key={f.key} className="contents">
              <dt className="border-b border-(--ui-hair) py-2.5 text-[13px] text-(--ui-ink-2)">
                {f.label}
              </dt>
              <dd className="min-w-0 border-b border-(--ui-hair) py-2">
                <EditField field={f} value={state.values[f.key]} save={saveOf(f)}>
                  {read?.(f)}
                </EditField>
              </dd>
            </div>
          ))}
        </dl>
      ) : null}
    </>
  );
}

type Piece = { text: string; kind: "same" | "gone" | "new" };
/** Past this many words a side, the diff shows before and after whole. */
const DIFF_WORDS = 1500;

/** Words and spaces kept or changed, by their longest common run. */
export function wordDiff(a: string, b: string): Piece[] | null {
  // Each word keeps the space after it, so a swapped word reads "old new", not "oldnew".
  const words = (t: string) => t.match(/\S+\s*|\s+/g) ?? [];
  const x = words(a);
  const y = words(b);
  if (x.length > DIFF_WORDS || y.length > DIFF_WORDS) return null;
  const w = y.length + 1;
  const lcs = new Uint16Array((x.length + 1) * w);
  for (let i = x.length - 1; i >= 0; i--)
    for (let j = y.length - 1; j >= 0; j--)
      lcs[i * w + j] =
        x[i] === y[j]
          ? (lcs[(i + 1) * w + j + 1] ?? 0) + 1
          : Math.max(lcs[(i + 1) * w + j] ?? 0, lcs[i * w + j + 1] ?? 0);
  const out: Piece[] = [];
  const push = (text: string, kind: Piece["kind"]) => {
    const last = out.at(-1);
    if (last?.kind === kind) last.text += text;
    else out.push({ text, kind });
  };
  let i = 0;
  let j = 0;
  while (i < x.length && j < y.length) {
    if (x[i] === y[j]) {
      push(x[i] as string, "same");
      i++;
      j++;
    } else if ((lcs[(i + 1) * w + j] ?? 0) >= (lcs[i * w + j + 1] ?? 0))
      push(x[i++] as string, "gone");
    else push(y[j++] as string, "new");
  }
  while (i < x.length) push(x[i++] as string, "gone");
  while (j < y.length) push(y[j++] as string, "new");
  return out;
}

const GONE = "bg-(--ui-bad)/12 text-(--ui-bad) line-through decoration-(--ui-bad)/60";
const NEW = "bg-(--ui-good)/14 text-(--ui-ink)";

/** One field's before and after: words marked in place, anything else side by side. */
export function Diff({
  before,
  after,
  field,
}: {
  before: unknown;
  after: unknown;
  field?: FieldMeta | undefined;
}) {
  const a = valueText(before, field);
  const b = valueText(after, field);
  const pieces = typeof before === "string" || typeof after === "string" ? wordDiff(a, b) : null;
  if (pieces)
    return (
      <p className="text-[14px] leading-[1.65] whitespace-pre-wrap break-words">
        {pieces.map((p, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: pieces are a fixed list per render.
          <span key={i} className={p.kind === "gone" ? GONE : p.kind === "new" ? NEW : undefined}>
            {p.text}
          </span>
        ))}
      </p>
    );
  return (
    <div className="grid gap-1 text-[14px] break-words">
      <p className={cn("w-fit px-1 whitespace-pre-wrap", a ? GONE : "text-(--ui-ink-3)")}>
        {a || "Empty"}
      </p>
      <p className={cn("w-fit px-1 whitespace-pre-wrap", b ? NEW : "text-(--ui-ink-3)")}>
        {b || "Empty"}
      </p>
    </div>
  );
}

function Diffs({ meta, before, after }: { meta: RecordMeta; before: Values; after: Values }) {
  const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])];
  return (
    <div className="grid gap-2">
      {keys.map((k) => (
        <div key={k} className="grid gap-0.5">
          {keys.length > 1 || !meta.edits?.includes(k) ? (
            <span className="text-[12px] text-(--ui-ink-3)">{labelOf(meta, k)}</span>
          ) : null}
          <Diff before={before[k]} after={after[k]} field={meta.fields.find((f) => f.key === k)} />
        </div>
      ))}
    </div>
  );
}

const who = (meta: RecordMeta, c: ChangeLine) =>
  c.undoes !== null
    ? `${c.by} undid a change`
    : c.via === "claude"
      ? `Claude's change, accepted by ${c.by}`
      : `${c.by} changed ${Object.keys(c.after)
          .map((k) => labelOf(meta, k).toLowerCase())
          .join(", ")}`;

/** Every change, newest first, with Undo on each one not undone. */
/** What the change set is still there, so Undo puts its before back over nothing newer. */
const stands = (c: ChangeLine, values: Values) =>
  Object.entries(c.after).every(
    ([k, v]) => JSON.stringify(values[k] ?? null) === JSON.stringify(v ?? null),
  );

export function History({
  meta,
  lines,
  values,
  editing,
}: {
  meta: RecordMeta;
  lines: readonly ChangeLine[];
  /** The values now: a change undoes only while what it set still stands. */
  values: Values;
  editing: Editing | null;
}) {
  const [busy, setBusy] = useState<number | null>(null);
  if (!lines.length)
    return (
      <p className="py-6 text-[14px] text-(--ui-ink-2)">
        Every change to this {meta.name.one} shows here, with who made it and Undo.
      </p>
    );
  const undo = async (id: number) => {
    if (!editing) return;
    setBusy(id);
    try {
      await editing.undo(id);
      toast.success("Undone");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };
  return (
    <ol className="grid list-none gap-0 p-0">
      {lines.map((c) => (
        <li key={c.id} className="grid gap-2 border-b border-(--ui-hair) py-3">
          <div className="flex items-baseline justify-between gap-3">
            <span className="min-w-0 text-[13px] text-(--ui-ink-2)">
              {who(meta, c)} · {when(c.at)}
            </span>
            {c.undone ? (
              <Tag>Undone</Tag>
            ) : editing && stands(c, values) ? (
              <Button
                tone="quiet"
                size="dense"
                busy={busy === c.id}
                disabled={busy !== null}
                onClick={() => void undo(c.id)}
              >
                Undo
              </Button>
            ) : null}
          </div>
          <Diffs meta={meta} before={c.before} after={c.after} />
        </li>
      ))}
    </ol>
  );
}

/** Ask Claude about this record: the turns oldest first, each patch as a diff with Accept. */
export function AskClaude({
  meta,
  turns,
  editing,
}: {
  meta: RecordMeta;
  turns: readonly AskTurn[];
  editing: Editing;
}) {
  const [message, setMessage] = useState("");
  const [asking, setAsking] = useState(false);
  const [accepting, setAccepting] = useState<string | null>(null);
  const box = useRef<HTMLInputElement>(null);
  const shown = [...turns].reverse();
  const askNow = async () => {
    const said = message.trim();
    if (!said || asking) return;
    setAsking(true);
    try {
      await editing.ask(said);
      setMessage("");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setAsking(false);
    }
  };
  const accept = async (t: AskTurn) => {
    if (!t.proposal) return;
    setAccepting(t.run);
    try {
      const change = await editing.save(t.proposal.patch, t.run);
      if (change !== null)
        toast.success("Claude's change saved", {
          duration: UNDO_MS,
          action: {
            label: "Undo",
            onClick: () =>
              void editing.undo(change).then(
                () => toast.success("Undone"),
                (err: unknown) => toast.error(err instanceof Error ? err.message : String(err)),
              ),
          },
        });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setAccepting(null);
    }
  };
  // ⌘K's ask lands here: the box takes focus when the palette names this record.
  useEffect(() => {
    const focus = () => box.current?.focus();
    addEventListener(ASK_FOCUS, focus);
    return () => removeEventListener(ASK_FOCUS, focus);
  }, []);
  return (
    <section className="grid min-w-0 gap-3" aria-label="Ask Claude">
      <h3 className="text-[13px] font-medium text-(--ui-ink-2)">Ask Claude</h3>
      {shown.length ? (
        <ol className="grid list-none gap-4 p-0 text-[14px]">
          {shown.map((t) => (
            <li key={t.run} className="grid min-w-0 gap-1.5">
              <span className="text-[13px] text-(--ui-ink-2)">
                {t.by} asked · {when(t.at)}
              </span>
              <span className="whitespace-pre-wrap break-words">{t.message}</span>
              {t.state === "thinking" ? (
                <span className="animate-pulse text-(--ui-ink-3) motion-reduce:animate-none">
                  Claude is working on it…
                </span>
              ) : null}
              {t.reply ? (
                <span
                  className={cn(
                    "whitespace-pre-wrap break-words",
                    t.state === "failed" ? "text-(--ui-bad)" : "text-(--ui-ink-2)",
                  )}
                >
                  {t.state === "failed" ? t.reply : `Claude: ${t.reply}`}
                </span>
              ) : null}
              {t.accepted !== null ? (
                <span className="text-[13px] text-(--ui-ink-3)">Accepted. It's in History.</span>
              ) : t.proposal ? (
                <div className="grid gap-2 border-l-2 border-(--ui-hair) pl-3">
                  <Diffs
                    meta={meta}
                    before={Object.fromEntries(t.proposal.diff.map((d) => [d.field, d.before]))}
                    after={Object.fromEntries(t.proposal.diff.map((d) => [d.field, d.after]))}
                  />
                  {t.proposal.problem ? (
                    <span className="text-[13px] text-(--ui-bad)">
                      Can't accept: {t.proposal.problem}
                    </span>
                  ) : (
                    <div>
                      <Button
                        size="dense"
                        busy={accepting === t.run}
                        disabled={accepting !== null}
                        onClick={() => void accept(t)}
                      >
                        Accept
                      </Button>
                    </div>
                  )}
                </div>
              ) : null}
            </li>
          ))}
        </ol>
      ) : null}
      <DictateField target={box} line label="Dictate to Claude">
        <Input
          ref={box}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.nativeEvent.isComposing) {
              e.preventDefault();
              void askNow();
            }
          }}
          disabled={asking}
          placeholder="What should change? Or ask a question"
          aria-label="Ask Claude"
          maxLength={2000}
        />
      </DictateField>
    </section>
  );
}

/** ⌘K asked about the open record: its Ask box takes focus. */
export const ASK_FOCUS = "wren:ask-record";

/** Read the record again this often while Claude works on an ask. */
export const ASK_POLL_MS = 4000;
export const thinking = (state: EditState | null | undefined) =>
  !!state?.asks.some((t) => t.state === "thinking");

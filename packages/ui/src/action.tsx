/**
 * A record's actions: `useRun` asks first when the action says to, calls the handler by id, says
 * how it went in a toast, and offers undo.
 */
import { type FormEvent, type ReactNode, useId, useRef, useState } from "react";
import { toast } from "sonner";
import type { Access } from "./access.js";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./components/ui/dialog.js";
import { Input } from "./components/ui/input.js";
import { Toaster } from "./components/ui/sonner.js";
import { Textarea } from "./components/ui/textarea.js";
import { Button } from "./controls.js";
import { type MessageKind, MessagePreview } from "./preview.js";
import { InsertSnippet } from "./snippets.js";

/** A box a form action asks for, required unless `optional`. */
export interface FormField {
  /** Its path in the input: `parent.child` sends `{ parent: { child } }`. */
  field: string;
  label: string;
  /**
   * Left out: a line of text. A file is sent as the `File`; the `Call` puts it up. `lines` and
   * `numbers` are one item per line, `json` any JSON value.
   */
  type?:
    | "long"
    | "date"
    | "number"
    | "url"
    | "file"
    | "switch"
    | "select"
    | "lines"
    | "numbers"
    | "json";
  optional?: true;
  /** A select's choices. */
  options?: readonly string[];
  /** A choice as people read it, by value; the value itself when absent. */
  labels?: Readonly<Record<string, string>>;
  /** Said under the box. */
  hint?: string;
  /** The pattern its value must match, as in HTML. */
  pattern?: string;
  /** Its value until typed over, from the fields before it: a short name from the name. */
  from?: (values: Record<string, string>) => string;
}

/** Something to do. A button, the ⌘K palette and a form all read this one definition. */
export interface Action {
  id: string;
  label: string;
  /** The portal handler it calls: "delivery/approve". */
  handler: string;
  /** The handler's zod schema, for a generated form. */
  input?: unknown;
  requires?: Access;
  /** Asked before it runs. */
  confirm?: string;
  /**
   * A text asked before it runs, into `field` of the input: "why" for a pause, the draft for an
   * approve. It starts from the record's `from` field (else `field`) and goes only when changed,
   * so an untouched draft isn't sent as an edit. E opens it when no action has E for its key.
   * With `preview`, the text shows as it will look on a laptop and a phone while it's typed.
   */
  ask?: {
    field: string;
    label: string;
    from?: string;
    /** Or loaded for the record when the box opens: a line of copy needs its email around it. */
    preview?: MessageKind | ((id: string | number) => Promise<MessageKind | null>);
  };
  /**
   * Makes a record, so it takes no ids and applies to no row. The list shows its button by the
   * title; a press asks for these fields and sends them as the input.
   */
  form?: readonly FormField[];
  /** The form is asked on records instead, and sent with their `{ids}`. */
  each?: true;
  /** The toast after it worked, from the handler's answer. */
  done?: (answer: unknown) => string;
  /**
   * The rest is for a record's action, called as `{ids}`; an answer's `done` ids are the ones
   * it changed. Its shortcut in a list or a queue: "a".
   */
  key?: string;
  /** Offered on a selection. */
  bulk?: true;
  /**
   * The handler that reverses it, on the same ids. Given, the action runs at once with 10 seconds
   * to undo it; without one, it asks first (`confirm`, or its label).
   */
  undo?: string;
  /** The states a record must be in for it to apply: `{ status: ["awaiting"] }`. */
  when?: Readonly<Record<string, readonly string[]>>;
  /** What it sets on a record, so the demo can do it in the browser: `{ status: "approved" }`. */
  sets?: Readonly<Record<string, string>>;
  /**
   * Run from inside the record's detail only (its draft box: save, ask, undo): never a button, a
   * key or a palette line.
   */
  inline?: true;
}

/** Calls a portal handler ("email/pause") with its input; rejects with the refusal's words. */
export type Call = (handler: string, input: Record<string, unknown>) => Promise<unknown>;

/** The input as sent: the asked field only when the text differs from where it started. */
export function inputOf(
  action: Action,
  input: Record<string, unknown>,
  text: string,
): Record<string, unknown> {
  const field = action.ask?.field;
  if (!field) return input;
  const { [field]: start, ...rest } = input;
  const said = text.trim();
  return said && said !== String(start ?? "").trim() ? { ...rest, [field]: said } : rest;
}

/** How long an undo is offered. */
export const UNDO_MS = 10_000;

/** The ids an answer says it changed (`done`), else all that were asked. */
export function doneOf(answer: unknown, ids: readonly (string | number)[]) {
  const done = (answer as { done?: unknown } | null)?.done;
  return Array.isArray(done) ? (done as (string | number)[]) : [...ids];
}

/** Whether a record is in a state `action` applies to. */
export function applies(action: Action, row: Record<string, unknown>): boolean {
  return (
    (!action.form || !!action.each) &&
    Object.entries(action.when ?? {}).every(([k, states]) => states.includes(String(row[k])))
  );
}

/** A form's values: each field as typed, else as its `from` makes it. */
export function valuesOf(form: readonly FormField[], typed: Record<string, string>) {
  const values: Record<string, string> = {};
  for (const f of form)
    if (f.type !== "file") values[f.field] = typed[f.field] ?? f.from?.(values) ?? "";
  return values;
}

/** One box's text as the value it sends; a bad number or JSON throws, naming the box. */
function sentOf(f: FormField, text: string): unknown {
  const bad = (what: string): never => {
    throw new Error(`${f.label}: ${what}`);
  };
  switch (f.type) {
    case "number":
      return Number.isFinite(Number(text)) ? Number(text) : bad("not a number");
    case "switch":
      return text === "true";
    case "lines":
    case "numbers": {
      const items = text
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean);
      if (f.type === "lines") return items;
      return items.map((l) =>
        Number.isFinite(Number(l)) ? Number(l) : bad(`${l} is not a number`),
      );
    }
    case "json":
      try {
        return JSON.parse(text);
      } catch {
        return bad("not JSON");
      }
    default:
      return text;
  }
}

/**
 * A form's values as the input it sends: each box typed (a number, a switch's true or false,
 * lines as a list, parsed JSON), `a.b` nested, and an optional box left empty left out.
 */
export function typedOf(
  form: readonly FormField[],
  values: Record<string, string>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of form) {
    const text = values[f.field] ?? "";
    // An untouched switch is off; left out only when it's optional.
    if (f.type === "file" || (text.trim() === "" && (f.optional || f.type !== "switch"))) continue;
    const path = f.field.split(".");
    const last = path.pop() as string;
    let at = out;
    for (const p of path) {
      at[p] ??= {};
      at = at[p] as Record<string, unknown>;
    }
    at[last] = sentOf(f, text);
  }
  return out;
}

const SELECT =
  "h-8 w-full min-w-0 rounded-lg border border-input bg-transparent px-2 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 md:text-sm";

/** One box of a form: its label, the control its type asks for, its hint. */
export function FormBox({
  f,
  id,
  value,
  onText,
  onFile,
  autoFocus,
}: {
  f: FormField;
  id: string;
  value: string;
  onText: (text: string) => void;
  onFile?: ((file: File | undefined) => void) | undefined;
  autoFocus?: boolean | undefined;
}) {
  const required = !f.optional;
  const box =
    f.type === "switch" ? (
      <input
        id={id}
        type="checkbox"
        role="switch"
        aria-checked={value === "true"}
        checked={value === "true"}
        onChange={(e) => onText(String(e.target.checked))}
      />
    ) : f.type === "select" ? (
      <select
        id={id}
        className={SELECT}
        value={value}
        onChange={(e) => onText(e.target.value)}
        required={required}
      >
        <option value="">{required ? "Pick one" : "Not set"}</option>
        {(f.options ?? []).map((o) => (
          <option key={o} value={o}>
            {f.labels?.[o] ?? o}
          </option>
        ))}
      </select>
    ) : f.type === "long" || f.type === "lines" || f.type === "numbers" || f.type === "json" ? (
      <Textarea
        id={id}
        value={value}
        onChange={(e) => onText(e.target.value)}
        required={required}
        autoFocus={autoFocus}
        rows={4}
        spellCheck={f.type === "long"}
        className={f.type === "json" ? "font-mono" : undefined}
      />
    ) : (
      <Input
        id={id}
        type={f.type ?? "text"}
        {...(f.type === "file"
          ? { onChange: (e) => onFile?.(e.target.files?.[0]) }
          : { value, onChange: (e) => onText(e.target.value) })}
        required={required}
        autoFocus={autoFocus}
        {...(f.type === "number" ? { step: "any" } : {})}
        {...(f.pattern ? { pattern: f.pattern } : {})}
      />
    );
  const hint =
    f.hint ??
    (f.type === "lines" || f.type === "numbers"
      ? "One per line."
      : f.type === "json"
        ? "JSON."
        : undefined);
  return (
    <div className="flex flex-col gap-1.5 text-sm">
      {f.type === "switch" ? (
        <label htmlFor={id} className="flex items-center gap-2">
          {box}
          {f.label}
        </label>
      ) : (
        <>
          <label htmlFor={id}>{f.label}</label>
          {box}
        </>
      )}
      {hint ? <p className="text-(--ui-ink-2)">{hint}</p> : null}
    </div>
  );
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * Runs a record's actions on ids: one with `undo` at once, with an undo toast for 10 seconds;
 * any other asks first. One that `ask`s always asks, its text starting from `start` (an edit's
 * current value). `after` runs once each call settles, with the ids it changed, so the page
 * reads again and can show what moved. `running` is the action at work and its ids, for its
 * button.
 */
export function useRun(
  call: Call,
  after: (changed: (string | number)[]) => void,
  names: { one: string; many: string },
): {
  run: (action: Action, ids: (string | number)[], start?: string) => void;
  busy: boolean;
  running: { action: string; ids: (string | number)[] } | null;
  dialog: ReactNode;
} {
  const [asked, setAsked] = useState<{
    action: Action;
    ids: (string | number)[];
    start: string;
  } | null>(null);
  const [text, setText] = useState("");
  const [typed, setTyped] = useState<Record<string, string>>({});
  const [files, setFiles] = useState<Record<string, File>>({});
  const [running, setRunning] = useState<{ action: string; ids: (string | number)[] } | null>(null);
  const [shown, setShown] = useState<MessageKind | null>(null);
  const opened = useRef(0);
  const busy = running !== null;
  const textId = useId();
  const textBox = useRef<HTMLTextAreaElement>(null);

  // A form stays open until it works, so a refusal doesn't lose what was typed.
  const go = async (action: Action, ids: (string | number)[], input: Record<string, unknown>) => {
    if (!action.form) setAsked(null);
    setRunning({ action: action.id, ids });
    let changed: (string | number)[] = [];
    try {
      const answer = await call(action.handler, input);
      setAsked(null);
      const line = action.done?.(answer) ?? `${action.label}: done`;
      const undo = action.undo;
      const done = doneOf(answer, ids);
      changed = done;
      if (!undo || !done.length) toast.success(line);
      else
        toast.success(line, {
          duration: UNDO_MS,
          action: {
            label: "Undo",
            onClick: () =>
              void call(undo, { ids: done }).then(
                (back) => {
                  const undone = doneOf(back, []);
                  if (undone.length) toast.success("Undone");
                  else toast.error("Too late to undo.");
                  after(undone);
                },
                (err: unknown) => toast.error(err instanceof Error ? err.message : String(err)),
              ),
          },
        });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setRunning(null);
      after(changed);
    }
  };
  const run = (action: Action, ids: (string | number)[], start = "") => {
    if ((!ids.length && (!action.form || action.each)) || busy) return;
    if (action.undo && !action.ask && !action.form) return void go(action, ids, { ids });
    setText(start);
    setTyped({});
    setFiles({});
    setAsked({ action, ids, start });
    const preview = action.ask?.preview;
    const mine = ++opened.current;
    setShown(typeof preview === "function" ? null : (preview ?? null));
    if (typeof preview === "function" && ids[0] !== undefined)
      void preview(ids[0]).then(
        (kind) => mine === opened.current && setShown(kind),
        () => undefined,
      );
  };
  const ask = asked?.action.ask;
  const form = asked?.action.form;
  const values = form ? valuesOf(form, typed) : {};
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!asked) return;
    const { action, ids, start } = asked;
    let input: Record<string, unknown>;
    try {
      input = form
        ? { ...(action.each ? { ids } : {}), ...typedOf(form, values), ...files }
        : ask
          ? inputOf(action, { ids, [ask.field]: start }, text)
          : { ids };
    } catch (err) {
      return void toast.error(err instanceof Error ? err.message : String(err));
    }
    void go(action, ids, input);
  };

  const n = asked?.ids.length ?? 0;
  const dialog = (
    <Dialog open={!!asked} onOpenChange={(open) => !open && setAsked(null)}>
      <DialogContent
        className={
          ask?.preview ? "max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-3xl" : undefined
        }
      >
        <form onSubmit={submit} className="grid min-w-0 gap-4">
          <DialogHeader>
            <DialogTitle>
              {asked?.action.confirm ??
                (form
                  ? asked?.action.label
                  : `${asked?.action.label} ${plural(n, names.one, names.many)}?`)}
            </DialogTitle>
          </DialogHeader>
          {n > 1 ? (
            <p className="text-sm text-(--ui-ink-2)">{plural(n, names.one, names.many)}.</p>
          ) : null}
          {ask ? (
            <div className="flex flex-col gap-1.5 text-sm">
              <div className="flex items-center justify-between gap-2">
                <label htmlFor={textId}>{ask.label}</label>
                <InsertSnippet
                  box={textBox}
                  value={text}
                  onChange={setText}
                  channel={shown?.kind}
                />
              </div>
              <Textarea
                ref={textBox}
                id={textId}
                value={text}
                onChange={(e) => setText(e.target.value)}
                rows={6}
              />
              {shown && text.trim() ? <MessagePreview message={shown} body={text} /> : null}
            </div>
          ) : null}
          {form?.map((f, i) => (
            <FormBox
              key={f.field}
              f={f}
              id={`${textId}-${f.field}`}
              value={values[f.field] ?? ""}
              onText={(text) => setTyped((t) => ({ ...t, [f.field]: text }))}
              onFile={(file) =>
                setFiles(({ [f.field]: _, ...rest }) =>
                  file ? { ...rest, [f.field]: file } : rest,
                )
              }
              autoFocus={i === 0}
            />
          ))}
          <DialogFooter>
            <Button tone="quiet" size="dense" onClick={() => setAsked(null)}>
              Cancel
            </Button>
            <Button size="dense" type="submit" busy={busy}>
              {asked?.action.label}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
  return { run, busy, running, dialog };
}

/** The one place toasts show; an app mounts it once. */
/** A line at the bottom of the screen after a hand-drawn page's write: done, or why not. */
export const say = {
  done: (line: string) => void toast.success(line),
  failed: (err: unknown) => void toast.error(err instanceof Error ? err.message : String(err)),
};

export function Toasts() {
  return <Toaster position="bottom-center" />;
}

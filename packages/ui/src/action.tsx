/**
 * A record's actions: `useRun` asks first when the action says to, calls the handler by id, says
 * how it went in a toast, and offers undo.
 */
import { type FormEvent, type ReactNode, useId, useState } from "react";
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

/** A box a form action asks for, required unless `optional`. */
export interface FormField {
  field: string;
  label: string;
  /** Left out: a line of text. A file is sent as the `File`; the `Call` puts it up. */
  type?: "long" | "date" | "number" | "url" | "file";
  optional?: true;
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
   */
  ask?: { field: string; label: string; from?: string };
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

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * Runs a record's actions on ids: one with `undo` at once, with an undo toast for 10 seconds;
 * any other asks first. One that `ask`s always asks, its text starting from `start` (an edit's
 * current value). `after` runs once each call settles, so the page reads again.
 */
export function useRun(
  call: Call,
  after: () => void,
  names: { one: string; many: string },
): {
  run: (action: Action, ids: (string | number)[], start?: string) => void;
  busy: boolean;
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
  const [busy, setBusy] = useState(false);
  const textId = useId();

  // A form stays open until it works, so a refusal doesn't lose what was typed.
  const go = async (action: Action, ids: (string | number)[], input: Record<string, unknown>) => {
    if (!action.form) setAsked(null);
    setBusy(true);
    try {
      const answer = await call(action.handler, input);
      setAsked(null);
      const line = action.done?.(answer) ?? `${action.label}: done`;
      const undo = action.undo;
      const done = doneOf(answer, ids);
      if (!undo || !done.length) toast.success(line);
      else
        toast.success(line, {
          duration: UNDO_MS,
          action: {
            label: "Undo",
            onClick: () =>
              void call(undo, { ids: done }).then(
                (back) => {
                  if (doneOf(back, []).length) toast.success("Undone");
                  else toast.error("Too late to undo.");
                  after();
                },
                (err: unknown) => toast.error(err instanceof Error ? err.message : String(err)),
              ),
          },
        });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
      after();
    }
  };
  const run = (action: Action, ids: (string | number)[], start = "") => {
    if ((!ids.length && (!action.form || action.each)) || busy) return;
    if (action.undo && !action.ask && !action.form) return void go(action, ids, { ids });
    setText(start);
    setTyped({});
    setFiles({});
    setAsked({ action, ids, start });
  };
  const ask = asked?.action.ask;
  const form = asked?.action.form;
  const values = form ? valuesOf(form, typed) : {};
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!asked) return;
    const { action, ids, start } = asked;
    const input = form
      ? { ...(action.each ? { ids } : {}), ...values, ...files }
      : ask
        ? inputOf(action, { ids, [ask.field]: start }, text)
        : { ids };
    void go(action, ids, input);
  };

  const n = asked?.ids.length ?? 0;
  const dialog = (
    <Dialog open={!!asked} onOpenChange={(open) => !open && setAsked(null)}>
      <DialogContent>
        <form onSubmit={submit} className="grid gap-4">
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
              <label htmlFor={textId}>{ask.label}</label>
              <Textarea
                id={textId}
                value={text}
                onChange={(e) => setText(e.target.value)}
                rows={6}
              />
            </div>
          ) : null}
          {form?.map((f, i) => (
            <div key={f.field} className="flex flex-col gap-1.5 text-sm">
              <label htmlFor={`${textId}-${f.field}`}>{f.label}</label>
              {f.type === "long" ? (
                <Textarea
                  id={`${textId}-${f.field}`}
                  value={values[f.field] ?? ""}
                  onChange={(e) => setTyped((t) => ({ ...t, [f.field]: e.target.value }))}
                  required={!f.optional}
                  autoFocus={i === 0}
                  rows={4}
                />
              ) : (
                <Input
                  id={`${textId}-${f.field}`}
                  type={f.type ?? "text"}
                  {...(f.type === "file"
                    ? {
                        onChange: (e) => {
                          const file = e.target.files?.[0];
                          setFiles(({ [f.field]: _, ...rest }) =>
                            file ? { ...rest, [f.field]: file } : rest,
                          );
                        },
                      }
                    : {
                        value: values[f.field] ?? "",
                        onChange: (e) => setTyped((t) => ({ ...t, [f.field]: e.target.value })),
                      })}
                  required={!f.optional}
                  autoFocus={i === 0}
                  {...(f.type === "number" ? { step: "any" } : {})}
                  {...(f.pattern ? { pattern: f.pattern } : {})}
                />
              )}
              {f.hint ? <p className="text-(--ui-ink-2)">{f.hint}</p> : null}
            </div>
          ))}
          <DialogFooter>
            <Button tone="quiet" size="dense" onClick={() => setAsked(null)}>
              Cancel
            </Button>
            <Button size="dense" type="submit" disabled={busy}>
              {asked?.action.label}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
  return { run, busy, dialog };
}

/** The one place toasts show; an app mounts it once. */
export function Toasts() {
  return <Toaster position="bottom-center" />;
}

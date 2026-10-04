/**
 * A record's actions: `useRun` asks first when the action says to, calls the handler by id, says
 * how it went in a toast, and offers undo.
 */
import { type ReactNode, useId, useState } from "react";
import { toast } from "sonner";
import type { Access } from "./access.js";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./components/ui/dialog.js";
import { Toaster } from "./components/ui/sonner.js";
import { Textarea } from "./components/ui/textarea.js";
import { Button } from "./controls.js";

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
  return Object.entries(action.when ?? {}).every(([k, states]) => states.includes(String(row[k])));
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
  const [busy, setBusy] = useState(false);
  const textId = useId();

  const go = async (action: Action, ids: (string | number)[], said?: string) => {
    setAsked(null);
    setBusy(true);
    try {
      const field = action.ask?.field;
      const input =
        field && said !== undefined
          ? inputOf(action, { ids, [field]: asked?.start ?? "" }, said)
          : { ids };
      const answer = await call(action.handler, input);
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
    if (!ids.length || busy) return;
    if (action.undo && !action.ask) return void go(action, ids);
    setText(start);
    setAsked({ action, ids, start });
  };
  const ask = asked?.action.ask;

  const n = asked?.ids.length ?? 0;
  const dialog = (
    <Dialog open={!!asked} onOpenChange={(open) => !open && setAsked(null)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {asked?.action.confirm ?? `${asked?.action.label} ${plural(n, names.one, names.many)}?`}
          </DialogTitle>
        </DialogHeader>
        {n > 1 ? (
          <p className="text-sm text-(--ui-ink-2)">{plural(n, names.one, names.many)}.</p>
        ) : null}
        {ask ? (
          <div className="flex flex-col gap-1.5 text-sm">
            <label htmlFor={textId}>{ask.label}</label>
            <Textarea id={textId} value={text} onChange={(e) => setText(e.target.value)} rows={6} />
          </div>
        ) : null}
        <DialogFooter>
          <Button tone="quiet" size="dense" onClick={() => setAsked(null)}>
            Cancel
          </Button>
          <Button
            size="dense"
            onClick={() => asked && void go(asked.action, asked.ids, ask ? text : undefined)}
          >
            {asked?.action.label}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
  return { run, busy, dialog };
}

/** The one place toasts show; an app mounts it once. */
export function Toasts() {
  return <Toaster position="bottom-center" />;
}

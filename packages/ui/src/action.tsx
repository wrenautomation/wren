/**
 * An `Action` as a button: it asks first when the action says to, calls the handler, says how
 * it went in a toast, then lets its widget read again so the row shows the change. `useRun` does
 * the same for a record's actions, by id, with undo.
 */
import { type ReactNode, useId, useState } from "react";
import { toast } from "sonner";
import { can, type Viewer } from "./access.js";
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
import type { Action } from "./page.js";

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

export function ActionButton({
  action,
  input = {},
  viewer,
  call,
  after,
  size = "sm",
}: {
  size?: "sm" | "dense";
  action: Action;
  input?: Record<string, unknown> | undefined;
  viewer: Viewer;
  call: Call;
  /** Runs once the call settles, worked or not: the widget reads again. */
  after?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [text, setText] = useState("");
  const textId = useId();
  if (!can(viewer, action.requires)) return null;
  const field = action.ask?.field;

  const run = async () => {
    setOpen(false);
    setBusy(true);
    try {
      const answer = await call(action.handler, inputOf(action, input, text));
      toast.success(action.done?.(answer) ?? `${action.label}: done`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
      after?.();
    }
  };
  const press = () => {
    if (!action.confirm && !action.ask) return void run();
    setText(field ? String(input[field] ?? "") : "");
    setOpen(true);
  };

  return (
    <>
      <Button tone="secondary" size={size} disabled={busy} onClick={press}>
        {action.label}
      </Button>
      {action.confirm || action.ask ? (
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{action.confirm ?? action.label}</DialogTitle>
            </DialogHeader>
            {action.ask ? (
              <div className="flex flex-col gap-1.5 text-sm">
                <label htmlFor={textId}>{action.ask.label}</label>
                <Textarea
                  id={textId}
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  rows={6}
                />
              </div>
            ) : null}
            <DialogFooter>
              <Button tone="quiet" size="sm" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button size="sm" onClick={() => void run()}>
                {action.label}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}
    </>
  );
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
 * any other asks first. `after` runs once each call settles, so the page reads again.
 */
export function useRun(
  call: Call,
  after: () => void,
  names: { one: string; many: string },
): { run: (action: Action, ids: (string | number)[]) => void; busy: boolean; dialog: ReactNode } {
  const [asked, setAsked] = useState<{ action: Action; ids: (string | number)[] } | null>(null);
  const [busy, setBusy] = useState(false);

  const go = async (action: Action, ids: (string | number)[]) => {
    setAsked(null);
    setBusy(true);
    try {
      const answer = await call(action.handler, { ids });
      const said = action.done?.(answer) ?? `${action.label}: done`;
      const undo = action.undo;
      const done = doneOf(answer, ids);
      if (!undo || !done.length) toast.success(said);
      else
        toast.success(said, {
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
  const run = (action: Action, ids: (string | number)[]) => {
    if (!ids.length || busy) return;
    if (action.undo) void go(action, ids);
    else setAsked({ action, ids });
  };

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
        <DialogFooter>
          <Button tone="quiet" size="sm" onClick={() => setAsked(null)}>
            Cancel
          </Button>
          <Button size="sm" onClick={() => asked && void go(asked.action, asked.ids)}>
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

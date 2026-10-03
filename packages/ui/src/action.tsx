/**
 * An `Action` as a button: it asks first when the action says to, calls the handler, says how
 * it went in a toast, then lets its widget read again so the row shows the change.
 */
import { useId, useState } from "react";
import { toast } from "sonner";
import { can, type Viewer } from "./access.js";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./components/ui/dialog.js";
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
}: {
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
      <Button tone="secondary" size="sm" disabled={busy} onClick={press}>
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

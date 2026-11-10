/**
 * Ask first, in the app's own dialog (never `window.confirm`): `const [confirm, dialog] =
 * useConfirm()`; render `dialog`; `if (await confirm("Remove x?", { go: "Remove" })) …`.
 */
import { type ReactNode, useCallback, useRef, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./components/ui/dialog.js";
import { Button } from "./controls.js";

interface Asked {
  question: string;
  /** A line under the question: what happens after. */
  detail?: string;
  /** The yes button's word. Default "Continue". */
  go?: string;
}

export function useConfirm(): [
  (question: string, o?: Omit<Asked, "question">) => Promise<boolean>,
  ReactNode,
] {
  const [asked, setAsked] = useState<Asked | null>(null);
  const answer = useRef<((yes: boolean) => void) | null>(null);
  const settle = (yes: boolean) => {
    answer.current?.(yes);
    answer.current = null;
    setAsked(null);
  };
  const confirm = useCallback(
    (question: string, o: Omit<Asked, "question"> = {}) =>
      new Promise<boolean>((resolve) => {
        answer.current?.(false); // a second ask drops the first
        answer.current = resolve;
        setAsked({ question, ...o });
      }),
    [],
  );
  const dialog = (
    <Dialog open={!!asked} onOpenChange={(open) => !open && settle(false)}>
      <DialogContent>
        <div
          // the detail is the body; none: head straight onto the foot, one rule
          className={asked?.detail ? "grid gap-3.5" : "grid"}
        >
          <DialogHeader className={asked?.detail ? undefined : "border-b-0"}>
            <DialogTitle>{asked?.question}</DialogTitle>
          </DialogHeader>
          {asked?.detail ? <DialogDescription>{asked.detail}</DialogDescription> : null}
          <DialogFooter>
            {/* focus on the safe answer: Enter never removes by accident */}
            <Button tone="quiet" size="dense" onClick={() => settle(false)} autoFocus>
              Cancel
            </Button>
            <Button tone="primary" size="dense" onClick={() => settle(true)}>
              {asked?.go ?? "Continue"}
            </Button>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
  return [confirm, dialog];
}

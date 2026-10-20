/**
 * The two parts of edit mode that belong to server drafts: the banner over the canvas while one
 * is open (its name, the version it started from, who made it, Close), and the dialog that saves
 * the device's edits as a new draft instead of a version. Both sit beside `Draft.tsx`'s bar.
 */
import type { DraftRow } from "@wren/pipeline/history";
import { Alert, Button, FormKept, TextField, useEditForm } from "@wren/ui";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@wren/ui/components/ui/dialog";
import { useState } from "react";
import { call } from "../api.js";
import { cleanMoves, type Draft, textOf } from "./edit.js";

const BANNER =
  "absolute top-3 left-1/2 z-20 flex max-w-[calc(100%-24px)] -translate-x-1/2 flex-wrap items-center gap-x-3 gap-y-2 rounded-[14px] border border-(--ui-hair) bg-(--ui-paper) px-3 py-2 text-[13.5px] text-(--ui-ink) shadow-(--ui-shadow)";

/**
 * Shows which draft is open. Close goes back to the live shape; edits not yet saved stay on this
 * device under the draft's own key, so Close asks first when there are some.
 */
export function DraftBanner({
  row,
  unsaved,
  onClose,
}: {
  row: DraftRow;
  /** Edits on this device that no draft holds. */
  unsaved: boolean;
  onClose: () => void;
}) {
  const [sure, setSure] = useState(false);
  return (
    <div role="status" aria-label="Open draft" className={BANNER}>
      <span className="font-semibold">{row.name}</span>
      <span className="text-(--ui-ink-2)">
        from version {row.base} · {row.createdBy}
      </span>
      {sure ? (
        <>
          <span className="text-(--ui-ink-2)">Your edits stay on this device.</span>
          <Button tone="secondary" size="dense" onClick={onClose}>
            Close the draft
          </Button>
          <Button tone="quiet" size="dense" onClick={() => setSure(false)}>
            Stay
          </Button>
        </>
      ) : (
        <Button
          tone="quiet"
          size="dense"
          icon="close"
          onClick={() => (unsaved ? setSure(true) : onClose())}
        >
          Close
        </Button>
      )}
    </div>
  );
}

/**
 * Asks for a name (and a note if it helps), then saves the device's edits as a new draft that
 * starts from the newest version. A refusal shows the server's sentence and keeps the edits.
 */
export function SaveAsDraftDialog({
  client,
  at,
  draft,
  base,
  open,
  onOpenChange,
  onSaved,
}: {
  client: string;
  /** The workspace as a call's params. */
  at: Record<string, string>;
  draft: Draft;
  /** The newest version: where the new draft starts. */
  base: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The draft was saved: its id, and the text of the edits that went. */
  onSaved: (id: string, sent: string) => void;
}) {
  const form = useEditForm({ key: `map:draftnew:${client}`, defaults: { name: "", note: "" } });
  const save = form.onSend(
    async (v) => {
      const note = v.note.trim();
      const got = await call<{ id: string; base: number }>("pipeline/shapeDraftNew", {
        ...at,
        name: v.name.trim(),
        body: draft.body,
        moves: cleanMoves(draft.body, draft.moves),
        base,
        ...(note ? { note } : {}),
      });
      onSaved(got.id, textOf(draft));
    },
    { clear: true },
  );
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Save as draft</DialogTitle>
          <DialogDescription>
            A draft keeps your edits apart from the live shape. It starts from version {base}.
          </DialogDescription>
        </DialogHeader>
        <form className="flex flex-col gap-3" onSubmit={(e) => void save(e)}>
          <TextField
            form={form}
            name="name"
            autoFocus
            maxLength={80}
            aria-label="Draft name"
            placeholder="Draft name"
          />
          <TextField
            form={form}
            name="note"
            maxLength={200}
            aria-label="Draft note"
            placeholder="Note (optional)"
          />
          <FormKept form={form} />
          {form.error ? <Alert className="mb-0">{form.error}</Alert> : null}
          <div className="flex justify-end gap-2">
            <Button tone="quiet" size="dense" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button
              tone="primary"
              size="dense"
              type="submit"
              busy={form.formState.isSubmitting}
              disabled={!form.watch("name").trim()}
            >
              Save draft
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

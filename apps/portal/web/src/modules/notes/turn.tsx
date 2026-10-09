/**
 * Turn rough into real (designs/2026-10-07-notes.md): the selected words, or the whole note, as
 * drafts in the workspace's Marketing or as a source of one of its SOPs. Tasks wait: there are none.
 */
import type { Editor } from "@tiptap/core";
import { Button, Input, say } from "@wren/ui";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@wren/ui/components/ui/dialog";
import { type FormEvent, useState } from "react";
import { call } from "../../api.js";
import { WREN } from "../../module.js";

/** The selected words, blocks apart; empty when nothing is selected. */
export function selectedWords(editor: Editor | null): string {
  if (!editor) return "";
  const { from, to } = editor.state.selection;
  return from === to ? "" : editor.state.doc.textBetween(from, to, "\n\n").trim();
}

const inWs = (client: string, body: Record<string, unknown>) =>
  client === WREN.id ? body : { client, ...body };

/** Drafts from the words, one per platform the workspace posts on. */
export function makeDrafts(client: string, id: string, text: string): void {
  call("notes/toDraft", inWs(client, { id, ...(text ? { text } : {}) }))
    .then(() =>
      say.done(
        text
          ? "Drafting from your selection. The drafts wait in Marketing → To approve."
          : "Drafting from this note. The drafts wait in Marketing → To approve.",
      ),
    )
    .catch(say.failed);
}

/** Name the SOP; the words go in. */
export function SopDialog({
  client,
  id,
  text,
  onClose,
}: {
  client: string;
  id: string;
  /** The selection; empty sends the whole note. */
  text: string;
  onClose: () => void;
}) {
  const wren = client === WREN.id;
  const [sop, setSop] = useState("");
  const [busy, setBusy] = useState(false);
  const ok = /^[a-z0-9][a-z0-9-]*$/.test(sop.trim());
  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (!ok) return;
    setBusy(true);
    try {
      await call("notes/toSop", inWs(client, { id, sop: sop.trim(), ...(text ? { text } : {}) }));
      say.done(
        wren
          ? `Asked. The Mac adds it to ${sop.trim()} on its next read.`
          : `Added to ${sop.trim()} in your Notes.`,
      );
      onClose();
    } catch (err) {
      say.failed(err);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open onOpenChange={(o) => (o ? null : onClose())}>
      <DialogContent className="gap-3 sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {text ? "Add the selection to an SOP" : "Add this note to an SOP"}
          </DialogTitle>
          <DialogDescription>
            {wren
              ? "The SOP's folder name, such as email-infra. The Mac writes it into the SOP's sources; build it from there."
              : "The SOP's name, such as onboarding. It goes into your Notes under it."}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={save} className="flex flex-col gap-3">
          <Input
            autoFocus
            value={sop}
            onChange={(e) => setSop(e.target.value.toLowerCase())}
            placeholder={wren ? "email-infra" : "onboarding"}
            aria-label="SOP name"
          />
          <div className="flex justify-end gap-2">
            <Button size="dense" tone="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button size="dense" type="submit" busy={busy} disabled={!ok}>
              Add to SOP
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

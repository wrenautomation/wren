/**
 * Quick capture: N on any page (or ⌘K "Note: …") puts a thought down without leaving. It goes at
 * the end of the person's Dump note, timestamped, or opens as a note of its own. The mic types it.
 */
import { Button, DictateField, say, Textarea } from "@wren/ui";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@wren/ui/components/ui/dialog";
import { useEffect, useRef, useState } from "react";
import { navigate } from "../../route.js";
import { docPath, notes } from "./api.js";

/** Capture `words` in `client`'s Dump note, then say where they went. */
export const capture = (client: string, words: string) =>
  notes(client, "capture", { words })
    .then(() => say.done("Added to your Dump note."))
    .catch(say.failed);

export function QuickNote({
  client,
  open,
  onOpenChange,
  onSaved,
}: {
  client: string;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onSaved?: () => void;
}) {
  const [words, setWords] = useState("");
  const [busy, setBusy] = useState<"dump" | "note" | null>(null);
  const box = useRef<HTMLTextAreaElement>(null);
  const save = (asNote: boolean) => {
    if (!words.trim()) return;
    setBusy(asNote ? "note" : "dump");
    notes(client, "capture", { words, open: asNote })
      .then((r) => {
        setWords("");
        onOpenChange(false);
        onSaved?.();
        if (r.dump) say.done("Added to your Dump note.");
        else navigate(docPath(r.id));
      })
      .catch(say.failed)
      .finally(() => setBusy(null));
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Quick note</DialogTitle>
          <DialogDescription>
            It goes at the end of your Dump note, with the time.
          </DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            save(false);
          }}
        >
          <DictateField target={box} label="Dictate the note">
            <Textarea
              ref={box}
              value={words}
              autoFocus
              rows={5}
              aria-label="The note"
              placeholder="Call the venue back about Thursday."
              onChange={(e) => setWords(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault();
                  save(false);
                }
              }}
            />
          </DictateField>
          <div className="flex flex-wrap items-center justify-end gap-2">
            <Button
              tone="secondary"
              size="dense"
              type="button"
              busy={busy === "note"}
              disabled={!words.trim() || busy !== null}
              onClick={() => save(true)}
            >
              Make it a note
            </Button>
            <Button
              size="dense"
              type="submit"
              busy={busy === "dump"}
              disabled={!words.trim() || busy !== null}
            >
              Add to Dump
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** N opens Quick note, outside a field and with no modifier; `on` is false where notes can't be written. */
export function useQuickNoteKey(on: boolean) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!on) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (
        e.key.toLowerCase() !== "n" ||
        e.metaKey ||
        e.ctrlKey ||
        e.altKey ||
        e.repeat ||
        t?.closest("input, textarea, select, [contenteditable], [role=dialog]")
      )
        return;
      e.preventDefault();
      setOpen(true);
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, [on]);
  return [open, setOpen] as const;
}

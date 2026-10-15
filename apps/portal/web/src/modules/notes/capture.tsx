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

/** A card on the Work board, from a title. */
export const makeCard = (client: string, title: string) =>
  notes(client, "taskAdd", { title })
    .then(() => say.done("Card added to the Work board."))
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
  // The "Card" switch: the words become a card on the Work board instead.
  const [asCard, setAsCard] = useState(false);
  const box = useRef<HTMLTextAreaElement>(null);
  const save = (asNote: boolean) => {
    if (!words.trim()) return;
    setBusy(asNote ? "note" : "dump");
    if (asCard) {
      // The first line is the title; any more become its details.
      const [title = "", ...more] = words.trim().split("\n");
      const rest = more.map((l) => l.trim()).filter(Boolean);
      notes(client, "taskAdd", {
        title,
        ...(rest.length
          ? {
              body: {
                type: "doc",
                content: rest.map((t) => ({
                  type: "paragraph",
                  content: [{ type: "text", text: t }],
                })),
              },
            }
          : {}),
      })
        .then((c) => {
          setWords("");
          onOpenChange(false);
          onSaved?.();
          if (asNote) navigate(docPath(c.id));
          else say.done("Card added to the Work board.");
        })
        .catch(say.failed)
        .finally(() => setBusy(null));
      return;
    }
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
          <DialogTitle>{asCard ? "Quick card" : "Quick note"}</DialogTitle>
          <DialogDescription>
            {asCard
              ? "The first line is the title. It goes on the Work board."
              : "It goes at the end of your Dump note, with the time."}
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
            <label className="mr-auto flex items-center gap-1.5 text-[13px]">
              <input
                type="checkbox"
                checked={asCard}
                onChange={(e) => setAsCard(e.target.checked)}
              />
              Card
            </label>
            <Button
              tone="secondary"
              size="dense"
              type="button"
              busy={busy === "note"}
              disabled={!words.trim() || busy !== null}
              onClick={() => save(true)}
            >
              {asCard ? "Add and open" : "Make it a note"}
            </Button>
            <Button
              tone="primary"
              size="dense"
              type="submit"
              busy={busy === "dump"}
              disabled={!words.trim() || busy !== null}
            >
              {asCard ? "Add card" : "Add to Dump"}
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

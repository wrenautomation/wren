/**
 * Turn into cards (designs/2026-10-14-boards.md, Finish pass): Claude reads the note and
 * proposes cards; you tick, fix titles, pick the board, then add. Nothing is written before Add.
 * Each added card's link goes on the line it came from.
 */
import type { Editor } from "@tiptap/core";
import { ownerName } from "@wren/notes/types";
import { Button, Input, say } from "@wren/ui";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@wren/ui/components/ui/dialog";
import { useState } from "react";
import { useCall } from "../../load.js";
import { type BoardInfo, notes } from "./api.js";
import { SELECT } from "./card.js";
import { linesNamed, putChips } from "./cards.js";

type Pick = {
  /** Stable across edits: the order Claude gave. */
  key: string;
  title: string;
  owner: string | null;
  due: string | null;
  line: string | null;
  on: boolean;
};

export function ProposeCards({
  client,
  noteId,
  editor,
  onClose,
}: {
  client: string;
  noteId: string;
  editor: Editor;
  onClose: () => void;
}) {
  // Claude's picks for this note, kept: back after another page they show, not asked again.
  const proposed = useCall(`notes:propose:${client}:${noteId}`, () =>
    notes(client, "cardsPropose", { id: noteId }),
  );
  // The boards it may add to, as the Board page reads them.
  const list = useCall(`notes:boards:${client}`, () => notes(client, "boards"));
  const [edited, setPicks] = useState<Pick[] | null>(null);
  const picks: Pick[] | null =
    edited ?? proposed.data?.cards.map((c, i) => ({ ...c, key: `p${i}`, on: true })) ?? null;
  const failed = proposed.error && !proposed.data ? proposed.error.message : null;
  const boards: BoardInfo[] = (list.data?.boards ?? []).filter(
    (b) => b.home === list.data?.workspace && (b.role === "edit" || b.role === "owner"),
  );
  const [picked, setBoard] = useState<string | null>(null);
  const board = picked ?? (boards.find((b) => b.isDefault) ?? boards[0])?.id ?? "";
  const [busy, setBusy] = useState(false);

  const chosen = (picks ?? []).filter((p) => p.on && p.title.trim());
  const set = (i: number, patch: Partial<Pick>) =>
    setPicks((picks ?? []).map((p, j) => (j === i ? { ...p, ...patch } : p)));

  const add = async () => {
    if (!chosen.length) return;
    setBusy(true);
    try {
      const out = await notes(client, "taskFromLine", {
        id: noteId,
        ...(board ? { board } : {}),
        lines: chosen.map((p) => ({ title: p.title.trim(), owner: p.owner, due: p.due })),
      });
      const ends = linesNamed(
        editor,
        chosen.map((p) => p.line),
      );
      putChips(
        editor,
        ends.flatMap((end, i) => (end === null ? [] : [{ end, card: out.cards[i] }])),
      );
      say.done(
        out.cards.length === 1
          ? `Added a card to ${out.board}.`
          : `Added ${out.cards.length} cards to ${out.board}.`,
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
      <DialogContent className="gap-3 sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Turn into cards</DialogTitle>
          <DialogDescription>
            Claude read the note. Tick the cards you want. Nothing is added until you say so.
          </DialogDescription>
        </DialogHeader>
        {failed ? (
          <p className="m-0 text-[13px] text-(--ui-bad)">{failed}</p>
        ) : !picks ? (
          <p className="m-0 text-[13px] text-(--ui-ink-2)" aria-live="polite">
            Claude is reading the note…
          </p>
        ) : (
          <>
            <ul className="m-0 flex max-h-[50vh] list-none flex-col gap-2 overflow-y-auto p-0">
              {picks.map((p, i) => (
                <li key={p.key} className="flex items-start gap-2">
                  <input
                    type="checkbox"
                    className="mt-2.5"
                    checked={p.on}
                    aria-label={`Add ${p.title}`}
                    onChange={(e) => set(i, { on: e.target.checked })}
                  />
                  <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                    {/* edit-ok: Claude's proposal, made fresh each time this opens; nothing saved to keep */}
                    <Input
                      value={p.title}
                      maxLength={300}
                      aria-label="Card title"
                      onChange={(e) => set(i, { title: e.target.value })}
                    />
                    {p.owner || p.due ? (
                      <span className="text-[12px] text-(--ui-ink-2)">
                        {[p.owner ? ownerName(p.owner) : null, p.due ? `Due ${p.due}` : null]
                          .filter(Boolean)
                          .join(" · ")}
                      </span>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
            <div className="flex flex-wrap items-center justify-end gap-2">
              {boards.length > 1 ? (
                <select
                  aria-label="Board"
                  className={`${SELECT} mr-auto`}
                  value={board}
                  onChange={(e) => setBoard(e.target.value)}
                >
                  {boards.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </select>
              ) : null}
              <Button size="dense" tone="secondary" onClick={onClose}>
                Cancel
              </Button>
              <Button
                tone="primary"
                size="dense"
                busy={busy}
                disabled={!chosen.length}
                onClick={() => void add()}
              >
                {chosen.length === 1 ? "Add 1 card" : `Add ${chosen.length} cards`}
              </Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

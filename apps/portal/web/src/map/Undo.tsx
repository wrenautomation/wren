/**
 * Undo one line of a difference: the line of "Version a to b" that says what one change did.
 * "Undo" reads what the undo would save (`shapeUndoPreview`: the lines it changes, or why it
 * cannot run), and a second "Undo" saves it as the next version. The server refuses an undo that
 * no longer fits the newest shape; its sentence shows and nothing is saved.
 */
import type { UndoPreviewAnswer } from "@wren/pipeline/history";
import { Button, Loading } from "@wren/ui";
import { useState } from "react";
import { call } from "../api.js";
import { useCall } from "../load.js";
import { messageOf, Refused } from "./Refused.js";

export function UndoLine({
  at,
  a,
  b,
  change,
  line,
  canEdit,
  onUndone,
}: {
  /** The workspace as a call's params. */
  at: Record<string, string>;
  a: number;
  b: number;
  /** The change's key, from the difference's `changes`. */
  change: string;
  line: string;
  /** The viewer may save a version: Undo shows. */
  canEdit: boolean;
  /** The undo was saved: read the Map again. */
  onUndone: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [refused, setRefused] = useState<string | null>(null);
  const preview = useCall<UndoPreviewAnswer>(
    open ? `map-undo:${JSON.stringify(at)}:${a}:${b}:${change}` : null,
    () => call<UndoPreviewAnswer>("pipeline/shapeUndoPreview", { ...at, a, b, change }),
    { kept: false },
  );
  const run = async () => {
    setBusy(true);
    setRefused(null);
    try {
      await call("pipeline/shapeUndo", { ...at, a, b, change });
      setOpen(false);
      onUndone();
    } catch (err) {
      setRefused(messageOf(err));
    } finally {
      setBusy(false);
    }
  };
  const lines = preview.data?.changes.map((c) => c.line) ?? [];
  return (
    <li>
      <div className="flex items-start gap-2">
        <span className="min-w-0 flex-1">{line}</span>
        {canEdit ? (
          <Button
            tone="quiet"
            size="dense"
            aria-label={`Undo: ${line}`}
            aria-pressed={open}
            onClick={() => setOpen((o) => !o)}
          >
            Undo
          </Button>
        ) : null}
      </div>
      {open ? (
        <section
          aria-label="Undo preview"
          className="my-1.5 grid gap-2 rounded-(--ui-radius) bg-(--ui-wash) p-3"
        >
          {preview.error && !preview.data ? (
            <Refused text={preview.error.message} />
          ) : !preview.data ? (
            <Loading lines={2} />
          ) : (
            <>
              <p className="text-[12.5px] text-(--ui-ink-2)">
                This saves a new version on version {preview.data.newest}. It changes:
              </p>
              <ul className="list-none space-y-0.5 text-(--ui-ink-2)">
                {lines.map((l) => (
                  <li key={l}>{l}</li>
                ))}
              </ul>
              <p className="text-[12.5px] text-(--ui-ink-3)">Note: {preview.data.note}</p>
            </>
          )}
          {refused ? <Refused text={refused} /> : null}
          <div className="flex gap-2">
            <Button
              tone="primary"
              size="dense"
              busy={busy}
              disabled={!preview.data}
              onClick={() => void run()}
            >
              Undo
            </Button>
            <Button tone="quiet" size="dense" onClick={() => setOpen(false)}>
              Cancel
            </Button>
          </div>
        </section>
      ) : null}
    </li>
  );
}

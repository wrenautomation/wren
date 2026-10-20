/**
 * Importing a shape file onto the Map: the file is read by the server (`shapePreview`, which saves
 * nothing), the Map lists what it would change against the newest version, and Save writes it as
 * the next version through `shapeImport`. A file the server refuses shows the server's sentences.
 */

import type { ShapeDiff } from "@wren/pipeline/diff";
import type { ShapeBody } from "@wren/pipeline/model";
import { Alert, Button, FormKept, Loading, TextField, useEditForm } from "@wren/ui";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@wren/ui/components/ui/dialog";
import { call } from "../api.js";
import { useCall } from "../load.js";
import { diffLines } from "./diff.js";

/** What `shapePreview` answers. */
interface Preview {
  /** The newest version it was compared with; null when the workspace has none. */
  a: number | null;
  diff: ShapeDiff;
  /** The newest shape, then the file's. */
  bodies: [ShapeBody, ShapeBody];
  /** The note the file carries. */
  note: string | null;
  /** Where people on a node the file drops go. */
  moves: Record<string, string> | null;
}

/** The note box and Save, once the file has been read. */
function Save({
  at,
  text,
  preview,
  lines,
  onSaved,
  onClose,
}: {
  at: Record<string, string>;
  text: string;
  preview: Preview;
  lines: readonly string[];
  onSaved: () => void;
  onClose: () => void;
}) {
  const form = useEditForm({ key: null, defaults: { note: preview.note ?? "" } });
  const save = form.onSend(async (v) => {
    await call("pipeline/shapeImport", { ...at, text, note: v.note.trim() });
    onSaved();
  });
  const moves = Object.entries(preview.moves ?? {});
  const nameOf = (id: string) =>
    preview.bodies.flatMap((b) => b.nodes).find((n) => n.id === id)?.name ?? id;
  return (
    <form className="flex flex-col gap-3" onSubmit={(e) => void save(e)}>
      <section aria-label="Changes">
        <h3 className="mb-1.5 text-[13px] font-semibold text-(--ui-ink-2)">
          {preview.a === null ? "The file adds" : `Against version ${preview.a}, the file changes`}
        </h3>
        {lines.length ? (
          <ul className="max-h-[40dvh] list-none space-y-0.5 overflow-y-auto text-[13.5px] text-(--ui-ink-2)">
            {lines.map((l) => (
              <li key={l}>{l}</li>
            ))}
          </ul>
        ) : (
          <p className="text-(--ui-ink-3)">The file matches the newest version. Nothing to save.</p>
        )}
        {moves.length ? (
          <p className="mt-2 text-[13px] text-(--ui-ink-2)">
            People move: {moves.map(([from, to]) => `${nameOf(from)} to ${nameOf(to)}`).join(", ")}.
          </p>
        ) : null}
      </section>
      {lines.length ? (
        <TextField
          form={form}
          name="note"
          maxLength={200}
          aria-label="Why it changed"
          placeholder="Why it changed"
        />
      ) : null}
      <FormKept form={form} />
      {form.error ? <Alert className="mb-0">{form.error}</Alert> : null}
      <div className="flex justify-end gap-2">
        <Button tone="quiet" size="dense" onClick={onClose}>
          Cancel
        </Button>
        {lines.length ? (
          <Button
            tone="primary"
            size="dense"
            type="submit"
            busy={form.formState.isSubmitting}
            disabled={!form.watch("note").trim()}
          >
            Save version
          </Button>
        ) : null}
      </div>
    </form>
  );
}

export function ImportDialog({
  at,
  name,
  text,
  stamp,
  onClose,
  onSaved,
}: {
  /** The workspace as a call's params. */
  at: Record<string, string>;
  /** The file's name. */
  name: string;
  /** The file's text. */
  text: string;
  /** When the file was picked: a new pick reads again. */
  stamp: number;
  onClose: () => void;
  /** The version was saved. */
  onSaved: () => void;
}) {
  // Kept in this component only: the file is the person's, not the device's.
  const preview = useCall<Preview>(
    `map-import:${JSON.stringify(at)}:${stamp}`,
    () => call<Preview>("pipeline/shapePreview", { ...at, text }),
    { kept: false },
  );
  const lines = preview.data
    ? diffLines(preview.data.bodies[0], preview.data.bodies[1], preview.data.diff)
    : [];
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Import a shape</DialogTitle>
          <DialogDescription>{name}</DialogDescription>
        </DialogHeader>
        {preview.error && !preview.data ? (
          <>
            <Alert className="mb-0">{preview.error.message}</Alert>
            <div className="flex justify-end">
              <Button tone="quiet" size="dense" onClick={onClose}>
                Close
              </Button>
            </div>
          </>
        ) : !preview.data ? (
          <Loading lines={4} />
        ) : (
          <Save
            at={at}
            text={text}
            preview={preview.data}
            lines={lines}
            onSaved={onSaved}
            onClose={onClose}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

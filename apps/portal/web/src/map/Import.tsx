/**
 * Importing a shape file onto the Map: the file is read by the server (`shapePreview`, which saves
 * nothing). The Map draws the file's shape with the marks of what it changes against the newest
 * version, a card over the canvas lists the changes, and Save writes the file as the next version
 * through `shapeImport`. A file the server refuses shows the server's sentences.
 */

import type { PreviewAnswer } from "@wren/pipeline/history";
import { Button, FormKept, Loading, TextField, useEditForm } from "@wren/ui";
import { call } from "../api.js";
import { useCall } from "../load.js";
import { OVER_RIGHT } from "./overlay.js";
import { Refused } from "./Refused.js";

/** What `shapePreview` says about the file; read once for each pick. Kept in this page only. */
export function useImportPreview(at: Record<string, string>, text: string | null, stamp: number) {
  return useCall<PreviewAnswer>(
    text === null ? null : `map-import:${JSON.stringify(at)}:${stamp}`,
    () => call<PreviewAnswer>("pipeline/shapePreview", { ...at, text }),
    { kept: false },
  );
}

/** The note box and Save, once the file has been read. */
function Save({
  at,
  text,
  preview,
  onSaved,
  onClose,
}: {
  at: Record<string, string>;
  text: string;
  preview: PreviewAnswer;
  onSaved: () => void;
  onClose: () => void;
}) {
  const form = useEditForm({ key: null, defaults: { note: preview.note ?? "" } });
  const save = form.onSend(async (v) => {
    await call("pipeline/shapeImport", { ...at, text, note: v.note.trim() });
    onSaved();
  });
  const moves = Object.entries(preview.moves ?? {});
  const stations = (preview.views ?? []).flatMap((b) => b.stations);
  const nameOf = (id: string) => stations.find((s) => s.id === id)?.label ?? id;
  const lines = preview.changes;
  return (
    <form className="flex flex-col gap-3" onSubmit={(e) => void save(e)}>
      <section aria-label="Changes">
        <h3 className="mb-1.5 text-[13px] font-semibold text-(--ui-ink-2)">
          {preview.a === null ? "The file adds" : `Against version ${preview.a}, the file changes`}
        </h3>
        {lines.length ? (
          <ul className="max-h-[40dvh] list-none space-y-0.5 overflow-y-auto text-[13.5px] text-(--ui-ink-2)">
            {lines.map((l) => (
              <li key={l.key}>{l.line}</li>
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
      {form.error ? <Refused text={form.error} /> : null}
      <div className="flex gap-2">
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
        <Button tone="quiet" size="dense" onClick={onClose}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

/** The import card over the Map: the file's name, then its changes (or why it cannot be read). */
export function ImportPanel({
  at,
  name,
  text,
  preview,
  onClose,
  onSaved,
}: {
  /** The workspace as a call's params. */
  at: Record<string, string>;
  /** The file's name. */
  name: string;
  /** The file's text. */
  text: string;
  preview: ReturnType<typeof useImportPreview>;
  onClose: () => void;
  /** The version was saved. */
  onSaved: () => void;
}) {
  return (
    <section aria-label="Import a shape" className={`${OVER_RIGHT} text-[14px] text-(--ui-ink)`}>
      <header>
        <h2 className="text-[17px]/6 font-semibold">Import a shape</h2>
        <p className="wrap-anywhere whitespace-normal text-[13px] text-(--ui-ink-3)">{name}</p>
      </header>
      {preview.error && !preview.data ? (
        <>
          <Refused text={preview.error.message} />
          <div>
            <Button tone="quiet" size="dense" onClick={onClose}>
              Close
            </Button>
          </div>
        </>
      ) : !preview.data ? (
        <Loading lines={4} />
      ) : (
        <Save at={at} text={text} preview={preview.data} onSaved={onSaved} onClose={onClose} />
      )}
    </section>
  );
}

/**
 * Names a version: a short form under it (name, and a note if it helps). A tag is a label that
 * never changes; there is no edit and no delete. A refusal (a name taken, a name not allowed)
 * shows as the server says it, and what was typed stays.
 */
import { Alert, Button, FormKept, TextField, useEditForm } from "@wren/ui";
import { call } from "../api.js";

export function TagForm({
  client,
  at,
  version,
  onTagged,
  onCancel,
}: {
  client: string;
  /** The workspace as a call's params. */
  at: Record<string, string>;
  version: number;
  /** The tag was saved: read the versions again. */
  onTagged: () => void;
  onCancel: () => void;
}) {
  const form = useEditForm({
    key: `map:tag:${client}:${version}`,
    defaults: { name: "", note: "" },
  });
  const send = form.onSend(
    async (v) => {
      const note = v.note.trim();
      await call("pipeline/shapeTag", {
        ...at,
        name: v.name.trim(),
        version,
        ...(note ? { note } : {}),
      });
      onTagged();
    },
    { clear: true },
  );
  return (
    <form
      aria-label={`Tag version ${version}`}
      className="grid gap-2 rounded-(--ui-radius) bg-(--ui-wash) p-3"
      onSubmit={(e) => void send(e)}
    >
      <h3 className="text-[13px] font-semibold text-(--ui-ink)">Tag version {version}</h3>
      <TextField
        form={form}
        name="name"
        autoFocus
        maxLength={60}
        aria-label="Tag name"
        placeholder="Name, like launch"
      />
      <TextField
        form={form}
        name="note"
        maxLength={200}
        aria-label="Tag note"
        placeholder="Note (optional)"
      />
      <FormKept form={form} />
      {form.error ? <Alert className="mb-0">{form.error}</Alert> : null}
      <div className="flex gap-2">
        <Button
          tone="primary"
          size="dense"
          type="submit"
          busy={form.formState.isSubmitting}
          disabled={!form.watch("name").trim()}
        >
          Save tag
        </Button>
        <Button tone="quiet" size="dense" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

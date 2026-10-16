/**
 * Board dialogs: a new board, and a board's settings (its name and columns, who it is shared with,
 * archive). Sharing is the note's: a person, the team, or at Wren a client.
 */
import { Button, FormKept, Input, SelectField, say, TextField, useEditForm } from "@wren/ui";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@wren/ui/components/ui/dialog";
import { useCall } from "../../load.js";
import { WREN } from "../../module.js";
import { type BoardInfo, notes, ROLE_LABEL, type ShareRole, useBoard } from "./api.js";
import { SELECT } from "./card.js";

type Column = BoardInfo["columns"][number];

const FIRST: Column[] = [
  { id: "todo", name: "To do", done: false },
  { id: "doing", name: "Doing", done: false },
  { id: "done", name: "Done", done: true },
];

export function NewBoard({
  client,
  open,
  onOpenChange,
  onMade,
}: {
  client: string;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onMade: (id: string) => void;
}) {
  const form = useEditForm({ key: "board:new:name", defaults: { name: "" } });
  const make = form.onSend(
    async (v) => {
      try {
        const b = await notes(client, "boardCreate", { name: v.name });
        onOpenChange(false);
        onMade(b.id);
      } catch (err) {
        say.failed(err);
        return false;
      }
    },
    { clear: true },
  );
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>New board</DialogTitle>
          <DialogDescription>
            It starts with To do, Doing and Done, and is private to you until you share it.
          </DialogDescription>
        </DialogHeader>
        <form className="flex flex-col gap-3" onSubmit={(e) => void make(e)}>
          <TextField
            form={form}
            name="name"
            autoFocus
            maxLength={80}
            aria-label="Board name"
            placeholder="Launch plan"
          />
          <FormKept form={form} />
          <div className="flex justify-end">
            <Button
              tone="primary"
              size="dense"
              type="submit"
              busy={form.formState.isSubmitting}
              disabled={!form.watch("name").trim()}
            >
              Make board
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function BoardDialog({
  client,
  board,
  open,
  onOpenChange,
  onChanged,
  onGone,
}: {
  client: string;
  board: BoardInfo;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onChanged: () => void;
  onGone: () => void;
}) {
  const owner = board.role === "owner";
  // The board's row version: a save over a board someone changed since shows both, never
  // overwrites theirs.
  const version = String(board.version);
  const form = useEditForm({
    key: `board:${board.id}`,
    defaults: { name: board.name, columns: board.columns.length ? board.columns : FIRST },
    base: version,
  });
  const columns = form.watch("columns");
  const setColumns = (f: (cs: Column[]) => Column[]) =>
    form.setValue("columns", f(form.getValues("columns")));
  const shareForm = useEditForm({
    key: `board:${board.id}:share`,
    defaults: { who: "", role: "edit" as ShareRole },
  });
  // Who it's shared with, from the board's own read (the owner's alone); Wren's clients to pick.
  const held = useBoard(client, owner ? board.id : null);
  const shares = held.data?.shares ?? [];
  const readShares = () => held.retry();
  const people = useCall(owner && client === WREN.id ? `notes:people:${client}` : null, () =>
    notes(client, "people"),
  );
  const clients = people.data?.clients ?? [];

  const set = (i: number, change: Partial<Column>) =>
    setColumns((cs) => cs.map((c, n) => (n === i ? { ...c, ...change } : c)));
  const swap = (i: number, to: number) =>
    setColumns((cs) => {
      const next = [...cs];
      const [c] = next.splice(i, 1);
      if (c) next.splice(to, 0, c);
      return next;
    });

  const save = form.onSend(async (v) => {
    try {
      await notes(client, "boardSave", {
        id: board.id,
        expect: board.version,
        name: v.name,
        // A new column has no id yet; the server makes one from its name.
        columns: v.columns.map((c) =>
          c.id.startsWith("new-") ? { name: c.name, done: c.done } : c,
        ),
      });
    } catch (err) {
      say.failed(err);
      // Saved by someone else since: read it, so theirs shows beside these words.
      if ((err as { status?: unknown } | null)?.status === 409) onChanged();
      return false;
    }
    say.done("Saved.");
    onChanged();
    onOpenChange(false);
  });
  const share = async (w: string, r: ShareRole | null) => {
    try {
      await notes(client, "boardShare", { id: board.id, who: w, role: r });
    } catch (err) {
      say.failed(err);
      return false;
    }
    readShares();
    onChanged();
    return true;
  };
  const addShare = shareForm.onSend((v) => (v.who.trim() ? share(v.who.trim(), v.role) : false), {
    clear: true,
  });
  const archive = async () => {
    try {
      await notes(client, "boardArchive", { id: board.id, on: true });
      say.done("Archived.");
      onOpenChange(false);
      onGone();
    } catch (err) {
      say.failed(err);
    }
  };
  const general = async (g: "private" | "workspace") => {
    try {
      await notes(client, "boardGeneral", { id: board.id, general: g, role: "edit" });
      onChanged();
    } catch (err) {
      say.failed(err);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Board settings</DialogTitle>
          <DialogDescription>
            Name it, set its columns, and choose who can see it.
          </DialogDescription>
        </DialogHeader>
        <form className="flex flex-col gap-3" onSubmit={(e) => void save(e)}>
          <TextField
            form={form}
            name="name"
            label="Name"
            maxLength={80}
            disabled={board.isDefault}
          />
          <fieldset className="m-0 grid gap-1.5 border-0 p-0">
            <legend className="mb-1 p-0 text-[13px]">Columns, left to right</legend>
            {columns.map((c, i) => (
              <div key={c.id} className="flex items-center gap-1.5">
                <Input
                  data-edit="form:columns"
                  value={c.name}
                  maxLength={40}
                  aria-label={`Column ${i + 1}`}
                  onChange={(e) => set(i, { name: e.target.value })}
                />
                <label className="flex items-center gap-1 text-[12.5px] whitespace-nowrap">
                  <input
                    type="checkbox"
                    checked={c.done}
                    onChange={(e) => set(i, { done: e.target.checked })}
                  />
                  Closes
                </label>
                <Button
                  tone="secondary"
                  size="dense"
                  type="button"
                  aria-label={`Move ${c.name} left`}
                  disabled={i === 0}
                  onClick={() => swap(i, i - 1)}
                >
                  ↑
                </Button>
                <Button
                  tone="secondary"
                  size="dense"
                  type="button"
                  aria-label={`Move ${c.name} right`}
                  disabled={i === columns.length - 1}
                  onClick={() => swap(i, i + 1)}
                >
                  ↓
                </Button>
                <Button
                  tone="secondary"
                  size="dense"
                  type="button"
                  aria-label={`Remove ${c.name}`}
                  disabled={columns.length <= 2}
                  onClick={() => setColumns((cs) => cs.filter((_, n) => n !== i))}
                >
                  ×
                </Button>
              </div>
            ))}
            {columns.length < 12 ? (
              <div>
                <Button
                  tone="secondary"
                  size="dense"
                  type="button"
                  onClick={() => {
                    const open = columns.findIndex((c) => c.done);
                    const at = open < 0 ? columns.length : open;
                    setColumns((cs) => [
                      ...cs.slice(0, at),
                      { id: `new-${cs.length}`, name: "", done: false },
                      ...cs.slice(at),
                    ]);
                  }}
                >
                  Add column
                </Button>
              </div>
            ) : null}
          </fieldset>
          <FormKept form={form} />
          <div className="flex justify-end">
            <Button tone="primary" size="dense" type="submit" busy={form.formState.isSubmitting}>
              Save
            </Button>
          </div>
        </form>
        {owner ? (
          <section aria-label="Sharing" className="grid gap-2 border-t border-(--ui-hair) pt-3">
            <h3 className="m-0 text-[13px] font-semibold">Who can see it</h3>
            {board.isDefault ? (
              <p className="m-0 text-[13px] text-(--ui-ink-2)">
                Everyone in the workspace can edit the Work board.
              </p>
            ) : (
              <label className="flex items-center gap-2 text-[13px]">
                Workspace
                <select
                  className={SELECT}
                  value={board.general}
                  onChange={(e) => void general(e.target.value as "private" | "workspace")}
                >
                  <option value="private">Only the people below</option>
                  <option value="workspace">Everyone here can edit</option>
                </select>
              </label>
            )}
            <ul className="m-0 grid list-none gap-1 p-0">
              {shares.map((s) => (
                <li key={s.who} className="flex items-center gap-2 text-[13px]">
                  <span className="min-w-0 flex-1 truncate">{s.who}</span>
                  <span className="text-(--ui-ink-2)">
                    {ROLE_LABEL[s.role as ShareRole] ?? s.role}
                  </span>
                  <Button
                    tone="secondary"
                    size="dense"
                    type="button"
                    onClick={() => void share(s.who, null)}
                  >
                    Remove
                  </Button>
                </li>
              ))}
            </ul>
            <form className="flex flex-wrap items-center gap-2" onSubmit={(e) => void addShare(e)}>
              <TextField
                form={shareForm}
                name="who"
                list="board-who"
                aria-label="Share with"
                placeholder="An email, team, or a client"
                box="min-w-0 flex-1"
              />
              <datalist id="board-who">
                <option value="team" />
                {clients.map((c) => (
                  <option key={c.id} value={`client:${c.id}`}>
                    {c.name}
                  </option>
                ))}
              </datalist>
              <SelectField
                form={shareForm}
                name="role"
                aria-label="Role"
                box={`${SELECT} w-auto`}
                options={(Object.keys(ROLE_LABEL) as ShareRole[]).map((r) => [r, ROLE_LABEL[r]])}
              />
              <Button
                tone="primary"
                size="dense"
                type="submit"
                disabled={!shareForm.watch("who").trim()}
              >
                Share
              </Button>
            </form>
            {board.isDefault ? null : (
              <div>
                <Button tone="secondary" size="dense" type="button" onClick={() => void archive()}>
                  Archive board
                </Button>
              </div>
            )}
          </section>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

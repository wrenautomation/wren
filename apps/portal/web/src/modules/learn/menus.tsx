/**
 * Learn's dialogs and menus: move to a collection, tag, add to an SOP, name a collection, the
 * keys. Each writes through ./api.ts, which tells every list on screen to load again.
 */
import { Button, cx, Input, type KeySection, say, tipProps } from "@wren/ui";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@wren/ui/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@wren/ui/components/ui/popover";
import {
  Check,
  Ellipsis,
  Folder,
  FolderInput,
  FolderPlus,
  Hash,
  Pencil,
  Trash2,
} from "@wren/ui/lib/lucide";
import { toast } from "@wren/ui/lib/toast";
import { type FormEvent, type ReactNode, useMemo, useRef, useState } from "react";
import { navigate } from "../../route.js";
import { type Collection, clientOf, learn, type Mark } from "./api.js";

/** One line for how many: "this item", "3 items". */
export const many = (n: number) => (n === 1 ? "1 item" : `${n} items`);

/** Run a write, then say how it went. */
export async function act(work: Promise<unknown>, line: string): Promise<boolean> {
  try {
    await work;
    say.done(line);
    return true;
  } catch (err) {
    say.failed(err);
    return false;
  }
}

const UNDO: Partial<Record<Mark, Mark>> = {
  archive: "unarchive",
  unarchive: "archive",
  later: "unlater",
  unlater: "later",
  star: "unstar",
  unstar: "star",
  pin: "unpin",
  unpin: "pin",
  read: "unread",
  unread: "read",
};
const MARK_LINES: Record<Mark, string> = {
  archive: "Archived",
  unarchive: "Back in your items",
  later: "Added to Watch later",
  unlater: "Off Watch later",
  star: "Starred",
  unstar: "Unstarred",
  pin: "Pinned to the top",
  unpin: "Unpinned",
  read: "Marked read",
  unread: "Marked unread",
};

/**
 * The undo of a mark: the opposite, on only the items it changed (one already starred isn't
 * unstarred by Star's undo), once. Null when there is nothing to undo.
 */
export function undoOf(mark: Mark, done: readonly (string | number)[]) {
  const back = UNDO[mark];
  if (!back || !done.length) return null;
  let used = false;
  return {
    back,
    ids: done.map(Number),
    /** True the first time only: a second press of Undo does nothing. */
    take: () => {
      if (used) return false;
      used = true;
      return true;
    },
  };
}

/** Mark items, with an undo for ten seconds. */
export async function markItems(ids: number[], mark: Mark): Promise<void> {
  if (!ids.length) return;
  let done: string[];
  try {
    ({ done } = await learn.mark(ids, mark));
  } catch (err) {
    say.failed(err);
    return;
  }
  const line = ids.length > 1 ? `${MARK_LINES[mark]}: ${many(ids.length)}` : MARK_LINES[mark];
  const undo = undoOf(mark, done ?? []);
  if (!undo) return void toast.success(line);
  toast.success(line, {
    duration: 10_000,
    action: {
      label: "Undo",
      onClick: () => {
        if (!undo.take()) return;
        void learn.mark(undo.ids, undo.back).then(() => toast.success("Undone"), say.failed);
      },
    },
  });
}

/** The collections as a tree, in order: each with its depth and its path of names. */
export function treeOf(cols: Collection[]): (Collection & { depth: number; path: string })[] {
  const kids = new Map<number | null, Collection[]>();
  for (const c of cols) {
    const p = cols.some((x) => x.id === c.parentId) ? c.parentId : null;
    kids.set(p, [...(kids.get(p) ?? []), c]);
  }
  const out: (Collection & { depth: number; path: string })[] = [];
  const walk = (parent: number | null, depth: number, path: string) => {
    for (const c of kids.get(parent) ?? []) {
      const here = path ? `${path} / ${c.name}` : c.name;
      out.push({ ...c, depth, path: here });
      walk(c.id, depth + 1, here);
    }
  };
  walk(null, 0, "");
  return out;
}

/** The collection's ancestors, nearest last. */
export function trailOf(cols: Collection[], id: number): Collection[] {
  const out: Collection[] = [];
  let at = cols.find((c) => c.id === id);
  while (at && out.length < 20) {
    out.unshift(at);
    const up = at.parentId;
    at = up === null ? undefined : cols.find((c) => c.id === up);
  }
  return out;
}

const ROW =
  "flex h-9 w-full items-center gap-2 border-0 bg-transparent px-2 text-left text-[13.5px] text-(--ui-ink) hover:bg-(--ui-hover) focus-visible:bg-(--ui-hover) focus-visible:outline-none";

/** Move items to a collection, or out of every one. */
export function MoveDialog({
  ids,
  collections,
  current,
  onClose,
}: {
  ids: number[];
  collections: Collection[];
  /** Where the one item sits now. */
  current?: number | null;
  /** Done is true after a save: the caller drops its selection. */
  onClose: (done?: boolean) => void;
}) {
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  /** One new collection at a time, whatever the render says. */
  const flying = useRef(false);
  const tree = useMemo(() => treeOf(collections), [collections]);
  const shown = q.trim()
    ? tree.filter((c) => c.path.toLowerCase().includes(q.trim().toLowerCase()))
    : tree;
  const move = async (to: number | null, name: string) => {
    setBusy(true);
    const ok = await act(
      learn.move(ids, to),
      to === null ? `Took ${many(ids.length)} out of its collection` : `Moved to ${name}`,
    );
    setBusy(false);
    if (ok) onClose(true);
  };
  const create = async (e: FormEvent) => {
    e.preventDefault();
    const name = q.trim();
    if (!name || flying.current) return;
    flying.current = true;
    setBusy(true);
    try {
      const made = await learn.collectionAdd(name, null);
      await move(Number(made.id), made.name);
    } catch (err) {
      say.failed(err);
      setBusy(false);
    } finally {
      flying.current = false;
    }
  };
  const exact = tree.some((c) => c.name.toLowerCase() === q.trim().toLowerCase());
  return (
    <Dialog open onOpenChange={(o) => (o ? null : onClose())}>
      <DialogContent className="gap-3 sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Move {many(ids.length)}</DialogTitle>
          <DialogDescription>Pick a collection, or type a new one's name.</DialogDescription>
        </DialogHeader>
        <form onSubmit={create}>
          <Input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Find or name a collection"
            aria-label="Find or name a collection"
          />
        </form>
        <div className="-mx-2 max-h-72 overflow-y-auto">
          {q.trim() && !exact ? (
            <button type="button" className={ROW} disabled={busy} onClick={create}>
              <FolderPlus size={15} className="text-(--ui-link)" />
              <span>
                New collection <b className="font-semibold">{q.trim()}</b>
              </span>
            </button>
          ) : null}
          {!q.trim() && current ? (
            <button type="button" className={ROW} disabled={busy} onClick={() => move(null, "")}>
              <FolderInput size={15} className="text-(--ui-ink-2)" />
              <span>Out of its collection</span>
            </button>
          ) : null}
          {shown.map((c) => (
            <button
              key={c.id}
              type="button"
              className={ROW}
              disabled={busy}
              onClick={() => move(c.id, c.name)}
            >
              <span className={cx("shrink-0", INDENT[Math.min(c.depth, 4)])} />
              <Folder size={15} className="shrink-0 text-(--ui-ink-2)" />
              <span className="min-w-0 flex-1 truncate">{q.trim() ? c.path : c.name}</span>
              {c.id === current ? <Check size={15} className="text-(--ui-active)" /> : null}
              <span className="text-[12px] text-(--ui-ink-2) tabular-nums">{c.n || ""}</span>
            </button>
          ))}
          {!tree.length && !q.trim() ? (
            <p className="px-2 py-3 text-[13px] text-(--ui-ink-2)">
              Collections work like folders and can nest. Type a name above to make the first.
            </p>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}

const INDENT = ["w-0", "w-4", "w-8", "w-12", "w-16"];

/** Add tags to items; on one item, take its own off too. */
export function TagDialog({
  ids,
  have,
  known,
  onClose,
}: {
  ids: number[];
  /** The one item's tags now. */
  have: string[];
  known: string[];
  /** Done is true after a save: the caller drops its selection. */
  onClose: (done?: boolean) => void;
}) {
  const [text, setText] = useState("");
  const [off, setOff] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const typed = text
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
  const suggest = known.filter((t) => !have.includes(t) && !typed.includes(t)).slice(0, 12);
  const save = async (e?: FormEvent) => {
    e?.preventDefault();
    if (!typed.length && !off.length) return onClose();
    setBusy(true);
    const ok = await act(
      learn.tag(ids, typed, off),
      typed.length ? `Tagged ${many(ids.length)}` : "Tags saved",
    );
    setBusy(false);
    if (ok) onClose(true);
  };
  return (
    <Dialog open onOpenChange={(o) => (o ? null : onClose())}>
      <DialogContent className="gap-3 sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Tag {many(ids.length)}</DialogTitle>
          <DialogDescription>
            Separate tags with commas. Find them later in the rail.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={save} className="flex flex-col gap-3">
          <Input
            autoFocus
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="deliverability, hooks"
            aria-label="Tags to add"
          />
          {have.length ? (
            <div className="flex flex-wrap gap-1.5">
              {have.map((t) => {
                const gone = off.includes(t);
                return (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setOff(gone ? off.filter((x) => x !== t) : [...off, t])}
                    className={cx(
                      "inline-flex h-7 items-center gap-1 border border-(--ui-hair) bg-transparent px-2 text-[12.5px]",
                      gone ? "text-(--ui-ink-2) line-through" : "text-(--ui-ink)",
                    )}
                    aria-pressed={!gone}
                    {...tipProps(gone ? "Keep this tag" : "Take this tag off")}
                  >
                    <Hash size={12} />
                    {t}
                  </button>
                );
              })}
            </div>
          ) : null}
          {suggest.length ? (
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-[12px] text-(--ui-ink-2)">Used before</span>
              {suggest.map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setText(typed.length ? `${typed.join(", ")}, ${t}` : t)}
                  className="inline-flex h-7 items-center gap-1 border-0 bg-(--ui-tile) px-2 text-[12.5px] text-(--ui-ink-2) hover:text-(--ui-ink)"
                >
                  <Hash size={12} />
                  {t}
                </button>
              ))}
            </div>
          ) : null}
          <div className="flex justify-end gap-2">
            <Button size="dense" tone="secondary" onClick={() => onClose()}>
              Cancel
            </Button>
            <Button tone="primary" size="dense" type="submit" busy={busy}>
              Save tags
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Add items to an SOP. Wren's: the Mac writes them into the SOP's folder. A client's: each goes
 * into its own Notes, under a note named for the SOP.
 */
export function SopDialog({ ids, onClose }: { ids: number[]; onClose: (done?: boolean) => void }) {
  const notes = clientOf() !== null;
  const [sop, setSop] = useState("");
  const [busy, setBusy] = useState(false);
  const ok = /^[a-z0-9][a-z0-9-]*$/.test(sop.trim());
  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (!ok) return;
    setBusy(true);
    const done = await act(
      learn.toSop(ids, sop.trim()),
      notes
        ? "Added. It shows in Notes once it's read."
        : "Asked. The Mac adds it on its next read.",
    );
    setBusy(false);
    if (done) onClose(true);
  };
  return (
    <Dialog open onOpenChange={(o) => (o ? null : onClose())}>
      <DialogContent className="gap-3 sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add {many(ids.length)} to an SOP</DialogTitle>
          <DialogDescription>
            {notes
              ? "The SOP's name, such as onboarding. Each item goes into your Notes under it."
              : "The SOP's folder name, such as email-infra. The Mac writes it in on its next read."}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={save} className="flex flex-col gap-3">
          <Input
            autoFocus
            value={sop}
            onChange={(e) => setSop(e.target.value.toLowerCase())}
            placeholder={notes ? "onboarding" : "email-infra"}
            aria-label="SOP name"
          />
          <div className="flex justify-end gap-2">
            <Button size="dense" tone="secondary" onClick={() => onClose()}>
              Cancel
            </Button>
            <Button tone="primary" size="dense" type="submit" busy={busy} disabled={!ok}>
              Add to SOP
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Name a new collection, or rename one. */
export function NameDialog({
  title,
  initial = "",
  action,
  onSave,
  onClose,
}: {
  title: string;
  initial?: string;
  action: string;
  onSave: (name: string) => Promise<unknown>;
  onClose: () => void;
}) {
  const [name, setName] = useState(initial);
  const [busy, setBusy] = useState(false);
  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    try {
      await onSave(name.trim());
      onClose();
    } catch (err) {
      say.failed(err);
      setBusy(false);
    }
  };
  return (
    <Dialog open onOpenChange={(o) => (o ? null : onClose())}>
      <DialogContent className="gap-3 sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <form onSubmit={save} className="flex flex-col gap-3">
          <Input
            autoFocus
            value={name}
            maxLength={80}
            onChange={(e) => setName(e.target.value)}
            aria-label="Name"
            placeholder="Cold email"
          />
          <div className="flex justify-end gap-2">
            <Button size="dense" tone="secondary" onClick={() => onClose()}>
              Cancel
            </Button>
            <Button tone="primary" size="dense" type="submit" busy={busy} disabled={!name.trim()}>
              {action}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Delete a collection: its items stay, out of it; what's inside moves up. */
function DropDialog({ c, onClose }: { c: Collection; onClose: () => void }) {
  const [busy, setBusy] = useState(false);
  return (
    <Dialog open onOpenChange={(o) => (o ? null : onClose())}>
      <DialogContent className="gap-3 sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Delete {c.name}?</DialogTitle>
          <DialogDescription>
            Its items stay in Learn, out of any collection. Collections inside it are deleted too.
          </DialogDescription>
        </DialogHeader>
        <div className="flex justify-end gap-2">
          <Button size="dense" tone="secondary" onClick={() => onClose()}>
            Keep it
          </Button>
          <Button
            tone="primary"
            size="dense"
            busy={busy}
            onClick={async () => {
              setBusy(true);
              const ok = await act(learn.collectionDrop(c.id), `Deleted ${c.name}`);
              setBusy(false);
              if (!ok) return;
              onClose();
              if (
                location.pathname.startsWith("/learn/items") &&
                location.search.includes(`in=c${c.id}`)
              )
                navigate("/learn/items?in=all", true);
            }}
          >
            Delete
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** A collection's own menu: a new one inside, rename, move to the top, delete. */
export function CollectionMenu({
  c,
  trigger,
  className,
}: {
  c: Collection;
  trigger?: ReactNode;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [dialog, setDialog] = useState<"new" | "rename" | "drop" | null>(null);
  const item =
    "flex h-8 w-full items-center gap-2 border-0 bg-transparent px-2.5 text-left text-[13px] text-(--ui-ink) hover:bg-(--ui-hover)";
  const pick = (d: "new" | "rename" | "drop") => {
    setOpen(false);
    setDialog(d);
  };
  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          aria-label={`${c.name}: options`}
          {...tipProps("Options", { as: "none" })}
          className={cx(
            "inline-flex size-6 shrink-0 items-center justify-center text-(--ui-ink-2) hover:bg-(--ui-hover) hover:text-(--ui-ink)",
            className,
          )}
        >
          {trigger ?? <Ellipsis size={15} />}
        </PopoverTrigger>
        <PopoverContent align="start" className="w-52 gap-0 bg-(--ui-paper) p-1 text-(--ui-ink)">
          <button type="button" className={item} onClick={() => pick("new")}>
            <FolderPlus size={14} /> New collection inside
          </button>
          <button type="button" className={item} onClick={() => pick("rename")}>
            <Pencil size={14} /> Rename
          </button>
          {c.parentId !== null ? (
            <button
              type="button"
              className={item}
              onClick={() => {
                setOpen(false);
                void act(
                  learn.collectionEdit(c.id, { parent: null }),
                  `${c.name} moved to the top`,
                );
              }}
            >
              <FolderInput size={14} /> Move to the top
            </button>
          ) : null}
          <button
            type="button"
            className={cx(item, "text-(--ui-bad)")}
            onClick={() => pick("drop")}
          >
            <Trash2 size={14} /> Delete
          </button>
        </PopoverContent>
      </Popover>
      {dialog === "new" ? (
        <NameDialog
          title={`New collection in ${c.name}`}
          action="Create"
          onSave={(name) =>
            learn.collectionAdd(name, c.id).then((made) => navigate(`/learn/items?in=c${made.id}`))
          }
          onClose={() => setDialog(null)}
        />
      ) : dialog === "rename" ? (
        <NameDialog
          title="Rename collection"
          initial={c.name}
          action="Rename"
          onSave={(name) => learn.collectionEdit(c.id, { name })}
          onClose={() => setDialog(null)}
        />
      ) : dialog === "drop" ? (
        <DropDialog c={c} onClose={() => setDialog(null)} />
      ) : null}
    </>
  );
}

/** Learn's keys, in the keys sheet (?) while a list or an item is on screen. */
export const LEARN_KEYS: KeySection = {
  title: "Learn",
  keys: [
    ["↑  ↓", "Next or previous item (J and K too)"],
    ["Enter", "Open it"],
    ["x", "Select it"],
    ["s", "Star"],
    ["e", "Archive"],
    ["l", "Watch later"],
    ["m", "Move to a collection"],
    ["t", "Tag"],
    ["Esc", "Clear the selection"],
  ],
};

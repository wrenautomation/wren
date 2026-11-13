/**
 * The one folder tree beside every list (designs/2026-11-08-folders.md): chats, subjects, runs.
 * The page owns the data and the writes (`FolderActs`); this draws the tree, names and renames in
 * place, moves by menu or by drag, and asks before a delete.
 */
import { cn } from "cn";
import {
  type DragEvent,
  type KeyboardEvent,
  type ReactNode,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Popover, PopoverContent, PopoverTrigger } from "./components/ui/popover.js";
import { Button } from "./controls.js";
import { tipProps } from "./hint.js";
import { Icon } from "./icons.js";
import { toast } from "./toast.js";

export interface FolderNode {
  id: number;
  parent: number | null;
  name: string;
}

/** The page's writes; each rejects with a message the kit shows. */
export interface FolderActs {
  make: (name: string, parent: number | null) => Promise<FolderNode>;
  rename: (id: number, name: string) => Promise<unknown>;
  move: (id: number, to: number | null) => Promise<unknown>;
  drop: (id: number) => Promise<unknown>;
  /** Files items of this view (by key) into a folder; null unfiles. */
  file: (keys: string[], folder: number | null) => Promise<unknown>;
}

const FOLDER_DEPTH = 3;

const ITEM_TYPE = "application/x-wren-item";
const FOLDER_TYPE = "application/x-wren-folder";

const run = (p: Promise<unknown>) =>
  void p.catch((e: unknown) => toast.error(e instanceof Error ? e.message : String(e)));

const byName = (a: FolderNode, b: FolderNode) =>
  a.name.localeCompare(b.name, undefined, { sensitivity: "base", numeric: true });

/** Each folder's children, sorted; top level under null. */
function childrenOf(folders: readonly FolderNode[]) {
  const kids = new Map<number | null, FolderNode[]>();
  for (const f of folders) kids.set(f.parent, [...(kids.get(f.parent) ?? []), f]);
  for (const l of kids.values()) l.sort(byName);
  return kids;
}

/** Folders in tree order, each with its depth (top = 1). */
function folderOrder(folders: readonly FolderNode[]): { f: FolderNode; depth: number }[] {
  const kids = childrenOf(folders);
  const out: { f: FolderNode; depth: number }[] = [];
  const walk = (parent: number | null, depth: number) => {
    for (const f of kids.get(parent) ?? []) {
      out.push({ f, depth });
      walk(f.id, depth + 1);
    }
  };
  walk(null, 1);
  return out;
}

/** Drag a row of this view; a folder takes it on drop. */
export function dragItem(key: string) {
  return {
    draggable: true,
    onDragStart: (e: DragEvent) => {
      e.dataTransfer.setData(ITEM_TYPE, key);
      e.dataTransfer.effectAllowed = "move";
    },
  };
}

/** A drop target: a folder (its id) or the unfiled list (null). */
function useDrop(
  to: number | null,
  acts: FolderActs,
  can: (folder: number) => boolean = () => true,
) {
  const [over, setOver] = useState(false);
  const takes = (e: DragEvent) =>
    e.dataTransfer.types.includes(ITEM_TYPE) || e.dataTransfer.types.includes(FOLDER_TYPE);
  return {
    "data-over": over ? "" : undefined,
    onDragOver: (e: DragEvent) => {
      if (!takes(e)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      setOver(true);
    },
    onDragLeave: (e: DragEvent) => {
      if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver(false);
    },
    onDrop: (e: DragEvent) => {
      setOver(false);
      const item = e.dataTransfer.getData(ITEM_TYPE);
      const folder = Number(e.dataTransfer.getData(FOLDER_TYPE));
      if (!item && !folder) return;
      e.preventDefault();
      e.stopPropagation();
      if (item) run(acts.file([item], to));
      else if (folder !== to && can(folder)) run(acts.move(folder, to));
    },
  };
}

/** The unfiled list as a drop target: drop a row here to take it out of its folder. */
export function UnfiledDrop({
  acts,
  children,
  className,
}: {
  acts: FolderActs;
  children: ReactNode;
  className?: string;
}) {
  const drop = useDrop(null, acts);
  return (
    <div
      {...drop}
      className={cn(
        "rounded-[10px] transition-[background-color,box-shadow] duration-150 data-over:bg-(--ui-accent-tint) data-over:shadow-[inset_0_0_0_1px_var(--ui-link)]",
        className,
      )}
    >
      {children}
    </div>
  );
}

/** A folder's name, typed in place: Enter keeps it, Escape or an empty box drops it. */
function NameBox({ start, onDone }: { start: string; onDone: (name: string | null) => void }) {
  const [v, setV] = useState(start);
  const done = useRef(false);
  const end = (name: string | null) => {
    if (done.current) return;
    done.current = true;
    onDone(name?.trim() ? name.trim() : null);
  };
  return (
    <div className="flex items-center gap-2 rounded-[8px] bg-(--ui-fill) py-1 pr-1.5 pl-7">
      <Icon name="folder" size={15} className="flex-none text-(--ui-ink-2)" />
      {/* edit-ok: a folder name, saved on Enter and on blur */}
      <input
        // biome-ignore lint/a11y/noAutofocus: the box opens on a click that asked for it
        autoFocus
        aria-label="Folder name"
        value={v}
        maxLength={80}
        placeholder="Folder name"
        onChange={(e) => setV(e.target.value)}
        onFocus={(e) => e.currentTarget.select()}
        onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => {
          if (e.key === "Enter") end(v);
          if (e.key === "Escape") end(null);
        }}
        onBlur={() => end(v === start ? null : v)}
        className="h-7 min-w-0 flex-1 rounded-[6px] border-0 bg-(--ui-paper) px-2 text-[13.5px] text-(--ui-ink) outline-none focus-visible:shadow-[0_0_0_2px_var(--ui-focus)]"
      />
    </div>
  );
}

const MENU_ITEM =
  "flex min-h-8 w-full cursor-pointer items-center gap-2 rounded-(--ui-radius) py-1.5 pointer-coarse:min-h-11 border-0 bg-transparent px-2 text-left text-[13px] text-(--ui-ink) hover:bg-(--ui-hover) focus-visible:bg-(--ui-hover) focus-visible:outline-none disabled:cursor-default disabled:opacity-50";

const MORE_BUTTON =
  "inline-grid size-7 flex-none cursor-pointer place-items-center rounded-[6px] border-0 bg-transparent text-(--ui-ink-3) transition-[background-color,color,opacity] duration-150 hover:bg-(--ui-hover) hover:text-(--ui-ink) focus-visible:outline-2 focus-visible:outline-(--ui-focus) data-[popup-open]:bg-(--ui-hover) data-[popup-open]:text-(--ui-ink) pointer-coarse:size-9";

/** Folders to pick from, indented by depth; the current one checked. */
function FolderPicks({
  folders,
  current,
  skip,
  onPick,
}: {
  folders: readonly FolderNode[];
  current: number | null;
  /** Folders that cannot take it (a folder and those under it). */
  skip?: (f: FolderNode, depth: number) => boolean;
  onPick: (folder: number) => void;
}) {
  const list = folderOrder(folders).filter(({ f, depth }) => !skip?.(f, depth));
  if (!list.length)
    return <p className="m-0 px-2 py-1.5 text-[13px] text-(--ui-ink-3)">No other folders.</p>;
  return (
    <div className="grid max-h-[min(50dvh,320px)] overflow-y-auto [scrollbar-width:thin]">
      {list.map(({ f, depth }) => (
        <button
          key={f.id}
          type="button"
          className={MENU_ITEM}
          style={{ paddingLeft: `${8 + (depth - 1) * 14}px` }}
          aria-current={f.id === current ? "true" : undefined}
          onClick={() => onPick(f.id)}
        >
          <Icon name="folder" size={14} className="flex-none text-(--ui-ink-2)" />
          <span className="min-w-0 flex-1 wrap-anywhere">{f.name}</span>
          {f.id === current ? (
            <Icon name="check" size={14} className="flex-none text-(--ui-link)" />
          ) : null}
        </button>
      ))}
    </div>
  );
}

/**
 * A row's ⋯: move it to a folder, take it out, or make a folder for it. `extra` adds the row's
 * own items above (rename, open as a page).
 */
export function FolderMoveMenu({
  title,
  folders,
  current,
  acts,
  itemKey,
  extra,
  className,
}: {
  title: string;
  folders: readonly FolderNode[];
  current: number | null;
  acts: FolderActs;
  itemKey: string;
  extra?: ReactNode;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [making, setMaking] = useState(false);
  const close = () => {
    setOpen(false);
    setMaking(false);
  };
  return (
    <Popover open={open} onOpenChange={(o) => (o ? setOpen(true) : close())}>
      <PopoverTrigger
        aria-label={`More for ${title}`}
        {...tipProps("More", { as: "none" })}
        onClick={(e) => e.stopPropagation()}
        className={cn(MORE_BUTTON, className)}
      >
        <Icon name="more" size={16} />
      </PopoverTrigger>
      <PopoverContent
        align="end"
        initialFocus={(t) => t === "keyboard"}
        className="w-60 gap-0 bg-(--ui-paper) p-1 text-(--ui-ink)"
      >
        {extra}
        <p className="m-0 px-2 pt-1.5 pb-1 text-[12px] font-medium text-(--ui-ink-3)">
          Move to folder
        </p>
        <FolderPicks
          folders={folders}
          current={current}
          onPick={(f) => {
            close();
            if (f !== current) run(acts.file([itemKey], f));
          }}
        />
        {making ? (
          <NameBox
            start=""
            onDone={(name) => {
              close();
              if (name) run(acts.make(name, null).then((f) => acts.file([itemKey], f.id)));
            }}
          />
        ) : (
          <button type="button" className={MENU_ITEM} onClick={() => setMaking(true)}>
            <Icon name="plus" size={14} className="flex-none text-(--ui-ink-2)" />
            New folder…
          </button>
        )}
        {current != null ? (
          <button
            type="button"
            className={MENU_ITEM}
            onClick={() => {
              close();
              run(acts.file([itemKey], null));
            }}
          >
            <Icon name="close" size={14} className="flex-none text-(--ui-ink-2)" />
            Take out of folder
          </button>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}

type Pane = "menu" | "move" | "delete";

/** What a delete does to what the folder holds, in facts. */
function holds(items: number, subs: number, noun: (n: number) => string, parent?: string) {
  if (!items && !subs) return "It is empty.";
  const what = [
    items ? `${items} ${noun(items)}` : "",
    subs ? `${subs} ${subs === 1 ? "folder" : "folders"}` : "",
  ]
    .filter(Boolean)
    .join(" and ");
  const verb = items + subs === 1 ? "moves" : "move";
  return `Its ${what} ${verb} ${parent ? `to “${parent}”` : "out to the top level"}. Nothing else is deleted.`;
}

/** A folder's ⋯: rename, a folder inside, move, delete (asked first). */
function FolderMenu({
  f,
  depth,
  height,
  folders,
  count,
  noun,
  acts,
  onRename,
  onMakeIn,
}: {
  f: FolderNode;
  depth: number;
  /** Levels from this folder down: a leaf is 1. */
  height: number;
  folders: readonly FolderNode[];
  count: number;
  noun: (n: number) => string;
  acts: FolderActs;
  onRename: () => void;
  onMakeIn: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [pane, setPane] = useState<Pane>("menu");
  const close = () => {
    setOpen(false);
    setPane("menu");
  };
  const under = useMemo(() => {
    const set = new Set([f.id]);
    for (const { f: x } of folderOrder(folders))
      if (x.parent != null && set.has(x.parent)) set.add(x.id);
    return set;
  }, [f.id, folders]);
  const parent = folders.find((x) => x.id === f.parent);
  return (
    <Popover open={open} onOpenChange={(o) => (o ? setOpen(true) : close())}>
      <PopoverTrigger
        aria-label={`More for folder ${f.name}`}
        {...tipProps("More", { as: "none" })}
        onClick={(e) => e.stopPropagation()}
        className={cn(
          MORE_BUTTON,
          "opacity-0 group-hover/folder:opacity-100 group-focus-within/folder:opacity-100 data-[popup-open]:opacity-100 pointer-coarse:opacity-100",
        )}
      >
        <Icon name="more" size={16} />
      </PopoverTrigger>
      <PopoverContent
        align="end"
        initialFocus={(t) => t === "keyboard"}
        className="w-60 gap-0 bg-(--ui-paper) p-1 text-(--ui-ink)"
      >
        {pane === "menu" ? (
          <>
            <button
              type="button"
              className={MENU_ITEM}
              onClick={() => {
                close();
                onRename();
              }}
            >
              <Icon name="edit" size={14} className="flex-none text-(--ui-ink-2)" />
              Rename
            </button>
            <button
              type="button"
              className={MENU_ITEM}
              disabled={depth >= FOLDER_DEPTH}
              {...(depth >= FOLDER_DEPTH ? tipProps(`Folders nest ${FOLDER_DEPTH} deep`) : {})}
              onClick={() => {
                close();
                onMakeIn();
              }}
            >
              <Icon name="plus" size={14} className="flex-none text-(--ui-ink-2)" />
              New folder inside
            </button>
            <button type="button" className={MENU_ITEM} onClick={() => setPane("move")}>
              <Icon name="right" size={14} className="flex-none text-(--ui-ink-2)" />
              Move to…
            </button>
            <div className="mx-2 my-1 h-px bg-(--ui-hair)" />
            <button
              type="button"
              className={cn(MENU_ITEM, "text-(--ui-bad)")}
              onClick={() => setPane("delete")}
            >
              <Icon name="trash" size={14} className="flex-none" />
              Delete folder
            </button>
          </>
        ) : pane === "move" ? (
          <>
            <p className="m-0 px-2 pt-1.5 pb-1 text-[12px] font-medium text-(--ui-ink-3)">
              Move “{f.name}” to
            </p>
            {f.parent != null ? (
              <button
                type="button"
                className={MENU_ITEM}
                onClick={() => {
                  close();
                  run(acts.move(f.id, null));
                }}
              >
                <Icon name="up" size={14} className="flex-none text-(--ui-ink-2)" />
                Top level
              </button>
            ) : null}
            <FolderPicks
              folders={folders}
              current={f.parent}
              skip={(x, d) => under.has(x.id) || d + height > FOLDER_DEPTH}
              onPick={(to) => {
                close();
                if (to !== f.parent) run(acts.move(f.id, to));
              }}
            />
          </>
        ) : (
          <div className="grid gap-2 p-2">
            <p className="m-0 text-[13px] font-medium text-(--ui-ink)">Delete “{f.name}”?</p>
            <p className="m-0 text-[12.5px]/[1.45] text-(--ui-ink-2)">
              {holds(count, under.size - 1, noun, parent?.name)}
            </p>
            <div className="flex justify-end gap-1.5 pt-1">
              <Button tone="quiet" size="dense" onClick={close}>
                Cancel
              </Button>
              <Button
                tone="secondary"
                size="dense"
                className="text-(--ui-bad)"
                onClick={() => {
                  close();
                  run(acts.drop(f.id));
                }}
              >
                Delete
              </Button>
            </div>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}

const OPEN_KEY = (id: string) => `wren:folders:open:${id}`;
const readOpen = (id: string): Set<number> => {
  try {
    return new Set(JSON.parse(localStorage.getItem(OPEN_KEY(id)) ?? "[]") as number[]);
  } catch {
    return new Set();
  }
};
const keepOpen = (id: string, s: Set<number>) => {
  try {
    localStorage.setItem(OPEN_KEY(id), JSON.stringify([...s]));
  } catch {
    // private window: open state lasts the page
  }
};

/**
 * The tree, with this view's items in each folder. Open folders are kept per view on the device;
 * the folder of the open item opens by itself.
 */
export function FolderTree<T>({
  id,
  folders,
  items,
  keyOf,
  folderOf,
  renderItem,
  acts,
  noun,
  current,
  className,
}: {
  /** Names this view's open state on the device: `chats:weaver`, `subjects`. */
  id: string;
  folders: readonly FolderNode[];
  /** This view's items; the unfiled ones are skipped here. */
  items: readonly T[];
  keyOf: (item: T) => string;
  folderOf: (item: T) => number | null;
  renderItem: (item: T) => ReactNode;
  acts: FolderActs;
  /** "chat" / "chats". */
  noun: (n: number) => string;
  /** The open item's key: its folders open. */
  current?: string | null;
  className?: string;
}) {
  const [open, setOpen] = useState<Set<number>>(() => readOpen(id));
  const [renaming, setRenaming] = useState<number | null>(null);
  /** A new folder's box: under this parent (null = top). */
  const [making, setMaking] = useState<{ parent: number | null } | null>(null);
  const kids = useMemo(() => childrenOf(folders), [folders]);
  const byId = useMemo(() => new Map(folders.map((f) => [f.id, f])), [folders]);
  const inFolder = useMemo(() => {
    const m = new Map<number, T[]>();
    for (const it of items) {
      const f = folderOf(it);
      if (f != null && byId.has(f)) m.set(f, [...(m.get(f) ?? []), it]);
    }
    return m;
  }, [items, folderOf, byId]);
  const countOf = (fid: number): number =>
    (inFolder.get(fid)?.length ?? 0) + (kids.get(fid) ?? []).reduce((n, c) => n + countOf(c.id), 0);
  const heightOf = (fid: number): number =>
    1 + Math.max(0, ...(kids.get(fid) ?? []).map((c) => heightOf(c.id)));

  const toggle = (fid: number, to?: boolean) =>
    setOpen((s) => {
      const n = new Set(s);
      if (to ?? !n.has(fid)) n.add(fid);
      else n.delete(fid);
      keepOpen(id, n);
      return n;
    });

  // the open item's folders open
  const currentFolder = useMemo(() => {
    const it = current ? items.find((i) => keyOf(i) === current) : undefined;
    return it ? folderOf(it) : null;
  }, [current, items, keyOf, folderOf]);
  useEffect(() => {
    if (currentFolder == null) return;
    setOpen((s) => {
      const n = new Set(s);
      for (
        let f = byId.get(currentFolder);
        f;
        f = f.parent == null ? undefined : byId.get(f.parent)
      )
        n.add(f.id);
      return n.size === s.size ? s : n;
    });
  }, [currentFolder, byId]);

  const make = (parent: number | null) => {
    if (parent != null) toggle(parent, true);
    setMaking({ parent });
  };

  const node = (f: FolderNode, depth: number): ReactNode => {
    const isOpen = open.has(f.id);
    const own = inFolder.get(f.id) ?? [];
    const sub = kids.get(f.id) ?? [];
    const n = countOf(f.id);
    return (
      <li key={f.id} className="grid gap-px">
        {renaming === f.id ? (
          <NameBox
            start={f.name}
            onDone={(name) => {
              setRenaming(null);
              if (name && name !== f.name) run(acts.rename(f.id, name));
            }}
          />
        ) : (
          <FolderRow
            f={f}
            open={isOpen}
            count={n}
            acts={acts}
            canTake={(moving) => {
              // not into itself or below it, nor past the depth cap
              for (
                let a: FolderNode | undefined = f;
                a;
                a = a.parent == null ? undefined : byId.get(a.parent)
              )
                if (a.id === moving) return false;
              return depth + heightOf(moving) <= FOLDER_DEPTH;
            }}
            onToggle={() => toggle(f.id)}
            menu={
              <FolderMenu
                f={f}
                depth={depth}
                height={heightOf(f.id)}
                folders={folders}
                count={n}
                noun={noun}
                acts={acts}
                onRename={() => setRenaming(f.id)}
                onMakeIn={() => make(f.id)}
              />
            }
          />
        )}
        {isOpen ? (
          <div
            // the rule sits under the chevron; each level's box indents its own rows
            className="ml-[14px] grid gap-px border-l border-(--ui-hair) pl-1.5"
          >
            {making?.parent === f.id ? (
              <NameBox
                start=""
                onDone={(name) => {
                  setMaking(null);
                  if (name) run(acts.make(name, f.id));
                }}
              />
            ) : null}
            {sub.length ? (
              <ul className="m-0 grid list-none gap-px p-0">
                {sub.map((c) => node(c, depth + 1))}
              </ul>
            ) : null}
            {own.map((it) => (
              <div key={keyOf(it)} {...dragItem(keyOf(it))}>
                {renderItem(it)}
              </div>
            ))}
            {!own.length && !sub.length && making?.parent !== f.id ? (
              <p className="m-0 py-1.5 pl-3 text-[12.5px] text-(--ui-ink-3)">
                Empty. Drag {noun(2)} here, or use a {noun(1)}’s ⋯.
              </p>
            ) : null}
          </div>
        ) : null}
      </li>
    );
  };

  const top = kids.get(null) ?? [];
  return (
    <section aria-label="Folders" className={cn("grid gap-px", className)}>
      <div className="flex items-center gap-2 pr-1 pb-1 pl-2.5">
        <h3 className="m-0 flex-1 text-[12px] font-medium text-(--ui-ink-3)">Folders</h3>
        <button
          type="button"
          aria-label="New folder"
          {...tipProps("New folder")}
          onClick={() => make(null)}
          className={MORE_BUTTON}
        >
          <Icon name="plus" size={15} />
        </button>
      </div>
      {making?.parent === null ? (
        <NameBox
          start=""
          onDone={(name) => {
            setMaking(null);
            if (name) run(acts.make(name, null));
          }}
        />
      ) : null}
      {top.length ? (
        <ul className="m-0 grid list-none gap-px p-0">{top.map((f) => node(f, 1))}</ul>
      ) : making ? null : (
        <button
          type="button"
          onClick={() => make(null)}
          className="flex cursor-pointer items-center gap-2 rounded-[8px] border-0 bg-transparent py-2 pr-2.5 pl-3 text-left text-[13px] text-(--ui-ink-3) transition-[background-color,color] duration-150 hover:bg-(--ui-fill) hover:text-(--ui-ink)"
        >
          <Icon name="folder" size={15} className="flex-none" />
          Group {noun(2)} in folders
        </button>
      )}
    </section>
  );
}

/** A tree row's fold mark: right when shut, down when open. FolderTree and Explorer's List share it. */
export function FoldChevron({ open }: { open: boolean }) {
  return (
    <Icon
      name="right"
      size={12}
      className={cn(
        "flex-none text-(--ui-ink-3) transition-transform duration-200 ease-(--ui-ease) motion-reduce:transition-none",
        open && "rotate-90",
      )}
    />
  );
}

/** A folder's own row: open or close, a drop target, and its ⋯. Dragging it moves the folder. */
function FolderRow({
  f,
  open,
  count,
  acts,
  canTake,
  onToggle,
  menu,
}: {
  f: FolderNode;
  open: boolean;
  count: number;
  acts: FolderActs;
  canTake: (folder: number) => boolean;
  onToggle: () => void;
  menu: ReactNode;
}) {
  const drop = useDrop(f.id, acts, canTake);
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: a drag and drop target; the ⋯ "Move to…" does the same by click and key.
    <div
      {...drop}
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData(FOLDER_TYPE, String(f.id));
        e.dataTransfer.effectAllowed = "move";
      }}
      className="group/folder flex items-center gap-1 rounded-[8px] pr-1 transition-[background-color,box-shadow] duration-150 hover:bg-(--ui-fill) data-over:bg-(--ui-accent-tint) data-over:shadow-[inset_0_0_0_1px_var(--ui-link)]"
    >
      <button
        type="button"
        aria-expanded={open}
        onClick={onToggle}
        className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 rounded-[8px] border-0 bg-transparent py-2 pr-1 pl-2 text-left text-(--ui-ink) focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-(--ui-focus)"
      >
        <FoldChevron open={open} />
        <Icon name="folder" size={15} className="flex-none text-(--ui-ink-2)" />
        <span className="min-w-0 flex-1 text-[13.5px]/[1.4] font-medium wrap-anywhere">
          {f.name}
        </span>
        {count ? (
          <span className="flex-none text-[11.5px] text-(--ui-ink-3) tabular-nums">{count}</span>
        ) : null}
      </button>
      {menu}
    </div>
  );
}

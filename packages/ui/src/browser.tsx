/**
 * A browser: folders at the left, the folder's rows in the middle, the open row at the right.
 * Organization first, so niches, SOPs, offers and settings reuse it. Under 1024px the tree folds
 * into a breadcrumb, and an open row takes the whole width with a way back.
 */
import { type DragEvent, type ReactNode, useMemo, useState } from "react";
import { cx } from "./format.js";
import { Icon } from "./icons.js";

/** A folder by its path (`outbound/plain`) and how many rows sit directly in it. */
export interface BrowserFolder {
  path: string;
  count: number;
}

interface Node {
  path: string;
  name: string;
  /** Rows in it and every folder under it. */
  count: number;
  children: Node[];
}

/**
 * The folders as a tree: every parent of a path is a folder too, counts summed upward. `nameOf`
 * turns a path's last part into what people read ("sec_ria" to "SEC RIA"); siblings sort by it.
 */
export function folderTree(
  folders: readonly BrowserFolder[],
  nameOf: (part: string) => string = (part) => part,
): Node[] {
  const all = new Map<string, Node>();
  const roots: Node[] = [];
  const nodeOf = (path: string): Node => {
    const had = all.get(path);
    if (had) return had;
    const cut = path.lastIndexOf("/");
    const node: Node = { path, name: nameOf(path.slice(cut + 1)), count: 0, children: [] };
    all.set(path, node);
    if (cut < 0) roots.push(node);
    else nodeOf(path.slice(0, cut)).children.push(node);
    return node;
  };
  for (const f of folders) {
    if (!f.path) continue;
    nodeOf(f.path);
    for (let p = f.path; p; p = p.slice(0, Math.max(0, p.lastIndexOf("/"))))
      (all.get(p) as Node).count += f.count;
  }
  const sort = (ns: Node[]) => {
    ns.sort((x, y) => x.name.localeCompare(y.name));
    for (const n of ns) sort(n.children);
  };
  sort(roots);
  return roots;
}

/** What a row being dragged carries: its id. */
const DRAG = "application/x-wren-row";

const dropped = (e: DragEvent, to: string, onDrop?: (folder: string, id: string) => void) => {
  const id = e.dataTransfer.getData(DRAG);
  if (!id || !onDrop) return;
  e.preventDefault();
  onDrop(to, id);
};

function Folder({
  node,
  depth,
  at,
  shut,
  onFolder,
  onToggle,
  onDrop,
}: {
  node: Node;
  depth: number;
  at: string;
  shut: ReadonlySet<string>;
  onFolder: (path: string) => void;
  onToggle: (path: string) => void;
  onDrop?: ((folder: string, id: string) => void) | undefined;
}) {
  const [over, setOver] = useState(false);
  const open = !shut.has(node.path);
  return (
    <li>
      {/* biome-ignore lint/a11y/noStaticElementInteractions: a drop target; "Move to folder" does the same by click and key. */}
      <div
        className={cx(
          "group flex h-8 items-center gap-1 pr-2 text-[13.5px]",
          at === node.path ? "bg-(--ui-fill) font-medium" : "hover:bg-(--ui-hover)",
          over && "outline-2 -outline-offset-2 outline-(--ui-accent)",
        )}
        style={{ paddingLeft: 4 + depth * 14 }}
        onDragOver={(e) => {
          if (!onDrop || !e.dataTransfer.types.includes(DRAG)) return;
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          setOver(false);
          dropped(e, node.path, onDrop);
        }}
      >
        {node.children.length ? (
          <button
            type="button"
            aria-label={open ? `Close ${node.name}` : `Open ${node.name}`}
            aria-expanded={open}
            onClick={() => onToggle(node.path)}
            className="border-0 bg-transparent cursor-pointer inline-flex size-5 shrink-0 items-center justify-center text-(--ui-ink-3) hover:text-(--ui-ink)"
          >
            <Icon name={open ? "down" : "right"} className="size-3.5" />
          </button>
        ) : (
          <span className="size-5 shrink-0" />
        )}
        <button
          type="button"
          onClick={() => onFolder(node.path)}
          aria-current={at === node.path ? "true" : undefined}
          className="border-0 bg-transparent cursor-pointer min-w-0 flex-1 truncate text-left"
        >
          {node.name}
        </button>
        <span className="text-[12px] text-(--ui-ink-2) tabular-nums">{node.count}</span>
      </div>
      {open && node.children.length ? (
        <ul className="list-none">
          {node.children.map((c) => (
            <Folder
              key={c.path}
              node={c}
              depth={depth + 1}
              at={at}
              shut={shut}
              onFolder={onFolder}
              onToggle={onToggle}
              onDrop={onDrop}
            />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

/** Where you are under 1024px: each folder up the path, then the folders inside this one. */
function Breadcrumb({
  tree,
  at,
  rootLabel,
  total,
  onFolder,
  nameOf,
}: {
  tree: Node[];
  at: string;
  rootLabel: string;
  total: number;
  onFolder: (path: string) => void;
  nameOf: (part: string) => string;
}) {
  const parts = at ? at.split("/") : [];
  let here: Node[] = tree;
  for (const [i] of parts.entries())
    here = here.find((n) => n.path === parts.slice(0, i + 1).join("/"))?.children ?? [];
  const crumb =
    "border-0 bg-transparent cursor-pointer text-(--ui-ink-2) underline decoration-(--ui-ink-3) underline-offset-[0.24em]";
  return (
    <nav aria-label="Folders" className="grid gap-2 lg:hidden">
      <ol className="list-none flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[14px]">
        <li>
          {parts.length ? (
            <button type="button" className={crumb} onClick={() => onFolder("")}>
              {rootLabel}
            </button>
          ) : (
            <span className="font-medium">
              {rootLabel} <span className="text-(--ui-ink-2) tabular-nums">{total}</span>
            </span>
          )}
        </li>
        {parts.map((p, i) => {
          const path = parts.slice(0, i + 1).join("/");
          return (
            <li key={path} className="flex items-center gap-1.5">
              <span className="text-(--ui-ink-3)" aria-hidden>
                /
              </span>
              {i === parts.length - 1 ? (
                <span className="font-medium" aria-current="true">
                  {nameOf(p)}
                </span>
              ) : (
                <button type="button" className={crumb} onClick={() => onFolder(path)}>
                  {nameOf(p)}
                </button>
              )}
            </li>
          );
        })}
      </ol>
      {here.length ? (
        <ul className="list-none flex flex-wrap gap-1.5">
          {here.map((n) => (
            <li key={n.path}>
              <button
                type="button"
                onClick={() => onFolder(n.path)}
                className="border-0 bg-transparent cursor-pointer inline-flex h-8 items-center gap-1.5 border border-(--ui-hair) px-2.5 text-[13px] hover:bg-(--ui-hover)"
              >
                {n.name}
                <span className="text-(--ui-ink-2) tabular-nums">{n.count}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </nav>
  );
}

/** A row in the middle: press to open it; drag it onto a folder to move it there. */
export function BrowserRow({
  id,
  open,
  onOpen,
  draggable = false,
  children,
}: {
  id: string;
  open: boolean;
  onOpen: () => void;
  draggable?: boolean;
  children: ReactNode;
}) {
  return (
    <li
      draggable={draggable}
      onDragStart={(e) => {
        e.dataTransfer.setData(DRAG, id);
        e.dataTransfer.effectAllowed = "move";
      }}
      className="border-b border-(--ui-hair)"
    >
      <button
        type="button"
        onClick={onOpen}
        aria-current={open ? "true" : undefined}
        className={cx(
          "border-0 bg-transparent cursor-pointer grid w-full gap-0.5 px-3 py-2.5 text-left",
          open ? "bg-(--ui-fill)" : "hover:bg-(--ui-hover)",
        )}
      >
        {children}
      </button>
    </li>
  );
}

export function Browser({
  label,
  folders,
  folder,
  onFolder,
  rootLabel = "All",
  folderActions,
  onDrop,
  head,
  list,
  detail,
  placeholder,
  onClose,
  nameOf = (part) => part,
}: {
  /** What it browses, for screen readers: "Templates". */
  label: string;
  folders: readonly BrowserFolder[];
  /** The folder shown, "" for all. */
  folder: string;
  onFolder: (path: string) => void;
  rootLabel?: string;
  /** Beside the folder's name, such as Rename. */
  folderActions?: ReactNode;
  /** A row dropped on a folder (or on the root, ""). Left out, rows don't drag. */
  onDrop?: ((folder: string, id: string) => void) | undefined;
  /** Over the rows: search and filters. */
  head?: ReactNode;
  /** The rows, as `<BrowserRow>`s in a `<ul>`, or what's said when there are none. */
  list: ReactNode;
  /** The open row; null when none is open. */
  detail: ReactNode | null;
  /** Where the open row goes, while none is (1024px and up). */
  placeholder?: ReactNode;
  /** Back from the open row under 1024px. */
  onClose: () => void;
  /** What people read for a folder path's part; the path itself by default. */
  nameOf?: (part: string) => string;
}) {
  const tree = useMemo(() => folderTree(folders, nameOf), [folders, nameOf]);
  const total = folders.reduce((t, f) => t + f.count, 0);
  const [shut, setShut] = useState<ReadonlySet<string>>(new Set());
  const toggle = (path: string) =>
    setShut((s) => {
      const next = new Set(s);
      if (!next.delete(path)) next.add(path);
      return next;
    });
  const [overRoot, setOverRoot] = useState(false);
  const title = folder ? nameOf(folder.slice(folder.lastIndexOf("/") + 1)) : rootLabel;
  return (
    <section
      aria-label={label}
      className="grid min-w-0 gap-4 lg:grid-cols-[200px_minmax(260px,320px)_minmax(0,1fr)] lg:gap-0"
    >
      <nav
        aria-label="Folders"
        className="hidden min-w-0 border-r border-(--ui-hair) pr-2 lg:block"
      >
        {/* biome-ignore lint/a11y/noStaticElementInteractions: a drop target; "Move to folder" does the same by click and key. */}
        <div
          className={cx(
            "flex h-8 items-center gap-1 pr-2 pl-1 text-[13.5px]",
            folder === "" ? "bg-(--ui-fill) font-medium" : "hover:bg-(--ui-hover)",
            overRoot && "outline-2 -outline-offset-2 outline-(--ui-accent)",
          )}
          onDragOver={(e) => {
            if (!onDrop || !e.dataTransfer.types.includes(DRAG)) return;
            e.preventDefault();
            setOverRoot(true);
          }}
          onDragLeave={() => setOverRoot(false)}
          onDrop={(e) => {
            setOverRoot(false);
            dropped(e, "", onDrop);
          }}
        >
          <button
            type="button"
            onClick={() => onFolder("")}
            aria-current={folder === "" ? "true" : undefined}
            className="border-0 bg-transparent cursor-pointer min-w-0 flex-1 truncate pl-1 text-left"
          >
            {rootLabel}
          </button>
          <span className="text-[12px] text-(--ui-ink-2) tabular-nums">{total}</span>
        </div>
        <ul className="list-none">
          {tree.map((n) => (
            <Folder
              key={n.path}
              node={n}
              depth={0}
              at={folder}
              shut={shut}
              onFolder={onFolder}
              onToggle={toggle}
              onDrop={onDrop}
            />
          ))}
        </ul>
      </nav>
      <div
        className={cx(
          "min-w-0 lg:border-r lg:border-(--ui-hair) lg:px-3",
          detail !== null && "hidden lg:block",
        )}
      >
        <Breadcrumb
          tree={tree}
          at={folder}
          rootLabel={rootLabel}
          total={total}
          onFolder={onFolder}
          nameOf={nameOf}
        />
        <div className="mt-3 hidden h-8 items-center justify-between gap-2 lg:mt-0 lg:flex">
          <h2 className="truncate text-[15px] font-semibold">{title}</h2>
          {folderActions}
        </div>
        {folderActions ? <div className="mt-2 lg:hidden">{folderActions}</div> : null}
        {head ? <div className="mt-3 grid gap-2">{head}</div> : null}
        <div className="mt-3">{list}</div>
      </div>
      {detail !== null ? (
        <div className="min-w-0 lg:pl-5">
          <button
            type="button"
            onClick={onClose}
            className="border-0 bg-transparent cursor-pointer mb-3 inline-flex items-center gap-1.5 text-[14px] text-(--ui-ink-2) hover:text-(--ui-ink) lg:hidden"
          >
            <Icon name="left" className="size-4" />
            {title}
          </button>
          {detail}
        </div>
      ) : (
        <div className="hidden min-w-0 lg:block lg:pl-5">{placeholder}</div>
      )}
    </section>
  );
}

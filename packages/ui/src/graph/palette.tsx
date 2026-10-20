/**
 * The palette beside a graph editor: things to drag onto the canvas or click to add, in groups,
 * with a search. The workflow editor's palette and the Map's are this one part; each builds its
 * own groups and passes them in. A panel that floats over a canvas's edge is here too, since the
 * palette is the first.
 */
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { Input } from "../components/ui/input.js";
import { Button, Tag } from "../controls.js";
import { cx } from "../format.js";
import { tipProps } from "../hint.js";
import { Icon, type IconName } from "../icons.js";
import { GRAPH_DROP } from "./model.js";

/** A panel floats over the canvas's edge, n8n-style, and scrolls inside. */
export const FLOAT_PANEL =
  "absolute top-3 z-10 grid max-h-[calc(100%-24px)] min-w-0 grid-cols-[minmax(0,1fr)] content-start gap-5 overflow-x-hidden overflow-y-auto border border-(--ui-hair) bg-(--ui-paper) p-4 text-[13.5px] shadow-(--ui-shadow)";
const LEFT = "left-3 w-[280px]";
const HEAD = "text-[11.5px] font-semibold tracking-[0.04em] text-(--ui-ink-3) uppercase";

/** A titled block in a panel. Its title is an h3, or an h2 where no h2 comes before it. */
export function PanelBlock({
  title,
  level = 3,
  children,
}: {
  title: string;
  level?: 2 | 3;
  children: ReactNode;
}) {
  const Title = level === 2 ? "h2" : "h3";
  return (
    <section className="grid gap-2">
      <Title className={HEAD}>{title}</Title>
      {children}
    </section>
  );
}

/** One thing to add. `tint` is a CSS color for its tile; `glyph` draws an icon in the tile. */
export interface PaletteEntry {
  id: string;
  name: string;
  blurb: string;
  ready: boolean;
  effects: readonly string[];
  tint: string;
  glyph?: IconName;
}
export interface PaletteGroup {
  title: string;
  entries: readonly PaletteEntry[];
}

/** One thing to add: its tile, name and line; dragged onto the canvas or clicked. */
function Item({
  id,
  name,
  blurb,
  ready,
  effects,
  tint,
  glyph,
  active,
  onAdd,
}: PaletteEntry & { active: boolean; onAdd: (id: string) => void }) {
  return (
    <li
      className={ready ? undefined : "cursor-not-allowed"}
      {...tipProps(ready ? null : "In development")}
    >
      <button
        type="button"
        draggable={ready}
        disabled={!ready}
        onDragStart={(e) => {
          e.dataTransfer.setData(GRAPH_DROP, id);
          e.dataTransfer.effectAllowed = "copy";
        }}
        onClick={() => onAdd(id)}
        className={cx(
          "flex w-full cursor-grab items-start gap-2.5 border-0 bg-transparent px-2 py-2 text-left hover:bg-(--ui-hover) disabled:pointer-events-none disabled:opacity-55",
          active && "bg-(--ui-hover)",
        )}
        {...tipProps(ready ? "Drag onto the canvas, or click to add" : null, { as: "none" })}
      >
        <span
          aria-hidden="true"
          className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-[6px] text-(--ui-ink)"
          style={{ background: `color-mix(in oklch, ${tint} 22%, var(--ui-paper))` }}
        >
          {glyph ? <Icon name={glyph} size={14} /> : null}
        </span>
        <span className="grid min-w-0 flex-1 gap-0.5">
          <span className="flex items-center gap-2 text-[13px] font-semibold text-(--ui-ink)">
            <span className="truncate">{name}</span>
            {!ready ? <Tag>In development</Tag> : null}
            {effects.length ? <Tag tone="accent">{effects.join(", ")}</Tag> : null}
          </span>
          <span className="line-clamp-2 text-[12px] leading-[1.4] text-(--ui-ink-2)">{blurb}</span>
        </span>
      </button>
    </li>
  );
}

/**
 * The palette: groups of things to add. Its search is focused when it opens; Enter adds the
 * first match, Escape closes it. A group with no match is left out.
 */
export function PaletteDrawer({
  groups,
  onAdd,
  onClose,
  label = "Add a node",
  className,
}: {
  groups: readonly PaletteGroup[];
  onAdd: (id: string) => void;
  onClose: () => void;
  /** The panel's name, and the search's. */
  label?: string;
  /** Where it sits, when not floating over the canvas's left edge. */
  className?: string;
}) {
  const [q, setQ] = useState("");
  const box = useRef<HTMLInputElement>(null);
  useEffect(() => box.current?.focus(), []);
  const shown = useMemo(() => {
    const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
    const hit = (e: PaletteEntry) =>
      words.every((w) => `${e.name} ${e.blurb} ${e.id}`.toLowerCase().includes(w));
    return groups
      .map((g) => [g.title, g.entries.filter(hit)] as const)
      .filter(([, list]) => list.length);
  }, [groups, q]);
  const first = shown.flatMap(([, l]) => l).find((e) => e.ready);
  return (
    <section aria-label={label} className={cx(FLOAT_PANEL, className ?? LEFT, "gap-3 p-3")}>
      <div className="flex items-center gap-2">
        <span className="relative flex-1">
          <Icon
            name="search"
            size={14}
            className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-(--ui-ink-3)"
          />
          {/* edit-ok: search box */}
          <Input
            ref={box}
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") onClose();
              if (e.key === "Enter" && first) onAdd(first.id);
            }}
            placeholder="Search nodes"
            aria-label="Search nodes"
            className="h-8 pl-8 text-[13px]"
          />
        </span>
        <Button
          tone="quiet"
          size="dense"
          onClick={onClose}
          aria-label="Close"
          {...tipProps("Close", { as: "none" })}
        >
          <Icon name="close" />
        </Button>
      </div>
      <p className="text-[12px] text-(--ui-ink-2)">Drag one onto the canvas, or click it.</p>
      {shown.length ? (
        shown.map(([title, list]) => (
          <PanelBlock key={title} title={title} level={2}>
            <ul className="m-0 -mx-1 grid list-none gap-0.5 p-0">
              {list.map((e) => (
                <Item key={e.id} {...e} active={e === first && !!q} onAdd={onAdd} />
              ))}
            </ul>
          </PanelBlock>
        ))
      ) : (
        <p className="text-(--ui-ink-2)">Nothing matches.</p>
      )}
    </section>
  );
}

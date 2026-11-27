/**
 * A list as cards (designs/2026-11-26-approve-cards.md): one page's only view, no Rows / Cards
 * switch. The List keeps the rows, cursor, picks, tiers, groups and actions; a card is one more
 * way to draw a row. Brought back from the 10-21 grid (`882dfc5d0^`), without its switch.
 */
import type { FieldMeta, RecordMeta, Thumb } from "@wren/core/records";
import type { Row } from "@wren/core/records/serve";
import { cn } from "cn";
import { type ReactNode, useState } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "./components/ui/popover.js";
import { Tag } from "./controls.js";
import { cueOf, FieldCell, StateMark, shownOf } from "./fields.js";
import { Icon } from "./icons.js";
import { type Place, textOf } from "./records-types.js";
import { Age, type RowsWait } from "./rows.js";

/** What a page's card shows beyond the record's title and subtitle: field keys. */
export interface CardSpec {
  /** Top left: a platform or channel field, as its mark and word; any other field, as its words. */
  mark?: string | null;
  /** Top right: what the row is ("Post draft"), beside its wait. */
  kind?: string | null;
  /** Under the text: why it waits ("Held because"). */
  note?: string | null;
  /** Foot left: when it goes ("Sends"). */
  foot?: string | null;
  /** The row's picture (the type's `thumbs`): its shape. */
  media?: CardMedia | null;
}
export type CardMedia = "wide" | "square" | "tall";
const MEDIA_RATIO: Record<CardMedia, string> = {
  wide: "16 / 9",
  square: "1 / 1",
  tall: "4 / 5",
};

/** A card's parts as fields; a key the type lacks is null. */
export interface CardParts {
  mark: FieldMeta | null;
  kind: FieldMeta | null;
  note: FieldMeta | null;
  foot: FieldMeta | null;
  body: FieldMeta | null;
  media: CardMedia | null;
}

export function cardPartsOf(meta: RecordMeta, spec: CardSpec, foldedBy?: string | null): CardParts {
  // a fold's head already names its value: the card drops it
  const field = (key: string | null | undefined) =>
    key && key !== foldedBy ? (meta.fields.find((f) => f.key === key) ?? null) : null;
  return {
    mark: field(spec.mark),
    kind: field(spec.kind),
    note: field(spec.note),
    foot: field(spec.foot),
    body: field(meta.subtitle),
    media: spec.media ?? null,
  };
}

/** A card's ground, shared by every card face (this grid, Shop). */
export const CARD_SURFACE =
  "rounded-(--ui-radius-panel) shadow-(--ui-raise) transition-[background-color,box-shadow] duration-150 ease-(--ui-ease) motion-reduce:transition-none";
/** A card's title. */
export const CARD_TITLE = "text-[15px] leading-5 font-semibold text-(--ui-ink)";

/** As many as fit, 240px at least; one across on a phone. */
const GRID =
  "m-0 grid list-none grid-cols-[repeat(auto-fill,minmax(min(100%,240px),1fr))] gap-3 p-0";

const PLACEHOLDERS = ["a", "b", "c", "d", "e", "f", "g", "h"];

/** The grid: placeholder cards while it reads. */
export function CardGrid({
  label,
  loading,
  children,
}: {
  label: string;
  loading: boolean;
  children: ReactNode;
}) {
  return (
    <ul aria-label={label} aria-busy={loading || undefined} className={GRID}>
      {loading
        ? PLACEHOLDERS.map((k) => (
            <li
              key={k}
              aria-hidden
              className={cn(CARD_SURFACE, "grid gap-2 bg-(--ui-paper) px-4 py-3.5")}
            >
              <span className="h-3 w-1/3 animate-pulse rounded-(--ui-radius) bg-(--ui-fill)" />
              <span className="h-4 w-4/5 animate-pulse rounded-(--ui-radius) bg-(--ui-fill)" />
              <span className="aspect-video animate-pulse rounded-(--ui-radius) bg-(--ui-fill)" />
              <span className="h-3 w-full animate-pulse rounded-(--ui-radius) bg-(--ui-fill)" />
            </li>
          ))
        : children}
    </ul>
  );
}

/** A band across every column: a tier's or a group's name; a group's folds on a press. */
export function CardHead({
  children,
  fold,
}: {
  children: ReactNode;
  fold?: { shut: boolean; toggle: () => void } | undefined;
}) {
  return (
    <li className="col-span-full pt-3 text-[12.5px] font-semibold text-(--ui-ink-2) first:pt-0">
      {fold ? (
        <button
          type="button"
          aria-expanded={!fold.shut}
          onClick={fold.toggle}
          className="inline-flex h-7 cursor-pointer items-center gap-1.5 rounded-(--ui-radius) border-0 bg-transparent px-1 text-inherit hover:text-(--ui-ink) pointer-coarse:h-11"
        >
          <Icon
            name="down"
            size={14}
            className={cn(
              "transition-transform duration-150 motion-reduce:transition-none",
              fold.shut && "-rotate-90",
            )}
          />
          {children}
        </button>
      ) : (
        <span className="inline-flex items-center gap-1.5 px-1">{children}</span>
      )}
    </li>
  );
}

/** A row as a card: mark, kind and wait; title; picture; the whole text; note; foot and actions. */
export function RecordCard({
  row,
  index,
  parts,
  title,
  href,
  thumb,
  pending,
  wait,
  quiet,
  cursor,
  open,
  picked,
  anyPicked,
  going,
  changed,
  onPick,
  onOpen,
  onSettled,
  actions,
  box,
}: {
  row: Row;
  index: number;
  parts: CardParts;
  title: string;
  href: string;
  /** Its picture, when it has one. */
  thumb: Thumb | undefined;
  /** Pictures are still on their way: a quiet box holds the place. */
  pending: boolean;
  wait: RowsWait | null;
  /** For info: its words read quieter. */
  quiet: boolean;
  cursor: boolean;
  open: boolean;
  picked: boolean;
  anyPicked: boolean;
  /** An optimistic press's word while the server answers. */
  going: string | undefined;
  changed: boolean;
  onPick: (range: boolean) => void;
  onOpen: () => void;
  onSettled: () => void;
  actions: ReactNode;
  /** Its open box (a reason, a new name): in place of its actions, so no other card moves. */
  box?: ReactNode;
}) {
  const text = (f: FieldMeta | null) => (f ? textOf(row[f.key]) : "");
  const mark = parts.mark ? cueOf(parts.mark, text(parts.mark)) : null;
  // a field with no mark (a subject's name): its words, wrapped
  const markWords = parts.mark && !mark ? shownOf(parts.mark, text(parts.mark)) : "";
  const kind = parts.kind ? wordOf(parts.kind, text(parts.kind)) : "";
  const media = parts.media && (thumb || pending) ? parts.media : null;
  const body = text(parts.body);
  const note = text(parts.note);
  const foot = parts.foot && text(parts.foot) ? parts.foot : null;
  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: the list's keys walk and open it; its title is the link.
    <li
      data-row={index}
      data-cursor={cursor && !open ? "" : undefined}
      aria-current={open ? "true" : undefined}
      onClick={(e) => {
        if (
          (e.target as Element).closest("input, textarea, a, button, label, video, [role=dialog]")
        )
          return;
        onOpen();
      }}
      onAnimationEnd={(e) => {
        if (e.animationName === "ui-changed" && e.target === e.currentTarget) onSettled();
      }}
      className={cn(
        CARD_SURFACE,
        "group flex min-w-0 cursor-pointer flex-col gap-2 px-4 py-3.5",
        // on the wallpaper a hairline ring holds the glass's edge, at night too (v116 --tile-shadow)
        "in-data-wallpaper:shadow-[0_0_0_1px_var(--ui-hair),var(--ui-raise)]",
        open || picked
          ? "bg-(--ui-accent-tint)"
          : cursor
            ? "bg-(--ui-accent-wash)"
            : "bg-(--ui-paper) hover:bg-(--ui-accent-wash) in-data-wallpaper:bg-(--ui-window) in-data-wallpaper:[backdrop-filter:var(--ui-window-blur)] in-data-wallpaper:hover:bg-(--ui-accent-wash)",
        going && "bg-(--ui-wash)",
        changed && "animate-ui-changed",
      )}
    >
      <div className="flex min-h-5 min-w-0 items-start gap-2 text-[12.5px]">
        {/* site, then kind and wait under it on every card, so titles in a row line up; the box keeps its corner */}
        <div className="flex min-w-0 flex-1 flex-col items-start gap-1">
          {mark ? (
            <span className="min-w-0 font-medium text-(--ui-ink)">
              <StateMark state={mark} />
            </span>
          ) : markWords ? (
            <span className="min-w-0 font-medium wrap-anywhere text-(--ui-ink)">{markWords}</span>
          ) : null}
          <span className="flex min-w-0 flex-wrap items-center gap-x-1 text-(--ui-ink-2)">
            {kind ? <span>{kind}</span> : null}
            {kind && wait ? <span aria-hidden>·</span> : null}
            {wait ? <Age {...wait} className="text-[12.5px]" /> : null}
          </span>
        </div>
        <label
          className={cn(
            "-my-0.5 grid size-6 shrink-0 cursor-pointer place-items-center transition-opacity duration-150 motion-reduce:transition-none pointer-coarse:size-11",
            picked || anyPicked
              ? "opacity-100"
              : "opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 group-data-cursor:opacity-100 pointer-coarse:opacity-100",
          )}
        >
          <input
            type="checkbox"
            aria-label={`Select ${title}`}
            checked={picked}
            onChange={() => {}}
            onClick={(e) => onPick(e.shiftKey)}
            className="size-3.5 accent-(--ui-ink)"
          />
        </label>
      </div>
      <a
        href={href}
        onClick={(e) => {
          // A plain click opens it beside the list, as a row's name does.
          if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
          e.preventDefault();
          onOpen();
        }}
        className={cn(CARD_TITLE, "wrap-anywhere no-underline hover:underline")}
      >
        {title || <span className="text-(--ui-ink-3)">Untitled</span>}
      </a>
      {media ? (
        <div
          className="overflow-hidden rounded-[calc(var(--ui-radius-panel)-6px)] bg-(--ui-fill)"
          style={{ aspectRatio: MEDIA_RATIO[media] }}
        >
          {thumb ? <Picture thumb={thumb} /> : <div className="size-full animate-pulse" />}
        </div>
      ) : null}
      {body ? (
        <p
          className={cn(
            "m-0 text-[13.5px] leading-normal wrap-anywhere whitespace-pre-line",
            quiet ? "text-(--ui-ink-3)" : "text-(--ui-ink-2)",
          )}
        >
          {body}
        </p>
      ) : null}
      {note ? (
        <p className="m-0 text-[12.5px] leading-snug wrap-anywhere text-(--ui-ink-2)">
          <span className="text-(--ui-ink-3)">{parts.note?.label}: </span>
          {note}
        </p>
      ) : null}
      {foot || (!box && (actions || going)) ? (
        // a row's cards share one height (v116): the foot sits at the card's foot
        <div className="mt-auto flex min-h-8 flex-wrap items-center justify-between gap-2 pt-1">
          {foot ? (
            <span className="text-[12.5px] text-(--ui-ink-2) tabular-nums">
              <span className="text-(--ui-ink-3)">{foot.label} </span>
              <FieldCell field={foot} cell={row[foot.key]} />
            </span>
          ) : (
            <span />
          )}
          {going ? (
            <Tag tone="accent" busy>
              {going}
            </Tag>
          ) : box ? null : (
            actions
          )}
        </div>
      ) : null}
      {box ? <div className="mt-1">{box}</div> : null}
    </li>
  );
}

/** A choice or status value as its word. */
const wordOf = (f: FieldMeta, value: string) => (value ? (f.states?.[value]?.label ?? value) : "");

/** A card's picture: a still, or a video's first frame; it fades in once it has loaded. */
function Picture({ thumb }: { thumb: Thumb }) {
  const [shown, setShown] = useState(false);
  const fade = cn(
    "block size-full object-cover transition-opacity duration-200 motion-reduce:transition-none",
    shown ? "opacity-100" : "opacity-0",
  );
  return thumb.kind === "video" ? (
    <video
      src={`${thumb.url}#t=0.5`}
      muted
      playsInline
      preload="metadata"
      onLoadedData={() => setShown(true)}
      className={fade}
    />
  ) : (
    <img
      src={thumb.url}
      alt=""
      loading="lazy"
      decoding="async"
      onLoad={() => setShown(true)}
      className={fade}
    />
  );
}

/** Sort for cards: what a table's column heads do, in one menu. */
export function CardSort({
  meta,
  place,
  sort,
}: {
  meta: RecordMeta;
  place: Place;
  sort: string | undefined;
}) {
  const [open, setOpen] = useState(false);
  const fields = meta.fields.filter((f) => f.sortable && (f.column || f.key === meta.title));
  if (!fields.length) return null;
  const by = fields.find((f) => sort === f.key || sort === `-${f.key}`);
  const desc = !!sort?.startsWith("-");
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger className="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-(--ui-radius) border-0 bg-transparent px-2 text-[13px] text-(--ui-ink-2) hover:bg-(--ui-hover) hover:text-(--ui-ink) data-[popup-open]:bg-(--ui-hover) pointer-coarse:h-11">
        <Icon name="sort" size={14} />
        {by ? `${by.label}, ${desc ? "high first" : "low first"}` : "Sort"}
      </PopoverTrigger>
      <PopoverContent align="end" className="w-56 gap-0 p-1">
        {fields.map((f) => {
          const on = f === by;
          // Numbers and dates start high; words and states start at the top of their order.
          const first = f.column?.align === "end" || f.kind === "date" ? `-${f.key}` : f.key;
          const next = on ? (desc ? f.key : `-${f.key}`) : first;
          return (
            <a
              key={f.key}
              href={place.link({ sort: next, pg: null })}
              onClick={(e) => {
                e.preventDefault();
                setOpen(false);
                place.go(place.link({ sort: next, pg: null }));
              }}
              className="flex h-8 items-center gap-2 rounded-(--ui-radius) px-2 text-[13px] text-(--ui-ink) no-underline hover:bg-(--ui-hover) pointer-coarse:h-11"
            >
              <span className="min-w-0 flex-1">{f.label}</span>
              {on ? <Icon name="check" size={14} className="text-(--ui-ink-2)" /> : null}
            </a>
          );
        })}
      </PopoverContent>
    </Popover>
  );
}

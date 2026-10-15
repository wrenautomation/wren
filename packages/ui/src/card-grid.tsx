/**
 * A list as cards (`./cards.ts`): the switch between rows and cards, each card, its sort, and the
 * move from one form to the other. The list (`./records.tsx`) keeps the rows, the cursor, the
 * picks and the actions; a card is one more way to draw a row.
 */
import type { FieldMeta, RecordMeta, Thumb } from "@wren/core/records";
import { cn } from "cn";
import { ArrowDown, ArrowDownUp, ArrowUp, Check, LayoutGrid, Rows3 } from "lucide-react";
import { type ReactNode, useState } from "react";
import { flushSync } from "react-dom";
import type { CardParts, ListForm } from "./cards.js";
import { MEDIA_RATIO } from "./cards.js";
import { Popover, PopoverContent, PopoverTrigger } from "./components/ui/popover.js";
import { Cue, cueOf, FieldCell } from "./fields.js";
import { clipProps, tipProps } from "./hint.js";
import { still } from "./phone.js";
import type { Place } from "./records.js";

const SWITCH =
  "grid size-8 pointer-coarse:size-11 place-items-center text-(--ui-ink-3) transition-colors duration-150 hover:text-(--ui-ink) aria-pressed:bg-(--ui-fill) aria-pressed:text-(--ui-ink)";

/** Rows or cards, beside Display: two icons, the one on pressed. */
export function FormSwitch({
  form,
  onChange,
}: {
  form: ListForm;
  onChange: (to: ListForm) => void;
}) {
  return (
    <fieldset
      aria-label="Rows or cards"
      className="m-0 inline-flex shrink-0 overflow-hidden rounded-(--ui-radius) border border-(--ui-hair) bg-(--ui-paper) p-0"
    >
      <button
        type="button"
        aria-pressed={form === "rows"}
        aria-label="Rows"
        {...tipProps("Rows")}
        onClick={() => onChange("rows")}
        className={SWITCH}
      >
        <Rows3 className="size-3.5" />
      </button>
      <button
        type="button"
        aria-pressed={form === "cards"}
        aria-label="Cards"
        {...tipProps("Cards")}
        onClick={() => onChange("cards")}
        className={cn(SWITCH, "border-l border-(--ui-hair)")}
      >
        <LayoutGrid className="size-3.5" />
      </button>
    </fieldset>
  );
}

type Starts = Document & {
  startViewTransition?: (change: () => void) => { finished: Promise<void> };
};

/** How many rows on screen move into their cards; the rest fade with the page. */
const MOVERS = 40;

/**
 * Rows to cards or back, each row on screen moving into its card, in one transition the
 * browser draws. Motion turned down fades instead; a browser without transitions just swaps.
 * `change` must leave the new form on screen when it returns (`flushSync`).
 */
export function swapForm(root: HTMLElement | null, change: () => void) {
  const doc = document as Starts;
  if (!root || typeof doc.startViewTransition !== "function") return change();
  const calm = still();
  const named = new Set<string>();
  if (!calm) {
    const top = 0;
    const bottom = innerHeight;
    for (const el of root.querySelectorAll<HTMLElement>("[data-row]")) {
      const box = el.getBoundingClientRect();
      if (box.bottom < top || box.top > bottom) continue;
      const i = el.dataset.row ?? "";
      el.style.viewTransitionName = `wr-${i}`;
      named.add(i);
      if (named.size >= MOVERS) break;
    }
  }
  const html = document.documentElement;
  html.dataset.morph = "cards";
  const t = doc.startViewTransition.call(doc, () => {
    change();
    for (const el of root.querySelectorAll<HTMLElement>("[data-row]"))
      if (named.has(el.dataset.row ?? "")) el.style.viewTransitionName = `wr-${el.dataset.row}`;
  });
  t.finished.finally(() => {
    delete html.dataset.morph;
    for (const el of root.querySelectorAll<HTMLElement>("[data-row]"))
      el.style.viewTransitionName = "";
  });
}

/** `swapForm` around a React state change. */
export const morphTo = (root: HTMLElement | null, set: () => void, after: () => void) =>
  swapForm(root, () => {
    flushSync(set);
    after();
  });

/** The cards' own line: select every one shown, and the sort a table keeps in its heads. */
export function CardStrip({
  meta,
  place,
  sort,
  all,
  some,
  onAll,
}: {
  meta: RecordMeta;
  place: Place;
  sort: string | undefined;
  all: boolean;
  some: boolean;
  onAll: () => void;
}) {
  return (
    <div className="flex min-h-8 items-center justify-between gap-3 px-1 text-[13px] text-(--ui-ink-2)">
      <label className="inline-flex cursor-pointer items-center gap-2 pointer-coarse:min-h-11">
        <input
          type="checkbox"
          checked={all}
          ref={(el) => {
            if (el) el.indeterminate = some && !all;
          }}
          onChange={onAll}
          className="size-3.5 accent-(--ui-ink)"
        />
        Select all
      </label>
      <CardSort meta={meta} place={place} sort={sort} />
    </div>
  );
}

/** Sort for cards: what a table's column heads do, in one menu. */
function CardSort({
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
  const Arrow = desc ? ArrowDown : ArrowUp;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger className="inline-flex h-8 items-center gap-1.5 rounded-(--ui-radius) px-2 text-[13px] text-(--ui-ink-2) hover:bg-(--ui-hover) hover:text-(--ui-ink) pointer-coarse:h-11">
        <ArrowDownUp className="size-3.5" />
        {by ? by.label : "Sort"}
        {by ? <Arrow className="size-3" /> : null}
      </PopoverTrigger>
      <PopoverContent align="end" className="w-52 gap-0 p-1">
        {fields.map((f) => {
          const on = f === by;
          // Numbers and dates start high; words and states start at the top of their order.
          const first = f.column?.align === "end" || f.kind === "date" ? `-${f.key}` : f.key;
          const next = on ? (desc ? f.key : `-${f.key}`) : first;
          return (
            <a
              key={f.key}
              href={place.link({ sort: next, pg: null })}
              onClick={() => setOpen(false)}
              className="flex h-8 items-center gap-2 rounded-(--ui-radius) px-2 text-[13px] text-(--ui-ink) no-underline hover:bg-(--ui-hover) pointer-coarse:h-11"
            >
              <span className="flex-1 truncate">{f.label}</span>
              {on ? <Arrow className="size-3 text-(--ui-ink-2)" /> : null}
              {on ? <Check className="size-3.5" /> : null}
            </a>
          );
        })}
      </PopoverContent>
    </Popover>
  );
}

/** The cards' grid: as many as fit, 260px at least; one across on a phone. */
export const GRID =
  "grid list-none grid-cols-[repeat(auto-fill,minmax(min(100%,260px),1fr))] items-start gap-3";

/** A band in the grid: a tier's or a group's name, across every column. */
export function CardHead({ children }: { children: ReactNode }) {
  return (
    <li className="col-span-full px-1 pt-2 text-[12px] font-semibold text-(--ui-ink-2) first:pt-0">
      {children}
    </li>
  );
}

/** A row as a card: its picture, its mark and state, its title and words, its facts, its actions. */
export function RecordCard({
  row,
  index,
  parts,
  thumb,
  pending,
  title,
  titleClass,
  body,
  quiet,
  href,
  cursor,
  open,
  changed,
  picked,
  anyPicked,
  onPick,
  onOpen,
  onSettled,
  actions,
}: {
  row: Record<string, unknown>;
  index: number;
  parts: CardParts;
  /** Its picture, when it has one. */
  thumb: Thumb | undefined;
  /** Pictures are still on their way: a quiet box holds the place. */
  pending: boolean;
  title: string;
  titleClass: string;
  body: string;
  /** For info: its words read quieter. */
  quiet: boolean;
  href: string;
  cursor: boolean;
  open: boolean;
  changed: boolean;
  picked: boolean;
  anyPicked: boolean;
  onPick: () => void;
  onOpen: () => void;
  onSettled: () => void;
  actions: ReactNode;
}) {
  const media = parts.media && (thumb || pending) ? parts.media : null;
  const value = (f: FieldMeta | null) => (f ? row[f.key] : undefined);
  const mark = parts.mark ? cueOf(parts.mark, String(value(parts.mark) ?? "")) : null;
  const badge = parts.badge && !blank(value(parts.badge)) ? parts.badge : null;
  const facts = parts.facts.filter((f) => !blank(row[f.key]));
  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: the list's keys walk and open it; its title is the link.
    <li
      data-row={index}
      data-cursor={cursor && !open ? "" : undefined}
      onClick={(e) => {
        // Its box, links and buttons do their own thing.
        if ((e.target as Element).closest("input, a, button, label, video")) return;
        onOpen();
      }}
      onAnimationEnd={(e) => {
        if (e.animationName === "ui-changed") onSettled();
      }}
      className={cn(
        "group relative flex min-w-0 cursor-pointer flex-col overflow-hidden rounded-(--ui-radius-panel) border bg-(--ui-paper) shadow-(--ui-raise) transition-[border-color,box-shadow,background-color] duration-150",
        picked
          ? "border-(--ui-ink) shadow-[0_0_0_1px_var(--ui-ink)]"
          : cursor && !open
            ? "border-(--ui-edge) shadow-[0_0_0_1px_var(--ui-edge)]"
            : "border-(--ui-hair) hover:border-(--ui-edge)",
        open && "bg-(--ui-fill)",
        changed && "animate-ui-changed",
      )}
    >
      {media ? (
        <div
          className="relative overflow-hidden border-b border-(--ui-hair) bg-(--ui-wash)"
          style={{ aspectRatio: MEDIA_RATIO[media] }}
        >
          {thumb ? <Picture thumb={thumb} /> : <div className="size-full animate-pulse" />}
        </div>
      ) : null}
      <label
        className={cn(
          "absolute top-2 right-2 z-1 grid size-7 cursor-pointer place-items-center rounded-(--ui-radius) border border-(--ui-hair) bg-(--ui-paper) transition-opacity duration-150 pointer-coarse:size-11",
          picked || anyPicked
            ? "opacity-100"
            : "opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 pointer-coarse:opacity-100",
        )}
      >
        <input
          type="checkbox"
          aria-label={`Select ${title}`}
          checked={picked}
          onChange={onPick}
          className="size-3.5 accent-(--ui-ink)"
        />
      </label>
      <div className="grid min-w-0 gap-2 p-3">
        {mark || badge ? (
          <div className={cn("flex min-w-0 items-center gap-2 text-[12.5px]", !media && "pr-8")}>
            {mark ? (
              <span className="inline-flex shrink-0" {...tipProps(mark.label)}>
                <Cue state={mark} size={16} />
              </span>
            ) : null}
            {badge ? (
              <span className="min-w-0 truncate text-(--ui-ink-2)">
                <FieldCell field={badge} cell={value(badge) as never} />
              </span>
            ) : null}
          </div>
        ) : null}
        <a
          href={href}
          className={cn(
            "line-clamp-2 text-[14px] leading-snug no-underline wrap-anywhere",
            !media && !mark && !badge && "pr-8",
            titleClass,
          )}
          {...clipProps()}
        >
          {title || <span className="text-(--ui-ink-3)">-</span>}
        </a>
        {body ? (
          <p
            className={cn(
              "m-0 line-clamp-3 text-[13px] leading-snug wrap-anywhere",
              quiet ? "text-(--ui-ink-3)" : "text-(--ui-ink-2)",
            )}
            {...clipProps()}
          >
            {body}
          </p>
        ) : null}
        {facts.length ? (
          <dl className="m-0 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-[12.5px]">
            {facts.map((f) => (
              <div key={f.key} className="contents">
                <dt className="text-(--ui-ink-3)">{f.label}</dt>
                <dd
                  className={cn(
                    "m-0 min-w-0 truncate [&_wbr]:hidden",
                    f.kind === "date" ? "text-(--ui-ink-3) tabular-nums" : "text-(--ui-ink-2)",
                  )}
                  {...clipProps()}
                >
                  <FieldCell field={f} cell={row[f.key] as never} />
                </dd>
              </div>
            ))}
          </dl>
        ) : null}
      </div>
      {actions ? (
        <div className="mt-auto flex justify-end border-t border-(--ui-hair) px-2 py-1.5">
          {actions}
        </div>
      ) : null}
    </li>
  );
}

const blank = (c: unknown) =>
  c === null || c === undefined || c === "" || (Array.isArray(c) && !c.length);

/** A card's picture: a still, or a video's first frame; it fades in once it has loaded. */
function Picture({ thumb }: { thumb: Thumb }) {
  const [shown, setShown] = useState(false);
  const fade = cn(
    "size-full object-cover transition-opacity duration-200",
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

/**
 * A list bar's filter parts, free of any one list's fields: Filter (a popover, or at phone width
 * one sheet), a pill per filter in force, and the search box. A list says what each field is
 * (`BarField`) and brings its own editor; `ListBar` is the records list's, Aerie's bar is its own.
 */
import { Popover as PopoverPrimitive } from "@base-ui/react/popover";
import { cn } from "cn";
import { type ReactNode, useEffect, useId, useRef, useState } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "./components/ui/popover.js";
import {
  Sheet,
  SheetContent,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "./components/ui/sheet.js";
import { Button } from "./controls.js";
import { inSight, useRoving } from "./fields.js";
import { tipProps } from "./hint.js";
import { useHoverPop, useSubmenus } from "./hover-pop.js";
import { Icon, type IconName } from "./icons.js";
import { RingSlot } from "./motion.js";

/**
 * A tool on the list's bar (artifact `.nt-top .tl button`): no frame, ink-3 at rest, the accent
 * wash on hover. `CHIP_ON` is one that is set (`.tl button.on`): the active ink on the tint.
 */
export const CHIP =
  "inline-flex h-8 pointer-coarse:h-11 shrink-0 cursor-pointer items-center gap-1.5 rounded-[4px_10px_4px_10px] border-0 bg-transparent px-[9px] text-[13px] font-semibold whitespace-nowrap text-(--ui-ink-3) no-underline transition-[background-color,color] duration-150 ease-(--ui-ease) hover:bg-(--ui-accent-wash) hover:text-(--ui-ink) focus-visible:outline-2 focus-visible:outline-(--ui-focus) data-[popup-open]:bg-(--ui-accent-wash) motion-reduce:transition-none";
export const CHIP_ON =
  "bg-(--ui-accent-tint) text-(--ui-active) hover:bg-(--ui-accent-tint) hover:text-(--ui-active)";
/** A filter in force: a tool that is on, with its value and an ×. */
const PILL = cn(
  "inline-flex h-8 pointer-coarse:h-11 max-w-full min-w-0 items-center rounded-[4px_10px_4px_10px] text-[13px] font-semibold",
  CHIP_ON,
);
export const POP = "w-72 gap-0 overflow-hidden bg-(--ui-paper) p-0 text-(--ui-ink)";
const ROW =
  "flex h-8 pointer-coarse:h-11 w-full cursor-pointer items-center gap-2 px-2 text-left text-[13px] text-(--ui-ink) select-none";

/** The bar's glyphs, drawn as the artifact's (`S` in design-language.src.html): 15px, 1.8 stroke. */
const GLYPH = {
  table: "M4 6h16M4 12h16M4 18h10",
  group: "M4 5h16M7 10h13M7 15h13M7 20h13",
  filter: "M4 6h16M7 12h10M10 18h4",
} as const;
export function BarGlyph({ name }: { name: keyof typeof GLYPH }) {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      className="size-[15px] flex-none fill-none stroke-current [stroke-linecap:round] [stroke-linejoin:round] [stroke-width:1.8]"
    >
      <path d={GLYPH[name]} />
    </svg>
  );
}

/** One field Filter offers: its name, its words once set, and its own editor. */
export interface BarField {
  key: string;
  label: string;
  icon: IconName;
  /** In force: "is" and "SEC RIA" on the pill; `say` is the whole of it, for the hover. */
  set: { op: string; value: string; cues?: ReactNode; say: string } | null;
  /** The field's choices; each change applies at once. */
  editor: ReactNode;
  clear: () => void;
  /** The panel's heading over it ("On screen"); fields keep the order given. */
  section?: string;
}

const glyph = (name: IconName) => (
  <Icon name={name} className="size-3.5 shrink-0 text-(--ui-ink-3)" />
);

/** One field's choices: its name, Clear when set, and its editor. `back` returns to the fields. */
function FieldPane({ field, back }: { field: BarField; back?: () => void }) {
  return (
    <div className="grid" data-filter-editor={field.key}>
      <div className="flex h-10 items-center gap-1.5 border-b border-(--ui-hair) px-1">
        {back ? (
          <button
            type="button"
            aria-label="Back to fields"
            {...tipProps("Back to fields", { as: "none" })}
            onClick={back}
            className="inline-flex size-7 items-center justify-center border-0 bg-transparent p-0 text-(--ui-ink-2) hover:bg-(--ui-hover) hover:text-(--ui-ink)"
          >
            <Icon name="left" className="size-4" />
          </button>
        ) : (
          <span className="w-1.5" />
        )}
        {glyph(field.icon)}
        <span className="min-w-0 flex-1 wrap-anywhere whitespace-normal text-[13px] font-medium">
          {field.label}
        </span>
        {field.set ? (
          <button
            type="button"
            onClick={field.clear}
            className="h-7 border-0 bg-transparent px-2 text-[12px] text-(--ui-ink-2) hover:text-(--ui-ink)"
          >
            Clear
          </button>
        ) : null}
      </div>
      {field.editor}
    </div>
  );
}

/**
 * What Filter opens: the fields to pick from (typing narrows them; then a search for the typed
 * text, when the list searches), then the picked one's editor. Arrow keys and Enter move and
 * pick; Back returns to the fields.
 */
function FilterPanel({
  fields,
  start,
  search,
  close,
  phone,
  byHover,
}: {
  fields: BarField[];
  /** The field to open on: a pill's own. */
  start: string | null;
  /** The list's plural and its search: a last row asks for the typed text. */
  search?: { many: string; ask: (text: string) => void } | undefined;
  close: () => void;
  /** In the phone's sheet: no keyboard on open, rows drill in, and the sheet scrolls. */
  phone?: boolean | undefined;
  /** Opened by the pointer resting on Filter: focus stays where it was. */
  byHover?: boolean | undefined;
}) {
  const [at, setAt] = useState<string | null>(start);
  const [text, setText] = useState("");
  const id = useId();
  // With a mouse, each field's choices open beside its row; keys and taps drill in.
  const subs = useSubmenus();
  // Detached roots: a popover's portal inside the listbox adds a span axe rejects there.
  const handles = useRef(new Map<string, PopoverPrimitive.Handle<unknown>>()).current;
  const handleOf = (key: string) => {
    const h = handles.get(key) ?? PopoverPrimitive.createHandle();
    handles.set(key, h);
    return h;
  };

  const t = text.trim().toLowerCase();
  const order = fields.filter((f) => f.label.toLowerCase().includes(t));
  const sections: [string | undefined, BarField[]][] = [];
  for (const f of order) {
    const last = sections.at(-1);
    if (last && last[0] === f.section) last[1].push(f);
    else sections.push([f.section, [f]]);
  }
  const searching = !!search && !!t;
  const ask = () => {
    search?.ask(text.trim());
    close();
  };
  const nav = useRoving(order.length + (searching ? 1 : 0));
  const pick = (i: number) => {
    const f = order[i];
    if (f) setAt(f.key);
    else if (searching) ask();
  };

  const open = fields.find((f) => f.key === at);
  if (open)
    return (
      <FieldPane
        field={open}
        back={() => {
          setAt(null);
          setText("");
        }}
      />
    );

  const option = (i: number) => `${id}-${i}`;
  return (
    <div className="grid">
      <label className="flex h-10 items-center gap-2 border-b border-(--ui-hair) px-3">
        <Icon name="search" className="size-3.5 shrink-0 text-(--ui-ink-3)" />
        <input
          // edit-ok: search box
          // biome-ignore lint/a11y/noAutofocus: the popover opened to type in this.
          autoFocus={!phone && !byHover}
          role="combobox"
          aria-expanded
          aria-controls={id}
          aria-activedescendant={nav.at >= 0 ? option(nav.at) : undefined}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            nav.setAt(0);
          }}
          onKeyDown={(e) => nav.keys(e, pick)}
          placeholder="Filter by…"
          aria-label="Filter by"
          className="h-full min-w-0 flex-1 border-0 bg-transparent text-[13px] text-(--ui-ink) outline-none placeholder:text-(--ui-ink-3)"
        />
      </label>
      <div
        id={id}
        role="listbox"
        aria-label="Fields"
        className={cn("grid p-1", !phone && "max-h-[min(22rem,60vh)] overflow-y-auto")}
      >
        {sections.map(([label, list], s) => (
          <div key={label ?? s} className="grid">
            {label ? (
              <span className="px-2 pt-2 pb-1 text-[11px] text-(--ui-ink-3)">{label}</span>
            ) : null}
            {list.map((f) => {
              const i = order.indexOf(f);
              const face = (
                <>
                  {glyph(f.icon)}
                  <span className="min-w-0 flex-1 wrap-anywhere whitespace-normal">{f.label}</span>
                  {f.set ? (
                    <span className="max-w-[45%] wrap-anywhere whitespace-normal text-[12px] text-(--ui-ink-3)">
                      {f.set.value}
                    </span>
                  ) : null}
                  {phone ? null : (
                    <Icon name="right" className="size-3.5 shrink-0 text-(--ui-ink-3)" />
                  )}
                </>
              );
              const row = {
                id: option(i),
                role: "option",
                tabIndex: -1,
                "aria-selected": i === nav.at,
                ref: inSight(i === nav.at),
                onMouseMove: () => nav.setAt(i),
                ...tipProps(f.set?.say),
                className: cn(ROW, i === nav.at && "bg-(--ui-accent-wash)"),
              } as const;
              if (phone)
                return (
                  // biome-ignore lint/a11y/useKeyWithClickEvents: the box's keys pick it.
                  <div
                    key={f.key}
                    {...row}
                    role="option"
                    tabIndex={-1}
                    onClick={() => setAt(f.key)}
                  >
                    {face}
                  </div>
                );
              return (
                <PopoverTrigger
                  key={f.key}
                  handle={handleOf(f.key)}
                  {...subs.trigger}
                  nativeButton={false}
                  // An option may not carry aria-expanded (Base UI sets it on a trigger):
                  // focus goes into the editor it opens, which says what it is.
                  render={<div {...row} aria-expanded={undefined} data-filter-field={f.key} />}
                >
                  {face}
                </PopoverTrigger>
              );
            })}
          </div>
        ))}
        {searching ? (
          // biome-ignore lint/a11y/useKeyWithClickEvents: the box's keys pick it.
          <div
            id={option(order.length)}
            role="option"
            tabIndex={-1}
            aria-selected={nav.at === order.length}
            ref={inSight(nav.at === order.length)}
            onMouseMove={() => nav.setAt(order.length)}
            onClick={ask}
            className={cn(
              ROW,
              order.length && "mt-1 border-t border-(--ui-hair)",
              nav.at === order.length && "bg-(--ui-hover)",
            )}
          >
            <Icon name="search" className="size-3.5 shrink-0 text-(--ui-ink-3)" />
            <span className="wrap-anywhere whitespace-normal text-(--ui-ink-2)">
              Search {search?.many} for “{text.trim()}”
            </span>
          </div>
        ) : !order.length ? (
          <span className="px-2 py-2 text-[13px] text-(--ui-ink-2)">No field by that name.</span>
        ) : null}
      </div>
      {phone
        ? null
        : order.map((f) => (
            <Popover key={f.key} handle={handleOf(f.key)} {...subs.rootOf(f.key)}>
              <PopoverContent
                aria-label={f.label}
                side="right"
                align="start"
                sideOffset={2}
                className={POP}
              >
                <FieldPane field={f} />
              </PopoverContent>
            </Popover>
          ))}
    </div>
  );
}

/** A set filter in plain words: "Campaign is SEC RIA". Clicking it opens its editor; × drops it. */
function FilterPill({
  field,
  onOpen,
  panel,
}: {
  field: BarField;
  /** At phone width: the sheet opens on this field instead. */
  onOpen?: (() => void) | undefined;
  panel: (close: () => void, byHover: boolean) => ReactNode;
}) {
  const pop = useHoverPop();
  const set = field.set;
  const face = (
    <>
      <span className="shrink-0">{field.label}</span>
      <span className="shrink-0 font-normal">{set?.op}</span>
      {set?.cues ? (
        <span className="inline-flex shrink-0 items-center gap-1">{set.cues}</span>
      ) : null}
      <span className="min-w-0 max-w-[180px] wrap-anywhere whitespace-normal text-(--ui-ink)">
        {set?.value}
      </span>
    </>
  );
  const faceClass =
    "inline-flex h-full min-w-0 cursor-pointer items-center gap-1.5 border-0 bg-transparent py-1.5 pr-1 pl-[9px] font-[inherit] text-inherit";
  // The face cuts a long value short; the hover says all of it.
  const tip = tipProps(set?.say);
  return (
    <span className={PILL}>
      {onOpen ? (
        <button type="button" onClick={onOpen} {...tip} className={faceClass}>
          {face}
        </button>
      ) : (
        <Popover {...pop.root}>
          <PopoverTrigger {...pop.trigger} {...tip} className={faceClass}>
            {face}
          </PopoverTrigger>
          <PopoverContent aria-label={`${field.label} filter`} align="start" className={POP}>
            {panel(() => pop.setOpen(false), pop.byHover)}
          </PopoverContent>
        </Popover>
      )}
      <button
        type="button"
        aria-label={`Remove ${field.label} filter`}
        {...tipProps("Remove this filter", { as: "none" })}
        onClick={field.clear}
        className="mr-1 inline-flex size-6 shrink-0 cursor-pointer items-center justify-center border-0 bg-transparent p-0 text-inherit [border-radius:3px_8px_3px_8px] hover:bg-(--ui-accent-wash)"
      >
        <Icon name="close" className="size-3.5" />
      </button>
    </span>
  );
}

/** "Filter", with how many are on. */
function FilterFace({ on }: { on: number }) {
  return (
    <>
      <BarGlyph name="filter" />
      <span data-hp>Filter</span>
      {on ? <span className="tabular-nums">{on}</span> : null}
    </>
  );
}

/** Where Filter opens: on `start` (a pill's field), or on the fields. */
export interface FilterOpen {
  open: boolean;
  start: string | null;
  /** Bumped per open, so the sheet's panel starts over. */
  n: number;
}

/**
 * The bar's Filter tool and pills, wired: a popover with a mouse, one sheet from the bottom at
 * phone width. `pills` go where the bar puts them; `tool` is Filter; `sheet` mounts once.
 */
export function useFilterTools({
  fields,
  narrow,
  search,
  say,
  clearAll,
}: {
  fields: BarField[];
  narrow: boolean;
  search?: { many: string; ask: (text: string) => void } | undefined;
  /** Filter's hover: every filter in force, in words. */
  say?: string | undefined;
  clearAll: () => void;
}) {
  const picker = useHoverPop();
  const [sheet, setSheet] = useState<FilterOpen>({ open: false, start: null, n: 0 });
  const openSheet = (start: string | null) => setSheet((s) => ({ open: true, start, n: s.n + 1 }));
  const shut = () => setSheet((s) => ({ ...s, open: false }));
  const on = fields.filter((f) => f.set);
  const panel = (
    start: string | null,
    close: () => void,
    o: { phone?: boolean; byHover?: boolean } = {},
  ) => (
    <FilterPanel
      fields={fields}
      start={start}
      search={search}
      close={close}
      phone={o.phone}
      byHover={o.byHover}
    />
  );
  const tool = !fields.length ? null : narrow ? (
    <button
      type="button"
      {...tipProps(say)}
      className={cn(CHIP, on.length && CHIP_ON)}
      onClick={() => openSheet(null)}
    >
      <FilterFace on={on.length} />
    </button>
  ) : (
    <Popover {...picker.root}>
      <PopoverTrigger
        {...picker.trigger}
        {...tipProps(say)}
        className={cn(CHIP, on.length && CHIP_ON)}
      >
        <FilterFace on={on.length} />
      </PopoverTrigger>
      <PopoverContent aria-label="Filter" align="start" className={POP}>
        {panel(null, () => picker.setOpen(false), { byHover: picker.byHover })}
      </PopoverContent>
    </Popover>
  );
  const pills = (keys: (f: BarField) => boolean = () => true) =>
    on
      .filter(keys)
      .map((f) => (
        <FilterPill
          key={f.key}
          field={f}
          onOpen={narrow ? () => openSheet(f.key) : undefined}
          panel={(close, byHover) => panel(f.key, close, { byHover })}
        />
      ));
  const sheetEl = narrow ? (
    <Sheet open={sheet.open} onOpenChange={(o) => (o ? null : shut())}>
      <SheetContent
        // A phone opens it to tap, not type: no keyboard springs up.
        initialFocus={false}
        side="bottom"
        className="max-h-[85dvh] gap-0 bg-(--ui-paper) text-(--ui-ink)"
      >
        <SheetHeader className="border-b border-(--ui-hair) p-4">
          <SheetTitle className="text-[15px] font-semibold">Filter</SheetTitle>
        </SheetHeader>
        <div key={sheet.n} className="min-h-0 flex-1 overflow-y-auto">
          {panel(sheet.start, shut, { phone: true })}
        </div>
        <SheetFooter className="flex-row justify-between border-t border-(--ui-hair) p-4">
          <Button tone="secondary" size="dense" disabled={!on.length} onClick={clearAll}>
            Clear all
          </Button>
          <Button size="dense" onClick={shut}>
            Done
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  ) : null;
  return { tool, pills, sheet: sheetEl, on: on.length };
}

/** The search box: it asks once typing stops (250 ms). */
export function SearchField({
  asked,
  ask,
  label,
  glass = false,
  busy = false,
  failed,
}: {
  /** The text the address asks now. */
  asked: string;
  ask: (text: string | null) => void;
  label: string;
  /** The glass alone at any width, as a phone's (a list beside its peek). */
  glass?: boolean;
  /** The asked text still reads: the ring turns after it. */
  busy?: boolean | undefined;
  /** The asked text's read failed: the warn glyph and Retry. */
  failed?: { retry: () => void } | undefined;
}) {
  const [text, setText] = useState(asked);
  const failId = useId();
  /** He's typing: his words win until they're in the address. */
  const typed = useRef(false);
  const askRef = useRef(ask);
  askRef.current = ask;
  // The address changed from elsewhere (a tab, Clear, a saved view): show what it asks.
  useEffect(() => {
    if (!typed.current) setText(asked);
  }, [asked]);
  useEffect(() => {
    if (!typed.current) return;
    if (text.trim() === asked) {
      typed.current = false;
      return;
    }
    const t = setTimeout(() => {
      typed.current = false;
      askRef.current(text.trim() || null);
    }, 250);
    return () => clearTimeout(t);
  }, [text, asked]);
  return (
    // A tool like the bar's others (artifact `.tl` Search): no frame, the wash on hover and while
    // typing. It hugs its placeholder and grows with the words, 160 to 224 px.
    <label
      className={cn(
        CHIP,
        "relative w-fit min-w-40 max-w-56 cursor-text focus-within:bg-(--ui-accent-wash)",
        // A phone shows the glass alone (artifact `.tl` Search) and opens the field on a tap.
        !asked &&
          "max-[899.98px]:w-[33px] max-[899.98px]:min-w-0 max-[899.98px]:transition-[width,background-color,color] max-[899.98px]:duration-200 max-[899.98px]:ease-(--ui-ease) max-[899.98px]:focus-within:w-40",
        asked && "max-[899.98px]:w-40",
        glass &&
          (asked
            ? "w-40"
            : "w-[33px] min-w-0 transition-[width,background-color,color] duration-200 ease-(--ui-ease) focus-within:w-40"),
        asked && CHIP_ON,
      )}
    >
      <Icon
        name={failed ? "warn" : "search"}
        className={cn(
          "pointer-events-none size-[15px] flex-none [stroke-width:1.8]",
          failed && "text-(--ui-bad)",
        )}
      />
      <input
        // edit-ok: search box
        type="search"
        value={text}
        onChange={(e) => {
          typed.current = true;
          setText(e.target.value);
        }}
        placeholder={`Search ${label}`}
        aria-label={`Search ${label}`}
        aria-invalid={failed ? true : undefined}
        aria-describedby={failed ? failId : undefined}
        className="h-5 min-w-0 flex-1 border-0 bg-transparent p-0 text-[13px] font-semibold text-(--ui-ink) outline-none [field-sizing:content] placeholder:text-(--ui-ink-3) [&::-webkit-search-cancel-button]:hidden"
      />
      <RingSlot on={busy && !failed} />
      {failed ? (
        <button
          type="button"
          onClick={failed.retry}
          {...tipProps("Search did not run")}
          className="h-6 shrink-0 cursor-pointer border-0 bg-transparent px-1 text-[12px] font-semibold text-(--ui-bad) underline-offset-2 hover:underline"
        >
          <span id={failId} className="sr-only">
            Search did not run.
          </span>
          Retry
        </button>
      ) : null}
    </label>
  );
}

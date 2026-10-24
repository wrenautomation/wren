/**
 * A record beside its list (`Panel`): a floating panel on a wide screen, a bottom sheet on a
 * phone; up and down walk the list, a link opens it as a page. With `peek` its body is the peek
 * (`./peek.tsx`), wired to the list's own row actions and reply box (`PeekWire`); without, the
 * whole record.
 */

import type { FieldMeta, RecordMeta } from "@wren/core/records";
import type { RecordAnswer, Row } from "@wren/core/records/serve";
import { cn } from "cn";
import { type ReactNode, useState } from "react";
import type { Action } from "./action.js";
import { type Load, useLoad } from "./data/query.js";
import { LoadFailed, Loading } from "./feedback.js";
import { FieldCell } from "./fields.js";
import { num } from "./format.js";
import { tipProps } from "./hint.js";
import { Icon } from "./icons.js";
import { type PeekLine, PeekTitle, PeekView } from "./peek.js";
import { BottomSheet, useSheet } from "./phone.js";
import { usePhone } from "./phone-shell.js";
import { blank, ROOT } from "./records-columns.js";
import { RecordBody } from "./records-page.js";
import {
  cap,
  type Place,
  type RecordActs,
  type RecordsApi,
  type RecordTemplateProps,
  type RowReplyBox,
  rowAct,
  titleOf,
  words,
} from "./records-types.js";
import { RowActions } from "./row-acts.js";
import { avatarOf } from "./rows.js";
import { Sweep } from "./sweep.js";

export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="inline-flex h-5 min-w-5 items-center justify-center border border-(--ui-hair) px-1 font-[inherit] text-[11px] text-(--ui-ink-2)">
      {children}
    </kbd>
  );
}

const ICON =
  "inline-flex size-8 pointer-coarse:size-11 border-0 bg-transparent items-center justify-center text-(--ui-ink-2) hover:bg-(--ui-hover) hover:text-(--ui-ink) disabled:opacity-30 transition-[background-color,color,scale] duration-150 ease-(--ui-ease) active:scale-[0.94]";

/** The peek head's buttons, as the artifact's `.ib`: 28px, the leaf corner, the accent hover. */
const PEEK_ICON =
  "inline-grid size-7 flex-none cursor-pointer place-items-center border-0 bg-transparent p-0 text-(--ui-ink-3) no-underline transition-[background-color,color,opacity] duration-150 [border-radius:4px_10px_4px_10px] hover:bg-(--ui-accent-tint) hover:text-(--ui-link) focus-visible:bg-(--ui-accent-tint) focus-visible:text-(--ui-link) disabled:opacity-30 disabled:hover:bg-transparent pointer-coarse:size-11 motion-reduce:transition-none [&_svg]:size-4 [&_svg]:[stroke-width:1.9]";

/** What the peek takes from the list: the same row actions and reply box the row itself uses. */
export interface PeekWire {
  /** The properties, in order. */
  fields: FieldMeta[];
  reply: RowReplyBox | undefined;
  /** Whether the page's reply answers this row. */
  replyOn: (row: Row) => boolean;
  /** The row's actions, as its row draws them: icons first, the rest behind ⋯. */
  actsOf: (row: Row) => { main: Action[]; more: Action[] };
  /** The row's own press (`rowRun`): the write, the Undo toast. */
  press: (action: Action, row: Row) => void;
  /** The box an action that asks for words types them in. */
  ask: (action: Action, row: Row, close: () => void) => ReactNode;
  busyOn: (action: Action, row: Row) => boolean;
}

/**
 * A record beside its list: up and down walk the list, a link opens it as a page. With `peek`
 * its body is the peek (`./peek.tsx`); without, the whole record.
 */
export function Panel({
  meta,
  types,
  id,
  api,
  place,
  extras,
  acts,
  index,
  count,
  step,
  rev,
  onActed,
  peek,
  listRow,
  docked = false,
}: {
  meta: RecordMeta;
  types: RecordMeta[];
  id: string;
  api: RecordsApi;
  place: Place;
  extras: RecordTemplateProps["extras"];
  acts: RecordActs | undefined;
  index: number;
  count: number;
  step: (by: number) => void;
  rev: number;
  onActed: (changed: (string | number)[]) => void;
  peek?: PeekWire | undefined;
  /** The row as the list holds it: the peek's head before its own read lands. */
  listRow?: Row | undefined;
  /** The peek sits in the list's panel, at its right (artifact `.nt-pk`), not over the page. */
  docked?: boolean;
}) {
  const phone = usePhone();
  const shut = place.link({ [meta.name.one]: null, tab: null });
  /** An action that asks for words, its box open in the peek's body; another row's never shows. */
  const [asking, setAsking] = useState<{ id: string; action: Action } | null>(null);
  // The peek reads the record as the full one does (same key, same cache), once, for its head
  // and its body. Another row's answer, held while this one reads, never draws here.
  const got = useLoad<RecordAnswer>(
    peek ? `${meta.id}:${id}:${rev}` : null,
    () => api.get({ record: meta.id, id }),
    api,
  );
  const read = got.data && String(got.data.row.id) === id ? got.data : null;
  const row = peek ? (read?.row ?? listRow ?? null) : null;
  const title = row ? titleOf(meta, row) : "";
  const named = meta.fields.find((f) => f.key === meta.title)?.kind === "name";
  const avatar = named ? avatarOf(title) : null;
  const body = peek ? (
    <PeekContent
      key={id}
      meta={meta}
      id={id}
      api={api}
      place={place}
      extras={extras}
      acts={acts}
      onActed={onActed}
      wire={peek}
      got={got}
      read={read}
      row={row}
      asking={asking?.id === id ? asking.action : null}
      stopAsking={() => setAsking(null)}
    />
  ) : (
    <RecordBody
      key={id}
      meta={meta}
      types={types}
      id={id}
      api={api}
      place={place}
      extras={extras}
      acts={acts}
      rev={rev}
      onActed={onActed}
      docked
    />
  );
  // At exactly 900px the shell says phone and the list docks: the list wins, so its half isn't empty.
  if (phone && !docked)
    // A phone: a sheet over the list, open full height; drag it to half to see the list, or
    // down to shut it.
    return (
      <BottomSheet
        label={cap(meta.name.one)}
        start="large"
        escape={false}
        onClose={() => place.go(shut, true)}
        className={ROOT}
        bodyClassName="px-4 pt-2 pb-[calc(96px+env(safe-area-inset-bottom))]"
        head={
          <div className="flex h-11 items-center gap-1 border-b border-(--ui-hair) px-2">
            <SheetDone />
            <span className="min-w-0 flex-1 wrap-anywhere whitespace-normal text-center text-[13px] text-(--ui-ink-2)">
              {index >= 0 ? `${num(index + 1)} of ${num(count)}` : ""}
            </span>
            {peek && row ? (
              <PeekActs
                wire={peek}
                row={row}
                title={title}
                ask={(action) => setAsking({ id, action })}
              />
            ) : (
              <>
                <button
                  type="button"
                  className={ICON}
                  aria-label="Previous"
                  disabled={index <= 0}
                  onClick={() => step(-1)}
                >
                  <Icon name="up" className="size-4" />
                </button>
                <button
                  type="button"
                  className={ICON}
                  aria-label="Next"
                  disabled={index < 0 || index >= count - 1}
                  onClick={() => step(1)}
                >
                  <Icon name="down" className="size-4" />
                </button>
              </>
            )}
            <a href={place.page(id)} className={ICON} aria-label="Open as a page">
              <Icon name="expand" className="size-3.5" />
            </a>
          </div>
        }
      >
        {peek && row ? <PeekTitle avatar={avatar} title={title} className="mb-3" /> : null}
        {body}
      </BottomSheet>
    );
  const aside = (
    <aside
      aria-label={cap(meta.name.one)}
      className={cn(
        ROOT,
        docked
          ? // Beside the flat list: a raised panel that stays in view while the page scrolls the rows.
            "sticky top-4 flex min-w-0 flex-col overflow-clip rounded-(--ui-radius-panel) bg-(--ui-paper) shadow-(--ui-raise)"
          : // Off a phone it floats: inset from the edges, a sheet's corners, clipped to them.
            "fixed inset-y-0 right-0 z-40 flex w-full flex-col bg-(--ui-paper) shadow-(--ui-shadow) sm:inset-y-2 sm:right-2 sm:w-[440px] sm:overflow-clip sm:rounded-(--ui-leaf-sheet)",
      )}
    >
      {docked ? null : (
        // A floating panel is a leaf (artifact `.modal`): the sweep on its round tips.
        <div className="max-sm:hidden">
          <Sweep radius={18} />
        </div>
      )}
      {peek ? (
        // The peek's head (artifact `.pk header`): who it is, then its row's actions (William,
        // 10-24: in place of the walk, which J and K still do), the whole record and the close.
        <div className="flex shrink-0 items-center gap-2.5 px-[18px] pt-4">
          {row ? (
            <PeekTitle avatar={avatar} title={title} className="flex-1" />
          ) : (
            <span className="flex-1" />
          )}
          {row ? (
            <PeekActs
              wire={peek}
              row={row}
              title={title}
              ask={(action) => setAsking({ id, action })}
            />
          ) : null}
          <a
            href={place.page(id)}
            className={PEEK_ICON}
            aria-label="Open"
            {...tipProps("Open the full record", { as: "none" })}
          >
            <Icon name="expand" />
          </a>
          <a
            href={shut}
            className={PEEK_ICON}
            aria-label="Close"
            {...tipProps("Close", { keys: "Esc", as: "none" })}
          >
            <Icon name="close" />
          </a>
        </div>
      ) : (
        <div className="flex h-12 shrink-0 items-center gap-1 border-b border-(--ui-hair) bg-(--ui-band) px-3 max-sm:box-content max-sm:h-14 max-sm:pt-[env(safe-area-inset-top)] max-sm:pr-[max(12px,env(safe-area-inset-right))] max-sm:pl-[max(4px,env(safe-area-inset-left))]">
          {/* A phone: the panel is the screen, so the way back leads. */}
          <a
            href={shut}
            className="inline-flex h-11 items-center gap-1 pr-3 pl-1 text-[15px] font-medium text-(--ui-ink) no-underline sm:hidden"
          >
            <Icon name="left" className="size-5" />
            {cap(meta.name.many)}
          </a>
          <button
            type="button"
            className={ICON}
            aria-label="Previous"
            {...tipProps("Previous", { keys: "K", as: "none" })}
            disabled={index <= 0}
            onClick={() => step(-1)}
          >
            <Icon name="up" className="size-4" />
          </button>
          <button
            type="button"
            className={ICON}
            aria-label="Next"
            {...tipProps("Next", { keys: "J", as: "none" })}
            disabled={index < 0 || index >= count - 1}
            onClick={() => step(1)}
          >
            <Icon name="down" className="size-4" />
          </button>
          <span className="ml-1 text-[12px] text-(--ui-ink-3) max-sm:hidden">
            {index >= 0 ? `${num(index + 1)} of ${num(count)}` : ""}
          </span>
          <a
            href={place.page(id)}
            className={cn(ICON, "ml-auto")}
            aria-label="Open as a page"
            {...tipProps("Open as a page", { as: "none" })}
          >
            <Icon name="expand" className="size-3.5" />
          </a>
          <a
            href={shut}
            className={cn(ICON, "max-sm:hidden")}
            aria-label="Close"
            {...tipProps("Close", { keys: "Esc", as: "none" })}
          >
            <Icon name="close" className="size-4" />
          </a>
        </div>
      )}
      <div
        key={id}
        className={cn(
          "min-h-0 flex-1 overflow-y-auto overscroll-contain pb-10 max-sm:pb-[calc(96px+env(safe-area-inset-bottom))]",
          peek ? "px-[18px] pt-3" : "px-4 pt-5 sm:px-6",
          // A long record scrolls inside one screen, not down the page.
          docked && "max-h-[calc(100dvh-160px)] pb-4",
        )}
      >
        {body}
      </div>
    </aside>
  );
  return aside;
}

/**
 * The peek's body (`./peek.tsx`) from the record's one read: its properties, its newest items
 * (the type's own, else its activity) and, to act, the page's reply box or the row's main action.
 */
function PeekContent({
  meta,
  id,
  api,
  place,
  extras,
  acts,
  onActed,
  wire,
  got,
  read,
  row,
  asking,
  stopAsking,
}: {
  meta: RecordMeta;
  id: string;
  api: RecordsApi;
  place: Place;
  extras: RecordTemplateProps["extras"];
  acts: RecordActs | undefined;
  onActed: (changed: (string | number)[]) => void;
  wire: PeekWire;
  got: Load<RecordAnswer>;
  read: RecordAnswer | null;
  row: Row | null;
  /** An action that asks for words, its box open here. */
  asking: Action | null;
  stopAsking: () => void;
}) {
  if (got.error && !read)
    return <LoadFailed error={got.error} onRetry={got.retry} what={meta.name.one} />;
  if (!row) return <Loading heading lines={4} />;
  const act = rowAct(meta, api, acts, row, onActed);
  const more = read && extras ? extras(read.detail, read.row, act, got.at) : {};
  const recent: PeekLine[] | null = read
    ? (more.recent ??
      read.activity?.slice(0, 3).map((l) => ({
        who: l.kind ? words(l.kind) : undefined,
        at: l.at,
        text: l.what,
      })) ??
      null)
    : null;
  const reply =
    asking != null
      ? wire.ask(asking, row, stopAsking)
      : read && wire.reply && wire.replyOn(read.row)
        ? wire.reply.box(read.detail, read.row, act)
        : null;
  return (
    <PeekView
      props={[
        ...wire.fields,
        // Its links (the post, the permalink), so the page they lead to is a click from the peek.
        ...meta.fields.filter(
          (f) => f.kind === "link" && !wire.fields.includes(f) && !blank(row[f.key]),
        ),
      ].map((f) => ({
        label: f.label,
        node: blank(row[f.key]) ? null : <FieldCell field={f} cell={row[f.key]} />,
      }))}
      recent={recent}
      waiting={!read}
      reply={reply}
      openHref={place.page(id)}
    />
  );
}

/** The peek's actions at its head's right, as its row draws them: icons, the rest behind ⋯. */
function PeekActs({
  wire,
  row,
  title,
  ask,
}: {
  wire: PeekWire;
  row: Row;
  title: string;
  ask: (action: Action) => void;
}) {
  const { main, more } = wire.actsOf(row);
  if (!main.length && !more.length) return null;
  return (
    <RowActions
      still
      title={title}
      main={main}
      more={more}
      reply={null}
      busy={[...main, ...more].some((a) => wire.busyOn(a, row))}
      run={(a) => (a.ask ? ask(a) : wire.press(a, row))}
    />
  );
}

/** A sheet's Done, at its head's left as iOS puts it: slides it shut. */
function SheetDone() {
  const sheet = useSheet();
  return (
    <button
      type="button"
      className="h-11 border-0 bg-transparent px-2 text-[16px] font-semibold text-(--ui-link) active:opacity-50"
      onClick={() => sheet?.close()}
    >
      Done
    </button>
  );
}

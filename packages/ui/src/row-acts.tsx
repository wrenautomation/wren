/**
 * A row's own actions, run where it sits (designs/2026-10-14-customerio-audit.md, B3 item 13):
 * on a wide screen one quiet icon sits at the row's end and its other main icons show on hover or
 * focus, the rest behind ⋯; a phone swipes them. Text an action asks for (a reply, a reason) is typed in
 * a box under the row, not in a dialog. Every list gets them from its record type's actions.
 */
import { cn } from "cn";
import {
  Archive,
  ArchiveRestore,
  Bell,
  CalendarClock,
  Check,
  CheckCheck,
  CircleCheck,
  Clock,
  Copy,
  Ellipsis,
  Eye,
  EyeOff,
  Heart,
  ImageIcon,
  ListPlus,
  type LucideIcon,
  Maximize2,
  Megaphone,
  MessageSquare,
  Pause,
  Pencil,
  Phone,
  Play,
  Reply,
  Rocket,
  RotateCcw,
  RotateCw,
  Send,
  ThumbsDown,
  Trash2,
  Trophy,
  Upload,
  UserPlus,
  UserX,
  X,
} from "lucide-react";
import { type KeyboardEvent, type ReactNode, useState } from "react";
import { type Action, runs, setsAside } from "./action.js";
import { Popover, PopoverContent, PopoverTrigger } from "./components/ui/popover.js";
import { Button } from "./controls.js";
import { TextAreaField, useEditForm } from "./edit-form.js";
import { tipProps } from "./hint.js";

/** An action's icon by what its label says it does; first match wins. */
const VERBS: readonly (readonly [RegExp, LucideIcon])[] = [
  [/^(reply|text back|answer|comment|message|dm\b)/i, Reply],
  [/ask for changes|redraft/i, MessageSquare],
  [/not done|open again|bring back|wake|taken it back|back to/i, RotateCcw],
  [/restore/i, ArchiveRestore],
  [/approve|send invite/i, Check],
  [/mark read|mark seen/i, CheckCheck],
  [/done|^close$|given it|resolve|addressed/i, CircleCheck],
  [/won/i, Trophy],
  [/lost|not a fit/i, ThumbsDown],
  [/archive|retire/i, Archive],
  [/delete|remove|take out|void/i, Trash2],
  [/unpublish/i, EyeOff],
  // Closes a person for good, apart from skipping one item.
  [/pass on/i, UserX],
  [/skip|pass|don't|drop|dismiss|decline|reject|withdraw|hide|no-show|^clear$/i, X],
  [/snooze|not yet/i, Clock],
  [/pause/i, Pause],
  [/resume|start|go live|release/i, Play],
  [/assign|take it|follow|invite/i, UserPlus],
  [/edit|draft|change it|new title|^record$/i, Pencil],
  [/publish|new version/i, Upload],
  [/thumbnail/i, ImageIcon],
  [/add to/i, ListPlus],
  [/^watch$/i, Eye],
  [/ship/i, Rocket],
  [/retry|replay|again|render/i, RotateCw],
  [/like/i, Heart],
  [/remind/i, Bell],
  [/duplicate/i, Copy],
  [/move|schedule/i, CalendarClock],
  [/promote/i, Megaphone],
  [/called|booked/i, Phone],
  [/send/i, Send],
];

/** The icon a row shows for `label`, or null: an action with none waits behind ⋯. */
export function iconOf(label: string): LucideIcon | null {
  return VERBS.find(([re]) => re.test(label))?.[1] ?? null;
}

/** At most this many icons beside ⋯. */
export const ROW_MAIN = 3;

/**
 * A row's actions, main first: the one that moves it on (Approve, Mark done), a reply, the one
 * that sets it aside (Archive, Delete), then the rest that have an icon, up to `ROW_MAIN` in all.
 * `reply` takes one of those places: the page draws its own reply box. The rest go behind ⋯.
 */
export function rowActsOf(
  actions: readonly Action[],
  row: Record<string, unknown>,
  reply = false,
): { main: Action[]; more: Action[] } {
  const can = actions.filter((a) => !a.inline && runs(a, row));
  const moves = can.filter((a) => !a.form && !a.ask && !setsAside(a.label));
  const asks = can.filter((a) => a.ask);
  const aside = can.filter((a) => !a.form && !a.ask && setsAside(a.label));
  const firsts = [moves[0], reply ? undefined : asks[0], aside[0]];
  const room = ROW_MAIN - (reply ? 1 : 0);
  const main: Action[] = [];
  for (const a of [...firsts, ...moves, ...asks, ...aside, ...can]) {
    if (main.length >= room) break;
    if (a && !main.includes(a) && iconOf(a.label)) main.push(a);
  }
  // In the order the page lists them, so a row's icons sit in the same places row to row.
  main.sort((a, b) => can.indexOf(a) - can.indexOf(b));
  return { main, more: can.filter((a) => !main.includes(a)) };
}

const ICON_BUTTON =
  "inline-grid size-7 flex-none cursor-pointer place-items-center rounded-(--ui-radius) border-0 bg-transparent text-(--ui-ink-2) no-underline transition-colors hover:bg-(--ui-fill) hover:text-(--ui-ink) focus-visible:outline-2 focus-visible:outline-(--ui-focus) disabled:cursor-default disabled:opacity-60 data-[popup-open]:bg-(--ui-fill)";

/** The one icon a row always shows: quiet until its row is hovered, then accent. */
const QUIET_BUTTON =
  "inline-grid size-7 flex-none cursor-pointer place-items-center [border-radius:var(--ui-leaf-button)] border-0 bg-transparent text-(--ui-ink-3) no-underline transition-colors group-hover:text-(--ui-accent) hover:bg-(--ui-accent-tint) hover:text-(--ui-accent) focus-visible:text-(--ui-accent) focus-visible:outline-2 focus-visible:outline-(--ui-focus) disabled:cursor-default disabled:opacity-60 data-[popup-open]:bg-(--ui-accent-tint) data-[popup-open]:text-(--ui-accent) pointer-coarse:size-11";

/**
 * A row's actions, run where it sits. A wide row always shows one quiet icon at its end: the
 * reply, else its first main action, else ⋯. The rest of its main icons and ⋯ come over the row's
 * own ground on hover, on focus, or while the keyboard's cursor is on it. ⋯ holds the rest and the
 * record's own page. `lone` is a phone row's: the quiet icon alone, the swipes carry the rest.
 * `still` is a card's foot: every icon in place.
 */
export function RowActions({
  title,
  main,
  more,
  reply,
  page,
  busy,
  run,
  still = false,
  lone = false,
}: {
  title: string;
  main: readonly Action[];
  more: readonly Action[];
  /** The page draws a reply box: Reply leads. */
  reply: (() => void) | null;
  /** The record's own page. */
  page: string;
  busy: boolean;
  run: (a: Action) => void;
  /** In place and always shown: a card's foot, not a row's end. */
  still?: boolean;
  /** A phone row's: the quiet icon alone. */
  lone?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const act = (a: Action, className: string) => {
    const Glyph = iconOf(a.label) ?? Check;
    return (
      <button
        key={a.id}
        type="button"
        disabled={busy}
        className={className}
        {...tipProps(a.label, { as: "name", ...(a.key ? { keys: a.key } : {}) })}
        onClick={() => run(a)}
      >
        <Glyph className="size-4" aria-hidden />
      </button>
    );
  };
  const replyButton = (className: string) =>
    reply ? (
      <button
        type="button"
        className={className}
        {...tipProps("Reply", { as: "name", keys: "r" })}
        onClick={reply}
      >
        <Reply className="size-4" aria-hidden />
      </button>
    ) : null;
  const menu = (className: string) => (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        className={className}
        aria-label={`More for ${title}`}
        {...tipProps("More", { as: "none" })}
      >
        <Ellipsis className="size-4" aria-hidden />
      </PopoverTrigger>
      <PopoverContent align="end" className="w-52 gap-0 p-1">
        {more.map((a) => (
          <button
            key={a.id}
            type="button"
            disabled={busy}
            className="flex h-8 w-full cursor-pointer items-center rounded-(--ui-radius) border-0 bg-transparent px-2 text-left text-[13px] text-(--ui-ink) hover:bg-(--ui-hover) disabled:opacity-60"
            onClick={() => {
              setOpen(false);
              run(a);
            }}
          >
            {a.label}
          </button>
        ))}
        <a
          href={page}
          className="flex h-8 w-full items-center gap-2 rounded-(--ui-radius) px-2 text-[13px] text-(--ui-ink) no-underline hover:bg-(--ui-hover)"
        >
          <Maximize2 className="size-3.5 text-(--ui-ink-2)" aria-hidden />
          Open as a page
        </a>
      </PopoverContent>
    </Popover>
  );
  if (still)
    return (
      <div data-row-acts="" className="flex items-center gap-0.5">
        {replyButton(ICON_BUTTON)}
        {main.map((a) => act(a, ICON_BUTTON))}
        {menu(ICON_BUTTON)}
      </div>
    );
  // The quiet icon: the reply, else the first main action, else ⋯ itself.
  const lead = reply ? "reply" : main[0] ? "main" : "menu";
  const rest = lead === "main" ? main.slice(1) : lead === "menu" ? [] : main;
  const quiet =
    lead === "reply"
      ? replyButton(QUIET_BUTTON)
      : lead === "main" && main[0]
        ? act(main[0], QUIET_BUTTON)
        : menu(QUIET_BUTTON);
  if (lone)
    return (
      <div data-row-acts="" className="inline-flex">
        {quiet}
      </div>
    );
  return (
    <div data-row-acts="" className="relative inline-flex items-center">
      {lead === "menu" ? null : (
        <span
          className={cn(
            "absolute inset-y-[-8px] right-full z-1 flex items-center gap-0.5 pr-0.5 pl-8 transition-opacity duration-150",
            "[background:linear-gradient(to_right,transparent,var(--row-ground)_1.75rem)]",
            open
              ? "opacity-100"
              : "pointer-events-none opacity-0 group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100 group-data-cursor:pointer-events-auto group-data-cursor:opacity-100",
          )}
        >
          {rest.map((a) => act(a, ICON_BUTTON))}
          {menu(ICON_BUTTON)}
        </span>
      )}
      {quiet}
    </div>
  );
}

/**
 * The words an action asks for, typed under its row: a reply, a reason. ⌘ Enter sends, Escape
 * closes. `send` answers true once it worked; the box then closes.
 */
export function AskBox({
  action,
  start,
  keep,
  send,
  close,
}: {
  action: Action;
  start: string;
  /** Where the words wait until sent (record, row and action); closing the box keeps them. */
  keep: string;
  send: (text: string) => Promise<boolean>;
  close: () => void;
}) {
  const form = useEditForm({ key: keep, defaults: { text: start }, base: start });
  const text = form.watch("text");
  const busy = form.formState.isSubmitting;
  const label = action.ask?.label ?? action.label;
  const go = form.onSend(async (v) => {
    if (!v.text.trim()) return false;
    const ok = await send(v.text);
    if (ok) close();
    return ok;
  });
  const keys = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      close();
    } else if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && !busy) void go(e);
  };
  return (
    <form onSubmit={(e) => void go(e)} className="grid max-w-3xl gap-2">
      <TextAreaField
        form={form}
        name="text"
        autoFocus
        rows={3}
        aria-label={label}
        placeholder={label}
        onKeyDown={keys}
        box="bg-(--ui-paper) text-[14px] leading-[1.55]"
      />
      <div className="flex items-center gap-2">
        <Button size="dense" tone="primary" type="submit" busy={busy} disabled={!text.trim()}>
          {action.label}
        </Button>
        <Button size="dense" tone="quiet" onClick={close}>
          Cancel
        </Button>
        <span className="ml-auto text-[11px] text-(--ui-ink-3) max-[480px]:hidden">
          ⌘ Enter to {action.label.toLowerCase()}
        </span>
      </div>
    </form>
  );
}

/** A row's box for the page's own reply, with a way to close it. */
export function ReplyFrame({ children, close }: { children: ReactNode; close: () => void }) {
  return (
    <div className="grid max-w-3xl gap-2">
      {children}
      <div>
        <Button size="dense" tone="quiet" icon="close" onClick={close}>
          Close
        </Button>
      </div>
    </div>
  );
}

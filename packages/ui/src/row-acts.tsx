/**
 * A row's own actions, run where it sits (designs/2026-10-14-customerio-audit.md, B3 item 13):
 * on a wide screen its main two to four show as icons at the row's right end on hover or focus,
 * the rest behind ⋯; a phone swipes them. Text an action asks for (a reply, a reason) is typed in
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
  X,
} from "lucide-react";
import { type FormEvent, type KeyboardEvent, type ReactNode, useState } from "react";
import { type Action, runs, setsAside } from "./action.js";
import { Popover, PopoverContent, PopoverTrigger } from "./components/ui/popover.js";
import { Textarea } from "./components/ui/textarea.js";
import { Button } from "./controls.js";
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

/**
 * A wide row's actions: icons at its right end over the row's own ground, seen on hover, on
 * focus, or while the keyboard's cursor is on it. ⋯ holds the rest and the record's own page.
 */
export function RowActions({
  title,
  main,
  more,
  reply,
  page,
  busy,
  run,
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
}) {
  const [open, setOpen] = useState(false);
  return (
    <div
      data-row-acts=""
      className={cn(
        "absolute inset-y-0 right-0 z-1 flex items-center gap-0.5 pr-2 pl-8 transition-opacity duration-150",
        "[background:linear-gradient(to_right,transparent,var(--row-ground)_1.75rem)]",
        open
          ? "opacity-100"
          : "pointer-events-none opacity-0 group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100 group-data-cursor:pointer-events-auto group-data-cursor:opacity-100",
      )}
    >
      {reply ? (
        <button
          type="button"
          className={ICON_BUTTON}
          {...tipProps("Reply", { as: "name", keys: "r" })}
          onClick={reply}
        >
          <Reply className="size-4" aria-hidden />
        </button>
      ) : null}
      {main.map((a) => {
        const Glyph = iconOf(a.label) ?? Check;
        return (
          <button
            key={a.id}
            type="button"
            disabled={busy}
            className={ICON_BUTTON}
            {...tipProps(a.label, { as: "name", ...(a.key ? { keys: a.key } : {}) })}
            onClick={() => run(a)}
          >
            <Glyph className="size-4" aria-hidden />
          </button>
        );
      })}
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          className={ICON_BUTTON}
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
  send,
  close,
}: {
  action: Action;
  start: string;
  send: (text: string) => Promise<boolean>;
  close: () => void;
}) {
  const [text, setText] = useState(start);
  const [busy, setBusy] = useState(false);
  const label = action.ask?.label ?? action.label;
  const go = async (e?: FormEvent) => {
    e?.preventDefault();
    if (busy || !text.trim()) return;
    setBusy(true);
    const ok = await send(text);
    setBusy(false);
    if (ok) close();
  };
  const keys = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      close();
    } else if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void go(e);
  };
  return (
    <form onSubmit={(e) => void go(e)} className="grid max-w-3xl gap-2">
      <Textarea
        autoFocus
        rows={3}
        value={text}
        aria-label={label}
        placeholder={label}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={keys}
        className="bg-(--ui-paper) text-[14px] leading-[1.55]"
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

/**
 * The asker's chats beside the thread (designs/2026-11-04-multi-user-runtime.md): day heads, the
 * time on the right, the open one marked by a bar and a fill.
 */
import { useState } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "./components/ui/popover.js";
import { cx } from "./format.js";
import { tipProps } from "./hint.js";
import { Icon } from "./icons.js";
import { PANEL_ACT } from "./side-panel.js";

/** A stored chat, as the relay lists it. */
export interface AgentChatRow {
  session: string;
  /** ISO time of its last turn. */
  at: string;
  title?: string | undefined;
}

const DAY = 86_400_000;
/** Today, Yesterday, This week, then by month. */
const groupOf = (at: number, now: Date) => {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  if (at >= today) return "Today";
  if (at >= today - DAY) return "Yesterday";
  if (at >= today - 6 * DAY) return "This week";
  return new Date(at).toLocaleDateString(undefined, { month: "long", year: "numeric" });
};

/** The row's time under its head: the hour today and yesterday, the weekday this week, else the day. */
const short = (d: Date, head: string) =>
  head === "Today" || head === "Yesterday"
    ? d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })
    : head === "This week"
      ? d.toLocaleDateString(undefined, { weekday: "short" })
      : d.toLocaleDateString(undefined, { month: "short", day: "numeric" });

/** The asker's chats, newest first, under day heads; the open one marked. */
export function AgentChats({
  rows,
  open,
  hrefOf,
  onOpen,
}: {
  rows: readonly AgentChatRow[];
  open: string | null;
  hrefOf: (r: AgentChatRow) => string;
  /** A plain click: the page's own navigation. */
  onOpen: (r: AgentChatRow) => void;
}) {
  const now = new Date();
  const groups: { head: string; rows: AgentChatRow[] }[] = [];
  for (const r of rows) {
    const head = groupOf(new Date(r.at).getTime(), now);
    const g = groups.at(-1);
    if (g?.head === head) g.rows.push(r);
    else groups.push({ head, rows: [r] });
  }
  return (
    <div className="grid min-h-0 content-start gap-4 overflow-y-auto [scrollbar-width:thin]">
      {groups.map((g) => (
        <section key={g.head} aria-label={g.head} className="grid gap-px">
          <h3 className="m-0 px-2.5 pb-1 text-[12px] font-medium text-(--ui-ink-3)">{g.head}</h3>
          <ul className="m-0 grid list-none gap-px p-0">
            {g.rows.map((r) => {
              const on = r.session === open;
              return (
                <li key={r.session}>
                  <a
                    href={hrefOf(r)}
                    aria-current={on ? "page" : undefined}
                    onClick={(e) => {
                      if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
                      e.preventDefault();
                      onOpen(r);
                    }}
                    className={cx(
                      "group/chat relative flex items-baseline gap-3 rounded-[8px] py-2 pr-2.5 pl-3 no-underline transition-[background-color,color] duration-150 focus-visible:outline-offset-[-2px]",
                      // the open one by its fill and weight: no side bar (William, 11-06)
                      on
                        ? "bg-(--ui-fill) text-(--ui-ink)"
                        : "text-(--ui-ink) hover:bg-(--ui-fill)",
                    )}
                  >
                    <span
                      className={cx(
                        "min-w-0 flex-1 text-[13.5px]/[1.4] wrap-anywhere",
                        on && "font-medium",
                      )}
                    >
                      {r.title || "Untitled chat"}
                    </span>
                    <span className="flex-none text-[11.5px] text-(--ui-ink-3) tabular-nums">
                      {short(new Date(r.at), g.head)}
                    </span>
                  </a>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}

/** The side panel's chat switcher: the Ask page's list, off a head action. */
export function AgentChatsMenu({
  rows,
  open,
  hrefOf,
  onOpen,
}: {
  /** undefined while the list reads. */
  rows: readonly AgentChatRow[] | undefined;
  open: string | null;
  hrefOf: (r: AgentChatRow) => string;
  onOpen: (r: AgentChatRow) => void;
}) {
  const [shown, setShown] = useState(false);
  return (
    <Popover open={shown} onOpenChange={setShown}>
      <PopoverTrigger aria-label="Chats" {...tipProps("Chats")} className={PANEL_ACT}>
        <Icon name="list" size={16} />
      </PopoverTrigger>
      <PopoverContent
        align="end"
        side="bottom"
        aria-label="Chats"
        // a click opens it unfocused: no ring on the first row
        initialFocus={(t) => t === "keyboard"}
        className="grid max-h-[min(70dvh,520px)] w-[min(340px,calc(100vw-24px))] gap-0 overflow-hidden bg-(--ui-paper) p-1.5 pt-2.5 text-(--ui-ink)"
      >
        {rows?.length ? (
          <AgentChats
            rows={rows}
            open={open}
            hrefOf={hrefOf}
            onOpen={(r) => {
              setShown(false);
              onOpen(r);
            }}
          />
        ) : (
          <p className="m-0 px-2.5 pb-1.5 text-[13px] text-(--ui-ink-3)">
            {rows ? "No chats yet." : "Reading chats…"}
          </p>
        )}
      </PopoverContent>
    </Popover>
  );
}

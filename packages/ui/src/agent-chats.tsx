/**
 * The asker's chats beside the thread (designs/2026-11-04-multi-user-runtime.md): day heads, the
 * time on the right, the open one marked by a bar and a fill.
 */
import { cx } from "./format.js";

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
                      "group/chat relative flex items-baseline gap-3 rounded-[8px] py-2 pr-2.5 pl-3 no-underline transition-[background-color,color] duration-150",
                      "before:absolute before:inset-y-2 before:left-0 before:w-[2px] before:rounded-full before:bg-(--ui-ink) before:opacity-0 before:transition-opacity before:duration-150",
                      on
                        ? "bg-(--ui-fill) text-(--ui-ink) before:opacity-100"
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

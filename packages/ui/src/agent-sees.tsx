/**
 * What the agent sees of the page (designs/2026-11-11-agent-panel.md, D3), on the composer or the
 * panel's head (designs/2026-11-26-redesign.md D3): one
 * short line, and on click every part the next turn carries, as the agent reads it. Each part can
 * be left out of the next turn.
 */
import { Popover, PopoverContent, PopoverTrigger } from "./components/ui/popover.js";
import { cx } from "./format.js";
import { tipProps } from "./hint.js";
import { Icon, type IconName } from "./icons.js";

export interface SeenPart {
  /** list, record, selection, or the page's own. */
  id: string;
  label: string;
  icon: IconName;
  /** The text the turn carries. */
  text: string;
  /** Left out of the next turn. */
  off?: boolean | undefined;
}

export function PageSeen({
  page,
  parts,
  onToggle,
  head = false,
}: {
  /** "Deals › Pipeline". */
  page: string;
  parts: readonly SeenPart[];
  onToggle: (id: string) => void;
  /** In the panel's head, beside its name (v116 `.an-ctx`): smaller, no eye. */
  head?: boolean;
}) {
  const on = parts.filter((p) => !p.off);
  // "Aerie › Tasks · Tasks": a part named as the page adds nothing
  const name = page.split(" › ").at(-1);
  const line = [page, ...on.map((p) => p.label).filter((l) => l !== name)].join(" · ");
  return (
    <Popover>
      <PopoverTrigger
        className={cx(
          "inline-flex max-w-full items-center gap-1.5 bg-(--ui-fill) text-left text-(--ui-ink-2) transition-colors hover:bg-(--ui-hover) hover:text-(--ui-ink)",
          head
            ? "min-h-6 rounded-[6px] px-2 py-1 text-[12px]"
            : "min-h-7 rounded-[14px] py-1 pr-2 pl-2.5 text-[12.5px]",
        )}
        {...tipProps("What the agent sees")}
      >
        {head ? null : <Icon name="eye" size={13} className="flex-none" />}
        {/* a new page: its words cross-fade in */}
        <span key={line} className="min-w-0 wrap-anywhere [animation:ui-fade_.12s_both]">
          {line}
        </span>
      </PopoverTrigger>
      <PopoverContent
        aria-label="What the agent sees"
        align="start"
        className="grid w-[min(360px,calc(100vw-32px))] gap-2 p-3"
      >
        <span className="text-[12px] font-medium text-(--ui-ink-3)">
          The next message carries this
        </span>
        <span className="text-[13px] font-medium text-(--ui-ink)">{page}</span>
        <ul className="m-0 grid list-none gap-1.5 p-0">
          {parts.map((p) => (
            <li key={p.id} className="grid gap-1">
              <span className="flex items-center gap-2">
                <Icon name={p.icon} size={13} className="flex-none text-(--ui-ink-3)" />
                <span
                  className={cx(
                    "min-w-0 flex-1 text-[13px] text-(--ui-ink)",
                    p.off && "text-(--ui-ink-3) line-through",
                  )}
                >
                  {p.label}
                </span>
                <button
                  type="button"
                  onClick={() => onToggle(p.id)}
                  className="rounded-[8px] px-2 py-0.5 text-[12px] font-medium text-(--ui-link) hover:bg-(--ui-fill)"
                >
                  {p.off ? "Send it" : "Leave out"}
                </button>
              </span>
              {p.off ? null : (
                <pre className="m-0 max-h-32 overflow-y-auto rounded-[8px] bg-(--ui-canvas) px-2.5 py-2 font-mono text-[11.5px]/[1.55] whitespace-pre-wrap text-(--ui-ink) shadow-[inset_0_0_0_1px_var(--ui-hair)] [overflow-wrap:anywhere]">
                  {p.text}
                </pre>
              )}
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  );
}

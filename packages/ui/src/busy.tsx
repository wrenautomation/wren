/**
 * The busy ring, the one mark for any wait (William, 10-21): a faint track and one arc that
 * turns, 0.8 s a turn. 14 px after a label, 18 px in a running step, 40 px in a modal. `on` says
 * it is at work. `done` says it just worked: a check draws in the same slot. A part that can go
 * busy keeps the slot, so its width never changes. No bars, no sweeps. Source: designs/2026-10-20-design-language/design-language.src.html, `.rg`. CSS:
 * `.ui-busy` in tailwind.css.
 */

const SIZES = { small: 14, step: 18, big: 40 } as const;
export type BusySize = keyof typeof SIZES;

export function Busy({
  on,
  done = false,
  size = "small",
}: {
  on: boolean;
  done?: boolean | undefined;
  size?: BusySize;
}) {
  return (
    <span
      aria-hidden="true"
      data-busy=""
      data-on={on ? "" : undefined}
      data-done={done && !on ? "" : undefined}
      className="ui-busy"
      style={{ width: SIZES[size], height: SIZES[size] }}
    >
      <svg viewBox="0 0 40 40" aria-hidden="true">
        <circle data-track="" cx="20" cy="20" r="15" />
        <circle data-arc="" cx="20" cy="20" r="15" />
        <path data-check="" d="M11 21l6 6 12-13" />
      </svg>
    </span>
  );
}

/**
 * A wait with no path to show (a map that builds): a box with the big ring, what loads and, when
 * known, how much. It is a live status, so a screen reader says the title once.
 */
export function BusyBox({ title, note }: { title: string; note?: string | undefined }) {
  return (
    <div
      role="status"
      className="mx-auto grid w-fit min-w-56 justify-items-center gap-1 rounded-(--ui-radius) border border-(--ui-hair) bg-(--ui-paper) px-4 pt-5 pb-4 text-center shadow-(--ui-shadow)"
    >
      <Busy on size="big" />
      <b className="mt-1.5 text-[14px] font-semibold text-(--ui-ink)">{title}</b>
      {note ? <span className="text-[12.5px] text-(--ui-ink-2)">{note}</span> : null}
    </div>
  );
}

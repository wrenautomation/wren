/**
 * The busy ring, the one mark for any wait (William, 10-21): a faint track and one arc that
 * turns, 0.8 s a turn. 14 px after a label, 18 px in a running step, 40 px in a modal. It shows
 * only while `on`: no slot waits for it. A part that must keep its width (a button) holds the
 * ring in its own place (controls.tsx). Source: designs/2026-10-20-design-language/
 * design-language.src.html, `.rg`. CSS: `.ui-busy` in tailwind.css.
 */

/** 14 px after a label, 18 px in a running step, 40 px in a modal (sizes in tailwind.css). */
export type BusySize = "small" | "step" | "big";

/**
 * The ring itself, always drawn: for a part that fades it in and out in its own holder. `on`
 * says it shows now (`data-on`); a holder sets it false while the ring waits faded out.
 */
export function Ring({ size = "small", on = true }: { size?: BusySize; on?: boolean }) {
  return (
    <svg
      viewBox="0 0 40 40"
      aria-hidden="true"
      data-busy=""
      data-on={on ? "" : undefined}
      data-size={size}
      className="ui-busy"
    >
      <circle data-track="" cx="20" cy="20" r="15" />
      <circle data-arc="" cx="20" cy="20" r="15" />
    </svg>
  );
}

/** The ring while `on`, and nothing when off. */
export function Busy({ on, size = "small" }: { on: boolean; size?: BusySize }) {
  return on ? <Ring size={size} /> : null;
}

/**
 * A wait with no path to show (a map that builds): a box with the big ring, what loads and, when
 * known, how much. It is a live status, so a screen reader says the title once.
 */
export function BusyBox({ title, note }: { title: string; note?: string | undefined }) {
  return (
    <div role="status" className="ui-modal">
      <Ring size="big" />
      <b>{title}</b>
      {note ? <span>{note}</span> : null}
    </div>
  );
}

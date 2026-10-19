/**
 * The column of a board of cards (Notes → Board, Journeys → Board): a drop target with its name and
 * count, the cards, and a line when empty. Drag is the browser's own (`draggable`, `dataTransfer`),
 * so a card carries its id under `mime` and a lane hands the dropped id to `onDropId`. The lane
 * decides nothing: the board says whether a drop is allowed.
 */
import { cx, num } from "@wren/ui";
import { type ReactNode, useState } from "react";

/** What a card sets on drag start: its id under the board's `mime`. */
export function dragStart(e: React.DragEvent, mime: string, id: string) {
  e.dataTransfer.setData(mime, id);
  e.dataTransfer.effectAllowed = "move";
}

export function Lane({
  name,
  count,
  tone,
  write,
  mime,
  onDropId,
  empty,
  footer,
  children,
}: {
  name: string;
  count: number;
  /** A column that closes the work reads good; one that is only a rest reads faint. */
  tone?: "good" | "faint" | undefined;
  /** Whether a drop is taken at all: false on the demo and for a reader. */
  write: boolean;
  /** The `dataTransfer` type the board's cards set. */
  mime: string;
  onDropId: (id: string) => void;
  /** Said when there are no cards. */
  empty: string;
  footer?: ReactNode;
  children?: ReactNode;
}) {
  const [over, setOver] = useState(false);
  return (
    <section
      aria-label={name}
      className={cx(
        "grid w-[264px] shrink-0 content-start gap-2 border border-(--ui-hair) bg-(--ui-wash) p-2",
        over && "border-(--ui-active)",
      )}
      onDragOver={(e) => {
        if (!write) return;
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        setOver(false);
        const id = e.dataTransfer.getData(mime);
        if (id) onDropId(id);
      }}
    >
      <header className="flex items-baseline justify-between gap-2 px-1">
        <h2
          className={cx(
            "m-0 text-[13.5px] font-semibold",
            tone === "good" && "text-(--ui-good-ink)",
            tone === "faint" && "text-(--ui-ink-3)",
          )}
        >
          {name}
          <span className="ml-1.5 font-normal text-(--ui-ink-3)">{num(count)}</span>
        </h2>
      </header>
      {children}
      {count ? null : <p className="m-0 px-1 py-3 text-[12.5px] text-(--ui-ink-3)">{empty}</p>}
      {footer}
    </section>
  );
}

/** A phone's stand-in for a drag: the card's own picker. */
export const SELECT =
  "min-h-[34px] border border-(--ui-hair) bg-(--ui-paper) px-2 py-1 text-[13.5px] text-(--ui-ink) focus:border-(--ui-focus) focus:outline-none";

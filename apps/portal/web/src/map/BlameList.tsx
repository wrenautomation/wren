/**
 * The versions that touched one node or one line, newest first, as a section of a card (the
 * node's details, its edit card, a line's edit card). One line per version: its number, what it
 * did, why, who and when. A line opens the History card on that version with its parent picked,
 * so the Map draws what the version changed. One part for every card; `useBlame` reads it.
 */
import type { BlameAsk, BlameLine } from "@wren/pipeline/history";
import { Icon, LoadFailed, Loading } from "@wren/ui";
import { blameHow, blameMeta } from "./drafts.js";
import { useBlame } from "./read.js";

export function BlameList({
  at,
  ask,
  label,
  onOpen,
}: {
  /** The workspace as a call's params. */
  at: Record<string, string>;
  /** The node or the line; nothing is read while it is null. */
  ask: BlameAsk | null;
  /** The section's name: "Node history", "Line history". */
  label: string;
  /** A line was picked: History opens on its version. */
  onOpen: (line: BlameLine) => void;
}) {
  const read = useBlame(at, ask);
  // A node or line the saved shape lacks (one the draft just added) has no history to read.
  const none = read.error && (read.error.status === 400 || read.error.status === 404);
  return (
    <section aria-label={label}>
      <h3 className="mb-1.5 text-[13px] font-semibold text-(--ui-ink-2)">History</h3>
      {read.error && !read.data && !none ? (
        <LoadFailed error={read.error} onRetry={read.retry} what="history" />
      ) : !read.data && !none ? (
        <Loading lines={2} />
      ) : read.data?.length ? (
        <ul className="list-none">
          {read.data.map((l) => (
            <li key={`${l.version}:${l.how}:${l.at}`}>
              <button
                type="button"
                onClick={() => onOpen(l)}
                className="flex min-h-11 w-full cursor-pointer items-start gap-2 border-0 bg-transparent px-1 py-1.5 text-left text-(--ui-ink) hover:bg-(--ui-hover)"
              >
                <Icon name="stack" size={15} className="mt-0.5 text-(--ui-ink-2)" />
                <span className="min-w-0 flex-1">
                  <span className="block">
                    <span className="font-semibold">Version {l.version}</span>
                    <span className="text-(--ui-ink-2)"> · {blameHow(l)}</span>
                  </span>
                  {l.note ? (
                    <span className="block truncate text-(--ui-ink-2)">{l.note}</span>
                  ) : null}
                  <span className="block text-[12.5px] text-(--ui-ink-3)">{blameMeta(l)}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-(--ui-ink-3)">No history yet.</p>
      )}
    </section>
  );
}

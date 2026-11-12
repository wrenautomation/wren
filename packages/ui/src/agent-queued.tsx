/**
 * Turns typed while the agent works (designs/2026-11-11-agent-panel.md, smaller calls): they wait
 * here, over the composer, and go one at a time after each reply ends. Until then each can be
 * changed or dropped.
 */
import { useState } from "react";
import { tipProps } from "./hint.js";
import { Icon } from "./icons.js";

export interface QueuedTurn {
  id: string;
  text: string;
  /** Carries files: words can't change without dropping them. */
  files?: boolean | undefined;
}

function Chip({
  t,
  n,
  onEdit,
  onRemove,
}: {
  t: QueuedTurn;
  n: number;
  onEdit: (id: string, text: string) => void;
  onRemove: (id: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(t.text);
  const save = () => {
    const v = text.trim();
    if (v) onEdit(t.id, v);
    else setText(t.text);
    setEditing(false);
  };
  return (
    <li className="flex min-h-9 items-start gap-2 rounded-[12px] bg-(--ui-fill) py-1.5 pr-1 pl-2.5 [animation:ui-fade_.15s_both]">
      <span className="mt-[3px] flex-none text-[11.5px] font-semibold text-(--ui-ink-3) tabular-nums">
        {n}
      </span>
      {editing ? (
        <textarea
          // edit-ok: one queued line, saved on blur and Enter
          // biome-ignore lint/a11y/noAutofocus: opened by the edit button just pressed
          autoFocus
          rows={Math.min(4, text.split("\n").length)}
          aria-label="Queued message"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onBlur={save}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              save();
            }
            if (e.key === "Escape") {
              setText(t.text);
              setEditing(false);
            }
          }}
          className="min-w-0 flex-1 resize-none bg-transparent text-[13px]/[1.45] text-(--ui-ink) outline-none"
        />
      ) : (
        <span className="min-w-0 flex-1 text-[13px]/[1.45] wrap-anywhere text-(--ui-ink-2)">
          {t.text}
        </span>
      )}
      {editing || t.files ? null : (
        <button
          type="button"
          aria-label="Change it"
          {...tipProps("Change it")}
          onClick={() => setEditing(true)}
          className="grid size-6 flex-none place-items-center rounded-full text-(--ui-ink-3) hover:bg-(--ui-wash) hover:text-(--ui-ink)"
        >
          <Icon name="edit" size={12} />
        </button>
      )}
      <button
        type="button"
        aria-label="Don't send it"
        {...tipProps("Don't send it")}
        onClick={() => onRemove(t.id)}
        className="grid size-6 flex-none place-items-center rounded-full text-(--ui-ink-3) hover:bg-(--ui-wash) hover:text-(--ui-ink)"
      >
        <Icon name="close" size={11} />
      </button>
    </li>
  );
}

/** What waits to be sent, oldest first. */
export function QueuedTurns({
  turns,
  onEdit,
  onRemove,
}: {
  turns: readonly QueuedTurn[];
  onEdit: (id: string, text: string) => void;
  onRemove: (id: string) => void;
}) {
  if (!turns.length) return null;
  return (
    <section aria-label="Waiting to send" className="grid gap-1.5">
      <span className="flex items-center gap-1.5 px-1 text-[12px] text-(--ui-ink-3)">
        <Icon name="wait" size={12} />
        {turns.length === 1 ? "Sends when this reply ends" : "Send one by one as each reply ends"}
      </span>
      <ol className="m-0 grid list-none gap-1 p-0">
        {turns.map((t, i) => (
          <Chip key={t.id} t={t} n={i + 1} onEdit={onEdit} onRemove={onRemove} />
        ))}
      </ol>
    </section>
  );
}

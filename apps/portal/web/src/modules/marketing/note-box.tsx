/** The Inbox thread's note box: words for the team, never sent. `@email` tags a teammate. */
import { Button, UnsavedMark, useEdit } from "@wren/ui";
import type { RefObject } from "react";

const FIELD =
  "w-full resize-y border border-(--ui-hair) bg-(--ui-paper) px-2 py-1.5 text-[13px] text-(--ui-ink) outline-none focus-visible:border-(--ui-focus)";

export function NoteBox({
  thread,
  box,
  busy,
  submit,
}: {
  /** Keeps unsent words per thread across a reload. */
  thread: string;
  box: RefObject<HTMLTextAreaElement | null>;
  busy: boolean;
  /** True when kept: the box clears. */
  submit: (body: string) => Promise<boolean>;
}) {
  const words = useEdit(`inbox-note:${thread}`, "");
  const text = words.value;
  const send = async () => {
    if (!text.trim() || busy) return;
    if (await submit(text.trim())) words.discard();
  };
  const label = "Only the team sees it. @email tags someone.";
  return (
    <div className="flex flex-col gap-1.5">
      <textarea
        ref={box}
        {...words.field}
        rows={2}
        maxLength={4000}
        placeholder={label}
        aria-label={label}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            void send();
          }
        }}
        className={FIELD}
      />
      <div className="flex items-center gap-2">
        <Button
          tone="primary"
          size="dense"
          disabled={!text.trim() || busy}
          onClick={() => void send()}
        >
          Add note
        </Button>
        <UnsavedMark edit={words} />
      </div>
    </div>
  );
}

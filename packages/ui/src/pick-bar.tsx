/**
 * A list's select mode, at the foot of the screen: "3 picked", the list's own actions, Done.
 * Esc ends it. A note says what the last action did ("2 saved. 1 not saved: ..."). Clear of the
 * phone's tab bar.
 */
import { cn } from "cn";
import { type ReactNode, useEffect } from "react";
import { num } from "./format.js";

export function PickBar({
  n,
  actions,
  note,
  bad,
  onEnd,
  className,
}: {
  n: number;
  /** what the picks can do; each turns itself off at 0 */
  actions: ReactNode;
  /** what the last action did */
  note?: ReactNode;
  /** the note is a failure: an alert, in the error ink */
  bad?: boolean | undefined;
  /** Done or Esc: leaves select mode */
  onEnd: () => void;
  className?: string | undefined;
}) {
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !e.defaultPrevented) onEnd();
    };
    addEventListener("keydown", key);
    return () => removeEventListener("keydown", key);
  }, [onEnd]);
  return (
    <div
      className={cn(
        "pointer-events-none fixed inset-x-0 z-50 flex justify-center px-4",
        "bottom-[calc(env(safe-area-inset-bottom)+16px)] max-[900px]:bottom-[calc(env(safe-area-inset-bottom)+66px)]",
        className,
      )}
    >
      <section
        aria-label="Picked"
        className="ui-rise pointer-events-auto grid max-w-[min(100%,640px)] gap-1.5 rounded-[6px_14px_6px_14px] border border-(--ui-hair) bg-(--ui-paper) px-3 py-2 text-[13px] text-(--ui-ink) shadow-(--ui-shadow)"
      >
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <span aria-live="polite" className="font-semibold tabular-nums whitespace-nowrap">
            {n ? `${num(n)} picked` : "None picked"}
          </span>
          <span className="flex flex-wrap items-center gap-2">{actions}</span>
          <button
            type="button"
            onClick={onEnd}
            className="ml-auto h-8 cursor-pointer border-0 bg-transparent px-1 text-(--ui-ink-2) underline decoration-(--ui-hair) underline-offset-2 hover:text-(--ui-ink) pointer-coarse:h-11"
          >
            Done
          </button>
        </div>
        {note ? (
          <p
            role={bad ? "alert" : "status"}
            className={cn("m-0 wrap-anywhere", bad ? "text-(--ui-bad)" : "text-(--ui-ink-2)")}
          >
            {note}
          </p>
        ) : null}
      </section>
    </div>
  );
}

/** What a screen says while it waits, when it has nothing, and when something broke. */
import type { ReactNode } from "react";
import { Skeleton } from "./components/ui/skeleton.js";
import { Button, Tag } from "./controls.js";
import { cx } from "./format.js";
import { Icon } from "./icons.js";

/**
 * Ghosts in the shape of the content, never a spinner: lines of text, table
 * rows, or cards. `heading` puts a title-sized ghost first, for a page that
 * can't name itself yet.
 */
export function Loading({
  lines = 5,
  shape = "lines",
  heading = false,
  label = "Loading",
  className,
}: {
  lines?: number;
  shape?: "lines" | "rows" | "cards";
  heading?: boolean;
  label?: string;
  className?: string | undefined;
}) {
  const ghosts = Array.from({ length: lines }, (_, i) => i);
  return (
    <div
      className={cx("flex flex-col py-2.5", shape === "rows" ? "gap-0" : "gap-4", className)}
      role="status"
    >
      <span className="sr-only">{label}</span>
      {heading ? (
        <span className="mb-4 flex flex-col gap-3.5">
          <Skeleton className="h-7 w-[min(40%,260px)]" />
          <Skeleton className={cx(GHOST, "w-[min(70%,520px)]")} />
        </span>
      ) : null}
      {/* The ghosts are identical and never reorder, so their index is their key. */}
      {ghosts.map((i) =>
        shape === "lines" ? (
          <Skeleton key={i} className={cx(GHOST, WIDTHS[i % WIDTHS.length])} />
        ) : (
          <span
            key={i}
            className={
              shape === "rows"
                ? "flex gap-7 border-b border-(--ui-hair) py-4"
                : "flex flex-col gap-3.5 rounded-(--ui-radius) border border-(--ui-hair) p-[22px]"
            }
          >
            <Skeleton className={cx(GHOST, shape === "rows" ? "w-[22%]" : "h-3.5 w-[34%]")} />
            <Skeleton className={cx(GHOST, shape === "rows" ? "w-[48%]" : "w-[92%]")} />
            {shape === "cards" ? (
              <>
                <Skeleton className={cx(GHOST, "w-[74%]")} />
                <Skeleton className={cx(GHOST, "w-[58%]")} />
              </>
            ) : null}
          </span>
        ),
      )}
    </div>
  );
}

const GHOST = "h-3 bg-(--ui-fill)";
const WIDTHS = ["w-[92%]", "w-[92%]", "w-[74%]", "w-[58%]"];

/** Nothing here yet: say why, and what fills it. */
export function Empty({
  action,
  className,
  children,
}: {
  action?: ReactNode;
  className?: string | undefined;
  children: ReactNode;
}) {
  return (
    <div
      className={cx(
        // A dashed frame: a place that fills, apart from the solid frames of parts that have.
        "flex flex-col items-center gap-4 rounded-(--ui-radius) border border-dashed border-(--ui-edge) bg-(--ui-wash) px-6 py-12 text-center text-[14px] text-(--ui-ink-2)",
        className,
      )}
    >
      <p className="max-w-[46ch] text-pretty">{children}</p>
      {action ?? null}
    </div>
  );
}

/** A part that isn't built yet: a dashed frame like Empty, its tag first, then what works meanwhile. */
export function InDevelopment({
  className,
  children,
}: {
  className?: string | undefined;
  children?: ReactNode;
}) {
  return (
    <div
      className={cx(
        "flex max-w-[72ch] flex-wrap items-baseline gap-x-3 gap-y-1.5 rounded-(--ui-radius) border border-dashed border-(--ui-edge) bg-(--ui-wash) px-4 py-3 text-[14px] text-pretty text-(--ui-ink-2)",
        className,
      )}
    >
      <Tag tone="accent">In development</Tag>
      {children ? <span className="min-w-0 flex-1 basis-[40ch]">{children}</span> : null}
    </div>
  );
}

/** A standing note on how this screen works ("Nothing sends until you approve it"). */
export function Callout({
  tone,
  className,
  children,
}: {
  /** `warn`: something is held and waits on someone, in the nav counts' amber. */
  tone?: "warn" | undefined;
  className?: string | undefined;
  children: ReactNode;
}) {
  return (
    <p
      className={cx(
        "mb-5 w-fit max-w-[72ch] rounded-(--ui-radius) border border-l-[3px] px-4 py-[11px] text-[14px] text-pretty",
        tone === "warn"
          ? "border-(--ui-hair) border-l-(--ui-warn) bg-(--ui-warn-tint) text-(--ui-ink)"
          : "border-(--ui-hair) border-l-(--ui-ink-3) bg-(--ui-band) text-(--ui-ink-2)",
        className,
      )}
    >
      {children}
    </p>
  );
}

/** Something failed. The message names the problem and what to do; `onRetry` adds the button that does it. */
export function Alert({
  onRetry,
  className,
  children,
}: {
  onRetry?: (() => void) | undefined;
  className?: string | undefined;
  children: ReactNode;
}) {
  return (
    <div
      className={cx(
        "mb-4 flex items-start gap-2.5 rounded-(--ui-radius) border border-l-[3px] border-(--ui-hair) border-l-(--ui-bad) bg-(--ui-bad-tint) px-3.5 py-3 text-[14px]",
        className,
      )}
      role="alert"
    >
      <Icon name="close" size={14} className="mt-[3px] stroke-2 text-(--ui-bad)" />
      <div>{children}</div>
      {onRetry ? (
        <Button tone="quiet" size="sm" className="-my-1 ml-auto flex-none" onClick={onRetry}>
          Try again
        </Button>
      ) : null}
    </div>
  );
}

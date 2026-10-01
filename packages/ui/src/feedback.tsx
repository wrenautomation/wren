/** What a screen says while it waits, when it has nothing, and when something broke. */
import type { ReactNode } from "react";
import { Button } from "./controls.js";
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
    <div className={cx("ui-loading", `ui-loading-${shape}`, className)} role="status">
      <span className="ui-sr">{label}</span>
      {heading ? (
        <span className="ui-ghost-head">
          <span className="ui-ghost" />
          <span className="ui-ghost" />
        </span>
      ) : null}
      {/* The ghosts are identical and never reorder, so their index is their key. */}
      {ghosts.map((i) =>
        shape === "lines" ? (
          <span key={i} className="ui-ghost" />
        ) : (
          <span key={i} className="ui-ghost-block">
            <span className="ui-ghost" />
            <span className="ui-ghost" />
            {shape === "cards" ? (
              <>
                <span className="ui-ghost" />
                <span className="ui-ghost" />
              </>
            ) : null}
          </span>
        ),
      )}
    </div>
  );
}

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
    <div className={cx("ui-empty", className)}>
      <p>{children}</p>
      {action ?? null}
    </div>
  );
}

/** A standing note on how this screen works ("Nothing sends until you approve it"). */
export function Callout({
  className,
  children,
}: {
  className?: string | undefined;
  children: ReactNode;
}) {
  return <p className={cx("ui-callout", className)}>{children}</p>;
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
    <div className={cx("ui-alert", className)} role="alert">
      <Icon name="close" size={14} />
      <div>{children}</div>
      {onRetry ? (
        <Button tone="quiet" size="sm" className="ui-alert-retry" onClick={onRetry}>
          Try again
        </Button>
      ) : null}
    </div>
  );
}

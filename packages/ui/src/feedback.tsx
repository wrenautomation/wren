/** What a screen says while it waits, when it has nothing, and when something broke. */
import type { ReactNode } from "react";
import { cx } from "./format.js";
import { Icon } from "./icons.js";

/** Ghost lines in the shape of the content, never a spinner. */
export function Loading({
  lines = 5,
  label = "Loading",
  className,
}: {
  lines?: number;
  label?: string;
  className?: string | undefined;
}) {
  return (
    <div className={cx("ui-loading", className)} role="status">
      <span className="ui-sr">{label}</span>
      {Array.from({ length: lines }, (_, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: the lines are identical and never reorder.
        <span key={i} className="ui-ghost" />
      ))}
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

/** Something failed. The message names the problem and what to do. */
export function Alert({
  className,
  children,
}: {
  className?: string | undefined;
  children: ReactNode;
}) {
  return (
    <div className={cx("ui-alert", className)} role="alert">
      <Icon name="close" size={14} />
      <div>{children}</div>
    </div>
  );
}

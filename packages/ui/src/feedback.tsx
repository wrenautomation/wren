/** What a screen says while it waits, when it has nothing, and when something broke. */
import type { ReactNode } from "react";
import { Icon } from "./icons.js";

/** Ghost lines in the shape of the content, never a spinner. */
export function Loading({ lines = 5, label = "Loading" }: { lines?: number; label?: string }) {
  return (
    <div className="ui-loading" role="status">
      <span className="ui-sr">{label}</span>
      {Array.from({ length: lines }, (_, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: the lines are identical and never reorder.
        <span key={i} className="ui-ghost" />
      ))}
    </div>
  );
}

/** Nothing here yet: say why, and what fills it. */
export function Empty({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="ui-empty">
      <p>{children}</p>
      {action ?? null}
    </div>
  );
}

/** A standing note on how this screen works ("Nothing sends until you approve it"). */
export function Callout({ children }: { children: ReactNode }) {
  return <p className="ui-callout">{children}</p>;
}

/** Something failed. The message names the problem and what to do. */
export function Alert({ children }: { children: ReactNode }) {
  return (
    <div className="ui-alert" role="alert">
      <Icon name="close" size={14} />
      <div>{children}</div>
    </div>
  );
}

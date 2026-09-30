/**
 * A workflow as one line of steps, grouped into phases: where the work is, what's done and
 * what's next. Across on a wide screen, down on a narrow one (by the rail's own width).
 */
import type { ReactNode } from "react";
import { cx } from "./format.js";
import { Icon, type IconName } from "./icons.js";

/** `yours` waits on the viewer; `next` runs on the next pass; `waiting` is parked for a while. */
export type RailState = "done" | "next" | "waiting" | "yours" | "idle";

export interface RailStep {
  id: string;
  label: string;
  count?: ReactNode;
  /** One short line under the label ("8 resume at 8 PM"). */
  note?: ReactNode;
  state: RailState;
  /** Opens what's behind the step. */
  href?: string | undefined;
}

/** A phase: a run of steps under one label ("Research"). */
export interface RailGroup {
  id: string;
  label: string;
  steps: RailStep[];
}

/** What a screen reader hears for each state. A product can say it its own way. */
export const RAIL_STATES: Record<RailState, string> = {
  done: "done",
  next: "runs next",
  waiting: "waiting",
  yours: "your turn",
  idle: "not started",
};

const MARKS: Partial<Record<RailState, IconName>> = {
  done: "check",
  waiting: "clock",
  yours: "arrow",
};

export function Rail({
  groups,
  label = "Steps",
  states = RAIL_STATES,
  className,
}: {
  groups: RailGroup[];
  label?: string;
  states?: Record<RailState, string>;
  className?: string | undefined;
}) {
  return (
    <div className={cx("ui-rail", className)}>
      <ol className="ui-rail-groups" aria-label={label}>
        {groups.map((g) => (
          <li
            key={g.id}
            className="ui-rail-group"
            style={{ flexGrow: Math.max(g.steps.length, 1) }}
          >
            <p className="ui-rail-label" id={`ui-rail-${g.id}`}>
              {g.label}
            </p>
            <ol className="ui-rail-steps" aria-labelledby={`ui-rail-${g.id}`}>
              {g.steps.map((s) => {
                const mark = MARKS[s.state];
                const name = (
                  <>
                    {s.label}
                    <span className="ui-sr">, {states[s.state]}</span>
                  </>
                );
                return (
                  <li
                    key={s.id}
                    className={cx("ui-rail-step", s.href && "ui-rail-link")}
                    data-state={s.state}
                  >
                    <span className="ui-rail-mark" aria-hidden="true">
                      {mark ? <Icon name={mark} size={12} /> : null}
                    </span>
                    {s.count !== undefined ? (
                      <span className="ui-rail-count">{s.count}</span>
                    ) : null}
                    <span className="ui-rail-name">
                      {s.href ? <a href={s.href}>{name}</a> : name}
                    </span>
                    {s.note ? <span className="ui-rail-note">{s.note}</span> : null}
                  </li>
                );
              })}
            </ol>
          </li>
        ))}
      </ol>
    </div>
  );
}

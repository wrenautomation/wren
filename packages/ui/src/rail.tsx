/**
 * A workflow as one line of steps, grouped into phases: where the work is, what's done and
 * what's next. Across on a wide screen, down on a narrow one (by the rail's own width).
 */
import { cn } from "cn";
import type { ReactNode } from "react";
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

/** The mark's fill and ring per state; `next` gets a dot in the middle. */
const MARK_TONE: Record<RailState, string> = {
  done: "bg-(--ui-good) text-(--ui-paper)",
  yours: "bg-(--ui-accent) text-(--ui-on-accent)",
  next: "bg-(--ui-paper) text-(--ui-ink-2) shadow-[inset_0_0_0_2px_var(--ui-accent)] after:size-2 after:rounded-full after:bg-(--ui-accent) after:content-['']",
  waiting: "bg-(--ui-paper) text-(--ui-ink-2) shadow-[inset_0_0_0_1.5px_var(--ui-ink-2)]",
  idle: "bg-(--ui-paper) text-(--ui-ink-2) shadow-[inset_0_0_0_1.5px_var(--ui-hair)]",
};

/** Under 820px of rail, the steps run down the page. */
const STEP =
  "relative flex min-w-0 flex-1 flex-col gap-0.5 pr-3 has-[a:focus-visible]:outline-2 has-[a:focus-visible]:outline-offset-4 has-[a:focus-visible]:outline-(--ui-accent) " +
  // The line from this step's mark to the next; inked once the step is done.
  "before:absolute before:inset-x-0 before:top-2.5 before:h-0.5 before:rounded-(--ui-radius) before:bg-(--ui-fill) before:content-[''] data-[state=done]:before:bg-(--ui-ink) " +
  "@max-[820px]/rail:grid @max-[820px]/rail:grid-cols-[22px_minmax(0,1fr)_auto] @max-[820px]/rail:items-start @max-[820px]/rail:gap-x-3.5 @max-[820px]/rail:px-0 @max-[820px]/rail:py-2.5 @max-[820px]/rail:[grid-template-areas:'mark_name_count'_'mark_note_count'] " +
  "@max-[820px]/rail:before:inset-y-0 @max-[820px]/rail:before:left-2.5 @max-[820px]/rail:before:h-auto @max-[820px]/rail:before:w-0.5 @max-[820px]/rail:first:before:top-4 @max-[820px]/rail:last:before:bottom-[calc(100%-16px)]";

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
    <div className={cn("@container/rail mb-12", className)}>
      <ol
        className="flex list-none gap-6 @max-[820px]/rail:flex-col @max-[820px]/rail:gap-5"
        aria-label={label}
      >
        {groups.map((g) => (
          <li
            key={g.id}
            className="min-w-0 flex-1"
            style={{ flexGrow: Math.max(g.steps.length, 1) }}
          >
            <p
              className="mb-3 text-[12px] font-semibold tracking-(--ui-label-tracking) text-(--ui-ink-2) [text-transform:var(--ui-label-case)] @max-[820px]/rail:mb-1"
              id={`ui-rail-${g.id}`}
            >
              {g.label}
            </p>
            <ol
              className="flex list-none @max-[820px]/rail:flex-col"
              aria-labelledby={`ui-rail-${g.id}`}
            >
              {g.steps.map((s) => {
                const mark = MARKS[s.state];
                const name = (
                  <>
                    {s.label}
                    <span className="sr-only">, {states[s.state]}</span>
                  </>
                );
                return (
                  <li key={s.id} className={cn(STEP, s.href && "group/step")} data-state={s.state}>
                    <span
                      className={cn(
                        "relative mb-3 grid size-[22px] place-items-center rounded-full @max-[820px]/rail:m-0 @max-[820px]/rail:[grid-area:mark]",
                        MARK_TONE[s.state],
                      )}
                      aria-hidden="true"
                    >
                      {mark ? <Icon name={mark} size={12} className="stroke-2" /> : null}
                    </span>
                    {s.count !== undefined ? (
                      <span
                        className={cn(
                          "font-(family-name:--ui-font-display) text-[26px] leading-[1.1] font-(--ui-display-weight) tracking-[calc(-0.03em*var(--ui-display-squeeze))] lining-nums tabular-nums transition-colors duration-250 ease-(--ui-ease) group-hover/step:text-(--ui-accent) @max-[820px]/rail:text-right @max-[820px]/rail:text-[22px] @max-[820px]/rail:[grid-area:count]",
                          s.state === "idle" && "text-(--ui-ink-2)",
                        )}
                      >
                        {s.count}
                      </span>
                    ) : null}
                    <span className="text-[14px] leading-[1.3] font-medium group-hover/step:text-(--ui-accent) @max-[820px]/rail:pt-px @max-[820px]/rail:[grid-area:name]">
                      {s.href ? (
                        <a
                          href={s.href}
                          className="no-underline after:absolute after:-inset-y-1.5 after:right-1 after:-left-1.5 after:content-[''] focus-visible:outline-none @max-[820px]/rail:after:inset-0"
                        >
                          {name}
                        </a>
                      ) : (
                        name
                      )}
                    </span>
                    {s.note ? (
                      <span
                        className={cn(
                          "text-[13px] leading-[1.35] text-pretty @max-[820px]/rail:[grid-area:note]",
                          s.state === "yours"
                            ? "font-medium text-(--ui-accent)"
                            : "text-(--ui-ink-2)",
                        )}
                      >
                        {s.note}
                      </span>
                    ) : null}
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

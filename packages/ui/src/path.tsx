/**
 * The Path: the wait that says what it does, and with what. Each step names its work, its detail
 * cross-fades as it changes, and its sources animate in. When every step is done it folds to one
 * line that stays; a click opens the path again. Plain data in, no fetching: the caller owns the
 * work and passes its state. Used for research, send, map, import and a video render.
 * Source: designs/2026-10-20-design-language/design-language.src.html, section 14 (`.path`).
 */
import { useEffect, useState } from "react";
import { cx } from "./format.js";
import { GROUP_LABEL } from "./layout.js";

export type PathState = "wait" | "run" | "done";

export interface PathStep {
  /** What the step does: "Searching", "Reading". */
  title: string;
  state: PathState;
  /** What it does it with, right now: "5 of 12 · reddit.com". Changes as the step runs. */
  detail?: string | undefined;
  /** The sources it has met so far. Each one animates in when it first shows. */
  sources?: string[] | undefined;
}

/** How long a finished path rests before it folds, ms. */
const FOLD_AFTER = 500;
/** The cross-fade of a detail line, ms. Keep equal to `duration-180` below. */
const FADE = 180;

/** A line of text that fades out, swaps and fades in when it changes. */
function Fading({ text }: { text: string }) {
  const [shown, setShown] = useState(text);
  const [out, setOut] = useState(false);
  useEffect(() => {
    if (text === shown) return;
    setOut(true);
    const t = setTimeout(() => {
      setShown(text);
      setOut(false);
    }, FADE);
    return () => clearTimeout(t);
  }, [text, shown]);
  return (
    <span
      data-out={out ? "" : undefined}
      className="block min-h-[1.3em] text-[12.5px] text-(--ui-ink-2) transition-[opacity,translate] duration-180 data-[out]:translate-y-[3px] data-[out]:opacity-0 motion-reduce:transition-none"
    >
      {shown}
    </span>
  );
}

const MARK = "mt-0.5 grid size-4 flex-none place-items-center rounded-full border-2 border-solid";
const STATE_MARK: Record<PathState, string> = {
  wait: "border-(--ui-hair)",
  run: "border-(--ui-active) bg-(--ui-active) animate-ui-run-pulse motion-reduce:animate-none",
  done: "border-(--ui-active) bg-(--ui-active) after:h-2 after:w-[5px] after:-translate-y-px after:rotate-45 after:border-solid after:border-(--ui-on-accent) after:border-r-2 after:border-b-2 after:content-['']",
};

function Step({ step }: { step: PathStep }) {
  const { title, state, detail, sources } = step;
  return (
    <li
      data-state={state}
      aria-current={state === "run" ? "step" : undefined}
      className={cx(
        "grid grid-cols-[16px_minmax(0,1fr)] items-start gap-x-2.5 text-[14px]",
        state === "wait" && "text-(--ui-ink-3)",
      )}
    >
      <i aria-hidden="true" className={cx(MARK, STATE_MARK[state])} />
      <div className="grid gap-0.5">
        <span className={state === "run" ? "font-semibold" : undefined}>{title}</span>
        {state === "wait" ? null : <Fading text={detail ?? ""} />}
        {sources?.length && state !== "wait" ? (
          <ul className="mt-1 flex list-none flex-wrap gap-1 p-0">
            {sources.map((s) => (
              <li
                key={s}
                className="ui-rise inline-flex items-center gap-1 [border-radius:var(--ui-leaf-chip)] bg-(--ui-fill) px-[7px] py-0.5 text-[11px] font-semibold text-(--ui-ink-2) before:size-1.5 before:rounded-full before:bg-(--ui-active) before:opacity-70 before:content-['']"
              >
                {s}
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </li>
  );
}

/**
 * The path of one piece of work. `summary` is the one line it folds to ("Read 12 sources · 3.9 s");
 * without it the path never folds. `title` names the work ("Research a person").
 */
export function Path({
  title,
  steps,
  summary,
}: {
  title: string;
  steps: PathStep[];
  summary?: string | undefined;
}) {
  const complete = !!summary && steps.length > 0 && steps.every((s) => s.state === "done");
  // A path that is already whole when it shows (a return to the page) starts folded.
  const [folded, setFolded] = useState(complete);
  useEffect(() => {
    if (!complete) {
      setFolded(false);
      return;
    }
    const t = setTimeout(() => setFolded(true), FOLD_AFTER);
    return () => clearTimeout(t);
  }, [complete]);
  return (
    <section aria-label={title} className="grid content-start gap-2">
      <h3 className={cx("m-0", GROUP_LABEL)}>{title}</h3>
      {folded ? (
        <button
          type="button"
          aria-expanded="false"
          onClick={() => setFolded(false)}
          className="ui-rise flex cursor-pointer items-center gap-2 border-0 bg-transparent p-0 text-left font-[inherit] text-[13.5px] text-(--ui-ink-2) hover:text-(--ui-ink)"
        >
          <i
            aria-hidden="true"
            className="grid size-4 flex-none place-items-center rounded-full bg-(--ui-active) after:h-2 after:w-[5px] after:-translate-y-px after:rotate-45 after:border-solid after:border-(--ui-on-accent) after:border-r-2 after:border-b-2 after:content-['']"
          />
          {summary}
        </button>
      ) : (
        <ol aria-live="polite" className="m-0 grid list-none gap-2 p-0">
          {steps.map((s) => (
            <Step key={s.title} step={s} />
          ))}
        </ol>
      )}
    </section>
  );
}

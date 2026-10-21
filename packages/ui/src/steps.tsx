/**
 * Steps: the wait of a job with stages (research, send, import, a video render, the map). Each
 * step names what it does and with what. Its status line cross-fades, at most once per `HOLD`, so
 * a fast caller never makes it flicker. The sources and targets it touches fold in as small cards,
 * then stack into a deck with a count when the step is done. Past ten seconds a clock shows, with
 * "you can leave". Done, it folds to one line that stays as the record; a click opens it again.
 * Plain data in, no fetching: the caller owns the work and passes its state.
 * Source: designs/2026-10-20-design-language/design-language.src.html, section 14, "Long job".
 */
import { useEffect, useRef, useState } from "react";
import { Busy } from "./busy.js";
import { cx } from "./format.js";
import { GROUP_LABEL } from "./layout.js";
import { PlatformTile } from "./marks.js";

export type StepState = "wait" | "run" | "done";

/** A source or target a step touches: "reddit.com", "YouTube". */
export interface StepCard {
  /** Unique in its step. */
  key: string;
  label: string;
  /** Its platform, as a key or a host ("reddit", "youtube.com"): its logo on its brand color.
   * Any other site gets a globe. */
  mark: string;
}

export interface JobStep {
  /** What the step does: "Searching", "Upload". */
  title: string;
  state: StepState;
  /** What it does it with, right now: "reddit.com · 3 threads". */
  detail?: string | undefined;
  /** What it touched so far. Each card folds in when it first shows. */
  cards?: StepCard[] | undefined;
  /** The deck's count once the step is done: "12 sources". Without it the cards stay open. */
  count?: string | undefined;
}

/** The least time a status line shows before the next one replaces it, ms. */
export const HOLD = 600;
/** The cross-fade of a status line, ms. Keep equal to the `ui-status-*` animations. */
const FADE = 220;
/** How long a finished job rests before it folds, ms. */
const FOLD_AFTER = 700;
/** After this long the clock and "you can leave" show, ms. */
const LONG = 10_000;

/**
 * The status line. A new text waits until the shown one has had `HOLD`; then the old line fades
 * up and out while the new one fades in. Only the latest waiting text shows.
 */
function Status({ text }: { text: string }) {
  const [shown, setShown] = useState({ text, n: 0 });
  const [gone, setGone] = useState<{ text: string; n: number } | null>(null);
  const since = useRef(0);
  useEffect(() => {
    if (text === shown.text) return;
    const wait = Math.max(0, since.current + HOLD - Date.now());
    const t = setTimeout(() => {
      since.current = Date.now();
      setGone(shown);
      setShown({ text, n: shown.n + 1 });
    }, wait);
    return () => clearTimeout(t);
  }, [text, shown]);
  useEffect(() => {
    if (!gone) return;
    const t = setTimeout(() => setGone(null), FADE);
    return () => clearTimeout(t);
  }, [gone]);
  return (
    <span className="ui-status relative block min-h-[1.3em] text-[12.5px] text-(--ui-ink-2)">
      {gone ? (
        <span key={gone.n} data-out="" className="absolute inset-0">
          {gone.text}
        </span>
      ) : null}
      <span key={shown.n} data-in={shown.n > 0 ? "" : undefined} className="block">
        {shown.text}
      </span>
    </span>
  );
}

function Card({ card }: { card: StepCard }) {
  return (
    <span className="ui-card inline-flex items-center gap-[5px] [border-radius:var(--ui-leaf-chip)] bg-(--ui-paper) py-0.5 pr-[7px] pl-[3px] text-[11.5px] font-semibold whitespace-nowrap text-(--ui-ink-2) shadow-(--ui-raise)">
      <PlatformTile mark={card.mark} />
      <em className="not-italic">{card.label}</em>
    </span>
  );
}

const MARK = "mt-0.5 grid size-4 flex-none place-items-center rounded-full border-2 border-solid";
const TICK =
  "after:h-2 after:w-[5px] after:-translate-y-px after:rotate-45 after:border-solid after:border-(--ui-on-accent) after:border-r-2 after:border-b-2 after:content-['']";
const STATE_MARK: Record<Exclude<StepState, "run">, string> = {
  wait: "border-(--ui-hair)",
  done: `border-(--ui-active) bg-(--ui-active) ${TICK}`,
};

/** A step's own mark: an empty dot, the busy ring while it runs, a tick once done. */
function StepMark({ state }: { state: StepState }) {
  if (state === "run")
    return (
      <span aria-hidden="true" className="mt-0.5 grid size-4 place-items-center">
        <Busy on size="step" />
      </span>
    );
  return <i aria-hidden="true" className={cx(MARK, STATE_MARK[state])} />;
}

function Step({ step }: { step: JobStep }) {
  const { title, state, detail, cards, count } = step;
  const stacked = state === "done" && !!count;
  return (
    <li
      data-state={state}
      aria-current={state === "run" ? "step" : undefined}
      className={cx(
        "grid grid-cols-[16px_minmax(0,1fr)] items-start gap-x-2.5 text-[14px]",
        state === "wait" && "text-(--ui-ink-3)",
      )}
    >
      <StepMark state={state} />
      <div className="grid gap-[3px]">
        <span className={state === "run" ? "font-semibold" : undefined}>{title}</span>
        {state === "wait" ? null : <Status text={detail ?? ""} />}
        {cards?.length && state !== "wait" ? (
          <div className="ui-cards" data-stack={stacked ? "" : undefined}>
            {cards.map((c) => (
              <Card key={c.key} card={c} />
            ))}
            {count ? <span className="ui-cards-count">{count}</span> : null}
          </div>
        ) : null}
      </div>
    </li>
  );
}

/** "Still working · 14 s. You can leave. It carries on." Shows past `LONG`; ticks once a second. */
function Clock({ since }: { since: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const ms = now - since;
  if (ms < LONG) return null;
  return (
    <p className="ui-rise m-0 text-[13px] text-(--ui-ink-2)">
      Still working · <span className="tabular-nums">{Math.floor(ms / 1000)} s</span>. You can
      leave. It carries on.
    </p>
  );
}

/**
 * One job's steps. `summary` is the one line it folds to ("Read 12 sources · 7.2 s"); without it
 * the steps never fold. `title` names the job ("Research a person"). `startedAt` (epoch ms) is when
 * the job began, for the clock; it defaults to when the steps first show.
 */
export function Steps({
  title,
  steps,
  summary,
  startedAt,
}: {
  title: string;
  steps: JobStep[];
  summary?: string | undefined;
  startedAt?: number | undefined;
}) {
  const allDone = steps.length > 0 && steps.every((s) => s.state === "done");
  const complete = !!summary && allDone;
  const [mounted] = useState(() => Date.now());
  // A job that is already whole when it shows (a return to the page) starts folded.
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
    <section aria-label={title} className="grid content-start gap-2.5">
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
            className={cx(
              "grid size-4 flex-none place-items-center rounded-full bg-(--ui-active)",
              TICK,
            )}
          />
          {summary}
        </button>
      ) : (
        <>
          <ol aria-live="polite" className="m-0 grid list-none gap-2 p-0">
            {steps.map((s) => (
              <Step key={s.title} step={s} />
            ))}
          </ol>
          {allDone ? null : <Clock since={startedAt ?? mounted} />}
        </>
      )}
    </section>
  );
}

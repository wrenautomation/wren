/**
 * A run, watched: the workflow as a row of steps, a feed of what each one does,
 * and what came of it at the end. It plays one line at a time in the order
 * given; a replay on its own clock, a live run as lines arrive. A backlog plays
 * at most twice as fast and nothing is skipped. With reduced motion it shows
 * where things stand, still. Space pauses.
 *
 * A foundation piece: steps, lines and sources are plain props, so any product
 * maps its own run onto them.
 */
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { cx, num } from "./format.js";
import { Icon } from "./icons.js";

export type RunLineKind = "started" | "did" | "found" | "waiting" | "failed" | "done";

export interface RunLine {
  id: string | number;
  /** The step it belongs to, by `RunStep.id`. */
  step: string;
  kind: RunLineKind;
  text: string;
  /** Who or what it is about: the name on the moving chip. */
  subject?: string | null;
  /** On a step's last line: how many it handled in all. */
  count?: number | null;
  source?: { label: string; href?: string | null } | null;
  /** The technical why, for operators; shown small under the line. */
  detail?: string | null;
}

export interface RunStep {
  id: string;
  label: string;
  /** Where this step reads from ("LinkedIn, job boards"). */
  source?: string;
  /** What a find is called here ("moved or left"); without it, finds aren't tallied apart. */
  found?: string;
}

export type RunStepState = "idle" | "active" | "done" | "waiting";

export interface RunStepView {
  state: RunStepState;
  /** People or companies it has handled so far. */
  handled: number;
  found: number;
  /** Parked for later: not handled yet. */
  waiting: number;
}

/** How long a line stays the newest before the next, at 1x. Finds hold longest after the stage lines. */
export const RUN_DWELL: Record<RunLineKind, number> = {
  started: 900,
  done: 900,
  found: 650,
  failed: 650,
  waiting: 320,
  did: 320,
};

/** The fastest a backlog plays: twice the normal pace. */
export const RUN_MAX_SPEEDUP = 2;

/** Lines behind before a live run speeds up. */
const BACKLOG = 3;

/** How long to hold `line` at this backlog: normal, or up to 2x faster when behind. */
export function dwellOf(line: RunLine | undefined, behind: number, live: boolean): number {
  const base = line ? RUN_DWELL[line.kind] : 0;
  return live && behind > BACKLOG ? base / RUN_MAX_SPEEDUP : base;
}

/** Each step as of the first `shown` lines. */
export function stepsAt(
  steps: readonly RunStep[],
  lines: readonly RunLine[],
  shown: number,
): Record<string, RunStepView> {
  const out: Record<string, RunStepView> = {};
  for (const s of steps) out[s.id] = { state: "idle", handled: 0, found: 0, waiting: 0 };
  for (const l of lines.slice(0, shown)) {
    const v = out[l.step];
    if (!v) continue;
    if (l.kind === "started") v.state = "active";
    else if (l.kind === "done") {
      v.state = "done";
      // A step with no line per subject says its total at the end.
      if (l.count) v.handled = Math.max(v.handled, l.count);
    } else if (!l.subject) {
      if (l.kind === "waiting") v.state = "waiting";
    } else if (l.kind === "waiting") v.waiting += 1;
    else {
      v.handled += 1;
      if (l.kind === "found") v.found += 1;
    }
  }
  return out;
}

const prefersStill = () =>
  typeof window !== "undefined" &&
  typeof window.matchMedia === "function" &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Keys that already mean something where focus is: Space there is theirs, not ours. */
const typing = (t: EventTarget | null) =>
  t instanceof HTMLElement &&
  (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT|BUTTON|A)$/.test(t.tagName));

export function RunView({
  steps,
  lines,
  live = false,
  label,
  results,
  pace = 1,
  className,
}: {
  steps: RunStep[];
  lines: RunLine[];
  /** Lines arrive as the run goes; otherwise it's a replay on its own clock. */
  live?: boolean;
  /** Stays on screen the whole time: what this is ("Replay of the Sep 30 run, sped up"). */
  label: ReactNode;
  /** Shown once every line has played. */
  results?: ReactNode;
  /** Multiplies every dwell: 0.5 plays twice as fast. */
  pace?: number;
  className?: string | undefined;
}) {
  const still = useMemo(prefersStill, []);
  const [shown, setShown] = useState(() => (still ? lines.length : 0));
  const [paused, setPaused] = useState(false);
  const total = lines.length;
  const over = shown >= total;

  // Reduced motion: wherever the lines are, show them.
  useEffect(() => {
    if (still) setShown(total);
  }, [still, total]);

  useEffect(() => {
    if (still || paused || shown >= total) return;
    const wait = shown === 0 ? 300 : dwellOf(lines[shown - 1], total - shown, live) * pace;
    const t = setTimeout(() => setShown((n) => Math.min(n + 1, total)), wait);
    return () => clearTimeout(t);
  }, [still, paused, shown, total, lines, live, pace]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== "Space" || e.repeat || typing(e.target)) return;
      e.preventDefault();
      setPaused((p) => !p);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const views = useMemo(() => stepsAt(steps, lines, shown), [steps, lines, shown]);
  const newest = shown > 0 ? lines[shown - 1] : undefined;
  const chip =
    newest?.subject && newest.kind !== "started" && newest.kind !== "done" ? newest : null;

  // The feed follows the newest line, inside its own box; the page doesn't jump.
  const feed = useRef<HTMLOListElement>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll each time a line shows.
  useEffect(() => {
    const el = feed.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [shown]);

  return (
    <div className={cx("ui-run", className)} data-live={live || undefined}>
      <div className="ui-run-bar">
        <p className="ui-run-label">
          <span
            className="ui-run-dot"
            data-on={live && !over ? true : undefined}
            aria-hidden="true"
          />
          {label}
        </p>
        <div className="ui-run-controls">
          <span className="ui-run-progress" aria-hidden="true">
            {num(shown)} / {num(total)}
          </span>
          {over && !live ? (
            <button type="button" className="ui-run-button" onClick={() => setShown(0)}>
              <Icon name="play" size={12} />
              Play again
            </button>
          ) : (
            <button
              type="button"
              className="ui-run-button"
              onClick={() => setPaused((p) => !p)}
              aria-pressed={paused}
              disabled={still}
            >
              <Icon name={paused ? "play" : "pause"} size={12} />
              {paused ? "Play" : "Pause"}
              <kbd className="ui-run-key">Space</kbd>
            </button>
          )}
        </div>
      </div>

      <ol className="ui-run-steps" aria-label="Steps">
        {steps.map((s, i) => {
          const v = views[s.id] ?? { state: "idle", handled: 0, found: 0, waiting: 0 };
          return (
            <li key={s.id} className="ui-run-step" data-state={v.state}>
              <span className="ui-run-index" aria-hidden="true">
                {v.state === "done" ? <Icon name="check" size={12} /> : i + 1}
              </span>
              <span className="ui-run-name">{s.label}</span>
              {s.source ? <span className="ui-run-source">{s.source}</span> : null}
              <span className="ui-run-tally">
                <span className="ui-run-count">{num(v.handled)}</span>
                {s.found && v.found ? (
                  <span className="ui-run-found">
                    {num(v.found)} {s.found}
                  </span>
                ) : null}
                {v.waiting ? <span className="ui-run-parked">{num(v.waiting)} waiting</span> : null}
              </span>
              {chip?.step === s.id ? (
                <span key={chip.id} className="ui-run-chip" data-kind={chip.kind}>
                  {chip.subject}
                </span>
              ) : null}
            </li>
          );
        })}
      </ol>

      <ol
        ref={feed}
        className="ui-run-feed"
        aria-label="What it did"
        aria-live={live ? "polite" : "off"}
      >
        {lines.slice(0, shown).map((l) => (
          <li key={l.id} className="ui-run-line" data-kind={l.kind}>
            <span className="ui-run-mark" aria-hidden="true" />
            <span className="ui-run-text">
              {l.text}
              {l.detail ? <span className="ui-run-detail">{l.detail}</span> : null}
            </span>
            {l.source ? (
              l.source.href ? (
                <a
                  className="ui-run-cite"
                  href={l.source.href}
                  target="_blank"
                  rel="noreferrer noopener"
                >
                  {l.source.label}
                </a>
              ) : (
                <span className="ui-run-cite">{l.source.label}</span>
              )
            ) : null}
          </li>
        ))}
        {!shown ? <li className="ui-run-line ui-run-wait">Starting…</li> : null}
      </ol>

      {over && results ? <div className="ui-run-results">{results}</div> : null}
    </div>
  );
}

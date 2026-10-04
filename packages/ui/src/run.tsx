/**
 * A run, watched: the workflow as a graph of steps, a spark along each line as
 * work moves through it, a feed of what each step does, and what came of it at
 * the end. It plays one line at a time in the order given; a replay on its own
 * clock, a live run as lines arrive. A backlog plays at most twice as fast and
 * nothing is skipped. With reduced motion it shows where things stand, still.
 * Space pauses. Pick a step or a line to follow it through the graph. A line
 * with work behind it opens that work under the feed, and the replay waits.
 *
 * A foundation piece: steps, lines and sources are plain props, so any product
 * maps its own run onto them.
 */
import { lazy, type ReactNode, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { flowOf, INPUT, OUTPUT } from "./flow.js";
import { cx, hostOf, num } from "./format.js";
import { Icon } from "./icons.js";
import { SiteMark } from "./work.js";

export type RunLineKind = "started" | "did" | "found" | "waiting" | "failed" | "done";

export interface RunLine {
  id: string | number;
  /** The step it belongs to, by `RunStep.id`. */
  step: string;
  kind: RunLineKind;
  text: string;
  /** Who or what it is about: the name on the moving chip, and what following a line follows. */
  subject?: string | null;
  /** On a step's last line: how many it handled in all. */
  count?: number | null;
  source?: { label: string; href?: string | null } | null;
  /** The technical why, for operators; shown small under the line. */
  detail?: string | null;
}

/** The sites the shown lines cite, by their address when they have one, most cited first. */
export function sourcesOf(lines: readonly RunLine[]): { label: string; count: number }[] {
  const by = new Map<string, number>();
  for (const l of lines) {
    if (!l.source) continue;
    const site = hostOf(l.source.href ?? null) ?? l.source.label;
    by.set(site, (by.get(site) ?? 0) + 1);
  }
  return [...by].map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count);
}

export interface RunStep {
  id: string;
  label: string;
  /** For a narrow node ("Emails"); without it, the label. */
  short?: string;
  /** Where this step reads from ("LinkedIn, job boards"). */
  source?: string;
  /** What a find is called here ("moved or left"); without it, finds aren't tallied apart. */
  found?: string;
  /** The steps it builds on, by id. Left out: the step before it. Empty: it reads the run's input. */
  after?: string[];
}

/** One end of the graph: what the run reads ("Your list"), or who it hands its work to. */
export interface RunEnd {
  label: string;
  note?: string;
}

export type RunStepState = "idle" | "active" | "done" | "waiting";

export interface RunStepView {
  state: RunStepState;
  /** People or companies it has handled so far. */
  handled: number;
  found: number;
  failed: number;
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

/** A line about one person or company, not a step starting or ending. */
const aboutOne = (l: RunLine) => !!l.subject && l.kind !== "started" && l.kind !== "done";

/** Each step as of the first `shown` lines. */
export function stepsAt(
  steps: readonly RunStep[],
  lines: readonly RunLine[],
  shown: number,
): Record<string, RunStepView> {
  const out: Record<string, RunStepView> = {};
  // Each subject counts once per step, as its latest line says: parked then
  // checked is checked, failed then retried is the retry.
  const latest: Record<string, Map<string, RunLineKind>> = {};
  const total: Record<string, number> = {};
  for (const s of steps) {
    out[s.id] = { state: "idle", handled: 0, found: 0, failed: 0, waiting: 0 };
    latest[s.id] = new Map();
  }
  for (const l of lines.slice(0, shown)) {
    const v = out[l.step];
    if (!v) continue;
    if (l.kind === "started") v.state = "active";
    else if (l.kind === "done") {
      v.state = "done";
      // A step with no line per subject says its total at the end.
      if (l.count && Number.isFinite(l.count))
        total[l.step] = Math.max(total[l.step] ?? 0, l.count);
    } else if (!l.subject) {
      if (l.kind === "waiting") v.state = "waiting";
    } else {
      latest[l.step]?.set(l.subject, l.kind);
      if (v.state === "idle") v.state = "active";
    }
  }
  for (const [id, v] of Object.entries(out)) {
    for (const kind of latest[id]?.values() ?? []) {
      if (kind === "waiting") v.waiting += 1;
      else v.handled += 1;
      if (kind === "found") v.found += 1;
      if (kind === "failed") v.failed += 1;
    }
    v.handled = Math.max(v.handled, total[id] ?? 0);
  }
  return out;
}

/** How many subjects each step has lines about in all: what its bar fills toward on a replay. */
export function expectedOf(lines: readonly RunLine[]): Record<string, number> {
  const seen = new Map<string, Set<string>>();
  for (const l of lines) {
    if (!aboutOne(l) || !l.subject) continue;
    const at = seen.get(l.step) ?? new Set<string>();
    seen.set(l.step, at.add(l.subject));
  }
  return Object.fromEntries([...seen].map(([id, s]) => [id, s.size]));
}

export interface RunMix {
  found: number;
  did: number;
  failed: number;
  waiting: number;
}

/** A step's bar: each outcome's share of what it has, or will have, handled. */
export function mixOf(v: RunStepView, expected: number): RunMix {
  const did = Math.max(v.handled - v.found - v.failed, 0);
  const all = Math.max(expected, v.handled + v.waiting, 1);
  return { found: v.found / all, did: did / all, failed: v.failed / all, waiting: v.waiting / all };
}

/** What the viewer is following: one step, or one person or company through every step. */
export type RunFocus = { step: string } | { subject: string } | null;

const prefersStill = () =>
  typeof window !== "undefined" &&
  typeof window.matchMedia === "function" &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Keys that already mean something where focus is: Space there is theirs, not ours. */
const typing = (t: EventTarget | null) =>
  t instanceof HTMLElement &&
  (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT|BUTTON|A)$/.test(t.tagName));

/** React Flow draws the graph; it loads with the first run shown. */
const RunGraph = lazy(() => import("./run-graph.js"));

const BUTTON =
  "inline-flex cursor-pointer items-center gap-2 rounded-(--ui-radius-button) border-0 bg-(--ui-paper) px-3 py-[7px] font-[inherit] text-[12px] leading-[inherit] font-(--ui-button-weight) tracking-(--ui-button-tracking) text-(--ui-ink) [text-transform:var(--ui-button-case)] shadow-(--ui-shadow-node) hover:text-(--ui-accent) disabled:cursor-default disabled:opacity-50";
/** A button that reads as text: Show all, and a line's name to follow. */
const LINK =
  "cursor-pointer border-0 bg-transparent p-0 text-left font-[inherit] text-[length:inherit] leading-[inherit] decoration-(--ui-accent) underline-offset-3 hover:underline focus-visible:rounded-[2px]";
/** Fades up into place: a feed line, the opened work, the results. */
const RISE =
  "animate-in fade-in slide-in-from-bottom-[6px] ease-(--ui-ease) motion-reduce:animate-none";
/** Narrow, the source and How share one row under the text. */
const LINE = cx(
  RISE,
  "grid grid-cols-[14px_minmax(0,1fr)_auto_auto] items-baseline gap-2.5 py-[3px] leading-[1.4] duration-300 @max-[420px]/run:grid-cols-[14px_auto_minmax(0,1fr)] @max-[420px]/run:gap-y-1",
);
const STAGE =
  "text-[12px] font-semibold tracking-(--ui-label-tracking) [text-transform:var(--ui-label-case)]";
const KIND: Record<RunLineKind, string> = {
  started: `mt-2 ${STAGE}`,
  done: `mt-0.5 text-(--ui-good-ink) ${STAGE}`,
  did: "text-[14px] text-(--ui-ink-2)",
  waiting: "text-[14px] text-(--ui-ink-2)",
  found: "text-[14px] font-medium",
  failed: "text-[14px]",
};
const DOT = "size-1.5 rounded-full";
const DASH = "h-0.5 w-2.5 rounded-(--ui-radius-bar)";
const MARK: Record<RunLineKind, string> = {
  started: `${DASH} bg-(--ui-ink)`,
  done: `${DASH} bg-(--ui-good)`,
  found: `${DOT} bg-(--ui-accent)`,
  failed: `${DOT} bg-(--ui-bad)`,
  waiting: `${DOT} shadow-[inset_0_0_0_1.5px_var(--ui-ink-2)]`,
  did: `${DOT} bg-(--ui-ink-3)`,
};
const CITE =
  "rounded-(--ui-radius-tag) bg-(--ui-fill) px-2 py-px text-[11px] font-medium whitespace-nowrap text-(--ui-ink-2) no-underline @max-[420px]/run:col-2 @max-[420px]/run:justify-self-start";

export function RunView({
  steps,
  lines,
  live = false,
  label,
  results,
  input,
  output,
  pace = 1,
  work,
  className,
}: {
  /** Every step the run can take. A replay leaves out the ones it has no lines for. */
  steps: RunStep[];
  lines: RunLine[];
  /** Lines arrive as the run goes; otherwise it's a replay on its own clock. */
  live?: boolean;
  /** Stays on screen the whole time: what this is ("Replay of the Sep 30 run, sped up"). */
  label: ReactNode;
  /** Shown once every line has played. */
  results?: ReactNode;
  /** The node the first steps read from. */
  input?: RunEnd;
  /** The node the last steps hand off to; it lights when the run is over. */
  output?: RunEnd;
  /** Multiplies every dwell: 0.5 plays twice as fast. */
  pace?: number;
  /** The work behind a line, opened under the feed; null when a line has none. */
  work?: ((line: RunLine) => ReactNode) | undefined;
  className?: string | undefined;
}) {
  const still = useMemo(prefersStill, []);
  const [shown, setShown] = useState(() => (still ? lines.length : 0));
  const [paused, setPaused] = useState(false);
  const [focus, setFocus] = useState<RunFocus>(null);
  const [opened, setOpened] = useState<RunLine | null>(null);
  const total = lines.length;
  // Caught up isn't over: a live run is over when it says so.
  const over = shown >= total && !live;

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
      if (e.code === "Escape") {
        setOpened(null);
        return setFocus(null);
      }
      if (e.code !== "Space" || e.repeat || typing(e.target)) return;
      e.preventDefault();
      setPaused((p) => !p);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // From the top, unpaused. Reduced motion has nothing to replay, so no button.
  const replay = () => {
    setPaused(false);
    setShown(0);
  };

  // A live run may still reach any step; a replay shows only the steps it has lines for.
  const stepKey = JSON.stringify(steps.map((s) => [s.id, s.after ?? null]));
  const touched = useMemo(
    () => JSON.stringify([...new Set(lines.map((l) => l.step))].sort()),
    [lines],
  );
  const ends = { input: !!input, output: !!output };
  // biome-ignore lint/correctness/useExhaustiveDependencies: the keys stand in for steps and lines.
  const graph = useMemo(() => {
    const has = new Set<string>(JSON.parse(touched));
    return flowOf(steps, (id) => live || has.has(id), ends);
  }, [stepKey, touched, live, ends.input, ends.output]);

  const byId = useMemo(() => new Map(steps.map((s) => [s.id, s])), [steps]);
  const views = useMemo(() => stepsAt(steps, lines, shown), [steps, lines, shown]);
  const expected = useMemo(() => expectedOf(lines), [lines]);
  const newest = shown > 0 ? lines[shown - 1] : undefined;
  const chip = newest && aboutOne(newest) ? newest : null;

  const stateOf = (id: string): RunStepState =>
    id === INPUT
      ? shown > 0
        ? "done"
        : "idle"
      : id === OUTPUT
        ? over
          ? "done"
          : "idle"
        : (views[id]?.state ?? "idle");

  // Following: the nodes a subject passed through, with the run's two ends.
  const lit = useMemo(() => {
    if (!focus) return null;
    if ("step" in focus) return new Set([focus.step]);
    const out = new Set<string>([INPUT]);
    const drawn = new Set(graph.nodes.map((n) => n.id));
    for (const l of lines.slice(0, shown))
      if (l.subject === focus.subject && drawn.has(l.step)) out.add(l.step);
    if (graph.edges.some((e) => e.to === OUTPUT && out.has(e.from))) out.add(OUTPUT);
    return out;
  }, [focus, lines, shown, graph]);
  const followed = [...(lit ?? [])].filter((id) => byId.has(id)).length;
  const onTrace = (from: string, to: string) =>
    !!lit &&
    (focus && "step" in focus ? lit.has(from) || lit.has(to) : lit.has(from) && lit.has(to));

  // A spark rides into a step for each of its last few lines: the work arriving.
  const recent = still ? [] : lines.slice(Math.max(0, shown - 3), shown).filter(aboutOne);

  const shownLines = lines.slice(0, shown);
  const sources = sourcesOf(shownLines);
  const panel = opened && work ? work(opened) : null;
  // Opening a line's work holds the replay there; closing it leaves it paused for Play.
  const open = (l: RunLine) => {
    setOpened((o) => (o?.id === l.id ? null : l));
    setPaused(true);
  };
  const visible = !focus
    ? shownLines
    : shownLines.filter((l) =>
        "step" in focus ? l.step === focus.step : l.subject === focus.subject,
      );

  // The feed follows the newest line, inside its own box; the page doesn't jump.
  const feed = useRef<HTMLOListElement>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll each time a line shows.
  useEffect(() => {
    const el = feed.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [shown, focus]);

  const toggleStep = (id: string) =>
    setFocus((f) => (f && "step" in f && f.step === id ? null : { step: id }));

  return (
    <div
      className={cx(
        "@container/run grid gap-4 rounded-(--ui-radius-window) bg-(--ui-tile) p-5",
        className,
      )}
      data-live={live || undefined}
    >
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <p className="flex items-center gap-2.5 text-[14px] font-semibold">
          <span
            className="size-2 rounded-full bg-(--ui-ink-3) data-on:animate-ui-run-pulse data-on:bg-(--ui-good) motion-reduce:animate-none"
            data-on={live || undefined}
            aria-hidden="true"
          />
          {label}
        </p>
        <div className="flex items-center gap-3">
          <span className="text-[13px] text-(--ui-ink-2) tabular-nums" aria-hidden="true">
            {num(shown)} / {num(total)}
          </span>
          {over && still ? null : over ? (
            <button type="button" className={BUTTON} onClick={replay}>
              <Icon name="play" size={12} />
              Play again
            </button>
          ) : (
            <button
              type="button"
              className={BUTTON}
              onClick={() => setPaused((p) => !p)}
              aria-pressed={paused}
              disabled={still}
            >
              <Icon name={paused ? "play" : "pause"} size={12} />
              {paused ? "Play" : "Pause"}
              <kbd className="rounded-[4px] bg-(--ui-fill) px-[5px] py-px font-[inherit] text-[10px] text-(--ui-ink-2) [@media(hover:none)]:hidden">
                Space
              </kbd>
            </button>
          )}
        </div>
      </div>

      <Suspense fallback={<div className="min-h-40" />}>
        <RunGraph
          graph={graph}
          steps={byId}
          views={views}
          expected={expected}
          input={input}
          output={output}
          over={over}
          stateOf={stateOf}
          lit={lit}
          trace={onTrace}
          picked={focus && "step" in focus ? focus.step : null}
          onPick={toggleStep}
          recent={recent}
          chip={chip}
        />
      </Suspense>

      <p
        className="-mb-2 flex min-h-5 flex-wrap items-baseline gap-x-3 gap-y-1 text-[13px] text-(--ui-ink-2)"
        aria-live="polite"
      >
        {!focus ? (
          <span className="text-(--ui-ink-3)">
            Pick a step, or a line, to follow it through the run.
          </span>
        ) : (
          <>
            <span>
              {"step" in focus ? (
                <>
                  Showing{" "}
                  <b className="text-(--ui-ink)">{byId.get(focus.step)?.label ?? focus.step}</b>{" "}
                  only
                </>
              ) : (
                <>
                  Following <b className="text-(--ui-ink)">{focus.subject}</b> through{" "}
                  {num(followed)} {followed === 1 ? "step" : "steps"}
                </>
              )}
            </span>
            <button
              type="button"
              className={cx(LINK, "font-semibold text-(--ui-accent)")}
              onClick={() => setFocus(null)}
            >
              Show all
            </button>
          </>
        )}
      </p>

      {sources.length ? (
        <p className="mb-2 flex flex-wrap items-center gap-1.5 text-[12px] text-(--ui-ink-2)">
          <span className="mr-0.5 font-semibold tracking-(--ui-label-tracking) [text-transform:var(--ui-label-case)]">
            Sources
          </span>
          {sources.map((x) => (
            <span
              key={x.label}
              className="inline-flex items-center gap-1.5 rounded-(--ui-radius-tag) bg-(--ui-fill) py-0.5 pr-2 pl-[3px]"
            >
              <SiteMark site={x.label} />
              {x.label}
              <b className="text-(--ui-ink) tabular-nums">{num(x.count)}</b>
            </span>
          ))}
        </p>
      ) : null}

      <ol
        ref={feed}
        className="grid h-75 list-none content-start gap-0.5 overflow-y-auto overscroll-contain scroll-smooth rounded-(--ui-radius-card) bg-(--ui-paper) px-3.5 py-3 shadow-(--ui-shadow-node) [mask-image:linear-gradient(to_bottom,transparent,#000_14px)] @max-[560px]/run:h-65"
        aria-label="What it did"
        aria-live={live ? "polite" : "off"}
      >
        {visible.map((l) => (
          <li
            key={l.id}
            className={cx(
              LINE,
              KIND[l.kind],
              opened?.id === l.id &&
                "-mx-2 rounded-(--ui-radius-control) bg-(--ui-accent-tint) px-2",
            )}
            data-kind={l.kind}
            data-open={opened?.id === l.id || undefined}
          >
            <span className={cx("-translate-y-0.5", MARK[l.kind])} aria-hidden="true" />
            <span className="@max-[420px]/run:col-[2/-1]">
              {aboutOne(l) && l.subject ? (
                <button
                  type="button"
                  className={cx(LINK, "font-[weight:inherit] text-inherit")}
                  title={`Follow ${l.subject}`}
                  onClick={() => setFocus({ subject: l.subject ?? "" })}
                >
                  {l.text}
                </button>
              ) : (
                l.text
              )}
              {l.detail ? (
                <span className="block text-[12px] font-normal text-(--ui-ink-2) wrap-anywhere">
                  {l.detail}
                </span>
              ) : null}
            </span>
            {l.source ? (
              l.source.href ? (
                <a
                  className={cx(CITE, "hover:bg-(--ui-accent-tint) hover:text-(--ui-accent)")}
                  href={l.source.href}
                  target="_blank"
                  rel="noreferrer noopener"
                >
                  {l.source.label}
                </a>
              ) : (
                <span className={CITE}>{l.source.label}</span>
              )
            ) : null}
            {work && aboutOne(l) && work(l) !== null ? (
              <button
                type="button"
                className={cx(
                  "cursor-pointer rounded-(--ui-radius-tag) border border-(--ui-hair) bg-(--ui-paper) px-2 py-px font-[inherit] text-[11px] leading-[inherit] font-semibold text-(--ui-ink-2) hover:border-(--ui-accent) hover:text-(--ui-accent) aria-expanded:border-(--ui-accent) aria-expanded:text-(--ui-accent) @max-[420px]/run:justify-self-start",
                  l.source ? "@max-[420px]/run:col-3" : "@max-[420px]/run:col-2",
                )}
                aria-expanded={opened?.id === l.id}
                aria-controls="ui-run-work"
                onClick={() => open(l)}
              >
                How
              </button>
            ) : null}
          </li>
        ))}
        {!shown ? <li className={cx(LINE, "text-[14px] text-(--ui-ink-2)")}>Starting…</li> : null}
      </ol>

      {opened && panel ? (
        <div
          id="ui-run-work"
          className={cx(
            RISE,
            "relative mt-3 rounded-(--ui-radius-card) bg-(--ui-paper) px-[18px] py-4 shadow-(--ui-shadow-node) duration-300 @max-[420px]/run:px-3 @max-[420px]/run:py-3.5",
          )}
        >
          <button
            type="button"
            className="absolute top-2.5 right-2.5 grid size-7 cursor-pointer place-items-center rounded-(--ui-radius-control) border-0 bg-transparent text-(--ui-ink-2) hover:bg-(--ui-hover) hover:text-(--ui-ink)"
            aria-label="Close"
            onClick={() => setOpened(null)}
          >
            <Icon name="close" size={14} />
          </button>
          {panel}
        </div>
      ) : null}

      {over && results ? <div className={cx(RISE, "duration-600")}>{results}</div> : null}
    </div>
  );
}

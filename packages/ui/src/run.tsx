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
import {
  type CSSProperties,
  type ReactNode,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  type Box,
  edgePath,
  type FlowAxis,
  type FlowGraph,
  flowOf,
  INPUT,
  OUTPUT,
  tracksOf,
} from "./flow.js";
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

/** Narrower than this per column, the graph runs top to bottom. */
const MIN_COLUMN = 150;

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

const sameBoxes = (a: Record<string, Box>, b: Record<string, Box>) => {
  const ka = Object.keys(a);
  return (
    ka.length === Object.keys(b).length &&
    ka.every((k) => {
      const x = a[k];
      const y = b[k];
      return !!x && !!y && x.x === y.x && x.y === y.y && x.w === y.w && x.h === y.h;
    })
  );
};

/** Where each node sits, measured, and which way the graph runs at this width. */
function useLayout(graph: FlowGraph) {
  const box = useRef<HTMLDivElement>(null);
  const [axis, setAxis] = useState<FlowAxis>("across");
  const [boxes, setBoxes] = useState<Record<string, Box>>({});

  // biome-ignore lint/correctness/useExhaustiveDependencies: a new axis moves every node; measure again.
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const measure = () => {
      const next: FlowAxis =
        el.clientWidth / Math.max(graph.cols, 1) >= MIN_COLUMN ? "across" : "down";
      setAxis(next);
      // Layout positions, not painted ones: a lifted node doesn't move its lines.
      const out: Record<string, Box> = {};
      for (const n of el.querySelectorAll<HTMLElement>("[data-node]")) {
        const id = n.dataset.node;
        if (id) out[id] = { x: n.offsetLeft, y: n.offsetTop, w: n.offsetWidth, h: n.offsetHeight };
      }
      setBoxes((was) => (sameBoxes(was, out) ? was : out));
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const watch = new ResizeObserver(measure);
    watch.observe(el);
    for (const n of el.querySelectorAll("[data-node]")) watch.observe(n);
    return () => watch.disconnect();
  }, [graph, axis]);

  return { box, axis, boxes };
}

/** Where a node sits in the grid, by which way the graph runs. */
function placeOf(
  n: { col: number; index: number; of: number },
  g: FlowGraph,
  axis: FlowAxis,
  tracks: number,
): CSSProperties {
  if (axis === "across")
    return { gridColumn: n.col + 1, gridRow: `${g.rows - n.of + n.index * 2 + 1} / span 2` };
  const span = Math.max(1, Math.floor(tracks / n.of));
  return { gridRow: n.col + 1, gridColumn: `${n.index * span + 1} / span ${span}` };
}

/** Across: a column holding only an end is narrower than a column of steps. */
const columnsOf = (g: FlowGraph) =>
  Array.from({ length: g.cols }, (_, c) =>
    g.nodes.some((n) => n.col === c && n.id !== INPUT && n.id !== OUTPUT)
      ? "minmax(0, 1fr)"
      : "minmax(0, 0.7fr)",
  ).join(" ");

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
  const { box, axis, boxes } = useLayout(graph);
  const tracks = useMemo(() => tracksOf(graph), [graph]);

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

  const paths = useMemo(() => {
    const out = new Map<string, string>();
    for (const e of graph.edges) {
      const a = boxes[e.from];
      const b = boxes[e.to];
      if (a && b) out.set(`${e.from}>${e.to}`, edgePath(a, b, e.span, axis));
    }
    return out;
  }, [graph, boxes, axis]);

  // A spark rides into a step for each of its last few lines: the work arriving.
  const sparks = still
    ? []
    : lines.slice(Math.max(0, shown - 3), shown).flatMap((l) => {
        if (!aboutOne(l)) return [];
        const e = graph.edges.find((x) => x.to === l.step);
        const d = e && paths.get(`${e.from}>${e.to}`);
        return d ? [{ id: l.id, kind: l.kind, d }] : [];
      });

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

  const ordinal = new Map(
    graph.nodes.filter((n) => byId.has(n.id)).map((n, i) => [n.id, i + 1] as const),
  );
  const toggleStep = (id: string) =>
    setFocus((f) => (f && "step" in f && f.step === id ? null : { step: id }));

  return (
    <div className={cx("ui-run", className)} data-live={live || undefined}>
      <div className="ui-run-bar">
        <p className="ui-run-label">
          <span className="ui-run-dot" data-on={live || undefined} aria-hidden="true" />
          {label}
        </p>
        <div className="ui-run-controls">
          <span className="ui-run-progress" aria-hidden="true">
            {num(shown)} / {num(total)}
          </span>
          {over && still ? null : over ? (
            <button type="button" className="ui-run-button" onClick={replay}>
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

      <div
        ref={box}
        className="ui-run-graph"
        data-axis={axis}
        data-following={lit ? true : undefined}
      >
        <svg className="ui-run-edges" aria-hidden="true">
          {graph.edges.map((e) => {
            const d = paths.get(`${e.from}>${e.to}`);
            if (!d) return null;
            const to = stateOf(e.to);
            const state =
              to === "active" ? "flowing" : stateOf(e.from) === "done" ? "done" : "idle";
            return (
              <path
                key={`${e.from}>${e.to}`}
                d={d}
                className="ui-run-edge"
                data-state={state}
                data-trace={onTrace(e.from, e.to) || undefined}
              />
            );
          })}
        </svg>
        {sparks.map((s) => (
          <span
            key={s.id}
            className="ui-run-spark"
            data-kind={s.kind}
            style={{ offsetPath: `path("${s.d}")` }}
            aria-hidden="true"
          />
        ))}
        <ol
          className="ui-run-steps"
          aria-label="Steps"
          style={
            axis === "across"
              ? {
                  gridTemplateColumns: columnsOf(graph),
                  gridTemplateRows: `repeat(${graph.rows * 2}, auto)`,
                }
              : { gridTemplateColumns: `repeat(${tracks}, minmax(0, 1fr))` }
          }
        >
          {graph.nodes.map((n) => {
            const place = placeOf(n, graph, axis, tracks);
            const dim = lit && !lit.has(n.id) ? true : undefined;
            const end = n.id === INPUT ? input : n.id === OUTPUT ? output : undefined;
            if (end)
              return (
                <li
                  key={n.id}
                  data-node={n.id}
                  className="ui-run-end"
                  data-state={stateOf(n.id)}
                  data-dim={dim}
                  style={place}
                >
                  <span className="ui-run-end-name">
                    {n.id === OUTPUT && over ? <Icon name="check" size={12} /> : null}
                    {end.label}
                  </span>
                  {end.note ? <span className="ui-run-source">{end.note}</span> : null}
                </li>
              );
            const s = byId.get(n.id);
            if (!s) return null;
            const v = views[s.id] ?? { state: "idle", handled: 0, found: 0, failed: 0, waiting: 0 };
            const mix = mixOf(v, expected[s.id] ?? 0);
            const picked = !!focus && "step" in focus && focus.step === s.id;
            return (
              <li
                key={s.id}
                data-node={s.id}
                className="ui-run-node"
                data-state={v.state}
                data-dim={dim}
                data-split={axis === "down" && n.of > 1 ? true : undefined}
                style={place}
              >
                <button
                  type="button"
                  className="ui-run-step"
                  aria-pressed={picked}
                  onClick={() => toggleStep(s.id)}
                >
                  <span className="ui-run-index" aria-hidden="true">
                    {v.state === "done" ? <Icon name="check" size={11} /> : ordinal.get(s.id)}
                  </span>
                  <span className="ui-run-name">
                    <span className="ui-run-long">{s.label}</span>
                    <span className="ui-run-short" aria-hidden="true">
                      {s.short ?? s.label}
                    </span>
                  </span>
                  {s.source ? <span className="ui-run-source">{s.source}</span> : null}
                  <span className="ui-run-tally">
                    <span className="ui-run-count">{num(v.handled)}</span>
                    {s.found && v.found ? (
                      <span className="ui-run-found">
                        {num(v.found)} {s.found}
                      </span>
                    ) : null}
                    {v.waiting ? (
                      <span className="ui-run-parked">{num(v.waiting)} waiting</span>
                    ) : null}
                  </span>
                  <span className="ui-run-mix" aria-hidden="true">
                    {(["found", "did", "failed", "waiting"] as const).map((k) =>
                      mix[k] ? (
                        <i key={k} data-kind={k} style={{ width: `${mix[k] * 100}%` }} />
                      ) : null,
                    )}
                  </span>
                </button>
                {chip?.step === s.id ? (
                  <span key={chip.id} className="ui-run-chip" data-kind={chip.kind}>
                    {chip.subject}
                  </span>
                ) : null}
              </li>
            );
          })}
        </ol>
      </div>

      <p className="ui-run-focus" aria-live="polite">
        {!focus ? (
          <span className="ui-run-hint">Pick a step, or a line, to follow it through the run.</span>
        ) : (
          <>
            <span>
              {"step" in focus ? (
                <>
                  Showing <b>{byId.get(focus.step)?.label ?? focus.step}</b> only
                </>
              ) : (
                <>
                  Following <b>{focus.subject}</b> through {num(followed)}{" "}
                  {followed === 1 ? "step" : "steps"}
                </>
              )}
            </span>
            <button type="button" className="ui-run-clear" onClick={() => setFocus(null)}>
              Show all
            </button>
          </>
        )}
      </p>

      {sources.length ? (
        <p className="ui-run-sources">
          <span className="ui-run-sources-label">Sources</span>
          {sources.map((x) => (
            <span key={x.label} className="ui-run-site">
              <SiteMark site={x.label} />
              {x.label}
              <b>{num(x.count)}</b>
            </span>
          ))}
        </p>
      ) : null}

      <ol
        ref={feed}
        className="ui-run-feed"
        aria-label="What it did"
        aria-live={live ? "polite" : "off"}
      >
        {visible.map((l) => (
          <li
            key={l.id}
            className="ui-run-line"
            data-kind={l.kind}
            data-open={opened?.id === l.id || undefined}
          >
            <span className="ui-run-mark" aria-hidden="true" />
            <span className="ui-run-text">
              {aboutOne(l) && l.subject ? (
                <button
                  type="button"
                  className="ui-run-follow"
                  title={`Follow ${l.subject}`}
                  onClick={() => setFocus({ subject: l.subject ?? "" })}
                >
                  {l.text}
                </button>
              ) : (
                l.text
              )}
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
            {work && aboutOne(l) && work(l) !== null ? (
              <button
                type="button"
                className="ui-run-how"
                aria-expanded={opened?.id === l.id}
                aria-controls="ui-run-work"
                onClick={() => open(l)}
              >
                How
              </button>
            ) : null}
          </li>
        ))}
        {!shown ? <li className="ui-run-line ui-run-wait">Starting…</li> : null}
      </ol>

      {opened && panel ? (
        <div id="ui-run-work" className="ui-run-work">
          <button
            type="button"
            className="ui-run-work-close"
            aria-label="Close"
            onClick={() => setOpened(null)}
          >
            <Icon name="close" size={14} />
          </button>
          {panel}
        </div>
      ) : null}

      {over && results ? <div className="ui-run-results">{results}</div> : null}
    </div>
  );
}

/**
 * Metro/Lab: one case through the three layout engines, beside the hand-placed map. Pick a case and
 * a step (the map's width); the hand map comes first, then each engine sorted by its score. "Score
 * all cases" adds up the board at that step.
 */
import type { Meta, StoryObj } from "@storybook/react-vite";
import { useEffect, useState } from "react";
import { expect, within } from "storybook/test";
import { FactsTable } from "../../table.js";
import { MetroSvg } from "../draw.js";
import { foldTwins } from "../fold.js";
import { MetroMap } from "../map.js";
import "../metro.css";
import type { MetroScene } from "../types.js";
import { LAB_CASES, type LabCase } from "./cases.js";
import { DEFAULT_STEP, ENGINES, STEPS } from "./engines.js";
import { funnel } from "./generate.js";
import { type Score, scoreScene } from "./score.js";

export default { title: "Metro/Lab", parameters: { layout: "padded" } } satisfies Meta;

interface Run {
  id: string;
  name: string;
  scene: MetroScene;
  score: Score;
}

/** Overlaps first (fewest), then likeness to the hand (most), then crossings (fewest). */
const better = (a: Score, b: Score) =>
  a.clashes - b.clashes ||
  (b.likeness ?? 0) - (a.likeness ?? 0) ||
  a.crossings - b.crossings ||
  a.uneven - b.uneven;

/** `twins`: side-by-side stations fold first, each into one stacked station. */
async function runAll(c: LabCase, step: number, twins = false): Promise<Run[]> {
  const view = twins ? foldTwins(c.view) : c.view;
  const runs = await Promise.all(
    ENGINES.map(async (e) => {
      const scene = await e.run(view, step);
      return { id: e.id, name: e.name, scene, score: scoreScene(scene, c.hand) };
    }),
  );
  return runs.sort((a, b) => better(a.score, b.score));
}

function ScoreLine({ s }: { s: Score }) {
  const bad = (n: number) => (n ? "font-semibold text-[var(--ui-bad)]" : "");
  return (
    <p className="text-[13px] text-[var(--ui-ink-2)] tabular-nums">
      {s.likeness !== undefined ? <span>like {s.likeness.toFixed(2)} · </span> : null}
      <span className={bad(s.clashes)}>overlaps {s.clashes}</span> · uneven {s.uneven} · crossings{" "}
      {s.crossings} · bends {s.bends} · width {s.width}px
    </p>
  );
}

function Card({ title, scene, score }: { title: string; scene: MetroScene; score?: Score }) {
  return (
    <section className="grid gap-2 border-t border-[var(--ui-hair)] pt-4">
      <h3 className="text-[15px] font-semibold text-[var(--ui-ink)]">{title}</h3>
      {score ? <ScoreLine s={score} /> : null}
      {score?.why.length ? (
        <p className="text-[12px] text-[var(--ui-ink-3)]">{score.why.join("; ")}</p>
      ) : null}
      {/* biome-ignore lint/a11y/noNoninteractiveTabindex: a box that scrolls needs focus to scroll by keyboard. */}
      <div tabIndex={0} className="overflow-x-auto">
        <MetroSvg scene={scene} still />
      </div>
    </section>
  );
}

interface Total {
  id: string;
  name: string;
  like: number;
  clashes: number;
  uneven: number;
  crossings: number;
  /** The mean width, px. */
  width: number;
  wins: number;
}

/** Every case through every engine, added up. A win is the best score on one case. */
async function scoreAll(step: number): Promise<Total[]> {
  const t = new Map<string, Total>(
    ENGINES.map((e) => [
      e.id,
      { id: e.id, name: e.name, like: 0, clashes: 0, uneven: 0, crossings: 0, width: 0, wins: 0 },
    ]),
  );
  const handCases = LAB_CASES.filter((c) => c.hand).length;
  for (const c of LAB_CASES) {
    const runs = await runAll(c, step);
    const top = runs[0];
    if (top) (t.get(top.id) as Total).wins++;
    for (const r of runs) {
      const x = t.get(r.id) as Total;
      x.like += (r.score.likeness ?? 0) / handCases;
      x.clashes += r.score.clashes;
      x.uneven += r.score.uneven;
      x.crossings += r.score.crossings;
      x.width += r.score.width / LAB_CASES.length;
    }
  }
  return [...t.values()].sort((a, b) => a.clashes - b.clashes || b.like - a.like);
}

function Board({ step }: { step: number }) {
  const [rows, setRows] = useState<{ step: number; rows: Total[] } | null>(null);
  const [busy, setBusy] = useState(false);
  if (!rows || rows.step !== step)
    return (
      <button
        type="button"
        className="justify-self-start border border-[var(--ui-hair)] px-3 py-1.5 text-[13px]"
        disabled={busy}
        onClick={() => {
          setBusy(true);
          void scoreAll(step).then((r) => {
            setRows({ step, rows: r });
            setBusy(false);
          });
        }}
      >
        {busy ? "Scoring…" : "Score all cases"}
      </button>
    );
  return (
    <FactsTable
      head={[
        "Engine",
        ["Overlaps", "r"],
        ["Likeness", "r"],
        ["Uneven", "r"],
        ["Crossings", "r"],
        ["Width", "r"],
        ["Wins", "r"],
      ]}
      rows={rows.rows.map((r) => [
        r.name,
        r.clashes,
        r.like.toFixed(3),
        r.uneven,
        r.crossings,
        `${Math.round(r.width)}px`,
        r.wins,
      ])}
    />
  );
}

function Lab({ start, twins: fold = false }: { start: string; twins?: boolean }) {
  const [id, setId] = useState(start);
  const [step, setStep] = useState<number>(DEFAULT_STEP);
  const [twins, setTwins] = useState(fold);
  const [runs, setRuns] = useState<Run[] | null>(null);
  const c = LAB_CASES.find((x) => x.id === id) ?? (LAB_CASES[0] as LabCase);
  // read-ok: the layouts run here in the page (ELK is async); nothing is fetched.
  useEffect(() => {
    let live = true;
    setRuns(null);
    void runAll(c, step, twins).then((r) => live && setRuns(r));
    return () => {
      live = false;
    };
  }, [c, step, twins]);
  return (
    <div className="grid gap-6">
      <div className="grid gap-3">
        <label className="grid gap-1 text-[13px] text-[var(--ui-ink-2)]">
          Case
          <select
            className="justify-self-start border border-[var(--ui-hair)] bg-[var(--ui-paper)] px-2 py-1 text-[14px] text-[var(--ui-ink)]"
            value={id}
            onChange={(e) => setId(e.target.value)}
          >
            {LAB_CASES.map((x) => (
              <option key={x.id} value={x.id}>
                {x.group}: {x.title}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1 text-[13px] text-[var(--ui-ink-2)]">
          Step between columns (width)
          <select
            className="justify-self-start border border-[var(--ui-hair)] bg-[var(--ui-paper)] px-2 py-1 text-[14px] text-[var(--ui-ink)]"
            value={step}
            onChange={(e) => setStep(Number(e.target.value))}
          >
            {STEPS.map((n) => (
              <option key={n} value={n}>
                {n}px{n === DEFAULT_STEP ? " (default)" : ""}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2 text-[13px] text-[var(--ui-ink-2)]">
          <input type="checkbox" checked={twins} onChange={(e) => setTwins(e.target.checked)} />
          Fold side-by-side stations (one post on each platform)
        </label>
        <Board step={step} />
      </div>
      {c.hand ? <Card title="Hand-placed (the target)" scene={c.hand} /> : null}
      {runs ? (
        runs.map((r, i) => (
          <Card key={r.id} title={`${i + 1}. ${r.name}`} scene={r.scene} score={r.score} />
        ))
      ) : (
        <p className="text-[13px] text-[var(--ui-ink-3)]">Laying out…</p>
      )}
    </div>
  );
}

type Story = StoryObj;

/** A hand-placed industry map: the target is the artifact's drawing. */
export const Industry: Story = {
  render: () => <Lab start="industry-dental" />,
  // Every engine runs in the page: the LP placer's Wasm loads here, not only in Node.
  play: async ({ canvasElement }) => {
    const first = await within(canvasElement).findByText(/^1\. /, {}, { timeout: 30_000 });
    await expect(first).toBeVisible();
    await expect(within(canvasElement).getAllByText(/^\d+\. ELK \+ LP$/).length).toBeGreaterThan(0);
  },
};

/** A big generated funnel: no hand map; overlaps and crossings decide. */
export const Big: Story = { render: () => <Lab start="generated-40" /> };

/** Loops, a retainer and one post on five platforms, with the platforms folded. */
export const Shaped: Story = { render: () => <Lab start="generated-40-shaped" twins /> };

/**
 * The shaped funnel in the live map, at Stations: the platforms fold into one stacked station, the
 * outlier stays out. Click the fold to open it; its tab folds it back.
 */
export const ShapedMap: Story = {
  render: () => (
    <MetroMap
      view={funnel(40, 40, { loops: true, retainer: true, platforms: 5 })}
      defaultLevel={2}
      intro={false}
    />
  ),
};

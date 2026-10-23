/**
 * Metro/Lab: one case through every layout engine, beside the hand-placed map. Pick a case; the hand
 * map comes first, then each engine sorted by its score. "Score all cases" adds up the board.
 */
import type { Meta, StoryObj } from "@storybook/react-vite";
import { useEffect, useState } from "react";
import { FactsTable } from "../../table.js";
import { MetroSvg } from "../draw.js";
import "../metro.css";
import type { MetroScene } from "../types.js";
import { LAB_CASES, type LabCase } from "./cases.js";
import { ENGINES } from "./engines.js";
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

async function runAll(c: LabCase): Promise<Run[]> {
  const runs = await Promise.all(
    ENGINES.map(async (e) => {
      const scene = await e.run(c.view);
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
      {s.crossings} · bends {s.bends} · area {s.area}k
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
      <div className="overflow-x-auto">
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
  wins: number;
}

/** Every case through every engine, added up. A win is the best score on one case. */
async function scoreAll(): Promise<Total[]> {
  const t = new Map<string, Total>(
    ENGINES.map((e) => [
      e.id,
      { id: e.id, name: e.name, like: 0, clashes: 0, uneven: 0, crossings: 0, wins: 0 },
    ]),
  );
  const handCases = LAB_CASES.filter((c) => c.hand).length;
  for (const c of LAB_CASES) {
    const runs = await runAll(c);
    const top = runs[0];
    if (top) (t.get(top.id) as Total).wins++;
    for (const r of runs) {
      const x = t.get(r.id) as Total;
      x.like += (r.score.likeness ?? 0) / handCases;
      x.clashes += r.score.clashes;
      x.uneven += r.score.uneven;
      x.crossings += r.score.crossings;
    }
  }
  return [...t.values()].sort((a, b) => a.clashes - b.clashes || b.like - a.like);
}

function Board() {
  const [rows, setRows] = useState<Total[] | null>(null);
  const [busy, setBusy] = useState(false);
  if (!rows)
    return (
      <button
        type="button"
        className="justify-self-start border border-[var(--ui-hair)] px-3 py-1.5 text-[13px]"
        disabled={busy}
        onClick={() => {
          setBusy(true);
          void scoreAll().then(setRows);
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
        ["Wins", "r"],
      ]}
      rows={rows.map((r) => [r.name, r.clashes, r.like.toFixed(3), r.uneven, r.crossings, r.wins])}
    />
  );
}

function Lab({ start }: { start: string }) {
  const [id, setId] = useState(start);
  const [runs, setRuns] = useState<Run[] | null>(null);
  const c = LAB_CASES.find((x) => x.id === id) ?? (LAB_CASES[0] as LabCase);
  // read-ok: the layouts run here in the page (ELK is async); nothing is fetched.
  useEffect(() => {
    let live = true;
    setRuns(null);
    void runAll(c).then((r) => live && setRuns(r));
    return () => {
      live = false;
    };
  }, [c]);
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
        <Board />
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
export const Industry: Story = { render: () => <Lab start="industry-dental" /> };

/** A big generated funnel: no hand map; overlaps and crossings decide. */
export const Big: Story = { render: () => <Lab start="generated-40" /> };

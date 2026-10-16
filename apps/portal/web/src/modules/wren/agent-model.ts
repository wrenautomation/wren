/**
 * The Agents page's model (designs/2026-10-11-agents.md): each part that runs for Wren as an
 * agent, its state read off its loops, grouped by department (its stage), with its counted
 * outputs. Pure, so it's tested without a browser.
 */
import type { AgentLine, LoopRow } from "@wren/core/console";

/**
 * `failing`: a running loop failed its last pass. `running`: a loop runs. `off`: every loop is
 * stopped. `call`: no loop of its own, it runs when called. `unknown`: the loops didn't read.
 */
export type AgentState = "failing" | "running" | "off" | "call" | "unknown";

export interface Agent extends AgentLine {
  state: AgentState;
  /** Its loops' newest pass; null with none. */
  lastAt: string | null;
  /** A failing loop's last error, its first line. */
  error: string | null;
}

/** One number over the period, and today's part of it. */
export interface Count {
  value: number;
  today: number;
}

/** Counts by `countKey`: a plain object, so the device copy keeps it. */
export type Counts = Readonly<Record<string, Count>>;

export const countKey = (c: { record: string; view: string }) => `${c.record}:${c.view}`;

/** Each line with its state, from the loops as read; `loops` null: the read failed. */
export function agentsOf(lines: readonly AgentLine[], loops: readonly LoopRow[] | null): Agent[] {
  return lines.map((l) => {
    const mine = loops?.filter((r) => l.loops.includes(r.service)) ?? [];
    const failing = mine.find((r) => r.running && (r.failures > 0 || r.error !== null));
    const state: AgentState = !l.loops.length
      ? "call"
      : !loops
        ? "unknown"
        : failing
          ? "failing"
          : mine.some((r) => r.running)
            ? "running"
            : "off";
    const lastAt = mine.reduce<string | null>(
      (at, r) => (r.lastAt && (!at || r.lastAt > at) ? r.lastAt : at),
      null,
    );
    const error = failing?.error?.split("\n")[0]?.slice(0, 160) ?? null;
    return { ...l, state, lastAt, error };
  });
}

const RANK: Record<AgentState, number> = { failing: 0, running: 1, call: 2, unknown: 3, off: 4 };

/** Departments in the order the lines came (the stages'), failing first inside each. */
export function departments(agents: readonly Agent[]): { name: string; agents: Agent[] }[] {
  const out: { name: string; agents: Agent[] }[] = [];
  for (const a of agents) {
    const d = out.find((x) => x.name === a.department);
    if (d) d.agents.push(a);
    else out.push({ name: a.department, agents: [a] });
  }
  for (const d of out)
    d.agents.sort((a, b) => RANK[a.state] - RANK[b.state] || a.name.localeCompare(b.name));
  return out;
}

/** The page's head: how many in each state, and what all of them made today. */
export function tally(agents: readonly Agent[], counts: Counts) {
  const n = (s: AgentState) => agents.filter((a) => a.state === s).length;
  const keys = new Set(agents.flatMap((a) => a.counts.map(countKey)));
  return {
    running: n("running"),
    failing: n("failing"),
    off: n("off"),
    today: [...keys].reduce((sum, k) => sum + (counts[k]?.today ?? 0), 0),
  };
}

/** "just now", "12 min ago", "3 h ago", "2 d ago"; "never" with none. */
export function since(at: string | null, now = new Date()): string {
  if (!at) return "never";
  const min = Math.floor((now.getTime() - new Date(at).getTime()) / 60_000);
  if (Number.isNaN(min)) return "";
  if (min < 1) return "just now";
  if (min < 60) return `${min} min ago`;
  if (min < 48 * 60) return `${Math.floor(min / 60)} h ago`;
  return `${Math.floor(min / 1440)} d ago`;
}

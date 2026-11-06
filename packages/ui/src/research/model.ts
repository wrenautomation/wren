/**
 * A research run as its graph shows it (designs/2026-11-05-research-web.md): claims, the sources
 * behind them, and each source's kept findings. One shape for the page and the chat cards. Draft.
 */
import type { IconName } from "../icons.js";

/** One kept finding: a sentence a page said. `claim` = the claim that uses it. */
export interface Finding {
  text: string;
  /** Where in a video the words are. */
  at?: string | undefined;
  claim?: number | undefined;
}

export interface ResearchSource {
  id: string;
  name: string;
  /** The island it sits in: a kind of source. */
  kind: string;
  icon?: IconName | undefined;
  /** Findings the review cut. */
  cut: number;
  findings: readonly Finding[];
}

export interface Claim {
  n: number;
  text: string;
}

export interface ResearchRun {
  id: string;
  name: string;
  /** Its date and cost, as text. */
  meta: string;
  searches: number;
  hits: number;
  pages: number;
  /** Still reads: no claims yet. */
  live?: boolean | undefined;
  claims: readonly Claim[];
  sources: readonly ResearchSource[];
  /** The run's page in Research. */
  href?: string | undefined;
}

/** What a hover or a click holds: a claim or a source. */
export type Pick = { claim: number } | { source: string };

export const usedOf = (s: ResearchSource) => s.findings.filter((f) => f.claim !== undefined).length;

export const count = (n: number, one: string, many = `${one}s`) =>
  `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;

/** A source's own line: how much of it a claim uses. */
export function sourceLine(s: ResearchSource, claims: boolean): string {
  const kept = s.findings.length;
  const used = usedOf(s);
  if (!kept) return "nothing kept";
  return claims && used
    ? `${used} of ${count(kept, "finding")} in a claim`
    : count(kept, "finding");
}

/** A claim's own line: its findings and how many sources they come from. */
export function claimLine(run: ResearchRun, n: number): string {
  const from = run.sources.filter((s) => s.findings.some((f) => f.claim === n));
  const findings = from.reduce((a, s) => a + s.findings.filter((f) => f.claim === n).length, 0);
  const kinds = new Set(from.map((s) => s.kind));
  const only = kinds.size === 1 && from.length > 1 ? ` · ${[...kinds][0]?.toLowerCase()} only` : "";
  return `${count(findings, "finding")} · ${count(from.length, "source")}${only}`;
}

export const totals = (run: ResearchRun) => ({
  kept: run.sources.reduce((a, s) => a + s.findings.length, 0),
  used: run.sources.reduce((a, s) => a + usedOf(s), 0),
  cut: run.sources.reduce((a, s) => a + s.cut, 0),
});

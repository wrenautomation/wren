/**
 * Research reads `weaver serve` on this Mac (engine `packages/weaver/src/app/serve.ts`): the
 * browser asks 127.0.0.1 itself, so Chrome asks once to let the portal reach the local network.
 * The seam is the JSON: these types copy what the page reads from weaver's `view.ts` (`v: 1`).
 */
import { useEffect, useRef } from "react";

/** `?serve=` for another port. CSP connect-src names 127.0.0.1:4747 (public/_headers). */
export const SERVE =
  (typeof location === "undefined" ? null : new URLSearchParams(location.search).get("serve")) ??
  "http://127.0.0.1:4747";

type Who = { from: string; by: string };
type Answers = Record<string, Record<string, number>>;

export interface RunRow {
  run: string;
  ask: string;
  kind: string;
  parent: string | null;
  round: number;
  next: { round: number; step: string } | null;
  note: string | null;
  started: string;
  updated: string;
  hits: number;
  documents: number;
  kept: number;
  usd: number;
}

export interface RunQuery extends Who {
  id: string;
  round: number;
  at: string;
  terms: string;
  why: string;
  site?: string;
  facet?: string;
  tier?: number;
  follow?: { url: string; as: string; document?: string };
  hits: string[];
  again: string[];
}

export interface RunHit extends Who {
  id: string;
  round: number;
  url: string;
  title?: string;
  channel?: string;
  snippet?: string;
  date?: string;
  length?: number;
  sources: string[];
  queries: string[];
  call?: { verdict: "keep" | "drop"; why?: string } & Who;
  judge?: Answers;
  document?: string;
}

export interface RunDocument extends Who {
  id: string;
  hit: string;
  url: string;
  title?: string;
  channel?: string;
  media: string;
  date?: string;
  length?: number;
  chars: number;
  class?: string;
  judge?: Answers;
  verdict?: { quality: string; gap?: string };
  person?: string;
}

export interface RunFinding extends Who {
  id: string;
  round: number;
  document: string;
  text: string;
  quote?: string;
  date?: string;
  kept: boolean;
  fixes?: string;
  class?: string;
  checks: ({ ok: boolean; why: string; at: string } & Who)[];
}

export interface Moment extends Who {
  id: string;
  at: string;
  round: number;
  step?: string;
  type: string;
  text: string;
  why?: string;
  on?: string;
  ok?: boolean;
}

/** A person: one author across sites, from the brief. */
export interface RunPerson {
  id: string;
  name: string;
  profiles?: string[];
}

export interface RunView {
  v: 1;
  run: string;
  /** The agent's brief: v1 reads `people` only (the rest is agent-shaped, see the design log). */
  brief: { people?: RunPerson[] } & Record<string, unknown>;
  queries: RunQuery[];
  hits: RunHit[];
  documents: RunDocument[];
  findings: RunFinding[];
  timeline: Moment[];
  spend: { source: string; op: string; calls: number; failed: number; usd: number }[];
}

export interface StoredPage {
  id: string;
  url: string;
  title: string | null;
  media: string;
  text: string;
}

async function get<T>(path: string): Promise<T> {
  const r = await fetch(`${SERVE}${path}`);
  const body = (await r.json().catch(() => null)) as (T & { error?: string }) | null;
  if (!r.ok || !body) throw new Error(body?.error ?? `serve answered ${r.status}`);
  return body;
}

export const runsOf = () => get<{ v: 1; runs: RunRow[] }>("/runs").then((a) => a.runs);
export async function viewOf(run: string): Promise<RunView> {
  const v = await get<RunView>(`/runs/${encodeURIComponent(run)}`);
  if (v.v !== 1) throw new Error(`serve sends view v${v.v}; this page reads v1`);
  return v;
}
export const pageOf = (run: string, doc: string) =>
  get<StoredPage>(`/runs/${encodeURIComponent(run)}/documents/${encodeURIComponent(doc)}`);

/** Calls `on(run)` each time a run's records change, while the page is open. */
export function useLive(on: (run: string) => void) {
  const latest = useRef(on);
  latest.current = on;
  useEffect(() => {
    if (typeof EventSource === "undefined") return;
    const es = new EventSource(`${SERVE}/events`);
    es.addEventListener("run", (e) => {
      const { run } = JSON.parse((e as MessageEvent<string>).data) as { run: string };
      latest.current(run);
    });
    return () => es.close();
  }, []);
}

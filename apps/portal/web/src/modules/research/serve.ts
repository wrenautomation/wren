/**
 * Research reads `birdwatch serve` on this Mac (engine `packages/birdwatch/src/app/serve.ts`): the
 * browser asks 127.0.0.1 itself, so Chrome asks once to let the portal reach the local network.
 * The seam is the JSON: these types copy what the page reads from birdwatch's `view.ts` (`v: 1`).
 */
import { useEffect, useMemo, useRef, useState } from "react";

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
  /** Agent's next asks (birdwatch 0.47.0): newest first, at most 3. Absent from older serves. */
  asks?: RunAsk[];
}

export interface RunAsk {
  id: string;
  ask: string;
  why: string;
  at: string;
  from: string;
  /** The agent's id. */
  by: string;
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

// one stream for the whole page: a browser keeps 6 connections a host, a chat holds many cards
const heard = new Set<(run: string) => void>();
let stream: EventSource | null = null;

function listen(on: (run: string) => void): () => void {
  heard.add(on);
  if (!stream && typeof EventSource !== "undefined") {
    stream = new EventSource(`${SERVE}/events`);
    stream.addEventListener("run", (e) => {
      const { run } = JSON.parse((e as MessageEvent<string>).data) as { run: string };
      for (const f of heard) f(run);
    });
  }
  return () => {
    heard.delete(on);
    if (heard.size) return;
    stream?.close();
    stream = null;
  };
}

/** Calls `on(run)` each time a run's records change, while the page is open. */
export function useLive(on: (run: string) => void) {
  const latest = useRef(on);
  latest.current = on;
  useEffect(() => listen((run) => latest.current(run)), []);
}

// views by run, kept across pages: Live and History draw the same runs; a changed one shows until
// its new read lands
const views = new Map<string, RunView>();
const stale = new Set<string>();
const asking = new Map<string, Promise<RunView>>();
const FLIGHT = 6;

function viewKept(run: string): Promise<RunView> {
  const had = views.get(run);
  if (had && !stale.has(run)) return Promise.resolve(had);
  let p = asking.get(run);
  if (!p) {
    p = viewOf(run)
      .then((v) => {
        views.set(run, v);
        stale.delete(run);
        return v;
      })
      .finally(() => asking.delete(run));
    asking.set(run, p);
  }
  return p;
}

/** Each run's view, six reads at a time; a run that changes is read again while the page is open. */
export function useViews(runs: readonly string[]): {
  views: RunView[] | null;
  got: number;
  error: unknown;
  retry: () => void;
} {
  const key = runs.join(",");
  const [tick, setTick] = useState(0);
  const [error, setError] = useState<unknown>(null);
  const [n, setGot] = useState(0);
  useLive((run) => {
    if (!runs.includes(run)) return;
    stale.add(run);
    setTick((t) => t + 1);
  });
  // biome-ignore lint/correctness/useExhaustiveDependencies: key is the runs, tick a live change
  useEffect(() => {
    // read-ok: birdwatch serve on this Mac, not the portal API; a module cache, refetched per live event
    let live = true;
    setError(null);
    const left = runs.filter((r) => !views.has(r) || stale.has(r));
    const next = async () => {
      for (let r = left.shift(); r && live; r = left.shift()) {
        await viewKept(r);
        if (live) setGot((n) => n + 1);
      }
    };
    Promise.all(Array.from({ length: Math.min(FLIGHT, left.length) }, next)).catch((e) => {
      if (live) setError(e);
    });
    return () => {
      live = false;
    };
  }, [key, tick]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: n counts reads landed; the cache is outside React
  const have = useMemo(
    () => runs.map((r) => views.get(r)).filter((v): v is RunView => !!v),
    [key, n],
  );
  return {
    views: have.length === runs.length ? have : null,
    got: have.length,
    error,
    retry: () => setTick((t) => t + 1),
  };
}

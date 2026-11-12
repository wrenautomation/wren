/**
 * A page and the side chat share state outside the page's tree: the weaver runs each draws, and
 * the chat's finished tool calls. What is in view: `@wren/ui` page-seen.ts; a hand-off:
 * agent-hand.tsx. One store, no provider: the panel may be unmounted when the page speaks.
 */
import type { AgentMessage } from "@wren/ui";
import { useEffect, useSyncExternalStore } from "react";

const subs = new Set<() => void>();
const tell = () => {
  for (const f of subs) f();
};
const sub = (f: () => void) => {
  subs.add(f);
  return () => {
    subs.delete(f);
  };
};

let pageRuns: readonly string[] = [];

/** The weaver runs the page draws on its graph, while mounted: a chat card of one of them skips its own graph (WA-1292). */
export function usePageRuns(runs: readonly string[] | undefined): void {
  const key = runs?.join(",") ?? "";
  useEffect(() => {
    const mine = key ? key.split(",") : [];
    pageRuns = mine;
    tell();
    return () => {
      if (pageRuns !== mine) return;
      pageRuns = [];
      tell();
    };
  }, [key]);
}

export const usePageRunsShown = (): readonly string[] =>
  useSyncExternalStore(
    sub,
    () => pageRuns,
    () => pageRuns,
  );

let chatRuns: readonly string[] = [];

/** The weaver runs the open chat's cards name, in order: Research › Live draws them. */
export function setChatRuns(runs: readonly string[]): void {
  if (runs.length === chatRuns.length && runs.every((r, i) => r === chatRuns[i])) return;
  chatRuns = runs;
  tell();
}

export const useChatRuns = (): readonly string[] =>
  useSyncExternalStore(
    sub,
    () => chatRuns,
    () => chatRuns,
  );

let toolsDone = 0;

/** How many tool calls of the open chat have a result: a page that shows what the chat writes reads again on each. */
export function setChatToolsDone(count: number): void {
  if (count === toolsDone) return;
  toolsDone = count;
  tell();
}

export const useChatToolsDone = (): number =>
  useSyncExternalStore(
    sub,
    () => toolsDone,
    () => toolsDone,
  );

/** Tool calls with a result, over a thread. */
export const toolsDoneIn = (messages: readonly AgentMessage[]): number =>
  messages.reduce(
    (sum, m) => sum + m.parts.filter((p) => p.type === "tool" && p.result !== undefined).length,
    0,
  );

/** Runs named by a thread's `research.run` view parts, first seen first. */
export function runsNamed(messages: readonly AgentMessage[]): string[] {
  const out = new Set<string>();
  for (const m of messages)
    for (const p of m.parts) {
      const run =
        p.type === "view" && p.name === "research.run" && (p.data as { run?: unknown })?.run;
      if (typeof run === "string" && run) out.add(run);
    }
  return [...out];
}

/** How long a place's row keeps the agent's mark after a change lands (designs/2026-11-11-agent-panel.md). */
const MARK_MS = 5000;
let changed: ReadonlySet<string> = new Set();
const until = new Map<string, number>();

/** Record types the chat just changed: the sidebar marks each place that lists one, for 5 s. */
export function markChanged(records: readonly string[], now = Date.now()): void {
  if (!records.length) return;
  for (const r of records) until.set(r, now + MARK_MS);
  changed = new Set(until.keys());
  tell();
  setTimeout(() => {
    const t = Date.now();
    for (const [r, end] of until) if (end <= t) until.delete(r);
    if (until.size === changed.size) return;
    changed = new Set(until.keys());
    tell();
  }, MARK_MS + 50);
}

export const useChangedRecords = (): ReadonlySet<string> =>
  useSyncExternalStore(
    sub,
    () => changed,
    () => changed,
  );

/**
 * A page drives the side chat (designs/2026-11-05-variants.md, option A). Two things cross from a
 * page to the panel, which sits outside the page's tree: a line of context for each turn (what is
 * in view), and a hand-off (a turn the page sends for the person, to one setup). One store, no
 * provider: the panel may be unmounted when the page speaks.
 */
import type { AgentMessage } from "@wren/ui";
import { useEffect, useSyncExternalStore } from "react";

export interface Hand {
  id: number;
  /** Setup name: the chat that takes the turn. */
  setup: string;
  text: string;
}

let hand: Hand | null = null;
let context: string | undefined;
let n = 0;
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

/** Open the chat on `setup` and send `text` as the person's turn. A second hand-off replaces one not yet taken. */
export function handToChat(setup: string, text: string): void {
  hand = { id: ++n, setup, text };
  tell();
}

/** The chat took the turn (or no such setup exists): the hand-off is spent. */
export function takeHand(id: number): void {
  if (hand?.id !== id) return;
  hand = null;
  tell();
}

export const useHand = (): Hand | null =>
  useSyncExternalStore(
    sub,
    () => hand,
    () => null,
  );

/** What the page has in view, added to each turn's `[Page: …]` line while the page is mounted. */
export function usePageContext(text: string | undefined): void {
  useEffect(() => {
    context = text;
    tell();
    return () => {
      if (context !== text) return;
      context = undefined;
      tell();
    };
  }, [text]);
}

export const usePageContextText = (): string | undefined =>
  useSyncExternalStore(
    sub,
    () => context,
    () => undefined,
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

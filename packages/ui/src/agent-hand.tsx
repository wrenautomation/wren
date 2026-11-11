/**
 * A page hands the side chat a turn (designs/2026-11-05-variants.md, option A). One store, no
 * provider: the panel sits outside the page's tree and may be unmounted when the page speaks.
 * `AskAgent`: an empty state's one action (ui-design SV-8) where the agent fills the list.
 */
import { useSyncExternalStore } from "react";
import { Button } from "./controls.js";

export interface Hand {
  id: number;
  /** Setup name: the chat that takes the turn. None: the chat open now. */
  setup?: string | undefined;
  text: string;
  /** Typed into the box, not sent: the person reads it, edits it and sends. */
  draft?: boolean | undefined;
}

let hand: Hand | null = null;
// the shell says whether a chat is there to take a hand
let here = false;
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

/** Open the chat and hand it `text`: sent as the person's turn, or typed only (`draft`). A second hand-off replaces one not yet taken. */
export function handToChat(
  setup: string | undefined,
  text: string,
  { draft }: { draft?: boolean } = {},
): void {
  hand = { id: ++n, setup, text, draft };
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

/** The shell: a chat panel can take a hand here (the portal's team views). */
export function setChatHere(on: boolean): void {
  if (here === on) return;
  here = on;
  tell();
}

/** Whether a chat can take a hand here: an empty state with no other action waits when none can. */
export const useChatHere = (): boolean =>
  useSyncExternalStore(
    sub,
    () => here,
    () => false,
  );

/** An empty state's action where the agent fills it: opens the chat with `ask` typed, not sent. None without a chat. */
export function AskAgent({
  ask,
  setup,
  children = "Ask the agent",
}: {
  ask: string;
  /** The chat that takes it (`vireo`, `weaver`); none: the chat open now. */
  setup?: string | undefined;
  children?: string;
}) {
  if (!useChatHere()) return null;
  return (
    <Button size="sm" icon="sparkle" onClick={() => handToChat(setup, ask, { draft: true })}>
      {children}
    </Button>
  );
}

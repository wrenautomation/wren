/**
 * What ⌘K offers about where you are: the open page says it (`useScope`), the shell's palette
 * reads it (`useScoped`). Kept apart from `./palette.tsx` so pages never load cmdk.
 */
import { useEffect, useSyncExternalStore } from "react";
import type { IconName } from "./icons.js";

/** One thing ⌘K can do here: export this view, run an action on the open record. */
export interface ScopeItem {
  label: string;
  /** Its heading: "This view", or the record type's name. */
  group: string;
  run: () => void;
  icon?: IconName | undefined;
  hint?: string | undefined;
}
export interface Scope {
  items: ScopeItem[];
  /** "Search people for …": what typed text searches, if this page searches. */
  search?: { label: string; run: (q: string) => void } | undefined;
}

const EMPTY: Scope = { items: [] };
let current: Scope = EMPTY;
const subs = new Set<() => void>();
const set = (s: Scope) => {
  current = s;
  for (const f of subs) f();
};

/** This page's scope while it's mounted; `key` names everything `scope` reads. */
export function useScope(key: string, scope: () => Scope) {
  // biome-ignore lint/correctness/useExhaustiveDependencies: `key` names what `scope` reads.
  useEffect(() => {
    const mine = scope();
    set(mine);
    return () => {
      if (current === mine) set(EMPTY);
    };
  }, [key]);
}

export const useScoped = (): Scope =>
  useSyncExternalStore(
    (f) => {
      subs.add(f);
      return () => subs.delete(f);
    },
    () => current,
  );

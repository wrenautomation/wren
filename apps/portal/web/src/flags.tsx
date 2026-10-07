/**
 * Feature flags for this login here, as `delivery/me` evaluated them (`@wren/core/flags`). The
 * app shares them once they change; any component reads one with `useFlag`.
 */
import { useEffect, useSyncExternalStore } from "react";

let current: Readonly<Record<string, string>> = {};
let shared = "{}";
const listeners = new Set<() => void>();
const subscribe = (fn: () => void) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};

/** The app's side: this login's flags in the open workspace. */
export function useShareFlags(flags: Readonly<Record<string, string>>): void {
  const text = JSON.stringify(flags);
  useEffect(() => {
    if (text === shared) return;
    shared = text;
    current = JSON.parse(text) as Record<string, string>;
    for (const fn of listeners) fn();
  }, [text]);
}

/** A flag's variant here: `off` for a flag that doesn't exist, so on/off reads `!== "off"`. */
export function useFlag(key: string): string {
  return useSyncExternalStore(subscribe, () => current[key] ?? "off");
}

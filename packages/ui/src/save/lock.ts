/**
 * One writer per key: saves for a key run one at a time, across tabs where the browser has Web
 * Locks, and within this tab always (a chain per key).
 */
import type { Locks } from "./env.js";

const chains = new Map<string, Promise<unknown>>();

/** Run `fn` holding `name`: after every earlier holder in this tab, and alone across tabs. */
export function withLock<R>(locks: Locks | null, name: string, fn: () => Promise<R>): Promise<R> {
  const before = chains.get(name) ?? Promise.resolve();
  const held = locks ? () => locks.request(`wren.save:${name}`, fn) : fn;
  const mine = before.then(held, held);
  const tail = mine.then(
    () => undefined,
    () => undefined,
  );
  chains.set(name, tail);
  // The chain forgets a key once its last holder is done.
  void tail.then(() => {
    if (chains.get(name) === tail) chains.delete(name);
  });
  return mine;
}

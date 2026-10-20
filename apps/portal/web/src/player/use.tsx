import { createContext, type ReactNode, useContext, useSyncExternalStore } from "react";
import { player } from "./instance.js";
import type { PlayerState, PlayerStore } from "./store.js";

const Ctx = createContext<PlayerStore>(player);

/** A different store for a subtree: a test or a story that must not share the portal's player. */
export const PlayerProvider = ({
  store,
  children,
}: {
  store: PlayerStore;
  children: ReactNode;
}) => <Ctx.Provider value={store}>{children}</Ctx.Provider>;

/** The player's commands: play, seek, dock, expand, close. */
export const usePlayerStore = (): PlayerStore => useContext(Ctx);

/**
 * One slice of the player's state. `select` must return a primitive or a value that keeps its
 * identity (`s.item`, `s.time`), so a part that reads the id does not redraw on every tick.
 */
export function usePlayer<T>(select: (s: PlayerState) => T): T {
  const store = useContext(Ctx);
  return useSyncExternalStore(
    store.subscribe,
    () => select(store.getState()),
    () => select(store.getState()),
  );
}

/**
 * The mini player's state (designs: bead wa-0m4). One item plays at a time, in one place: the
 * `PlayerHost` in the app shell. A page that wants an item on show draws a `PlayerSlot`; the
 * host lays the player over the slot's box, and docks it bottom-right when the slot goes.
 *
 * A tiny module store, no library: React reads it through `useSyncExternalStore`
 * (`./use.tsx`). It knows no DOM beyond holding the slot's element, so a test drives it with
 * plain objects. The host reports time, the page and the transcript seek, and `go` (given at
 * creation) carries Expand back to the item's page.
 */

/** What plays: a YouTube video, another site's own embed, or a file through our origin. */
export type PlayerKind = "youtube" | "embed" | "media";

export interface PlayerItem {
  /** Stable for the thing, not the visit: `learn:12`, `video:34:cut.mp4`. The same id is the same player. */
  id: string;
  kind: PlayerKind;
  /** youtube: the video id. embed: the iframe address. media: the file's address. */
  src: string;
  title: string;
  /** For `media`: a picture or sound alone. Sound has no box to show. */
  media?: "video" | "audio";
  /** Seconds to start at. Read once, when the item first plays. */
  startAt?: number;
  /** Width over height of the picture. Default 16:9; an embed 9:16; sound none. */
  ratio?: number;
  /** The item's own page, which Expand opens. */
  back: string;
  /**
   * Called for every time the player reports, whichever page is open: this is where a page keeps
   * "where you stopped". It outlives the page's slot.
   */
  onTime?: (t: number, duration: number | null, playing: boolean) => void;
}

/** `none`: nothing loaded. `full`: over a page's slot. `mini`: docked bottom-right. `pip`: in a Picture-in-Picture window. */
export type PlayerMode = "none" | "full" | "mini" | "pip";

export interface PlayerState {
  item: PlayerItem | null;
  mode: PlayerMode;
  /** The slot's element while a page holds one for this item. */
  slot: Element | null;
  /** Docked by hand: mini even though a slot is on screen. */
  docked: boolean;
  pip: boolean;
  /** Where the player is now, seconds. Starts at `startAt`. */
  time: number;
  duration: number | null;
  playing: boolean;
  /** The player has reported at least once. */
  heard: boolean;
}

/** What the host's element does when told: the store never touches an iframe or a video. */
export interface Driver {
  seek: (t: number) => void;
}

export interface PlayerStore {
  getState: () => PlayerState;
  subscribe: (fn: () => void) => () => void;
  /**
   * Plays `item`. The same id keeps playing (its place, its element); a new one replaces what
   * played, after handing the old one its last time. `anchor`: the slot's element, so it plays
   * in full there.
   */
  play: (item: PlayerItem, opts?: { anchor?: Element | null }) => void;
  /** The slot for the playing item is gone: dock it. Ignored unless `anchor` is the current slot. */
  release: (anchor: Element) => void;
  /** Move the playing item to `t` seconds and play. Held until the player is there if it is not yet. */
  seek: (t: number) => void;
  /** Dock by hand, on the page of the item. */
  dock: () => void;
  /** Back to full: over its slot, or by opening the item's page. */
  expand: () => void;
  /** Stop and put the player away. */
  close: () => void;
  /** Picture-in-Picture opened (true) or closed (false). */
  setPip: (on: boolean) => void;
  /** The host's element reports. */
  report: (t: number, duration: number | null, playing: boolean) => void;
  /** The host's element is ready to be told. Returns the way to detach it. */
  attach: (driver: Driver) => () => void;
}

const IDLE: PlayerState = {
  item: null,
  mode: "none",
  slot: null,
  docked: false,
  pip: false,
  time: 0,
  duration: null,
  playing: false,
  heard: false,
};

/** Where the player shows, from what holds it. */
const modeOf = (s: Pick<PlayerState, "item" | "slot" | "docked" | "pip">): PlayerMode =>
  !s.item ? "none" : s.pip ? "pip" : s.slot && !s.docked ? "full" : "mini";

export function createPlayerStore({ go }: { go: (to: string) => void }): PlayerStore {
  let state = IDLE;
  let driver: Driver | null = null;
  let pending: number | null = null;
  const subs = new Set<() => void>();

  const set = (patch: Partial<PlayerState>) => {
    const next = { ...state, ...patch };
    next.mode = modeOf(next);
    state = next;
    for (const fn of [...subs]) fn();
  };

  /** The old item's last word: a page keeps where you stopped, paused. */
  const farewell = () => {
    const { item, time, duration } = state;
    if (item && state.heard) item.onTime?.(time, duration, false);
  };

  return {
    getState: () => state,
    subscribe: (fn) => {
      subs.add(fn);
      return () => void subs.delete(fn);
    },

    play(item, opts = {}) {
      const anchor = opts.anchor ?? null;
      const cur = state.item;
      if (cur && cur.id === item.id) {
        // Same thing: its element stays. A fresh file address only lands while it is paused.
        set({
          item: { ...item, src: state.playing ? cur.src : item.src },
          ...(anchor ? { slot: anchor, docked: false } : {}),
        });
        return;
      }
      farewell();
      pending = null;
      set({
        item,
        slot: anchor,
        docked: false,
        pip: false,
        time: item.startAt ?? 0,
        duration: null,
        playing: false,
        heard: false,
      });
    },

    release(anchor) {
      if (state.slot === anchor) set({ slot: null, docked: false });
    },

    seek(t) {
      if (!state.item) return;
      set({ time: t });
      if (driver) driver.seek(t);
      else pending = t;
    },

    dock() {
      if (state.item) set({ docked: true });
    },

    expand() {
      const { item, slot } = state;
      if (!item) return;
      set({ docked: false, pip: false });
      // Not on the item's page: open it. Its slot claims the player there.
      if (!slot) go(item.back);
    },

    close() {
      farewell();
      pending = null;
      set(IDLE);
    },

    setPip(on) {
      if (state.item && state.pip !== on) set({ pip: on });
    },

    report(t, duration, playing) {
      const { item } = state;
      if (!item) return;
      set({ time: t, duration: duration ?? state.duration, playing, heard: true });
      item.onTime?.(t, duration, playing);
    },

    attach(d) {
      driver = d;
      if (pending !== null) {
        d.seek(pending);
        pending = null;
      }
      return () => {
        if (driver === d) driver = null;
      };
    },
  };
}

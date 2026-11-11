/**
 * Live topics (designs/2026-11-08-live-topics.md): one socket per tab to its site's `LiveRoom`
 * (`/api/live/topics`). A writer's commit sends `{type:"changed", topics}`; each listener on a
 * topic reads again (`useCall(key, fn, {live})`). Back after a drop, every listener reads once:
 * what changed while it was down is unknown. The loop is shared (./live-socket.ts).
 */
import { type LiveSocket, type LiveSocketEnv, startLive } from "./live-socket.js";

export const TOPICS_LIVE_PATH = "/api/live/topics";
export const TOPICS_PROTOCOL = "wren-topics";

const listeners = new Map<string, Set<() => void>>();
/** Hears every topic: the shell's counts (./pulse.ts). */
export const ANY_TOPIC = "*";

/** Hear `topic` change (`ANY_TOPIC`: every one); returns the unsubscribe. */
export function onTopic(topic: string, fn: () => void): () => void {
  const set = listeners.get(topic) ?? new Set<() => void>();
  listeners.set(topic, set);
  set.add(fn);
  return () => {
    set.delete(fn);
    if (!set.size) listeners.delete(topic);
  };
}

/** Call each listener of these topics; all of them for null. */
export function told(topics: readonly string[] | null) {
  const fns = new Set<() => void>();
  for (const [t, set] of listeners)
    if (!topics || t === ANY_TOPIC || topics.includes(t)) for (const fn of set) fns.add(fn);
  for (const fn of fns) fn();
}

/** One frame's topics, or null when it isn't one. */
export function topicsOf(raw: unknown): string[] | null {
  if (typeof raw !== "string") return null;
  try {
    const m = JSON.parse(raw) as { type?: unknown; topics?: unknown };
    if (m?.type !== "changed" || !Array.isArray(m.topics)) return null;
    return m.topics.filter((t): t is string => typeof t === "string");
  } catch {
    return null;
  }
}

/** Frame and open handlers: a reopen after a drop reads every listener once. */
export function topicHandlers() {
  let dropped = false;
  return {
    protocol: TOPICS_PROTOCOL,
    frame: (raw: unknown) => {
      const topics = topicsOf(raw);
      if (topics?.length) told(topics);
    },
    up: (open: boolean) => {
      if (open && dropped) told(null);
      if (!open) dropped = true;
    },
  };
}

/** The tab's topic socket. */
export const startTopicSocket = (
  cfg: Omit<LiveSocketEnv, "open" | "url" | "protocol" | "frame" | "up">,
): LiveSocket | null => startLive({ ...cfg, ...topicHandlers() }, TOPICS_LIVE_PATH);

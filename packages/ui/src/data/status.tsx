/**
 * The two pieces every page shows of the write path (designs/2026-10-15-one-write-path.md):
 * `SendStatus`, the line under a box that sent something (going, trying again and why, sent,
 * refused and why), and `WritesIndicator`, the shell's mark for offline and for writes not yet
 * answered. Both read `WRITES` and the data layer, so a remount, a hidden tab or a reload shows
 * the same.
 */
import { onlineManager } from "@tanstack/react-query";
import { useSyncExternalStore } from "react";
import { WRITES, type Write, type Writes } from "../save/writes.js";

export type SendLine = { tone: "info" | "bad"; text: string } | null;

/** A reason as a sentence: it ends in a stop. */
const sentence = (t: string) => (/[.!?]$/.test(t.trim()) ? t.trim() : `${t.trim()}.`);

/**
 * What the line under a send box says of its last send. `done` is what a landed send says
 * ("Sent."); null says nothing (the box says its own).
 */
export function sendLineOf(w: Write | null, done: string | null = "Sent."): SendLine {
  if (!w) return null;
  switch (w.status) {
    case "held":
      return { tone: "info", text: "Going in a moment. Undo while you can." };
    case "unsure":
      return {
        tone: "info",
        text: `Not sure it went yet: ${w.error ?? "no answer"}. It goes again, once, when you're back online.`,
      };
    case "sending":
      if (w.retry)
        return {
          tone: "info",
          text: `Trying again (${w.retry.count}): ${sentence(w.retry.reason)} It keeps trying even if you leave this page.`,
        };
      return w.accepted
        ? { tone: "info", text: "On its way. It sends even if you leave this page." }
        : null;
    case "failed":
      return { tone: "bad", text: `Not sent: ${w.error ?? "it failed."}` };
    case "sent":
      return done ? { tone: "info", text: done } : null;
  }
}

/** The line under a send box, from its last send (`useLastWrite`). */
export function SendStatus({
  write,
  done,
  className,
}: {
  write: Write | null;
  done?: string | null;
  className?: string;
}) {
  const line = sendLineOf(write, done);
  if (!line) return null;
  return (
    <p
      role={line.tone === "bad" ? "alert" : "status"}
      data-send-status={write?.status}
      className={`text-[13px] ${line.tone === "bad" ? "text-(--ui-bad)" : "text-(--ui-ink-2)"} ${className ?? ""}`}
    >
      {line.text}
    </p>
  );
}

const subscribeOnline = (fn: () => void) => onlineManager.subscribe(fn);
const isOnline = () => onlineManager.isOnline();

/** Online, and how many writes wait for an answer. */
export function useWritesState(writes: Writes = WRITES): { online: boolean; pending: number } {
  const online = useSyncExternalStore(subscribeOnline, isOnline, () => true);
  useSyncExternalStore(writes.subscribe, writes.snapshot, writes.snapshot);
  return { online, pending: writes.pending };
}

/** What the shell's mark says, or null when there's nothing to say. */
export function indicatorOf(online: boolean, pending: number): string | null {
  const waiting = pending === 1 ? "1 change waits" : `${pending} changes wait`;
  if (!online)
    return pending
      ? `Offline. ${waiting}; they go when you're back.`
      : "Offline. Showing what's on this device.";
  return pending ? `Saving: ${waiting} for an answer.` : null;
}

/** The shell's mark: offline, and writes not yet answered. Nothing when all is in. */
export function WritesIndicator({ className }: { className?: string }) {
  const { online, pending } = useWritesState();
  const text = indicatorOf(online, pending);
  if (!text) return null;
  return (
    <span
      role="status"
      aria-live="polite"
      data-writes-indicator={online ? "pending" : "offline"}
      className={`inline-flex items-center gap-1.5 text-[12px] text-(--ui-ink-2) ${className ?? ""}`}
    >
      <span
        aria-hidden
        className={`size-1.5 rounded-full ${online ? "bg-(--ui-ink-3)" : "bg-(--ui-bad)"}`}
      />
      {text}
    </span>
  );
}

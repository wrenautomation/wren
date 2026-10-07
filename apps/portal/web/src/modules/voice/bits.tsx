/** What the Voice app's pages share: the "In development" note, tool chips and a turn's timing bar. */

import { InDevelopment as Kit } from "@wren/ui";
import { type Line, STAGES, type Stage, type Turn } from "@wren/voice";
import type { ReactNode } from "react";

export const QUIET = "text-(--ui-ink-2)";
export const SMALL = "text-[13px] text-(--ui-ink-2)";

/** The scaffold's note: what's built, and what waits on setup. */
export function InDevelopment({ children }: { children: ReactNode }) {
  return <Kit className="mb-8">{children}</Kit>;
}

export const TOOL_LABEL: Record<string, string> = {
  lookUpLead: "Looked up the caller",
  offerTimes: "Found open times",
  book: "Booked",
  transfer: "Put through",
  takeMessage: "Took a message",
  endCall: "Ended the call",
  error: "Something broke",
};

/** A tool line's text without the ISO times the brain reads. */
export const toolText = (text: string) =>
  text.replace(/\s*\(\d{4}-\d\d-\d\dT[^)]*\)/g, "").replace(/;\s*/g, ", ");

/** A tool line in a transcript: what it did, then what it said back. */
export function ToolLine({ tool, text }: { tool: string; text: string }) {
  return (
    <li className="flex min-w-0 items-baseline justify-center gap-2 py-1 text-[12.5px] text-(--ui-ink-2)">
      <span className="inline-flex shrink-0 items-center gap-1.5 font-medium text-(--ui-ink)">
        <span aria-hidden className="size-1.5 rounded-full bg-(--ui-accent)" />
        {TOOL_LABEL[tool] ?? tool}
      </span>
      <span className="min-w-0 truncate" title={toolText(text)}>
        {toolText(text)}
      </span>
    </li>
  );
}

/** A chat line: the caller on the right, the agent on the left. */
export function Bubble({
  who,
  live,
  children,
}: {
  who: "caller" | "agent";
  live?: boolean;
  children: ReactNode;
}) {
  const caller = who === "caller";
  return (
    <li className={caller ? "flex justify-end" : "flex justify-start"}>
      <span
        className={[
          "max-w-[min(34rem,85%)] rounded-(--ui-radius) px-3.5 py-2 text-[14.5px]/[1.5] text-pretty whitespace-pre-wrap break-words",
          caller
            ? "bg-(--ui-ink) text-(--ui-on-ink)"
            : "bg-(--ui-paper) shadow-[inset_0_0_0_1px_var(--ui-hair)]",
          live ? "opacity-70" : "",
        ].join(" ")}
      >
        <span className="sr-only">{caller ? "Caller: " : "Agent: "}</span>
        {children}
      </span>
    </li>
  );
}

/** A transcript's lines as chat bubbles and tool chips, inside an `<ol>`. */
export function Lines({ lines }: { lines: readonly Line[] }) {
  return (
    <>
      {lines.map((x, i) =>
        x.who === "tool" ? (
          // biome-ignore lint/suspicious/noArrayIndexKey: a transcript only grows; its lines never reorder.
          <ToolLine key={i} tool={x.tool ?? "tool"} text={x.text} />
        ) : (
          // biome-ignore lint/suspicious/noArrayIndexKey: a transcript only grows; its lines never reorder.
          <Bubble key={i} who={x.who}>
            {x.text}
          </Bubble>
        ),
      )}
    </>
  );
}

const ms = (n: number | null) => (n === null ? "none" : `${Math.round(n)} ms`);

/**
 * One turn on a time line from the moment the caller stopped talking: the pause until the turn
 * was over, then our wait until the caller heard us. Ticks mark the first token and first audio.
 * `scale` is the widest turn's ms, so turns line up.
 */
export function TurnBar({ turn, scale }: { turn: Turn; scale: number }) {
  const m = turn.ms;
  const at = (n: number | null) =>
    n === null ? null : `${Math.min(100, (Math.max(0, n) / scale) * 100)}%`;
  const end = m.end ?? 0;
  const heard = m.heard ?? m.audio ?? end;
  const label = `Turn ${turn.n}: ${(Object.keys(STAGES) as Stage[]).map((k) => `${STAGES[k]} ${ms(m[k])}`).join(", ")}`;
  return (
    <div
      className="relative h-2.5 w-full rounded-full bg-(--ui-tile)"
      role="img"
      aria-label={label}
      title={label}
    >
      <span
        className="absolute inset-y-0 left-0 rounded-l-full bg-(--ui-hair)"
        style={{ width: at(end) ?? "0%" }}
      />
      <span
        className="absolute inset-y-0 rounded-r-full bg-(--ui-accent)"
        style={{ left: at(end) ?? "0%", width: `calc(${at(heard) ?? "0%"} - ${at(end) ?? "0%"})` }}
      />
      {(["token", "audio"] as const).map((k) =>
        m[k] === null ? null : (
          <span
            key={k}
            className="absolute -inset-y-1 w-px bg-(--ui-ink)"
            style={{ left: at(m[k]) ?? "0%" }}
          />
        ),
      )}
    </div>
  );
}

/** The bars' key. */
export function TurnKey() {
  return (
    <p className={`flex flex-wrap gap-x-5 gap-y-1 ${SMALL}`}>
      <span className="inline-flex items-center gap-1.5">
        <span aria-hidden className="h-2 w-4 rounded-full bg-(--ui-hair)" /> Pause until the turn
        ends
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span aria-hidden className="h-2 w-4 rounded-full bg-(--ui-accent)" /> Our wait until they
        hear us
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span aria-hidden className="h-3 w-px bg-(--ui-ink)" /> First token, first audio
      </span>
    </p>
  );
}

/** Turns with their bars and the numbers that matter: when the caller heard us. */
export function TurnTimes({ turns }: { turns: readonly Turn[] }) {
  const answered = turns.filter((t) => t.n > 0);
  if (!answered.length) return <p className={QUIET}>No turns yet.</p>;
  const scale = Math.max(400, ...answered.map((t) => t.ms.heard ?? t.ms.audio ?? t.ms.end ?? 0));
  return (
    <div className="grid gap-4">
      <ol className="grid gap-3.5">
        {answered.map((t) => (
          <li key={t.n} className="grid gap-1.5">
            <span className="flex min-w-0 items-baseline justify-between gap-3 text-[13.5px]">
              <span className="min-w-0 truncate">
                <span className={QUIET}>{t.n}.</span> {t.caller || "(silence)"}
              </span>
              <span className="flex shrink-0 items-baseline gap-2 tabular-nums">
                {t.speculative ? <span className={SMALL}>Started early</span> : null}
                {t.barged ? <span className={SMALL}>Cut off</span> : null}
                <span className="font-medium">{ms(t.ms.heard)}</span>
              </span>
            </span>
            <TurnBar turn={t} scale={scale} />
          </li>
        ))}
      </ol>
      <TurnKey />
    </div>
  );
}

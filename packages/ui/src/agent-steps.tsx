/**
 * A reply's steps as they come (designs/2026-11-04-multi-user-runtime.md, Decision 10): plain
 * shell commands fold into one "Ran N commands" block with a terminal inside; every other call is
 * its own row, appended in order, its result on the right. The turn's line sits at the foot:
 * the live step and the time, then "Done" with what it cost.
 */
import { type ToolCallMessagePartComponent, useAuiState } from "@assistant-ui/react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { Ring } from "./busy.js";
import { Button } from "./controls.js";
import { cx } from "./format.js";
import { Icon } from "./icons.js";
import { EASE } from "./motion.js";

type Args = Record<string, unknown>;

/** The one line that says what a call does: Bash's command, Read's file, Skill's name. */
export function toolLine(name: string, input: Args): string {
  const s = (k: string) => (typeof input[k] === "string" ? (input[k] as string) : "");
  if (name === "Bash") return s("command");
  if (name === "Read") return s("file_path");
  if (name === "Skill") return s("skill");
  return Object.values(input)
    .filter((v) => typeof v === "string")
    .join(" · ");
}

/** A call's name for a person: its description, else what it does in a few words. */
export function toolTitle(name: string, input: Args): string {
  if (typeof input.description === "string" && input.description) return input.description;
  const line = toolLine(name, input);
  if (name === "Read") return `Read ${line.split("/").pop() || "a file"}`;
  if (name === "Skill") return `Load the ${line || "a"} skill`;
  if (name === "Bash") return "Run a command";
  return name;
}

const NAMED = /^\s*birdwatch\b/;
/** A plain shell command: it folds into the commands block. birdwatch's verbs are named steps. */
export const isCommand = (name: string, input: Args): boolean =>
  name === "Bash" && typeof input.command === "string" && !NAMED.test(input.command);

const kb = (n: number) =>
  n < 1024
    ? `${n} B`
    : n < 1024 * 1024
      ? `${Math.round(n / 1024)} KB`
      : `${(n / 1048576).toFixed(1)} MB`;

/** A result in a few words: an exit code, a JSON count, lines, or the size. */
export function stat(out: string | undefined, failed?: boolean): string {
  if (out === undefined) return "";
  const t = out.trim();
  if (failed) {
    const code = /exit code (\d+)/i.exec(t)?.[1];
    return code ? `exit ${code}` : "failed";
  }
  if (!t) return "no output";
  if (t[0] === "{" || t[0] === "[")
    try {
      const j: unknown = JSON.parse(t);
      if (Array.isArray(j)) return `${j.length} ${j.length === 1 ? "item" : "items"}`;
      const bits: string[] = [];
      for (const [k, v] of Object.entries(j as Args)) {
        if (Array.isArray(v)) bits.push(`${v.length} ${k}`);
        else if (typeof v === "number") bits.push(`${v} ${k}`);
        if (bits.length === 2) break;
      }
      if (bits.length) return bits.join(" · ");
      // JSON with nothing to count: the check says enough
      return "";
    } catch {}
  const lines = t.split("\n").length;
  if (lines > 1) return `${lines} lines`;
  return t.length <= 28 ? t : kb(new TextEncoder().encode(t).length);
}

/** 0.4s, 3.1s, 12s, 1m 4s. */
export function took(ms: number): string {
  if (ms < 10_000) return `${(ms / 1000).toFixed(1)}s`;
  const s = Math.round(ms / 1000);
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
}

/** Milliseconds since `from` (else since it began), ticking while `on`. */
export function useElapsed(on: boolean, from: number): number {
  const start = useRef(from || Date.now());
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!on) return;
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [on]);
  return Math.max(0, now - (from || start.current));
}

/** Opens and closes on its height; reduced motion: at once. */
function Fold({ open, children }: { open: boolean; children: ReactNode }) {
  const still = useReducedMotion() ?? false;
  return (
    <AnimatePresence initial={false}>
      {open ? (
        <motion.div
          key="fold"
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: "auto", opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          transition={still ? { duration: 0 } : { duration: 0.26, ease: EASE }}
          className="overflow-hidden"
        >
          {children}
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}

type Part = ReturnType<typeof partsOf>[number];
const partsOf = (s: { message: { parts: readonly unknown[] } }) =>
  s.message.parts as readonly {
    type: string;
    toolCallId?: string;
    toolName?: string;
    args?: unknown;
    argsText?: string;
    result?: unknown;
    isError?: boolean;
    approval?: { approved?: boolean; resolution?: unknown };
    timing?: { startedAt: number; completedAt?: number };
  }[];
const argsOf = (x: Part): Args => (x.args ?? {}) as Args;
const asking = (x: Part) =>
  !!x.approval && x.approval.approved === undefined && !x.approval.resolution;
const inBlock = (x: Part | undefined): boolean =>
  // a command that asked stays its own row, with its answer
  !!x && x.type === "tool-call" && isCommand(x.toolName ?? "", argsOf(x)) && !x.approval;
const outOf = (x: Part) => (typeof x.result === "string" ? x.result : undefined);
const msOf = (x: Part) =>
  x.timing?.completedAt && x.timing.startedAt ? x.timing.completedAt - x.timing.startedAt : 0;

/**
 * Every tool call: the first of a run of plain commands draws the block for the run, the rest of
 * the run draw nothing; any other call is a row. A command that asks leaves the block to ask.
 */
export const ToolPart: ToolCallMessagePartComponent = (t) => {
  const parts = useAuiState(partsOf);
  const i = parts.findIndex((x) => x.type === "tool-call" && x.toolCallId === t.toolCallId);
  if (i < 0 || !inBlock(parts[i])) return <StepRow {...t} />;
  if (inBlock(parts[i - 1])) return null;
  let j = i;
  while (inBlock(parts[j + 1])) j++;
  return <Commands parts={parts.slice(i, j + 1)} />;
};

function Commands({ parts }: { parts: readonly Part[] }) {
  const [open, setOpen] = useState(false);
  const n = parts.length;
  const live = parts.some((x) => x.result === undefined);
  const bad = parts.filter((x) => x.isError).length;
  const ms = parts.reduce((a, x) => a + msOf(x), 0);
  const label = live
    ? `Running ${n === 1 ? "a command" : `${n} commands`}`
    : `Ran ${n === 1 ? "a command" : `${n} commands`}${bad ? `, ${bad} failed` : ""}`;
  return (
    <div className="ui-rise grid rounded-[12px] bg-(--ui-fill) shadow-[inset_0_0_0_1px_var(--ui-hair)]">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className="flex min-h-9 items-center gap-2 rounded-[12px] px-3 text-left text-[13px] text-(--ui-ink-2) transition-colors duration-150 hover:text-(--ui-ink)"
      >
        <Icon
          name="right"
          size={13}
          className={cx("flex-none transition-transform duration-200", open && "rotate-90")}
        />
        <Icon name="terminal" size={14} className="flex-none" />
        <span className="min-w-0 flex-1 font-medium">{label}</span>
        {live ? (
          <Ring />
        ) : ms ? (
          <span className="flex-none font-mono text-[11.5px] text-(--ui-ink-3) tabular-nums">
            {took(ms)}
          </span>
        ) : null}
      </button>
      <Fold open={open}>
        <div className="px-1.5 pb-1.5">
          <Terminal parts={parts} />
        </div>
      </Fold>
    </div>
  );
}

/** Dark block: `$`, the command, its result on the right; a line opens to its output. */
function Terminal({ parts }: { parts: readonly Part[] }) {
  const [shown, setShown] = useState<string | null>(null);
  return (
    <div className="grid rounded-[8px] bg-(--ui-term) shadow-[inset_0_0_0_1px_var(--ui-hair)] py-1.5 font-mono text-[12px]/[1.6] text-(--ui-term-ink)">
      {parts.map((x) => {
        const id = x.toolCallId ?? "";
        const done = x.result !== undefined;
        const out = outOf(x)?.trim() ?? "";
        const open = shown === id;
        return (
          <div key={id} className="grid [animation:ui-fade_.2s_both]">
            <button
              type="button"
              aria-expanded={done ? open : undefined}
              disabled={!done || !out}
              onClick={() => setShown(open ? null : id)}
              className="flex min-w-0 items-start gap-2 px-3 py-0.5 text-left enabled:hover:bg-[#ffffff0d]"
            >
              <span className="flex-none text-(--ui-term-prompt) select-none" aria-hidden="true">
                $
              </span>
              <span className="min-w-0 flex-1 whitespace-pre-wrap [overflow-wrap:anywhere]">
                {toolLine("Bash", argsOf(x)) || x.argsText}
                {done ? null : <span className="ui-term-caret" aria-hidden="true" />}
              </span>
              {done ? (
                <span
                  className={cx(
                    "flex-none tabular-nums",
                    x.isError ? "text-(--ui-term-bad)" : "text-(--ui-term-dim)",
                  )}
                >
                  {stat(outOf(x), x.isError)}
                </span>
              ) : null}
            </button>
            {open ? (
              <pre className="m-0 max-h-64 overflow-auto px-3 pt-0.5 pb-2 pl-7 whitespace-pre-wrap text-(--ui-term-dim) [overflow-wrap:anywhere] [animation:ui-fade_.15s_both]">
                {out}
              </pre>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

/** A named step: its state, its name, its result on the right; it opens to the call and output. */
const StepRow: ToolCallMessagePartComponent = (t) => {
  const input = (t.args ?? {}) as Args;
  const line = toolLine(t.toolName, input) || t.argsText;
  const ask = t.approval;
  const waits = !!ask && ask.approved === undefined && !ask.resolution;
  const done = t.result !== undefined;
  const out = done && typeof t.result === "string" ? t.result.trim() : "";
  const [mine, setMine] = useState(false);
  const open = waits || mine;
  const ms =
    t.timing?.completedAt && t.timing.startedAt ? t.timing.completedAt - t.timing.startedAt : 0;
  const right = ask?.approved === false ? "denied" : done ? stat(out, t.isError) : "";
  return (
    <div
      className={cx(
        "ui-rise grid rounded-[12px] transition-colors duration-200",
        waits && "bg-(--ui-warn-tint) px-3 py-2.5 shadow-[inset_0_0_0_1px_var(--ui-hair)]",
      )}
    >
      <button
        type="button"
        aria-expanded={open}
        disabled={waits}
        onClick={() => setMine(!mine)}
        className="group/row flex min-h-8 min-w-0 items-center gap-2.5 text-left text-[13.5px] text-(--ui-ink) disabled:cursor-default"
      >
        <span
          key={waits ? "ask" : t.isError ? "bad" : done ? "done" : "live"}
          className="grid size-4 flex-none place-items-center [animation:ui-fade_.2s_both]"
        >
          {waits ? (
            <Icon name="alert" size={15} className="text-(--ui-warn)" />
          ) : ask?.approved === false || t.isError ? (
            <Icon name="xCircle" size={15} className="text-(--ui-bad)" />
          ) : done ? (
            <Icon name="checkCircle" size={15} className="text-(--ui-good)" />
          ) : (
            <Ring />
          )}
        </span>
        <span className={cx("min-w-0 flex-1 wrap-anywhere", !done && !waits && "ui-shimmer")}>
          {toolTitle(t.toolName, input)}
        </span>
        {right ? (
          <span className="flex-none font-mono text-[11.5px] text-(--ui-ink-3) tabular-nums [animation:ui-fade_.2s_both]">
            {right}
            {ms ? ` · ${took(ms)}` : ""}
          </span>
        ) : null}
        {waits ? null : (
          <Icon
            name="right"
            size={12}
            className={cx(
              "flex-none text-(--ui-ink-3) opacity-0 transition-[opacity,rotate] duration-200 group-hover/row:opacity-100 group-focus-visible/row:opacity-100",
              open && "rotate-90 opacity-100",
            )}
          />
        )}
      </button>
      <Fold open={open}>
        <div className="grid gap-2 pt-1.5 pb-2 pl-6.5">
          <pre className="m-0 overflow-x-auto rounded-[8px] bg-(--ui-term) shadow-[inset_0_0_0_1px_var(--ui-hair)] px-3 py-2 font-mono text-[12px]/[1.6] whitespace-pre-wrap text-(--ui-term-ink) [overflow-wrap:anywhere]">
            {t.toolName === "Bash" ? (
              <>
                <span className="text-(--ui-term-prompt) select-none">$ </span>
                {line}
              </>
            ) : (
              <>
                <span className="text-(--ui-term-prompt) select-none">{`${t.toolName.toLowerCase()} `}</span>
                {line}
              </>
            )}
            {out ? <span className="mt-1.5 block text-(--ui-term-dim)">{out}</span> : null}
          </pre>
          {waits ? (
            <div className="grid gap-2">
              <span className="text-[13.5px] text-(--ui-ink-2)">
                Claude agent asks to run this{ask?.prompt ? `: ${ask.prompt.toLowerCase()}` : "."}
              </span>
              <div className="flex gap-2">
                <Button size="sm" onClick={() => void t.respondToApproval?.({ approved: true })}>
                  Allow once
                </Button>
                <Button
                  size="sm"
                  tone="secondary"
                  onClick={() => void t.respondToApproval?.({ approved: false })}
                >
                  Deny
                </Button>
              </div>
            </div>
          ) : done && !out ? (
            <span className="text-[12.5px] text-(--ui-ink-3)">No output.</span>
          ) : null}
        </div>
      </Fold>
    </div>
  );
};

/** What the turn does now, for its line: the live step, else thinking or writing. */
function nowOf(parts: readonly Part[]): string {
  const last = parts.at(-1);
  for (let k = parts.length - 1; k >= 0; k--) {
    const x = parts[k];
    if (x?.type === "tool-call" && x.result === undefined && x.approval?.approved !== false)
      return asking(x) ? "Waiting on you" : toolTitle(x.toolName ?? "", argsOf(x));
  }
  if (last?.type === "reasoning") return "Thinking";
  if (last?.type === "text") return "Writing";
  return "Working";
}

/** The turn's line while it runs: the ring, what it does now, the time since the turn began. */
export function Working() {
  const running = useAuiState((s) => s.message.status?.type === "running");
  const parts = useAuiState(partsOf);
  const from = useAuiState((s) => s.message.createdAt?.getTime() ?? 0);
  const ms = useElapsed(running, from);
  if (!running) return null;
  const now = nowOf(parts);
  return (
    <div
      role="status"
      className="flex min-h-7 items-center gap-2.5 text-[13.5px] [animation:ui-fade_.2s_.15s_both]"
    >
      <span className="grid size-4 flex-none place-items-center">
        <Ring />
      </span>
      <span key={now} className="ui-shimmer min-w-0 wrap-anywhere [animation:ui-fade_.2s_both]">
        {now}
      </span>
      <span className="flex-none font-mono text-[11.5px] text-(--ui-ink-3) tabular-nums">
        {ms < 60_000 ? `${Math.floor(ms / 1000)}s` : took(ms)}
      </span>
    </div>
  );
}

/** A done turn's time when no result line gave one (a stored chat): first start to last end. */
export function spanOf(parts: readonly Part[], from: number): number {
  let end = 0;
  for (const x of parts)
    if (x.timing?.completedAt && x.timing.completedAt > end) end = x.timing.completedAt;
  return from && end > from ? end - from : 0;
}
export { partsOf };

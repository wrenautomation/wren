/**
 * A reply's steps as they come (designs/2026-11-04-multi-user-runtime.md, Decisions 10, 12;
 * 2026-11-11-agent-panel.md, 6): a run of plain calls (shell, reads, edits, searches) folds into one
 * block, "Ran 3 commands, read 2 files", open: each its description, call and output. weaver's
 * verbs, helpers, asks and a lone non-shell call are rows, appended in order, their result on the right. The turn's line sits at the foot:
 * the live step and the time, then "Done" with what it cost.
 */
import { type ToolCallMessagePartComponent, useAuiState } from "@assistant-ui/react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { Ring } from "./busy.js";
import { Button } from "./controls.js";
import { cx } from "./format.js";
import { Icon, type IconName } from "./icons.js";
import { EASE } from "./motion.js";
import { useHeldLine } from "./steps.js";

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
  // plugin skills come as "plugin:skill"
  if (name === "Skill") return line ? `Load the ${line.split(":").at(-1)} skill` : "Load a skill";
  if (name === "Bash") return "Run a command";
  const file = (k: string) =>
    typeof input[k] === "string" ? (input[k] as string).split("/").pop() : "";
  if (name === "Grep" || name === "Glob")
    return typeof input.pattern === "string" ? `Search for ${input.pattern}` : "Search the files";
  if (name === "Edit" || name === "Write") return `Change ${file("file_path") || "a file"}`;
  if (name === "WebSearch")
    return typeof input.query === "string" ? `Search the web for ${input.query}` : "Search the web";
  if (name === "WebFetch") {
    try {
      return `Read ${new URL(String(input.url)).hostname}`;
    } catch {
      return "Read a page";
    }
  }
  return name;
}

/** A done step's mark: what kind of call it was, in gray. Chat UIs mark the end, not each step. */
const MARK: Record<string, IconName> = {
  Bash: "terminal",
  Read: "doc",
  Write: "write",
  Edit: "edit",
  Grep: "search",
  Glob: "search",
  WebSearch: "globe",
  WebFetch: "globe",
  Skill: "book",
  Agent: "bot",
  Task: "bot",
};
const markOf = (name: string): IconName =>
  MARK[name] ?? (name.startsWith("mcp__") ? "boxes" : "dot");

/** Tokens in a short form: 840, 12.4k, 1.2M. */
export const tokens = (n: number) =>
  n < 1000
    ? `${n}`
    : n < 1e6
      ? `${(n / 1000).toFixed(n < 1e4 ? 1 : 0)}k`
      : `${(n / 1e6).toFixed(1)}M`;

const NAMED = /^\s*weaver\b/;
/** A plain shell command: it folds into the commands block. weaver's verbs are named steps. */
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
export function Fold({ open, children }: { open: boolean; children: ReactNode }) {
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

/** A row that arrives while the turn runs grows from no height: the thread below slides, never jumps. */
function Grow({ className, children }: { className?: string; children: ReactNode }) {
  const live = useAuiState((s) => s.message.status?.type === "running");
  const still = useReducedMotion() ?? false;
  const [grow] = useState(live && !still);
  const [grown, setGrown] = useState(false);
  if (!grow) return <div className={cx("ui-rise", className)}>{children}</div>;
  return (
    <motion.div
      initial={{ height: 0, opacity: 0 }}
      animate={{ height: "auto", opacity: 1 }}
      transition={{
        height: { duration: 0.3, ease: EASE },
        opacity: { duration: 0.22, delay: 0.06 },
      }}
      onAnimationComplete={() => setGrown(true)}
      className={grown ? undefined : "overflow-hidden"}
    >
      <div className={className}>{children}</div>
    </motion.div>
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
const named = (x: Part) => x.toolName === "Bash" && NAMED.test(String(argsOf(x).command ?? ""));
const inBlock = (x: Part | undefined): boolean =>
  // a call that asked stays its own row, with its answer
  !!x &&
  x.type === "tool-call" &&
  !x.approval &&
  !named(x) &&
  // a helper's own tokens and tools stay on its row
  x.toolName !== "Agent" &&
  x.toolName !== "Task";
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
  const run = parts.slice(i, j + 1);
  // one call alone reads better as its titled row, unless it is a shell command
  if (run.length === 1 && !isCommand(t.toolName, (t.args ?? {}) as Args)) return <StepRow {...t} />;
  return <Commands parts={run} />;
};

/** Kinds of call in a block, as past-tense counts, in first-seen order. */
const KIND: Record<string, [string, string, string]> = {
  Bash: ["ran", "command", "commands"],
  Read: ["read", "file", "files"],
  Write: ["changed", "file", "files"],
  Edit: ["changed", "file", "files"],
  Grep: ["searched", "time", "times"],
  Glob: ["searched", "time", "times"],
  WebSearch: ["searched the web", "time", "times"],
  WebFetch: ["read", "page", "pages"],
  Skill: ["loaded", "skill", "skills"],
};
function blockLabel(names: readonly string[]): string {
  const n = new Map<string, number>();
  for (const name of names) {
    const [verb, one, many] = KIND[name] ?? ["took", "other step", "other steps"];
    const k = `${verb}|${one}|${many}`;
    n.set(k, (n.get(k) ?? 0) + 1);
  }
  const s = [...n].map(([k, c]) => {
    const [verb, one, many] = k.split("|");
    if (c === 1 && one === "time") return verb;
    return `${verb} ${c === 1 ? (one === "command" ? "a command" : `1 ${one}`) : `${c} ${many}`}`;
  });
  const line = s.length > 1 ? `${s.slice(0, -1).join(", ")} and ${s.at(-1)}` : (s[0] ?? "");
  return line.charAt(0).toUpperCase() + line.slice(1);
}

function Commands({ parts }: { parts: readonly Part[] }) {
  const [open, setOpen] = useState(false);
  const live = parts.find((x) => x.result === undefined);
  const bad = parts.filter((x) => x.isError).length;
  const ms = parts.reduce((a, x) => a + msOf(x), 0);
  const shell = parts.every((x) => x.toolName === "Bash");
  const n = parts.length;
  const label = live
    ? `Running ${n === 1 ? "a command" : `${n} ${shell ? "commands" : "steps"}`}`
    : `${blockLabel(parts.map((x) => x.toolName ?? ""))}${bad ? `, ${bad} failed` : ""}`;
  return (
    <Grow className="grid rounded-[12px] bg-(--ui-fill) shadow-[inset_0_0_0_1px_var(--ui-hair)]">
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
        <Icon
          name={shell ? "terminal" : "list"}
          size={14}
          className="flex-none text-(--ui-active)"
        />
        <span className={cx("min-w-0 flex-1 font-medium wrap-anywhere", live && "ui-shimmer")}>
          {label}
        </span>
        {live ? (
          <Ring />
        ) : ms ? (
          <span className="flex-none font-mono text-[11.5px] text-(--ui-ink-3) tabular-nums">
            {took(ms)}
          </span>
        ) : null}
      </button>
      <Fold open={open}>
        <div className="px-1.5 pb-2">
          <Terminal parts={parts} />
        </div>
      </Fold>
    </Grow>
  );
}

/**
 * The run of commands, as Claude's history shows it: each step its description, then one box
 * with the command and its output. Open block shows every output; no second click.
 */
function Terminal({ parts }: { parts: readonly Part[] }) {
  return (
    <ol className="m-0 grid list-none gap-3 p-0 pt-1">
      {parts.map((x) => {
        const id = x.toolCallId ?? "";
        const input = argsOf(x);
        const done = x.result !== undefined;
        const out = outOf(x)?.trim() ?? "";
        const ms = msOf(x);
        const name = x.toolName ?? "";
        const said =
          name === "Bash"
            ? typeof input.description === "string" && input.description
            : toolTitle(name, input);
        return (
          <li key={id} className="grid gap-1.5 [animation:ui-fade_.2s_both]">
            {said || done ? (
              <div className="flex min-w-0 items-baseline gap-2 px-1.5 text-[13px]">
                <span className="min-w-0 flex-1 wrap-anywhere text-(--ui-ink-2)">{said}</span>
                {done ? (
                  <span
                    className={cx(
                      "flex-none font-mono text-[11.5px] tabular-nums",
                      x.isError ? "text-(--ui-bad)" : "text-(--ui-ink-3)",
                    )}
                  >
                    {[stat(outOf(x), x.isError), ms ? took(ms) : ""].filter(Boolean).join(" · ")}
                  </span>
                ) : null}
              </div>
            ) : null}
            <div className="grid rounded-[8px] bg-(--ui-term) font-mono text-[12px]/[1.6] text-(--ui-term-ink) shadow-[inset_0_0_0_1px_var(--ui-hair)]">
              <div className="flex min-w-0 gap-2 px-3 py-1.5">
                <span className="flex-none text-(--ui-term-prompt) select-none" aria-hidden="true">
                  {name === "Bash" ? "$" : name.toLowerCase()}
                </span>
                <span className="min-w-0 flex-1 whitespace-pre-wrap [overflow-wrap:anywhere]">
                  {toolLine(name, input) || x.argsText}
                  {done ? null : <span className="ui-term-caret" aria-hidden="true" />}
                </span>
              </div>
              {done ? (
                <pre
                  className={cx(
                    "m-0 max-h-64 overflow-auto border-t border-[#ffffff14] px-3 py-1.5 whitespace-pre-wrap [overflow-wrap:anywhere]",
                    x.isError ? "text-(--ui-term-bad)" : "text-(--ui-term-dim)",
                  )}
                >
                  {out || "No output."}
                </pre>
              ) : null}
            </div>
          </li>
        );
      })}
    </ol>
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
  // one answer per ask: a second click throws in assistant-ui
  const [sent, setSent] = useState(false);
  const answer = (approved: boolean) => {
    if (sent) return;
    setSent(true);
    void t.respondToApproval?.({ approved });
  };
  const open = waits || mine;
  const ms =
    t.timing?.completedAt && t.timing.startedAt ? t.timing.completedAt - t.timing.startedAt : 0;
  const used = (t.artifact ?? {}) as { tokens?: number; uses?: number };
  const right =
    ask?.approved === false
      ? "denied"
      : done
        ? [
            used.tokens ? `${tokens(used.tokens)} tokens` : "",
            used.uses ? `${used.uses} ${used.uses === 1 ? "tool" : "tools"}` : "",
            (used.tokens && !t.isError) || t.toolName === "Skill" ? "" : stat(out, t.isError),
          ]
            .filter(Boolean)
            .join(" · ")
        : "";
  return (
    <Grow
      className={cx(
        "grid rounded-[12px] transition-colors duration-200",
        waits && "bg-(--ui-needs-tint) px-3 py-2.5 shadow-[inset_0_0_0_1px_var(--ui-hair)]",
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
            <Icon name="alert" size={15} className="text-(--ui-needs)" />
          ) : ask?.approved === false || t.isError ? (
            <Icon name="xCircle" size={15} className="text-(--ui-bad)" />
          ) : done ? (
            <Icon name={markOf(t.toolName)} size={14} className="text-(--ui-ink-3)" />
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
                <Button size="sm" disabled={sent} onClick={() => answer(true)}>
                  Allow once
                </Button>
                <Button size="sm" tone="secondary" disabled={sent} onClick={() => answer(false)}>
                  Deny
                </Button>
              </div>
            </div>
          ) : done && !out ? (
            <span className="text-[12.5px] text-(--ui-ink-3)">No output.</span>
          ) : null}
        </div>
      </Fold>
    </Grow>
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
  const d = last as { name?: string; data?: { state?: string } } | undefined;
  if (last?.type === "data" && d?.name === "compact" && d.data?.state === "live")
    return "Compacting context";
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
  // fast tool calls: each line holds a moment, no flicker
  const now = useHeldLine(nowOf(parts));
  if (!running) return null;
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

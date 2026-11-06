/**
 * What sits around the composer, as the terminal shows it: the picks (model, effort, mode), the
 * status line, the background tasks and the `/` menu (designs/2026-11-04-multi-user-runtime.md,
 * Decision 11).
 */
import { ComposerPrimitive, type TriggerAdapter, type TriggerMatcher } from "@assistant-ui/react";
import { cn } from "cn";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Fold, tokens, took, useElapsed } from "./agent-steps.js";
import { Popover, PopoverContent, PopoverTrigger } from "./components/ui/popover.js";
import { tipProps } from "./hint.js";
import { useHoverPop } from "./hover-pop.js";
import { Icon } from "./icons.js";

export interface PickOption {
  value: string;
  label: string;
  /** One line under the label. */
  hint?: string;
  /** Drops a guard (bypass): the chip and row read in the warn tone. */
  warn?: boolean;
}

/** One quiet chip in the composer's foot; its menu lists the options with a hint each. */
export function AgentPick({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: readonly PickOption[];
  onChange: (v: string) => void;
}) {
  const pop = useHoverPop();
  const on = options.find((o) => o.value === value);
  if (options.length < 2) return null;
  return (
    <Popover {...pop.root}>
      <PopoverTrigger
        {...pop.trigger}
        aria-label={`${label}: ${on?.label ?? value}`}
        className={cn(
          "inline-flex h-8 pointer-coarse:h-11 min-w-0 flex-none items-center gap-1 rounded-full border-0 bg-transparent px-2 text-[12.5px] text-(--ui-ink-2) transition-colors duration-150 hover:bg-(--ui-fill) hover:text-(--ui-ink) data-popup-open:bg-(--ui-wash) data-popup-open:text-(--ui-active)",
          on?.warn && "text-(--ui-warn-ink)",
        )}
      >
        {on?.warn ? <Icon name="warn" size={13} /> : null}
        <span className="whitespace-nowrap">{on?.label ?? value}</span>
        <Icon name="down" size={12} className="text-(--ui-ink-3)" />
      </PopoverTrigger>
      <PopoverContent
        align="start"
        side="top"
        aria-label={label}
        className="w-64 gap-0 overflow-hidden bg-(--ui-paper) p-0 text-(--ui-ink)"
      >
        <div className="px-3 pt-2.5 pb-1 text-[11.5px] text-(--ui-ink-3)">{label}</div>
        <div className="grid pb-1" role="listbox" aria-label={label}>
          {options.map((o) => (
            <button
              key={o.value}
              type="button"
              role="option"
              aria-selected={o.value === value}
              onClick={() => {
                pop.setOpen(false);
                if (o.value !== value) onChange(o.value);
              }}
              className="flex w-full cursor-pointer items-start gap-2 border-0 bg-transparent px-3 py-1.5 text-left hover:bg-(--ui-hover)"
            >
              <span className="grid min-w-0 flex-1">
                <span
                  className={cn("text-[13px]", o.warn ? "text-(--ui-warn-ink)" : "text-(--ui-ink)")}
                >
                  {o.label}
                </span>
                {o.hint ? <span className="text-[12px] text-(--ui-ink-3)">{o.hint}</span> : null}
              </span>
              {o.value === value ? (
                <Icon name="check" size={14} className="mt-0.5 text-(--ui-active)" />
              ) : null}
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}

export interface AgentStatusInfo {
  model?: string | undefined;
  effort?: string | undefined;
  /** Context in use and the window, in tokens. */
  context?: { used: number; max: number } | undefined;
  /** Auto-compact on, and the tokens it compacts at. */
  autoCompact?: boolean | undefined;
  compactAt?: number | undefined;
  /** Plan limits used, 0-100; absent on an API key. */
  fiveHour?: number | undefined;
  sevenDay?: number | undefined;
}

const k = (n: number) =>
  n >= 1_000_000
    ? `${+(n / 1_000_000).toFixed(1)}M`
    : n >= 1000
      ? `${Math.round(n / 1000)}k`
      : `${n}`;

/** 80% and up reads warn, 95% and up bad. */
const tone = (pct: number) =>
  pct >= 95 ? "text-(--ui-bad)" : pct >= 80 ? "text-(--ui-warn-ink)" : undefined;

/** The terminal's status line: model, effort, context used/window (%), 5h %, 7d %. The context
 * opens a menu to compact now and to turn auto-compact on or off, when the page gives them. */
export function AgentStatus({
  info,
  onCompact,
  onAutoCompact,
}: {
  info: AgentStatusInfo;
  /** Runs `/compact`. */
  onCompact?: (() => void) | undefined;
  onAutoCompact?: ((on: boolean) => void) | undefined;
}) {
  const parts: { key: string; text: string; cls?: string | undefined }[] = [];
  if (info.model) parts.push({ key: "model", text: info.model, cls: "text-(--ui-ink-2)" });
  if (info.effort) parts.push({ key: "effort", text: info.effort });
  if (info.context?.max) {
    const pct = Math.round((info.context.used / info.context.max) * 100);
    parts.push({
      key: "ctx",
      text: `${k(info.context.used)}/${k(info.context.max)} (${pct}%)`,
      cls: tone(pct),
    });
  }
  if (info.fiveHour !== undefined)
    parts.push({ key: "5h", text: `5h ${Math.round(info.fiveHour)}%`, cls: tone(info.fiveHour) });
  if (info.sevenDay !== undefined)
    parts.push({ key: "7d", text: `7d ${Math.round(info.sevenDay)}%`, cls: tone(info.sevenDay) });
  if (!parts.length) return null;
  const menu = !!(onCompact || onAutoCompact);
  return (
    // gaps, no dots: a wrapped line never starts on a separator
    <span className="inline-flex flex-wrap items-center justify-center gap-x-3 font-mono text-[11.5px] tabular-nums">
      {parts.map((p) =>
        p.key === "ctx" && menu ? (
          <ContextMenu
            key={p.key}
            text={p.text}
            cls={p.cls}
            info={info}
            onCompact={onCompact}
            onAutoCompact={onAutoCompact}
          />
        ) : (
          <span key={p.key} className={cn("whitespace-nowrap", p.cls)}>
            {p.text}
          </span>
        ),
      )}
    </span>
  );
}

function ContextMenu({
  text,
  cls,
  info,
  onCompact,
  onAutoCompact,
}: {
  text: string;
  cls?: string | undefined;
  info: AgentStatusInfo;
  onCompact?: (() => void) | undefined;
  onAutoCompact?: ((on: boolean) => void) | undefined;
}) {
  const pop = useHoverPop();
  const on = info.autoCompact !== false;
  const row =
    "flex w-full cursor-pointer items-center gap-2 border-0 bg-transparent px-3 py-1.5 text-left text-[13px] text-(--ui-ink) hover:bg-(--ui-hover)";
  return (
    <Popover {...pop.root}>
      <PopoverTrigger
        {...pop.trigger}
        aria-label={`Context: ${text}`}
        className={cn(
          "-mx-1 inline-flex h-6 pointer-coarse:h-9 items-center whitespace-nowrap rounded-md border-0 bg-transparent px-1 font-mono text-[11.5px] tabular-nums transition-colors duration-150 hover:bg-(--ui-fill) data-popup-open:bg-(--ui-wash)",
          cls ?? "text-(--ui-ink-3)",
        )}
      >
        {text}
      </PopoverTrigger>
      <PopoverContent
        align="center"
        side="top"
        aria-label="Context"
        className="w-64 gap-0 overflow-hidden bg-(--ui-paper) p-0 text-(--ui-ink)"
      >
        <div className="grid gap-0.5 px-3 pt-2.5 pb-2">
          <span className="text-[11.5px] text-(--ui-ink-3)">Context</span>
          {info.context ? (
            <span className="text-[13px]">
              {k(info.context.used)} of {k(info.context.max)} tokens
            </span>
          ) : null}
          <span className="text-[12px] text-(--ui-ink-3)">
            {on
              ? info.compactAt
                ? `Compacts by itself at ${k(info.compactAt)}`
                : "Compacts by itself when full"
              : "Auto-compact is off"}
          </span>
        </div>
        <div className="grid border-(--ui-hair) border-t py-1" role="menu" aria-label="Context">
          {onAutoCompact ? (
            <button
              type="button"
              role="menuitemcheckbox"
              aria-checked={on}
              onClick={() => onAutoCompact(!on)}
              className={row}
            >
              <span className="flex-1">Auto-compact</span>
              {on ? <Icon name="check" size={14} className="text-(--ui-active)" /> : null}
            </button>
          ) : null}
          {onCompact ? (
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                pop.setOpen(false);
                onCompact();
              }}
              className={row}
            >
              Compact now
            </button>
          ) : null}
        </div>
      </PopoverContent>
    </Popover>
  );
}

/** A background task of the session: a shell, a Monitor, a subagent or a workflow. */
export interface AgentTask {
  id: string;
  /** The CLI's `task_type`: local_bash, monitor, local_agent, local_workflow, … */
  type: string;
  description: string;
  /** Epoch ms it began; 0 when it began before this page saw it. */
  started: number;
  /** The last progress line, when the task sends one. */
  summary?: string | undefined;
  /** A subagent's use so far, from its progress events. */
  tokens?: number | undefined;
  uses?: number | undefined;
}

/** The end of a shell's or Monitor's output: the CLI keeps the last 8 KB. */
export interface AgentTaskOutput {
  output: string;
  /** Size of the whole output. */
  bytes: number;
  truncated: boolean;
}

const PRINTS = new Set(["local_bash", "monitor"]);
// CLI hands raw terminal bytes: colors and cursor moves out (strip-ansi's regex, no dep)
// biome-ignore lint/suspicious/noControlCharactersInRegex: matching ESC and BEL is the point
const ESC = /\u001b(?:\[[0-?]*[ -/]*[@-~]|\][^\u0007]*\u0007|.)/g;

const KIND: Record<string, { icon: "terminal" | "eye" | "bot" | "pulse"; name: string }> = {
  local_bash: { icon: "terminal", name: "Shell" },
  monitor: { icon: "eye", name: "Monitor" },
  local_agent: { icon: "bot", name: "Agent" },
};
const kindOf = (t: string) => KIND[t] ?? { icon: "pulse" as const, name: "Task" };

function TaskChip({
  task,
  onStop,
  shown,
  onShow,
}: {
  task: AgentTask;
  onStop: (id: string) => void;
  shown: boolean;
  /** Only shells and Monitors: they print. */
  onShow?: (() => void) | undefined;
}) {
  const ms = useElapsed(true, task.started);
  const k = kindOf(task.type);
  const name = (
    <>
      {task.description}
      {task.summary ? <span className="text-(--ui-ink-3)"> · {task.summary}</span> : null}
    </>
  );
  return (
    <li
      className={cn(
        "flex min-h-8 max-w-full items-center gap-2 rounded-[10px] bg-(--ui-wash) py-1 pr-1 pl-2.5 text-[12.5px] shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--ui-active)_18%,transparent)] transition-shadow duration-200 [animation:ui-fade_.2s_both]",
        shown && "shadow-[inset_0_0_0_1px_var(--ui-active)]",
      )}
    >
      <span className="relative grid size-4 flex-none place-items-center">
        <Icon name={k.icon} size={14} className="text-(--ui-active)" aria-label={k.name} />
      </span>
      {onShow ? (
        <button
          type="button"
          aria-expanded={shown}
          {...tipProps(shown ? "Hide output" : "Show output")}
          onClick={onShow}
          className="min-w-0 wrap-anywhere text-left text-(--ui-ink) hover:underline hover:decoration-(--ui-ink-3) hover:underline-offset-2"
        >
          {name}
        </button>
      ) : (
        <span className="min-w-0 wrap-anywhere text-(--ui-ink)">{name}</span>
      )}
      {task.started || task.tokens ? (
        <span className="flex-none font-mono text-[11.5px] text-(--ui-ink-3) tabular-nums">
          {[
            task.tokens ? `${tokens(task.tokens)} tokens` : "",
            task.uses ? `${task.uses} ${task.uses === 1 ? "tool" : "tools"}` : "",
            task.started ? took(ms) : "",
          ]
            .filter(Boolean)
            .join(" · ")}
        </span>
      ) : null}
      <button
        type="button"
        aria-label={`Stop ${task.description}`}
        {...tipProps("Stop")}
        onClick={() => onStop(task.id)}
        className="grid size-6 flex-none place-items-center rounded-full text-(--ui-ink-3) hover:bg-(--ui-fill) hover:text-(--ui-ink)"
      >
        <span className="size-2 rounded-[1.5px] bg-current" />
      </button>
    </li>
  );
}

/** The live background tasks, over the box: what `/tasks` lists in the terminal. */
export function AgentTasks({
  tasks,
  onStop,
  onOutput,
}: {
  tasks: readonly AgentTask[];
  onStop: (id: string) => void;
  /** Reads a shell's or Monitor's output; without it the chips do not open. */
  onOutput?: ((id: string) => Promise<AgentTaskOutput>) | undefined;
}) {
  const [shown, setShown] = useState<string | null>(null);
  const open = tasks.find((t) => t.id === shown);
  if (!tasks.length) return null;
  return (
    <div className="mb-2 grid gap-1.5">
      <ul aria-label="Background tasks" className="m-0 flex list-none flex-wrap gap-1.5 p-0">
        {tasks.map((t) => (
          <TaskChip
            key={t.id}
            task={t}
            onStop={onStop}
            shown={t.id === shown}
            onShow={
              onOutput && PRINTS.has(t.type)
                ? () => setShown(t.id === shown ? null : t.id)
                : undefined
            }
          />
        ))}
      </ul>
      <Fold open={!!open && !!onOutput}>
        {open && onOutput ? <TaskOutput key={open.id} task={open} read={onOutput} /> : null}
      </Fold>
    </div>
  );
}

/** The open task's output, read each second while it shows; stays at the end unless scrolled up. */
function TaskOutput({
  task,
  read,
}: {
  task: AgentTask;
  read: (id: string) => Promise<AgentTaskOutput>;
}) {
  const [out, setOut] = useState<AgentTaskOutput | null>(null);
  const [bad, setBad] = useState(false);
  const box = useRef<HTMLPreElement>(null);
  const pinned = useRef(true);
  const reader = useRef(read);
  reader.current = read; // the hook's function is new each render: read the latest, poll once
  useEffect(() => {
    // read-ok: polls a live task on the open session socket; nothing to cache
    let on = true;
    const tick = () =>
      reader.current(task.id).then(
        (o) => {
          if (!on) return;
          setOut(o);
          setBad(false);
        },
        () => on && setBad(true),
      );
    void tick();
    const t = setInterval(tick, 1000);
    return () => {
      on = false;
      clearInterval(t);
    };
  }, [task.id]);
  const text = out?.output.replace(ESC, "").trimEnd() ?? "";
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs when the text grows
  useLayoutEffect(() => {
    const el = box.current;
    if (el && pinned.current) el.scrollTop = el.scrollHeight;
  }, [text]);
  return (
    <section
      aria-label={`Output of ${task.description}`}
      className="grid overflow-hidden rounded-[10px] bg-(--ui-term) font-mono text-[12px]/[1.6] text-(--ui-term-ink) shadow-[inset_0_0_0_1px_var(--ui-hair)]"
    >
      {out?.truncated ? (
        <p className="m-0 px-3 pt-2 text-[11.5px] text-(--ui-term-dim)">
          Last 8 KB of {kb(out.bytes)}
        </p>
      ) : null}
      <pre
        ref={box}
        onScroll={(e) => {
          const el = e.currentTarget;
          pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
        }}
        className="m-0 max-h-60 overflow-auto px-3 py-2 whitespace-pre-wrap [overflow-wrap:anywhere]"
      >
        {text ? (
          text
        ) : (
          <span className="text-(--ui-term-dim)">
            {bad ? "Output not available." : out ? "No output yet." : "Reading output."}
          </span>
        )}
      </pre>
    </section>
  );
}

const kb = (n: number) =>
  n < 1024 * 1024 ? `${Math.round(n / 1024)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`;

/** A slash command or skill the session offers (the CLI's init list). */
export interface AgentCommand {
  name: string;
  description?: string | undefined;
  /** The arguments it takes, as `/help` shows them. */
  hint?: string | undefined;
}

// the CLI runs a command only at the start of a turn
const atStart: TriggerMatcher = (text, _char, cursor) => {
  const m = /^\s*\//.exec(text);
  if (!m) return null;
  const offset = m[0].length - 1;
  const query = text.slice(offset + 1, cursor);
  return cursor > offset && !/\s/.test(query) ? { query, offset, endOffset: cursor } : null;
};

// plain text in a textarea: the turn carries `/name args` as typed
const PLAIN = {
  serialize: (i: { id: string }) => `/${i.id}`,
  parse: (text: string) => [{ kind: "text" as const, text }],
};

/** `/` at the start of the box lists the commands; a pick writes `/name ` for the arguments. */
export function SlashMenu({ commands }: { commands: readonly AgentCommand[] }) {
  const adapter = useMemo<TriggerAdapter>(
    () => ({
      categories: () => [],
      categoryItems: () => [],
      search: (q) => {
        const l = q.toLowerCase();
        return commands
          .filter((c) => c.name.toLowerCase().includes(l))
          .sort(
            (a, b) =>
              Number(!a.name.toLowerCase().startsWith(l)) -
                Number(!b.name.toLowerCase().startsWith(l)) || a.name.localeCompare(b.name),
          )
          .map((c) => ({
            id: c.name,
            type: "command",
            label: `/${c.name}`,
            description: c.description,
            ...(c.hint ? { metadata: { hint: c.hint } } : {}),
          }));
      },
    }),
    [commands],
  );
  if (!commands.length) return null;
  return (
    <ComposerPrimitive.TriggerPopover
      char="/"
      matcher={atStart}
      adapter={adapter}
      aria-label="Commands"
      className="absolute inset-x-0 bottom-full z-20 mb-2 max-h-72 overflow-y-auto rounded-[12px] bg-(--ui-paper) py-1 shadow-[inset_0_0_0_1px_var(--ui-hair),var(--ui-raise)] [animation:ui-fade_.12s_both]"
    >
      <ComposerPrimitive.TriggerPopover.Directive formatter={PLAIN} />
      <ComposerPrimitive.TriggerPopoverItems>
        {(items) =>
          items.length ? (
            items.map((it, i) => (
              <ComposerPrimitive.TriggerPopoverItem
                key={it.id}
                item={it}
                index={i}
                className="flex w-full cursor-pointer items-baseline gap-3 border-0 bg-transparent px-3 py-1.5 text-left hover:bg-(--ui-hover) data-highlighted:bg-(--ui-hover)"
              >
                <span className="flex-none font-mono text-[12.5px] text-(--ui-ink)">
                  {it.label}
                  {typeof it.metadata?.hint === "string" ? (
                    <span className="text-(--ui-ink-3)"> {it.metadata.hint}</span>
                  ) : null}
                </span>
                {it.description ? (
                  <span className="min-w-0 text-[12.5px] text-(--ui-ink-3)">{it.description}</span>
                ) : null}
              </ComposerPrimitive.TriggerPopoverItem>
            ))
          ) : (
            <p className="m-0 px-3 py-1.5 text-[12.5px] text-(--ui-ink-3)">No such command.</p>
          )
        }
      </ComposerPrimitive.TriggerPopoverItems>
    </ComposerPrimitive.TriggerPopover>
  );
}

/**
 * The composer's picks (model, effort, mode) and the status line under it, as the terminal shows
 * them (designs/2026-11-04-multi-user-runtime.md, Decision 11).
 */
import { cn } from "cn";
import { Popover, PopoverContent, PopoverTrigger } from "./components/ui/popover.js";
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
          "inline-flex h-8 pointer-coarse:h-11 min-w-0 flex-none items-center gap-1 rounded-full border-0 bg-transparent px-2 text-[12.5px] text-(--ui-ink-2) transition-colors duration-150 hover:bg-(--ui-fill) hover:text-(--ui-ink)",
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
              {o.value === value ? <Icon name="check" size={14} className="mt-0.5" /> : null}
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

/** The terminal's status line: model, effort, context used/window (%), 5h %, 7d %. */
export function AgentStatus({ info }: { info: AgentStatusInfo }) {
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
  return (
    // gaps, no dots: a wrapped line never starts on a separator
    <span className="inline-flex flex-wrap justify-center gap-x-3 font-mono text-[11.5px] tabular-nums">
      {parts.map((p) => (
        <span key={p.key} className={cn("whitespace-nowrap", p.cls)}>
          {p.text}
        </span>
      ))}
    </span>
  );
}

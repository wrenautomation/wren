/**
 * A column at the window's right that outlives the page (AppShell `aside`): the agent's chat
 * (designs/2026-11-04-multi-user-runtime.md, Decision 6). Its left edge drags its width; dragged
 * past the fold it closes. On a phone it is the bottom sheet's shape (phone.tsx), full height.
 */
import { type CSSProperties, type ReactNode, useRef } from "react";
import { cx } from "./format.js";
import { Resizer } from "./frame.js";
import { tipProps } from "./hint.js";
import { Icon } from "./icons.js";

export const PANEL = { min: 340, max: 760, fold: 280, width: 440 } as const;

export function SidePanel({
  open,
  label,
  width,
  onWidth,
  onClose,
  title,
  actions,
  children,
}: {
  open: boolean;
  label: string;
  width: number;
  onWidth: (w: number) => void;
  onClose: () => void;
  /** The head's left: a name, or a picker. */
  title: ReactNode;
  /** The head's right, before Close. */
  actions?: ReactNode;
  children: ReactNode;
}) {
  const host = useRef<HTMLElement>(null);
  return (
    <aside
      ref={host}
      aria-label={label}
      style={{ "--panel-w": `${width}px` } as CSSProperties}
      className={cx(
        "relative flex min-h-0 w-(--panel-w) flex-none flex-col border-(--ui-hair) border-l bg-(--ui-paper)",
        "max-[900px]:fixed max-[900px]:inset-x-0 max-[900px]:bottom-0 max-[900px]:z-40 max-[900px]:h-[calc(100dvh-env(safe-area-inset-top)-10px)] max-[900px]:w-full max-[900px]:rounded-[6px_24px_0_0] max-[900px]:border-t max-[900px]:border-l-0 max-[900px]:shadow-(--ui-shadow)",
        open ? "[animation:ui-fade_.2s_var(--ui-ease)_both]" : "hidden",
      )}
    >
      <Resizer
        side="left"
        label={label}
        width={width}
        shut={false}
        shutPx={0}
        range={PANEL}
        host={() => host.current}
        cssVar="--panel-w"
        style={{ left: -5 }}
        onDone={(n) => (n.shut ? onClose() : onWidth(n.width))}
        onReset={() => onWidth(PANEL.width)}
      />
      <header className="flex min-h-[54px] flex-none items-center gap-1.5 border-(--ui-hair) border-b pr-2 pl-4">
        <div className="flex min-w-0 flex-1 items-center gap-2">{title}</div>
        {actions}
        <button
          type="button"
          onClick={onClose}
          aria-label={`Close ${label.toLowerCase()}`}
          {...tipProps(`Close ${label.toLowerCase()}`, { keys: "⌘J" })}
          className="grid size-8 flex-none place-items-center rounded-(--ui-radius) text-(--ui-ink-2) transition-colors duration-150 hover:bg-(--ui-fill) hover:text-(--ui-ink)"
        >
          <Icon name="close" size={16} />
        </button>
      </header>
      <div className="flex min-h-0 flex-1 flex-col">{children}</div>
    </aside>
  );
}

/** The panel's one door (AppShell `agent`): the shell puts it in each frame; compact is the icon. */
export interface PanelDoor {
  open: boolean;
  onToggle: () => void;
}

export function PanelButton({
  open,
  onToggle,
  compact = false,
  side,
}: PanelDoor & { compact?: boolean; side?: "right" }) {
  const tip = open ? "Close the agent" : "Ask the agent about this page";
  return (
    <button
      type="button"
      aria-pressed={open}
      aria-label={compact ? "Agent" : undefined}
      {...tipProps(tip, {
        keys: "⌘J",
        ...(side ? { side } : {}),
        ...(compact ? { as: "none" } : {}),
      })}
      className={cx(
        "inline-flex h-8 flex-none items-center gap-2 rounded-(--ui-radius) border-0 bg-transparent px-2.5 text-[13px] font-medium text-(--ui-ink-2) hover:bg-(--ui-hover) hover:text-(--ui-ink) aria-pressed:bg-(--ui-wash) aria-pressed:text-(--ui-ink) pointer-coarse:h-11",
        compact && "w-8 justify-center px-0 pointer-coarse:w-11",
      )}
      onClick={onToggle}
    >
      <Icon name="chat" size={15} />
      {compact ? null : "Agent"}
    </button>
  );
}

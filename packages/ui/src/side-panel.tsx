/**
 * A column at the window's right that outlives the page (AppShell `aside`): the agent's chat
 * (designs/2026-11-04-multi-user-runtime.md, Decision 6). Its left edge drags its width; dragged
 * past the fold it closes. On a phone it is the bottom sheet's shape (phone.tsx), full height.
 */
import { type MotionStyle, motion, useReducedMotion } from "motion/react";
import { type ReactNode, useRef, useState } from "react";
import { cx } from "./format.js";
import { Resizer } from "./frame.js";
import { tipProps } from "./hint.js";
import { Icon, type IconName } from "./icons.js";
import { useNarrow } from "./list-bar.js";
import { EASE, LEAVE } from "./motion.js";

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
  /** The head's left: a name, or a picker. None: no head; the content draws its own with `PanelClose`. */
  title?: ReactNode;
  /** The head's right, before Close. */
  actions?: ReactNode;
  children: ReactNode;
}) {
  const host = useRef<HTMLElement>(null);
  const still = useReducedMotion() ?? false;
  const phone = useNarrow();
  // arrives on the ease, leaves quicker; closed it stays mounted, so the chat keeps its session
  const move = open ? { duration: 0.3, ease: EASE } : { duration: 0.2, ease: LEAVE };
  // reduced motion: a fade in place; the room jumps (after the fade, on close)
  const fade = { duration: 0.15, ease: "linear" } as const;
  const room = still ? { duration: 0, delay: open ? 0 : fade.duration } : move;
  const shut = still ? { opacity: 0 } : phone ? { y: "100%" } : { opacity: 0, x: 24 };
  // shut and done moving: out of the tab order and the a11y tree (motion's transitionEnd never
  // set display:none here, so a closed chat stayed focusable at width 0)
  const [gone, setGone] = useState(!open);
  if (open && gone) setGone(false);
  return (
    <motion.div
      // its room: the page gives way as it opens and takes the room back as it shuts
      className={cx("flex min-h-0 flex-none overflow-hidden", !open && gone && "hidden")}
      initial={false}
      animate={{ width: open ? "auto" : 0 }}
      transition={room}
      onAnimationComplete={() => (open ? undefined : setGone(true))}
    >
      <motion.aside
        ref={host}
        aria-label={label}
        style={{ "--panel-w": `${width}px` } as MotionStyle}
        initial={false}
        animate={open ? { opacity: 1, x: 0, y: 0 } : shut}
        transition={still ? fade : move}
        className={cx(
          // inset card, a faint rim: Claude's and ChatGPT's side panel
          "relative flex min-h-0 w-(--panel-w) flex-none flex-col bg-(--ui-paper)",
          // a key or a reset eases to its width; a drag follows the pointer (Resizer sets data-resizing)
          "transition-[width] duration-200 ease-out data-resizing:transition-none motion-reduce:transition-none",
          // main keeps >= 560px while the panel can give: 616 = 560 + main pad 48 + panel gap 8;
          // under that main narrows and its pages reflow (@container/main)
          "min-[901px]:w-[max(340px,min(var(--panel-w),calc(100cqw-616px)))]",
          "min-[901px]:my-2 min-[901px]:mr-2 min-[901px]:rounded-[12px] min-[901px]:border min-[901px]:border-[color-mix(in_srgb,var(--ui-ink)_8%,transparent)] min-[901px]:shadow-[0_1px_3px_rgb(0_0_0/.04)]",
          "max-[900px]:fixed max-[900px]:inset-x-0 max-[900px]:bottom-0 max-[900px]:z-40 max-[900px]:h-[calc(100dvh-env(safe-area-inset-top)-10px)] max-[900px]:w-full max-[900px]:rounded-[6px_24px_0_0] max-[900px]:border-t max-[900px]:border-l-0 max-[900px]:shadow-(--ui-shadow)",
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
          onDone={(n) => {
            if (!n.shut) return onWidth(n.width);
            // a drag shut it: the next open starts at its kept width, not the dragged one
            host.current?.style.setProperty("--panel-w", `${width}px`);
            onClose();
          }}
          onReset={() => onWidth(PANEL.width)}
        />
        {title ? (
          <header className="flex min-h-[54px] flex-none items-center gap-1.5 border-(--ui-hair) border-b pr-2 pl-4">
            <div className="flex min-w-0 flex-1 items-center gap-2">{title}</div>
            {actions}
            <PanelClose label={label} onClose={onClose} />
          </header>
        ) : null}
        <div className="flex min-h-0 flex-1 flex-col">{children}</div>
      </motion.aside>
    </motion.div>
  );
}

/** A panel head's icon button: New, Expand, Close. */
/** A head action's look; a part with its own trigger (a menu) takes it too. */
export const PANEL_ACT =
  "grid size-8 flex-none place-items-center rounded-(--ui-radius) text-(--ui-ink-2) no-underline transition-[background-color,color,scale] duration-150 active:scale-[.97] motion-reduce:transition-none hover:bg-(--ui-fill) hover:text-(--ui-ink) data-popup-open:bg-(--ui-wash) pointer-coarse:size-11";

export function PanelAct({
  icon,
  label,
  keys,
  onClick,
  href,
}: {
  icon: IconName;
  label: string;
  keys?: string;
  onClick?: () => void;
  href?: string;
}) {
  const cls = PANEL_ACT;
  const tip = tipProps(label, keys ? { keys } : {});
  return href ? (
    <a href={href} aria-label={label} onClick={onClick} {...tip} className={cls}>
      <Icon name={icon} size={15} />
    </a>
  ) : (
    <button type="button" aria-label={label} onClick={onClick} {...tip} className={cls}>
      <Icon name={icon} size={16} />
    </button>
  );
}

/** The panel's Close (⌘J). */
export function PanelClose({ label, onClose }: { label: string; onClose: () => void }) {
  return (
    <PanelAct icon="close" label={`Close ${label.toLowerCase()}`} keys="⌘J" onClick={onClose} />
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
        "inline-flex h-8 flex-none items-center gap-2 rounded-(--ui-radius) border-0 bg-transparent px-2.5 text-[13px] font-medium text-(--ui-ink-2) transition-[background-color,color,scale] duration-150 active:scale-[.97] motion-reduce:transition-none hover:bg-(--ui-hover) hover:text-(--ui-ink) aria-pressed:bg-(--ui-wash) aria-pressed:text-(--ui-ink) pointer-coarse:h-11",
        compact && "w-8 justify-center px-0 pointer-coarse:w-11",
      )}
      onClick={onToggle}
    >
      <Icon name="chat" size={15} />
      {compact ? null : "Agent"}
    </button>
  );
}

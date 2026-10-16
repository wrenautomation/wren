/**
 * A list menu that opens on hover (designs/2026-10-16-portal-libs.md). Base UI's Popover does the
 * work: hover with a rest before it opens, a short grace before it closes, the safe triangle
 * toward the popup and toward a nested one, mouse only. Click and keys still open it; a touch
 * screen taps. This hook adds two things: hover is on only where the pointer can hover, and a
 * popup doesn't close under someone typing in it.
 */
import type { Popover } from "@base-ui/react/popover";
import { useCallback, useState, useSyncExternalStore } from "react";

/** The pointer rests this long on a trigger before its menu opens. */
export const HOVER_OPEN_MS = 120;
/** A menu opened by hover waits this long after the pointer leaves before it closes. */
export const HOVER_CLOSE_MS = 200;
/** A nested menu opens faster: the pointer is already in a menu. */
export const SUB_OPEN_MS = 100;

const FINE = "(hover: hover) and (pointer: fine)";

/** Whether this screen's pointer hovers: a mouse or trackpad, not a finger. */
export function useHovers(): boolean {
  return useSyncExternalStore(
    (on) => {
      const m = matchMedia(FINE);
      m.addEventListener("change", on);
      return () => m.removeEventListener("change", on);
    },
    () => matchMedia(FINE).matches,
    () => false,
  );
}

/** Someone is typing in an open popup: a hover leaving it mustn't take their words away. */
export function typingInPopup(): boolean {
  const a = document.activeElement;
  return (
    !!a?.closest('[data-slot="popover-content"]') &&
    a.matches(
      'input:not([type="checkbox"]):not([type="radio"]):not([type="button"]), textarea, [contenteditable="true"]',
    )
  );
}

export interface HoverPop {
  open: boolean;
  /** Opened by the pointer resting on its trigger: the popup leaves focus where it was. */
  byHover: boolean;
  setOpen: (open: boolean) => void;
  /** Spread on the Popover root. */
  root: {
    open: boolean;
    onOpenChange: (open: boolean, details: Popover.Root.ChangeEventDetails) => void;
  };
  /** Spread on the PopoverTrigger: hover where the pointer hovers, click and keys always. */
  trigger: { openOnHover?: boolean; delay?: number; closeDelay?: number };
}

/**
 * One list menu's open state, opening on hover. `sub` for one nested in another menu; `onOpen`
 * runs each time it opens.
 */
export function useHoverPop(o: { sub?: boolean; onOpen?: () => void } = {}): HoverPop {
  const hovers = useHovers();
  const [state, setState] = useState({ open: false, byHover: false });
  const { onOpen } = o;
  const setOpen = useCallback((open: boolean) => setState({ open, byHover: false }), []);
  const onOpenChange = useCallback(
    (open: boolean, details: Popover.Root.ChangeEventDetails) => {
      const hover = details.reason === "trigger-hover";
      if (!open && hover && typingInPopup()) return;
      if (open) onOpen?.();
      setState({ open, byHover: open && hover });
    },
    [onOpen],
  );
  return {
    open: state.open,
    byHover: state.open && state.byHover,
    setOpen,
    root: { open: state.open, onOpenChange },
    trigger: hovers
      ? {
          openOnHover: true,
          delay: o.sub ? SUB_OPEN_MS : HOVER_OPEN_MS,
          closeDelay: HOVER_CLOSE_MS,
        }
      : {},
  };
}

/**
 * Nested menus where one opens at a time: a menu's rows, each with its own submenu beside it.
 * Spread `rootOf(key)` on each row's Popover and `trigger` on its trigger.
 */
export function useSubmenus() {
  const hovers = useHovers();
  const [open, setOpen] = useState<string | null>(null);
  return {
    open,
    close: useCallback(() => setOpen(null), []),
    rootOf: (key: string) => ({
      open: open === key,
      onOpenChange: (next: boolean, details: Popover.Root.ChangeEventDetails) => {
        if (!next && details.reason === "trigger-hover" && typingInPopup()) return;
        setOpen((cur) => (next ? key : cur === key ? null : cur));
      },
    }),
    trigger: hovers
      ? { openOnHover: true, delay: SUB_OPEN_MS, closeDelay: HOVER_CLOSE_MS }
      : ({} as { openOnHover?: boolean; delay?: number; closeDelay?: number }),
  };
}

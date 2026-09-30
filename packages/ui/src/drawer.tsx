/** A panel that floats in from the right over the page: one record in full, the list still behind it. */
import { type ReactNode, useEffect, useRef } from "react";
import { Icon } from "./icons.js";

const FOCUSABLE =
  'a[href],button:not([disabled]),input,select,textarea,[tabindex]:not([tabindex="-1"])';

export function Drawer({
  label,
  onClose,
  children,
}: {
  /** What the panel holds, for screen readers ("Person"). */
  label: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const panel = useRef<HTMLElement>(null);
  // Held in a ref so a new `onClose` each render doesn't re-run the focus and key setup.
  const close = useRef(onClose);
  close.current = onClose;

  useEffect(() => {
    const back = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const root = document.documentElement;
    root.classList.add("ui-locked");
    panel.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close.current();
      if (e.key !== "Tab" || !panel.current) return;
      // Keep Tab inside the panel while it's open.
      const all = [...panel.current.querySelectorAll<HTMLElement>(FOCUSABLE)];
      const first = all[0];
      const last = all.at(-1);
      if (!first || !last) return;
      if (
        e.shiftKey &&
        (document.activeElement === first || document.activeElement === panel.current)
      ) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    addEventListener("keydown", onKey);
    return () => {
      removeEventListener("keydown", onKey);
      root.classList.remove("ui-locked");
      if (back?.isConnected) back.focus({ preventScroll: true });
    };
  }, []);

  return (
    <div className="ui-drawer-wrap">
      <button
        type="button"
        className="ui-drawer-back"
        tabIndex={-1}
        aria-label="Close"
        onClick={() => close.current()}
      />
      <aside
        ref={panel}
        className="ui-drawer"
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={label}
      >
        <button
          type="button"
          className="ui-drawer-close"
          onClick={() => close.current()}
          aria-label="Close"
        >
          <Icon name="close" />
        </button>
        {children}
      </aside>
    </div>
  );
}

/**
 * Hover text, drawn once for the page. `HintLayer` listens on the document for any element with
 * `data-tip` (`tipProps`, hint.ts): after the pointer rests on it, or the keyboard lands on it, a
 * small box names what it is, with its key if it has one. Touch gets none. One box and four
 * listeners serve every chip, icon, date and cut-off name on the page.
 */
import { type ReactNode, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { hintFlow, placeTip, type TipSide, tipProps } from "./hint.js";

interface Shown {
  text: string;
  keys: string;
  side: TipSide;
  anchor: Element;
}

const textOf = (el: Element) => el.getAttribute("data-tip") || (el.textContent ?? "").trim();

/** Whether an element has anything to say now: text, and for a `clip` one, text cut short. */
function says(el: Element): boolean {
  if (!textOf(el)) return false;
  if (!el.hasAttribute("data-tip-clip")) return true;
  return el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1;
}

/** The nearest element up from a node with hover text to give; one cut-short name passes to its row. */
export function tipAt(node: EventTarget | null): Element | null {
  let el = node instanceof Element ? node.closest("[data-tip]") : null;
  while (el) {
    if (says(el)) return el;
    el = el.parentElement?.closest("[data-tip]") ?? null;
  }
  return null;
}

/**
 * Around a control that may be switched off, with the reason it is. A disabled button takes no
 * pointer, so its own hover never fires; the reason rides on this box instead. No text, no tip.
 * `keys` is the key that does the same, shown beside the words.
 */
export function Why({
  text,
  keys,
  className,
  children,
}: {
  text?: string | null | undefined;
  keys?: string | undefined;
  className?: string | undefined;
  children: ReactNode;
}) {
  return (
    <span
      className={className ? `inline-flex ${className}` : "inline-flex"}
      {...tipProps(text, { as: "none", ...(keys ? { keys } : {}) })}
    >
      {children}
    </span>
  );
}

const SIDES = new Set(["top", "bottom", "left", "right"]);

/** Mount once, anywhere in the page. */
export function HintLayer() {
  const [shown, setShown] = useState<Shown | null>(null);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Whether the last thing the viewer did was press a key: only then does focus show a tip, so a
    // tap or a click that lands focus does not.
    let byKey = false;
    let watch: ReturnType<typeof setInterval> | undefined;
    const flow = hintFlow<Element>({
      now: () => Date.now(),
      after: (ms, fn) => {
        const t = setTimeout(fn, ms);
        return () => clearTimeout(t);
      },
      show: (el) => {
        const side = el.getAttribute("data-tip-side") ?? "";
        setShown({
          text: textOf(el),
          keys: el.getAttribute("data-tip-keys") ?? "",
          side: SIDES.has(side) ? (side as TipSide) : "bottom",
          anchor: el,
        });
        // A row that leaves the page while it is named takes the tip with it.
        clearInterval(watch);
        watch = setInterval(() => {
          if (flow.target && !flow.target.isConnected) flow.aim(null);
        }, 400);
      },
      hide: () => {
        clearInterval(watch);
        setShown(null);
      },
    });
    const over = (e: PointerEvent) => {
      if (e.pointerType !== "touch") flow.aim(tipAt(e.target));
    };
    const focus = (e: FocusEvent) => {
      const el = tipAt(e.target);
      if (el && byKey && e.target instanceof Element && e.target.matches(":focus-visible"))
        flow.aim(el);
    };
    const blur = (e: FocusEvent) => {
      if (flow.target && flow.target === tipAt(e.target)) flow.aim(null);
    };
    const press = () => {
      byKey = false;
      flow.dismiss();
    };
    const key = (e: KeyboardEvent) => {
      byKey = true;
      if (e.key === "Escape") flow.dismiss();
    };
    const away = () => flow.aim(null);
    const move = () => flow.dismiss();
    const doc = document;
    doc.addEventListener("pointerover", over);
    doc.addEventListener("pointerdown", press, true);
    doc.addEventListener("keydown", key, true);
    doc.addEventListener("focusin", focus);
    doc.addEventListener("focusout", blur);
    doc.addEventListener("scroll", move, { capture: true, passive: true });
    doc.documentElement.addEventListener("pointerleave", away);
    window.addEventListener("blur", away);
    return () => {
      clearInterval(watch);
      flow.aim(null);
      doc.removeEventListener("pointerover", over);
      doc.removeEventListener("pointerdown", press, true);
      doc.removeEventListener("keydown", key, true);
      doc.removeEventListener("focusin", focus);
      doc.removeEventListener("focusout", blur);
      doc.removeEventListener("scroll", move, true);
      doc.documentElement.removeEventListener("pointerleave", away);
      window.removeEventListener("blur", away);
    };
  }, []);

  // Placed before it paints: measured at its own size, then moved beside what it names.
  useLayoutEffect(() => {
    const el = box.current;
    if (!el || !shown) return;
    const a = shown.anchor.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    const at = placeTip(
      { left: a.left, top: a.top, width: a.width, height: a.height },
      { width: r.width, height: r.height },
      { width: window.innerWidth, height: window.innerHeight },
      shown.side,
    );
    el.style.left = `${Math.round(at.left)}px`;
    el.style.top = `${Math.round(at.top)}px`;
    el.style.visibility = "visible";
  }, [shown]);

  if (!shown) return null;
  return createPortal(
    <div
      ref={box}
      aria-hidden="true"
      style={{ left: 0, top: 0, visibility: "hidden" }}
      className="pointer-events-none fixed z-[100] w-max max-w-[280px] animate-[ui-fade_0.12s_var(--ui-ease)_backwards] rounded-(--ui-radius) bg-(--ui-ink) px-2 py-1 text-[12px] leading-4 text-(--ui-paper) shadow-(--ui-float)"
    >
      {shown.text}
      {shown.keys ? (
        <kbd className="ml-2 inline-block border border-current/30 px-1 font-mono text-[11px] leading-[14px] opacity-80">
          {shown.keys}
        </kbd>
      ) : null}
    </div>,
    document.body,
  );
}

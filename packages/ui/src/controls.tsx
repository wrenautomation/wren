/** Things you press: square buttons, and pill tags for status. */

import { cn } from "cn";
import { type AnchorHTMLAttributes, type ButtonHTMLAttributes, type ReactNode, useId } from "react";
import { Busy } from "./busy.js";
import { Badge } from "./components/ui/badge.js";
import { buttonVariants, Button as ShadButton } from "./components/ui/button.js";
import { tipProps } from "./hint.js";
import { Icon, type IconName } from "./icons.js";

/**
 * `primary` is the one action on a screen (the accent), named where it is used; `secondary`, the
 * default, is outlined; `quiet` is text.
 */
export type ButtonTone = "primary" | "secondary" | "quiet";

interface ButtonLook {
  tone?: ButtonTone | undefined;
  /**
   * `dense` is the console's: 32px, 13px, sentence case. `next` is the console's step up for the
   * one action pressed most on a record or a queue item: 36px, 14px, semibold.
   */
  size?: "md" | "sm" | "dense" | "next" | undefined;
  icon?: IconName | undefined;
  /** The lander's trailing arrow: this goes somewhere or starts something. */
  arrow?: boolean | undefined;
  children: ReactNode;
  className?: string | undefined;
}

/**
 * shadcn's button, in the kit's look: a leaf hint for corners, sentence case, accent. The primary
 * keeps a press edge under it and sinks 3 px when pressed (secondary tones set their own hover).
 */
const BUTTON =
  "h-auto gap-[0.8em] px-4 py-[9px] border-0 [border-radius:var(--ui-leaf-button)] bg-(--ui-primary) text-(--ui-on-accent) font-(family-name:--ui-font) font-(--ui-button-weight) text-[14px]/[1.55] tracking-(--ui-button-tracking) [text-transform:var(--ui-button-case)] no-underline cursor-pointer transition-[background-color,color,box-shadow,transform,opacity] duration-150 ease-(--ui-spring) hover:bg-(--ui-primary) disabled:opacity-40 focus-visible:ring-0 focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-(--ui-focus)";
const BUTTON_SIZE = { md: "", sm: "px-3.5 py-1.5 text-[13px]/[1.55]", dense: "", next: "" };
const DENSE = "h-8 px-3 py-0 text-[13px]/none";
const NEXT = "h-9 px-4 text-[14px]/none font-semibold";
const DENSE_TONE: Record<ButtonTone, string> = {
  primary: DENSE,
  secondary: `${DENSE} shadow-[inset_0_0_0_1px_var(--ui-hair)] hover:bg-(--ui-wash) hover:text-(--ui-ink)`,
  quiet: `${DENSE} px-2 no-underline hover:bg-(--ui-hover)`,
};
const BUTTON_TONE: Record<ButtonTone, string> = {
  primary:
    "[--ui-busy-ink:currentColor] shadow-[0_3px_0_var(--ui-press-edge)] active:not-aria-[haspopup]:translate-y-[3px] active:not-aria-[haspopup]:shadow-[0_0_0_var(--ui-press-edge)]",
  secondary:
    "bg-(--ui-paper) text-(--ui-ink) shadow-[inset_0_0_0_1px_var(--ui-hair),0_2px_0_var(--ui-hair)] hover:bg-(--ui-wash) active:not-aria-[haspopup]:translate-y-[3px] active:not-aria-[haspopup]:shadow-[inset_0_0_0_1px_var(--ui-hair),0_0_0_var(--ui-hair)]",
  quiet:
    "px-0 py-[0.4em] bg-transparent text-(--ui-ink-2) text-[14px]/none font-medium tracking-normal [text-transform:none] active:not-aria-[haspopup]:translate-y-0 active:not-aria-[haspopup]:scale-[0.97] underline decoration-(--ui-ink-3) underline-offset-[0.24em] hover:bg-transparent hover:text-(--ui-ink) hover:decoration-current",
};

const look = ({ tone = "secondary", size = "md", className }: ButtonLook) =>
  cn(
    buttonVariants(),
    BUTTON,
    BUTTON_SIZE[size],
    BUTTON_TONE[tone],
    (size === "dense" || size === "next") && DENSE_TONE[tone],
    size === "next" && NEXT,
    // A finger needs 44px. A long label never pushes past its box: it ends in "…".
    "pointer-coarse:min-h-11 max-w-full min-w-0",
    className,
  );

const inside = ({ icon, arrow, children }: ButtonLook) => (
  <>
    {icon ? <Icon name={icon} /> : null}
    <span className="min-w-0 truncate">{children}</span>
    {arrow ? (
      <Icon
        name="arrow"
        className="transition-transform duration-200 ease-(--ui-ease) group-hover/button:translate-x-[3px]"
      />
    ) : null}
  </>
);

export function Button({
  tone,
  size,
  icon,
  arrow,
  busy,
  done,
  disabled,
  children,
  className,
  type = "button",
  ...rest
}: ButtonLook & {
  /**
   * It was pressed and its work is running: it stays solid, with the busy ring turning after the
   * label, and is turned off, so neither a click nor Enter presses it again. Pass `busy` (true or
   * false) on a button that can go busy, so the ring's slot is always there and the width never
   * changes. A button acts on rows: pass `true` only for the rows its press is at work on.
   */
  busy?: boolean | undefined;
  /** Its press just worked: a check shows in the ring's slot for a moment (`useRun`'s `done`). */
  done?: boolean | undefined;
} & Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children" | "className">) {
  const l: ButtonLook = {
    tone,
    size,
    icon,
    arrow,
    children,
    className: cn(busy && "disabled:opacity-100", className),
  };
  return (
    <ShadButton
      type={type}
      className={look(l)}
      {...rest}
      disabled={busy || disabled}
      aria-busy={busy || undefined}
    >
      {inside(l)}
      {busy === undefined && done === undefined ? null : <Busy on={!!busy} done={done} />}
    </ShadButton>
  );
}

/** A link that looks like a button. A plain `<a>`, so it stays a link to assistive tech. */
export function ButtonLink({
  tone,
  size,
  icon,
  arrow,
  children,
  className,
  ...rest
}: ButtonLook & Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "children" | "className">) {
  const l: ButtonLook = { tone, size, icon, arrow, children, className };
  return (
    <a data-slot="button" className={look(l)} {...rest}>
      {inside(l)}
    </a>
  );
}

/**
 * `accent` marks what needs you or what changed; `warn` what went wrong and waits on someone (the
 * nav's counts' amber); `green` a result; `neutral` the rest.
 */
export type TagTone = "neutral" | "accent" | "warn" | "green";

const TAG =
  "h-auto max-w-full gap-1.5 px-2.5 py-[3px] border-0 [border-radius:var(--ui-leaf-chip)] text-[12.5px]/[1.5] font-semibold align-[1px]";
const TAG_TONE: Record<TagTone, string> = {
  neutral: "bg-(--ui-fill) text-(--ui-ink-2)",
  accent: "bg-(--ui-accent-tint) text-(--ui-live)",
  warn: "bg-(--ui-warn-tint) text-(--ui-warn-ink)",
  green: "bg-(--ui-good-tint) text-(--ui-good-ink)",
};
const DOT = "before:size-1.5 before:rounded-full before:bg-current before:content-['']";

/** shadcn's badge as the kit's status pill. */
export function Tag({
  tone = "neutral",
  dot = false,
  busy,
  title,
  className,
  children,
}: {
  tone?: TagTone;
  dot?: boolean;
  /** A chip that waits ("Drafting"): the ring after the label. Pass true or false to keep the slot. */
  busy?: boolean | undefined;
  title?: string | undefined;
  className?: string | undefined;
  children: ReactNode;
}) {
  return (
    <Badge className={cn(TAG, TAG_TONE[tone], dot && DOT, className)} {...tipProps(title)}>
      <span className="min-w-0 truncate">{children}</span>
      {busy === undefined ? null : <Busy on={busy} />}
    </Badge>
  );
}

/**
 * Words in a short box that scrolls, under a small label: one side of an edit conflict. The box is
 * a named group that takes focus, so a keyboard can scroll it.
 */
export function ScrollText({
  label,
  quiet = false,
  children,
}: {
  label: string;
  /** Grey words: what someone else saved, beside your own. */
  quiet?: boolean;
  children: ReactNode;
}) {
  const id = useId();
  return (
    <div className="grid gap-1">
      <span id={id} className="text-[12px] text-(--ui-ink-2)">
        {label}
      </span>
      {/* biome-ignore lint/a11y/useSemanticElements: a group, not a landmark: a page may hold two. */}
      <div
        role="group"
        aria-labelledby={id}
        // biome-ignore lint/a11y/noNoninteractiveTabindex: a box that scrolls needs focus to scroll by keyboard.
        tabIndex={0}
        className={cn(
          "max-h-40 overflow-y-auto whitespace-pre-wrap break-words rounded-(--ui-radius) focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--ui-focus)",
          quiet ? "text-(--ui-ink-2)" : "text-(--ui-ink)",
        )}
      >
        {children}
      </div>
    </div>
  );
}

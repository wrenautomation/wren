/** Things you press: square buttons, and pill tags for status. */

import { cn } from "cn";
import {
  type AnchorHTMLAttributes,
  type ButtonHTMLAttributes,
  type CSSProperties,
  type ReactNode,
  useId,
} from "react";
import { Ring } from "./busy.js";
import { Badge } from "./components/ui/badge.js";
import { buttonVariants, Button as ShadButton } from "./components/ui/button.js";
import { tipProps } from "./hint.js";
import { Icon, type IconName } from "./icons.js";
import { RingSlot } from "./motion.js";

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
 * shadcn's button as the artifact's `.btn`: a leaf hint for corners, sentence case, accent. The
 * primary keeps a press edge under it and sinks 3 px when pressed; the secondary (`.btn.q`) is
 * paper with a hairline and a hairline edge. No hover fill: the press is the feedback.
 */
const BUTTON =
  "h-auto gap-[0.8em] px-4 py-[9px] border-0 rounded-(--ui-leaf-button) bg-(--ui-primary) text-(--ui-on-accent) font-(family-name:--ui-font) font-(--ui-button-weight) text-[14px]/[1.55] tracking-(--ui-button-tracking) [text-transform:var(--ui-button-case)] no-underline whitespace-nowrap cursor-pointer transition-[transform,box-shadow] duration-[120ms] ease-[ease] hover:bg-(--ui-primary) disabled:opacity-40 focus-visible:ring-0 focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-(--ui-focus)";
const BUTTON_SIZE = {
  md: "",
  sm: "px-3.5 [--ui-act-pad:14px] py-1.5 text-[13px]/[1.55]",
  dense: "",
  next: "",
};
const DENSE = "h-8 px-3 [--ui-act-pad:12px] py-0 text-[13px]/none";
const NEXT = "h-9 px-4 text-[14px]/none font-semibold";
const DENSE_TONE: Record<ButtonTone, string> = {
  primary: DENSE,
  secondary: `${DENSE} shadow-[inset_0_0_0_1px_var(--ui-hair)]`,
  quiet: `${DENSE} px-2 [--ui-act-pad:8px] no-underline hover:bg-(--ui-hover)`,
};
const BUTTON_TONE: Record<ButtonTone, string> = {
  primary:
    "[--ui-busy-ink:currentColor] shadow-[0_3px_0_var(--ui-press-edge)] active:not-aria-[haspopup]:translate-y-[3px] active:not-aria-[haspopup]:shadow-[0_0_0_var(--ui-press-edge)]",
  secondary:
    "bg-(--ui-paper) text-(--ui-ink) shadow-[inset_0_0_0_1px_var(--ui-hair),0_2px_0_var(--ui-hair)] hover:bg-(--ui-paper) active:not-aria-[haspopup]:translate-y-[3px] active:not-aria-[haspopup]:shadow-[inset_0_0_0_1px_var(--ui-hair),0_0_0_var(--ui-hair)]",
  quiet:
    "px-0 [--ui-act-pad:0px] py-[0.4em] bg-transparent text-(--ui-ink-2) text-[14px]/none font-medium tracking-normal [text-transform:none] active:not-aria-[haspopup]:translate-y-0 active:not-aria-[haspopup]:scale-[0.97] underline decoration-(--ui-ink-3) underline-offset-[0.24em] hover:bg-transparent hover:text-(--ui-ink) hover:decoration-current",
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
  doneLabel = "Done",
  disabled,
  children,
  className,
  type = "button",
  ...rest
}: ButtonLook & {
  /**
   * It was pressed and its work is running: it stays solid and is turned off, so neither a click
   * nor Enter presses it again. The label moves 9 px left and the ring fades in at the right, in
   * the button's own padding: no slot, and the width never changes. Pass `busy` (true or false)
   * on a button that can go busy. A button acts on rows: pass `true` only for the rows its press
   * is at work on.
   */
  busy?: boolean | undefined;
  /** Its press just worked: `doneLabel` rises in over the label for a moment (`useRun`'s `done`). */
  done?: boolean | undefined;
  /** The words a press that worked shows ("Sent"). "Done" by default. */
  doneLabel?: ReactNode;
} & Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children" | "className">) {
  const l: ButtonLook = {
    tone,
    size,
    icon,
    arrow,
    children,
    className: cn(busy && "disabled:opacity-100", className),
  };
  const acts = busy !== undefined || done !== undefined;
  const shown = !!done && !busy;
  return (
    <ShadButton
      type={type}
      className={cn(look(l), acts && "ui-act")}
      {...rest}
      disabled={busy || disabled}
      aria-busy={busy || undefined}
      data-done={shown ? "" : undefined}
    >
      {acts ? (
        <>
          <span className="ui-act-lb" aria-hidden={shown || undefined}>
            {inside(l)}
          </span>
          <span className="ui-act-ok" aria-hidden={!shown || undefined}>
            {doneLabel}
          </span>
          <span className="ui-act-ring" aria-hidden="true">
            <Ring on={!!busy} />
          </span>
        </>
      ) : (
        inside(l)
      )}
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
 * The artifact's chip (`.pt`). `accent` marks what needs you or what changed; `warn` what waits on
 * someone (the nav's counts' amber); `green` a result; `bad` what failed; `neutral` the rest.
 * A `<b>` inside is a count: bold, in ink.
 */
export type TagTone = "neutral" | "accent" | "warn" | "green" | "bad";

const TAG =
  "h-auto w-auto max-w-full gap-1.5 [--ui-gap:6px] px-2.5 py-[3px] border-0 rounded-(--ui-leaf-chip) text-[12.5px]/[1.55] font-semibold whitespace-nowrap overflow-visible [&_b]:font-bold";
const TAG_TONE: Record<TagTone, string> = {
  neutral: "bg-(--ui-fill) text-(--ui-ink-2) [&_b]:text-(--ui-ink)",
  accent: "bg-(--ui-accent-tint) text-(--ui-live)",
  warn: "bg-[color-mix(in_srgb,var(--ui-warn)_15%,transparent)] text-[color-mix(in_srgb,var(--ui-warn)_70%,var(--ui-ink))]",
  green:
    "bg-[color-mix(in_srgb,var(--ui-good)_13%,transparent)] text-[color-mix(in_srgb,var(--ui-good)_65%,var(--ui-ink))]",
  bad: "bg-[color-mix(in_srgb,var(--ui-bad)_12%,transparent)] text-[color-mix(in_srgb,var(--ui-bad)_75%,var(--ui-ink))]",
};
const DOT = "before:size-1.5 before:rounded-full before:bg-current before:content-['']";

/** shadcn's badge as the kit's status pill. */
export function Tag({
  tone = "neutral",
  dot = false,
  busy,
  title,
  className,
  style,
  children,
}: {
  tone?: TagTone;
  dot?: boolean;
  /** A chip at work ("Drafting"): the ring after the label while true. No slot when false. */
  busy?: boolean | undefined;
  title?: string | undefined;
  className?: string | undefined;
  /** For a colour of its own (a lane's, a tint's): `rows` Pill sets `--c`. */
  style?: CSSProperties | undefined;
  children: ReactNode;
}) {
  return (
    <Badge
      className={cn(TAG, TAG_TONE[tone], dot && DOT, className)}
      {...(style ? { style } : {})}
      {...tipProps(title)}
    >
      <span className="min-w-0 truncate">{children}</span>
      <RingSlot on={!!busy} />
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

/**
 * A segmented switch (the artifact's `.seg`): one choice of a few, each a pressed button. An item
 * at work shows the ring after its label while `busy`; it moves for the ring and moves back.
 */
export function Seg<T extends string>({
  label,
  items,
  value,
  onChange,
  dense = false,
  fill = false,
  className,
}: {
  /** What the group picks, for assistive tech. */
  label: string;
  items: readonly { value: T; label: ReactNode; busy?: boolean | undefined }[];
  value: T;
  onChange: (value: T) => void;
  /** The small switch for a tool row ("Table / By line"): 12.5 px words, less pad. */
  dense?: boolean | undefined;
  /** Fill the row: each choice takes an equal share. */
  fill?: boolean | undefined;
  className?: string | undefined;
}) {
  return (
    // biome-ignore lint/a11y/useSemanticElements: a group of toggle buttons, as the artifact draws it.
    <div
      role="group"
      aria-label={label}
      data-size={dense ? "dense" : undefined}
      data-fill={fill || undefined}
      className={cn("ui-seg", className)}
    >
      {items.map((i) => (
        <button
          key={i.value}
          type="button"
          aria-pressed={i.value === value}
          onClick={() => onChange(i.value)}
        >
          {i.label}
          <RingSlot on={!!i.busy} />
        </button>
      ))}
    </div>
  );
}

/**
 * Progress toward a goal (the artifact's `.track`): an 8 px bar, the accent grown to `value` of
 * `max` on the spring. With `label`, the words sit over it ("This week: 1 of 3 done").
 */
export function Track({
  value,
  max = 1,
  label,
  name,
  className,
}: {
  value: number;
  max?: number;
  label?: ReactNode;
  /** What it measures, for assistive tech, when `label` is not plain words. */
  name?: string | undefined;
  className?: string | undefined;
}) {
  const share = max > 0 ? Math.min(1, Math.max(0, value / max)) : 0;
  const bar = (
    <div
      role="progressbar"
      aria-label={name}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={value}
      className={cn("ui-track", !label && className)}
    >
      <i style={{ width: `${share * 100}%` }} />
    </div>
  );
  if (!label) return bar;
  return (
    <div className={cn("ui-goal", className)}>
      <span>{label}</span>
      {bar}
    </div>
  );
}

/**
 * One line of a check list (the artifact's `.ck`): the box, the words and a small note. Checked,
 * the box fills and grows, the tick draws in, and the words go faint with a hairline strike. Put
 * a few in a `.ui-checks` group (`Checks`).
 */
export function Check({
  checked,
  onChange,
  note,
  disabled,
  children,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  note?: ReactNode;
  disabled?: boolean | undefined;
  children: ReactNode;
}) {
  return (
    <label className="ui-ck">
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.currentTarget.checked)}
      />
      <span>
        {children}
        {note ? <small>{note}</small> : null}
      </span>
    </label>
  );
}

/** A check list: the lines 2 px apart. */
export function Checks({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("ui-checks", className)}>{children}</div>;
}

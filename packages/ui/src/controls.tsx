/** Things you press: square buttons, and pill tags for status. */

import { cn } from "cn";
import type { AnchorHTMLAttributes, ButtonHTMLAttributes, ReactNode } from "react";
import { Badge } from "./components/ui/badge.js";
import { buttonVariants, Button as ShadButton } from "./components/ui/button.js";
import { Icon, type IconName } from "./icons.js";

/** `primary` is the one action on a screen (rust); `secondary` is outlined; `quiet` is text. */
export type ButtonTone = "primary" | "secondary" | "quiet";

interface ButtonLook {
  tone?: ButtonTone | undefined;
  /** `dense` is the console's: 32px, 13px, sentence case. */
  size?: "md" | "sm" | "dense" | undefined;
  icon?: IconName | undefined;
  /** The lander's trailing arrow: this goes somewhere or starts something. */
  arrow?: boolean | undefined;
  children: ReactNode;
  className?: string | undefined;
}

/** shadcn's button, in the kit's look: square, uppercase, rust; ink on hover. */
const BUTTON =
  "h-auto gap-[0.8em] px-[1.6em] py-[1.15em] border-0 rounded-(--ui-radius-button) bg-(--ui-accent) text-(--ui-on-accent) font-(family-name:--ui-font) font-(--ui-button-weight) text-[13.5px]/none tracking-(--ui-button-tracking) [text-transform:var(--ui-button-case)] no-underline cursor-pointer transition-[background-color,color,box-shadow,transform] duration-350 ease-(--ui-ease) hover:bg-(--ui-ink) hover:text-(--ui-on-ink) disabled:opacity-40 focus-visible:ring-0 focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-(--ui-accent)";
const BUTTON_SIZE = { md: "", sm: "px-[1.3em] py-[1em] text-[12.5px]/none", dense: "" };
const DENSE = "h-8 px-3 py-0 text-[13px]/none font-medium tracking-normal [text-transform:none]";
const DENSE_TONE: Record<ButtonTone, string> = {
  primary: DENSE,
  secondary: `${DENSE} shadow-[inset_0_0_0_1px_var(--ui-line)] hover:bg-(--ui-hover) hover:text-(--ui-ink)`,
  quiet: `${DENSE} px-2 no-underline hover:bg-(--ui-hover)`,
};
const BUTTON_TONE: Record<ButtonTone, string> = {
  primary: "",
  secondary:
    "bg-transparent text-(--ui-ink) shadow-[inset_0_0_0_1px_var(--ui-ink)] hover:bg-(--ui-ink) hover:text-(--ui-on-ink)",
  quiet:
    "px-0 py-[0.4em] bg-transparent text-(--ui-ink-2) text-[14px]/none font-medium tracking-normal [text-transform:none] underline decoration-(--ui-ink-3) underline-offset-[0.24em] hover:bg-transparent hover:text-(--ui-ink) hover:decoration-current",
};

const look = ({ tone = "primary", size = "md", className }: ButtonLook) =>
  cn(
    buttonVariants(),
    BUTTON,
    BUTTON_SIZE[size],
    BUTTON_TONE[tone],
    size === "dense" && DENSE_TONE[tone],
    className,
  );

const inside = ({ icon, arrow, children }: ButtonLook) => (
  <>
    {icon ? <Icon name={icon} /> : null}
    <span>{children}</span>
    {arrow ? (
      <Icon
        name="arrow"
        className="transition-transform duration-350 ease-(--ui-ease) group-hover/button:translate-x-[3px]"
      />
    ) : null}
  </>
);

export function Button({
  tone,
  size,
  icon,
  arrow,
  children,
  className,
  type = "button",
  ...rest
}: ButtonLook & Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children" | "className">) {
  const l: ButtonLook = { tone, size, icon, arrow, children, className };
  return (
    <ShadButton type={type} className={look(l)} {...rest}>
      {inside(l)}
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

/** `rust` marks what needs you or what changed; `green` a result; `neutral` the rest. */
export type TagTone = "neutral" | "rust" | "green";

const TAG =
  "h-auto gap-1.5 px-[9px] py-0.5 border-0 rounded-(--ui-radius-tag) text-[12px]/[1.5] font-semibold align-[1px]";
const TAG_TONE: Record<TagTone, string> = {
  neutral: "bg-(--ui-fill) text-(--ui-ink-2)",
  rust: "bg-(--ui-accent-tint) text-(--ui-accent)",
  green: "bg-(--ui-good-tint) text-(--ui-good-ink)",
};
const DOT = "before:size-1.5 before:rounded-full before:bg-current before:content-['']";

/** shadcn's badge as the kit's status pill. */
export function Tag({
  tone = "neutral",
  dot = false,
  title,
  className,
  children,
}: {
  tone?: TagTone;
  dot?: boolean;
  title?: string | undefined;
  className?: string | undefined;
  children: ReactNode;
}) {
  return (
    <Badge className={cn(TAG, TAG_TONE[tone], dot && DOT, className)} title={title}>
      {children}
    </Badge>
  );
}

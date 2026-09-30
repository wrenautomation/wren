/** Things you press or pick: square buttons, underline tabs, pill tags for status, a search box. */
import {
  type AnchorHTMLAttributes,
  type ButtonHTMLAttributes,
  type ReactNode,
  useEffect,
  useState,
} from "react";
import { cx, num } from "./format.js";
import { Icon, type IconName } from "./icons.js";

/** `primary` is the one action on a screen (rust); `secondary` is outlined; `quiet` is text. */
export type ButtonTone = "primary" | "secondary" | "quiet";

interface ButtonLook {
  tone?: ButtonTone | undefined;
  size?: "md" | "sm" | undefined;
  icon?: IconName | undefined;
  /** The lander's trailing arrow: this goes somewhere or starts something. */
  arrow?: boolean | undefined;
  children: ReactNode;
  className?: string | undefined;
}

const look = ({ tone = "primary", size = "md", className }: ButtonLook) =>
  cx("ui-btn", `ui-btn-${tone}`, size === "sm" && "ui-btn-sm", className);

const inside = ({ icon, arrow, children }: ButtonLook) => (
  <>
    {icon ? <Icon name={icon} /> : null}
    <span>{children}</span>
    {arrow ? <Icon name="arrow" className="ui-btn-arrow" /> : null}
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
    <button type={type} className={look(l)} {...rest}>
      {inside(l)}
    </button>
  );
}

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
    <a className={look(l)} {...rest}>
      {inside(l)}
    </a>
  );
}

export interface TabItem {
  id: string;
  label: string;
  href: string;
  count?: number | undefined;
}

/** Filters as underline tabs. Each is a link, so the URL keeps the choice. */
export function Tabs({
  items,
  current,
  label,
  children,
}: {
  items: TabItem[];
  current: string;
  label: string;
  /** Beside the tabs, right-aligned: a search, an action. */
  children?: ReactNode;
}) {
  return (
    <div className="ui-tabs-row">
      <nav className="ui-tabs" aria-label={label}>
        {items.map((t) => (
          <a key={t.id} href={t.href} aria-current={t.id === current ? "true" : undefined}>
            {t.label}
            {t.count !== undefined ? <span className="ui-tabs-n">{num(t.count)}</span> : null}
          </a>
        ))}
      </nav>
      {children ? <div className="ui-tabs-extra">{children}</div> : null}
    </div>
  );
}

/** `rust` marks what needs you or what changed; `green` a result; `neutral` the rest. */
export type TagTone = "neutral" | "rust" | "green";

export function Tag({
  tone = "neutral",
  dot = false,
  title,
  children,
}: {
  tone?: TagTone;
  dot?: boolean;
  title?: string;
  children: ReactNode;
}) {
  return (
    <span className={cx("ui-tag", `ui-tag-${tone}`, dot && "ui-tag-dot")} title={title}>
      {children}
    </span>
  );
}

/** A search box that asks on Enter, so each search is one request and one URL. */
export function SearchField({
  value,
  label,
  placeholder,
  onSearch,
}: {
  value: string;
  label: string;
  placeholder?: string;
  onSearch: (value: string) => void;
}) {
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  return (
    <form
      className="ui-search"
      onSubmit={(e) => {
        e.preventDefault();
        onSearch(v.trim());
      }}
    >
      <Icon name="search" />
      <input
        type="search"
        value={v}
        placeholder={placeholder}
        aria-label={label}
        onChange={(e) => setV(e.target.value)}
      />
    </form>
  );
}

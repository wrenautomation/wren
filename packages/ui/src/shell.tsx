/**
 * The app frame: a gray canvas, a sidebar with the workspace and its products' pages, and one
 * white window with the breadcrumb on top. On a phone the sidebar becomes a menu under a top bar.
 */
import { type ReactNode, useEffect, useRef, useState } from "react";
import { Tag } from "./controls.js";
import { cx, initials, num } from "./format.js";
import { Icon, type IconName } from "./icons.js";
import { type Theme, usePageTheme } from "./theme.js";

export interface NavItem {
  id: string;
  label: string;
  href: string;
  icon: IconName;
  count?: number | undefined;
}

/** One product and its pages. */
export interface NavGroup {
  id: string;
  label: string;
  items: NavItem[];
}

export interface Crumb {
  label: string;
  href?: string | undefined;
}

export interface WorkspaceOption {
  id: string;
  name: string;
}

export interface Workspace {
  /** Null while it loads. */
  current: WorkspaceOption | null;
  options: WorkspaceOption[];
  /** The line under the name ("Demo workspace"). */
  caption: string;
  onPick: (id: string) => void;
}

/** A note that stays on screen: in the sidebar on a computer, folded above the page on a phone. */
export interface ShellNotice {
  label: string;
  lead: ReactNode;
  body: ReactNode;
  /** The phone's unfold link ("What's real"). */
  more: string;
}

export interface Brand {
  name: string;
  href: string;
  /** The square stamp image. */
  stamp: string;
}

export function AppShell({
  brand,
  workspace,
  nav,
  current,
  crumbs,
  actions,
  notice,
  page,
  theme,
  className,
  children,
}: {
  brand: Brand;
  workspace: Workspace;
  nav: NavGroup[];
  /** The id of the page on screen. */
  current: string;
  crumbs: Crumb[];
  actions?: ReactNode;
  notice?: ShellNotice | undefined;
  /** Changes when the page does, which scrolls back to the top. */
  page: string;
  /** The client's look; without one it's Wren's. */
  theme?: Theme | undefined;
  className?: string | undefined;
  children: ReactNode;
}) {
  usePageTheme(theme);
  const [open, setOpen] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: a new page starts at its top.
  useEffect(() => {
    scroller.current?.scrollTo(0, 0);
    scrollTo(0, 0);
  }, [page]);

  useEffect(() => {
    if (!open) return;
    const root = document.documentElement;
    root.classList.add("ui-menu-open");
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    addEventListener("keydown", onKey);
    return () => {
      root.classList.remove("ui-menu-open");
      removeEventListener("keydown", onKey);
    };
  }, [open]);

  const last = crumbs.length - 1;
  return (
    <div className={cx("ui-app", className)}>
      <a className="ui-skip" href="#main">
        Skip to content
      </a>

      <header className="ui-top">
        <a className="ui-brand" href={brand.href} aria-label={brand.name}>
          <img className="ui-stamp" src={brand.stamp} alt="" width={28} height={28} />
        </a>
        <span className="ui-top-name">{workspace.current?.name ?? ""}</span>
        <button
          type="button"
          className="ui-top-menu"
          aria-expanded={open}
          aria-controls="ui-side"
          aria-label={open ? "Close menu" : "Menu"}
          onClick={() => setOpen((o) => !o)}
        >
          <Icon name={open ? "close" : "menu"} size={18} />
        </button>
      </header>

      <aside id="ui-side" className="ui-side" data-open={open}>
        <a className="ui-brand" href={brand.href}>
          <img className="ui-stamp" src={brand.stamp} alt="" width={26} height={26} />
          <span>{brand.name}</span>
        </a>
        <WorkspaceCard workspace={workspace} />
        <nav className="ui-nav" aria-label="Pages">
          {nav.map((g) => (
            <div key={g.id} className="ui-nav-group">
              <p className="ui-nav-label" id={`ui-nav-${g.id}`}>
                {g.label}
              </p>
              <ul aria-labelledby={`ui-nav-${g.id}`}>
                {g.items.map((it) => (
                  <li key={it.id}>
                    <a
                      href={it.href}
                      aria-current={it.id === current ? "page" : undefined}
                      onClick={() => setOpen(false)}
                    >
                      <Icon name={it.icon} />
                      <span>{it.label}</span>
                      {it.count !== undefined ? (
                        <span className="ui-nav-count">{num(it.count)}</span>
                      ) : null}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>
        {notice ? (
          <div className="ui-side-notice">
            <p>
              <Tag tone="rust">{notice.label}</Tag> {notice.lead}
            </p>
            <p>{notice.body}</p>
          </div>
        ) : null}
      </aside>

      <div className="ui-window" ref={scroller}>
        <header className="ui-head">
          <nav className="ui-crumbs" aria-label="Breadcrumb">
            <ol>
              {crumbs.map((c, i) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: a trail never reorders.
                <li key={i}>
                  {i ? <Icon name="right" size={12} /> : null}
                  {c.href && i < last ? (
                    <a href={c.href}>{c.label}</a>
                  ) : (
                    <span aria-current={i === last ? "page" : undefined}>{c.label}</span>
                  )}
                </li>
              ))}
            </ol>
          </nav>
          {actions ? <div className="ui-head-actions">{actions}</div> : null}
        </header>
        <main className="ui-main" id="main" tabIndex={-1}>
          {notice ? (
            <details className="ui-notice">
              <summary>
                <Tag tone="rust">{notice.label}</Tag>
                <span>{notice.lead}</span>
                <span className="ui-notice-more">{notice.more}</span>
              </summary>
              <p className="ui-notice-body">{notice.body}</p>
            </details>
          ) : null}
          {children}
        </main>
      </div>
    </div>
  );
}

function WorkspaceCard({ workspace }: { workspace: Workspace }) {
  const { current, options, caption, onPick } = workspace;
  if (!current)
    return (
      <div className="ui-ws" aria-busy="true">
        <span className="ui-ws-mark ui-ws-ghost" />
        <span className="ui-ws-text">
          <span className="ui-ghost" />
        </span>
      </div>
    );
  const face = (
    <>
      <span className="ui-ws-mark" aria-hidden="true">
        {initials(current.name)}
      </span>
      <span className="ui-ws-text">
        <span className="ui-ws-name">{current.name}</span>
        <span className="ui-ws-caption">{caption}</span>
      </span>
    </>
  );
  if (options.length < 2) return <div className="ui-ws">{face}</div>;
  return (
    <label className="ui-ws ui-ws-pick">
      {face}
      <Icon name="down" className="ui-ws-chev" />
      <select value={current.id} onChange={(e) => onPick(e.target.value)} aria-label="Workspace">
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.name}
          </option>
        ))}
      </select>
    </label>
  );
}

/** A whole screen for before there's a workspace: signing in failed, or nothing is linked yet. */
export function Gate({
  stamp,
  title,
  theme,
  className,
  children,
}: {
  stamp: string;
  title: string;
  theme?: Theme | undefined;
  className?: string | undefined;
  children: ReactNode;
}) {
  usePageTheme(theme);
  return (
    <main className={cx("ui-gate", className)}>
      <div className="ui-gate-card">
        <img className="ui-stamp" src={stamp} alt="" width={36} height={36} />
        <h1>{title}</h1>
        {children}
      </div>
    </main>
  );
}

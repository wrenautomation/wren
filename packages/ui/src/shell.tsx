/**
 * The app frame: a slim bar on the gray canvas (whose workspace, and the viewer's own buttons)
 * over one white window. Outside any app the window holds the launcher, a card per app. Inside
 * one, the window's head names the app, links back to all of them, and runs the app's pages as
 * tabs. Apps can keep coming without the frame growing, and nothing hides behind a menu on a
 * phone: the tabs scroll sideways.
 */
import { type ReactNode, useEffect, useRef } from "react";
import { Tag } from "./controls.js";
import { cx, initials, num } from "./format.js";
import { Icon, type IconName } from "./icons.js";
import { type Theme, usePageTheme } from "./theme.js";

/** One of an app's pages, as a tab. */
export interface NavItem {
  id: string;
  label: string;
  href: string;
  count?: number | undefined;
}

/** The app on screen. */
export interface OpenApp {
  name: string;
  icon: IconName;
  /** Its first page. */
  href: string;
  tabs: NavItem[];
  /** The id of the tab on screen. */
  current: string;
  /** Its one button, at the head's right. */
  action?: ReactNode;
}

export interface WorkspaceOption {
  id: string;
  name: string;
}

export interface Workspace {
  /** Null while it loads. */
  current: WorkspaceOption | null;
  options: WorkspaceOption[];
  /** A word after the name ("Demo"). */
  caption?: string | undefined;
  /** With one option, the name links here (the client's account). */
  href?: string | undefined;
  /** What the name leads to, or the switcher picks ("Account", "Client"). */
  label: string;
  onPick: (id: string) => void;
}

/** A note that stays on every page, folded above it: the label and lead show, the body unfolds. */
export interface ShellNotice {
  label: string;
  lead: ReactNode;
  body: ReactNode;
  /** The unfold link ("What's real"). */
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
  launcher,
  app,
  actions,
  notice,
  page,
  theme,
  className,
  children,
}: {
  brand: Brand;
  workspace: Workspace;
  /** Where "All apps" goes. Left out when there's only one app to go to. */
  launcher?: string | undefined;
  /** Null on the launcher. */
  app: OpenApp | null;
  /** The viewer's own buttons, top right. */
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
  const scroller = useRef<HTMLDivElement>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: a new page starts at its top.
  useEffect(() => {
    scroller.current?.scrollTo(0, 0);
    scrollTo(0, 0);
  }, [page]);

  return (
    <div className={cx("ui-app", className)}>
      <a className="ui-skip" href="#main">
        Skip to content
      </a>

      <header className="ui-bar">
        <a className="ui-brand" href={brand.href}>
          <img className="ui-stamp" src={brand.stamp} alt="" width={26} height={26} />
          <span className="ui-brand-name">{brand.name}</span>
        </a>
        <span className="ui-slash" aria-hidden="true">
          /
        </span>
        <WorkspacePick workspace={workspace} />
        {actions ? <div className="ui-bar-actions">{actions}</div> : null}
      </header>

      <div className="ui-window" ref={scroller}>
        {app ? <AppHead app={app} launcher={launcher} /> : null}
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

function AppHead({ app, launcher }: { app: OpenApp; launcher: string | undefined }) {
  return (
    <header className="ui-apphead">
      <div className="ui-apphead-row">
        {launcher ? (
          <>
            <a className="ui-back" href={launcher} aria-label="All apps">
              <Icon name="apps" />
              <span>All apps</span>
            </a>
            <span className="ui-slash" aria-hidden="true">
              /
            </span>
          </>
        ) : null}
        <a className="ui-appname" href={app.href}>
          <span className="ui-appmark" aria-hidden="true">
            <Icon name={app.icon} />
          </span>
          {app.name}
        </a>
        {app.action ? <div className="ui-apphead-action">{app.action}</div> : null}
      </div>
      <nav className="ui-apptabs" aria-label={`${app.name} pages`}>
        <ul>
          {app.tabs.map((t) => (
            <li key={t.id}>
              <a href={t.href} aria-current={t.id === app.current ? "page" : undefined}>
                {t.label}
                {t.count !== undefined ? <span className="ui-tabs-n">{num(t.count)}</span> : null}
              </a>
            </li>
          ))}
        </ul>
      </nav>
    </header>
  );
}

/** Whose workspace this is: a name (a link when it has one), or a switcher when there's more than one. */
function WorkspacePick({ workspace }: { workspace: Workspace }) {
  const { current, options, caption, href, label, onPick } = workspace;
  if (!current)
    return (
      <span className="ui-ws" aria-busy="true">
        <span className="ui-ws-mark ui-ws-ghost" />
        <span className="ui-ghost" />
      </span>
    );
  const face = (
    <>
      <span className="ui-ws-mark" aria-hidden="true">
        {initials(current.name)}
      </span>
      <span className="ui-ws-name">{current.name}</span>
      {caption ? <span className="ui-ws-caption">{caption}</span> : null}
    </>
  );
  if (options.length < 2)
    return href ? (
      <a className="ui-ws ui-ws-pick" href={href} title={label}>
        {face}
      </a>
    ) : (
      <span className="ui-ws">{face}</span>
    );
  return (
    <label className="ui-ws ui-ws-pick">
      {face}
      <Icon name="down" className="ui-ws-chev" />
      <select value={current.id} onChange={(e) => onPick(e.target.value)} aria-label={label}>
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

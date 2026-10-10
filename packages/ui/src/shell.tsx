/**
 * The app frame: a slim bar on the gray canvas (whose workspace, and the viewer's own buttons)
 * over one white window. A sidebar on the canvas holds home, the pins and every app under its
 * area; the open app unfolds there into its pages. On a phone the sidebar becomes the window's
 * head, the open app's pages tabs that scroll sideways, and home lists the apps.
 */
import { type DragEvent, type ReactNode, useEffect, useRef, useState } from "react";
import { Skeleton } from "./components/ui/skeleton.js";
import { PinButton, type PinLine, PinnedRail } from "./customize.js";
import { cx, initials, num } from "./format.js";
import { Icon, type IconName } from "./icons.js";
import { type Theme, usePageTheme } from "./theme.js";

/** One of an app's pages, as a tab. */
export interface NavItem {
  id: string;
  label: string;
  href: string;
  count?: number | undefined;
  /** Its heading in the sidebar; on a phone the groups are the first row of tabs. */
  group?: string | undefined;
  /** Nested this deep under the tab above it: a collection inside another. Sidebar only. */
  depth?: number | undefined;
  /** It takes what's dragged onto it: Learn's cards dropped on a collection. */
  drop?: NavDrop | undefined;
}

/** A tab as a drop target: data of `type` dropped on it goes to `onDrop`. */
export interface NavDrop {
  type: string;
  onDrop: (data: string) => void;
}

/** The app on screen. */
export interface OpenApp {
  /** Its row in `areas`, unfolded. */
  id?: string | undefined;
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

/** An app in the sidebar, under its area. */
export interface NavApp {
  id: string;
  name: string;
  icon: IconName;
  href: string;
  /** What waits in it, all its pages. */
  count?: number | undefined;
  /** Shown to the team, not installed for this client: dimmed. */
  off?: boolean | undefined;
}

/** The apps of one job: Inbox, Leads, Marketing. */
export interface NavArea {
  id: string;
  label: string;
  apps: NavApp[];
}

/** The sidebar's first link: Today. */
export interface NavHome {
  label: string;
  href: string;
  count?: number | undefined;
}

/** His pinned pages, on the rail of every app, and the button that pins the one on screen. */
export interface RailPins {
  pins: PinLine[];
  /** The page on screen is pinned. */
  here: boolean;
  /** The page on screen, to mark its pin. */
  current?: string | undefined;
  onToggle: () => void;
  onMove: (from: number, to: number) => void;
  onRemove: (href: string) => void;
  onClear: () => void;
}

export interface WorkspaceOption {
  id: string;
  name: string;
}

export interface Workspace {
  /** Null while it loads. */
  current: WorkspaceOption | null;
  options: WorkspaceOption[];
  /** A chip after the name that links somewhere ("Sample company", to what's real in it). */
  chip?: { label: string; href: string } | undefined;
  /** With one option, the name links here (the client's account). */
  href?: string | undefined;
  /** What the name leads to, or the switcher picks ("Account", "Client"). */
  label: string;
  onPick: (id: string) => void;
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
  home,
  areas,
  app,
  pins,
  actions,
  bar,
  page,
  theme,
  wide = false,
  className,
  children,
}: {
  brand: Brand;
  workspace: Workspace;
  /** Home, from an app's head on a phone. Left out when there's only one app to go to. */
  launcher?: string | undefined;
  /** The sidebar's first link; left out with one app. */
  home?: NavHome | undefined;
  /** Every app by area. Left out (the demo), the sidebar holds the open app alone. */
  areas?: NavArea[] | undefined;
  /** Null at home. */
  app: OpenApp | null;
  /** His pins; left out where nothing is kept (the demo). */
  pins?: RailPins | undefined;
  /** The viewer's own buttons, top right. */
  actions?: ReactNode;
  /** A strip above everything, such as "Viewing as". */
  bar?: ReactNode;
  /** Changes when the page does, which scrolls back to the top. */
  page: string;
  /** The client's look; without one it's Wren's. */
  theme?: Theme | undefined;
  /** The page takes the window's full width (a list of records). */
  wide?: boolean | undefined;
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
    <div className={cx("flex h-dvh flex-col max-[900px]:block max-[900px]:h-auto", className)}>
      <a
        className="fixed top-2.5 left-2.5 z-60 -translate-y-[160%] bg-(--ui-ink) px-3.5 py-2.5 text-[14px] text-(--ui-on-ink) no-underline focus:translate-y-0"
        href="#main"
      >
        Skip to content
      </a>
      {bar}

      <header className="flex h-[54px] min-w-0 flex-none items-center gap-1.5 px-[calc(var(--ui-frame)+8px)] max-[900px]:h-[52px] max-[900px]:bg-(--ui-canvas) max-[900px]:px-2">
        <a
          className={cx(
            HOVER,
            "flex h-9 flex-none items-center gap-[9px] rounded-(--ui-radius) pr-2 pl-1 text-[15px] font-semibold tracking-[-0.01em] no-underline",
          )}
          href={brand.href}
        >
          <img className="flex-none" src={brand.stamp} alt="" width={26} height={26} />
          <span className="max-[900px]:hidden">{brand.name}</span>
        </a>
        <span className={cx(SLASH, "max-[900px]:hidden")} aria-hidden="true">
          /
        </span>
        <WorkspacePick workspace={workspace} />
        {workspace.chip ? (
          <a
            className={cx(
              EASE,
              "flex-none rounded-(--ui-radius) bg-(--ui-fill) px-[7px] py-px text-[12px] font-medium whitespace-nowrap text-(--ui-ink-2) no-underline hover:text-(--ui-ink)",
            )}
            href={workspace.chip.href}
          >
            {workspace.chip.label}
          </a>
        ) : null}
        {actions ? (
          <div className="ml-auto flex flex-none items-center gap-1.5">{actions}</div>
        ) : null}
      </header>

      <div className="flex min-h-0 flex-1 max-[900px]:block">
        {app || areas?.length ? <SideNav app={app} home={home} areas={areas} pins={pins} /> : null}
        <div
          className={cx(
            "min-h-0 flex-1 overflow-y-auto overscroll-contain rounded-(--ui-radius) bg-(--ui-paper) [scrollbar-width:thin] max-[900px]:m-0 max-[900px]:overflow-visible max-[900px]:rounded-none max-[900px]:shadow-none",
            app || areas?.length
              ? "mr-(--ui-frame) mb-(--ui-frame)"
              : "mx-(--ui-frame) mb-(--ui-frame)",
          )}
          ref={scroller}
        >
          {app ? <AppHead app={app} launcher={launcher} home={home?.label} pins={pins} /> : null}
          <main
            className={cx(
              "mx-auto px-11 pt-10 pb-20 outline-none max-[900px]:px-4 max-[900px]:pt-[22px] max-[900px]:pb-16",
              // A new page, or its data after the loader, fades in. Opacity only, so a fixed
              // panel inside keeps the window as its frame.
              "[&>*]:animate-[ui-fade_0.2s_var(--ui-ease)_backwards]",
              wide ? "max-w-none min-[901px]:px-8" : "max-w-(--ui-main-width)",
            )}
            id="main"
            tabIndex={-1}
          >
            {children}
          </main>
        </div>
      </div>
    </div>
  );
}

const EASE = "transition-colors duration-150 ease-(--ui-ease)";
const HOVER = `${EASE} hover:bg-(--ui-hover)`;
const SLASH = "flex-none text-[17px] font-light text-(--ui-ink-3)";
const BACK = `${HOVER} inline-flex h-[34px] items-center gap-2 rounded-(--ui-radius) text-[13.5px] font-medium whitespace-nowrap text-(--ui-ink-2) no-underline hover:text-(--ui-ink)`;
const APPNAME =
  "inline-flex min-w-0 items-center gap-2.5 px-1 font-(family-name:--ui-font-display) text-[17px] font-(--ui-display-weight) tracking-[-0.01em] no-underline";
const APPMARK =
  "grid size-[30px] flex-none place-items-center rounded-(--ui-radius) bg-(--ui-accent-wash) text-(--ui-accent)";
/** The count after a tab's name: what waits on you there, so it reads as a badge, not a footnote. */
const COUNT =
  "ml-auto min-w-5 bg-(--ui-warn-tint) px-1.5 text-center text-[12px]/5 font-semibold text-(--ui-warn-ink) [font-variant-numeric:tabular-nums]";
/** A group's heading, ruled off from the pages above it. */
const GROUP =
  "mt-2.5 border-t border-(--ui-hair) px-2.5 pt-3 pb-1 text-[11.5px] font-semibold tracking-(--ui-label-tracking) text-(--ui-ink-2) [text-transform:var(--ui-label-case)]";
/** The page on screen: paper with a hair frame, bolder, and an accent bar on its left edge. */
const TAB_ON =
  "aria-[current=page]:bg-(--ui-paper) aria-[current=page]:font-semibold aria-[current=page]:text-(--ui-ink) aria-[current=page]:shadow-[inset_0_0_0_1px_var(--ui-hair),inset_3px_0_0_var(--ui-accent)]";

/** A sidebar tab's indent by its depth. */
const DEPTH = ["pl-2.5", "pl-6", "pl-9", "pl-12"];
/** A tab with something dragged over it that it takes. */
const TAB_OVER =
  "bg-(--ui-accent-wash) text-(--ui-ink) shadow-[inset_0_0_0_1.5px_var(--ui-accent)]";

/** One tab in the sidebar: a link that may take what's dropped on it. */
function SideTab({ t, on }: { t: NavItem; on: boolean }) {
  const [over, setOver] = useState(false);
  const className = cx(
    HOVER,
    "flex h-[38px] w-full min-w-0 items-center gap-[11px] rounded-(--ui-radius) pr-2.5 text-[14.5px] font-medium text-(--ui-ink-2) no-underline transition-[background-color,color,box-shadow] hover:text-(--ui-ink)",
    DEPTH[Math.min(t.depth ?? 0, DEPTH.length - 1)],
    TAB_ON,
    over && TAB_OVER,
  );
  const body = (
    <>
      <span className="min-w-0 truncate">{t.label}</span>
      {t.count !== undefined ? <span className={COUNT}>{num(t.count)}</span> : null}
    </>
  );
  const tab = (
    <a className={className} href={t.href} aria-current={on ? "page" : undefined}>
      {body}
    </a>
  );
  const drop = t.drop;
  if (!drop) return tab;
  const takes = (e: DragEvent) => e.dataTransfer.types.includes(drop.type);
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: a drop target; the page has a keyboard way.
    <div
      onDragOver={(e) => {
        if (!takes(e)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        if (!over) setOver(true);
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver(false);
      }}
      onDrop={(e) => {
        setOver(false);
        if (!takes(e)) return;
        e.preventDefault();
        drop.onDrop(e.dataTransfer.getData(drop.type));
      }}
    >
      {tab}
    </div>
  );
}

/** Tabs in runs of one group; a tab with none is a run of its own. */
function runs(tabs: NavItem[]): { group: string | undefined; tabs: NavItem[] }[] {
  const out: { group: string | undefined; tabs: NavItem[] }[] = [];
  for (const t of tabs) {
    const last = out.at(-1);
    if (t.group && last?.group === t.group) last.tabs.push(t);
    else out.push({ group: t.group, tabs: [t] });
  }
  return out;
}

/** A run that shows its group as a heading: a group of more than one page. */
const headed = (r: { group: string | undefined; tabs: NavItem[] } | undefined) =>
  !!r?.group && r.tabs.length > 1;

const total = (tabs: NavItem[]) =>
  tabs.some((t) => t.count !== undefined)
    ? tabs.reduce((n, t) => n + (t.count ?? 0), 0)
    : undefined;

/** An app's row in the sidebar: its mark, its name, what waits in it. */
const APP_ROW = cx(
  HOVER,
  "flex h-9 w-full min-w-0 items-center gap-2.5 rounded-(--ui-radius) px-2.5 text-[14.5px] font-medium text-(--ui-ink-2) no-underline hover:text-(--ui-ink) aria-[current=true]:font-semibold aria-[current=true]:text-(--ui-ink)",
);

/** The open app's pages, under its row: grouped, a group of one page standing alone. */
function AppTabs({ app }: { app: OpenApp }) {
  return (
    <nav aria-label={`${app.name} pages`}>
      <ul className="flex list-none flex-col gap-0.5 pt-0.5 pb-1.5 pl-3">
        {runs(app.tabs).flatMap((r, i, all) => [
          ...(headed(r)
            ? [
                // The first group sits right under the app's row: no rule above it.
                <li
                  key={`g:${r.group}`}
                  className={cx(GROUP, i === 0 && "mt-0 border-t-0 pt-1")}
                  aria-hidden="true"
                >
                  {r.group}
                </li>,
              ]
            : []),
          ...r.tabs.map((t, j) => (
            // A page after a group stands apart, so it doesn't read as that group's last.
            <li
              key={t.id}
              className={
                j === 0 && !headed(r) && headed(all[i - 1])
                  ? "mt-2.5 border-t border-(--ui-hair) pt-2.5"
                  : undefined
              }
            >
              <SideTab t={t} on={t.id === app.current} />
            </li>
          )),
        ])}
      </ul>
      {app.action ? <div className="px-2.5 pb-1.5 pl-5.5">{app.action}</div> : null}
    </nav>
  );
}

/**
 * Beside the window: home, the pins, then every app under its area, the open one unfolded into
 * its pages. An area of one app needs no heading. Without areas, the open app alone.
 */
function SideNav({
  app,
  home,
  areas,
  pins,
}: {
  app: OpenApp | null;
  home: NavHome | undefined;
  areas: NavArea[] | undefined;
  pins: RailPins | undefined;
}) {
  const shown: NavArea[] = areas?.length
    ? areas
    : app
      ? [
          {
            id: "",
            label: "",
            apps: [{ id: app.id ?? "", name: app.name, icon: app.icon, href: app.href }],
          },
        ]
      : [];
  const openId = app ? (app.id ?? "") : null;
  return (
    <aside className="flex w-[248px] flex-none flex-col gap-3 overflow-y-auto pt-1 pr-2.5 pb-4 pl-[calc(var(--ui-frame)+6px)] [scrollbar-width:none] max-[900px]:hidden">
      {home ? (
        <a className={APP_ROW} href={home.href} aria-current={app ? undefined : "true"}>
          <Icon name="home" />
          <span className="min-w-0 truncate">{home.label}</span>
          {home.count ? <span className={COUNT}>{num(home.count)}</span> : null}
        </a>
      ) : null}
      {pins ? (
        <PinnedRail
          pins={pins.pins}
          current={pins.current}
          onMove={pins.onMove}
          onRemove={pins.onRemove}
          onClear={pins.onClear}
        />
      ) : null}
      <nav aria-label="Apps" className="flex flex-col gap-1">
        {shown.map((area) => (
          <section key={area.id} className="flex flex-col gap-0.5">
            {area.apps.length > 1 ? (
              <h2 className={cx(GROUP, "mt-1 border-t-0 pt-1")}>{area.label}</h2>
            ) : null}
            {area.apps.map((a) => {
              const open = a.id === openId && app;
              return (
                <div key={a.id || a.name}>
                  <a
                    className={cx(APP_ROW, a.off && "opacity-55")}
                    href={a.href}
                    aria-current={open ? "true" : undefined}
                  >
                    <Icon name={a.icon} className={open ? "text-(--ui-accent)" : ""} />
                    <span className="min-w-0 truncate">{a.name}</span>
                    {a.count && !open ? <span className={COUNT}>{num(a.count)}</span> : null}
                  </a>
                  {open ? <AppTabs app={app} /> : null}
                </div>
              );
            })}
          </section>
        ))}
      </nav>
      {pins && app ? (
        <div className="mt-auto">
          <PinButton pinned={pins.here} onToggle={pins.onToggle} />
        </div>
      ) : null}
    </aside>
  );
}

const PHONE_TAB =
  "inline-flex items-center gap-2 border-b-2 border-transparent pt-[9px] pb-2 text-[14px] font-medium whitespace-nowrap text-(--ui-ink-2) no-underline transition-colors duration-200 ease-(--ui-ease) hover:text-(--ui-ink) focus-visible:-outline-offset-2 aria-[current=page]:border-(--ui-accent) aria-[current=page]:text-(--ui-ink)";

/** One row of tabs that scrolls sideways, the one on screen scrolled into view. */
function PhoneTabs({
  label,
  tabs,
  current,
}: {
  label: string;
  tabs: NavItem[];
  current: string | undefined;
}) {
  const row = useRef<HTMLUListElement>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new tab on screen scrolls again.
  useEffect(() => {
    const ul = row.current;
    const on = ul?.querySelector<HTMLElement>("[aria-current=page]");
    if (!ul || !on) return;
    ul.scrollLeft = on.offsetLeft - (ul.clientWidth - on.offsetWidth) / 2;
  }, [current]);
  return (
    <nav aria-label={label}>
      <ul
        ref={row}
        className="relative -mb-px flex list-none gap-x-5 overflow-x-auto px-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {tabs.map((t) => (
          <li key={t.id} className="flex-none">
            <a
              className={PHONE_TAB}
              href={t.href}
              aria-current={t.id === current ? "page" : undefined}
            >
              {t.label}
              {t.count !== undefined ? <span className={COUNT}>{num(t.count)}</span> : null}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/**
 * The same on a phone, as the window's head: pages as one row of tabs that scrolls sideways. With
 * groups, the first row is the groups and the second the pages of the one on screen.
 */
function AppHead({
  app,
  launcher,
  home = "Home",
  pins,
}: {
  app: OpenApp;
  launcher: string | undefined;
  home?: string | undefined;
  pins: RailPins | undefined;
}) {
  const groups = runs(app.tabs);
  const here = groups.find((r) => r.tabs.some((t) => t.id === app.current));
  return (
    <header className="sticky top-0 z-5 hidden border-b border-(--ui-hair) bg-(--ui-glass) backdrop-blur-[12px] backdrop-saturate-[1.4] max-[900px]:block">
      <div className="mx-auto flex min-h-[52px] items-center gap-1.5 px-4 pt-1.5">
        {launcher ? (
          <>
            <a className={cx(BACK, "-ml-2 px-2")} href={launcher} aria-label={home}>
              <Icon name="home" />
            </a>
            <span className={SLASH} aria-hidden="true">
              /
            </span>
          </>
        ) : null}
        <a className={cx(APPNAME, "whitespace-nowrap")} href={app.href}>
          <span className={APPMARK} aria-hidden="true">
            <Icon name={app.icon} />
          </span>
          {app.name}
        </a>
        {app.action || pins ? (
          <div className="ml-auto flex items-center gap-2">
            {app.action}
            {pins ? <PinButton pinned={pins.here} onToggle={pins.onToggle} compact /> : null}
          </div>
        ) : null}
      </div>
      <PhoneTabs
        label={`${app.name} pages`}
        tabs={groups.map((r) => ({
          id: r.tabs[0]?.id ?? "",
          // A group of one page is named by that page.
          label: (headed(r) ? r.group : r.tabs[0]?.label) ?? "",
          href: r.tabs[0]?.href ?? "",
          count: total(r.tabs),
        }))}
        current={here?.tabs[0]?.id}
      />
      {here && here.tabs.length > 1 ? (
        <PhoneTabs label={here.group ?? ""} tabs={here.tabs} current={app.current} />
      ) : null}
    </header>
  );
}

const WS = "relative flex h-9 min-w-0 items-center gap-[9px] rounded-(--ui-radius) pr-2.5 pl-[5px]";
const WS_PICK = `${WS} ${HOVER} cursor-pointer no-underline has-[select:focus-visible]:outline-2 has-[select:focus-visible]:outline-offset-2 has-[select:focus-visible]:outline-(--ui-accent)`;
const WS_MARK =
  "grid size-[26px] flex-none place-items-center rounded-(--ui-radius) text-[10.5px] font-semibold tracking-[0.04em]";

/** Whose workspace this is: a name (a link when it has one), or a switcher when there's more than one. */
function WorkspacePick({ workspace }: { workspace: Workspace }) {
  const { current, options, href, label, onPick } = workspace;
  if (!current)
    return (
      <span className={WS} aria-busy="true">
        <Skeleton className={cx(WS_MARK, "bg-(--ui-fill)")} />
        <Skeleton className="h-3 w-[110px]" />
      </span>
    );
  const face = (
    <>
      <span className={cx(WS_MARK, "bg-(--ui-ink) text-(--ui-on-ink)")} aria-hidden="true">
        {initials(current.name)}
      </span>
      <span className="truncate text-[14px] font-semibold">{current.name}</span>
    </>
  );
  if (options.length < 2)
    return href ? (
      <a className={WS_PICK} href={href} title={label}>
        {face}
      </a>
    ) : (
      <span className={WS}>{face}</span>
    );
  return (
    <label className={WS_PICK}>
      {face}
      <Icon name="down" className="flex-none text-(--ui-ink-2)" />
      <select
        className="absolute inset-0 w-full cursor-pointer opacity-0"
        value={current.id}
        onChange={(e) => onPick(e.target.value)}
        aria-label={label}
      >
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
    <main className={cx("grid min-h-dvh place-items-center px-4 py-6", className)}>
      <div className="flex w-[min(440px,100%)] flex-col gap-3.5 rounded-(--ui-radius) bg-(--ui-paper) p-8 [&_form]:flex [&_form]:flex-col [&_form]:gap-3.5 [&_li]:flex [&_li]:items-center [&_li]:justify-between [&_li]:gap-3 [&_li]:border-b [&_li]:border-(--ui-hair) [&_li]:py-1.5 [&_p]:text-(--ui-ink-2) [&_ul]:list-none [&_ul]:border-t [&_ul]:border-(--ui-hair)">
        <img className="mb-1.5 flex-none" src={stamp} alt="" width={36} height={36} />
        <h1 className="font-(family-name:--ui-font-display) text-[24px]/[1.2] font-(--ui-display-weight) tracking-[calc(-0.025em*var(--ui-display-squeeze))]">
          {title}
        </h1>
        {children}
      </div>
    </main>
  );
}

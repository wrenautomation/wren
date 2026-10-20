/**
 * The app frame: one white window on the gray canvas. The sidebar on the canvas holds whose
 * workspace this is, home, the pins, every app under its area and, at its foot, the viewer's own
 * buttons. The open app's pages run down the window's left edge, so the sidebar never changes
 * shape (designs/2026-10-11-portal-look.md). On a phone the sidebar becomes a bar, the open app's
 * pages tabs that scroll sideways, and home lists the apps.
 */
import {
  type CSSProperties,
  type DragEvent,
  type PointerEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { Popover, PopoverContent, PopoverTrigger } from "./components/ui/popover.js";
import { Skeleton } from "./components/ui/skeleton.js";
import { PinButton, type PinLine, PinnedRail } from "./customize.js";
import { WritesIndicator } from "./data/status.js";
import { DISPLAY, type Display, displayVars, PAGES, SIDE } from "./display.js";
import { cx, num, short } from "./format.js";
import {
  DisplayButton,
  type DisplayControl,
  FrameProvider,
  KeysSheet,
  Resizer,
  typingAt,
  useShowKeys,
} from "./frame.js";
import { clipProps, tipProps } from "./hint.js";
import { Icon, type IconName } from "./icons.js";
import { headed, runs, total } from "./phone-nav.js";
import {
  AppsSheet,
  PhoneTabs as PhoneBar,
  PhonePull,
  PhoneTop,
  usePhone,
  usePhoneWalk,
  useScrollKeep,
} from "./phone-shell.js";
import { useHoverMenu } from "./safe-triangle.js";
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
  /** A phone's bottom tabs in it: its daily pages first. Left out, one per run of its pages. */
  dock?: DockItem[] | undefined;
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
  /** Its pages, shown beside its row on hover while it's closed. */
  pages?: NavItem[] | undefined;
}

/** The apps of one job: Inbox, Leads, Marketing. */
export interface NavArea {
  id: string;
  label: string;
  apps: NavApp[];
  /** Shut until opened: its name and what waits in it, one row. The choice is kept. */
  shut?: boolean | undefined;
}

/** The sidebar's first link: Today. */
export interface NavHome {
  label: string;
  href: string;
  count?: number | undefined;
}

/** One of the phone's bottom tabs: Today, an app, or a page he opens every day. */
export interface DockItem {
  id: string;
  label: string;
  icon: IconName;
  href: string;
  count?: number | undefined;
  /** It's on screen. */
  on?: boolean | undefined;
  /** In an app's tabs: the pages under it (a group's), when more than its own id. */
  holds?: string[] | undefined;
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

/** Whose portal this is: one name, never a switcher (View as moves between clients). */
export interface Workspace {
  /** Null while it loads. */
  current: WorkspaceOption | null;
  /** A chip after the name that links somewhere ("Sample company", to what's real in it). */
  chip?: { label: string; href: string } | undefined;
  /** The name links here (the client's account). */
  href?: string | undefined;
  /** What the name leads to ("Account"). */
  label: string;
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
  dock,
  app,
  pins,
  actions,
  bar,
  page,
  theme,
  wide = false,
  bleed = false,
  display,
  customize,
  onGo,
  at,
  deep = false,
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
  /** A phone's bottom tabs, before Menu (every app). Left out, a phone gets Menu at the top. */
  dock?: DockItem[] | undefined;
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
  /** The page fills the window edge to edge: no padding, the window's full height (the Map). */
  bleed?: boolean | undefined;
  /** How he set the frame; left out, the defaults and no Layout button. */
  display?: DisplayControl | undefined;
  /** Under the Layout settings: a link to his own look. */
  customize?: ReactNode;
  /** Opens a page in the app, for ⌥↑ and ⌥↓. */
  onGo?: ((href: string) => void) | undefined;
  /** The address on screen, search and all: a phone keeps each tab's walk by it. */
  at?: string | undefined;
  /** A record's own page, under its list: a phone's tabs give way to its buttons. */
  deep?: boolean | undefined;
  className?: string | undefined;
  children: ReactNode;
}) {
  usePageTheme(theme);
  const scroller = useRef<HTMLDivElement>(null);
  const root = useRef<HTMLDivElement>(null);
  const d = display?.display ?? DISPLAY;
  const [keys, setKeys] = useState(false);
  // A phone's Apps sheet: every app, and the app's pages past its tabs. A new page shuts it.
  const [sheet, setSheet] = useState<"apps" | null>(null);
  const here = at ?? page;
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new page shuts them.
  useEffect(() => setSheet(null), [here]);
  const phone = usePhone();
  const walk = usePhoneWalk({ app, dock, home, at: here });
  const main = useRef<HTMLElement>(null);
  useScrollKeep(phone, here);
  useFrameKeys(display, app, onGo, () => setKeys((o) => !o));
  useShowKeys(useCallback(() => setKeys(true), []));
  // Rows, counts and motion reach the popups too, which sit outside the frame.
  useLayoutEffect(() => {
    const h = document.documentElement.dataset;
    h.density = d.density;
    h.counts = d.counts ? "on" : "off";
    h.motion = d.motion;
  }, [d.density, d.counts, d.motion]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: a new page starts at its top.
  useEffect(() => {
    scroller.current?.scrollTo(0, 0);
    // A phone's window scroll is kept per page instead (useScrollKeep).
    if (!phone) scrollTo(0, 0);
  }, [page]);

  // Every app by area: the sidebar, which on a computer also holds whose workspace this is and
  // the viewer's own buttons. Without areas (the demo), a slim bar over the window holds those.
  const nav = !!areas?.length;
  const folded = nav && d.sideShut;
  const host = () => root.current;
  const custom = display ? (
    <DisplayButton control={display} more={customize} onKeys={() => setKeys(true)} compact />
  ) : null;
  return (
    <div
      ref={root}
      style={displayVars(d) as CSSProperties}
      data-side={folded ? "icons" : "full"}
      data-phone-nav={nav ? "" : undefined}
      className={cx(
        "relative",
        nav
          ? "grid h-dvh grid-cols-[var(--layout-side)_minmax(0,1fr)] grid-rows-[auto_auto_minmax(0,1fr)_auto] [grid-template-areas:'bar_bar'_'top_window'_'nav_window'_'me_window']"
          : "flex h-dvh flex-col",
        // A phone: one column that scrolls as the page, nothing past its sides, clear of the notch.
        "max-[900px]:block max-[900px]:h-auto max-[900px]:overflow-x-clip max-[900px]:pr-[env(safe-area-inset-right)] max-[900px]:pl-[env(safe-area-inset-left)]",
        className,
      )}
    >
      <a
        className="fixed top-2.5 left-2.5 z-60 -translate-y-[160%] bg-(--ui-ink) px-3.5 py-2.5 text-[14px] text-(--ui-on-ink) no-underline focus:translate-y-0"
        href="#main"
      >
        Skip to content
      </a>
      {bar ? <div className="[grid-area:bar]">{bar}</div> : null}

      <header
        className={cx(
          "flex h-[54px] min-w-0 flex-none items-center gap-1.5 px-[calc(var(--ui-frame)+8px)] max-[900px]:h-[calc(52px+env(safe-area-inset-top))] max-[900px]:bg-(--ui-canvas) max-[900px]:px-2 max-[900px]:pt-[env(safe-area-inset-top)]",
          nav && "min-[901px]:contents",
          // A phone: inside an app the bar at the top takes its place, and these move to Apps.
          nav && app && "max-[900px]:hidden",
          nav &&
            !app &&
            "max-[900px]:sticky max-[900px]:top-0 max-[900px]:z-20 max-[900px]:border-b max-[900px]:border-(--ui-hair) max-[900px]:bg-(--ui-glass) max-[900px]:backdrop-blur-[16px]",
        )}
      >
        <div
          className={cx(
            "flex min-w-0 items-center gap-1.5",
            nav &&
              "[grid-area:top] min-[901px]:mt-(--ui-frame) min-[901px]:mb-2 min-[901px]:h-[52px] min-[901px]:pr-2.5 min-[901px]:pl-(--ui-frame)",
            folded && "min-[901px]:justify-center min-[901px]:pr-0",
          )}
        >
          <a
            className={cx(
              HOVER,
              "flex h-9 flex-none items-center gap-[9px] rounded-(--ui-radius) pr-2 pl-1 text-[15px] font-semibold tracking-[-0.01em] no-underline",
              nav && "min-[901px]:pr-1",
            )}
            href={brand.href}
            aria-label={brand.name}
            {...(folded ? tipProps(workspace.current?.name, { side: "right" }) : {})}
          >
            <img className="flex-none" src={brand.stamp} alt="" width={26} height={26} />
            {nav ? null : <span className="max-[900px]:hidden">{brand.name}</span>}
          </a>
          {nav ? null : (
            <span className={cx(SLASH, "max-[900px]:hidden")} aria-hidden="true">
              /
            </span>
          )}
          <div className={cx("flex min-w-0 items-center gap-1.5", folded && "min-[901px]:hidden")}>
            <WorkspaceName workspace={workspace} />
          </div>
          {workspace.chip ? (
            <a
              className={cx(
                EASE,
                folded && "min-[901px]:hidden",
                CHIP,
                "rounded-(--ui-radius) hover:text-(--ui-ink)",
              )}
              href={workspace.chip.href}
              {...tipProps(workspace.chip.label)}
            >
              {workspace.chip.label}
            </a>
          ) : null}
        </div>
        {actions || custom ? (
          <div
            className={cx(
              "ml-auto flex flex-none items-center gap-1.5",
              nav &&
                "[grid-area:me] min-[901px]:mr-2.5 min-[901px]:ml-(--ui-frame) min-[901px]:flex-wrap min-[901px]:border-t min-[901px]:border-(--ui-hair) min-[901px]:py-2.5",
              folded && "min-[901px]:hidden",
            )}
          >
            {custom ? <span className="contents max-[900px]:hidden">{custom}</span> : null}
            {actions}
          </div>
        ) : null}
        {folded ? (
          // Folded, his buttons wait behind one: the sidebar is only as wide as an icon.
          <div className="hidden flex-col items-center gap-1 border-t border-(--ui-hair) py-2.5 pl-(--ui-frame) [grid-area:me] min-[901px]:flex">
            {custom}
            {actions ? (
              <Popover>
                <PopoverTrigger
                  className={ICON_BUTTON}
                  aria-label="You"
                  {...tipProps("You", { side: "right", as: "none" })}
                >
                  <Icon name="more" />
                </PopoverTrigger>
                <PopoverContent
                  side="right"
                  align="end"
                  sideOffset={10}
                  className="w-auto min-w-48 items-stretch gap-1 p-1.5 [&>*]:justify-start"
                >
                  {actions}
                </PopoverContent>
              </Popover>
            ) : null}
          </div>
        ) : null}
      </header>

      {nav ? (
        <SideNav
          app={app}
          home={home}
          areas={areas}
          pins={pins}
          folded={folded}
          pages={!d.pagesShut}
        />
      ) : null}
      {nav && display ? (
        <Resizer
          label="Sidebar"
          width={d.side}
          shut={d.sideShut}
          shutPx={SIDE.shut}
          range={SIDE}
          host={host}
          cssVar="--layout-side"
          style={{ left: "calc(var(--layout-side) - 5px)" }}
          onDone={(n) =>
            display.set(n.shut ? { sideShut: true } : { side: n.width, sideShut: false })
          }
          onReset={() => display.set({ side: DISPLAY.side, sideShut: false })}
        />
      ) : null}
      <div
        className={cx(
          "flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-(--ui-radius-sheet) bg-(--ui-paper) shadow-[var(--ui-raise),var(--ui-lift)] max-[900px]:m-0 max-[900px]:shadow-none max-[900px]:block max-[900px]:overflow-visible max-[900px]:rounded-none",
          nav
            ? "[grid-area:window] my-(--ui-frame) mr-(--ui-frame)"
            : "mx-(--ui-frame) mb-(--ui-frame)",
        )}
      >
        {app ? <AppBar app={app} pins={pins} display={display} /> : null}
        <div className="flex min-h-0 min-w-0 flex-1 max-[900px]:block">
          {/* With a sidebar, the open app's pages fold out under its row there instead. */}
          {app && !nav && !d.pagesShut ? (
            <AppColumn app={app} display={display} host={host} />
          ) : null}
          <div
            // The page's ground, a shade under paper, so its panels read raised on it.
            className="min-h-0 min-w-0 flex-1 overflow-y-auto overscroll-contain bg-(--ui-ground) [scrollbar-width:thin] max-[900px]:overflow-visible"
            ref={scroller}
          >
            {app ? (
              nav ? (
                <PhoneTop app={app} walk={walk} at={here} main={main} pins={pins} deep={deep} />
              ) : (
                <AppHead app={app} launcher={launcher} home={home?.label} pins={pins} />
              )
            ) : null}
            <main
              className={cx(
                // His text size: the page alone, so the frame's controls stay put.
                "[zoom:var(--layout-zoom)]",
                "mx-auto outline-none",
                bleed
                  ? "h-full max-[900px]:h-auto"
                  : "px-10 pt-9 pb-20 max-[900px]:px-4 max-[900px]:pt-[22px] max-[900px]:pb-16",
                // The phone's tabs sit over the page's foot: it scrolls clear of them.
                nav &&
                  (bleed
                    ? "max-[900px]:pb-[calc(72px+env(safe-area-inset-bottom))]"
                    : "max-[900px]:pb-[calc(96px+env(safe-area-inset-bottom))]"),
                // A new page, or its data after the loader, fades in. Opacity only, so a fixed
                // panel inside keeps the window as its frame.
                "[&>*]:animate-[ui-fade_0.2s_var(--ui-ease)_backwards]",
                bleed
                  ? "max-w-none"
                  : wide
                    ? "max-w-none min-[901px]:px-8"
                    : "max-w-(--ui-main-width)",
              )}
              id="main"
              ref={main}
              tabIndex={-1}
            >
              <FrameProvider value={display ?? null}>{children}</FrameProvider>
            </main>
            {/* Offline, or writes not yet answered: one mark for the whole portal. */}
            <WritesIndicator
              className={cx(
                "fixed bottom-3 left-3 z-40 rounded-full border border-(--ui-hair) bg-(--ui-paper) px-2.5 py-1 shadow-(--ui-raise)",
                nav && "max-[900px]:bottom-[calc(72px+env(safe-area-inset-bottom))]",
              )}
            />
          </div>
        </div>
      </div>
      {nav ? (
        <>
          <PhonePull on={phone && !deep} app={!!app} />
          <PhoneBar
            walk={walk}
            app={app}
            hidden={deep}
            apps={sheet === "apps"}
            onApps={() => setSheet(sheet === "apps" ? null : "apps")}
          />
          {phone && sheet === "apps" ? (
            <AppsSheet
              head={
                <>
                  <WorkspaceName workspace={workspace} />
                  {workspace.chip ? (
                    <a
                      className={CHIP}
                      href={workspace.chip.href}
                      {...tipProps(workspace.chip.label)}
                    >
                      {workspace.chip.label}
                    </a>
                  ) : null}
                  <div className="ml-auto flex flex-wrap items-center gap-1.5">{actions}</div>
                </>
              }
              areas={areas ?? []}
              pins={pins}
              app={app}
              walk={walk}
              onClose={() => setSheet(null)}
            />
          ) : null}
        </>
      ) : null}
      {display ? <KeysSheet open={keys} onClose={() => setKeys(false)} /> : null}
    </div>
  );
}

/** Whether a key press is the page's to take: a dialog or a field keeps its own keys. */
const forFrame = (e: KeyboardEvent) =>
  !e.defaultPrevented &&
  !e.metaKey &&
  !e.ctrlKey &&
  !typingAt(e) &&
  !(e.target instanceof Element && e.target.closest("[role=dialog],[role=menu],[role=listbox]"));

/** [ folds the sidebar, ] hides the pages, ? lists every key, ⌥↑ and ⌥↓ step through the app's pages. */
function useFrameKeys(
  display: DisplayControl | undefined,
  app: OpenApp | null,
  onGo: ((href: string) => void) | undefined,
  onKeys: () => void,
) {
  const now = useRef({ display, app, onGo, onKeys });
  now.current = { display, app, onGo, onKeys };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const { display, app, onGo, onKeys } = now.current;
      if (!display || !forFrame(e)) return;
      const d: Display = display.display;
      if (e.altKey) {
        if (!app || !onGo || (e.key !== "ArrowUp" && e.key !== "ArrowDown")) return;
        const at = app.tabs.findIndex((t) => t.id === app.current);
        const to = app.tabs[at + (e.key === "ArrowDown" ? 1 : -1)];
        if (!to) return;
        e.preventDefault();
        onGo(to.href);
      } else if (e.key === "[") {
        e.preventDefault();
        display.set({ sideShut: !d.sideShut });
      } else if (e.key === "]") {
        e.preventDefault();
        display.set({ pagesShut: !d.pagesShut });
      } else if (e.key === "?") {
        e.preventDefault();
        onKeys();
      }
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, []);
}

const EASE = "transition-colors duration-150 ease-(--ui-ease)";
const HOVER = `${EASE} hover:bg-(--ui-hover)`;
/** The workspace's chip ("Account"): it gives way to the name and ends in "…" when long. */
const CHIP =
  "min-w-0 max-w-40 truncate bg-(--ui-fill) px-[7px] py-px text-[12px] font-medium text-(--ui-ink-2) no-underline";
const SLASH = "flex-none text-[17px] font-light text-(--ui-ink-3)";
const ICON_BUTTON = `${HOVER} inline-grid size-8 pointer-coarse:size-11 border-0 bg-transparent p-0 flex-none place-items-center rounded-(--ui-radius) text-(--ui-ink-2) hover:text-(--ui-ink) aria-pressed:text-(--ui-ink) data-[popup-open]:bg-(--ui-hover) data-[popup-open]:text-(--ui-ink)`;
const BACK = `${HOVER} inline-flex h-[34px] items-center gap-2 rounded-(--ui-radius) text-[13.5px] font-medium whitespace-nowrap text-(--ui-ink-2) no-underline hover:text-(--ui-ink)`;
const APPNAME =
  "inline-flex min-w-0 items-center gap-2.5 px-1 font-(family-name:--ui-font-display) text-[17px] font-(--ui-display-weight) tracking-[-0.01em] no-underline";
const APPMARK =
  "grid size-[30px] flex-none place-items-center rounded-(--ui-radius) bg-(--ui-fill) text-(--ui-ink)";
/** The count after a tab's name: what waits on you there, so it reads as a badge, not a footnote. */
const COUNT =
  "ml-auto min-w-5 flex-none in-data-[counts=off]:hidden bg-(--ui-warn-tint) px-1.5 text-center text-[12px]/5 font-semibold text-(--ui-warn-ink) [font-variant-numeric:tabular-nums]";
/** What a count in the sidebar counts, for its hover. */
const waits = (n: number) => tipProps(`${num(n)} waiting on you`);
/** Which sidebar areas he shut or opened, kept in this browser. */
const SHUT_KEY = "wren:areas-shut";
function readShut(): Record<string, boolean> {
  try {
    const v = JSON.parse(localStorage.getItem(SHUT_KEY) ?? "{}");
    return v && typeof v === "object" ? v : {};
  } catch {
    return {};
  }
}
/** A group's heading, ruled off from the pages above it. */
const GROUP =
  "mt-2.5 border-t border-(--ui-hair) px-2.5 pt-3 pb-1 text-[11.5px] font-semibold tracking-(--ui-label-tracking) text-(--ui-ink-2) [text-transform:var(--ui-label-case)]";
/** The page on screen: a lavender wash, bolder, and an accent bar on its left edge. */
const TAB_ON =
  "aria-[current=page]:bg-(--ui-accent-wash) aria-[current=page]:font-semibold aria-[current=page]:text-(--ui-ink) aria-[current=page]:shadow-[inset_3px_0_0_var(--ui-active)]";

/** A sidebar tab's indent by its depth. */
const DEPTH = ["pl-2.5", "pl-6", "pl-9", "pl-12"];
/** A tab with something dragged over it that it takes. */
const TAB_OVER =
  "bg-(--ui-accent-wash) text-(--ui-ink) shadow-[inset_0_0_0_1.5px_var(--ui-active)]";

/** One tab in the sidebar: a link that may take what's dropped on it. */
function SideTab({ t, on }: { t: NavItem; on: boolean }) {
  const [over, setOver] = useState(false);
  const className = cx(
    HOVER,
    // A long label ("Waiting on you") wraps to a second line instead of cutting off.
    "flex min-h-(--layout-tab-row) w-full min-w-0 items-center gap-[11px] rounded-(--ui-radius) py-1.5 pr-2.5 text-[14px] leading-[18px] font-medium text-(--ui-ink-2) no-underline transition-[background-color,color,box-shadow] hover:text-(--ui-ink)",
    DEPTH[Math.min(t.depth ?? 0, DEPTH.length - 1)],
    TAB_ON,
    over && TAB_OVER,
  );
  const body = (
    <>
      <span className="min-w-0 text-pretty [overflow-wrap:anywhere]">{t.label}</span>
      {t.count !== undefined ? (
        <span className={COUNT} {...waits(t.count)}>
          {short(t.count)}
        </span>
      ) : null}
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

/** Folded: the icon alone, centered; what waits is a dot on its corner. */
const FOLDED_ROW = "relative justify-center px-0";
const DOT = "absolute top-1.5 right-1.5 size-1.5 bg-(--ui-warn-ink) in-data-[counts=off]:hidden";

/** An app's row in the sidebar: its mark, its name, what waits in it. */
const APP_ROW = cx(
  HOVER,
  "flex h-(--layout-nav-row) w-full min-w-0 items-center gap-2.5 rounded-(--ui-radius) px-2.5 text-[14px] font-medium text-(--ui-ink-2) no-underline hover:text-(--ui-ink) aria-[current=true]:bg-(--ui-paper) aria-[current=true]:font-semibold aria-[current=true]:text-(--ui-ink) aria-[current=true]:shadow-[inset_0_0_0_1px_var(--ui-hair),inset_3px_0_0_var(--ui-active)]",
);

/** The open app's pages, under its row: grouped, a group of one page standing alone. */
function AppTabs({ app }: { app: OpenApp }) {
  return (
    <nav aria-label={`${app.name} pages`}>
      <ul className="flex list-none flex-col gap-0.5">
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
    </nav>
  );
}

/**
 * The open app on a computer, across the window's top: its name, the page on screen, its one
 * button and the pin. Its pages fold out under its row in the sidebar (`SideNav`), or run down
 * the left edge under it without one (`AppColumn`).
 */
function AppBar({
  app,
  pins,
  display,
}: {
  app: OpenApp;
  pins: RailPins | undefined;
  display: DisplayControl | undefined;
}) {
  const page = app.tabs.find((t) => t.id === app.current);
  const paged = app.tabs.length > 1;
  // Pages hidden, or the sidebar folded to icons: the page's name opens them.
  const hidden = !!(display?.display.pagesShut || display?.display.sideShut) && paged;
  return (
    <div className="flex h-[52px] flex-none items-center gap-2 border-b border-(--ui-hair) bg-(--ui-band) pr-3 pl-3 max-[900px]:hidden">
      {display && paged && !display.display.sideShut ? (
        <button
          type="button"
          className={ICON_BUTTON}
          aria-pressed={!hidden}
          aria-label={hidden ? "Show pages" : "Hide pages"}
          {...tipProps(hidden ? "Show pages" : "Hide pages", { keys: "]", as: "none" })}
          onClick={() => display.set({ pagesShut: !hidden })}
        >
          <Icon name="panel" />
        </button>
      ) : null}
      <a
        className={cx(
          APPNAME,
          HOVER,
          "h-9 rounded-(--ui-radius) pr-2 pl-1 text-[15px] font-semibold",
        )}
        href={app.href}
      >
        <span className={APPMARK} aria-hidden="true">
          <Icon name={app.icon} />
        </span>
        <span className="min-w-0 truncate" {...clipProps()}>
          {app.name}
        </span>
      </a>
      {hidden ? (
        // The pages hidden, the page's name opens them.
        <>
          <span className={SLASH} aria-hidden="true">
            /
          </span>
          <Popover>
            <PopoverTrigger
              className={cx(
                HOVER,
                "inline-flex h-9 min-w-0 items-center gap-1.5 rounded-(--ui-radius) border-0 bg-transparent px-2 text-[15px] font-medium text-(--ui-ink-2) hover:text-(--ui-ink) data-[popup-open]:bg-(--ui-hover)",
              )}
            >
              <span className="min-w-0 truncate" {...clipProps()}>
                {page?.label ?? app.name}
              </span>
              <Icon name="down" className="flex-none" />
            </PopoverTrigger>
            <PopoverContent align="start" className="max-h-[70dvh] w-60 overflow-y-auto p-1.5">
              <AppTabs app={app} />
            </PopoverContent>
          </Popover>
        </>
      ) : page && page.href !== app.href ? (
        <>
          <span className={SLASH} aria-hidden="true">
            /
          </span>
          <span
            className="min-w-0 truncate px-1 text-[15px] font-medium text-(--ui-ink-2)"
            {...clipProps()}
          >
            {page.label}
          </span>
        </>
      ) : null}
      {app.action || pins ? (
        <div className="ml-auto flex flex-none items-center gap-1.5">
          {app.action}
          {pins ? <PinButton pinned={pins.here} onToggle={pins.onToggle} compact /> : null}
        </div>
      ) : null}
    </div>
  );
}

/** The open app's pages on a computer, down the window's left edge, under its bar. */
function AppColumn({
  app,
  display,
  host,
}: {
  app: OpenApp;
  display: DisplayControl | undefined;
  host: () => HTMLElement | null;
}) {
  if (app.tabs.length < 2) return null;
  return (
    <div className="relative flex min-h-0 flex-none max-[900px]:hidden">
      <div className="w-(--layout-pages) overflow-y-auto border-r border-(--ui-hair) px-2 py-3 [scrollbar-width:thin]">
        <AppTabs app={app} />
      </div>
      {display ? (
        <Resizer
          label="Pages"
          width={display.display.pages}
          shut={false}
          shutPx={0}
          range={PAGES}
          host={host}
          cssVar="--layout-pages"
          className="-right-[5px]"
          onDone={(n) =>
            display.set(n.shut ? { pagesShut: true } : { pages: n.width, pagesShut: false })
          }
          onReset={() => display.set({ pages: DISPLAY.pages })}
        />
      ) : null}
    </div>
  );
}

/**
 * An app's pages under its row, folded shut unless it's the open app. Every app keeps its pages
 * mounted, so switching apps slides one shut while the next slides open instead of jumping.
 */
function Fold({ app, open, shown }: { app: NavApp; open: OpenApp | null; shown: boolean }) {
  const tabs = open?.tabs ?? app.pages ?? [];
  if (tabs.length < 2) return null;
  return (
    <div
      className={cx(
        "grid transition-[grid-template-rows,opacity] duration-200 ease-(--ui-ease)",
        shown ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0",
      )}
      inert={!shown}
    >
      <div className="min-h-0 overflow-hidden">
        <div className="mt-0.5 mb-1.5 ml-[18px] border-l border-(--ui-hair) pl-1.5">
          <AppTabs
            app={
              open ?? {
                name: app.name,
                icon: app.icon,
                href: app.href,
                tabs,
                // On its way in, its first page is the one lit.
                current: shown ? (tabs.find((t) => t.href === app.href)?.id ?? "") : "",
              }
            }
          />
        </div>
      </div>
    </div>
  );
}

/** A mouse or trackpad: hover flyouts. Touch never gets them. */
const FINE_POINTER = "(hover: hover) and (pointer: fine)";

/**
 * Beside the window: home, the pins, then every app under its area, the open one marked. An area
 * of one app needs no heading. A closed app's pages show beside its row on hover.
 */
function SideNav({
  app,
  home,
  areas,
  pins,
  folded,
  pages = false,
  drawer = false,
}: {
  app: OpenApp | null;
  home: NavHome | undefined;
  areas: NavArea[] | undefined;
  pins: RailPins | undefined;
  /** Icons alone: every app's name and pages show beside it on hover. */
  folded: boolean;
  /** The open app's pages folded out under its row, one sidebar's width. */
  pages?: boolean;
  /** In a phone's Menu: rows a finger can hit, clear of the notch and the home bar. */
  drawer?: boolean;
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
  // The app row just clicked: lit and folded open at once, before its page has loaded.
  const [going, setGoing] = useState<string | null>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: a landed page ends the wait.
  useEffect(() => {
    setGoing(null);
  }, [openId, app?.current]);
  useEffect(() => {
    if (going === null) return;
    const t = setTimeout(() => setGoing(null), 4000);
    return () => clearTimeout(t);
  }, [going]);
  const lit = (a: NavApp) => (going !== null ? a.id === going : !!app && a.id === openId);
  const [shutPref, setShutPref] = useState<Readonly<Record<string, boolean>>>(readShut);
  const isShut = (a: NavArea) =>
    !folded && (shutPref[a.id] ?? !!a.shut) && !a.apps.some((x) => x.id === openId);
  const toggle = (a: NavArea) => {
    const next = { ...shutPref, [a.id]: !isShut(a) };
    setShutPref(next);
    try {
      localStorage.setItem(SHUT_KEY, JSON.stringify(next));
    } catch {}
  };
  const menu = useHoverMenu();
  const aside = useRef<HTMLElement>(null);
  const [hovers] = useState(
    () => typeof window !== "undefined" && !!window.matchMedia?.(FINE_POINTER).matches,
  );
  const flies = (a: NavApp) =>
    hovers && (folded || (a.id !== openId && (a.pages?.length ?? 0) > 1));
  const hovered = shown.flatMap((s) => s.apps).find((a) => a.id === menu.open?.id && flies(a));
  // Beside its row, moved up as far as it must to fit; hidden until measured.
  const [flyTop, setFlyTop] = useState<number | null>(null);
  const rowTop = menu.open ? menu.open.top - 6 : null;
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new app's pages measure again.
  useLayoutEffect(() => {
    const el = menu.flyoutRef.current;
    setFlyTop(
      rowTop === null || !el
        ? null
        : Math.max(8, Math.min(rowTop, window.innerHeight - 8 - el.offsetHeight)),
    );
  }, [rowTop, hovered?.id]);
  return (
    <aside
      ref={aside}
      className={cx(
        "flex min-h-0 flex-col gap-2 overflow-y-auto [scrollbar-width:none]",
        drawer
          ? "h-full px-3 pt-[calc(52px+env(safe-area-inset-top))] pb-[calc(12px+env(safe-area-inset-bottom))] [--layout-nav-row:44px]"
          : "pr-2.5 pb-3 pl-(--ui-frame) [grid-area:nav] max-[900px]:hidden",
      )}
    >
      {home ? (
        <a
          className={cx(APP_ROW, folded && FOLDED_ROW)}
          href={home.href}
          aria-current={app ? undefined : "true"}
          {...(folded ? tipProps(home.label, { side: "right", as: "none" }) : {})}
        >
          <Icon name="home" />
          <span className={folded ? "sr-only" : "min-w-0 truncate"} {...clipProps()}>
            {home.label}
          </span>
          {home.count ? (
            <span className={folded ? DOT : COUNT} {...(folded ? {} : waits(home.count))}>
              {folded ? null : short(home.count)}
            </span>
          ) : null}
        </a>
      ) : null}
      {pins && !folded ? (
        <PinnedRail
          pins={pins.pins}
          current={pins.current}
          onMove={pins.onMove}
          onRemove={pins.onRemove}
          onClear={pins.onClear}
        />
      ) : null}
      <nav aria-label="Apps" className="flex flex-col gap-2">
        {shown.map((area) => (
          <section key={area.id} className="flex flex-col gap-0.5">
            {area.apps.length > 1 && folded ? (
              <h2 className="mx-1.5 my-1 h-0 overflow-hidden border-t border-(--ui-hair) text-[0px]">
                {area.label}
              </h2>
            ) : area.apps.length > 1 ? (
              <h2 className={cx(GROUP, "mt-0 border-t-0 pt-2 pr-1")}>
                <button
                  type="button"
                  className="flex w-full items-center gap-1.5 rounded-none border-0 bg-transparent p-0 text-left font-[inherit] text-inherit [letter-spacing:inherit] [text-transform:inherit] hover:text-(--ui-ink)"
                  aria-expanded={!isShut(area)}
                  onClick={() => toggle(area)}
                >
                  {area.label}
                  <Icon name={isShut(area) ? "right" : "down"} className="size-3 opacity-70" />
                  {isShut(area) && area.apps.some((x) => x.count) ? (
                    <span
                      className={cx(COUNT, "[text-transform:none] tracking-normal")}
                      {...waits(area.apps.reduce((n, x) => n + (x.count ?? 0), 0))}
                    >
                      {short(area.apps.reduce((n, x) => n + (x.count ?? 0), 0))}
                    </span>
                  ) : null}
                </button>
              </h2>
            ) : null}
            {(isShut(area) ? [] : area.apps).map((a) => {
              const open = a.id === openId && app;
              return (
                <div
                  key={a.id || a.name}
                  {...(flies(a)
                    ? {
                        "data-hover-row": a.id,
                        onPointerEnter: (e: PointerEvent<HTMLDivElement>) =>
                          menu.enter(a.id, e.currentTarget),
                        onPointerLeave: (e: PointerEvent<HTMLDivElement>) => menu.leave(a.id, e),
                      }
                    : {})}
                >
                  <a
                    className={cx(
                      APP_ROW,
                      folded && FOLDED_ROW,
                      // Off: a faded icon and a lighter name; the name keeps its contrast.
                      a.off && "font-normal [&_svg]:opacity-45",
                      hovered?.id === a.id && "bg-(--ui-hover)",
                    )}
                    href={a.href}
                    aria-current={lit(a) ? "true" : undefined}
                    onClick={(e) => {
                      if (e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey)
                        setGoing(a.id);
                    }}
                    {...(folded && !hovers
                      ? tipProps(a.count ? `${a.name}, ${num(a.count)} waiting on you` : a.name, {
                          side: "right",
                          as: "none",
                        })
                      : {})}
                  >
                    <Icon name={a.icon} className={lit(a) ? "text-(--ui-active)" : ""} />
                    <span className={folded ? "sr-only" : "min-w-0 truncate"} {...clipProps()}>
                      {a.name}
                    </span>
                    {a.count ? (
                      <span className={folded ? DOT : COUNT} {...(folded ? {} : waits(a.count))}>
                        {folded ? null : short(a.count)}
                      </span>
                    ) : null}
                  </a>
                  {pages && !folded && !drawer ? (
                    <Fold app={a} open={open || null} shown={lit(a)} />
                  ) : null}
                </div>
              );
            })}
          </section>
        ))}
      </nav>
      {hovered?.pages && menu.open ? (
        // A closed app's pages beside its row; the triangle keeps it open on the way over.
        <div
          ref={menu.flyoutRef}
          className="fixed z-40 w-56 overflow-y-auto rounded-(--ui-radius-sheet) bg-(--ui-paper) p-1.5 shadow-(--ui-float)"
          style={{
            top: flyTop ?? rowTop ?? 8,
            left: (aside.current?.getBoundingClientRect().right ?? 224) - 2,
            maxHeight: "calc(100vh - 16px)",
            visibility: flyTop === null ? "hidden" : "visible",
          }}
          onPointerEnter={menu.enterFlyout}
          onPointerLeave={(e) => menu.leaveFlyout(e)}
        >
          {folded ? (
            <a
              className={cx(
                HOVER,
                "flex h-8 items-center gap-2 rounded-(--ui-radius) px-2.5 text-[13.5px] font-semibold no-underline",
                (hovered.pages?.length ?? 0) > 1 && "mb-1 border-b border-(--ui-hair) pb-1",
              )}
              href={hovered.href}
            >
              {hovered.name}
              {hovered.count ? (
                <span className={COUNT} {...waits(hovered.count)}>
                  {short(hovered.count)}
                </span>
              ) : null}
            </a>
          ) : null}
          {(hovered.pages?.length ?? 0) > 1 ? (
            <AppTabs
              app={{
                name: hovered.name,
                icon: hovered.icon,
                href: hovered.href,
                tabs: hovered.pages ?? [],
                current: hovered.id === openId ? (app?.current ?? "") : "",
              }}
            />
          ) : null}
        </div>
      ) : null}
    </aside>
  );
}

const PHONE_TAB =
  "inline-flex min-h-11 items-center gap-2 border-b-2 border-transparent pt-[9px] pb-2 text-[14px] font-medium whitespace-nowrap text-(--ui-ink-2) no-underline transition-colors duration-200 ease-(--ui-ease) hover:text-(--ui-ink) focus-visible:-outline-offset-2 aria-[current=page]:border-(--ui-active) aria-[current=page]:text-(--ui-ink)";

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
              {t.count !== undefined ? (
                <span className={COUNT} {...waits(t.count)}>
                  {short(t.count)}
                </span>
              ) : null}
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
    // A div, not a header: the workspace bar above is the page's one banner; its tabs are navs.
    <div className="sticky top-0 z-5 hidden border-b pt-[env(safe-area-inset-top)] border-(--ui-hair) bg-(--ui-glass) backdrop-blur-[12px] backdrop-saturate-[1.4] max-[900px]:block">
      <div className="mx-auto flex min-h-[52px] items-center gap-1.5 px-4 pt-1.5">
        {launcher ? (
          <>
            <a className={cx(BACK, "-ml-3 h-11 px-3")} href={launcher} aria-label={home}>
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
    </div>
  );
}

const WS = "relative flex h-9 min-w-0 items-center gap-1.5 rounded-(--ui-radius) px-2";
const WS_LINK = `${WS} ${HOVER} no-underline`;

/** Whose workspace this is: its name, a link when it has one. */
function WorkspaceName({ workspace }: { workspace: Workspace }) {
  const { current, href, label } = workspace;
  if (!current)
    return (
      <span className={WS} aria-busy="true">
        <Skeleton className="h-3 w-[110px]" />
      </span>
    );
  const face = (
    <span className="truncate text-[14px] font-semibold" {...clipProps()}>
      {current.name}
    </span>
  );
  return href ? (
    <a className={WS_LINK} href={href} {...tipProps(label)}>
      {face}
    </a>
  ) : (
    <span className={WS}>{face}</span>
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
      <div className="flex w-[min(440px,100%)] flex-col gap-3.5 rounded-(--ui-radius-sheet) bg-(--ui-paper) p-8 shadow-(--ui-raise) [&_form]:flex [&_form]:flex-col [&_form]:gap-3.5 [&_li]:flex [&_li]:items-center [&_li]:justify-between [&_li]:gap-3 [&_li]:border-b [&_li]:border-(--ui-hair) [&_li]:py-1.5 [&_p]:text-(--ui-ink-2) [&_ul]:list-none [&_ul]:border-t [&_ul]:border-(--ui-hair)">
        <img className="mb-1.5 flex-none" src={stamp} alt="" width={36} height={36} />
        <h1 className="font-(family-name:--ui-font-display) text-[24px]/[1.2] font-(--ui-display-weight) tracking-[calc(-0.025em*var(--ui-display-squeeze))]">
          {title}
        </h1>
        {children}
      </div>
    </main>
  );
}

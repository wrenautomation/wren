/**
 * The shell on a phone, under 900px, walked as the big apps are walked. At home the bottom tabs
 * are the daily picks; inside an app they're that app's own pages, with Apps last to switch. Each
 * tab keeps its stack, so a tap on another tab and back lands where he was, scrolled where he
 * was. The bar at the top is iOS's: back, named for where it goes, the page's title once its own
 * heading scrolls under, and the app's buttons.
 */
import { cn } from "cn";
import {
  type ReactNode,
  type RefObject,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { PinButton } from "./customize.js";
import { num } from "./format.js";
import { Icon, type IconName } from "./icons.js";
import { BottomSheet, EDGE, PullToRefresh, Segmented, useSheet } from "./phone.js";
import {
  type BarTab,
  backOf,
  barOf,
  headed,
  MORE,
  pathOfUrl,
  runs,
  type Step,
  stepTo,
  type TabPage,
  tabOfPage,
  tapOf,
} from "./phone-nav.js";
import type { DockItem, NavArea, NavHome, OpenApp, RailPins } from "./shell.js";

export const PHONE = "(max-width: 900px)";

/** Under 900px: the phone's walk is on. */
export function usePhone(): boolean {
  const [on, setOn] = useState(
    () => typeof window !== "undefined" && !!window.matchMedia?.(PHONE).matches,
  );
  useEffect(() => {
    const m = window.matchMedia?.(PHONE);
    if (!m) return;
    const set = () => setOn(m.matches);
    set();
    m.addEventListener("change", set);
    return () => m.removeEventListener("change", set);
  }, []);
  return on;
}

/** Opened from Home Screen: no Safari around it, so its back swipe is ours to give. */
const standalone = () =>
  typeof window !== "undefined" &&
  ((navigator as { standalone?: boolean }).standalone === true ||
    !!window.matchMedia?.("(display-mode: standalone)").matches);

// --- Stacks ---------------------------------------------------------------------------------

/** How the next page was reached: a tab, the app switcher, back, or a link on the page. */
type Move = "tab" | "apps" | "back" | "push";
let NEXT: Move | null = null;
/** The next page was reached this way. */
export const moving = (how: Move) => {
  NEXT = how;
};

interface Stack {
  steps: Step[];
  /** Where it was opened from, another tab or app: the back button at its first page. */
  from?: Step | undefined;
}
interface Walk {
  stacks: Record<string, Stack>;
  /** Each app's last tab. */
  last: Record<string, string>;
}
const WALK = "wren:phone-walk";
const readWalk = (): Walk => {
  try {
    const w = JSON.parse(sessionStorage.getItem(WALK) ?? "") as Walk;
    if (w && typeof w === "object" && w.stacks && w.last) return w;
  } catch {}
  return { stacks: {}, last: {} };
};
const keepWalk = (w: Walk) => {
  try {
    sessionStorage.setItem(WALK, JSON.stringify(w));
  } catch {}
};
/** Where each page was scrolled to, so back and a tab switch land there. */
const SCROLLS = new Map<string, number>();

const HOME_APP = "home";

/** This screen's bottom tabs, the one it sits under, and its stack. */
export function usePhoneWalk({
  app,
  dock,
  home,
  at,
}: {
  app: OpenApp | null;
  dock: DockItem[] | undefined;
  home: NavHome | undefined;
  at: string;
}) {
  const walk = useRef<Walk>({ stacks: {}, last: {} });
  const [, bump] = useState(0);
  // Read once, as the tab opens.
  useLayoutEffect(() => {
    walk.current = readWalk();
    bump((n) => n + 1);
  }, []);

  const appId = app ? (app.id ?? app.name) : HOME_APP;
  const bar = useMemo((): { tabs: BarTab[]; more: TabPage[] } => {
    if (!app) {
      const items = dock ?? (home ? [{ ...home, id: "home", icon: "home" as IconName }] : []);
      return {
        tabs: items.map((d) => ({ ...d, holds: d.holds ?? [d.id] })),
        more: [],
      };
    }
    const picks = app.dock?.map((d) => ({ ...d, holds: d.holds ?? [] }));
    return barOf(app.tabs, picks);
  }, [app, dock, home]);

  const current = app
    ? tabOfPage(bar.tabs, app.current, walk.current.last[appId])
    : (dock?.find((d) => d.on)?.id ?? "home");
  const key = `${appId}:${current ?? ""}`;

  // Each move puts the page in its tab's stack.
  const was = useRef<{ key: string; step: Step } | null>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: `key` names the app and the tab.
  useLayoutEffect(() => {
    const how = NEXT ?? "push";
    NEXT = null;
    const w = walk.current;
    const stack = w.stacks[key];
    const prev = was.current;
    const inStack = !!stack?.steps.some((s) => pathOfUrl(s.url) === pathOfUrl(at));
    // A page walked before, a tab coming back, or a step inside the tab: on its stack. A link from
    // another tab or app opens a fresh one that comes back to it; the switcher starts fresh.
    const next: Stack =
      stack && (inStack || how === "tab" || how === "back" || prev?.key === key)
        ? { ...stack, steps: stepTo(stack.steps, at) }
        : {
            steps: [{ url: at, title: "" }],
            from: how === "push" && prev && prev.key !== key ? prev.step : undefined,
          };
    w.stacks[key] = next;
    if (app && current) w.last[appId] = current;
    keepWalk(w);
    was.current = { key, step: next.steps.at(-1) ?? { url: at, title: "" } };
    bump((n) => n + 1);
  }, [key, at]);

  const stack = walk.current.stacks[key];
  const back = stack ? backOf(stack.steps, stack.from) : undefined;
  return {
    tabs: bar.tabs,
    more: bar.more,
    current,
    back,
    /** The title on screen, kept for the back button that comes back here. */
    title: useCallback(
      (title: string) => {
        const top = walk.current.stacks[key]?.steps.at(-1);
        if (top && top.title !== title) {
          top.title = title;
          if (was.current) was.current.step = top;
          keepWalk(walk.current);
        }
      },
      [key],
    ),
    /** Where a tab tap goes. */
    tap: (tab: BarTab) =>
      tapOf(tab.id === current, walk.current.stacks[`${appId}:${tab.id}`]?.steps, tab.href, at),
    /** An app as he left it. */
    resume: (id: string, href: string) => {
      const tab = walk.current.last[id];
      return (tab && walk.current.stacks[`${id}:${tab}`]?.steps.at(-1)?.url) || href;
    },
  };
}
export type PhoneWalk = ReturnType<typeof usePhoneWalk>;

/** On a phone, the window scrolls: each page's place is kept, and a way back lands there. */
export function useScrollKeep(on: boolean, at: string) {
  const here = useRef(at);
  here.current = at;
  useEffect(() => {
    if (!on) return;
    let raf = 0;
    const save = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => SCROLLS.set(here.current, scrollY));
    };
    addEventListener("scroll", save, { passive: true });
    return () => {
      cancelAnimationFrame(raf);
      removeEventListener("scroll", save);
    };
  }, [on]);
  const path = pathOfUrl(at);
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new page, by its path.
  useLayoutEffect(() => {
    if (!on) return;
    const y = RESTORE ? (SCROLLS.get(at) ?? 0) : 0;
    RESTORE = false;
    scrollTo(0, 0);
    if (!y) return;
    // The page's data lands after it: try until it's tall enough, or he touches it.
    let n = 0;
    let raf = 0;
    const stop = () => cancelAnimationFrame(raf);
    const again = () => {
      const room = document.documentElement.scrollHeight - innerHeight;
      if (room >= y || n++ > 90) return scrollTo(0, Math.min(y, room));
      raf = requestAnimationFrame(again);
    };
    raf = requestAnimationFrame(again);
    addEventListener("touchstart", stop, { once: true, passive: true });
    return () => {
      stop();
      removeEventListener("touchstart", stop);
    };
  }, [on, path]);
}
/** The next page lands where it was left: a back or a tab switch. */
let RESTORE = false;
const landBack = () => {
  RESTORE = true;
};
if (typeof window !== "undefined") addEventListener("popstate", landBack);

// --- The bar at the top ---------------------------------------------------------------------

const BAR_BUTTON =
  "inline-flex h-11 min-w-0 items-center gap-0.5 border-0 bg-transparent p-0 text-[16px] text-(--ui-accent) no-underline active:opacity-50";

/** The heading the page opens with, the one the bar's title takes over from. */
function useHeading(
  main: RefObject<HTMLElement | null>,
  at: string,
  bar: RefObject<HTMLElement | null>,
) {
  const [title, setTitle] = useState("");
  const [under, setUnder] = useState(false);
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new page has a new heading.
  useEffect(() => {
    const root = main.current;
    if (!root) return;
    let seen: Element | null = null;
    let io: IntersectionObserver | null = null;
    const watch = () => {
      const h = root.querySelector("h1") ?? root.querySelector("h2");
      setTitle(h?.textContent?.trim() ?? "");
      if (h === seen) return;
      seen = h;
      io?.disconnect();
      if (!h) return setUnder(true);
      const top = bar.current?.getBoundingClientRect().bottom ?? 56;
      io = new IntersectionObserver(
        ([e]) => setUnder(!!e && !e.isIntersecting && e.boundingClientRect.top < top),
        { rootMargin: `-${Math.round(top)}px 0px 0px 0px` },
      );
      io.observe(h);
    };
    watch();
    // The heading may come with the page's data.
    const mo = new MutationObserver(watch);
    mo.observe(root, { childList: true, subtree: true, characterData: true });
    return () => {
      mo.disconnect();
      io?.disconnect();
    };
  }, [at]);
  return { title, under };
}

/**
 * iOS's navigation bar: back (named for where it goes), the page's title once its heading has
 * scrolled under, the app's buttons. A group's pages sit under it as a segmented control.
 */
export function PhoneTop({
  app,
  walk,
  at,
  main,
  pins,
  deep,
}: {
  app: OpenApp;
  walk: PhoneWalk;
  at: string;
  main: RefObject<HTMLElement | null>;
  pins: RailPins | undefined;
  /** A record's own page: with nothing walked before it, back is its list. */
  deep: boolean;
}) {
  const bar = useRef<HTMLElement>(null);
  const backLink = useRef<HTMLAnchorElement>(null);
  const { title, under } = useHeading(main, at, bar);
  // Its height, for what sticks under it: a list's group heads.
  useEffect(() => {
    const el = bar.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const root = document.documentElement.style;
    const ro = new ResizeObserver(() => root.setProperty("--phone-bar", `${el.offsetHeight}px`));
    ro.observe(el);
    return () => {
      ro.disconnect();
      root.removeProperty("--phone-bar");
    };
  }, []);
  const { title: keep } = walk;
  useEffect(() => {
    if (title) keep(title);
  }, [title, keep]);
  const list = app.tabs.find((t) => t.id === app.current);
  const back = walk.back ?? (deep && list ? { url: list.href, title: list.label } : undefined);
  const group = runs(app.tabs).find((r) => r.tabs.some((t) => t.id === app.current));
  useEdgeBack(back ? backLink : null);
  return (
    <header
      ref={bar}
      className="sticky top-0 z-20 hidden border-b border-(--ui-hair) bg-(--ui-glass) pt-[env(safe-area-inset-top)] backdrop-blur-[16px] backdrop-saturate-[1.6] max-[900px]:block"
    >
      <div className="grid h-12 grid-cols-[minmax(0,1fr)_minmax(0,auto)_minmax(0,1fr)] items-center gap-2 px-2">
        <div className="flex min-w-0 items-center">
          {back ? (
            <a
              ref={backLink}
              className={cn(BAR_BUTTON, "pr-2")}
              href={back.url}
              onClick={(e) => {
                moving("back");
                landBack();
                if ((history.state as { from?: string } | null)?.from === back.url) {
                  e.preventDefault();
                  history.back();
                }
              }}
            >
              <Icon name="left" size={24} className="flex-none" />
              <span className="truncate">{back.title || "Back"}</span>
            </a>
          ) : (
            <a
              className="inline-flex h-11 min-w-0 items-center gap-2 px-2 text-[13px] font-semibold tracking-(--ui-label-tracking) text-(--ui-ink-2) uppercase no-underline"
              href={app.href}
              onClick={() => moving("tab")}
            >
              <Icon name={app.icon} size={16} className="flex-none" />
              <span className="truncate">{app.name}</span>
            </a>
          )}
        </div>
        <span
          className="max-w-[44vw] truncate text-center text-[16px] font-semibold transition-opacity duration-200 ease-(--ui-ease)"
          style={{ opacity: under && title ? 1 : 0 }}
          aria-hidden={!under}
        >
          {title}
        </span>
        <div className="flex min-w-0 items-center justify-end gap-1">
          {app.action}
          {pins ? <PinButton pinned={pins.here} onToggle={pins.onToggle} compact /> : null}
        </div>
      </div>
      {headed(group) && group ? (
        <Segmented
          label={group.group ?? ""}
          className="px-4 pb-2"
          items={group.tabs.map((t) => ({
            id: t.id,
            label: t.label,
            href: t.href,
            count: t.count,
            on: t.id === app.current,
          }))}
        />
      ) : null}
    </header>
  );
}

/**
 * Opened from Home Screen, a swipe in from the left edge goes back, as Safari's does in the
 * browser. In Safari it's left to Safari.
 */
function useEdgeBack(link: RefObject<HTMLAnchorElement | null> | null) {
  const on = !!link;
  useEffect(() => {
    if (!on || !standalone()) return;
    const g = { live: false, x0: 0, y0: 0, dx: 0, t0: 0 };
    const start = (e: TouchEvent) => {
      const t = e.touches[0];
      g.live = !!t && e.touches.length === 1 && t.clientX < EDGE;
      if (!t) return;
      g.x0 = t.clientX;
      g.y0 = t.clientY;
      g.dx = 0;
      g.t0 = e.timeStamp;
    };
    const move = (e: TouchEvent) => {
      const t = e.touches[0];
      if (!g.live || !t) return;
      g.dx = t.clientX - g.x0;
      if (Math.abs(t.clientY - g.y0) > Math.abs(g.dx) + 10) g.live = false;
    };
    const end = (e: TouchEvent) => {
      if (!g.live) return;
      g.live = false;
      const fast = g.dx / Math.max(1, e.timeStamp - g.t0) > 0.5;
      if (g.dx > innerWidth * 0.3 || (fast && g.dx > 40)) link?.current?.click();
    };
    addEventListener("touchstart", start, { passive: true });
    addEventListener("touchmove", move, { passive: true });
    addEventListener("touchend", end);
    return () => {
      removeEventListener("touchstart", start);
      removeEventListener("touchmove", move);
      removeEventListener("touchend", end);
    };
  }, [on, link]);
}

// --- The bottom tabs ------------------------------------------------------------------------

const TAB =
  "relative flex min-w-0 flex-col items-center justify-center gap-[3px] border-0 bg-transparent p-0 pt-1 text-[10.5px] leading-none font-medium text-(--ui-ink-2) no-underline transition-colors duration-150 ease-(--ui-ease) aria-[current=page]:text-(--ui-accent) aria-expanded:text-(--ui-accent)";
/** What waits under a tab: a solid tag at the icon's top right corner, clear of the icon. */
const BADGE =
  "absolute -top-1.5 left-[calc(100%-5px)] min-w-[18px] rounded-(--ui-radius) bg-(--ui-warn-ink) px-[5px] text-center text-[11px]/[17px] font-semibold text-(--ui-paper) [font-variant-numeric:tabular-nums] in-data-[counts=off]:hidden";

function TabFace({
  icon,
  label,
  count,
}: {
  icon: IconName;
  label: string;
  count?: number | undefined;
}) {
  return (
    <>
      <span className="relative">
        <Icon name={icon} size={22} />
        {count ? <span className={BADGE}>{count > 99 ? "99+" : num(count)}</span> : null}
      </span>
      <span className="max-w-full truncate px-1">{label}</span>
    </>
  );
}

/**
 * The tabs at the thumb. A tap on another tab opens it where he left it; on the tab on screen,
 * it goes back to the tab's first page, and from there up to the top. Hidden on a record's own
 * page, which brings its buttons down here instead.
 */
export function PhoneTabs({
  walk,
  app,
  hidden,
  onApps,
  onMore,
  more,
}: {
  walk: PhoneWalk;
  app: OpenApp | null;
  hidden: boolean;
  onApps: () => void;
  onMore: () => void;
  more: boolean;
}) {
  return (
    <nav
      aria-label={app ? `${app.name} tabs` : "Tabs"}
      className={cn(
        "fixed inset-x-0 bottom-0 z-30 hidden border-t border-(--ui-hair) bg-(--ui-glass) pr-[env(safe-area-inset-right)] pb-[env(safe-area-inset-bottom)] pl-[env(safe-area-inset-left)] backdrop-blur-[16px] backdrop-saturate-[1.6]",
        !hidden && "max-[900px]:block",
      )}
    >
      <ul className="mx-auto grid h-[52px] max-w-[640px] list-none auto-cols-fr grid-flow-col">
        {walk.tabs.map((t) => {
          const on = t.id === walk.current;
          if (t.id === MORE)
            return (
              <li key={t.id} className="contents">
                <button
                  type="button"
                  className={TAB}
                  aria-current={on ? "page" : undefined}
                  aria-expanded={more}
                  aria-haspopup="dialog"
                  onClick={onMore}
                >
                  <TabFace icon={t.icon} label={t.label} count={t.count} />
                </button>
              </li>
            );
          const go = walk.tap(t);
          return (
            <li key={t.id} className="contents">
              <a
                className={TAB}
                href={go === "top" ? t.href : go.go}
                aria-current={on ? "page" : undefined}
                onClick={(e) => {
                  if (go === "top") {
                    e.preventDefault();
                    scrollTo({ top: 0, behavior: "smooth" });
                    return;
                  }
                  moving(app ? "tab" : "apps");
                  if (!on) landBack();
                }}
              >
                <TabFace icon={t.icon} label={t.label} count={t.count} />
              </a>
            </li>
          );
        })}
        <li className="contents">
          <button
            type="button"
            className={TAB}
            onClick={onApps}
            aria-haspopup="dialog"
            aria-label="Apps"
          >
            <TabFace icon="apps" label="Apps" />
          </button>
        </li>
      </ul>
    </nav>
  );
}

// --- Sheets: More, and every app ------------------------------------------------------------

const SHEET_ROW =
  "flex min-h-12 items-center gap-3 border-b border-(--ui-hair) px-4 text-[16px] text-(--ui-ink) no-underline active:bg-(--ui-hover) aria-[current=page]:font-semibold aria-[current=page]:text-(--ui-accent)";
const SHEET_HEAD =
  "sticky top-0 z-1 border-b border-(--ui-hair) [background:linear-gradient(var(--ui-band),var(--ui-band)),var(--ui-paper)] px-4 py-1.5 text-[12px] font-semibold tracking-(--ui-label-tracking) text-(--ui-ink-2) uppercase";

/** A link in a sheet: shuts it as it goes. */
function SheetLink({
  href,
  how,
  className,
  current,
  children,
}: {
  href: string;
  how: Move;
  className: string;
  current?: boolean;
  children: ReactNode;
}) {
  const sheet = useSheet();
  return (
    <a
      className={className}
      href={href}
      aria-current={current ? "page" : undefined}
      onClick={() => {
        moving(how);
        if (how === "apps") landBack();
        sheet?.close();
      }}
    >
      {children}
    </a>
  );
}

/** The app's pages that didn't fit in the tabs, as iOS's More list. */
export function MoreSheet({
  app,
  pages,
  onClose,
}: {
  app: OpenApp;
  pages: TabPage[];
  onClose: () => void;
}) {
  return (
    <BottomSheet
      label={`More in ${app.name}`}
      onClose={onClose}
      head={<h2 className="px-4 pt-1 pb-3 text-[17px] font-semibold">More</h2>}
    >
      {runs(pages).map((r) => (
        <section key={`${r.group ?? ""}:${r.tabs[0]?.id}`}>
          {r.group && headed(r) ? <h3 className={SHEET_HEAD}>{r.group}</h3> : null}
          {r.tabs.map((p) => (
            <SheetLink
              key={p.id}
              href={p.href}
              how="tab"
              className={SHEET_ROW}
              current={p.id === app.current}
            >
              <span className="min-w-0 flex-1 truncate">{p.label}</span>
              {p.count ? (
                <span className="text-[14px] text-(--ui-warn-ink) [font-variant-numeric:tabular-nums]">
                  {num(p.count)}
                </span>
              ) : null}
              <Icon name="right" className="flex-none text-(--ui-ink-3)" />
            </SheetLink>
          ))}
        </section>
      ))}
    </BottomSheet>
  );
}

const TILE_BADGE =
  "absolute -top-2 -right-2 min-w-[18px] rounded-(--ui-radius) bg-(--ui-warn-ink) px-[5px] text-center text-[11px]/[17px] font-semibold text-(--ui-paper) [font-variant-numeric:tabular-nums] in-data-[counts=off]:hidden";
const TILE =
  "flex min-w-0 flex-col items-center gap-1.5 py-2 text-center text-[12px] leading-tight font-medium text-(--ui-ink) no-underline active:opacity-60";
const TILE_MARK =
  "relative grid size-14 place-items-center border border-(--ui-hair) bg-(--ui-tile) text-(--ui-ink-2) in-aria-[current=page]:border-(--ui-accent) in-aria-[current=page]:bg-(--ui-accent-tint) in-aria-[current=page]:text-(--ui-accent)";

/**
 * Every app, as a phone's home screen: by area, a grid of marks. Whose workspace it is and his
 * own buttons sit at its head. Opens at half height; pull it up for the rest.
 */
export function AppsSheet({
  head,
  home,
  areas,
  pins,
  app,
  walk,
  onClose,
}: {
  head: ReactNode;
  home: NavHome | undefined;
  areas: NavArea[];
  pins: RailPins | undefined;
  app: OpenApp | null;
  walk: PhoneWalk;
  onClose: () => void;
}) {
  const openId = app ? (app.id ?? "") : null;
  return (
    <BottomSheet label="Apps" onClose={onClose} start="medium">
      <div className="flex flex-wrap items-center gap-1.5 border-b border-(--ui-hair) px-3 pb-3">
        {head}
      </div>
      {home ? (
        <SheetLink href={home.href} how="apps" className={SHEET_ROW} current={!app}>
          <Icon name="home" className="flex-none text-(--ui-ink-2)" />
          <span className="min-w-0 flex-1 truncate">{home.label}</span>
          {home.count ? (
            <span className="text-[14px] text-(--ui-warn-ink) [font-variant-numeric:tabular-nums]">
              {num(home.count)}
            </span>
          ) : null}
        </SheetLink>
      ) : null}
      {pins?.pins.length ? (
        <section>
          <h3 className={SHEET_HEAD}>Pinned</h3>
          {pins.pins.map((p) => (
            <SheetLink
              key={p.href}
              href={p.href}
              how="apps"
              className={SHEET_ROW}
              current={p.href === pins.current}
            >
              <Icon name={p.icon} className="flex-none text-(--ui-ink-2)" />
              <span className="min-w-0 flex-1 truncate">{p.label}</span>
            </SheetLink>
          ))}
        </section>
      ) : null}
      {areas.map((area) => (
        <section key={area.id}>
          <h3 className={SHEET_HEAD}>{area.label}</h3>
          <ul className="grid list-none grid-cols-4 gap-x-2 gap-y-1 px-3 py-3">
            {area.apps.map((a) => (
              <li key={a.id} className="min-w-0">
                <SheetLink
                  href={a.id === openId ? a.href : walk.resume(a.id, a.href)}
                  how="apps"
                  className={cn(TILE, a.off && "opacity-55")}
                  current={a.id === openId}
                >
                  <span className={TILE_MARK}>
                    <Icon name={a.icon} size={24} />
                    {a.count ? (
                      <span className={TILE_BADGE}>{a.count > 99 ? "99+" : num(a.count)}</span>
                    ) : null}
                  </span>
                  <span className="line-clamp-2 w-full break-words">{a.name}</span>
                </SheetLink>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </BottomSheet>
  );
}

/** Pull to refresh, under the bar at the top. */
export function PhonePull({ on, app }: { on: boolean; app: boolean }) {
  return (
    <PullToRefresh
      on={on}
      top={app ? "calc(env(safe-area-inset-top) + 56px)" : "calc(env(safe-area-inset-top) + 60px)"}
    />
  );
}

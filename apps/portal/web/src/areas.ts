/**
 * The sidebar's areas: apps grouped by the job they do (designs/2026-10-10-portal-areas.md).
 * Pages never move between apps; an area only groups them. Wren's and a client's apps share the
 * map: an id a workspace lacks is skipped, and an area left empty isn't shown.
 */
import type { IconName } from "@wren/ui";

export interface Area {
  id: string;
  label: string;
  /** App ids, in sidebar order. */
  apps: readonly string[];
  /** Folds shut until opened: the set-and-forget apps (designs/2026-10-13-primitives-first.md). */
  shut?: boolean;
}

export const AREAS: readonly Area[] = [
  { id: "inbox", label: "Inbox", apps: ["inbox", "texts"] },
  {
    id: "leads",
    label: "Leads",
    apps: ["pipeline", "leads", "people", "outbound", "deals", "calls", "reactivation"],
  },
  { id: "marketing", label: "Marketing", apps: ["marketing", "ads", "sites", "learn"] },
  {
    id: "automations",
    label: "Automations",
    shut: true,
    apps: ["workflows", "loops", "library", "marketplace", "voice"],
  },
  {
    id: "business",
    label: "Business",
    apps: ["work", "clients", "money", "payments", "documents", "team"],
  },
  {
    id: "tools",
    label: "Tools",
    shut: true,
    apps: ["notes", "calendar", "ask", "review", "handlers", "settings"],
  },
];

/** The last area, where an app no area names goes, so a new app always shows. */
const REST = "tools";

/** These apps by area, in area order; areas with none left out. */
export function areasOf<T extends { id: string }>(apps: readonly T[]): { area: Area; apps: T[] }[] {
  const named = new Set(AREAS.flatMap((a) => a.apps));
  return AREAS.map((area) => ({
    area,
    apps: [
      ...area.apps.flatMap((id) => apps.filter((m) => m.id === id)),
      ...(area.id === REST ? apps.filter((m) => !named.has(m.id)) : []),
    ],
  })).filter((a) => a.apps.length);
}

/** One of a phone's bottom tabs: an app, or one of its pages under its own name and icon. */
export interface DockPick {
  app: string;
  page?: string;
  label?: string;
  icon?: IconName;
}

/** What Wren's team opens every day, at a phone's thumb: approve, make, reply. */
export const DOCK: readonly DockPick[] = [
  { app: "inbox" },
  { app: "marketing", page: "studio", label: "Studio", icon: "write" },
  { app: "marketing", page: "engage", label: "Engage", icon: "reply" },
];

/**
 * A phone's tabs after Today: the daily picks this workspace has, then its first apps by area,
 * up to `size`. A client without Marketing gets its own first apps.
 */
export function dockOf<T extends { id: string; pages: readonly { id: string }[] }>(
  apps: readonly T[],
  size = 3,
): { app: T; pick: DockPick }[] {
  const has = (p: DockPick) =>
    apps.find((m) => m.id === p.app && (!p.page || m.pages.some((x) => x.id === p.page)));
  const out = DOCK.flatMap((pick) => {
    const app = has(pick);
    return app ? [{ app, pick }] : [];
  });
  for (const { apps: inArea } of areasOf(apps))
    for (const app of inArea)
      if (out.length < size && !out.some((o) => o.app.id === app.id))
        out.push({ app, pick: { app: app.id } });
  return out.slice(0, size);
}

/** One of an app's own bottom tabs on a phone: a page, under a short name and its icon. */
export interface TabPick {
  page: string;
  label?: string;
  icon: IconName;
}

/**
 * The pages each app's phone tabs lead with, as a phone app's tab bar would: three a day's work
 * runs through, the rest under More. An app named here gets these; any other gets a tab per page
 * or group, in its own order.
 */
export const PHONE_TABS: Readonly<Record<string, readonly TabPick[]>> = {
  marketing: [
    { page: "plan", icon: "calendar" },
    { page: "studio", icon: "write" },
    { page: "engage", icon: "reply" },
  ],
  inbox: [
    { page: "overview", label: "All", icon: "inbox" },
    { page: "waiting", label: "Waiting", icon: "clock" },
    { page: "approve", label: "Approve", icon: "check" },
  ],
};

/** A page's icon by what its name says, for a tab no pick names. */
const ICONS: readonly [RegExp, IconName][] = [
  [/overview|home|numbers|board|health/, "board"],
  [/call|voice|phone|latency/, "phone"],
  [/mail|email|inbox|outbound|newsletter/, "mail"],
  [/repl|thread|chat|text|mention|ask|question/, "chat"],
  [/people|client|team|role|grant|contact|lead|compan/, "people"],
  [/plan|schedule|calendar|today|month/, "calendar"],
  [/setting|setup|layout|look|theme|field|rule/, "sliders"],
  [/link|domain|connector|webhook/, "link"],
  [/search|keyword|answer/, "search"],
  [/video|reel|media|test/, "play"],
  [/review|star|keep/, "star"],
  [/money|spend|pay|card|billing|subscription|economic|cohort|account/, "money"],
  [/flag|issue|stall|hold|check|parked/, "flag"],
  [/chart|visit|session|funnel|signal|usage|report|result|event|metric/, "chart"],
  [/page|form|submission|site|doc|template|paperwork|deliverable/, "page"],
  [/run|execution|loop|agent|workflow|canvas|handler|ai|tool/, "bolt"],
  [/approv|done/, "check"],
  [/write|draft|piece|sop|snippet|section|note|hook/, "write"],
  [/ad|campaign|format|set/, "billboard"],
  [/source|catalog|map|mod|librar|sequence/, "stack"],
];
export const pageIcon = (id: string, label = ""): IconName =>
  ICONS.find(([re]) => re.test(`${id} ${label}`.toLowerCase()))?.[1] ?? "list";

interface Tab {
  id: string;
  label: string;
  href: string;
  count?: number | undefined;
  group?: string | undefined;
}
/** A phone tab: the shell's DockItem, with the pages it holds. */
export interface PhoneTab {
  id: string;
  label: string;
  icon: IconName;
  href: string;
  count?: number;
  holds: string[];
}

/**
 * An app's phone tabs, before the shell fits them to the bar: its picks first, then a tab per
 * run of the rest (a group of pages is one tab, named by the group). The shell moves what
 * doesn't fit under More.
 */
export function phoneTabsOf(app: string, tabs: readonly Tab[]): PhoneTab[] {
  const tab = (t: Tab, label = t.label, icon = pageIcon(t.id, t.label), holds = [t.id]) => ({
    id: t.id,
    label,
    icon,
    href: t.href,
    holds,
    ...(t.count !== undefined ? { count: t.count } : {}),
  });
  const picks = (PHONE_TABS[app] ?? []).flatMap((p) => {
    const t = tabs.find((x) => x.id === p.page);
    return t ? [tab(t, p.label ?? t.label, p.icon)] : [];
  });
  const picked = new Set(picks.map((p) => p.id));
  const rest: PhoneTab[] = [];
  for (const t of tabs) {
    if (picked.has(t.id)) continue;
    const last = rest.at(-1);
    const prior = last && tabs.find((x) => x.id === last.id);
    if (t.group && prior?.group === t.group && last) {
      last.holds.push(t.id);
      last.label = t.group;
      if (t.count !== undefined) last.count = (last.count ?? 0) + t.count;
    } else rest.push(tab(t));
  }
  return [...picks, ...rest];
}

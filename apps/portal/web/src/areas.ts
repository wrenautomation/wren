/**
 * The sidebar is five fixed items: the Map, then Inbox, People, Money and Admin (SIDEBAR). Every
 * other app opens from the Map, Admin > Systems, a pin or the command menu. The areas below group
 * apps by the job they do, for the pages that still list them (Today and the phone's Apps tab).
 * An id a workspace lacks is skipped, an area left empty isn't shown, and an app no area names
 * lands in Tools. A parked app (`Module.parked`) is in no area.
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

/** Wren's team: the business in its real order, marketing one level down, the tools folded. */
export const AREAS_TEAM: readonly Area[] = [
  { id: "primary", label: "Primary", apps: ["offers", "pipelines", "people", "numbers"] },
  {
    id: "marketing",
    label: "Marketing",
    apps: ["content", "engage", "outbound", "ads", "analytics"],
  },
  {
    id: "tools",
    label: "Tools",
    shut: true,
    apps: [
      "inbox",
      "workflows",
      "loops",
      "library",
      "marketplace",
      "sites",
      "calendar",
      "money",
      "clients",
      "team",
      "ask",
      "review",
      "handlers",
      "settings",
    ],
  },
];

/** A client's workspace: as it was before the team's reshape, with `deals` renamed `pipelines`. */
export const AREAS_CLIENT: readonly Area[] = [
  { id: "inbox", label: "Inbox", apps: ["inbox", "texts"] },
  {
    id: "leads",
    label: "Leads",
    apps: ["pipeline", "leads", "people", "outbound", "pipelines", "calls", "reactivation"],
  },
  { id: "marketing", label: "Marketing", apps: ["marketing", "outreach", "ads", "sites", "learn"] },
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

/**
 * These apps by area, in area order, for Wren's team or a client; areas with none left out. A
 * parked app is left out of every area.
 */
export function areasOf<T extends { id: string; parked?: true | undefined }>(
  apps: readonly T[],
  team: boolean,
): { area: Area; apps: T[] }[] {
  const areas = team ? AREAS_TEAM : AREAS_CLIENT;
  const shown = apps.filter((m) => !m.parked);
  const named = new Set(areas.flatMap((a) => a.apps));
  return areas
    .map((area) => ({
      area,
      apps: [
        ...area.apps.flatMap((id) => shown.filter((m) => m.id === id)),
        ...(area.id === REST ? shown.filter((m) => !named.has(m.id)) : []),
      ],
    }))
    .filter((a) => a.apps.length);
}

/**
 * The sidebar's fixed items under the Map: Inbox, People, Money, Admin (designs/2026-10-20-design-
 * language.md, "Sidebar"). Admin is the Settings app. An item whose app a workspace lacks is
 * skipped: a client has no Inbox or Money app. Every other app opens from the Map, Admin → Systems,
 * a pin or ⌘K.
 */
export const SIDEBAR = [
  { label: "Inbox", app: "inbox" },
  { label: "People", app: "people" },
  { label: "Money", app: "money" },
  { label: "Admin", app: "settings" },
] as const;

/** The fixed items this workspace has, in order, each with its app. A parked app is skipped. */
export function sidebarOf<T extends { id: string; parked?: true | undefined }>(
  apps: readonly T[],
): { label: string; app: T }[] {
  return SIDEBAR.flatMap(({ label, app: id }) => {
    const app = apps.find((m) => !m.parked && m.id === id);
    return app ? [{ label, app }] : [];
  });
}

/** One of a phone's bottom tabs after the Map: a fixed item's app, or a pin. */
export type DockPick<T, P> = { label: string; app: T } | { pin: P };

/**
 * A phone's tabs after the Map: Inbox, People, then the person's first pin. A pin that does not
 * open (moved, or a page they may not see) is not in `pins`, so the first one that opens docks.
 * `size` counts the Map's tab too.
 */
export function dockOf<T extends { id: string; parked?: true | undefined }, P>(
  apps: readonly T[],
  pins: readonly P[],
  size = 4,
): DockPick<T, P>[] {
  const fixed = sidebarOf(apps).filter((i) => i.app.id === "inbox" || i.app.id === "people");
  const first = pins[0];
  return [...fixed, ...(first === undefined ? [] : [{ pin: first }])].slice(0, size - 1);
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
  content: [
    { page: "plan", icon: "calendar" },
    { page: "studio", icon: "write" },
    { page: "pieces", icon: "write" },
  ],
  engage: [
    { page: "engage", icon: "reply" },
    { page: "dms", label: "DMs", icon: "chat" },
    { page: "invites", icon: "people" },
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

/**
 * The sidebar's areas: apps grouped by the job they do (designs/2026-10-10-portal-areas.md,
 * 2026-10-19-portal-reshape.md). Wren's team and a client each have their own map. An id a
 * workspace lacks is skipped, an area left empty isn't shown, and an app no area names lands in
 * Tools. A parked app (`Module.parked`) is in no area.
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

/** One of a phone's bottom tabs: an app, or one of its pages under its own name and icon. */
export interface DockPick {
  app: string;
  page?: string;
  label?: string;
  icon?: IconName;
}

/** What Wren's team opens every day, at a phone's thumb: the pipeline, make, reply. */
export const DOCK_TEAM: readonly DockPick[] = [
  { app: "pipelines" },
  { app: "content", page: "studio", label: "Studio", icon: "write" },
  { app: "engage", page: "engage", label: "Engage", icon: "reply" },
];

/**
 * A phone's tabs after Today: Wren's team gets its daily picks that this workspace has. A client
 * gets its first apps by area. Either fills up to `size` with the first apps by area.
 */
export function dockOf<
  T extends { id: string; pages: readonly { id: string }[]; parked?: true | undefined },
>(apps: readonly T[], team: boolean, size = 3): { app: T; pick: DockPick }[] {
  const has = (p: DockPick) =>
    apps.find(
      (m) => !m.parked && m.id === p.app && (!p.page || m.pages.some((x) => x.id === p.page)),
    );
  const out = (team ? DOCK_TEAM : []).flatMap((pick) => {
    const app = has(pick);
    return app ? [{ app, pick }] : [];
  });
  for (const { apps: inArea } of areasOf(apps, team))
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

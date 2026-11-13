/**
 * The sidebar is the places (designs/2026-11-04-portal-places.md, Lean places). Each place is one
 * app (`modules/places.ts`). An app no place names lands under Other; a parked app shows nowhere,
 * yet its routes and ⌘K work.
 */
import type { IconName } from "@wren/ui";

export interface Area {
  id: string;
  label: string;
  /** App ids, in sidebar order. */
  apps: readonly string[];
  /** Folds shut until opened. */
  shut?: boolean;
}

/** The places in sidebar order, each in its area. A workspace without one skips it. */
const PLACES = [
  { label: "Map", app: "map", area: "fixed" },
  { label: "Today", app: "today", area: "fixed" },
  { label: "Campaigns", app: "campaigns", area: "work" },
  { label: "Explorer", app: "explorer", area: "work" },
  { label: "Research", app: "research", area: "work" },
  { label: "Variants", app: "variants", area: "work" },
  { label: "Canon", app: "canon", area: "work" },
  { label: "Aerie", app: "aerie", area: "work" },
  { label: "People", app: "people", area: "core" },
  { label: "Back office", app: "office", area: "core" },
] as const;

/** The sidebar's areas, unnamed: each reads by its places. */
export const AREAS = [
  { id: "fixed", label: "" },
  { id: "work", label: "" },
  { id: "core", label: "" },
] as const;

type AreaId = (typeof AREAS)[number]["id"];

const PLACE_AREA: Area = { id: "places", label: "Places", apps: PLACES.map((p) => p.app) };
/** Where an app no place names goes, so a new app always shows. */
const REST = "other";

/** These apps by area: the places, then any other app; empty areas and parked apps left out. */
export function areasOf<T extends { id: string; parked?: true | undefined }>(
  apps: readonly T[],
  _team?: boolean,
): { area: Area; apps: T[] }[] {
  const shown = apps.filter((m) => !m.parked);
  const named = new Set(PLACE_AREA.apps);
  return [
    { area: PLACE_AREA, apps: PLACE_AREA.apps.flatMap((id) => shown.filter((m) => m.id === id)) },
    { area: { id: REST, label: "Other", apps: [] }, apps: shown.filter((m) => !named.has(m.id)) },
  ].filter((a) => a.apps.length);
}

/** The places this workspace has, in order, each with its app and area. A parked app is skipped. */
export function sidebarOf<T extends { id: string; parked?: true | undefined }>(
  apps: readonly T[],
): { label: string; app: T; area: AreaId }[] {
  return PLACES.flatMap(({ label, app: id, area }) => {
    const app = apps.find((m) => !m.parked && m.id === id);
    return app ? [{ label, app, area }] : [];
  });
}

/** One of a phone's bottom tabs after home: a place, or a pin. */
type DockPick<T, P> = { label: string; app: T } | { pin: P };

/** The places a phone docks after home, in order (the design's dock). */
const DOCKED = ["today", "campaigns", "research", "people"];

/**
 * A phone's tabs after home: Today, Campaigns, Research, People, then the person's first pin. A pin
 * that does not open (moved, or a page they may not see) is not in `pins`, so the first one that
 * opens docks. `size` counts home's tab too.
 */
export function dockOf<T extends { id: string; parked?: true | undefined }, P>(
  apps: readonly T[],
  pins: readonly P[],
  size = 6,
): DockPick<T, P>[] {
  const fixed = DOCKED.flatMap((id) => sidebarOf(apps).filter((i) => i.app.id === id));
  const first = pins[0];
  return [...fixed, ...(first === undefined ? [] : [{ pin: first }])].slice(0, size - 1);
}

/** One of an app's own bottom tabs on a phone: a page, under a short name and its icon. */
interface TabPick {
  page: string;
  label?: string;
  icon: IconName;
}

/**
 * The pages each app's phone tabs lead with, as a phone app's tab bar would: three a day's work
 * runs through, the rest under More. An app named here gets these; any other gets a tab per page
 * or group, in its own order.
 */
const PHONE_TABS: Readonly<Record<string, readonly TabPick[]>> = {
  today: [
    { page: "approve", icon: "check" },
    { page: "messages", icon: "chat" },
    { page: "calendar", icon: "calendar" },
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
interface PhoneTab {
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

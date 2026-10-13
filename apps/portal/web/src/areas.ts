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
    apps: ["pipeline", "leads", "outbound", "deals", "calls", "reactivation"],
  },
  { id: "marketing", label: "Marketing", apps: ["marketing", "ads", "sites", "learn"] },
  {
    id: "automations",
    label: "Automations",
    shut: true,
    apps: ["workflows", "loops", "library", "marketplace", "voice", "handlers"],
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
    apps: ["notes", "calendar", "ask", "review", "settings"],
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

/** What Wren's team opens every day, at a phone's thumb: approve, write, reply. */
export const DOCK: readonly DockPick[] = [
  { app: "inbox" },
  { app: "marketing", page: "write", label: "Write", icon: "write" },
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

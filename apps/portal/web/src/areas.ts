/**
 * The sidebar's areas: apps grouped by the job they do (designs/2026-10-10-portal-areas.md).
 * Pages never move between apps; an area only groups them. Wren's and a client's apps share the
 * map: an id a workspace lacks is skipped, and an area left empty isn't shown.
 */

export interface Area {
  id: string;
  label: string;
  /** App ids, in sidebar order. */
  apps: readonly string[];
}

export const AREAS: readonly Area[] = [
  { id: "inbox", label: "Inbox", apps: ["inbox", "texts"] },
  {
    id: "leads",
    label: "Leads",
    apps: ["pipeline", "leads", "outbound", "deals", "calls", "reactivation"],
  },
  { id: "marketing", label: "Marketing", apps: ["marketing", "sites", "learn"] },
  {
    id: "automations",
    label: "Automations",
    apps: ["workflows", "loops", "library", "marketplace", "voice", "handlers"],
  },
  {
    id: "business",
    label: "Business",
    apps: ["work", "clients", "money", "payments", "documents", "team"],
  },
  { id: "tools", label: "Tools", apps: ["notes", "calendar", "ask", "review"] },
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

/** What the palette lists: Map or Today, then every app and page this viewer may open. */
import type { IconName, PaletteItem } from "@wren/ui";
import type { Module } from "./module.js";

/** What "/" is: the Map where Wren's team lands, Today in a client's own view. */
export const homeOf = (team: boolean) => (team ? "Map" : "Today");
export const homeIcon = (label: string): IconName => (label === "Map" ? "workflow" : "home");

/** ⌘K's list: home, then every page this viewer may open, by app, with its G key if it has one. */
export const jumps = (
  apps: Module[],
  launcher: string | undefined,
  homeLabel: string,
  keys: Map<string, string>,
): PaletteItem[] => {
  const keyOf = new Map([...keys].map(([k, href]) => [href, `G ${k.toUpperCase()}`]));
  return [
    ...(launcher
      ? [{ label: homeLabel, group: "Wren", href: launcher, icon: homeIcon(homeLabel) }]
      : []),
    ...apps.flatMap((m) =>
      m.pages
        .filter((p) => !p.hidden)
        .map((p) => ({
          label: p.label,
          group: m.name,
          href: `/${m.id}/${p.id}`,
          icon: m.icon,
          // A parked app's pages stay here, tagged: it is out of the sidebar, not gone.
          hint: m.parked
            ? ["parked", keyOf.get(`/${m.id}/${p.id}`)].filter(Boolean).join(" ")
            : keyOf.get(`/${m.id}/${p.id}`),
        })),
    ),
  ];
};

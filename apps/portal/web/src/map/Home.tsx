/**
 * "/" for Wren's team: the Map of the workspace's shape with Today docked on the right. The dock
 * collapses, and each viewer's choice is kept on the device. On a phone the dock is a tab under
 * the Map, not a side panel.
 */
import { Button, Icon, usePhone } from "@wren/ui";
import { type ReactNode, useState } from "react";
import { keep, recall } from "../local.js";
import type { PageProps } from "../module.js";
import { MapPage } from "./MapPage.js";

const DOCK_KEY = "wren.portal.map.dock";

export function MapHome({
  props,
  clients,
  today,
}: {
  props: PageProps;
  clients: readonly { id: string; name: string }[];
  /** Today's lists, without their page header. */
  today: ReactNode;
}) {
  const [open, setOpen] = useState(() => recall(DOCK_KEY) !== "closed");
  const phone = usePhone();
  const set = (next: boolean) => {
    setOpen(next);
    keep(DOCK_KEY, next ? "open" : "closed");
  };
  return (
    <div className="flex min-w-0 gap-6 max-[900px]:flex-col">
      <div className="min-w-0 flex-1">
        <MapPage props={props} clients={clients} />
      </div>
      {phone ? (
        <div className="min-w-0">
          <Button
            tone="quiet"
            size="sm"
            aria-expanded={open}
            aria-controls="today-dock"
            onClick={() => set(!open)}
          >
            <Icon name="home" size={15} /> Today
          </Button>
          {open ? (
            <div id="today-dock" className="mt-4">
              {today}
            </div>
          ) : null}
        </div>
      ) : open ? (
        <aside id="today-dock" aria-label="Today" className="w-96 max-w-[40%] shrink-0">
          <div className="mb-3 flex items-center">
            <h2 className="mr-auto text-[17px]/6 font-semibold">Today</h2>
            <Button tone="quiet" size="sm" icon="right" onClick={() => set(false)}>
              Hide
            </Button>
          </div>
          {today}
        </aside>
      ) : (
        <div className="shrink-0">
          <Button
            tone="quiet"
            size="sm"
            aria-expanded={false}
            aria-controls="today-dock"
            onClick={() => set(true)}
          >
            <Icon name="left" size={15} /> Today
          </Button>
        </div>
      )}
    </div>
  );
}

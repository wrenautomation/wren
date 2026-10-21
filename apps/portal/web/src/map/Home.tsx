/**
 * "/" for Wren's team: the Map of the workspace's shape, and Today under it (artifact section 07).
 * Hover a task to light its line on the Map; a click opens its track.
 */
import { lineKeyOf } from "@wren/ui/metro";
import { type ReactNode, useCallback, useMemo, useState } from "react";
import type { PageProps } from "../module.js";
import { go } from "../route.js";
import { MapPage } from "./MapPage.js";
import { windowOf } from "./model.js";
import { useMap } from "./read.js";
import { TodayTasks } from "./TodayTasks.js";
import { tasksOf } from "./tasks.js";

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
  // The same read as the Map's: one cached answer. Tasks wait for it and for a drawable shape.
  const read = useMap(props.client, windowOf(props.params.get("window")));
  const data = read.data?.map ?? null;
  const tasks = useMemo(
    () => (data?.metro ? tasksOf(data.metro, data.people, new Date()) : null),
    [data],
  );
  // The line Today lights on the Map. Out lines share one key, so map the id through the body.
  const [lit, setLit] = useState<string | null>(null);
  const light = useCallback(
    (line: string | null) =>
      setLit(
        line && data?.metro
          ? lineKeyOf({ lines: data.metro.lines.map((l) => ({ id: l.id, tier: l.tier })) }, line)
          : line,
      ),
    [data],
  );
  const openTask = useCallback(
    (id: string) => {
      setLit(null);
      go("/", { track: id, node: null, line: null }, props.params);
    },
    [props.params],
  );
  const list = tasks ? <TodayTasks tasks={tasks} onLight={light} onOpen={openTask} /> : null;
  return (
    <div className="flex min-w-0 flex-col">
      <MapPage props={props} clients={clients} lit={lit} />
      {/* The artifact's Today sheet under the map: a hair on top, the same side pad as the map. */}
      <div className="grid min-w-0 content-start gap-3 border-t border-(--ui-hair) px-[clamp(12px,2.5vw,24px)] pt-4 pb-5">
        {list}
        {today}
      </div>
    </div>
  );
}

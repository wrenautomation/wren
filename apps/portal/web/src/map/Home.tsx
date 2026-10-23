/**
 * "/" for Wren's team: the Map of the workspace's shape, and Today under it (artifact section 07).
 * Hover a task to light its line on the Map; a click opens its track. With a home view (the
 * `map.home` pref) "/" draws that view instead, until `?whole=1` asks for the whole Map.
 */
import { usePref } from "@wren/ui";
import { lineKeyOf, MetroSkeleton } from "@wren/ui/metro";
import { type ReactNode, useCallback, useMemo, useState } from "react";
import type { PageProps } from "../module.js";
import { go } from "../route.js";
import { FocusPage } from "./FocusPage.js";
import { focusOf } from "./focus.js";
import { MapPage } from "./MapPage.js";
import { windowOf } from "./model.js";
import { useMap } from "./read.js";
import { TodayTasks } from "./TodayTasks.js";
import { tasksOf } from "./tasks.js";
import { MAP_HOME, mapKeepOf, useMapViews, viewPartsOf } from "./views.js";

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
  // His home view, unless the address asks for the whole Map. A view the shape lost all of, or
  // one deleted, falls back to the whole Map with one line that says so.
  const keep = mapKeepOf(props);
  const homeId = usePref<number>(keep, MAP_HOME);
  const views = useMapViews(keep);
  const wanted = keep && props.params.get("whole") !== "1" ? homeId.value : undefined;
  const homeView = wanted ? (views.lines.find((v) => v.id === wanted) ?? null) : null;
  const drawn =
    homeView && data?.metro ? !!focusOf(data.metro, viewPartsOf(homeView), homeView.name) : false;
  const waiting =
    !!keep &&
    props.params.get("whole") !== "1" &&
    (!homeId.ready || (!!wanted && (!views.ready || (!!homeView && !data))));
  // Until the map is in, the Map page draws its own loading frame under its title.
  const map =
    waiting && data ? (
      <MetroSkeleton />
    ) : !waiting && homeView && drawn ? (
      <FocusPage key={homeView.id} props={props} at={{ view: homeView.id }} home />
    ) : (
      <>
        {wanted && !waiting ? (
          <p
            role="status"
            className="px-[clamp(12px,2.5vw,24px)] pt-3 text-[13px] text-(--ui-ink-3)"
          >
            {homeView
              ? `Your home view "${homeView.name}" holds no part of the shape now. The whole Map shows instead.`
              : "Your home view is gone. The whole Map shows instead."}
          </p>
        ) : null}
        <MapPage props={props} clients={clients} lit={lit} />
      </>
    );
  return (
    <div className="flex min-w-0 flex-col">
      {map}
      {/* The artifact's Today sheet under the map: a hair on top, the same side pad as the map. */}
      <div className="grid min-w-0 content-start gap-3 border-t border-(--ui-hair) px-[clamp(12px,2.5vw,24px)] pt-4 pb-5">
        {list}
        {today}
      </div>
    </div>
  );
}

/**
 * "/" for Wren's team: the Map of the workspace's shape, the whole page, edge to edge. Today is a
 * sheet that slides over it from the Map's header, closed until asked, so the canvas never gives up
 * room for it. On a phone Today stays a tab under the Map.
 */
import { Button, Icon, usePhone } from "@wren/ui";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@wren/ui/components/ui/sheet";
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
  const phone = usePhone();
  const [sheet, setSheet] = useState(false);
  const [tab, setTab] = useState(true);
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
      setSheet(false);
      setLit(null);
      go("/", { track: id, node: null, line: null }, props.params);
    },
    [props.params],
  );
  const list = tasks ? <TodayTasks tasks={tasks} onLight={light} onOpen={openTask} /> : null;
  return (
    <div className="flex h-full min-w-0 flex-col max-[900px]:h-auto">
      <MapPage
        props={props}
        clients={clients}
        lit={lit}
        trailing={
          phone ? null : (
            <Button
              tone="secondary"
              size="dense"
              aria-haspopup="dialog"
              aria-expanded={sheet}
              onClick={() => setSheet(true)}
            >
              <Icon name="home" size={15} /> Today
            </Button>
          )
        }
      />
      {phone ? (
        <div className="min-w-0 px-4 pt-3 pb-4">
          <Button
            tone="quiet"
            size="dense"
            aria-expanded={tab}
            aria-controls="today-tab"
            onClick={() => setTab(!tab)}
          >
            <Icon name="home" size={15} /> Today
          </Button>
          {tab ? (
            <div id="today-tab" className="mt-4">
              {list}
              {today}
            </div>
          ) : null}
        </div>
      ) : (
        <Sheet
          open={sheet}
          onOpenChange={(open) => {
            setSheet(open);
            if (!open) setLit(null);
          }}
        >
          <SheetContent
            side="right"
            initialFocus={false}
            className="gap-0 bg-(--ui-paper) text-(--ui-ink) data-[side=right]:w-[min(460px,94vw)] data-[side=right]:sm:max-w-[460px]"
          >
            <SheetHeader className="border-b border-(--ui-hair) bg-transparent p-4">
              <SheetTitle className="text-[17px]/6 font-semibold">Today</SheetTitle>
            </SheetHeader>
            <div id="today-sheet" className="min-h-0 flex-1 overflow-y-auto p-4">
              {list}
              {today}
            </div>
          </SheetContent>
        </Sheet>
      )}
    </div>
  );
}

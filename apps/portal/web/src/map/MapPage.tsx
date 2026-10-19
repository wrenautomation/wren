/**
 * The Map (designs/2026-10-19-business-map.md, "Map page"): the shape of the workspace drawn down
 * the page, each wire a ribbon as wide as the people who crossed it in the window. Hover a node for
 * its numbers, click for its details, double click to open the app that manages it. Read only;
 * editing comes with the next build.
 */
import {
  Button,
  Graph,
  Icon,
  LoadFailed,
  Loading,
  PRESETS,
  SELECT_CLASS,
  Segmented,
  themeVars,
} from "@wren/ui";
import { useMemo, useState } from "react";
import { type PageProps, WREN } from "../module.js";
import { atOf } from "../modules/deals/board.js";
import { go, href, navigate } from "../route.js";
import { diffGraph } from "./diff.js";
import { History, useDiff } from "./History.js";
import { graphOf, type MapData, WINDOWS, type Window, windowOf } from "./model.js";
import { NodePanel } from "./NodePanel.js";
import { useMap } from "./read.js";
import { opensOf } from "./routes.js";

/** The Map is always on the night ground: a canvas, no grid, no chrome. */
const NIGHT = themeVars(PRESETS.night);

/** The node kinds a shape is made of, in the order the starter lists them. */
const KINDS = ["Source", "Step", "Offer", "Plan"];

/** A workspace with no shape: one line, the starter's palette inert, the start disabled. */
function NoShape() {
  return (
    <div className="flex flex-col items-start gap-4 p-8 text-[14.5px] text-(--ui-ink-2)">
      <p>No shape yet. A shape is the road from first contact to money.</p>
      <ul aria-label="Parts of a shape" className="flex list-none flex-wrap gap-2">
        {KINDS.map((k) => (
          <li
            key={k}
            aria-disabled="true"
            className="rounded-md border border-dashed border-(--ui-hair) px-3 py-1.5 text-(--ui-ink-3)"
          >
            {k}
          </li>
        ))}
      </ul>
      <Button tone="primary" size="sm" disabled>
        Start from Wren's shape
      </Button>
      <p className="text-[13px] text-(--ui-ink-3)">
        Starting from a shape arrives in the next build.
      </p>
    </div>
  );
}

export function MapPage({
  props,
  clients,
}: {
  props: PageProps;
  /** The workspaces the viewer may switch between, besides Wren's. */
  clients: readonly { id: string; name: string }[];
}) {
  const window = windowOf(props.params.get("window"));
  const wren = props.client === WREN.id;
  const client = wren ? null : props.client;
  const at = atOf(props.client);
  const read = useMap(props.client, window);
  const [selected, setSelected] = useState<string | null>(null);
  const [history, setHistory] = useState(false);
  const [picked, setPicked] = useState<number[]>([]);
  const diff = useDiff(at, history ? picked : []);
  const data: MapData | null = read.data?.map ?? null;
  const drawn = useMemo(() => {
    if (!data) return null;
    if (history && picked.length === 2 && diff.data)
      return { ...diffGraph(diff.data.bodies[0], diff.data.bodies[1], diff.data.diff), diff: true };
    return { ...graphOf(data), diff: false };
  }, [data, history, picked.length, diff.data]);

  const pick = (n: number) =>
    setPicked((p) => (p.includes(n) ? p.filter((x) => x !== n) : [...p.slice(-1), n]));
  const enter = (id: string) => {
    const node = data?.body.nodes.find((n) => n.id === id);
    const to = node ? opensOf(node, wren ? "wren" : "client", client)[0] : undefined;
    if (to) navigate(to.href);
  };
  const shown = history ? null : selected;

  return (
    <section
      aria-label="Map"
      data-ui-theme=""
      style={NIGHT}
      className="flex min-w-0 flex-col overflow-hidden rounded-2xl bg-(--ui-canvas) text-(--ui-ink)"
    >
      <header className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 pt-4">
        <h1 className="mr-auto text-[22px]/8 font-semibold">Map</h1>
        <Segmented
          label="Window"
          className="max-w-full"
          items={WINDOWS.map((w) => ({
            id: w.id,
            label: w.label,
            href: href("/", { window: w.id === "30" ? null : w.id }, props.params),
            on: w.id === window,
          }))}
        />
        <select
          aria-label="Client"
          className={`${SELECT_CLASS} !w-auto`}
          value={props.client}
          onChange={(e) =>
            go("/", { client: e.target.value === WREN.id ? null : e.target.value }, props.params)
          }
        >
          <option value={WREN.id}>Wren</option>
          {clients.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        {data ? (
          <Button
            tone="quiet"
            size="sm"
            aria-pressed={history}
            onClick={() => {
              setHistory((h) => !h);
              setPicked([]);
            }}
          >
            <Icon name="clock" size={15} /> History
          </Button>
        ) : null}
      </header>
      <div className="flex min-w-0 flex-1 max-[900px]:flex-col">
        <div className="min-w-0 flex-1 p-3">
          {read.error && !read.data ? (
            <LoadFailed error={read.error} onRetry={read.retry} what="map" />
          ) : !read.data ? (
            <Loading lines={8} />
          ) : !data || !drawn ? (
            <NoShape />
          ) : (
            <Graph
              key={drawn.diff ? "diff" : "map"}
              nodes={drawn.nodes}
              edges={drawn.edges}
              label={drawn.diff ? "Shape differences" : "Map of the shape"}
              direction="down"
              ribbons
              bare
              tools={false}
              selected={shown}
              onOpen={setSelected}
              onPane={() => setSelected(null)}
              onEnter={enter}
              name="map"
            />
          )}
        </div>
        {data && history ? (
          <History
            versions={data.versions}
            picked={picked}
            onPick={pick}
            diff={diff}
            onClose={() => {
              setHistory(false);
              setPicked([]);
            }}
          />
        ) : data && shown ? (
          <NodePanel
            data={data}
            id={shown}
            window={window as Window}
            place={wren ? "wren" : "client"}
            client={client}
            at={at}
            onClose={() => setSelected(null)}
          />
        ) : null}
      </div>
    </section>
  );
}

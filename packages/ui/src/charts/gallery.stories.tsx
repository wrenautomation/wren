/**
 * Every prebuilt chart and graph on one page: its name, what it is for, and one live copy on
 * synthetic data. Each part's own stories hold its states (empty, loading, worst case).
 */
import type { Meta, StoryObj } from "@storybook/react-vite";
import type { ReactNode } from "react";
import { expect, waitFor } from "storybook/test";
import { FUNNEL, SPEND_PARTS, TREND } from "../fixtures/charts.js";
import { DAYS_OF, HOUR_WEIGHT, PLATFORMS } from "../fixtures/dashboard.js";
import { RIBBON_EDGES, RIBBON_NODES } from "../fixtures/graph.js";
import { RUN_GRAPH } from "../fixtures/index.js";
import { Graph } from "../graph/index.js";
import { RunGraph } from "../research/run/graph.js";
import { SplitPanel, sliceColor } from "../split.js";
import {
  BarsChart,
  ColumnsChart,
  HeatChart,
  LinesChart,
  RingChart,
  Sparkline,
  TrendChart,
} from "./index.js";

export default {
  title: "Components/Charts and graphs/All charts",
  id: "charts-all",
  parameters: { layout: "fullscreen" },
} satisfies Meta;

type Story = StoryObj;

const COLOR = PLATFORMS.map((_, i) => `var(--ui-chart-${i + 1})`);
const DOW = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const short = (n: number) =>
  n >= 10_000
    ? n.toLocaleString("en-US", { notation: "compact", maximumFractionDigits: 1 })
    : n.toLocaleString("en-US");
const usd = (n: number) => `$${n.toLocaleString("en-US")}`;

// last 8 whole weeks of the dashboard business
const WEEKS = Array.from({ length: 8 }, (_, w) =>
  DAYS_OF.slice(-56 + w * 7, -49 + w * 7 || undefined),
);
const LAST30 = DAYS_OF.slice(-30);
const TOTAL = PLATFORMS.map((p) => LAST30.reduce((s, d) => s + d.views[p.key], 0));
const HEAT = HOUR_WEIGHT.map((row) => row.map((v) => Math.round(v * 40)));

const card =
  "grid min-w-0 content-start gap-3 rounded-(--ui-radius-panel) bg-(--ui-paper) p-4 shadow-(--ui-raise)";

/** A tile: the part's name in code, a line on when to use it, then the part. */
function Tile({
  name,
  use,
  wide,
  children,
}: {
  name: string;
  use: string;
  wide?: boolean;
  children: ReactNode;
}) {
  return (
    <section aria-label={name} className={`${card} ${wide ? "lg:col-span-2" : ""}`}>
      <header className="grid gap-0.5">
        <h3 className="m-0 font-mono text-[13px] font-semibold">{name}</h3>
        <p className="m-0 text-[12.5px] text-(--ui-ink-3)">{use}</p>
      </header>
      {children}
    </section>
  );
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="grid gap-3">
      <h2 className="m-0 text-[13px] font-semibold tracking-[0.04em] text-(--ui-ink-3) uppercase">
        {title}
      </h2>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">{children}</div>
    </div>
  );
}

export const Default: Story = {
  render: () => (
    <div className="grid max-w-6xl gap-8 bg-(--ui-canvas) p-4 sm:p-6">
      <Group title="Over time">
        <Tile name="Sparkline" use="A tile's headline figure: a bar a day, no axes.">
          <div className="max-w-xs">
            <p className="m-0 text-[22px] font-semibold tabular-nums">812</p>
            <Sparkline
              series={TREND}
              slots={30}
              label="Visits"
              fallback={<div className="h-7" />}
            />
          </div>
        </Tile>
        <Tile name="TrendChart" use="One figure over a month: an area with a hover readout.">
          <TrendChart series={TREND} label="Visits" height={160} />
        </Tile>
        <Tile name="LinesChart" use="Several series over time, each with a fixed colour." wide>
          <LinesChart
            rows={DAYS_OF.slice(-90).map((d) => ({
              at: d.at,
              ...Object.fromEntries(PLATFORMS.map((p) => [p.key, d.views[p.key]])),
            }))}
            series={PLATFORMS.map((p, i) => ({
              key: p.key,
              label: p.label,
              color: COLOR[i] ?? "",
            }))}
            format={short}
            height={220}
          />
        </Tile>
        <Tile name="ColumnsChart" use="A figure per period; with parts, stacked by source.">
          <ColumnsChart
            label="Replies"
            rows={WEEKS.map((w, i) => ({
              label: `W${i + 1}`,
              value: w.reduce((s, d) => s + PLATFORMS.reduce((t, p) => t + d.replies[p.key], 0), 0),
              parts: PLATFORMS.map((p) => w.reduce((s, d) => s + d.replies[p.key], 0)),
            }))}
            parts={PLATFORMS.map((p, i) => ({ label: p.label, color: COLOR[i] ?? "" }))}
            height={200}
          />
        </Tile>
        <Tile name="HeatChart" use="A figure for each pair of two steps: day by hour.">
          <HeatChart
            rows={DOW}
            cols={Array.from({ length: 24 }, (_, h) => (h % 3 === 0 ? String(h) : ""))}
            cells={HEAT}
            label="replies"
          />
        </Tile>
      </Group>

      <Group title="Parts of a whole">
        <Tile name="RingChart" use="Shares of one total; hover or pick a slice.">
          <div className="grid place-items-center">
            <RingChart
              slices={PLATFORMS.map((p, i) => ({
                key: p.key,
                value: TOTAL[i] ?? 0,
                color: COLOR[i] ?? "",
              }))}
            />
          </div>
        </Tile>
        <Tile name="BarsChart" use="Stages or ranked rows: a funnel, a top list.">
          <BarsChart rows={FUNNEL} label="People" />
        </Tile>
        <Tile name="SplitPanel" use="A total, its ring or bar, and the rows it splits into." wide>
          <SplitPanel
            label="Spend this month"
            total={usd(802)}
            line="spent this month"
            rows={SPEND_PARTS.map((s, i) => ({
              key: s.name,
              label: s.name,
              note: s.vendors.join(", "),
              weight: s.sum,
              value: usd(s.sum),
              color: sliceColor(i),
              href: "#",
            }))}
            shape="ring"
          />
        </Tile>
      </Group>

      <Group title="Graphs">
        <Tile name="Graph" use="Nodes and edges; with ribbons, an edge's width is its flow." wide>
          <Graph
            nodes={RIBBON_NODES}
            edges={RIBBON_EDGES}
            label="Ribbons"
            direction="down"
            ribbons
            tools={false}
            maxHeight={520}
          />
        </Tile>
        <Tile
          name="RunGraph"
          use="A weaver run as the query web: searches with answers, sources around them. Full page: Charts/Weaver run graph."
          wide
        >
          <RunGraph run={RUN_GRAPH} card />
        </Tile>
      </Group>
    </div>
  ),
  play: async ({ canvasElement }) => {
    await waitFor(
      () => expect(canvasElement.querySelector(".react-flow__edge path")).not.toBeNull(),
      { timeout: 10_000 },
    );
  },
};

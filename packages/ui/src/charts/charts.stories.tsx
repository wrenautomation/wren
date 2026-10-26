import type { Meta, StoryObj } from "@storybook/react-vite";
import {
  FUNNEL,
  FUNNEL_STALLED,
  GAPPED,
  NO_FIGURES,
  ONE_DAY,
  SPEND_PARTS,
  TREND,
  WORST_FUNNEL,
  WORST_TREND,
} from "../fixtures/charts.js";
import { WORST } from "../fixtures/worst.js";
import { SplitPanel, type SplitRow, sliceColor } from "../split.js";
import { BarsChart, Sparkline, TrendChart } from "./index.js";

export default {
  title: "Charts/Parts",
  id: "charts",
} satisfies Meta;

type Story = StoryObj;

const quiet = <div className="h-7" />;
const card = "rounded-(--ui-radius-panel) bg-(--ui-paper) p-4 shadow-(--ui-raise)";
const head = "mb-2 text-[12px] text-(--ui-ink-3)";
const percent = (n: number) => `${n}%`;

/** A tile's sparkline, the trend over a month, and a funnel; hover a bar or the area for the day. */
export const Default: Story = {
  render: () => (
    <div className="grid max-w-3xl gap-6">
      <div className={`${card} max-w-xs`}>
        <p className={head}>Sparkline</p>
        <p className="m-0 text-[22px] font-semibold tabular-nums">812</p>
        <Sparkline series={TREND} slots={30} label="Visits" fallback={quiet} />
      </div>
      <div className={card}>
        <p className={head}>Trend</p>
        <TrendChart series={TREND} label="Visits" />
      </div>
      <div className={card}>
        <p className={head}>Trend, in percent</p>
        <TrendChart series={TREND} label="Reply rate" format={percent} height={160} />
      </div>
      <div className={card}>
        <p className={head}>Bars</p>
        <BarsChart rows={FUNNEL} label="People" />
      </div>
    </div>
  ),
};

/** Nothing to draw: no days, no stages. The page adds the empty line. */
export const Empty: Story = {
  render: () => (
    <div className="grid max-w-3xl gap-6">
      <div className={`${card} max-w-xs`}>
        <Sparkline series={[]} slots={30} label="Visits" fallback={quiet} />
      </div>
      <div className={card}>
        <TrendChart series={[]} label="Visits" />
      </div>
      <div className={card}>
        <BarsChart rows={[]} label="People" />
      </div>
    </div>
  ),
};

/** The nearest real state: charts load their code on first show (a quiet box), and a read that has no figure yet draws days with none. */
export const Loading: Story = {
  render: () => (
    <div className="grid max-w-3xl gap-6">
      <div className={`${card} max-w-xs`}>
        <Sparkline series={NO_FIGURES} slots={30} label="Visits" fallback={quiet} />
      </div>
      <div className={card}>
        <TrendChart series={NO_FIGURES} label="Visits" />
      </div>
    </div>
  ),
};

/** The nearest real state: charts have no error state, so days whose read failed are gaps the line spans, and a stage nobody reached keeps a thin bar. */
export const Failed: Story = {
  render: () => (
    <div className="grid max-w-3xl gap-6">
      <div className={`${card} max-w-xs`}>
        <Sparkline series={GAPPED} slots={30} label="Visits" fallback={quiet} />
      </div>
      <div className={card}>
        <TrendChart series={GAPPED} label="Visits" />
      </div>
      <div className={card}>
        <BarsChart rows={FUNNEL_STALLED} label="People" />
      </div>
    </div>
  ),
};

/** Huge counts, a negative day, one lone day, and a funnel with long, mixed-script and empty labels. */
export const WorstCase: Story = {
  render: () => (
    <div className="grid max-w-3xl gap-6">
      <div className={`${card} max-w-xs`}>
        <Sparkline series={WORST_TREND} slots={30} label="Visits" fallback={quiet} />
      </div>
      <div className={card}>
        <TrendChart series={WORST_TREND} label="Visits" />
      </div>
      <div className={card}>
        <TrendChart series={ONE_DAY} label="Visits" height={120} />
      </div>
      <div className={card}>
        <BarsChart rows={WORST_FUNNEL} label="People" />
      </div>
    </div>
  ),
};

const usd = (n: number) => `$${n.toLocaleString("en-US")}`;
const spend = (parts: readonly { name: string; sum: number; vendors: string[] }[]): SplitRow[] =>
  parts.map((a, i) => ({
    key: a.name,
    label: a.name,
    note: a.vendors.join(", "),
    weight: a.sum,
    value: usd(a.sum),
    color: sliceColor(i),
    href: "#",
  }));

/** Money's month as a ring: five accounts each a slice, the last two one quiet slice. Hover a slice or a row; the other lights. */
export const Ring: Story = {
  render: () => (
    <div className="grid max-w-2xl gap-10">
      <SplitPanel
        label="Spend this month"
        total={usd(802)}
        line="spent this month · 51% on AI models"
        rows={spend(SPEND_PARTS)}
        shape="ring"
      />
      <div className="max-w-sm">
        <SplitPanel
          label="Spend this month, narrow"
          total={usd(600)}
          line="spent this month, narrow: the ring goes over the rows"
          rows={spend(SPEND_PARTS.slice(1, 3))}
          shape="ring"
        />
      </div>
    </div>
  ),
};

/** One account, a long name, a part with nothing spent, and nothing at all. */
export const RingWorstCase: Story = {
  render: () => (
    <div className="grid max-w-2xl gap-10">
      <SplitPanel
        label="Spend this month"
        total={usd(WORST.hugeCount)}
        line="one account takes it all"
        rows={spend([
          { name: WORST.longName, sum: WORST.hugeCount, vendors: [WORST.longName] },
          { name: "Bank fees", sum: 0, vendors: [] },
        ])}
        shape="ring"
      />
      <SplitPanel
        label="Nothing spent"
        total={usd(0)}
        line="Nothing spent this month yet"
        rows={[]}
        shape="ring"
      />
    </div>
  ),
};

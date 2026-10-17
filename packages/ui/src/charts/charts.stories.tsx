import type { Story, StoryDefault } from "@ladle/react";
import {
  FUNNEL,
  FUNNEL_STALLED,
  GAPPED,
  NO_FIGURES,
  ONE_DAY,
  TREND,
  WORST_FUNNEL,
  WORST_TREND,
} from "../fixtures/charts.js";
import { BarsChart, Sparkline, TrendChart } from "./index.js";

export default { title: "Charts" } satisfies StoryDefault;

const quiet = <div className="h-7" />;
const card = "rounded-(--ui-radius-panel) bg-(--ui-paper) p-4 shadow-(--ui-raise)";
const head = "mb-2 text-[12px] text-(--ui-ink-3)";
const percent = (n: number) => `${n}%`;

/** A tile's sparkline, the trend over a month, and a funnel; hover a bar or the area for the day. */
export const Default: Story = () => (
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
);

/** Nothing to draw: no days, no stages. The page adds the empty line. */
export const Empty: Story = () => (
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
);

/** The nearest real state: charts load their code on first show (a quiet box), and a read that has no figure yet draws days with none. */
export const Loading: Story = () => (
  <div className="grid max-w-3xl gap-6">
    <div className={`${card} max-w-xs`}>
      <Sparkline series={NO_FIGURES} slots={30} label="Visits" fallback={quiet} />
    </div>
    <div className={card}>
      <TrendChart series={NO_FIGURES} label="Visits" />
    </div>
  </div>
);

/** The nearest real state: charts have no error state, so days whose read failed are gaps the line spans, and a stage nobody reached keeps a thin bar. */
export const Failed: Story = () => (
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
);

/** Huge counts, a negative day, one lone day, and a funnel with long, mixed-script and empty labels. */
export const WorstCase: Story = () => (
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
);

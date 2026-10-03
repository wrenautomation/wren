/**
 * A bar chart the theme colors: series i reads `--chart-(i+1)`. Import it from `@wren/ui/chart`,
 * never the index, so Recharts loads only with the page that draws one.
 */
import { cn } from "cn";
import { Bar, BarChart as Bars, CartesianGrid, XAxis, YAxis } from "recharts";
import {
  type ChartConfig,
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
} from "./components/ui/chart.js";
import { num } from "./format.js";

export interface Series {
  key: string;
  label: string;
}

export function BarChart({
  data,
  x,
  series,
  className,
}: {
  data: Record<string, unknown>[];
  /** The field each group of bars is labeled by. */
  x: string;
  series: Series[];
  className?: string | undefined;
}) {
  const config: ChartConfig = Object.fromEntries(
    series.map((s, i) => [s.key, { label: s.label, color: `var(--chart-${(i % 5) + 1})` }]),
  );
  return (
    <ChartContainer config={config} className={cn("aspect-auto h-72 w-full", className)}>
      <Bars data={data} accessibilityLayer>
        <CartesianGrid vertical={false} />
        <XAxis dataKey={x} tickLine={false} axisLine={false} tickMargin={8} />
        <YAxis tickLine={false} axisLine={false} width={56} tickFormatter={(v: number) => num(v)} />
        <ChartTooltip content={<ChartTooltipContent />} />
        {series.length > 1 ? (
          <ChartLegend content={<ChartLegendContent />} itemSorter={null} />
        ) : null}
        {series.map((s) => (
          <Bar key={s.key} dataKey={s.key} fill={`var(--color-${s.key})`} radius={2} />
        ))}
      </Bars>
    </ChartContainer>
  );
}

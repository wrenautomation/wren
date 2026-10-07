/**
 * The portal's charts, drawn by Recharts through shadcn's chart pieces, in the tokens' colors.
 * One chunk, loaded when a chart first shows (`./index.tsx`), so first paint never carries it.
 */
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  XAxis,
  YAxis,
} from "recharts";
import {
  type ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "../components/ui/chart.js";
import type { BarsProps, SparkProps, TrendProps } from "./index.js";

const day = (at: unknown) =>
  typeof at === "string" && at
    ? new Date(at).toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
        timeZone: "UTC",
      })
    : "";
const plain = (n: number) => n.toLocaleString("en-US");
const short = (n: number) =>
  Math.abs(n) >= 1000
    ? n.toLocaleString("en-US", { notation: "compact", maximumFractionDigits: 1 })
    : plain(n);

/** A bar a day under a tile's number; a day with none keeps its slot. Hover says the day's. */
export function Spark({ series, slots, label, format = plain }: SparkProps) {
  const data = [
    ...series.map((p) => ({ at: p.at, value: p.value ?? 0 })),
    ...Array.from({ length: Math.max(0, slots - series.length) }, (_, i) => ({
      at: `+${i}`,
      value: null,
    })),
  ];
  const config = { value: { label, color: "var(--chart-1)" } } satisfies ChartConfig;
  return (
    <ChartContainer config={config} className="mt-2 aspect-auto h-7 w-full">
      <BarChart data={data} margin={{ top: 0, right: 0, bottom: 0, left: 0 }} barCategoryGap="15%">
        <XAxis dataKey="at" hide />
        <ChartTooltip
          cursor={false}
          isAnimationActive={false}
          allowEscapeViewBox={{ x: false, y: true }}
          wrapperStyle={{ zIndex: 20 }}
          content={(p) => (
            <ChartTooltipContent
              active={p.active}
              payload={p.payload as never}
              label={p.label}
              config={config}
              format={format}
              title={day}
            />
          )}
        />
        <Bar dataKey="value" fill="var(--color-value)" minPointSize={0} isAnimationActive={false} />
      </BarChart>
    </ChartContainer>
  );
}

/** A metric by day over the period: an area, the axis in its own units, hover for the day. */
export function Trend({ series, label, format = plain, height = 220 }: TrendProps) {
  // A day without a figure (a median's day with no rows) is a gap the line spans, not a zero.
  const data = series.map((p) => ({ at: p.at, value: p.value }));
  const config = { value: { label, color: "var(--chart-1)" } } satisfies ChartConfig;
  const tick = (n: number) => (format === plain ? short(n) : format(n));
  // The axis fits its widest label (a currency's prefix runs past a bare number's 44px).
  const top = Math.max(0, ...data.map((p) => p.value ?? 0));
  const axis = Math.max(44, tick(top).length * 7 + 10);
  return (
    <ChartContainer config={config} className="aspect-auto w-full" style={{ height }}>
      <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
        <CartesianGrid vertical={false} />
        <XAxis
          dataKey="at"
          tickLine={false}
          axisLine={false}
          tickMargin={8}
          minTickGap={28}
          tickFormatter={day}
        />
        <YAxis
          tickLine={false}
          axisLine={false}
          width={axis}
          allowDecimals={false}
          tickFormatter={tick}
        />
        <ChartTooltip
          isAnimationActive={false}
          content={(p) => (
            <ChartTooltipContent
              active={p.active}
              payload={p.payload as never}
              label={p.label}
              config={config}
              format={format}
              title={day}
            />
          )}
        />
        <Area
          dataKey="value"
          type="monotone"
          stroke="var(--color-value)"
          strokeWidth={1.5}
          fill="var(--color-value)"
          fillOpacity={0.12}
          connectNulls
          isAnimationActive={false}
        />
      </AreaChart>
    </ChartContainer>
  );
}

/**
 * Bars across, one a row, each with its value at its end: a funnel's stages (each with its rate
 * from the one before) or an A/B test's variants. The first bar sets the scale.
 */
export function Bars({ rows, label, format = plain }: BarsProps) {
  const config = { value: { label, color: "var(--chart-1)" } } satisfies ChartConfig;
  const data = rows.map((r) => ({
    name: r.label,
    value: r.value,
    text: `${format(r.value)}${r.note ? `  ${r.note}` : ""}`,
    tone: r.tone ?? "chart-1",
  }));
  return (
    <ChartContainer
      config={config}
      className="aspect-auto w-full"
      style={{ height: rows.length * 36 + 8 }}
    >
      <BarChart data={data} layout="vertical" margin={{ top: 4, right: 96, bottom: 4, left: 0 }}>
        <XAxis type="number" hide />
        <YAxis
          type="category"
          dataKey="name"
          tickLine={false}
          axisLine={false}
          width={132}
          tick={{ fill: "var(--ui-ink-2)", fontSize: 12 }}
        />
        <ChartTooltip
          cursor={false}
          isAnimationActive={false}
          content={(p) => (
            <ChartTooltipContent
              active={p.active}
              payload={p.payload as never}
              label={p.label}
              config={config}
              format={format}
            />
          )}
        />
        <Bar dataKey="value" barSize={20} minPointSize={2} isAnimationActive={false}>
          {data.map((d) => (
            <Cell key={d.name} fill={`var(--${d.tone})`} />
          ))}
          <LabelList
            dataKey="text"
            position="right"
            className="fill-(--ui-ink-2) text-[12px] tabular-nums"
          />
        </Bar>
      </BarChart>
    </ChartContainer>
  );
}

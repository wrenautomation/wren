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
  Line,
  LineChart,
  Pie,
  PieChart,
  XAxis,
  YAxis,
} from "recharts";
import {
  type ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "../components/ui/chart.js";
import { ellipsize } from "../format.js";
import {
  type BarsProps,
  type ColumnsProps,
  type LinesProps,
  RING_WIDTH,
  type RingProps,
  type SparkProps,
  type TrendProps,
} from "./index.js";

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

/** What an SVG label has room for: a row name in its 132px, a value and note in the margin and past it. */
const NAME_CHARS = 20;
const NOTE_CHARS = 48;

/**
 * Bars across, one a row, each with its value at its end: a funnel's stages (each with its rate
 * from the one before) or an A/B test's variants. The first bar sets the scale.
 */
export function Bars({ rows, label, format = plain }: BarsProps) {
  const config = { value: { label, color: "var(--chart-1)" } } satisfies ChartConfig;
  const data = rows.map((r) => ({
    name: r.label,
    value: r.value,
    text: ellipsize(`${format(r.value)}${r.note ? `  ${r.note}` : ""}`, NOTE_CHARS),
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
          tickFormatter={(v: string) => ellipsize(v, NAME_CHARS)}
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

/**
 * A figure per period, oldest first, as columns: whether it grows. Each column says its value on
 * top, so no axis is needed; a bill that lands once a month reads as one column, not a spike.
 */
export function Columns({ rows, label, parts, format = plain, height = 180 }: ColumnsProps) {
  if (parts)
    return <Stacked rows={rows} label={label} parts={parts} format={format} height={height} />;
  const config = { value: { label, color: "var(--chart-1)" } } satisfies ChartConfig;
  const data = rows.map((r) => ({ name: r.label, value: r.value, text: format(r.value) }));
  return (
    <ChartContainer config={config} className="aspect-auto w-full" style={{ height }}>
      <BarChart data={data} margin={{ top: 22, right: 0, bottom: 0, left: 0 }}>
        <XAxis
          dataKey="name"
          tickLine={false}
          axisLine={false}
          tickMargin={8}
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
        <Bar
          dataKey="value"
          fill="var(--color-value)"
          maxBarSize={56}
          minPointSize={2}
          radius={[2, 6, 2, 6]}
          isAnimationActive={false}
        >
          <LabelList
            dataKey="text"
            position="top"
            className="fill-(--ui-ink-2) text-[12px] tabular-nums"
          />
        </Bar>
      </BarChart>
    </ChartContainer>
  );
}

/** Columns cut into parts (bookings by channel), the total over each and a key below. */
function Stacked({
  rows,
  parts,
  format,
  height,
}: Pick<ColumnsProps, "rows" | "label"> & {
  parts: NonNullable<ColumnsProps["parts"]>;
  format: (n: number) => string;
  height: number;
}) {
  const config = Object.fromEntries(
    parts.map((p, i) => [`p${i}`, { label: p.label, color: p.color }]),
  ) satisfies ChartConfig;
  // The total rides on each column's topmost part with a value, so an empty top part hides none.
  const data = rows.map((r) => {
    const top = parts.findLastIndex((_, i) => (r.parts?.[i] ?? 0) > 0);
    return {
      name: r.label,
      ...Object.fromEntries(parts.map((_, i) => [`p${i}`, r.parts?.[i] ?? 0])),
      ...Object.fromEntries(parts.map((_, i) => [`t${i}`, i === top ? format(r.value) : ""])),
    };
  });
  const last = parts.length - 1;
  return (
    <div className="grid gap-3">
      <ChartContainer config={config} className="aspect-auto w-full" style={{ height }}>
        <BarChart data={data} margin={{ top: 22, right: 0, bottom: 0, left: 0 }}>
          <XAxis
            dataKey="name"
            tickLine={false}
            axisLine={false}
            tickMargin={8}
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
          {parts.map((p, i) => (
            <Bar
              key={p.label}
              dataKey={`p${i}`}
              stackId="all"
              fill={`var(--color-p${i})`}
              maxBarSize={56}
              radius={i === last ? [2, 6, 0, 0] : 0}
              isAnimationActive={false}
            >
              <LabelList
                dataKey={`t${i}`}
                position="top"
                className="fill-(--ui-ink-2) text-[12px] tabular-nums"
              />
            </Bar>
          ))}
        </BarChart>
      </ChartContainer>
      <Key parts={parts} />
    </div>
  );
}

/** The key under a chart of two or more series: each one's colour and name. */
function Key({ parts }: { parts: readonly { label: string; color: string }[] }) {
  return (
    <ul className="m-0 flex list-none flex-wrap gap-x-4 gap-y-1 p-0 text-[13px]">
      {parts.map((p) => (
        <li key={p.label} className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-[1px_3px]" style={{ background: p.color }} />
          {p.label}
        </li>
      ))}
    </ul>
  );
}

/**
 * Several series by day on one axis, a 2px line each, hover for the day's figures. Never two
 * scales: series of other units get their own chart.
 */
export function Lines({ rows, series, format = plain, height = 220 }: LinesProps) {
  const config = Object.fromEntries(
    series.map((s) => [s.key, { label: s.label, color: s.color }]),
  ) satisfies ChartConfig;
  const tick = (n: number) => (format === plain ? short(n) : format(n));
  const top = Math.max(
    0,
    ...rows.flatMap((r) =>
      series.map((s) => (typeof r[s.key] === "number" ? Number(r[s.key]) : 0)),
    ),
  );
  const axis = Math.max(44, tick(top).length * 7 + 10);
  return (
    <div className="grid gap-3">
      <ChartContainer config={config} className="aspect-auto w-full" style={{ height }}>
        <LineChart data={[...rows]} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
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
          {series.map((s) => (
            <Line
              key={s.key}
              dataKey={s.key}
              type="monotone"
              stroke={s.color}
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 4, stroke: "var(--ui-paper)", strokeWidth: 2 }}
              isAnimationActive={false}
            />
          ))}
        </LineChart>
      </ChartContainer>
      {series.length > 1 ? <Key parts={series} /> : null}
    </div>
  );
}

/**
 * A whole and its parts as a ring: each part a slice, a 2px paper gap between, clockwise from the
 * top. The figures sit in the rows beside it, so the ring carries no labels; a slice under the
 * pointer brings itself forward and tells the caller, which lights its row.
 */
export function Ring({ slices, hot, onHot, onPick, size = 176 }: RingProps) {
  const outer = size / 2;
  return (
    // The rows beside it are the keyboard's way in; the ring takes no focus.
    <PieChart
      width={size}
      height={size}
      margin={{ top: 0, right: 0, bottom: 0, left: 0 }}
      accessibilityLayer={false}
    >
      <Pie
        rootTabIndex={-1}
        data={slices.map((s) => ({ name: s.key, value: s.value }))}
        dataKey="value"
        nameKey="name"
        outerRadius={outer}
        innerRadius={outer - size * RING_WIDTH}
        startAngle={90}
        endAngle={-270}
        cornerRadius={3}
        stroke="var(--ui-paper)"
        strokeWidth={2}
        isAnimationActive={false}
        onMouseEnter={(_, i) => onHot?.(slices[i]?.key ?? null)}
        onMouseLeave={() => onHot?.(null)}
        onClick={(_, i) => {
          const key = slices[i]?.key;
          if (key) onPick?.(key);
        }}
        className={onPick ? "cursor-pointer" : ""}
      >
        {slices.map((s) => (
          <Cell
            key={s.key}
            fill={s.color}
            fillOpacity={hot && hot !== s.key ? 0.28 : 1}
            className="transition-[fill-opacity] duration-200 outline-none motion-reduce:transition-none"
          />
        ))}
      </Pie>
    </PieChart>
  );
}

/**
 * shadcn's chart pieces on Recharts, kept to what the portal draws. One change: shadcn writes its
 * series colors into a <style> tag, which the portal's CSP refuses; here each series' color is a
 * CSS variable set on the container (`--color-<key>`), so it's the same tokens with no tag.
 */
import { cn } from "cn";
import type { ComponentProps, CSSProperties, ReactNode } from "react";
import { ResponsiveContainer, Tooltip } from "recharts";

export type ChartConfig = Record<string, { label: ReactNode; color?: string }>;

export function ChartContainer({
  config,
  className,
  children,
  style,
  ...props
}: ComponentProps<"div"> & {
  config: ChartConfig;
  children: ComponentProps<typeof ResponsiveContainer>["children"];
}) {
  const vars = Object.fromEntries(
    Object.entries(config).flatMap(([k, v]) => (v.color ? [[`--color-${k}`, v.color]] : [])),
  ) as CSSProperties;
  return (
    <div
      data-slot="chart"
      className={cn(
        "flex aspect-video justify-center text-[11px] text-(--ui-ink-2) tabular-nums",
        "[&_.recharts-cartesian-axis-tick_text]:fill-(--ui-ink-3) [&_.recharts-cartesian-grid_line]:stroke-(--ui-hair)",
        "[&_.recharts-curve.recharts-tooltip-cursor]:stroke-(--ui-ink-3) [&_.recharts-rectangle.recharts-tooltip-cursor]:fill-(--ui-wash)",
        "[&_.recharts-surface]:outline-hidden [&_.recharts-layer]:outline-hidden",
        className,
      )}
      style={{ ...vars, ...style }}
      {...props}
    >
      <ResponsiveContainer initialDimension={{ width: 320, height: 160 }}>
        {children}
      </ResponsiveContainer>
    </div>
  );
}

export const ChartTooltip = Tooltip;

interface Item {
  dataKey?: unknown;
  name?: unknown;
  value?: unknown;
  color?: string;
}

/** The tooltip's card: the day on top, then each series' color, name and value. */
export function ChartTooltipContent({
  active,
  payload,
  label,
  config,
  format = (n) => n.toLocaleString("en-US"),
  title = (l) => String(l ?? ""),
}: {
  active?: boolean;
  payload?: readonly Item[];
  label?: unknown;
  config: ChartConfig;
  format?: (n: number) => string;
  title?: (label: unknown) => string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="grid min-w-32 gap-1 border border-(--ui-hair) bg-(--ui-paper) px-2.5 py-1.5 text-[12px] text-(--ui-ink) shadow-(--ui-shadow)">
      <span className="font-medium">{title(label)}</span>
      {payload.map((p) => {
        const key = String(p.dataKey ?? p.name ?? "");
        return (
          <span key={key} className="flex items-center gap-2">
            <span
              className="size-2 shrink-0"
              style={{ background: config[key]?.color ?? p.color }}
              aria-hidden="true"
            />
            <span className="flex-1 text-(--ui-ink-2)">{config[key]?.label ?? key}</span>
            <span className="font-medium tabular-nums">
              {typeof p.value === "number" ? format(p.value) : "—"}
            </span>
          </span>
        );
      })}
    </div>
  );
}

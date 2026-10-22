/**
 * Charts, loaded on first show: Recharts is its own chunk, so a page without a chart never loads
 * it. Each waits on the plain drawing it replaces, or a box its size.
 */
import { lazy, type ReactNode, Suspense } from "react";

type Series = readonly { at: string; value: number | null }[];

export interface SparkProps {
  series: Series;
  /** Days the period has room for: a month keeps a slot for each. */
  slots: number;
  /** What a bar counts, in its tooltip. */
  label: string;
  format?: ((n: number) => string) | undefined;
}
export interface TrendProps {
  series: Series;
  label: string;
  format?: ((n: number) => string) | undefined;
  height?: number | undefined;
}
export interface BarsRow {
  label: string;
  value: number;
  /** After the value: "7.5% of the stage before". */
  note?: string | undefined;
  /** A token: "chart-2", "ui-good". */
  tone?: string | undefined;
}
export interface ColumnsProps {
  /** Oldest first: "Aug", "Sep", "Oct". With `parts`, `parts` holds each part's share of `value`. */
  rows: readonly { label: string; value: number; parts?: readonly number[] | undefined }[];
  label: string;
  /** Stacks each column from these, bottom first, with a key under the chart. */
  parts?: readonly { label: string; color: string }[] | undefined;
  format?: ((n: number) => string) | undefined;
  height?: number | undefined;
}
export interface BarsProps {
  rows: readonly BarsRow[];
  label: string;
  format?: ((n: number) => string) | undefined;
}

const Draw = {
  Spark: lazy(() => import("./draw.js").then((m) => ({ default: m.Spark }))),
  Trend: lazy(() => import("./draw.js").then((m) => ({ default: m.Trend }))),
  Bars: lazy(() => import("./draw.js").then((m) => ({ default: m.Bars }))),
  Columns: lazy(() => import("./draw.js").then((m) => ({ default: m.Columns }))),
};

export function Sparkline({ fallback, ...props }: SparkProps & { fallback: ReactNode }) {
  return (
    <Suspense fallback={fallback}>
      <Draw.Spark {...props} />
    </Suspense>
  );
}

export function TrendChart(props: TrendProps) {
  return (
    <Suspense fallback={<div style={{ height: props.height ?? 220 }} aria-busy="true" />}>
      <Draw.Trend {...props} />
    </Suspense>
  );
}

export function BarsChart(props: BarsProps) {
  return (
    <Suspense fallback={<div style={{ height: props.rows.length * 36 + 8 }} aria-busy="true" />}>
      <Draw.Bars {...props} />
    </Suspense>
  );
}

export function ColumnsChart(props: ColumnsProps) {
  return (
    <Suspense fallback={<div style={{ height: props.height ?? 180 }} aria-busy="true" />}>
      <Draw.Columns {...props} />
    </Suspense>
  );
}

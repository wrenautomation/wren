/** Fixtures for `charts/`: a month of daily figures, a funnel, and the worst values. */
import type { BarsRow } from "../charts/index.js";
import { WORST } from "./worst.js";

type Series = { at: string; value: number | null }[];

const START = Date.UTC(2026, 8, 18);
const dayAt = (i: number) => new Date(START + i * 86_400_000).toISOString();

/** `values` as consecutive days from 2026-09-18. */
export const seriesOf = (values: readonly (number | null)[]): Series =>
  values.map((value, i) => ({ at: dayAt(i), value }));

const MONTH = [
  12, 18, 15, 22, 30, 28, 9, 11, 25, 31, 36, 33, 29, 14, 12, 27, 38, 41, 44, 39, 21, 17, 35, 42, 47,
  51, 46, 24, 20, 49,
];

/** Thirty days of a rising count. */
export const TREND = seriesOf(MONTH);
/** The same days; two had no figure (a read that failed leaves a gap, not a zero). */
export const GAPPED = seriesOf(MONTH.map((v, i) => (i === 8 || i === 9 || i === 20 ? null : v)));
/** Days that have no figure yet. */
export const NO_FIGURES = seriesOf(Array.from({ length: 30 }, () => null));
/** Huge counts and one negative day. */
export const WORST_TREND = seriesOf(
  MONTH.map((v, i) => (i === 12 ? WORST.negative : v * 40_000_000)),
);
/** A single day. */
export const ONE_DAY = seriesOf([WORST.hugeCount]);

/** A funnel: each stage with its rate from the one before. */
export const FUNNEL: BarsRow[] = [
  { label: "Visits", value: 4200 },
  { label: "Read the offer", value: 1900, note: "45% of the stage before" },
  { label: "Booked a call", value: 210, note: "11% of the stage before", tone: "chart-2" },
  { label: "Signed", value: 38, note: "18% of the stage before", tone: "ui-good" },
];

/** A funnel with a stage that nobody reached. */
export const FUNNEL_STALLED: BarsRow[] = FUNNEL.map((r, i) => (i === 3 ? { ...r, value: 0 } : r));

export const WORST_FUNNEL: BarsRow[] = [
  { label: WORST.longLabel, value: WORST.hugeCount, note: WORST.longLabel },
  { label: WORST.nonLatin, value: 12, note: WORST.rtl },
  { label: WORST.emoji, value: WORST.zero, tone: "ui-good" },
  { label: WORST.empty, value: 1 },
  { label: WORST.shortName, value: WORST.negative },
];

/** A month's spend by account, biggest first: seven parts, so the ring folds two into the rest. */
export const SPEND_PARTS = [
  { name: "AI models", sum: 412, vendors: ["Model vendor A", "Model vendor B"] },
  { name: "Hosting", sum: 188, vendors: ["Cloud vendor"] },
  { name: "Software", sum: 96, vendors: ["Editor", "Design tool", "Mail app"] },
  { name: "Ads", sum: 60, vendors: ["Ad network"] },
  { name: "Phone and SMS", sum: 31, vendors: ["Phone vendor"] },
  { name: "Domains", sum: 12, vendors: ["Registrar"] },
  { name: "Bank fees", sum: 3, vendors: ["Bank"] },
];

import type { Meta, StoryObj } from "@storybook/react-vite";
import { type ReactNode, useState } from "react";
import { Seg } from "../controls.js";
import {
  DAYS_OF,
  type Day,
  HOUR_WEIGHT,
  PLATFORMS,
  type PlatformKey,
} from "../fixtures/dashboard.js";
import { BarsChart, ColumnsChart, HeatChart, LinesChart, RingChart, Sparkline } from "./index.js";

export default {
  title: "Charts/Dashboard",
  parameters: { layout: "fullscreen" },
} satisfies Meta;

type Story = StoryObj;

/** A platform keeps its colour in every chart, filtered or not: colour is the platform, not its rank. */
const COLOR = Object.fromEntries(
  PLATFORMS.map((p, i) => [p.key, `var(--ui-chart-${i + 1})`]),
) as Record<PlatformKey, string>;
const PERIODS = [
  { value: "7", label: "7 days" },
  { value: "30", label: "30 days" },
  { value: "90", label: "90 days" },
] as const;
type Period = (typeof PERIODS)[number]["value"];
type Pick = PlatformKey | "all";
const DOW = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

const plain = (n: number) => n.toLocaleString("en-US");
const short = (n: number) =>
  n >= 10_000
    ? n.toLocaleString("en-US", { notation: "compact", maximumFractionDigits: 1 })
    : plain(n);
const pct = (n: number) => `${n.toFixed(2)}%`;
const day = (at: string) =>
  new Date(at).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

const card =
  "grid content-start gap-3 rounded-(--ui-radius-panel) bg-(--ui-paper) p-4 shadow-(--ui-raise)";

/** A panel: its question as the title, a line on how to read it, then the chart. */
function Panel({
  title,
  line,
  className,
  children,
}: {
  title: string;
  line: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section aria-label={title} className={`${card} ${className ?? ""}`}>
      <header className="grid gap-0.5">
        <h3 className="m-0 text-[15px] font-semibold">{title}</h3>
        <p className="m-0 text-[12.5px] text-(--ui-ink-3)">{line}</p>
      </header>
      {children}
    </section>
  );
}

/** A headline figure: its value, the change from the period before, and a bar a day. */
function Kpi({
  label,
  value,
  before,
  series,
  format,
  slots,
  quietIsGood = false,
}: {
  label: string;
  value: number;
  before: number;
  series: { at: string; value: number }[];
  format: (n: number) => string;
  slots: number;
  quietIsGood?: boolean;
}) {
  const change = before ? ((value - before) / before) * 100 : 0;
  const up = change >= 0;
  const good = quietIsGood ? !up : up;
  return (
    <section aria-label={label} className={`${card} gap-1`}>
      <span className="text-[12.5px] text-(--ui-ink-3)">{label}</span>
      <b className="text-[28px] leading-none font-semibold tracking-[-0.03em] tabular-nums">
        {format(value)}
      </b>
      <Sparkline
        series={series}
        slots={slots}
        label={label}
        format={format}
        fallback={<div className="mt-2 h-7" />}
      />
      <span className="text-[12.5px] text-(--ui-ink-3)">
        <b
          className={good ? "font-semibold text-(--ui-good-ink)" : "font-semibold text-(--ui-ink)"}
        >
          {up ? "▲" : "▼"} {Math.abs(change).toFixed(1)}%
        </b>{" "}
        vs the {slots} days before
      </span>
    </section>
  );
}

const sum = (days: Day[], key: "views" | "replies" | "calls" | "signed", on: PlatformKey[]) =>
  days.reduce((n, d) => n + on.reduce((m, p) => m + d[key][p], 0), 0);

/** The days in buckets for columns: a column a day for a week, a column a week past that. */
function buckets(days: Day[]) {
  if (days.length <= 7)
    return days.map((d) => ({ label: day(d.at).replace(/^\w+ /, ""), days: [d] }));
  // Whole weeks end on the last day; the days before the first whole week make a short column.
  const out: { label: string; days: Day[] }[] = [];
  const lead = days.length % 7;
  if (lead)
    out.push({
      label: `${day(days[0]?.at ?? "")}, ${lead} day${lead > 1 ? "s" : ""}`,
      days: days.slice(0, lead),
    });
  for (let i = lead; i < days.length; i += 7) {
    const week = days.slice(i, i + 7);
    out.push({ label: day(week[0]?.at ?? ""), days: week });
  }
  return out;
}

function Dashboard() {
  const [period, setPeriod] = useState<Period>("30");
  const [pick, setPick] = useState<Pick>("all");
  const [hot, setHot] = useState<string | null>(null);
  const n = Number(period);
  const days = DAYS_OF.slice(-n);
  const before = DAYS_OF.slice(-2 * n, -n);
  const on: PlatformKey[] = pick === "all" ? PLATFORMS.map((p) => p.key) : [pick];
  const shown = PLATFORMS.filter((p) => on.includes(p.key));

  const views = sum(days, "views", on);
  const replies = sum(days, "replies", on);
  const calls = sum(days, "calls", on);
  const signed = sum(days, "signed", on);
  const per = (key: "views" | "replies" | "calls") =>
    days.map((d) => ({ at: d.at, value: on.reduce((m, p) => m + d[key][p], 0) }));
  const rate = (ds: Day[]) => {
    const v = sum(ds, "views", on);
    return v ? (sum(ds, "replies", on) / v) * 100 : 0;
  };

  const share = PLATFORMS.map((p) => ({
    key: p.key,
    label: p.label,
    value: sum(days, "views", [p.key]),
  })).sort((a, b) => b.value - a.value);
  const whole = share.reduce((m, s) => m + s.value, 0);
  const lit = hot ?? (pick === "all" ? null : pick);
  const litShare = share.find((s) => s.key === lit) ?? share[0];

  const weeks = buckets(days);
  const weight = HOUR_WEIGHT.flat().reduce((a, b) => a + b, 0);
  const heat = HOUR_WEIGHT.map((row) => row.map((w) => Math.round((replies * w) / weight)));

  return (
    <div className="grid min-h-screen content-start gap-4 bg-(--ui-canvas) p-4 text-(--ui-ink) md:p-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="grid gap-0.5">
          <h2 className="m-0 text-[22px] font-semibold tracking-[-0.02em]">Content numbers</h2>
          <p className="m-0 text-[13px] text-(--ui-ink-2)">
            {day(days[0]?.at ?? "")} to {day(days.at(-1)?.at ?? "")} ·{" "}
            {pick === "all" ? "every platform" : PLATFORMS.find((p) => p.key === pick)?.label}.
            Click a ring slice to filter every panel.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Seg label="Period" items={PERIODS} value={period} onChange={setPeriod} dense />
          <Seg<Pick>
            label="Platform"
            items={[
              { value: "all", label: "All" },
              ...PLATFORMS.map((p) => ({ value: p.key, label: p.label })),
            ]}
            value={pick}
            onChange={setPick}
            dense
          />
        </div>
      </header>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Kpi
          label="Views"
          value={views}
          before={sum(before, "views", on)}
          series={per("views")}
          format={short}
          slots={n}
        />
        <Kpi
          label="Replies"
          value={replies}
          before={sum(before, "replies", on)}
          series={per("replies")}
          format={plain}
          slots={n}
        />
        <Kpi
          label="Reply rate"
          value={rate(days)}
          before={rate(before)}
          series={days.map((d) => ({ at: d.at, value: rate([d]) }))}
          format={pct}
          slots={n}
        />
        <Kpi
          label="Calls booked"
          value={calls}
          before={sum(before, "calls", on)}
          series={per("calls")}
          format={plain}
          slots={n}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-12">
        <Panel
          title="Which platform grows views?"
          line="Views a day, a line per platform. Hover for the day."
          className="lg:col-span-8"
        >
          <LinesChart
            rows={days.map((d) => ({
              at: d.at,
              ...Object.fromEntries(on.map((p) => [p, d.views[p]])),
            }))}
            series={shown.map((p) => ({ key: p.key, label: p.label, color: COLOR[p.key] }))}
            format={short}
            height={240}
          />
        </Panel>
        <Panel
          title="Where do views come from?"
          line="Each platform's share of the period's views. Click a slice to filter."
          className="lg:col-span-4"
        >
          <div className="grid items-center gap-4 sm:grid-cols-[176px_minmax(0,1fr)] lg:grid-cols-1 xl:grid-cols-[176px_minmax(0,1fr)]">
            <div className="relative justify-self-center" aria-hidden="true">
              <RingChart
                slices={share.map((s) => ({ key: s.key, value: s.value, color: COLOR[s.key] }))}
                hot={lit}
                onHot={setHot}
                onPick={(k) => setPick((was) => (was === k ? "all" : (k as PlatformKey)))}
              />
              {litShare && whole ? (
                <div className="pointer-events-none absolute inset-[30px] grid place-content-center gap-0.5 text-center">
                  <b className="text-[26px] leading-none font-semibold tracking-[-0.03em] tabular-nums">
                    {Math.round((litShare.value / whole) * 100)}%
                  </b>
                  <span className="text-[12.5px] text-(--ui-ink-3)">{litShare.label}</span>
                </div>
              ) : null}
            </div>
            <ul className="m-0 grid list-none gap-0.5 p-0">
              {share.map((s) => (
                <li key={s.key}>
                  <button
                    type="button"
                    aria-pressed={pick === s.key}
                    onClick={() => setPick((was) => (was === s.key ? "all" : s.key))}
                    onMouseEnter={() => setHot(s.key)}
                    onMouseLeave={() => setHot(null)}
                    onFocus={() => setHot(s.key)}
                    onBlur={() => setHot(null)}
                    className="grid w-full grid-cols-[10px_minmax(0,1fr)_auto] items-center gap-2.5 px-2 py-1.5 text-left text-[13.5px] transition-[background-color] duration-200 [border-radius:3px_10px] hover:bg-(--ui-accent-wash) focus-visible:bg-(--ui-accent-wash) aria-pressed:bg-(--ui-accent-wash) motion-reduce:transition-none"
                  >
                    <i
                      className="size-2.5 [border-radius:2px_5px]"
                      style={{ background: COLOR[s.key] }}
                    />
                    {s.label}
                    <span className="text-(--ui-ink-2) tabular-nums">{short(s.value)}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </Panel>

        <Panel
          title="Which platform brings replies?"
          line={
            n <= 7
              ? "Replies a day, cut by platform."
              : "Replies a week, cut by platform. Each total on top."
          }
          className="lg:col-span-7"
        >
          <ColumnsChart
            label="Replies"
            rows={weeks.map((w) => ({
              label: w.label,
              value: sum(w.days, "replies", on),
              parts: shown.map((p) => sum(w.days, "replies", [p.key])),
            }))}
            parts={shown.map((p) => ({ label: p.label, color: COLOR[p.key] }))}
            height={220}
          />
        </Panel>
        <Panel
          title="Where do replies drop off?"
          line="From a reply to a signed client, each stage with its rate from the one before."
          className="lg:col-span-5"
        >
          <BarsChart
            label="People"
            rows={[
              { label: "Replies", value: replies },
              {
                label: "Calls booked",
                value: calls,
                note: `${Math.round((calls / replies) * 100)}% of replies`,
              },
              {
                label: "Signed",
                value: signed,
                note: `${calls ? Math.round((signed / calls) * 100) : 0}% of calls`,
                tone: "ui-good",
              },
            ]}
          />
        </Panel>

        <Panel
          title="When do replies come in?"
          line="Replies by weekday and hour, deeper for more. Hover a cell for its count."
          className="lg:col-span-12"
        >
          <HeatChart
            rows={DOW}
            cols={Array.from({ length: 24 }, (_, h) => (h % 3 === 0 ? String(h) : ""))}
            cells={heat}
            label="replies"
          />
        </Panel>
      </div>
    </div>
  );
}

/**
 * A BI-style page on made-up numbers: headline figures, a line per platform, a share ring that
 * filters every panel on a click, replies cut by platform, the funnel, and a weekday by hour map.
 * Each panel's title is the question it answers.
 */
export const Default: Story = { render: () => <Dashboard /> };

/**
 * A post's numbers on its page (designs/2026-10-07-content-analytics.md, Where each number
 * lives): how it did, with a sparkline a metric and its state where it isn't read; the
 * retention curve; where viewers came from; what it brought to the site; its conversation.
 * Every number links to its rows. Read from the post's detail (`postAnalytics`).
 */
import type { Row } from "@wren/core/records/serve";
import { BarsChart, type BarsRow, num, type RecordExtras, Sparkline } from "@wren/ui";
import type { ReactNode } from "react";
import type { ListPage } from "../../module.js";

interface Cell {
  label: string;
  group: string;
  metrics: readonly string[];
  state: string;
  says: string;
  need: { name: string; step: string } | null;
  why: string | null;
  latest: Record<string, number>;
}
interface Analytics {
  platform: string;
  surface: "long" | "short" | "post";
  series: Record<string, { at: string; value: number }[]>;
  curve: { at: number; value: number }[];
  relative: { at: number; value: number }[];
  sources: { key: string; value: number }[];
  terms: { key: string; value: number }[];
  cells: Cell[];
  site: {
    clicks: number;
    hops: number;
    formsFirst: number;
    formsLast: number;
    callsFirst: number;
    callsLast: number;
    wonFirst: number;
    wonLast: number;
    revenueFirst: number;
    revenueLast: number;
    links: { source: string; campaign: string; content: string; clicks: number }[];
  };
  conversation: { theirs: number; answered: number; replySecs: number | null; dmed: number };
}

const QUIET = "text-(--ui-ink-2)";
const SLOTS = 30;
const NAMES: Record<string, string> = {
  views: "Views",
  impressions: "Impressions",
  ctr: "CTR",
  reach: "Reach",
  likes: "Likes",
  comments: "Comments",
  shares: "Shares",
  saves: "Saves",
  interactions: "Interactions",
  follows: "Follows",
  unfollows: "Unfollows",
  profile_visits: "Profile visits",
  profile_clicks: "Profile clicks",
  link_clicks: "Link clicks",
  avg_view_secs: "Average view",
  avg_view_pct: "Viewed",
  watch_minutes: "Watch minutes",
  engaged_views: "Engaged views",
  hold_30s: "Held 30s",
  upvote_ratio: "Upvoted",
  engagement: "Per 100 views",
  per_follower: "Per 100 followers",
};

export function secs(s: number): string {
  const t = Math.max(0, Math.round(s));
  if (t < 60) return `${t}s`;
  if (t < 3600) return `${Math.floor(t / 60)}m ${t % 60}s`;
  if (t < 86_400) return `${Math.floor(t / 3600)}h ${Math.floor((t % 3600) / 60)}m`;
  return `${Math.floor(t / 86_400)}d ${Math.floor((t % 86_400) / 3600)}h`;
}

/** A metric's value as people read it: a share as a percent, seconds as a time. */
export function said(metric: string, n: number): string {
  if (metric === "avg_view_pct" || metric === "ctr" || metric === "hold_30s")
    return `${(Math.round(n * 10) / 10).toFixed(1)}%`;
  if (metric === "upvote_ratio") return `${Math.round(n * 100)}%`;
  if (metric === "engagement" || metric === "per_follower")
    return (Math.round(n * 10) / 10).toFixed(1);
  if (metric.endsWith("_secs")) return secs(n);
  return num(Math.round(n));
}

/** The rows behind a post's numbers: its own look snapshots on the Activity tab. */
const linkOf = (href: string, children: ReactNode) => (
  <a
    href={href}
    className="underline decoration-(--ui-hair) underline-offset-2 hover:decoration-(--ui-ink)"
  >
    {children}
  </a>
);

function Cells({ a, activity }: { a: Analytics; activity: string }) {
  // The funnel and the conversation have their own sections; iteration lives on the Overview.
  // The curve, sources and terms draw as their own sections once they have points.
  const drawn = new Set([
    ...(a.curve.length > 1 ? ["retention", "relative_retention"] : []),
    ...(a.sources.length ? ["traffic_source"] : []),
    ...(a.terms.length ? ["search_term"] : []),
  ]);
  const shown = a.cells.filter(
    (c) =>
      !["iteration", "funnel", "conversation"].includes(c.group) &&
      !c.metrics.every((m) => drawn.has(m)),
  );
  return (
    <ul className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] border-t border-l border-(--ui-hair)">
      {shown.map((c) => {
        const values = c.metrics.filter((m) => c.latest[m] !== undefined);
        const first = values[0];
        const series = first ? (a.series[first] ?? []) : [];
        return (
          <li
            key={c.label}
            className="grid min-h-24 content-start gap-1 border-r border-b border-(--ui-hair) p-3"
          >
            <span className={`text-[12.5px] ${QUIET}`}>{c.label}</span>
            {values.length ? (
              <>
                <span className="flex flex-wrap gap-x-3 text-[17px] tabular-nums">
                  {values.map((m) =>
                    linkOf(
                      activity,
                      <span key={m} title={NAMES[m] ?? m}>
                        {said(m, c.latest[m] as number)}
                        {values.length > 1 ? (
                          <span className={`ml-1 text-[12px] ${QUIET}`}>
                            {(NAMES[m] ?? m).toLowerCase()}
                          </span>
                        ) : null}
                      </span>,
                    ),
                  )}
                </span>
                {series.length > 1 && first ? (
                  <div className="h-8">
                    <Sparkline
                      series={series}
                      slots={Math.max(series.length, Math.min(SLOTS, series.length))}
                      label={NAMES[first] ?? first}
                      format={(n) => said(first, n)}
                      fallback={<div className="h-8" />}
                    />
                  </div>
                ) : null}
              </>
            ) : (
              <StateLine c={c} />
            )}
          </li>
        );
      })}
    </ul>
  );
}

/** Where a number would sit when it isn't read: why, and the one step that would read it. */
function StateLine({ c }: { c: Cell }) {
  const line = c.state === "live" ? "No number yet" : c.says;
  return (
    <span className="grid gap-0.5 text-[13px]">
      <span
        className={
          c.state === "needs_scope" || c.state === "needs_william" ? "text-(--ui-warn)" : QUIET
        }
      >
        {line}
      </span>
      {c.need && c.state !== "live" ? (
        <span className={`text-[12px] ${QUIET}`}>{c.need.step}</span>
      ) : null}
      {c.why && c.state !== "live" && !c.need ? (
        <span className={`text-[12px] ${QUIET}`}>{c.why}</span>
      ) : null}
    </span>
  );
}

/** Share still watching across the video: the curve, and YouTube's relative line dashed. */
export function RetentionCurve({ a }: { a: Pick<Analytics, "curve" | "relative"> }) {
  const W = 600;
  const H = 160;
  const top = Math.max(1, ...a.curve.map((p) => p.value), ...a.relative.map((p) => p.value));
  const path = (pts: { at: number; value: number }[]) =>
    pts.map((p) => `${(p.at * W).toFixed(1)},${(H - (p.value / top) * H).toFixed(1)}`).join(" ");
  const last = a.curve.at(-1);
  return (
    <figure className="grid gap-2">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="h-40 w-full"
        preserveAspectRatio="none"
        role="img"
        aria-label={`Retention: ${last ? Math.round(last.value * 100) : 0}% still watching at the end`}
      >
        <line x1="0" y1={H} x2={W} y2={H} stroke="var(--ui-hair)" />
        {a.relative.length ? (
          <polyline
            points={path(a.relative)}
            fill="none"
            stroke="var(--ui-ink-2)"
            strokeDasharray="4 4"
            vectorEffect="non-scaling-stroke"
          />
        ) : null}
        <polyline
          points={path(a.curve)}
          fill="none"
          stroke="var(--ui-chart-1)"
          strokeWidth="2"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
      <figcaption className={`flex justify-between text-[12px] ${QUIET}`}>
        <span>Start</span>
        <span>Still watching{a.relative.length ? "; dashed: against videos this long" : ""}</span>
        <span>End</span>
      </figcaption>
    </figure>
  );
}

const bars = (rows: { key: string; value: number }[]): BarsRow[] =>
  rows
    .slice()
    .sort((x, y) => y.value - x.value)
    .slice(0, 8)
    .map((r, i) => ({
      label: r.key.replaceAll("_", " ").toLowerCase(),
      value: r.value,
      tone: `chart-${(i % 5) + 1}`,
    }));

function Brought({ a, links }: { a: Analytics; links: string }) {
  const s = a.site;
  const views = a.series.views?.at(-1)?.value ?? 0;
  const lines: [string, ReactNode][] = [
    ["Visitors from its link", s.clicks],
    ...(views
      ? ([["Post to site", `${((s.clicks / views) * 100).toFixed(1)}% of views`]] as [
          string,
          ReactNode,
        ][])
      : []),
    ...(a.platform === "youtube"
      ? ([["Taps to the site from YouTube", s.hops]] as [string, ReactNode][])
      : []),
    ["Forms (first touch, last touch)", `${num(s.formsFirst)}, ${num(s.formsLast)}`],
    ["Calls booked (first, last)", `${num(s.callsFirst)}, ${num(s.callsLast)}`],
    ["Clients won (first, last)", `${num(s.wonFirst)}, ${num(s.wonLast)}`],
    [
      "Revenue (first, last)",
      `$${num(Math.round(s.revenueFirst))}, $${num(Math.round(s.revenueLast))}`,
    ],
  ];
  if (a.surface === "short")
    return (
      <p className={`text-[14px] ${QUIET}`}>Not in the API: a Short's links can't be clicked.</p>
    );
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1.5 text-[14px]">
      {lines.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className={QUIET}>{k}</dt>
          <dd className="tabular-nums">{linkOf(links, typeof v === "number" ? num(v) : v)}</dd>
        </div>
      ))}
    </dl>
  );
}

function Conversation({ a, comments }: { a: Analytics; comments: string }) {
  const c = a.conversation;
  if (!c.theirs) return <p className={`text-[14px] ${QUIET}`}>No comments from others yet.</p>;
  const pct = (n: number) => `${Math.round((n / c.theirs) * 100)}%`;
  const lines: [string, string][] = [
    ["Their comments", num(c.theirs)],
    ["Answered", `${num(c.answered)} (${pct(c.answered)})`],
    ["Time to reply (median)", c.replySecs === null ? "None answered" : secs(c.replySecs)],
    [
      "Turned into a DM",
      a.platform === "youtube"
        ? "Not in the API: YouTube has no DMs"
        : a.platform === "instagram"
          ? "Needs scope: Instagram messages"
          : `${num(c.dmed)} (${pct(c.dmed)})`,
    ],
  ];
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1.5 text-[14px]">
      {lines.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className={QUIET}>{k}</dt>
          <dd className="tabular-nums">{linkOf(comments, v)}</dd>
        </div>
      ))}
    </dl>
  );
}

/** The sections a post's numbers add, in the page's order. */
export function analyticsSections(detail: unknown, row: Row): [string, ReactNode][] {
  const a = (detail as { analytics?: Analytics | null } | null)?.analytics;
  if (!a) return [];
  const id = String(row.id ?? "");
  const draft = id.split("/")[2] ?? "";
  const title = String(row.title ?? "");
  // A video's footer link is its campaign; any other post's /go/ link carries its id.
  const footer = a.site.links.find((l) => !l.content);
  const links = footer
    ? `/marketing/links?view=all&campaign=${encodeURIComponent(footer.campaign)}`
    : `/marketing/links?view=all&content=${encodeURIComponent(draft.slice(0, 8))}`;
  const comments = `/marketing/comments?view=all&postTitle=${encodeURIComponent(title.slice(0, 60))}`;
  const activity = `/marketing/content?view=all&post=${encodeURIComponent(id)}&tab=activity`;
  const out: [string, ReactNode][] = [
    ["How it did", <Cells key="did" a={a} activity={activity} />],
  ];
  if (a.curve.length > 1) out.push(["Retention", <RetentionCurve key="curve" a={a} />]);
  if (a.sources.length)
    out.push([
      "Where viewers came from",
      <BarsChart key="src" rows={bars(a.sources)} label="Views by source" format={num} />,
    ]);
  if (a.terms.length)
    out.push([
      "What they searched",
      <BarsChart key="terms" rows={bars(a.terms)} label="Views by search term" format={num} />,
    ]);
  out.push(["What it brought", <Brought key="brought" a={a} links={links} />]);
  out.push(["Its conversation", <Conversation key="conv" a={a} comments={comments} />]);
  return out;
}

/** The sections as one block, each under its own heading. */
function Numbers({ sections }: { sections: [string, ReactNode][] }) {
  return (
    <div className="grid gap-6 border-b border-(--ui-hair) pb-6">
      {sections.map(([title, body]) => (
        <section key={title} className="grid gap-2">
          <h3 className="text-[13px] font-medium text-(--ui-ink-2)">{title}</h3>
          {body}
        </section>
      ))}
    </div>
  );
}

/** The post's field groups these sections say better. */
const DRAWN = ["How it did", "What it brought", "Its conversation"];

/** A post's extras with its numbers leading the details, before its fields. */
export const withAnalytics =
  (extras: NonNullable<ListPage["extras"]>): NonNullable<ListPage["extras"]> =>
  (detail, at) => {
    const base: RecordExtras = extras(detail, at);
    const more = analyticsSections(detail, at.row);
    if (!more.length) return base;
    return {
      ...base,
      drawn: [...(base.drawn ?? []), ...DRAWN],
      lead: (
        <>
          <Numbers sections={more} />
          {base.lead}
        </>
      ),
    };
  };

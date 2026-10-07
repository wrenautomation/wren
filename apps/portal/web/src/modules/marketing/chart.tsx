/** Booking clicks by first touch, a bar a week for 8 weeks: the Overview's one chart. */
import type { RecordsStat } from "@wren/core/records/serve";
import { num } from "@wren/ui";
import { call } from "../../api.js";
import { useCall } from "../../load.js";

const WEEKS = 8;
const ZONE = Intl.DateTimeFormat().resolvedOptions().timeZone;
// The site_day record's channels; the top four get a color, the rest share the last.
const CHANNELS = {
  email: "Email",
  sms: "Texts",
  ads: "Ads",
  content: "Content",
  search: "Search",
  reach: "Reach",
  other: "Other",
  direct: "Direct",
} as const;
type Channel = keyof typeof CHANNELS;
const COLORS = [1, 2, 3, 4, 5].map((i) => `var(--ui-chart-${i})`);

/** A channel's daily series as weeks, the last ending today. */
export function weeksOf(series: RecordsStat["series"], weeks = WEEKS): number[] {
  const out = Array<number>(weeks).fill(0);
  series.forEach((d, i) => {
    const w = weeks - 1 - Math.floor((series.length - 1 - i) / 7);
    if (w >= 0) out[w] = (out[w] ?? 0) + (d.value ?? 0);
  });
  return out;
}

export function WeeklyBookings() {
  const load = useCall("marketing-weekly-bookings", () =>
    Promise.all(
      (Object.keys(CHANNELS) as Channel[]).map(async (channel) => {
        const s = await call<RecordsStat>("console/recordsStats", {
          record: "marketing.site_day",
          view: "channel",
          where: { channel },
          period: WEEKS * 7,
          sum: "bookings",
          zone: ZONE,
        });
        return { channel, weeks: weeksOf(s.series) };
      }),
    ),
  );
  const all = load.data;
  if (!all) return null;
  const ranked = all
    .map((c) => ({ ...c, total: c.weeks.reduce((a, b) => a + b, 0) }))
    .filter((c) => c.total > 0)
    .sort((a, b) => b.total - a.total);
  const shown: { label: string; weeks: number[] }[] = ranked
    .slice(0, 4)
    .map((c) => ({ label: CHANNELS[c.channel], weeks: c.weeks }));
  const rest = ranked.slice(4);
  if (rest.length)
    shown.push({
      label: rest.length === 1 && rest[0] ? CHANNELS[rest[0].channel] : "Rest",
      weeks: Array.from({ length: WEEKS }, (_, w) =>
        rest.reduce((a, c) => a + (c.weeks[w] ?? 0), 0),
      ),
    });
  const totals = Array.from({ length: WEEKS }, (_, w) =>
    shown.reduce((a, c) => a + (c.weeks[w] ?? 0), 0),
  );
  const top = Math.max(1, ...totals);
  return (
    <section className="mx-auto mt-8 grid w-full max-w-[1200px] gap-4">
      <h2 className="text-[15px] font-semibold">Booking clicks by first touch, a week a bar</h2>
      {ranked.length === 0 ? (
        <p className="text-[13px] text-(--ui-ink-2)">No booking clicks in the last 8 weeks.</p>
      ) : (
        <>
          <div className="flex h-40 items-end gap-2">
            {totals.map((t, w) => (
              <div
                // biome-ignore lint/suspicious/noArrayIndexKey: a week's slot is its place.
                key={w}
                className="flex h-full flex-1 flex-col justify-end"
                title={`${t} in the week ${WEEKS - w === 1 ? "to today" : `${WEEKS - w} weeks back`}`}
              >
                <span className="mb-1 text-center text-[12px] text-(--ui-ink-2)">
                  {t ? num(t) : ""}
                </span>
                <div className="flex flex-col-reverse" style={{ height: `${(t / top) * 100}%` }}>
                  {shown.map((c, i) => (
                    <div
                      key={c.label}
                      style={{
                        height: t ? `${((c.weeks[w] ?? 0) / t) * 100}%` : 0,
                        background: COLORS[i],
                      }}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
          <div className="flex justify-between text-[12px] text-(--ui-ink-2)">
            <span>8 weeks ago</span>
            <span>This week</span>
          </div>
          <ul className="flex flex-wrap gap-x-4 gap-y-1 text-[13px]">
            {shown.map((c, i) => (
              <li key={c.label} className="flex items-center gap-1.5">
                <span className="size-2.5" style={{ background: COLORS[i] }} />
                {c.label}
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

const FORMATS = {
  long: "Long videos",
  short: "Shorts",
  reel: "Reels",
  video: "TikToks",
  carousel: "Carousels",
  thread: "Threads",
  post: "Posts",
} as const;
type Format = keyof typeof FORMATS;
const DAYS = 30;

/**
 * Which formats earn the most, last 30 days: the median engagement per 100 views of each
 * format's posts, each a link to its posts on the leaderboard.
 */
export function FormatBoard() {
  const load = useCall("marketing-format-board", () =>
    Promise.all(
      (Object.keys(FORMATS) as Format[]).map(async (format) => {
        const ask = {
          record: "marketing.post",
          view: "leaderboard",
          where: { format },
          period: DAYS,
          zone: ZONE,
        };
        const [score, posts] = await Promise.all([
          call<RecordsStat>("console/recordsStats", { ...ask, median: "score" }),
          call<RecordsStat>("console/recordsStats", ask),
        ]);
        return { format, score: score.value ?? 0, posts: posts.value ?? 0 };
      }),
    ),
  );
  const all = load.data?.filter((f) => f.posts > 0).sort((a, b) => b.score - a.score);
  if (!all) return null;
  const top = Math.max(1, ...all.map((f) => f.score));
  return (
    <section className="mx-auto mt-8 grid w-full max-w-[1200px] gap-3">
      <h2 className="text-[15px] font-semibold">By format, last 30 days</h2>
      {all.length === 0 ? (
        <p className="text-[13px] text-(--ui-ink-2)">No post with views in the last 30 days.</p>
      ) : (
        <ul className="grid gap-2">
          {all.map((f, i) => (
            <li key={f.format}>
              <a
                href={`/marketing/content?view=leaderboard&format=${f.format}`}
                className="grid grid-cols-[7rem_1fr_auto] items-center gap-3 text-[13.5px] hover:bg-(--ui-hover) max-sm:grid-cols-[5.5rem_1fr_auto]"
              >
                <span>{FORMATS[f.format]}</span>
                <span className="h-3" aria-hidden="true">
                  <span
                    className="block h-full"
                    style={{
                      width: `${Math.max(2, (f.score / top) * 100)}%`,
                      background: COLORS[i % COLORS.length],
                    }}
                  />
                </span>
                <span className="tabular-nums text-(--ui-ink-2)">
                  {(Math.round(f.score * 10) / 10).toFixed(1)} per 100 views · {num(f.posts)}{" "}
                  {f.posts === 1 ? "post" : "posts"}
                </span>
              </a>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** Under Marketing's numbers: formats against each other, then booking clicks by week. */
export function NumbersBelow() {
  return (
    <>
      <FormatBoard />
      <WeeklyBookings />
    </>
  );
}

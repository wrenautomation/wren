/** Subject › Live: shipped samples' real rates per segment, beside his taste rank. */
import { Button, cx } from "@wren/ui";
import type { Live } from "@wrenautomation/vireo";
import { useState } from "react";
import { pct, type Sample } from "./marks.js";
import { callLabel, VERDICT_ON } from "./score.js";

type Verdict = Sample["verdict"];

// vireo's read model: the page renders what the store answers
export type { Live } from "@wrenautomation/vireo";

/** What Live needs from the subject: verdicts and the taste order. */
interface Picks {
  batches: { samples: Pick<Sample, "id" | "score" | "verdict">[] }[];
  leaders: { sample: number }[];
}

const CHANNEL_LABEL: Record<string, string> = { post: "Posts", site: "Pages", email: "Email" };
const RATE_LABEL: Record<string, string> = {
  engaged: "Engaged",
  likes: "Liked",
  comments: "Commented",
  shares: "Shared",
  follows: "Followed",
  clicks: "Clicked",
  forms: "Sent the form",
  books: "Booked",
  replies: "Replied",
  booked: "Booked",
};
const OF_LABEL: Record<string, string> = { views: "views", view: "visits", sends: "sends" };
const cap = (x: string) => x.charAt(0).toUpperCase() + x.slice(1);
const segLabel = (seg: string) => {
  if (seg === "all") return "Everyone";
  const [dim, ...rest] = seg.split(":");
  const val = rest.join(":");
  return dim === "source" || dim === "campaign" ? `${cap(dim)}: ${val}` : cap(val);
};
const pct1 = (n: number) => `${(n * 100).toFixed(n < 0.1 ? 1 : 0)}%`;

/**
 * What the market says, beside his taste: each shipped sample's rate in one segment, its 95%
 * range, and the chance it is the best of those shipped there.
 */
export function LiveView({ live, picks }: { live: Live; picks: Picks }) {
  const channels = [...new Set(live.rows.map((r) => r.channel))];
  const [channel, setChannel] = useState<string>(channels[0] as string);
  const ch = channels.includes(channel) ? channel : (channels[0] as string);
  const segments = live.segments.filter((g) =>
    live.rows.some((r) => r.channel === ch && r.segment === g),
  );
  const [segment, setSegment] = useState("all");
  const seg = segments.includes(segment) ? segment : (segments[0] ?? "all");
  const rates = live.rates[ch] ?? [];
  const [rateName, setRate] = useState<string>(rates[0]?.name ?? "");
  const rate = rates.find((r) => r.name === rateName) ?? rates[0];
  const n = new Map<number, { score: number | null; verdict: Verdict; taste: number | null }>();
  for (const b of picks.batches)
    for (const x of b.samples) n.set(x.id, { score: x.score, verdict: x.verdict, taste: null });
  picks.leaders.forEach((l, i) => {
    const cur = n.get(l.sample);
    if (cur) cur.taste = i + 1;
  });
  if (!rate) return null;
  const rows = live.rows
    .filter((r) => r.channel === ch && r.segment === seg)
    .sort((a, b) => (b.rates[rate.name]?.rate ?? -1) - (a.rates[rate.name]?.rate ?? -1));
  const top = Math.max(0.01, ...rows.map((r) => r.rates[rate.name]?.hi ?? 0)) * 1.05;
  const chips = <T extends string>(
    items: readonly T[],
    on: T,
    set: (x: T) => void,
    label: (x: T) => string,
  ) => (
    <div className="flex flex-wrap gap-1.5">
      {items.map((x) => (
        <Button
          key={x}
          size="dense"
          tone={x === on ? "primary" : "secondary"}
          onClick={() => set(x)}
        >
          {label(x)}
        </Button>
      ))}
    </div>
  );
  return (
    <section className="flex flex-col gap-2.5">
      <div>
        <h3 className="m-0 text-[13px] font-semibold text-(--ui-ink-2)">Live</h3>
        <p className="m-0 text-[12px] text-(--ui-ink-3)">
          Real numbers from where each sample shipped. The band is where the true rate sits, 95%
          sure. Best is the chance it beats the others here.
        </p>
      </div>
      {channels.length > 1 && chips(channels, ch, setChannel, (c) => CHANNEL_LABEL[c] ?? cap(c))}
      {chips(segments, seg, setSegment, segLabel)}
      {rates.length > 1 &&
        chips(
          rates.map((r) => r.name),
          rate.name,
          setRate,
          (r) => RATE_LABEL[r] ?? cap(r),
        )}
      <ul className="m-0 flex list-none flex-col p-0">
        {rows.map((r) => {
          const x = r.rates[rate.name];
          const mine = n.get(r.sample);
          const watched = r.means.avg_view_pct;
          return (
            <li
              key={r.sample}
              className="flex flex-col gap-1.5 border-b border-(--ui-hair) py-2.5 @min-[720px]/main:flex-row @min-[720px]/main:items-center @min-[720px]/main:gap-3"
            >
              <div className="flex items-center gap-2 @min-[720px]/main:w-40 @min-[720px]/main:shrink-0">
                <span className="text-[13px] font-semibold text-(--ui-ink)">#{r.sample}</span>
                {mine?.verdict && (
                  <span
                    className={cx(
                      "rounded-full border px-2 py-0.5 text-[11px]",
                      VERDICT_ON[mine.verdict],
                    )}
                  >
                    {mine.score == null ? cap(mine.verdict) : callLabel(mine.score)}
                  </span>
                )}
                {mine?.taste != null && (
                  <span className="text-[11px] text-(--ui-ink-3)">your #{mine.taste}</span>
                )}
              </div>
              <div className="relative h-3 w-full shrink-0 rounded-full bg-(--ui-tile) @min-[720px]/main:w-auto @min-[720px]/main:flex-1">
                {x && x.of > 0 && (
                  <>
                    <span
                      className="absolute top-0 h-3 rounded-full bg-(--ui-accent)/30"
                      style={{
                        left: `${(x.lo / top) * 100}%`,
                        width: `${(Math.max(0.002, x.hi - x.lo) / top) * 100}%`,
                      }}
                    />
                    <span
                      className="absolute top-0 size-3 -translate-x-1/2 rounded-full bg-(--ui-accent)"
                      style={{ left: `${((x.rate ?? 0) / top) * 100}%` }}
                    />
                  </>
                )}
              </div>
              <div className="text-[12px] text-(--ui-ink-2) @min-[720px]/main:w-56 @min-[720px]/main:shrink-0 @min-[720px]/main:text-right">
                {x && x.of > 0 ? (
                  <>
                    <span className="font-semibold text-(--ui-ink)">{pct1(x.rate ?? 0)}</span>
                    {` · ${x.wins} of ${x.of} ${OF_LABEL[rate.of] ?? rate.of}`}
                    <span className="block text-(--ui-ink-3)">
                      {`range ${pct1(x.lo)}–${pct1(x.hi)}`}
                      {x.pBest != null ? ` · best ${pct(x.pBest)}` : ""}
                      {watched != null ? ` · watched ${pct(watched / 100)}` : ""}
                    </span>
                  </>
                ) : (
                  <span className="text-(--ui-ink-3)">No {OF_LABEL[rate.of] ?? rate.of} yet</span>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

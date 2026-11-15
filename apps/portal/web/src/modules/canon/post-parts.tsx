/** What a creator post's card, tile and detail share (studio-suite D8, D9): names, counts, the usual line. */
import type { FeedPost } from "@wren/research/canon-console";
import { Icon, type IconName, num, short, Tag, tipProps } from "@wren/ui";
import { useState } from "react";

export const cn = (...xs: (string | false | null | undefined)[]) => xs.filter(Boolean).join(" ");

/** 10x and up: the accent wash and its tag (the top 8% on 11-14) */
export const HOT = 10;

const PLATFORMS: Record<string, string> = {
  youtube: "YouTube",
  tiktok: "TikTok",
  instagram: "Instagram",
  x: "X",
  threads: "Threads",
  linkedin: "LinkedIn",
};
const KINDS: Record<string, string> = {
  video: "Video",
  short: "Short",
  live: "Live",
  reel: "Reel",
  post: "Post",
  photo: "Photo",
  carousel: "Carousel",
  quote: "Quote",
  reply: "Reply",
};
export const platformName = (p: string) => PLATFORMS[p] ?? p;
export const kindName = (k: string) => KINDS[k] ?? k;
const kindWord = (k: string) => kindName(k).toLowerCase();
const kindsWord = (k: string) => kindWord(k).replace(/y$/, "ie").concat("s");
export const keyOf = (r: FeedPost) => `${r.platform}:${r.ref}`;
export const times = (m: number) => `${m >= 10 ? Math.round(m) : m.toFixed(1)}x`;
export const nameOf = (r: Pick<FeedPost, "name" | "handle">) => r.name ?? `@${r.handle}`;

/** "3 days ago", from an ISO time */
export function age(at: string | null, now = Date.now()): string | null {
  if (!at) return null;
  const hours = Math.floor((now - Date.parse(at)) / 3_600_000);
  if (Number.isNaN(hours)) return null;
  if (hours < 1) return "just now";
  if (hours < 24) return `${hours} ${hours === 1 ? "hour" : "hours"} ago`;
  const days = Math.floor(hours / 24);
  if (days < 60) return `${days} ${days === 1 ? "day" : "days"} ago`;
  const months = Math.floor(days / 30);
  return months < 24 ? `${months} months ago` : `${Math.floor(days / 365)} years ago`;
}

const WHEN = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short" });
/** "Nov 12, 2026, 3:04 PM" */
export const when = (at: string | null) => (at ? WHEN.format(new Date(at)) : null);

export const followersText = (n: number | null) =>
  n == null ? null : `${short(n)} ${n === 1 ? "follower" : "followers"}`;

type CountKey = keyof FeedPost["counts"];
const metricOf = (r: FeedPost): CountKey => (r.scoreCount === "likes" ? "likes" : "views");

/** "the median of @maya's last 30 reels" */
function windowOf(r: FeedPost) {
  return r.baselineN
    ? `the median of @${r.handle}'s last ${num(r.baselineN)} ${kindsWord(r.kind)}`
    : `@${r.handle}'s median`;
}

/** The hover line on "14x usual": "88K views, 12x their usual 7.3K (the median of @e's last 30 reels)" */
export function usualTip(r: FeedPost): string | null {
  if (r.multiple == null) return null;
  const metric = metricOf(r);
  const n = r.counts[metric];
  if (r.baseline == null) return `${times(r.multiple)} ${windowOf(r)} ${metric}`;
  return `${n != null ? `${short(n)} ${metric}, ` : ""}${times(r.multiple)} their usual ${short(r.baseline)} (${windowOf(r)})`;
}

/** The detail's sentences: what the post drew, and the creator's usual draw beside it. */
export function usualWhy(r: FeedPost): string[] {
  if (r.multiple == null)
    return [
      "Not scored yet. A post gets a score once Wren has read 5 of the creator's posts of this kind. Scores update once a day.",
    ];
  const metric = metricOf(r);
  const n = r.counts[metric];
  const got = n != null ? `This ${kindWord(r.kind)} got ${num(n)} ${metric}` : null;
  if (r.baseline == null)
    return [`${got ? `${got}, ` : "It drew "}${times(r.multiple)} ${windowOf(r)}.`];
  return [
    ...(got ? [`${got}, ${times(r.multiple)} @${r.handle}'s usual.`] : []),
    `Their usual ${kindWord(r.kind)} gets ${num(Math.round(r.baseline))} ${metric}: ${windowOf(r)}.`,
  ];
}

/** "38x usual" with its hover line: a tag on a hot post, quiet words on the rest */
export function Usual({ r, loud }: { r: FeedPost; loud: boolean }) {
  if (r.multiple == null) return null;
  const words = `${times(r.multiple)} usual`;
  return (
    <span
      // biome-ignore lint/a11y/noNoninteractiveTabindex: the tip opens on focus too
      tabIndex={0}
      {...tipProps(usualTip(r))}
      className="relative z-[2] inline-flex rounded-[4px] outline-offset-2 focus-visible:outline-2 focus-visible:outline-(--ui-focus)"
    >
      {loud ? (
        <Tag tone="accent">{words}</Tag>
      ) : (
        <span className="text-[13px] whitespace-nowrap text-(--ui-ink-3) tabular-nums">
          {words}
        </span>
      )}
    </span>
  );
}

const COUNTS: [CountKey, IconName, string][] = [
  ["views", "eye", "views"],
  ["likes", "heart", "likes"],
  ["comments", "chat", "comments"],
  ["shares", "repeat", "shares"],
  ["saves", "bookmark", "saves"],
];
const isVideo = (r: FeedPost) => ["video", "short", "reel", "live"].includes(r.kind);
/** views on a video read as plays (TikTok, YouTube) */
export const countIcon = (r: FeedPost, k: CountKey): IconName =>
  k === "views" && isVideo(r) ? "play" : (COUNTS.find(([c]) => c === k)?.[1] ?? "dot");

/**
 * The counts the read gave, X's way: an icon and a number each. `full`: exact numbers with their
 * words (the detail); else short numbers, the words for screen readers.
 */
export function CountRow({
  r,
  full = false,
  only,
  className,
}: {
  r: FeedPost;
  full?: boolean;
  only?: CountKey[];
  className?: string;
}) {
  const items = COUNTS.filter(([k]) => r.counts[k] != null && (!only || only.includes(k)));
  if (!items.length) return null;
  return (
    <ul
      aria-label="Counts"
      className={cn(
        "m-0 flex list-none flex-wrap items-center gap-x-4 gap-y-1 p-0 tabular-nums",
        className,
      )}
    >
      {items.map(([k, , word]) => {
        const n = r.counts[k] as number;
        return (
          <li key={k} className="inline-flex items-center gap-1.5">
            <Icon name={countIcon(r, k)} className="size-[15px] shrink-0 [stroke-width:1.8]" />
            <span>{full ? num(n) : short(n)}</span>
            <span className={full ? undefined : "sr-only"}>{word}</span>
          </li>
        );
      })}
    </ul>
  );
}

/** the creator's first letter in a round tint: no avatars stored yet */
export function Letter({
  r,
  size = "md",
}: {
  r: Pick<FeedPost, "name" | "handle">;
  size?: "md" | "lg";
}) {
  return (
    <span
      aria-hidden
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-full bg-(--ui-accent-tint) font-semibold text-(--ui-active)",
        size === "lg" ? "size-11 text-[17px]" : "size-9 text-[14px]",
      )}
    >
      {(r.name ?? r.handle)
        .replace(/^[^\p{L}\p{N}]+/u, "")
        .slice(0, 1)
        .toUpperCase() || "?"}
    </span>
  );
}

export type Canon = "in" | "filing" | null;

export function CanonTag({ canon }: { canon: Canon }) {
  if (!canon) return null;
  return (
    <Tag tone="accent" className={canon === "filing" ? "[animation:ui-fade_.2s_both]" : undefined}>
      {canon === "filing" ? "Filing into Canon" : "In Canon"}
    </Tag>
  );
}

/** a picture only where the post has one that loads; else null, and the words carry it */
export function usePicture(r: FeedPost) {
  const [bad, setBad] = useState(false);
  return { src: r.src && !bad ? r.src : null, fail: () => setBad(true) };
}

export const tall = (r: FeedPost) =>
  r.kind === "reel" || r.kind === "short" || r.platform === "instagram" || r.platform === "tiktok";

/** What a creator post's card, tile and detail share (studio-suite D8-D10): names, counts, the usual line. */
import type { FeedPost } from "@wren/research/canon-console";
import { Icon, type IconName, Img, num, short, Tag } from "@wren/ui";
import { useState } from "react";

export const cn = (...xs: (string | false | null | undefined)[]) => xs.filter(Boolean).join(" ");

/** 10x and up: accent ink, the card's wash, the tile's outline (the top 8% on 11-14) */
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
/** the creator person's name (D10): theirs, else their first account's */
export const nameOf = (r: Pick<FeedPost, "person">) => r.person;
/** "@maker · YouTube": the account, unless the name already is the handle */
export const accountOf = (r: Pick<FeedPost, "person" | "handle" | "platform">) =>
  [r.person === `@${r.handle}` ? null : `@${r.handle}`, platformName(r.platform)]
    .filter(Boolean)
    .join(" · ");

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
/** "their usual views": what the multiple counts, always said (D10) */
export const usualWords = (r: FeedPost) => `their usual ${metricOf(r)}`;

/** views ÷ the account's newest follower count; none without both */
export function perFollower(r: FeedPost): number | null {
  const v = r.counts.views;
  return v != null && r.followers ? v / r.followers : null;
}
export const ratio = (x: number) => (x >= 10 ? num(Math.round(x)) : x.toFixed(x >= 1 ? 1 : 2));
/** "32 views per follower" */
export function perFollowerText(r: FeedPost): string | null {
  const x = perFollower(r);
  return x == null ? null : `${ratio(x)} views per follower`;
}

/** "the median of @maya's last 30 reels" */
function windowOf(r: FeedPost) {
  return r.baselineN
    ? `the median of @${r.handle}'s last ${num(r.baselineN)} ${kindsWord(r.kind)}`
    : `@${r.handle}'s median`;
}

/** The hover line on "14x their usual views": "88K views; they usually get 7.3K (the median of @e's last 30 reels)" */
export function usualTip(r: FeedPost): string | null {
  if (r.multiple == null) return null;
  const metric = metricOf(r);
  const n = r.counts[metric];
  if (r.baseline == null || n == null)
    return `${times(r.multiple)} ${usualWords(r)} (${windowOf(r)})`;
  return `${short(n)} ${metric}; they usually get ${short(r.baseline)} (${windowOf(r)})`;
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

const COUNTS: [CountKey, IconName, string][] = [
  ["views", "eye", "views"],
  ["likes", "heart", "likes"],
  ["comments", "chat", "comments"],
  ["shares", "repeat", "shares"],
  ["saves", "bookmark", "saves"],
];
const isVideo = (r: FeedPost) => ["video", "short", "reel", "live"].includes(r.kind);
/** views on a video read as plays (TikTok, YouTube) */
const countIcon = (r: FeedPost, k: CountKey): IconName =>
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

/**
 * The rule behind every multiple, once above the posts (D10: "I still don't know what that
 * means"). Instagram's line only when a shown post scores on likes.
 */
export function UsualRule({ likes }: { likes: boolean }) {
  return (
    <p className="m-0 max-w-[72ch] text-[13px] leading-[1.5] text-(--ui-ink-3)">
      <span className="font-semibold text-(--ui-ink-2)">10x their usual views</span> means 10 times
      the median views of that creator's recent posts of the same kind.
      {likes ? " A post with no view count counts likes." : ""}
    </p>
  );
}

/** a creator's face: their copied profile picture, else their first letter */
export function Face({ name, src, size }: { name: string; src: string | null; size: number }) {
  const [bad, setBad] = useState(false);
  if (!src || bad) return <Letter name={name} px={size} />;
  return (
    <Img
      src={src}
      alt=""
      onError={() => setBad(true)}
      style={{ width: size, height: size }}
      className="block shrink-0 rounded-full bg-(--ui-hover) object-cover"
    />
  );
}

/** the creator's first letter in a round tint: when no face is stored */
function Letter({ name, px = 36 }: { name: string; px?: number }) {
  return (
    <span
      aria-hidden
      style={{ width: px, height: px, fontSize: Math.round(px * 0.4) }}
      className="inline-flex shrink-0 items-center justify-center rounded-full bg-(--ui-accent-tint) font-semibold text-(--ui-active)"
    >
      {name
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

/**
 * A picture only where the post has one that loads; else null, and the words carry it. `full`:
 * the whole picture (the detail), else the small one (the tile).
 */
export function usePicture(r: FeedPost, full = false) {
  const [bad, setBad] = useState(false);
  const src = full ? (r.full ?? r.src) : r.src;
  return { src: src && !bad ? src : null, fail: () => setBad(true) };
}

/**
 * The words that sell a post on its tile (PT-6, YouTube's grid): its title, else its text's first
 * line. A first line past 120 characters stops at its first sentence end; whole words, no ellipsis.
 */
export function hookOf(r: FeedPost): string | null {
  const title = r.title?.trim();
  if (title) return title;
  const first = r.text
    ?.split("\n")
    .map((l) => l.trim())
    .find(Boolean);
  if (!first || first.length <= 120) return first ?? null;
  // a sentence of 40 characters or more: a "Wow." opener is no hook alone
  const end = /[.!?](?=\s)/.exec(first.slice(40));
  return end ? first.slice(0, 40 + end.index + 1) : first;
}

export const tall = (r: FeedPost) =>
  r.kind === "reel" || r.kind === "short" || r.platform === "instagram" || r.platform === "tiktok";

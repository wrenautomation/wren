/**
 * What Learn draws for a type: its name, its mark, its length, and a picture through the app's
 * own `/media` (apps/portal/src/media.ts), so the CSP stays at 'self' for every thumbnail host.
 * Wren's team holds one grant for the day; a client's workspace gets one per address, for its
 * own items only, asked as its items load.
 */
import { cx, PlatformMark } from "@wren/ui";
import { FileText, Link, type LucideIcon, Newspaper, Podcast, Rocket } from "@wren/ui/lib/lucide";
import { useEffect, useState } from "react";
import { call } from "../../api.js";
import { type Card, clientOf, type ItemType, onItems, type SourceKind } from "./api.js";

interface TypeLook {
  label: string;
  /** The shelf's and the chip's name. */
  many: string;
  /** A brand mark from the kit, or a line icon with its tint. */
  brand?: string;
  Icon?: LucideIcon;
  tint?: string;
  /** Watched or heard: its length is minutes, not a read. */
  plays?: boolean;
  /** Where "Open on" sends it. */
  site: string;
}

export const TYPES: Record<ItemType, TypeLook> = {
  youtube: { label: "YouTube", many: "YouTube", brand: "youtube", plays: true, site: "YouTube" },
  shorts: { label: "Short", many: "Shorts and Reels", plays: true, site: "YouTube" },
  podcast: {
    label: "Podcast",
    many: "Podcasts",
    Icon: Podcast,
    tint: "text-(--ui-cue-3)",
    plays: true,
    site: "the show's page",
  },
  newsletter: {
    label: "Newsletter",
    many: "Newsletters",
    Icon: Newspaper,
    tint: "text-(--ui-cue-4)",
    site: "the newsletter",
  },
  blog: {
    label: "Blog",
    many: "Blogs",
    Icon: FileText,
    tint: "text-(--ui-cue-1)",
    site: "the blog",
  },
  reddit: { label: "Reddit", many: "Reddit", brand: "reddit", site: "Reddit" },
  x: { label: "X", many: "X posts", brand: "x", site: "X" },
  instagram: {
    label: "Instagram",
    many: "Instagram",
    brand: "instagram",
    plays: true,
    site: "Instagram",
  },
  tiktok: { label: "TikTok", many: "TikTok", brand: "tiktok", plays: true, site: "TikTok" },
  releases: {
    label: "Release",
    many: "Releases",
    Icon: Rocket,
    tint: "text-(--ui-cue-2)",
    site: "the release notes",
  },
  link: {
    label: "Link",
    many: "Saved links",
    Icon: Link,
    tint: "text-(--ui-cue-6)",
    site: "the page",
  },
};

/** The order chips, shelves and the rail list types in. */
export const TYPE_ORDER = Object.keys(TYPES) as ItemType[];

export const KIND_LABELS: Record<SourceKind, string> = {
  youtube: "YouTube channels",
  podcast: "Podcasts",
  newsletter: "Newsletters",
  blog: "Blogs",
  reddit: "Subreddits",
  forum: "Forums",
  releases: "Release notes",
  instagram: "Instagram creators",
  x: "X creators",
  tiktok: "TikTok creators",
};

/** A source kind's mark: the type its items mostly are. */
export const KIND_TYPE: Record<SourceKind, ItemType> = {
  youtube: "youtube",
  podcast: "podcast",
  newsletter: "newsletter",
  blog: "blog",
  reddit: "reddit",
  forum: "link",
  releases: "releases",
  instagram: "instagram",
  x: "x",
  tiktok: "tiktok",
};

/** A Short or a Reel: a red stood-up tile with a play in it. */
function ShortsMark({ size, label }: { size: number; label?: string | undefined }) {
  return (
    <svg
      role="img"
      aria-label={label}
      aria-hidden={label ? undefined : true}
      viewBox="0 0 24 24"
      width={size}
      height={size}
      className="inline-block shrink-0 align-[-0.125em] text-[#FF0000]"
    >
      <rect x="5" y="1.5" width="14" height="21" rx="4.5" fill="currentColor" />
      <path fill="#fff" d="m10 8.8 5.2 3.2-5.2 3.2z" />
    </svg>
  );
}

/** A type's mark, in its color unless `mono`. */
export function TypeMark({
  type,
  size = 14,
  mono = false,
  label,
  className,
}: {
  type: ItemType;
  size?: number;
  mono?: boolean;
  /** Read aloud when the mark stands alone. */
  label?: string;
  className?: string;
}) {
  const t = TYPES[type] ?? TYPES.link;
  if (type === "shorts") return <ShortsMark size={size} label={label} />;
  if (t.brand)
    return (
      <PlatformMark
        mark={t.brand}
        size={size}
        mono={mono}
        {...(label ? { label } : {})}
        {...(className ? { className } : {})}
      />
    );
  const Icon = t.Icon ?? Link;
  return (
    <Icon
      size={size}
      strokeWidth={2}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      className={cx("inline-block shrink-0 align-[-0.125em]", !mono && t.tint, className)}
    />
  );
}

/** 754 seconds as "12:34"; an hour and more as "1:02:03". */
export function clock(s: number): string {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.floor(s % 60);
  const mm = h ? String(m).padStart(2, "0") : String(m);
  return `${h ? `${h}:` : ""}${mm}:${String(sec).padStart(2, "0")}`;
}

/** About 1,100 characters a minute: 200 words of plain English. */
const READ_CHARS = 1100;

/** "12:34" for what plays, "6 min read" for what reads, or null when it isn't known. */
export function lengthOf(c: Pick<Card, "type" | "duration" | "chars">): string | null {
  if (c.duration) return clock(c.duration);
  if (TYPES[c.type]?.plays || c.type === "x") return null;
  if (c.chars < 200) return null;
  return `${Math.max(1, Math.round(c.chars / READ_CHARS))} min read`;
}

/** The score as a badge: 7 and up is worth your time, 4 to 6 worth knowing. */
export function ScoreBadge({ score, className }: { score: number | null; className?: string }) {
  if (score === null) return null;
  const tone =
    score >= 7
      ? "bg-(--ui-accent) text-(--ui-on-accent)"
      : score >= 4
        ? "bg-(--ui-ink) text-(--ui-on-ink)"
        : "bg-(--ui-tile) text-(--ui-ink-2)";
  return (
    <span
      title={`Scored ${score} of 10 against your SOPs`}
      className={cx(
        "inline-flex h-5 min-w-5 items-center justify-center px-1.5 font-semibold text-[11.5px] tabular-nums",
        tone,
        className,
      )}
    >
      {score}
    </span>
  );
}

/* The media grant: one per tab, asked once. Null when this viewer can't have one. */
let grantAsk: Promise<string | null> | null = null;
let grantNow: string | null | undefined;

function askGrant(): Promise<string | null> {
  grantAsk ??= call<{ grant: string }>("media/grant", {})
    .then((g) => g.grant)
    .catch(() => null)
    .then((g) => {
      grantNow = g;
      return g;
    });
  return grantAsk;
}

/* A client's grants, one per address, and the items already asked for. */
const urlGrants = new Map<string, string>();
const askedItems = new Set<string>();
const heard = new Set<() => void>();
/** Most items one ask names (the edge's cap). */
const ASK_MAX = 200;

/** Ask for the pictures and audio of a client's items not asked for yet. */
function askItems(ids: number[]) {
  const client = clientOf();
  if (!client) return;
  const fresh = [...new Set(ids.map(String))].filter((id) => !askedItems.has(`${client}:${id}`));
  for (const id of fresh) askedItems.add(`${client}:${id}`);
  for (let i = 0; i < fresh.length; i += ASK_MAX)
    call<{ grants: Record<string, string> }>("media/grant", {
      client,
      items: fresh.slice(i, i + ASK_MAX),
    })
      .then((g) => {
        for (const [u, grant] of Object.entries(g.grants)) urlGrants.set(u, grant);
        for (const fn of heard) fn();
      })
      .catch(() => undefined);
}
onItems(askItems);

/**
 * The grant for `/media` to load `url`, once it's here; undefined while it's asked, null when
 * refused. Wren's team: the day's grant. A client: this address's own, once its item loaded.
 */
export function useGrant(url: string | null): string | null | undefined {
  const client = clientOf();
  const [g, setG] = useState(grantNow);
  const [, tick] = useState(0);
  useEffect(() => {
    if (client || g !== undefined) return;
    let live = true;
    askGrant().then((x) => live && setG(x));
    return () => {
      live = false;
    };
  }, [g, client]);
  useEffect(() => {
    if (!client) return;
    const fn = () => tick((n) => n + 1);
    heard.add(fn);
    return () => {
      heard.delete(fn);
    };
  }, [client]);
  if (!client) return g;
  return url ? (urlGrants.get(url) ?? undefined) : null;
}

/** An outside picture or audio file through our origin, or null without a grant. */
export const mediaSrc = (url: string | null, grant: string | null | undefined): string | null =>
  url && grant ? `/media?u=${encodeURIComponent(url)}&g=${grant}` : null;

/** A picture that keeps its tile when the address fails. */
export function Picture({
  url,
  alt,
  className,
  fallback,
}: {
  url: string | null;
  alt: string;
  className?: string;
  fallback: React.ReactNode;
}) {
  const grant = useGrant(url);
  const [broken, setBroken] = useState(false);
  const src = mediaSrc(url, grant);
  if (!src || broken) return <>{fallback}</>;
  return (
    <img
      src={src}
      alt={alt}
      loading="lazy"
      decoding="async"
      draggable={false}
      onError={() => setBroken(true)}
      className={className}
    />
  );
}

/** A source's face: its picture, or its first letter on a tile. */
export function Avatar({
  url,
  name,
  size = 20,
  className,
}: {
  url: string | null;
  name: string;
  size?: 16 | 20 | 24 | 32 | 40;
  className?: string;
}) {
  const box = {
    16: "size-4 text-[9px]",
    20: "size-5 text-[10px]",
    24: "size-6 text-[11px]",
    32: "size-8 text-[13px]",
    40: "size-10 text-[15px]",
  }[size];
  const tile = (
    <span
      aria-hidden
      className={cx(
        "inline-flex shrink-0 items-center justify-center rounded-full bg-(--ui-tile) font-semibold text-(--ui-ink-2) uppercase",
        box,
        className,
      )}
    >
      {name.trim().slice(0, 1) || "?"}
    </span>
  );
  return (
    <Picture
      url={url}
      alt=""
      fallback={tile}
      className={cx("shrink-0 rounded-full bg-(--ui-tile) object-cover", box, className)}
    />
  );
}

/**
 * A card's picture: its thumbnail, or a tile in the type's mark when it has none. Its length
 * sits on it, and how far you got runs along its foot.
 */
export function Thumb({
  card,
  className,
  tall = false,
}: {
  card: Pick<Card, "thumbnail" | "type" | "title" | "duration" | "position" | "chars">;
  className?: string;
  /** A Short or a Reel: stood up. */
  tall?: boolean;
}) {
  const len = lengthOf(card);
  const done = card.position && card.duration ? Math.min(1, card.position / card.duration) : 0;
  return (
    <div
      className={cx(
        "relative overflow-hidden bg-(--ui-tile)",
        tall ? "aspect-[9/16]" : "aspect-video",
        className,
      )}
    >
      <Picture
        url={card.thumbnail}
        alt=""
        className="absolute inset-0 size-full object-cover"
        fallback={
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-(--ui-tile)">
            <TypeMark type={card.type} size={28} />
            <span className="max-w-[80%] truncate text-[11.5px] text-(--ui-ink-2)">
              {TYPES[card.type]?.label}
            </span>
          </div>
        }
      />
      {len && TYPES[card.type]?.plays ? (
        <span className="absolute right-1.5 bottom-1.5 bg-black/75 px-1.5 py-px font-medium text-[11px] text-white tabular-nums">
          {len}
        </span>
      ) : null}
      {done > 0 ? (
        <span className="absolute inset-x-0 bottom-0 h-[3px] bg-black/30">
          <Progress value={done} />
        </span>
      ) : null}
    </div>
  );
}

/** A filled bar. React sets its width through the CSSOM, which the CSP allows. */
export function Progress({ value, className }: { value: number; className?: string }) {
  return (
    <span
      className={cx("block h-full bg-(--ui-accent)", className)}
      style={{ width: `${Math.round(value * 100)}%` }}
    />
  );
}

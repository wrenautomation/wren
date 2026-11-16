/**
 * The gallery feed (studio-suite D10, PT-6): Instagram's grid with YouTube's lines under each tile.
 * Canon › Outliers, Studio › Inspiration and a weaver run's References (WA-1404) all draw it.
 */
import type { FeedPost } from "@wren/research/canon-console";
import { Img, PlatformTile, Skeleton, tipProps } from "@wren/ui";
import { type PointerEvent, type ReactNode, useEffect, useRef, useState } from "react";
import {
  age,
  atOf,
  type Canon,
  CanonTag,
  type CountKey,
  CountRow,
  cn,
  HOT,
  hookOf,
  kindName,
  metricOf,
  nameOf,
  perFollowerText,
  platformName,
  times,
  usePicture,
  usualTip,
  usualWords,
} from "./post-parts.js";

/** the gallery grid: 12 px across, 24 px down (D10) */
export const GALLERY =
  "grid grid-cols-2 gap-x-3 gap-y-6 @min-[720px]/main:grid-cols-[repeat(auto-fill,minmax(200px,1fr))]";

/** a poster wall of `dense` tiles: 3 across on a phone, 150 px columns wide (WA-1405) */
export const GALLERY_DENSE =
  "grid grid-cols-3 gap-x-2.5 gap-y-4 @min-[720px]/main:grid-cols-[repeat(auto-fill,minmax(150px,1fr))]";

/** a platform's mark and its name for a screen reader: every post says where it is from (D10) */
export function Where({ platform }: { platform: string }) {
  return (
    <>
      <PlatformTile mark={platform} className="mt-px shrink-0" />
      <span className="sr-only">{platformName(platform)}</span>
    </>
  );
}

/** the card's own link: a click anywhere opens the post in the panel; links and tips sit over it */
function OpenLink({ open, r }: { open: string; r: FeedPost }) {
  return (
    <a
      href={open}
      className="absolute inset-0 z-[1] rounded-[inherit] outline-offset-2 focus-visible:outline-2 focus-visible:outline-(--ui-focus)"
    >
      <span className="sr-only">
        Open {nameOf(r)}'s {kindName(r.kind).toLowerCase()}
        {r.title ? `: ${r.title}` : ""}
      </span>
    </a>
  );
}

/** A mouse that can hover, and a viewer who allows motion: the only ones a tile plays for (MV-1). */
const HOVER_PLAYS =
  "(hover: hover) and (pointer: fine) and (prefers-reduced-motion: no-preference)";

/**
 * YouTube's grid (WA-1391): a mouse that rests 250 ms on a tile with a copied video plays it, muted.
 * Never on touch, the keyboard or reduced motion. `on`: the tile's pointer handlers.
 */
function useHoverClip(src: string | null) {
  const [live, setLive] = useState(false);
  const wait = useRef<number | undefined>(undefined);
  const [can] = useState(() => typeof matchMedia === "function" && matchMedia(HOVER_PLAYS).matches);
  useEffect(() => () => window.clearTimeout(wait.current), []);
  if (!src || !can) return { src: null, live: false, on: {} };
  return {
    src,
    live,
    on: {
      onPointerEnter: (e: PointerEvent) => {
        if (e.pointerType !== "mouse") return;
        window.clearTimeout(wait.current);
        wait.current = window.setTimeout(() => setLive(true), 250);
      },
      onPointerLeave: () => {
        window.clearTimeout(wait.current);
        setLive(false);
      },
    },
  };
}

/**
 * The tile's video over its picture: fades in on its first frame, out on leave, then unmounts (no
 * download for a tile left alone). Zooms with the picture.
 */
function HoverClip({ src, live }: { src: string; live: boolean }) {
  const [mounted, setMounted] = useState(false);
  const [shown, setShown] = useState(false);
  const shownNow = useRef(false);
  shownNow.current = shown;
  const video = useRef<HTMLVideoElement | null>(null);
  useEffect(() => {
    if (live) {
      setMounted(true);
      // back on the tile mid fade-out: it still plays, so no new `playing` comes
      if (video.current && !video.current.paused) setShown(true);
    }
    // never shown: nothing to fade
    else if (!shownNow.current) setMounted(false);
    else setShown(false);
  }, [live]);
  if (!mounted) return null;
  return (
    <video
      ref={(v) => {
        video.current = v;
        // the property, not only the attribute: a browser lets only a muted video autoplay
        if (v) v.muted = true;
      }}
      src={src}
      muted
      loop
      autoPlay
      playsInline
      preload="auto"
      aria-hidden
      tabIndex={-1}
      onPlaying={() => live && setShown(true)}
      onTransitionEnd={(e) => {
        if (e.propertyName === "opacity" && !live) setMounted(false);
      }}
      className={cn(
        "pointer-events-none absolute inset-0 block size-full object-cover opacity-0 transition-[opacity,scale] duration-200 ease-(--ui-ease) group-hover/tile:scale-[1.03] motion-reduce:group-hover/tile:scale-100",
        shown && "opacity-100",
      )}
    />
  );
}

/** "0:20", "1:44", "1:02:05" */
export function clock(seconds: number): string {
  const s = Math.round(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}

/**
 * A gallery tile (D10): one frame, no wash. A hot post outlines its frame and inks its multiple;
 * hover zooms the picture. `rank` and `length` sit in the frame's corners (YouTube's duration chip);
 * `note` is one line under the counts; `cover` lies over the whole tile (select mode).
 */
export function Tile({
  r,
  canon,
  open,
  inGroup = false,
  reach = false,
  rank,
  length,
  note,
  cover,
  unscored = "Not scored yet",
  dense = false,
}: {
  r: FeedPost;
  canon: Canon;
  open: string;
  /** under its creator's head: no creator line */
  inGroup?: boolean;
  /** sorted by views per follower: show it */
  reach?: boolean;
  /** a pick's place, best first */
  rank?: number | undefined;
  /** a video's length in seconds */
  length?: number | undefined;
  note?: ReactNode;
  cover?: ReactNode;
  /** the line where a score would be; null where none will come (a web page) */
  unscored?: ReactNode;
  /** a wall tile (GALLERY_DENSE): the frame, the multiple, one count, who; no hook, no note */
  dense?: boolean;
}) {
  const hot = (r.multiple ?? 0) >= HOT;
  const pic = usePicture(r);
  const clip = useHoverClip(pic.src ? r.videoSrc : null);
  const ago = age(r.postedAt);
  const words = r.title ?? r.text ?? `${kindName(r.kind)} by ${nameOf(r)}`;
  const perFol = reach ? perFollowerText(r) : null;
  // a text tile already shows its words in the frame
  const hook = pic.src && !dense ? hookOf(r) : null;
  // the count the score is on
  const counts: CountKey[] = dense
    ? [r.scoreCount ? metricOf(r) : r.counts.views != null ? "views" : "likes"]
    : ["views", "likes", "comments"];
  const corner = rank != null || canon;
  return (
    <article
      className="group/tile relative grid content-start gap-1.5 rounded-[4px_10px_4px_10px]"
      {...clip.on}
    >
      <div
        className={cn(
          "relative aspect-[4/5] overflow-hidden rounded-[4px_10px_4px_10px] bg-(--ui-hover)",
          hot && "outline-2 outline-(--ui-active) outline-offset-2",
        )}
      >
        {pic.src ? (
          <Img
            src={pic.src}
            // the hook below already says it
            alt={hook ? "" : words}
            // 100-200 tiles: only the ones near the screen load
            loading="lazy"
            decoding="async"
            onError={pic.fail}
            className="block size-full object-cover transition-transform duration-200 ease-(--ui-ease) group-hover/tile:scale-[1.03] motion-reduce:transition-none motion-reduce:group-hover/tile:scale-100"
          />
        ) : (
          // a text post fills the frame with its words; the panel opens the rest
          <p
            className={cn(
              "m-0 h-full overflow-hidden leading-[1.45] whitespace-pre-line wrap-anywhere text-(--ui-ink) [animation:ui-fade_.15s_both] [mask-image:linear-gradient(#000_75%,transparent)]",
              dense ? "p-2 text-[12px]" : "p-3 text-[13.5px]",
              !!cover && "pr-9",
              corner && "pt-10",
            )}
          >
            {words}
          </p>
        )}
        {clip.src ? <HoverClip src={clip.src} live={clip.live} /> : null}
        {corner ? (
          <span className="absolute top-2 left-2 flex items-center gap-1.5">
            {rank != null ? (
              <span className="inline-flex h-6 min-w-6 items-center justify-center rounded-full bg-(--ui-ink) px-1.5 text-[12.5px] font-semibold text-(--ui-paper) tabular-nums">
                <span className="sr-only">Rank </span>
                {rank}
              </span>
            ) : null}
            {canon ? (
              // paper under the tint: it sits on a picture
              <span className="rounded-(--ui-leaf-chip) bg-(--ui-paper)">
                <CanonTag canon={canon} />
              </span>
            ) : null}
          </span>
        ) : null}
        {length ? (
          <span className="absolute right-2 bottom-2 rounded-[4px] bg-black/75 px-1 py-px text-[12px] font-semibold text-white tabular-nums">
            <span className="sr-only">Length </span>
            {clock(length)}
          </span>
        ) : null}
      </div>
      {hook ? (
        // ST-28: only a freak one-line caption reaches 8 lines; the tile opens the rest
        <p className="m-0 mt-1 line-clamp-8 text-[14px] leading-[1.35] font-semibold wrap-anywhere text-(--ui-ink)">
          {hook}
        </p>
      ) : null}
      <div className={cn("flex min-w-0 flex-wrap items-baseline gap-x-1.5", !hook && "mt-1")}>
        {r.multiple != null ? (
          <span
            // biome-ignore lint/a11y/noNoninteractiveTabindex: the tip opens on focus too
            tabIndex={0}
            {...tipProps(usualTip(r))}
            className="relative z-[2] inline-flex flex-wrap items-baseline gap-x-1.5 rounded-[4px] outline-offset-2 focus-visible:outline-2 focus-visible:outline-(--ui-focus)"
          >
            <span
              className={cn(
                "leading-tight font-semibold tabular-nums",
                dense ? "text-[15px]" : "text-[20px]",
                hot ? "text-(--ui-active)" : "text-(--ui-ink)",
              )}
            >
              {times(r.multiple)}
            </span>
            {dense ? null : (
              <span className="text-[12.5px] text-(--ui-ink-3)">{usualWords(r)}</span>
            )}
          </span>
        ) : unscored ? (
          <span className="text-[12.5px] leading-[25px] text-(--ui-ink-3)">{unscored}</span>
        ) : null}
      </div>
      <CountRow r={r} only={counts} className="text-[12.5px] text-(--ui-ink-2)" />
      {perFol ? <p className="m-0 text-[12.5px] text-(--ui-ink-2) tabular-nums">{perFol}</p> : null}
      {/* the mark holds its own column: a long handle wraps beside it, never under it */}
      <p className="m-0 flex min-w-0 items-start gap-1.5 text-[12.5px] leading-snug text-(--ui-ink-2)">
        <Where platform={r.platform} />
        <span className="min-w-0 wrap-anywhere">
          {inGroup ? null : atOf(r)}
          {/* a wall: who only; 100 px columns at 390 */}
          {ago && !dense ? (
            <span className="whitespace-nowrap text-(--ui-ink-3)">
              {inGroup ? "" : " · "}
              {ago}
            </span>
          ) : null}
        </span>
      </p>
      {note && !dense ? (
        <p className="m-0 text-[12.5px] leading-[1.45] wrap-anywhere text-(--ui-ink-2)">{note}</p>
      ) : null}
      <OpenLink open={open} r={r} />
      {cover}
    </article>
  );
}

/** skeletons in the gallery's shape */
export function Ghosts({ label = "Loading posts" }: { label?: string }) {
  return (
    <div role="status" className="grid gap-4">
      <span className="sr-only">{label}</span>
      <div className={GALLERY}>
        {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
          <div key={i} className="grid gap-1.5">
            <Skeleton className="aspect-[4/5] w-full" />
            <Skeleton className="mt-1 h-4 w-[85%]" />
            <Skeleton className="h-4 w-[55%]" />
            <Skeleton className="h-5 w-28" />
            <Skeleton className="h-3 w-32" />
            <Skeleton className="h-3 w-24" />
          </div>
        ))}
      </div>
    </div>
  );
}

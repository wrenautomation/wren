/**
 * Account → Social's pieces for one connected account: its picture, and a connected TikTok's
 * numbers (followers, likes, videos, its newest videos with their views), read as the page
 * opened. Pictures load from the platform's CDN, never through the portal's Worker.
 */
import type { TikTokNumbers } from "@wren/content/connect";
import { cx } from "@wren/ui";
import { useState } from "react";

/** As `QUIET` in `../work/bits`, which loads the API: this file stays plain. */
const QUIET = "text-(--ui-ink-2)";
const count = (n: number | null) =>
  n === null ? "–" : new Intl.NumberFormat("en-US", { notation: "compact" }).format(n);
const day = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : null;

/** A picture at a platform's CDN, or `fallback` when there is none or it stopped loading. */
function CdnImage({
  url,
  className,
  fallback,
}: {
  url: string | null;
  className: string;
  fallback: React.ReactNode;
}) {
  const [broken, setBroken] = useState(false);
  if (!url || broken) return <>{fallback}</>;
  return (
    <img
      src={url}
      alt=""
      loading="lazy"
      decoding="async"
      referrerPolicy="no-referrer"
      draggable={false}
      onError={() => setBroken(true)}
      className={className}
    />
  );
}

/** The account's face: its picture, else its first letter on a tile. */
export function AccountFace({ url, name }: { url: string | null; name: string }) {
  const box = "size-9 shrink-0 rounded-full";
  return (
    <CdnImage
      url={url}
      className={cx(box, "bg-(--ui-tile) object-cover")}
      fallback={
        <span
          aria-hidden
          className={cx(
            box,
            "inline-flex items-center justify-center bg-(--ui-tile) font-semibold text-(--ui-ink-2) text-[14px] uppercase",
          )}
        >
          {name.replace(/^@/, "").trim().slice(0, 1) || "?"}
        </span>
      }
    />
  );
}

function Figure({ label, value }: { label: string; value: number | null }) {
  return (
    <div className="grid gap-0.5">
      <dt className={cx(QUIET, "text-[12.5px]")}>{label}</dt>
      <dd className="m-0 font-medium text-[17px] tabular-nums">{count(value)}</dd>
    </div>
  );
}

/** Followers, likes and videos, then the newest videos with their views. */
export function TikTokNumbersView({ n }: { n: TikTokNumbers }) {
  return (
    <div className="grid gap-3">
      <dl className="m-0 grid grid-cols-3 gap-3 max-w-[22rem]">
        <Figure label="Followers" value={n.followers} />
        <Figure label="Likes" value={n.likes} />
        <Figure label="Videos" value={n.videos} />
      </dl>
      {n.recent.length ? (
        <div className="grid gap-2">
          <p className={cx(QUIET, "m-0 text-[12.5px]")}>Newest videos</p>
          <ul className="m-0 grid list-none gap-2 p-0">
            {n.recent.map((v) => {
              const title = v.title?.trim() || "Untitled video";
              const when = day(v.postedAt);
              return (
                <li key={v.id} className="flex min-w-0 items-center gap-3">
                  <CdnImage
                    url={v.cover}
                    className="h-12 w-[27px] shrink-0 rounded-[3px] bg-(--ui-tile) object-cover"
                    fallback={
                      <span className="h-12 w-[27px] shrink-0 rounded-[3px] bg-(--ui-tile)" />
                    }
                  />
                  <div className="grid min-w-0 flex-1 gap-0.5">
                    {v.url ? (
                      <a
                        href={v.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="truncate text-[14px] hover:underline"
                      >
                        {title}
                      </a>
                    ) : (
                      <span className="truncate text-[14px]">{title}</span>
                    )}
                    <span className={cx(QUIET, "text-[12.5px] tabular-nums")}>
                      {count(v.views)} views
                      {v.likes !== null ? ` · ${count(v.likes)} likes` : ""}
                      {when ? ` · ${when}` : ""}
                    </span>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      ) : n.gaps.length ? null : (
        <p className={cx(QUIET, "m-0 text-[13.5px]")}>No videos on this account yet.</p>
      )}
      {n.gaps.map((g) => (
        <p key={g} className={cx(QUIET, "m-0 text-[13px]")}>
          {g}
        </p>
      ))}
    </div>
  );
}

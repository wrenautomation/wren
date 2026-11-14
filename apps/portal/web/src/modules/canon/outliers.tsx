/**
 * Canon › Outliers (designs/2026-11-12-eden-method.md §4): posts of tracked creators that beat
 * their own usual draw, best multiple first. The page form of `wren feed`. Save files the post
 * through the Add box's queue as his source. Picks live in the address: `preset`, `niche`,
 * `platform`, `kind`.
 */
import type { AddRow, FeedPage } from "@wren/research/canon-console";
import type { FeedRow } from "@wren/research/creators";
import {
  Button,
  CopyButton,
  Empty,
  LoadFailed,
  num,
  Skeleton,
  short,
  Tag,
  useSeen,
} from "@wren/ui";
import { useState } from "react";
import { call } from "../../api.js";
import { useCall } from "../../load.js";
import type { PageProps } from "../../module.js";
import { href, navigate } from "../../route.js";
import { ERROR } from "../work/bits.js";
import { Pick } from "./parts.js";

const FILTERS = ["preset", "niche", "platform", "kind"] as const;
const PRESETS: Record<string, string> = {
  "": "Every outlier",
  breakouts: "Breakouts: under 50K followers, 5x, 3 months",
  "hidden-gems": "Hidden gems: under 20K followers, 10x, 6 months",
  "viral-now": "Viral now: 10x, 30 days, 500 likes",
  "all-time-greats": "All-time greats: over 50K followers, 10x",
};
const PLATFORMS: Record<string, string> = {
  youtube: "YouTube",
  tiktok: "TikTok",
  instagram: "Instagram",
  x: "X",
  threads: "Threads",
  linkedin: "LinkedIn",
};
/** every scored kind; a retweet is never scored */
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
const platformName = (p: string) => PLATFORMS[p] ?? p;

/** "3 days ago", from an ISO time */
function age(at: string | null, now = Date.now()): string | null {
  if (!at) return null;
  const days = Math.floor((now - Date.parse(at)) / 86_400_000);
  if (Number.isNaN(days)) return null;
  if (days < 1) return "today";
  if (days < 60) return `${days} ${days === 1 ? "day" : "days"} ago`;
  const months = Math.floor(days / 30);
  return months < 24 ? `${months} months ago` : `${Math.floor(days / 365)} years ago`;
}

export function OutliersPage({ params }: PageProps) {
  const q = {
    preset: params.get("preset") || null,
    niche: params.get("niche") || null,
    platform: params.get("platform") || null,
    kind: params.get("kind") || null,
  };
  const key = JSON.stringify(q);
  const got = useCall(`canon-feed:${key}`, () => call<FeedPage>("canon/feed", q));
  useSeen("list", {
    label: "Outliers",
    icon: "chart",
    text: `Outlier posts${q.preset ? `, ${q.preset}` : ""}${q.niche ? `, in ${q.niche}` : ""}${
      q.platform ? `, on ${platformName(q.platform)}` : ""
    }${q.kind ? `, ${q.kind}s` : ""}`,
  });
  // Canon's page, and Studio's Inspiration
  const here = location.pathname;
  const set = (k: string, v: string | null) => navigate(href(here, { [k]: v || null }, params));

  if (got.error && !got.data) return <LoadFailed error={got.error} onRetry={got.retry} />;
  if (!got.data) return <Ghosts />;
  const data = got.data;
  if (!data.creators)
    return (
      <Empty
        title="No creators tracked yet"
        action={<CopyButton text="wren creator add  --niche " label="Copy the command" />}
      >
        Track one from the CLI:
        {/* breaks only between the parts, never inside a flag */}
        <code className="my-1.5 flex flex-wrap gap-x-[1ch] font-mono text-[12.5px]">
          <span className="whitespace-nowrap">wren creator add &lt;profile URL&gt;</span>
          <span className="whitespace-nowrap">--niche &lt;name&gt;</span>
        </code>
        A daily read stores their posts, and each post gets its multiple over their usual draw.
      </Empty>
    );
  if (!data.scored)
    return (
      <Empty
        title={`${num(data.creators)} ${data.creators === 1 ? "creator" : "creators"} tracked`}
        waits
      >
        No post has a score yet. A post gets one once its creator has 5 read posts of its kind.
      </Empty>
    );
  const filtered = FILTERS.some((k) => params.has(k));
  const shownCreators = new Set(data.rows.map((r) => r.creatorId)).size;
  const facet = (
    fs: { value: string; n: number }[],
    name: (v: string) => string,
    all: string,
    at: string | null,
  ) => ({
    "": all,
    ...(at && !fs.some((f) => f.value === at) ? { [at]: name(at) } : {}),
    ...Object.fromEntries(fs.map((f) => [f.value, `${name(f.value)} (${num(f.n)})`])),
  });

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-2 @min-[720px]/main:flex @min-[720px]/main:flex-wrap @min-[720px]/main:items-center">
        <div className="col-span-2">
          <Pick
            label="Preset"
            value={q.preset ?? ""}
            options={PRESETS}
            onChange={(v) => set("preset", v)}
          />
        </div>
        <Pick
          label="Niche"
          value={q.niche ?? ""}
          options={facet(data.niches, (v) => v, "Every niche", q.niche)}
          onChange={(v) => set("niche", v)}
        />
        <Pick
          label="Platform"
          value={q.platform ?? ""}
          options={facet(data.platforms, platformName, "Every platform", q.platform)}
          onChange={(v) => set("platform", v)}
        />
        <Pick
          label="Kind"
          value={q.kind ?? ""}
          options={{ "": "Every kind", ...KINDS }}
          onChange={(v) => set("kind", v)}
        />
        <span className="self-center text-[13px] text-(--ui-ink-3) @min-[720px]/main:ml-auto">
          {num(data.rows.length)} {data.rows.length === 1 ? "post" : "posts"}
          {shownCreators ? (
            <>
              {" "}
              from {num(shownCreators)} {shownCreators === 1 ? "creator" : "creators"}
            </>
          ) : null}
        </span>
      </div>
      {!data.rows.length ? (
        filtered ? (
          <Empty
            action={
              <a href={href(here, Object.fromEntries(FILTERS.map((k) => [k, null])), params)}>
                Clear filters
              </a>
            }
          >
            No post clears these filters.
          </Empty>
        ) : (
          <Empty title="No outliers yet" waits>
            No scored post is over its creator's usual draw. The daily read scores new posts.
          </Empty>
        )
      ) : (
        <ul aria-label="Outlier posts" className="m-0 grid list-none gap-5 p-0">
          {data.rows.map((r) => (
            <li key={`${r.platform}:${r.ref}`} className="min-w-0">
              <Row r={r} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Row({ r }: { r: FeedRow }) {
  const [save, setSave] = useState<{ busy: boolean; done: AddRow | null; error: string | null }>({
    busy: false,
    done: null,
    error: null,
  });
  const count = r.scoreCount === "views" || r.scoreCount === "likes" ? r.scoreCount : null;
  const n = count ? r.counts[count] : undefined;
  const title =
    r.title ?? r.text?.replace(/\s+/g, " ").trim() ?? `${KINDS[r.kind] ?? r.kind} by @${r.handle}`;
  /** the creator's median for this count: the draw the multiple is over */
  const usual = n != null && r.multiple ? Math.round(n / r.multiple) : null;
  const who = [
    r.name ? `${r.name} (@${r.handle})` : `@${r.handle}`,
    r.followers != null ? `${short(r.followers)} followers` : null,
  ]
    .filter(Boolean)
    .join(", ");
  const what = [
    `${platformName(r.platform)} ${(KINDS[r.kind] ?? r.kind).toLowerCase()}`,
    age(r.postedAt),
    n != null ? `${short(n)} ${count}${usual != null ? `, usual ${short(usual)}` : ""}` : null,
  ]
    .filter(Boolean)
    .join(", ");
  const inCanon = !!r.record || !!save.done;

  return (
    <article className="grid grid-cols-[3.75rem_minmax(0,1fr)] gap-x-3 gap-y-1 @min-[720px]/main:grid-cols-[5rem_minmax(0,1fr)_auto] @min-[720px]/main:items-start">
      <p
        className="m-0 row-span-2 text-[20px] leading-tight font-semibold text-(--ui-ink) tabular-nums"
        title={
          r.baselineN ? `over the median ${count ?? "count"} of ${r.baselineN} posts` : undefined
        }
      >
        {r.multiple != null
          ? `${r.multiple >= 100 ? Math.round(r.multiple) : r.multiple.toFixed(1)}x`
          : "?"}
      </p>
      <a
        href={r.url}
        target="_blank"
        rel="noreferrer"
        className="self-start text-[15px] leading-snug font-medium text-(--ui-ink) no-underline wrap-anywhere hover:underline"
      >
        {title}
      </a>
      <div className="col-start-2 row-start-2 flex min-w-0 flex-col gap-1 text-[13px] text-(--ui-ink-2)">
        <p className="m-0 wrap-anywhere">{who}</p>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="min-w-0 wrap-anywhere">{what}</span>
          {r.niches.map((t) => (
            <Tag key={t}>{t}</Tag>
          ))}
        </div>
      </div>
      {/* fixed slot: Save and its Tag swap without moving the row */}
      <div className="col-start-2 row-start-3 mt-1 @min-[720px]/main:col-start-3 @min-[720px]/main:row-span-2 @min-[720px]/main:row-start-1 @min-[720px]/main:mt-0 @min-[720px]/main:flex @min-[720px]/main:min-w-34 @min-[720px]/main:justify-end">
        {inCanon && !save.busy ? (
          <Tag tone="accent" className={save.done ? "[animation:ui-fade_.2s_both]" : undefined}>
            {save.done ? "Filing into Canon" : "In Canon"}
          </Tag>
        ) : (
          <Button
            size="dense"
            busy={save.busy}
            onClick={async () => {
              setSave({ busy: true, done: null, error: null });
              try {
                const row = await call<AddRow>("canon/add", {
                  what: r.url,
                  fileName: null,
                  note: null,
                });
                setSave({ busy: false, done: row, error: null });
              } catch (e) {
                setSave({
                  busy: false,
                  done: null,
                  error: e instanceof Error ? e.message : String(e),
                });
              }
            }}
          >
            Save to Canon
          </Button>
        )}
      </div>
      {save.error && (
        <p role="alert" className={`col-start-2 m-0 ${ERROR}`}>
          Not saved: {save.error}
        </p>
      )}
    </article>
  );
}

/** the skeleton in the row's shape: multiple, two title lines, two meta lines, Save */
function Ghosts() {
  return (
    <div role="status" className="flex flex-col gap-5">
      <span className="sr-only">Loading outliers</span>
      <Skeleton className="h-10 w-full @min-[720px]/main:w-[min(100%,710px)]" />
      {[0, 1, 2, 3].map((i) => (
        <div
          key={i}
          className="grid grid-cols-[3.75rem_minmax(0,1fr)] gap-x-3 gap-y-2 @min-[720px]/main:grid-cols-[5rem_minmax(0,1fr)_auto]"
        >
          <Skeleton className="h-6 w-12" />
          <div className="flex flex-col gap-2">
            <Skeleton className="h-4 w-[min(90%,560px)]" />
            <Skeleton className="h-3 w-[min(60%,380px)]" />
            <Skeleton className="h-3 w-[min(70%,440px)]" />
          </div>
          <Skeleton className="col-start-2 h-8 w-28 @min-[720px]/main:col-start-3 @min-[720px]/main:row-start-1" />
        </div>
      ))}
    </div>
  );
}

/**
 * Posts of his tracked creators, as a Feed or a Gallery (studio-suite D8): Canon › Outliers and
 * Studio › Inspiration are this part with other defaults. Presets are tabs; Filter, Sort, Select
 * and the layout sit on the bar. The address holds every pick: `preset`, `creator`, `platform`,
 * `kind`, `niche` (comma lists), `min`, `sort`, `layout`. Select files the picked posts through
 * the Add box's queue as his sources.
 */
import type { AddRow, FeedAsk, FeedPage, FeedPost } from "@wren/research/canon-console";
import type { FeedPreset } from "@wren/research/creators";
import {
  type BarField,
  BarLayout,
  Button,
  CHIP,
  CopyButton,
  chipClass,
  Empty,
  Icon,
  type IconName,
  Img,
  LoadFailed,
  num,
  PickBar,
  PickList,
  POP,
  type Segment,
  Segmented,
  Skeleton,
  short,
  Tag,
  tipProps,
  useFilterTools,
  useNarrow,
  useSeen,
  ViewStrip,
  type ViewTab,
} from "@wren/ui";
import { Popover, PopoverContent, PopoverTrigger } from "@wren/ui/components/ui/popover";
import { type ReactNode, useCallback, useLayoutEffect, useRef, useState } from "react";
import { call } from "../../api.js";
import { useCall } from "../../load.js";
import type { PageProps } from "../../module.js";
import { href, navigate } from "../../route.js";

const cn = (...xs: (string | false | null | undefined)[]) => xs.filter(Boolean).join(" ");

export type Layout = "feed" | "gallery";
type Sort = "new" | "multiple";
/** what a page shows before he picks anything */
export interface PostsStart {
  layout: Layout;
  sort: Sort;
  /** every post, or scored ones only */
  all: boolean;
  /** the first tab's name */
  first: string;
  /** the page's name, for the agent's view */
  label: string;
}

/** 10x and up: the accent wash and its tag (the top 8% on 11-14) */
const HOT = 10;
const PRESETS: [string, string, string][] = [
  ["breakouts", "Breakouts", "Under 50K followers, 5x and up, last 3 months"],
  ["hidden-gems", "Hidden gems", "Under 20K followers, 10x and up, last 6 months"],
  ["viral-now", "Viral now", "10x and up, last 30 days, 500 likes and up"],
  ["all-time-greats", "All-time greats", "Over 50K followers, 10x and up"],
];
const MINS: [string, string][] = [
  ["3", "3x and up"],
  ["5", "5x and up"],
  ["10", "10x and up"],
];
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
const LISTS = ["creator", "platform", "kind", "niche"] as const;
const FILTERS = [...LISTS, "min"] as const;
const platformName = (p: string) => PLATFORMS[p] ?? p;
const kindName = (k: string) => KINDS[k] ?? k;
const keyOf = (r: FeedPost) => `${r.platform}:${r.ref}`;
const times = (m: number) => `${m >= 10 ? Math.round(m) : m.toFixed(1)}x`;

/** "3 days ago", from an ISO time */
function age(at: string | null, now = Date.now()): string | null {
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

const listOf = (params: URLSearchParams, k: string) =>
  (params.get(k) ?? "").split(",").filter(Boolean);

/** the address, read */
function askOf(params: URLSearchParams, start: PostsStart) {
  const preset = params.get("preset") || null;
  const min = Number(params.get("min"));
  const sort: Sort =
    params.get("sort") === "new" || params.get("sort") === "multiple"
      ? (params.get("sort") as Sort)
      : start.sort;
  const layout: Layout =
    params.get("layout") === "feed" || params.get("layout") === "gallery"
      ? (params.get("layout") as Layout)
      : start.layout;
  const ask: FeedAsk = {
    preset: preset as FeedPreset | null,
    creators: listOf(params, "creator").map(Number).filter(Number.isFinite),
    platforms: listOf(params, "platform"),
    kinds: listOf(params, "kind"),
    niches: listOf(params, "niche"),
    min: min > 0 ? min : null,
    all: start.all,
    sort,
  };
  return { ask, preset, sort, layout };
}

interface Save {
  busy: boolean;
  note: string | null;
  bad: boolean;
}

export function CreatorPosts({ params, start }: PageProps & { start: PostsStart }) {
  const { ask, preset, sort, layout } = askOf(params, start);
  const got = useCall(`canon-feed:${JSON.stringify(ask)}`, () =>
    call<FeedPage>("canon/feed", { ...ask }),
  );
  const narrow = useNarrow();
  const here = location.pathname;
  const link = (next: Record<string, string | null>) => href(here, next, params);
  const go = (next: Record<string, string | null>) => navigate(link(next), true);

  const [picking, setPicking] = useState(false);
  const [picked, setPicked] = useState<Map<string, FeedPost>>(new Map());
  const [filed, setFiled] = useState<Set<string>>(new Set());
  const [save, setSave] = useState<Save>({ busy: false, note: null, bad: false });
  const end = useCallback(() => {
    setPicking(false);
    setPicked(new Map());
    setSave({ busy: false, note: null, bad: false });
  }, []);
  const flip = (r: FeedPost) =>
    setPicked((m) => {
      const n = new Map(m);
      if (n.has(keyOf(r))) n.delete(keyOf(r));
      else n.set(keyOf(r), r);
      return n;
    });
  const saveAll = async () => {
    const list = [...picked.values()];
    setSave({ busy: true, note: null, bad: false });
    const done = await Promise.allSettled(
      list.map((r) => call<AddRow>("canon/add", { what: r.url, fileName: null, note: null })),
    );
    const failed = new Map<string, FeedPost>();
    const why = new Set<string>();
    done.forEach((d, i) => {
      const r = list[i] as FeedPost;
      if (d.status === "fulfilled") return;
      failed.set(keyOf(r), r);
      why.add(d.reason instanceof Error ? d.reason.message : String(d.reason));
    });
    const ok = list.filter((r) => !failed.has(keyOf(r)));
    setFiled((s) => new Set([...s, ...ok.map(keyOf)]));
    if (!failed.size) return end();
    setPicked(failed);
    setSave({
      busy: false,
      bad: true,
      note: `${ok.length ? `${num(ok.length)} saved. ` : ""}${num(failed.size)} not saved: ${[...why].join(" ")}`,
    });
  };

  const data = got.data;
  const fields = fieldsOf(params, data, go);
  const on = fields.filter((f) => f.set);
  const tools = useFilterTools({
    fields,
    narrow,
    say: on.map((f) => f.set?.say).join(" · ") || undefined,
    clearAll: () => go(Object.fromEntries(FILTERS.map((k) => [k, null]))),
  });

  const presetName = PRESETS.find(([id]) => id === preset)?.[1];
  useSeen("list", {
    label: start.label,
    icon: "chart",
    text: [
      `${start.label}: ${presetName ?? start.first}, as a ${layout}, ${sort === "new" ? "newest" : "best multiple"} first`,
      ...on.map((f) => f.set?.say),
      data ? `${num(data.rows.length)} posts shown` : null,
    ]
      .filter(Boolean)
      .join("; "),
  });

  if (data && !data.creators)
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
  if (data && !data.scored && !start.all)
    return (
      <Empty
        title={`${num(data.creators)} ${data.creators === 1 ? "creator" : "creators"} tracked`}
        waits
        action={<CopyButton text="wren creator refresh" label="Copy the command" />}
      >
        No post has a score yet. A post gets one once its creator has 5 read posts of its kind. The
        daily read runs it; <code className="font-mono text-[12.5px]">wren creator refresh</code>{" "}
        runs it now.
      </Empty>
    );

  const tabs: ViewTab[] = [
    { id: "", label: start.first, href: link({ preset: null }), on: !preset },
    ...PRESETS.map(([id, label, tip]) => ({
      id,
      label,
      tip,
      href: link({ preset: id }),
      on: preset === id,
    })),
  ].map((t) => ({ ...t, busy: t.on && got.placeholder }));
  const layouts: Segment[] = (["feed", "gallery"] as const).map((l) => ({
    id: l,
    label: l === "feed" ? "Feed" : "Gallery",
    href: link({ layout: l === start.layout ? null : l }),
    on: layout === l,
  }));
  const filtered = !!preset || FILTERS.some((k) => params.has(k));
  const clearAll = link({ preset: null, ...Object.fromEntries(FILTERS.map((k) => [k, null])) });
  const rows = data?.rows ?? [];
  const shownCreators = new Set(rows.map((r) => r.creatorId)).size;

  return (
    <div className={cn("flex flex-col gap-4", picking && "pb-28")}>
      <div className="grid gap-2">
        <ViewStrip tabs={tabs} more={[]} row="views:creator-posts" narrow={narrow} />
        <BarLayout
          narrow={narrow}
          shape={<Segmented label="Layout" items={layouts} />}
          pills={on.length ? tools.pills() : []}
          clear={
            on.length ? (
              <a href={link(Object.fromEntries(FILTERS.map((k) => [k, null])))} className={CHIP}>
                Clear
              </a>
            ) : null
          }
          sheet={tools.sheet}
          tools={
            <>
              {tools.tool}
              <SortTool sort={sort} go={(s) => go({ sort: s === start.sort ? null : s })} />
              <button
                type="button"
                aria-pressed={picking}
                {...tipProps("Pick posts to save to Canon (Esc ends it)")}
                className={chipClass(picking)}
                onClick={() => (picking ? end() : setPicking(true))}
              >
                <Icon name="selected" className="size-[15px] [stroke-width:1.8]" />
                <span data-hp>Select</span>
              </button>
            </>
          }
        />
      </div>
      {got.error && !data ? (
        <LoadFailed error={got.error} onRetry={got.retry} />
      ) : !data ? (
        <Ghosts layout={layout} />
      ) : !rows.length ? (
        filtered ? (
          <Empty title="No post fits these filters" action={<a href={clearAll}>Clear filters</a>}>
            Drop a filter, or clear them all.
          </Empty>
        ) : (
          <Empty
            title={start.all ? "No posts yet" : "No outliers yet"}
            waits
            action={<CopyButton text="wren creator refresh" label="Copy the command" />}
          >
            {start.all
              ? "The daily read stores each tracked creator's new posts."
              : "No scored post is over its creator's usual draw. The daily read scores new posts."}{" "}
            <code className="font-mono text-[12.5px]">wren creator refresh</code> reads them now.
          </Empty>
        )
      ) : (
        <>
          <p className="m-0 text-[13px] text-(--ui-ink-3)">
            {num(rows.length)} {rows.length === 1 ? "post" : "posts"} from {num(shownCreators)}{" "}
            {shownCreators === 1 ? "creator" : "creators"}
          </p>
          <ul
            aria-label={start.label}
            aria-busy={got.placeholder || undefined}
            className={cn(
              "m-0 list-none p-0 transition-opacity duration-150",
              got.placeholder && "opacity-60",
              layout === "feed"
                ? "grid max-w-[640px] gap-2"
                : "grid grid-cols-2 gap-x-2 gap-y-3 @min-[720px]/main:grid-cols-[repeat(auto-fill,minmax(200px,1fr))]",
            )}
          >
            {rows.map((r) => {
              const k = keyOf(r);
              const canon = r.record ? "in" : filed.has(k) ? "filing" : null;
              const pick: PickState | null =
                picking && !canon
                  ? { on: picked.has(k), off: save.busy, flip: () => flip(r) }
                  : null;
              return (
                <li key={k} className="min-w-0 [animation:ui-fade_.15s_both]">
                  {layout === "feed" ? (
                    <FeedCard r={r} canon={canon} pick={pick} />
                  ) : (
                    <Tile r={r} canon={canon} pick={pick} />
                  )}
                </li>
              );
            })}
          </ul>
        </>
      )}
      {picking ? (
        <PickBar
          n={picked.size}
          note={save.note}
          bad={save.bad}
          onEnd={end}
          actions={
            <Button size="dense" busy={save.busy} disabled={!picked.size} onClick={saveAll}>
              Save to Canon
            </Button>
          }
        />
      ) : null}
    </div>
  );
}

/** Filter's fields: creator, platform, kind, niche (each many), times usual (one). */
function fieldsOf(
  params: URLSearchParams,
  data: FeedPage | null,
  go: (next: Record<string, string | null>) => void,
): BarField[] {
  const many = (
    key: (typeof LISTS)[number],
    label: string,
    icon: IconName,
    options: { id: string; face: ReactNode; text: string; n: number }[],
    name: (id: string) => string,
  ): BarField => {
    const picked = listOf(params, key);
    const value = picked.map(name).join(", ");
    const op = picked.length > 1 ? "is any of" : "is";
    // a pick the answer no longer counts still shows, so it can be unpicked
    const all = [
      ...options,
      ...picked
        .filter((p) => !options.some((o) => o.id === p))
        .map((p) => ({ id: p, face: name(p), text: name(p), n: 0 })),
    ];
    return {
      key,
      label,
      icon,
      set: picked.length ? { op, value, say: `${label} ${op} ${value}` } : null,
      editor: (
        <PickList
          label={label}
          options={all}
          on={new Set(picked)}
          counts={Object.fromEntries(all.map((o) => [o.id, o.n]))}
          onChange={(next) => go({ [key]: next.length ? next.join(",") : null })}
        />
      ),
      clear: () => go({ [key]: null }),
    };
  };
  const people = data?.people ?? [];
  const who = (id: string) => {
    const p = people.find((x) => String(x.id) === id);
    return p ? (p.name ?? `@${p.handle}`) : `Creator ${id}`;
  };
  const min = params.get("min");
  const minName = MINS.find(([id]) => id === min)?.[1] ?? (min ? `${min}x and up` : "");
  return [
    many(
      "creator",
      "Creator",
      "user",
      people.map((p) => ({
        id: String(p.id),
        text: `${p.name ?? ""} ${p.handle}`,
        n: p.n,
        face: (
          <span>
            {p.name ?? `@${p.handle}`}
            <span className="text-(--ui-ink-3)">
              {p.name ? ` @${p.handle}` : ""} · {platformName(p.platform)}
            </span>
          </span>
        ),
      })),
      who,
    ),
    many(
      "platform",
      "Platform",
      "globe",
      (data?.platforms ?? []).map((f) => ({
        id: f.value,
        face: platformName(f.value),
        text: platformName(f.value),
        n: f.n,
      })),
      platformName,
    ),
    many(
      "kind",
      "Kind",
      "boxes",
      (data?.kinds ?? []).map((f) => ({
        id: f.value,
        face: kindName(f.value),
        text: kindName(f.value),
        n: f.n,
      })),
      kindName,
    ),
    many(
      "niche",
      "Niche",
      "tag",
      (data?.niches ?? []).map((f) => ({ id: f.value, face: f.value, text: f.value, n: f.n })),
      (v) => v,
    ),
    {
      key: "min",
      label: "Times usual",
      icon: "chart",
      set: min ? { op: "is", value: minName, say: `Times usual is ${minName}` } : null,
      editor: (
        <PickList
          label="Times usual"
          options={MINS.map(([id, text]) => ({ id, face: text, text }))}
          on={new Set(min ? [min] : [])}
          // one at a time: the row just ticked, or none
          onChange={(next) => go({ min: next.find((id) => id !== min) ?? null })}
        />
      ),
      clear: () => go({ min: null }),
    },
  ];
}

function SortTool({ sort, go }: { sort: Sort; go: (s: Sort) => void }) {
  const [open, setOpen] = useState(false);
  const row =
    "flex h-8 pointer-coarse:h-11 w-full cursor-pointer items-center gap-2 border-0 bg-transparent px-2 text-left text-[13px] text-(--ui-ink) hover:bg-(--ui-hover) aria-[current=true]:font-semibold";
  const label = sort === "new" ? "Newest" : "Times usual";
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger className={CHIP} {...tipProps(`Sorted by ${label.toLowerCase()}`)}>
        <Icon name="sort" className="size-[15px] [stroke-width:1.8]" />
        <span data-hp>{label}</span>
      </PopoverTrigger>
      <PopoverContent aria-label="Sort" align="end" className={cn(POP, "w-48 p-1")}>
        {(
          [
            ["new", "Newest first"],
            ["multiple", "Times usual, best first"],
          ] as const
        ).map(([id, text]) => (
          <button
            key={id}
            type="button"
            aria-current={sort === id}
            className={row}
            onClick={() => {
              go(id);
              setOpen(false);
            }}
          >
            <span className="flex-1">{text}</span>
            {sort === id ? <Icon name="check" className="size-3.5" /> : null}
          </button>
        ))}
      </PopoverContent>
    </Popover>
  );
}

interface PickState {
  on: boolean;
  off: boolean;
  flip: () => void;
}
type Canon = "in" | "filing" | null;

/** In select mode: the whole card picks; a box in its corner says which. */
function PickCover({ r, pick }: { r: FeedPost; pick: PickState }) {
  return (
    <button
      type="button"
      aria-pressed={pick.on}
      aria-label={`Pick ${r.title ?? r.text?.slice(0, 80) ?? `@${r.handle}'s post`}`}
      disabled={pick.off}
      onClick={pick.flip}
      className={cn(
        "absolute inset-0 z-10 flex cursor-pointer items-start justify-end rounded-[inherit] border-0 bg-transparent p-2.5 outline-offset-2 focus-visible:outline-2 focus-visible:outline-(--ui-focus) disabled:cursor-default",
        pick.on && "outline-2 outline-(--ui-active) -outline-offset-2",
      )}
    >
      <span
        aria-hidden
        className={cn(
          "inline-flex size-5 items-center justify-center rounded-[4px] border-[1.5px] transition-colors duration-150",
          pick.on
            ? "border-(--ui-active) bg-(--ui-active) text-(--ui-on-ink)"
            : "border-(--ui-ink-3) bg-(--ui-paper)",
        )}
      >
        {pick.on ? <Icon name="check" className="size-3.5" strokeWidth={3} /> : null}
      </span>
    </button>
  );
}

function CanonTag({ canon }: { canon: Canon }) {
  if (!canon) return null;
  return (
    <Tag tone="accent" className={canon === "filing" ? "[animation:ui-fade_.2s_both]" : undefined}>
      {canon === "filing" ? "Filing into Canon" : "In Canon"}
    </Tag>
  );
}

/** "38x usual": the tag on a hot post, quiet words on the rest */
function Usual({ r, loud }: { r: FeedPost; loud: boolean }) {
  if (r.multiple == null) return null;
  const tip = r.baselineN
    ? `${times(r.multiple)} the median ${r.scoreCount ?? "count"} of their last ${r.baselineN} posts`
    : undefined;
  return loud ? (
    <Tag tone="accent" title={tip}>
      {times(r.multiple)} usual
    </Tag>
  ) : (
    <span title={tip} className="text-[13px] whitespace-nowrap text-(--ui-ink-3) tabular-nums">
      {times(r.multiple)} usual
    </span>
  );
}

/** a picture only where the post has one that loads; else null, and the words carry it */
function usePicture(r: FeedPost) {
  const [bad, setBad] = useState(false);
  return { src: r.src && !bad ? r.src : null, fail: () => setBad(true) };
}

const tall = (r: FeedPost) =>
  r.kind === "reel" || r.kind === "short" || r.platform === "instagram" || r.platform === "tiktok";

function counts(r: FeedPost) {
  return (["views", "likes", "comments"] as const)
    .filter((k) => r.counts[k] != null)
    .map((k) => `${short(r.counts[k] as number)} ${k}`)
    .join(" · ");
}

function FeedCard({ r, canon, pick }: { r: FeedPost; canon: Canon; pick: PickState | null }) {
  const hot = (r.multiple ?? 0) >= HOT;
  const pic = usePicture(r);
  const when = age(r.postedAt);
  const name = r.name ?? `@${r.handle}`;
  return (
    <article
      className={cn(
        "relative grid gap-3 rounded-[6px_14px_6px_14px] p-4 transition-colors duration-150",
        hot && "bg-(--ui-accent-wash) dark:bg-(--ui-accent-tint)",
      )}
    >
      <header className="flex min-w-0 items-start gap-3">
        <span
          aria-hidden
          className="inline-flex size-9 shrink-0 items-center justify-center rounded-full bg-(--ui-accent-tint) text-[14px] font-semibold text-(--ui-active)"
        >
          {(r.name ?? r.handle)
            .replace(/^[^\p{L}\p{N}]+/u, "")
            .slice(0, 1)
            .toUpperCase() || "?"}
        </span>
        <div className="grid min-w-0 flex-1 gap-0.5">
          <p className="m-0 text-[14px] leading-snug font-semibold wrap-anywhere text-(--ui-ink)">
            {name}
          </p>
          <p className="m-0 text-[13px] leading-snug wrap-anywhere text-(--ui-ink-3)">
            {[r.name ? `@${r.handle}` : null, platformName(r.platform)].filter(Boolean).join(" · ")}
            {when ? (
              <>
                {" "}
                <span className="whitespace-nowrap">
                  ·{" "}
                  <a
                    href={r.url}
                    target="_blank"
                    rel="noreferrer"
                    className="text-inherit hover:underline"
                  >
                    {when}
                  </a>
                </span>
              </>
            ) : null}
          </p>
        </div>
        <div
          className={cn("flex shrink-0 flex-wrap items-center justify-end gap-1.5", pick && "mr-8")}
        >
          <CanonTag canon={canon} />
          <Usual r={r} loud={hot} />
        </div>
      </header>
      {r.title ? (
        <a
          href={r.url}
          target="_blank"
          rel="noreferrer"
          className="text-[15px] leading-snug font-semibold wrap-anywhere text-(--ui-ink) no-underline hover:underline"
        >
          {r.title}
        </a>
      ) : null}
      {r.text ? <Body text={r.text} /> : null}
      {pic.src ? (
        <a
          href={r.url}
          target="_blank"
          rel="noreferrer"
          className={cn(
            "block overflow-hidden rounded-[6px]",
            tall(r) ? "w-[min(100%,320px)]" : "w-full",
          )}
        >
          <Img
            src={pic.src}
            alt={r.title ?? r.text ?? ""}
            onError={pic.fail}
            className={cn("block w-full object-cover", tall(r) ? "aspect-[4/5]" : "aspect-video")}
          />
        </a>
      ) : null}
      {counts(r) ? (
        <p className="m-0 text-[13px] text-(--ui-ink-2) tabular-nums">{counts(r)}</p>
      ) : null}
      {pick ? <PickCover r={r} pick={pick} /> : null}
    </article>
  );
}

/** The post's words, whole; past 8 lines it folds, and More opens the rest. */
function Body({ text }: { text: string }) {
  const ref = useRef<HTMLParagraphElement>(null);
  /** the whole text's height, once it runs past 8 lines */
  const [full, setFull] = useState<number | null>(null);
  const [open, setOpen] = useState(false);
  const long = full != null;
  // biome-ignore lint/correctness/useExhaustiveDependencies: measured again per text
  useLayoutEffect(() => {
    const el = ref.current;
    if (el) setFull(el.scrollHeight > el.clientHeight + 1 ? el.scrollHeight : null);
  }, [text]);
  return (
    <div className="grid justify-items-start gap-1">
      <p
        ref={ref}
        style={{ maxHeight: open && full ? full : "12em" }}
        className="m-0 overflow-hidden text-[14.5px] leading-[1.5] whitespace-pre-line wrap-anywhere text-(--ui-ink) transition-[max-height] duration-200 ease-(--ui-ease) motion-reduce:transition-none"
      >
        {text}
      </p>
      {long ? (
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
          className="relative z-20 h-7 cursor-pointer border-0 bg-transparent p-0 text-[13px] font-semibold text-(--ui-ink-2) hover:text-(--ui-ink)"
        >
          {open ? "Less" : "More"}
        </button>
      ) : null}
    </div>
  );
}

function Tile({ r, canon, pick }: { r: FeedPost; canon: Canon; pick: PickState | null }) {
  const hot = (r.multiple ?? 0) >= HOT;
  const pic = usePicture(r);
  const when = age(r.postedAt);
  const words = r.title ?? r.text ?? `${kindName(r.kind)} by @${r.handle}`;
  return (
    <article
      className={cn(
        "relative grid gap-1.5 rounded-[6px_14px_6px_14px] p-1.5",
        hot && "bg-(--ui-accent-wash) dark:bg-(--ui-accent-tint)",
      )}
    >
      <a
        href={r.url}
        target="_blank"
        rel="noreferrer"
        className="relative block aspect-[4/5] overflow-hidden rounded-[4px_10px_4px_10px] bg-(--ui-hover) no-underline"
      >
        {pic.src ? (
          <Img
            src={pic.src}
            alt={words}
            onError={pic.fail}
            className="block size-full object-cover"
          />
        ) : (
          // a text post fills the frame with its words; the post opens the rest
          <p
            className={cn(
              "m-0 h-full overflow-hidden p-3 text-[13.5px] leading-[1.45] whitespace-pre-line wrap-anywhere text-(--ui-ink) [animation:ui-fade_.15s_both] [mask-image:linear-gradient(#000_75%,transparent)]",
              pick && "pr-9",
            )}
          >
            {words}
          </p>
        )}
        {canon ? (
          // paper under the tint: it sits on a picture
          <span className="absolute bottom-2 left-2 rounded-(--ui-leaf-chip) bg-(--ui-paper)">
            <CanonTag canon={canon} />
          </span>
        ) : null}
      </a>
      <div className="flex min-w-0 flex-wrap items-baseline gap-x-1.5 px-0.5">
        {r.multiple != null ? (
          <>
            <span
              className={cn(
                "text-[20px] leading-tight font-semibold tabular-nums",
                hot ? "text-(--ui-active)" : "text-(--ui-ink)",
              )}
            >
              {times(r.multiple)}
            </span>
            <span className="text-[12.5px] text-(--ui-ink-3)">usual</span>
          </>
        ) : (
          <span className="text-[12.5px] leading-[25px] text-(--ui-ink-3)">Not scored yet</span>
        )}
      </div>
      <p className="m-0 px-0.5 text-[12.5px] leading-snug wrap-anywhere text-(--ui-ink-2)">
        @{r.handle}
        {when ? <span className="text-(--ui-ink-3)"> · {when}</span> : null}
      </p>
      {pick ? <PickCover r={r} pick={pick} /> : null}
    </article>
  );
}

/** skeletons in the layout's shape */
function Ghosts({ layout }: { layout: Layout }) {
  return (
    <div role="status" className="grid gap-4">
      <span className="sr-only">Loading posts</span>
      {layout === "feed" ? (
        <div className="grid max-w-[640px] gap-2">
          {[0, 1, 2].map((i) => (
            <div key={i} className="grid gap-3 p-4">
              <div className="flex items-center gap-3">
                <Skeleton className="size-9 rounded-full" />
                <div className="grid flex-1 gap-1.5">
                  <Skeleton className="h-3.5 w-40" />
                  <Skeleton className="h-3 w-56" />
                </div>
              </div>
              <Skeleton className="h-4 w-[90%]" />
              <Skeleton className="h-4 w-[70%]" />
              <Skeleton className="aspect-video w-full" />
            </div>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-x-2 gap-y-3 @min-[720px]/main:grid-cols-[repeat(auto-fill,minmax(200px,1fr))]">
          {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
            <div key={i} className="grid gap-1.5 p-1.5">
              <Skeleton className="aspect-[4/5] w-full" />
              <Skeleton className="h-5 w-16" />
              <Skeleton className="h-3 w-24" />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

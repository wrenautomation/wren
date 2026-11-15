/**
 * Posts of his tracked creators, as a Feed or a Gallery (studio-suite D8): Canon › Outliers and
 * Studio › Inspiration are this part with other defaults. Presets are tabs; Filter, Sort, Group,
 * Select and the layout sit on the bar. The address holds every pick: `preset`, `creator`,
 * `platform`, `kind`, `niche` (comma lists), `min`, `sort`, `group`, `layout`, and `post`, the post
 * open in the record panel (D9). Select files the picked posts through the Add box's queue as his
 * sources.
 */
import type { AddRow, FeedAsk, FeedPage, FeedPost } from "@wren/research/canon-console";
import type { FeedPreset, FeedSort } from "@wren/research/creators";
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
import { type OneSave, PostDetail } from "./post-detail.js";
import {
  age,
  type Canon,
  CanonTag,
  CountRow,
  cn,
  countIcon,
  followersText,
  HOT,
  keyOf,
  kindName,
  Letter,
  nameOf,
  platformName,
  tall,
  times,
  Usual,
  usePicture,
  usualTip,
  when,
} from "./post-parts.js";

export type Layout = "feed" | "gallery";
type Sort = FeedSort;
const SORTS: [Sort, string, string][] = [
  ["new", "Newest", "Newest first"],
  ["multiple", "Times usual", "Times usual, best first"],
  ["views", "Most views", "Most views first"],
  ["likes", "Most likes", "Most likes first"],
];
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
const LISTS = ["creator", "platform", "kind", "niche"] as const;
const FILTERS = [...LISTS, "min"] as const;
const listOf = (params: URLSearchParams, k: string) =>
  (params.get(k) ?? "").split(",").filter(Boolean);

/** the address, read */
function askOf(params: URLSearchParams, start: PostsStart) {
  const preset = params.get("preset") || null;
  const min = Number(params.get("min"));
  const sort: Sort = SORTS.find(([id]) => id === params.get("sort"))?.[0] ?? start.sort;
  const group = params.get("group") === "creator" ? ("creator" as const) : null;
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
    group,
  };
  return { ask, preset, sort, group, layout };
}

interface Save {
  busy: boolean;
  note: string | null;
  bad: boolean;
}

export function CreatorPosts({ params, start }: PageProps & { start: PostsStart }) {
  const { ask, preset, sort, group, layout } = askOf(params, start);
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
  // one post saved from its panel
  const [one, setOne] = useState<(OneSave & { key: string }) | null>(null);
  const saveOne = async (r: FeedPost) => {
    const k = keyOf(r);
    setOne({ key: k, busy: true, error: null });
    try {
      await call<AddRow>("canon/add", { what: r.url, fileName: null, note: null });
      setFiled((s) => new Set([...s, k]));
      setOne(null);
    } catch (e) {
      setOne({ key: k, busy: false, error: e instanceof Error ? e.message : String(e) });
    }
  };
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
      `${start.label}: ${presetName ?? start.first}, as a ${layout}, ${SORTS.find(([id]) => id === sort)?.[2].toLowerCase()}${group ? ", grouped by creator" : ""}`,
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
  const canonOf = (r: FeedPost): Canon => (r.record ? "in" : filed.has(keyOf(r)) ? "filing" : null);
  const openKey = params.get("post");
  const opened = openKey && data ? (rows.find((r) => keyOf(r) === openKey) ?? null) : undefined;

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
                aria-pressed={!!group}
                {...tipProps("A section a creator, their top 12 each")}
                className={chipClass(!!group)}
                onClick={() => go({ group: group ? null : "creator" })}
              >
                <Icon name="people" className="size-[15px] [stroke-width:1.8]" />
                <span data-hp>By creator</span>
              </button>
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
          <div
            aria-busy={got.placeholder || undefined}
            className={cn(
              "grid gap-8 transition-opacity duration-150",
              got.placeholder && "opacity-60",
            )}
          >
            {(group ? sections(rows) : [rows]).map((part) => {
              const head = group ? part[0] : null;
              const list = (
                <ul
                  aria-label={head ? `${nameOf(head)}'s posts` : start.label}
                  className={cn(
                    "m-0 list-none p-0",
                    layout === "feed"
                      ? "grid max-w-[640px] gap-2"
                      : "grid grid-cols-2 gap-x-2 gap-y-3 @min-[720px]/main:grid-cols-[repeat(auto-fill,minmax(200px,1fr))]",
                  )}
                >
                  {part.map((r) => {
                    const k = keyOf(r);
                    const canon = canonOf(r);
                    const pick: PickState | null =
                      picking && !canon
                        ? { on: picked.has(k), off: save.busy, flip: () => flip(r) }
                        : null;
                    const open = link({ post: k });
                    return (
                      <li key={k} className="min-w-0 [animation:ui-fade_.15s_both]">
                        {layout === "feed" ? (
                          <FeedCard r={r} canon={canon} pick={pick} open={open} inGroup={!!head} />
                        ) : (
                          <Tile r={r} canon={canon} pick={pick} open={open} inGroup={!!head} />
                        )}
                      </li>
                    );
                  })}
                </ul>
              );
              if (!head) return <div key="all">{list}</div>;
              const total = head.creatorPosts ?? part.length;
              return (
                <section
                  key={head.creatorId}
                  aria-label={nameOf(head)}
                  className="grid gap-3 [animation:ui-fade_.15s_both]"
                >
                  <CreatorHead r={head} n={total} layout={layout} />
                  {list}
                  {total > part.length ? (
                    <a
                      href={link({ creator: String(head.creatorId), group: null })}
                      className={cn(
                        "justify-self-start text-[13px] font-semibold text-(--ui-ink-2) hover:text-(--ui-ink)",
                        layout === "feed" ? "mx-4" : "mx-1.5",
                      )}
                    >
                      All {num(total)} posts by {nameOf(head)}
                    </a>
                  ) : null}
                </section>
              );
            })}
          </div>
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
      {opened !== undefined ? (
        <PostDetail
          key={openKey ?? ""}
          r={opened}
          canon={opened ? canonOf(opened) : null}
          save={one && opened && one.key === keyOf(opened) ? one : null}
          onSave={() => opened && saveOne(opened)}
          creatorHref={
            opened ? link({ creator: String(opened.creatorId), group: null, post: null }) : null
          }
          onClose={() => go({ post: null })}
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
  const label = SORTS.find(([id]) => id === sort)?.[1] ?? "Newest";
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger className={CHIP} {...tipProps(`Sorted by ${label.toLowerCase()}`)}>
        <Icon name="sort" className="size-[15px] [stroke-width:1.8]" />
        <span data-hp>{label}</span>
      </PopoverTrigger>
      <PopoverContent aria-label="Sort" align="end" className={cn(POP, "w-48 p-1")}>
        {SORTS.map(([id, , text]) => (
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

/** grouped rows, one list a creator, in the server's order */
function sections(rows: FeedPost[]): FeedPost[][] {
  const by = new Map<number, FeedPost[]>();
  for (const r of rows) by.set(r.creatorId, [...(by.get(r.creatorId) ?? []), r]);
  return [...by.values()];
}

/** a section's head: who, where, how many (YouTube's channel shelf) */
function CreatorHead({ r, n, layout }: { r: FeedPost; n: number; layout: Layout }) {
  return (
    // on the cards' own edge: their padding
    <header
      className={cn("flex min-w-0 items-center gap-3", layout === "feed" ? "px-4" : "px-1.5")}
    >
      <Letter r={r} />
      <div className="grid min-w-0 gap-0.5">
        <h2 className="m-0 text-[15px] leading-snug font-semibold wrap-anywhere text-(--ui-ink)">
          {nameOf(r)}
        </h2>
        <p className="m-0 text-[13px] leading-snug wrap-anywhere text-(--ui-ink-3)">
          {[
            r.name ? `@${r.handle}` : null,
            platformName(r.platform),
            followersText(r.followers),
            `${num(n)} ${n === 1 ? "post" : "posts"}`,
          ]
            .filter(Boolean)
            .join(" · ")}
        </p>
      </div>
    </header>
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

function FeedCard({
  r,
  canon,
  pick,
  open,
  inGroup,
}: {
  r: FeedPost;
  canon: Canon;
  pick: PickState | null;
  open: string;
  /** under its creator's head: no creator line */
  inGroup: boolean;
}) {
  const hot = (r.multiple ?? 0) >= HOT;
  const pic = usePicture(r);
  const ago = age(r.postedAt);
  return (
    <article
      className={cn(
        "relative grid gap-3 rounded-[6px_14px_6px_14px] p-4 transition-colors duration-150",
        hot ? "bg-(--ui-accent-wash) dark:bg-(--ui-accent-tint)" : !pick && "hover:bg-(--ui-hover)",
      )}
    >
      <header className="flex min-w-0 items-start gap-3">
        {inGroup ? (
          <p className="m-0 min-w-0 flex-1 text-[13px] leading-snug text-(--ui-ink-3)">
            <span title={when(r.postedAt) ?? undefined}>{ago ?? kindName(r.kind)}</span>
          </p>
        ) : (
          <>
            <Letter r={r} />
            <div className="grid min-w-0 flex-1 gap-0.5">
              <p className="m-0 text-[14px] leading-snug font-semibold wrap-anywhere text-(--ui-ink)">
                {nameOf(r)}
              </p>
              <p className="m-0 text-[13px] leading-snug wrap-anywhere text-(--ui-ink-3)">
                {[r.name ? `@${r.handle}` : null, platformName(r.platform)]
                  .filter(Boolean)
                  .join(" · ")}
                {ago ? (
                  <>
                    {" "}
                    <span className="whitespace-nowrap" title={when(r.postedAt) ?? undefined}>
                      · {ago}
                    </span>
                  </>
                ) : null}
              </p>
            </div>
          </>
        )}
        <div
          className={cn("flex shrink-0 flex-wrap items-center justify-end gap-1.5", pick && "mr-8")}
        >
          <CanonTag canon={canon} />
          <Usual r={r} loud={hot} />
        </div>
      </header>
      {r.title ? (
        <p className="m-0 text-[15px] leading-snug font-semibold wrap-anywhere text-(--ui-ink)">
          {r.title}
        </p>
      ) : null}
      {r.text ? <Body text={r.text} /> : null}
      {pic.src ? (
        <div
          className={cn(
            "overflow-hidden rounded-[6px]",
            tall(r) ? "w-[min(100%,320px)]" : "w-full",
          )}
        >
          <Img
            src={pic.src}
            alt={r.title ?? r.text ?? ""}
            onError={pic.fail}
            className={cn("block w-full object-cover", tall(r) ? "aspect-[4/5]" : "aspect-video")}
          />
        </div>
      ) : null}
      <CountRow r={r} className="text-[13px] text-(--ui-ink-2)" />
      <OpenLink open={open} r={r} />
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

/** the count a tile shows on its picture: the one its score is on (TikTok's plays) */
function TileCount({ r, onPicture }: { r: FeedPost; onPicture: boolean }) {
  const k = r.scoreCount === "likes" ? "likes" : r.counts.views != null ? "views" : "likes";
  const n = r.counts[k];
  if (n == null) return null;
  return (
    <span
      className={cn(
        "absolute bottom-2 left-2 inline-flex items-center gap-1 text-[12.5px] font-semibold tabular-nums",
        onPicture ? "text-white [text-shadow:var(--ui-media-ink-shadow)]" : "text-(--ui-ink-2)",
      )}
    >
      <Icon name={countIcon(r, k)} className="size-3.5 [stroke-width:2.2]" />
      {short(n)}
      <span className="sr-only"> {k}</span>
    </span>
  );
}

function Tile({
  r,
  canon,
  pick,
  open,
  inGroup,
}: {
  r: FeedPost;
  canon: Canon;
  pick: PickState | null;
  open: string;
  /** under its creator's head: no creator line */
  inGroup: boolean;
}) {
  const hot = (r.multiple ?? 0) >= HOT;
  const pic = usePicture(r);
  const ago = age(r.postedAt);
  const words = r.title ?? r.text ?? `${kindName(r.kind)} by @${r.handle}`;
  const more = (["likes", "comments"] as const).filter((k) => r.counts[k] != null);
  return (
    <article
      className={cn(
        "group/tile relative grid gap-1.5 rounded-[6px_14px_6px_14px] p-1.5",
        hot && "bg-(--ui-accent-wash) dark:bg-(--ui-accent-tint)",
      )}
    >
      <div className="relative aspect-[4/5] overflow-hidden rounded-[4px_10px_4px_10px] bg-(--ui-hover)">
        {pic.src ? (
          <>
            <Img
              src={pic.src}
              alt={words}
              onError={pic.fail}
              className="block size-full object-cover"
            />
            <span
              aria-hidden
              className="absolute inset-x-0 bottom-0 h-14 bg-(image:--ui-media-fade)"
            />
          </>
        ) : (
          // a text post fills the frame with its words; the panel opens the rest
          <p
            className={cn(
              "m-0 h-full overflow-hidden p-3 pb-8 text-[13.5px] leading-[1.45] whitespace-pre-line wrap-anywhere text-(--ui-ink) [animation:ui-fade_.15s_both] [mask-image:linear-gradient(#000_70%,transparent)]",
              pick && "pr-9",
              canon && "pt-10",
            )}
          >
            {words}
          </p>
        )}
        <TileCount r={r} onPicture={!!pic.src} />
        {canon ? (
          // paper under the tint: it sits on a picture
          <span className="absolute top-2 left-2 rounded-(--ui-leaf-chip) bg-(--ui-paper)">
            <CanonTag canon={canon} />
          </span>
        ) : null}
        {more.length && !pick ? (
          // Instagram's grid: likes and comments over the picture on hover
          <div
            aria-hidden
            className="absolute inset-0 flex items-center justify-center bg-(--ui-media-veil) text-white opacity-0 transition-opacity duration-150 group-hover/tile:opacity-100"
          >
            <CountRow
              r={r}
              only={more}
              className="justify-center gap-x-5 text-[14px] font-semibold"
            />
          </div>
        ) : null}
      </div>
      <div className="flex min-w-0 flex-wrap items-baseline gap-x-1.5 px-0.5">
        {r.multiple != null ? (
          <span
            // biome-ignore lint/a11y/noNoninteractiveTabindex: the tip opens on focus too
            tabIndex={0}
            {...tipProps(usualTip(r))}
            className="relative z-[2] inline-flex items-baseline gap-x-1.5 rounded-[4px] outline-offset-2 focus-visible:outline-2 focus-visible:outline-(--ui-focus)"
          >
            <span
              className={cn(
                "text-[20px] leading-tight font-semibold tabular-nums",
                hot ? "text-(--ui-active)" : "text-(--ui-ink)",
              )}
            >
              {times(r.multiple)}
            </span>
            <span className="text-[12.5px] text-(--ui-ink-3)">usual</span>
          </span>
        ) : (
          <span className="text-[12.5px] leading-[25px] text-(--ui-ink-3)">Not scored yet</span>
        )}
      </div>
      {inGroup ? (
        ago ? (
          <p className="m-0 px-0.5 text-[12.5px] leading-snug text-(--ui-ink-3)">{ago}</p>
        ) : null
      ) : (
        <p className="m-0 px-0.5 text-[12.5px] leading-snug wrap-anywhere text-(--ui-ink-2)">
          @{r.handle}
          {ago ? <span className="text-(--ui-ink-3)"> · {ago}</span> : null}
        </p>
      )}
      <OpenLink open={open} r={r} />
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

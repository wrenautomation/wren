/**
 * Posts of his tracked creators as a gallery (studio-suite D8-D10): Canon › Outliers and Studio ›
 * Inspiration are this part with other defaults. A strip of creator faces sits on top (YouTube's
 * subscriptions bar); presets are tabs; Filter, Sort, Group and Select sit on the bar. The address
 * holds every pick: `preset`, `creator` (person ids), `platform`, `kind`, `niche` (comma lists),
 * `min`, `sort`, `group`, and `post`, the post open in the record panel (D9). Select files the
 * picked posts through the Add box's queue as his sources.
 */
import type {
  AddRow,
  FeedAsk,
  FeedPage,
  FeedPersonShown,
  FeedPost,
} from "@wren/research/canon-console";
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
  PlatformTile,
  POP,
  Skeleton,
  tipProps,
  useFilterTools,
  useNarrow,
  useSeen,
  ViewStrip,
  type ViewTab,
} from "@wren/ui";
import { Popover, PopoverContent, PopoverTrigger } from "@wren/ui/components/ui/popover";
import { type PointerEvent, type ReactNode, useCallback, useEffect, useRef, useState } from "react";
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
  Face,
  followersText,
  HOT,
  hookOf,
  keyOf,
  kindName,
  nameOf,
  perFollowerText,
  platformName,
  times,
  UsualRule,
  usePicture,
  usualTip,
  usualWords,
} from "./post-parts.js";

type Sort = FeedSort;
const SORTS: [Sort, string, string][] = [
  ["new", "Newest", "Newest first"],
  ["multiple", "Times their usual", "Times their usual, best first"],
  ["views", "Most views", "Most views first"],
  ["likes", "Most likes", "Most likes first"],
  ["reach", "Views per follower", "Most views per follower first"],
];
/** what a page shows before he picks anything */
export interface PostsStart {
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
  const ask: FeedAsk = {
    preset: preset as FeedPreset | null,
    people: listOf(params, "creator").map(Number).filter(Number.isFinite),
    platforms: listOf(params, "platform"),
    kinds: listOf(params, "kind"),
    niches: listOf(params, "niche"),
    min: min > 0 ? min : null,
    all: start.all,
    sort,
    group,
  };
  return { ask, preset, sort, group };
}

interface Save {
  busy: boolean;
  note: string | null;
  bad: boolean;
}

export function CreatorPosts({ params, start }: PageProps & { start: PostsStart }) {
  const { ask, preset, sort, group } = askOf(params, start);
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
      `${start.label}: ${presetName ?? start.first}, ${SORTS.find(([id]) => id === sort)?.[2].toLowerCase()}${group ? ", grouped by creator" : ""}`,
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
  const filtered = !!preset || FILTERS.some((k) => params.has(k));
  const clearAll = link({ preset: null, ...Object.fromEntries(FILTERS.map((k) => [k, null])) });
  const rows = data?.rows ?? [];
  const shownCreators = new Set(rows.map((r) => r.personId)).size;
  const personOf = (id: number) => data?.people.find((p) => p.id === id);
  const canonOf = (r: FeedPost): Canon => (r.record ? "in" : filed.has(keyOf(r)) ? "filing" : null);
  const openKey = params.get("post");
  const opened = openKey && data ? (rows.find((r) => keyOf(r) === openKey) ?? null) : undefined;

  return (
    <div className={cn("flex flex-col gap-4", picking && "pb-28")}>
      {data?.people.length ? (
        <CreatorStrip
          people={data.people}
          on={new Set(listOf(params, "creator"))}
          link={(id) => link({ creator: id, group: null, post: null })}
        />
      ) : null}
      <div className="grid gap-2">
        <ViewStrip tabs={tabs} more={[]} row="views:creator-posts" narrow={narrow} />
        <BarLayout
          narrow={narrow}
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
                {...tipProps("A section per creator, their top 12 each")}
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
        <Ghosts />
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
          <div className="grid gap-1">
            <p className="m-0 text-[13px] text-(--ui-ink-3)">
              {num(rows.length)} {rows.length === 1 ? "post" : "posts"} from {num(shownCreators)}{" "}
              {shownCreators === 1 ? "creator" : "creators"}
            </p>
            {rows.some((r) => r.multiple != null) ? (
              <UsualRule likes={rows.some((r) => r.scoreCount === "likes")} />
            ) : null}
          </div>
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
                  className={cn("m-0 list-none p-0", GALLERY)}
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
                        <Tile
                          r={r}
                          canon={canon}
                          pick={pick}
                          open={open}
                          inGroup={!!head}
                          reach={sort === "reach"}
                        />
                      </li>
                    );
                  })}
                </ul>
              );
              if (!head) return <div key="all">{list}</div>;
              const total = head.creatorPosts ?? part.length;
              return (
                <section
                  key={head.personId}
                  aria-label={nameOf(head)}
                  className="grid gap-3 [animation:ui-fade_.15s_both]"
                >
                  <CreatorHead r={head} person={personOf(head.personId)} n={total} />
                  {list}
                  {total > part.length ? (
                    <a
                      href={link({ creator: String(head.personId), group: null })}
                      className="justify-self-start text-[13px] font-semibold text-(--ui-ink-2) hover:text-(--ui-ink)"
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
            opened ? link({ creator: String(opened.personId), group: null, post: null }) : null
          }
          face={opened ? (personOf(opened.personId)?.src ?? null) : null}
          also={
            opened
              ? (personOf(opened.personId)?.accounts ?? []).filter((a) => a.id !== opened.creatorId)
              : []
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
  const who = (id: string) => people.find((x) => String(x.id) === id)?.name ?? `Creator ${id}`;
  const min = params.get("min");
  const minName = MINS.find(([id]) => id === min)?.[1] ?? (min ? `${min}x and up` : "");
  return [
    many(
      "creator",
      "Creator",
      "user",
      people.map((p) => ({
        id: String(p.id),
        text: [p.name, ...p.accounts.map((a) => a.handle)].join(" "),
        n: p.n,
        face: (
          <span>
            {p.name}
            <span className="text-(--ui-ink-3)"> · {platformsOf(p)}</span>
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
      label: "Times their usual",
      icon: "chart",
      set: min ? { op: "is", value: minName, say: `Times their usual is ${minName}` } : null,
      editor: (
        <PickList
          label="Times their usual"
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
      aria-label={`Pick ${r.title ?? r.text?.slice(0, 80) ?? `${nameOf(r)}'s post`}`}
      disabled={pick.off}
      onClick={pick.flip}
      className={cn(
        "absolute inset-0 z-10 flex cursor-pointer items-start justify-end rounded-[inherit] border-0 p-2.5 outline-offset-2 focus-visible:outline-2 focus-visible:outline-(--ui-focus) disabled:cursor-default",
        // a tint, not an outline: the outline marks a hot post
        pick.on ? "bg-(--ui-active)/12" : "bg-transparent",
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

/** grouped rows, one list a creator person, in the server's order */
function sections(rows: FeedPost[]): FeedPost[][] {
  const by = new Map<number, FeedPost[]>();
  for (const r of rows) by.set(r.personId, [...(by.get(r.personId) ?? []), r]);
  return [...by.values()];
}

/** "YouTube, X" */
const platformsOf = (p: FeedPersonShown) =>
  [...new Set(p.accounts.map((a) => platformName(a.platform)))].join(", ");

/** a platform's mark and its name for a screen reader: every post says where it is from (D10) */
function Where({ platform }: { platform: string }) {
  return (
    <>
      <PlatformTile mark={platform} className="mt-px shrink-0" />
      <span className="sr-only">{platformName(platform)}</span>
    </>
  );
}

/** a section's head: who, where, how many (YouTube's channel shelf); each account with its mark */
function CreatorHead({
  r,
  person,
  n,
}: {
  r: FeedPost;
  person: FeedPersonShown | undefined;
  n: number;
}) {
  const accounts = person?.accounts.length
    ? person.accounts
    : [{ id: r.creatorId, platform: r.platform, handle: r.handle, followers: r.followers }];
  return (
    <header className="flex min-w-0 items-center gap-3">
      <Face name={nameOf(r)} src={person?.src ?? null} size={40} />
      <div className="grid min-w-0 gap-0.5">
        <h2 className="m-0 text-[15px] leading-snug font-semibold wrap-anywhere text-(--ui-ink)">
          {nameOf(r)}
        </h2>
        <ul className="m-0 flex list-none flex-wrap items-center gap-x-3 gap-y-0.5 p-0 text-[13px] leading-snug text-(--ui-ink-3)">
          {accounts.map((a) => (
            <li key={a.id} className="inline-flex min-w-0 items-center gap-1.5 wrap-anywhere">
              <PlatformTile mark={a.platform} />
              <span>
                <span className="sr-only">{platformName(a.platform)} </span>@{a.handle}
                {followersText(a.followers) ? ` · ${followersText(a.followers)}` : ""}
              </span>
            </li>
          ))}
          <li>
            {num(n)} {n === 1 ? "post" : "posts"}
          </li>
        </ul>
      </div>
    </header>
  );
}

/**
 * The creators he tracks, one face each (YouTube's subscriptions bar): a tap shows only that
 * creator's posts, a second tap shows all again. Each face wears its platforms' marks. Scrolls
 * across inside itself when they outgrow the width.
 */
function CreatorStrip({
  people,
  on,
  link,
}: {
  people: FeedPersonShown[];
  on: Set<string>;
  link: (id: string | null) => string;
}) {
  const item =
    "group/face flex w-[76px] shrink-0 snap-start flex-col items-center gap-1.5 rounded-[8px] py-1 text-center no-underline outline-offset-2 focus-visible:outline-2 focus-visible:outline-(--ui-focus)";
  const ring = (lit: boolean) =>
    cn(
      "relative rounded-full p-[3px] outline-2 -outline-offset-2 transition-[outline-color] duration-150",
      lit ? "outline-(--ui-active)" : "outline-transparent group-hover/face:outline-(--ui-hair)",
    );
  // a face picked off screen (390, a link in): scroll the row to it, never the page
  const row = useRef<HTMLUListElement>(null);
  const first = [...on][0];
  useEffect(() => {
    const ul = row.current;
    const lit = first && ul?.querySelector<HTMLElement>(`[data-person="${first}"]`);
    if (!ul || !lit) return;
    const left = lit.offsetLeft - ul.offsetLeft;
    if (left < ul.scrollLeft || left + lit.offsetWidth > ul.scrollLeft + ul.clientWidth)
      ul.scrollTo({ left: left - 8, behavior: "smooth" });
  }, [first]);
  const label = (lit: boolean) =>
    cn(
      "text-[12px] leading-tight wrap-anywhere hyphens-auto",
      lit ? "font-semibold text-(--ui-ink)" : "text-(--ui-ink-2)",
    );
  return (
    <nav aria-label="Creators">
      <ul
        ref={row}
        className="-mx-1 m-0 flex list-none snap-x gap-1 overflow-x-auto overscroll-x-contain px-1 pb-1 [scrollbar-width:thin]"
      >
        <li>
          <a href={link(null)} aria-current={!on.size || undefined} className={item}>
            <span className={ring(!on.size)}>
              <span className="grid size-12 place-items-center rounded-full bg-(--ui-hover) text-(--ui-ink-2)">
                <Icon name="people" className="size-5 [stroke-width:1.8]" />
              </span>
            </span>
            <span className={label(!on.size)}>All</span>
          </a>
        </li>
        {people.map((p) => {
          const lit = on.has(String(p.id));
          const marks = [...new Set(p.accounts.map((a) => a.platform))];
          return (
            <li key={p.id} data-person={p.id}>
              <a
                href={link(lit && on.size === 1 ? null : String(p.id))}
                aria-current={lit || undefined}
                {...tipProps(
                  `${p.name}: ${platformsOf(p)}, ${num(p.n)} ${p.n === 1 ? "post" : "posts"}`,
                )}
                className={item}
              >
                <span className={ring(lit)}>
                  <Face name={p.name} src={p.src} size={48} />
                  <span className="absolute -right-0.5 -bottom-0.5 flex">
                    {marks.slice(0, 3).map((m) => (
                      <PlatformTile
                        key={m}
                        mark={m}
                        className="-ml-1 outline-2 outline-(--ui-paper) first:ml-0"
                      />
                    ))}
                  </span>
                </span>
                {/* the tip names the platforms and the count: the description */}
                <span className={label(lit)}>{p.name}</span>
              </a>
            </li>
          );
        })}
      </ul>
    </nav>
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

/** the gallery grid: 12 px across, 24 px down (D10) */
const GALLERY =
  "grid grid-cols-2 gap-x-3 gap-y-6 @min-[720px]/main:grid-cols-[repeat(auto-fill,minmax(200px,1fr))]";

/**
 * A gallery tile, Instagram's grid with YouTube's lines under it (D10): one frame, no wash. A hot
 * post outlines its frame and inks its multiple; hover zooms the picture.
 */
function Tile({
  r,
  canon,
  pick,
  open,
  inGroup,
  reach,
}: {
  r: FeedPost;
  canon: Canon;
  pick: PickState | null;
  open: string;
  /** under its creator's head: no creator line */
  inGroup: boolean;
  /** sorted by views per follower: show it */
  reach: boolean;
}) {
  const hot = (r.multiple ?? 0) >= HOT;
  const pic = usePicture(r);
  const clip = useHoverClip(pic.src ? r.videoSrc : null);
  const ago = age(r.postedAt);
  const words = r.title ?? r.text ?? `${kindName(r.kind)} by ${nameOf(r)}`;
  const perFol = reach ? perFollowerText(r) : null;
  // a text tile already shows its words in the frame
  const hook = pic.src ? hookOf(r) : null;
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
              "m-0 h-full overflow-hidden p-3 text-[13.5px] leading-[1.45] whitespace-pre-line wrap-anywhere text-(--ui-ink) [animation:ui-fade_.15s_both] [mask-image:linear-gradient(#000_75%,transparent)]",
              pick && "pr-9",
              canon && "pt-10",
            )}
          >
            {words}
          </p>
        )}
        {clip.src ? <HoverClip src={clip.src} live={clip.live} /> : null}
        {canon ? (
          // paper under the tint: it sits on a picture
          <span className="absolute top-2 left-2 rounded-(--ui-leaf-chip) bg-(--ui-paper)">
            <CanonTag canon={canon} />
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
                "text-[20px] leading-tight font-semibold tabular-nums",
                hot ? "text-(--ui-active)" : "text-(--ui-ink)",
              )}
            >
              {times(r.multiple)}
            </span>
            <span className="text-[12.5px] text-(--ui-ink-3)">{usualWords(r)}</span>
          </span>
        ) : (
          <span className="text-[12.5px] leading-[25px] text-(--ui-ink-3)">Not scored yet</span>
        )}
      </div>
      <CountRow
        r={r}
        only={["views", "likes", "comments"]}
        className="text-[12.5px] text-(--ui-ink-2)"
      />
      {perFol ? <p className="m-0 text-[12.5px] text-(--ui-ink-2) tabular-nums">{perFol}</p> : null}
      {/* the mark holds its own column: a long handle wraps beside it, never under it */}
      <p className="m-0 flex min-w-0 items-start gap-1.5 text-[12.5px] leading-snug text-(--ui-ink-2)">
        <Where platform={r.platform} />
        <span className="min-w-0 wrap-anywhere">
          {inGroup ? null : <>@{r.handle}</>}
          {ago ? (
            <span className="whitespace-nowrap text-(--ui-ink-3)">
              {inGroup ? "" : " · "}
              {ago}
            </span>
          ) : null}
        </span>
      </p>
      <OpenLink open={open} r={r} />
      {pick ? <PickCover r={r} pick={pick} /> : null}
    </article>
  );
}

/** skeletons in the gallery's shape */
function Ghosts() {
  return (
    <div role="status" className="grid gap-4">
      <span className="sr-only">Loading posts</span>
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

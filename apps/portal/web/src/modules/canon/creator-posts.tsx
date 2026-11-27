/**
 * Posts of his tracked creators as a gallery (studio-suite D8-D10): Canon › Outliers and Studio ›
 * Inspiration are this part with other defaults. A strip of creator faces sits on top (YouTube's
 * subscriptions bar); presets are tabs; Filter, Sort, Group and Select sit on the bar. The address
 * holds every pick: `preset`, `creator` (person ids), `platform`, `kind`, `niche` (comma lists),
 * `min`, `sort`, `group` (creator or platform), `format` (WA-1416 D5), `add` (the Add creator
 * sheet, WA-1416 D7), and `post`, the post open in the record panel (D9). Select files the
 * picked posts through the Add box's queue as his sources.
 */
import type {
  AddRow,
  FeedAsk,
  FeedPage,
  FeedPersonShown,
  FeedPost,
} from "@wren/research/canon-console";
import type { FeedFormat, FeedPreset, FeedSort } from "@wren/research/creators";
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
  LoadFailed,
  num,
  PickBar,
  PickList,
  PlatformTile,
  POP,
  Seg,
  tipProps,
  useFilterTools,
  useNarrow,
  useSeen,
  ViewStrip,
  type ViewTab,
} from "@wren/ui";
import { Popover, PopoverContent, PopoverTrigger } from "@wren/ui/components/ui/popover";
import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { call } from "../../api.js";
import { useCall } from "../../load.js";
import type { PageProps } from "../../module.js";
import { href, navigate } from "../../route.js";
import { AddCreator } from "./creator-add.js";
import { GALLERY, Ghosts, Tile } from "./gallery.js";
import { type OneSave, PostDetail } from "./post-detail.js";
import {
  type Canon,
  cn,
  Face,
  followersText,
  keyOf,
  kindName,
  nameOf,
  platformName,
  UsualRule,
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
/** YouTube's channel tabs (Videos, Shorts, Posts) over every platform */
const FORMATS: [FeedFormat | "", string][] = [
  ["", "All"],
  ["long", "Long-form"],
  ["short", "Shorts"],
  ["post", "Posts"],
];
type Group = "creator" | "platform";
const GROUPS: [Group | "", string, string][] = [
  ["", "No groups", "Group"],
  ["creator", "By creator, top 12 each", "By creator"],
  ["platform", "By platform, top 12 each", "By platform"],
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
  const group = GROUPS.find(([id]) => id && id === params.get("group"))?.[0] || null;
  const format = FORMATS.find(([id]) => id && id === params.get("format"))?.[0] || null;
  const ask: FeedAsk = {
    preset: preset as FeedPreset | null,
    people: listOf(params, "creator").map(Number).filter(Number.isFinite),
    platforms: listOf(params, "platform"),
    kinds: listOf(params, "kind"),
    format,
    niches: listOf(params, "niche"),
    min: min > 0 ? min : null,
    all: start.all,
    sort,
    group,
  };
  return { ask, preset, sort, group, format };
}

interface Save {
  busy: boolean;
  note: string | null;
  bad: boolean;
}

export function CreatorPosts({ params, start }: PageProps & { start: PostsStart }) {
  const { ask, preset, sort, group, format } = askOf(params, start);
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
  const { retry: feedAgain } = got;
  const adding = params.get("add");
  const addSheet = adding ? (
    <AddCreator
      at={adding}
      niche={listOf(params, "niche")[0] ?? null}
      go={(at) => go({ add: at })}
      onTracked={feedAgain}
    />
  ) : null;
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
      `${start.label}: ${presetName ?? start.first}, ${SORTS.find(([id]) => id === sort)?.[2].toLowerCase()}${format ? `, ${FORMATS.find(([id]) => id === format)?.[1].toLowerCase()} only` : ""}${group ? `, grouped by ${group}` : ""}`,
      ...on.map((f) => f.set?.say),
      data ? `${num(data.rows.length)} posts shown` : null,
    ]
      .filter(Boolean)
      .join("; "),
  });

  if (data && !data.creators)
    return (
      <>
        <Empty
          title="No creators tracked yet"
          action={
            <Button tone="primary" icon="plus" onClick={() => go({ add: "new" })}>
              Add creator
            </Button>
          }
        >
          Type a name or paste a profile link. The Mac finds their accounts and tracks them. A daily
          read stores their posts, and each post gets its multiple over their usual draw.
        </Empty>
        {addSheet}
      </>
    );
  if (data && !data.scored && !start.all)
    return (
      <>
        <Empty
          title={`${num(data.creators)} ${data.creators === 1 ? "creator" : "creators"} tracked`}
          waits
          action={<CopyButton text="wren creator refresh" label="Copy the command" />}
        >
          No post has a score yet. A post gets one once its creator has 5 read posts of its kind.
          The daily read runs it;{" "}
          <code className="font-mono text-[12.5px]">wren creator refresh</code> runs it now.
        </Empty>
        {addSheet}
      </>
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
  const filtered = !!preset || !!format || FILTERS.some((k) => params.has(k));
  const clearAll = link({
    preset: null,
    format: null,
    ...Object.fromEntries(FILTERS.map((k) => [k, null])),
  });
  const rows = data?.rows ?? [];
  const shownCreators = new Set(rows.map((r) => r.personId)).size;
  const personOf = (id: number) => data?.people.find((p) => p.id === id);
  const canonOf = (r: FeedPost): Canon => (r.record ? "in" : filed.has(keyOf(r)) ? "filing" : null);
  const openKey = params.get("post");
  const opened = openKey && data ? (rows.find((r) => keyOf(r) === openKey) ?? null) : undefined;

  const formatSeg = (
    <Seg
      label="Format"
      dense
      fill={narrow}
      items={FORMATS.map(([value, label]) => ({
        value,
        label,
        busy: value === (format ?? "") && got.placeholder,
      }))}
      value={format ?? ""}
      onChange={(v) => go({ format: v || null, post: null })}
    />
  );
  return (
    <div className={cn("flex flex-col gap-4", picking && "pb-28")}>
      {data?.people.length ? (
        <CreatorStrip
          people={data.people}
          on={new Set(listOf(params, "creator"))}
          link={(id) => link({ creator: id, group: null, post: null })}
          add={link({ add: "new", post: null })}
        />
      ) : null}
      {addSheet}
      <div className="grid gap-2">
        <ViewStrip tabs={tabs} more={[]} row="views:creator-posts" narrow={narrow} />
        {/* phone: four choices plus the tools pass 390, so the switch takes its own row */}
        {narrow ? formatSeg : null}
        <BarLayout
          narrow={narrow}
          shape={narrow ? undefined : formatSeg}
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
              <GroupTool group={group} go={(g) => go({ group: g })} />
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
            {(group ? sections(rows, group) : [rows]).map((part) => {
              const head = group ? part[0] : null;
              const list = (
                <ul
                  aria-label={
                    !head
                      ? start.label
                      : group === "platform"
                        ? `${platformName(head.platform)} posts`
                        : `${nameOf(head)}'s posts`
                  }
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
                          open={open}
                          inGroup={!!head}
                          reach={sort === "reach"}
                          cover={pick ? <PickCover r={r} pick={pick} /> : null}
                        />
                      </li>
                    );
                  })}
                </ul>
              );
              if (!head) return <div key="all">{list}</div>;
              const total = head.creatorPosts ?? part.length;
              const more =
                "justify-self-start text-[13px] font-semibold text-(--ui-ink-2) hover:text-(--ui-ink)";
              if (group === "platform")
                return (
                  <section
                    key={head.platform}
                    aria-label={platformName(head.platform)}
                    className="grid gap-3 [animation:ui-fade_.15s_both]"
                  >
                    <PlatformHead r={head} n={total} />
                    {list}
                    {total > part.length ? (
                      <a href={link({ platform: head.platform, group: null })} className={more}>
                        All {num(total)} posts on {platformName(head.platform)}
                      </a>
                    ) : null}
                  </section>
                );
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
                      className={more}
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

const MENU_ROW =
  "flex h-8 pointer-coarse:h-11 w-full cursor-pointer items-center gap-2 border-0 bg-transparent px-2 text-left text-[13px] text-(--ui-ink) hover:bg-(--ui-hover) aria-[current=true]:font-semibold";

/** Group: none, a section per creator, or one per platform */
function GroupTool({ group, go }: { group: Group | null; go: (g: Group | null) => void }) {
  const [open, setOpen] = useState(false);
  const label = GROUPS.find(([id]) => id === (group ?? ""))?.[2] ?? "Group";
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        className={chipClass(!!group)}
        {...tipProps(group ? `Grouped ${label.toLowerCase()}` : "Group the posts")}
      >
        <Icon
          name={group === "platform" ? "globe" : "people"}
          className="size-[15px] [stroke-width:1.8]"
        />
        <span data-hp>{label}</span>
      </PopoverTrigger>
      <PopoverContent aria-label="Group" align="end" className={cn(POP, "w-56 p-1")}>
        {GROUPS.map(([id, text]) => (
          <button
            key={id || "none"}
            type="button"
            aria-current={(group ?? "") === id}
            className={MENU_ROW}
            onClick={() => {
              go(id || null);
              setOpen(false);
            }}
          >
            <span className="flex-1">{text}</span>
            {(group ?? "") === id ? <Icon name="check" className="size-3.5" /> : null}
          </button>
        ))}
      </PopoverContent>
    </Popover>
  );
}

function SortTool({ sort, go }: { sort: Sort; go: (s: Sort) => void }) {
  const [open, setOpen] = useState(false);
  const row = MENU_ROW;
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

/** grouped rows, one list a creator person or a platform, in the server's order */
function sections(rows: FeedPost[], group: Group): FeedPost[][] {
  const by = new Map<string, FeedPost[]>();
  for (const r of rows) {
    const k = group === "platform" ? r.platform : String(r.personId);
    by.set(k, [...(by.get(k) ?? []), r]);
  }
  return [...by.values()];
}

/** a platform section's head: its mark, its name, how many */
function PlatformHead({ r, n }: { r: FeedPost; n: number }) {
  return (
    <header className="flex min-w-0 items-center gap-2.5">
      <PlatformTile mark={r.platform} />
      <h2 className="m-0 text-[15px] leading-snug font-semibold text-(--ui-ink)">
        {platformName(r.platform)}
      </h2>
      <span className="text-[13px] text-(--ui-ink-3)">
        {num(n)} {n === 1 ? "post" : "posts"}
      </span>
    </header>
  );
}

/** "YouTube, X" */
const platformsOf = (p: FeedPersonShown) =>
  [...new Set(p.accounts.map((a) => platformName(a.platform)))].join(", ");

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
      <Face src={person?.src ?? null} size={40} />
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
  add,
}: {
  people: FeedPersonShown[];
  on: Set<string>;
  link: (id: string | null) => string;
  /** the Add creator sheet */
  add: string;
}) {
  const item =
    "group/face flex w-[96px] shrink-0 snap-start flex-col items-center gap-1.5 rounded-[8px] py-1 text-center no-underline outline-offset-2 focus-visible:outline-2 focus-visible:outline-(--ui-focus)";
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
        <li>
          <a href={add} {...tipProps("Find a creator's accounts and track them")} className={item}>
            <span className={ring(false)}>
              <span className="grid size-12 place-items-center rounded-full border border-dashed border-(--ui-hair) text-(--ui-ink-2) group-hover/face:text-(--ui-ink)">
                <Icon name="plus" className="size-5 [stroke-width:1.8]" />
              </span>
            </span>
            <span className={label(false)}>Add</span>
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
                  <Face src={p.src} size={48} />
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

/**
 * A run's board under its picks (WA-1405, designs/2026-11-16-weaver-moodboard.md): each pattern
 * as its line, a count and its pages' thumbnails, then every other page it read as a poster wall
 * (the Outliers gallery, PT-6 and PT-51).
 */
import type { FeedPost } from "@wren/research/canon-console";
import { Button, cx, Img, Seg } from "@wren/ui";
import { useMemo, useState } from "react";
import { embedSite, youtubeId } from "../../embeds.js";
import { GALLERY_DENSE, Tile, Where } from "../canon/gallery.js";
import { atOf, usePicture } from "../canon/post-parts.js";
import type { BriefPattern, PageSignals, ReadPick, RunDocument, RunView } from "./serve.js";
import { host } from "./tree.js";

type Link = (p: Record<string, string | null>) => string;

/** A read page and its post; `pick` is the agent's read-list row. */
export interface BoardPage {
  s: PageSignals;
  d: RunDocument | undefined;
  r: FeedPost;
  pick: ReadPick | undefined;
}

/** The site a pick is on: a social platform's mark, else its host (the tile's mark reads hosts). */
function platformOf(url: string): string {
  if (youtubeId(url)) return "youtube";
  return embedSite(url) ?? host(url);
}

const SOCIAL = new Set(["x", "instagram", "tiktok"]);

/**
 * A pick as a gallery post (WA-1404): the page's picture (a video's poster), its counts, and its score
 * (the multiple over the creator's last n posts). Followers come back from views per follower.
 */
export function postOf(p: PageSignals, d: RunDocument | undefined): FeedPost {
  const platform = platformOf(p.url);
  const words = d?.title ?? p.title ?? null;
  const views = p.metrics?.views;
  const s = p.score;
  const who = p.channel ?? d?.channel ?? host(p.url);
  return {
    platform,
    ref: p.id,
    url: p.url,
    kind: d?.media === "video" ? "video" : "post",
    postedAt: d?.date ?? null,
    // a social post is its words; a page has a title
    title: SOCIAL.has(platform) ? null : words,
    text: SOCIAL.has(platform) ? words : null,
    creatorId: 0,
    personId: 0,
    person: who,
    handle: who,
    name: null,
    niches: [],
    followers: views !== undefined && s?.perFollower ? Math.round(views / s.perFollower) : null,
    counts: p.metrics ?? {},
    scoreCount: s?.count ?? null,
    multiple: s?.multiple ?? null,
    band: s?.band ?? null,
    // weaver's rank is a place among their posts, not the feed's top percent
    rank: null,
    likesMultiple: s?.likes?.multiple ?? null,
    likesBand: s?.likes?.band ?? null,
    likesRank: null,
    baselineN: s?.n ?? null,
    baseline: s?.base ?? null,
    likesBaseline: s?.likes?.base ?? null,
    creatorPosts: null,
    record: null,
    picture: null,
    pictureSmall: null,
    pictureLink: d?.image ?? null,
    video: null,
    src: d?.image ?? null,
    full: d?.image ?? null,
    // weaver keeps no playable file: the detail plays the post's own embed
    videoSrc: null,
  };
}

/** Every page the run read, picks first in rank order, by id. */
export function boardPages(view: RunView): Map<string, BoardPage> {
  const docs = new Map(view.documents.map((d) => [d.id, d]));
  const row = (s: PageSignals, pick?: ReadPick): BoardPage => ({
    s,
    d: docs.get(s.id),
    r: postOf(s, docs.get(s.id)),
    pick,
  });
  return new Map(
    [
      ...(view.brief.readList ?? []).map((p) => row(p, p)),
      ...(view.brief.unpicked ?? []).map((p) => row(p)),
    ].map((x) => [x.s.id, x]),
  );
}

/** the wall shows this many until asked; pictures load lazily */
const WALL_FIRST = 60;

type Sort = "score" | "likes" | "new";
const SORTS = [
  { value: "score", label: "Score" },
  { value: "likes", label: "Likes" },
  { value: "new", label: "Newest" },
] as const;

/** weaver's own order for `unpicked`: the multiple, then views per follower, then kept findings */
export const byScore = (a: PageSignals, b: PageSignals) =>
  (b.score?.multiple ?? 0) - (a.score?.multiple ?? 0) ||
  (b.score?.perFollower ?? 0) - (a.score?.perFollower ?? 0) ||
  b.kept - a.kept;
const byLikes = (a: PageSignals, b: PageSignals) =>
  (b.score?.likes?.multiple ?? 0) - (a.score?.likes?.multiple ?? 0) ||
  (b.metrics?.likes ?? 0) - (a.metrics?.likes ?? 0);
const at = (p: BoardPage) => (p.d?.date ? Date.parse(p.d.date) || 0 : 0);

/** A pattern's pages: the documents its findings sit on, picks first by rank, then by score. */
function patternPages(
  p: BriefPattern,
  view: RunView,
  pages: ReadonlyMap<string, BoardPage>,
): BoardPage[] {
  const on = new Set(p.findings);
  const ids = new Set(view.findings.filter((f) => on.has(f.id)).map((f) => f.document));
  const rank = (x: BoardPage) => (x.pick ? (x.pick.rank ?? 999) : 9999);
  return [...ids]
    .flatMap((id) => pages.get(id) ?? [])
    .sort((a, b) => rank(a) - rank(b) || byScore(a.s, b.s));
}

/** A square of a page: its picture, else its site's mark; a pick wears its rank. */
export function Thumb({ p, open, className }: { p: BoardPage; open: string; className?: string }) {
  const pic = usePicture(p.r);
  const rank = p.pick?.rank;
  const name = p.r.title ?? p.r.text ?? atOf(p.r);
  return (
    <a
      href={open}
      className={cx(
        "relative block overflow-hidden rounded-[4px_8px_4px_8px] bg-(--ui-hover) outline-offset-2 transition-[opacity] duration-150 ease-(--ui-ease) hover:opacity-85 focus-visible:outline-2 focus-visible:outline-(--ui-focus) motion-reduce:transition-none",
        className ?? "size-14",
      )}
    >
      {pic.src ? (
        <Img
          src={pic.src}
          alt=""
          loading="lazy"
          decoding="async"
          onError={pic.fail}
          className="block size-full object-cover"
        />
      ) : (
        <span className="grid size-full place-items-center">
          <Where platform={p.r.platform} />
        </span>
      )}
      {rank != null ? (
        <span className="absolute top-1 left-1 inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-(--ui-ink) px-1 text-[11.5px] font-semibold text-(--ui-paper) tabular-nums">
          {rank}
        </span>
      ) : null}
      <span className="sr-only">
        Open {rank != null ? `pick ${rank}: ` : ""}
        {name}
      </span>
    </a>
  );
}

/** Each pattern: its line whole, how many pages back it (picks among them), their thumbnails. */
export function Patterns({
  view,
  pages,
  link,
}: {
  view: RunView;
  pages: ReadonlyMap<string, BoardPage>;
  link: Link;
}) {
  const rows = (view.brief.patterns ?? [])
    .map((p) => ({ p, on: patternPages(p, view, pages) }))
    .filter((x) => x.on.length);
  if (!rows.length) return null;
  return (
    <section aria-labelledby="board-patterns" className="grid gap-3">
      <h3 id="board-patterns" className="m-0 text-[15px] font-semibold">
        Patterns <span className="font-normal text-(--ui-ink-3) tabular-nums">{rows.length}</span>
      </h3>
      <ul className="m-0 grid list-none gap-4 p-0 @min-[720px]/main:grid-cols-2 @min-[720px]/main:gap-x-8">
        {rows.map(({ p, on }) => {
          const picks = on.filter((x) => x.pick).length;
          return (
            <li key={p.id} className="grid min-w-0 content-start gap-2">
              <p className="m-0 text-[14.5px] leading-[1.4] font-medium wrap-anywhere">{p.text}</p>
              <p className="m-0 text-[12.5px] text-(--ui-ink-3) tabular-nums">
                Seen in {on.length} {on.length === 1 ? "page" : "pages"}
                {picks === on.length
                  ? on.length === 1
                    ? ", a pick"
                    : ", all picks"
                  : picks
                    ? `, ${picks} of them ${picks === 1 ? "a pick" : "picks"}`
                    : ""}
              </p>
              <ul aria-label="Its pages" className="m-0 flex list-none flex-wrap gap-1.5 p-0">
                {on.map((x) => (
                  <li key={x.s.id}>
                    <Thumb p={x} open={link({ open: `d:${x.s.id}` })} />
                  </li>
                ))}
              </ul>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** Every other page the run read, as the gallery's posters, best score first. */
export function Wall({ pages, link }: { pages: readonly BoardPage[]; link: Link }) {
  const [sort, setSort] = useState<Sort>("score");
  const [all, setAll] = useState(false);
  const shown = useMemo(
    () =>
      [...pages].sort(
        sort === "score"
          ? (a, b) => byScore(a.s, b.s)
          : sort === "likes"
            ? (a, b) => byLikes(a.s, b.s)
            : (a, b) => at(b) - at(a),
      ),
    [pages, sort],
  );
  if (!pages.length) return null;
  const cut = all ? shown : shown.slice(0, WALL_FIRST);
  return (
    <section aria-labelledby="board-wall" className="grid gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id="board-wall" className="m-0 text-[15px] font-semibold">
          Everything else it read{" "}
          <span className="font-normal text-(--ui-ink-3) tabular-nums">{pages.length}</span>
        </h3>
        <Seg label="Sort the pages" items={SORTS} value={sort} onChange={setSort} dense />
      </div>
      <ul aria-label="Pages read" className={cx("m-0 list-none p-0", GALLERY_DENSE)}>
        {cut.map((p) => (
          <li key={p.s.id} className="min-w-0 [animation:ui-fade_.15s_both]">
            <Tile r={p.r} canon={null} open={link({ open: `d:${p.s.id}` })} unscored={null} dense />
          </li>
        ))}
      </ul>
      {shown.length > cut.length ? (
        <Button className="justify-self-start" onClick={() => setAll(true)}>
          Show all {shown.length}
        </Button>
      ) : null}
    </section>
  );
}

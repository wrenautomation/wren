/**
 * Pieces (designs/2026-10-13-primitives-first.md): each thing William made, once, with where it
 * went under it. A long video carries its clips and promo posts. Approve all says yes to every
 * branch of a piece that waits. `Pieces/wren` through the console.
 */

import type { Branch, Piece, PieceKind } from "@wren/content/pieces";
import { PLATFORM_SPECS } from "@wren/content/write";
import {
  Button,
  ButtonLink,
  clipProps,
  cx,
  dateTip,
  Empty,
  Icon,
  Input,
  LoadFailed,
  Loading,
  PageHeader,
  PlatformMark,
  relative,
  Section,
  say,
  soon,
  Tag,
  type TagTone,
  tipProps,
} from "@wren/ui";
import { useState } from "react";
import { call } from "../../api.js";
import { type Load, useCall } from "../../load.js";
import type { PageProps } from "../../module.js";
import { href, navigate } from "../../route.js";
import { QUIET } from "../work/bits.js";
import {
  nextOut,
  PIECE_VIEWS,
  type PieceShow,
  type PieceSort,
  type PieceWhat,
  paramsOf,
  sayPieceShow,
  sayPieceView,
  sayPieceWhat,
  viewOf,
} from "./piece-views.js";

export type { Branch, Piece };

export const KIND_NAMES: Record<PieceKind, string> = {
  long: "Long video",
  vertical: "Clip",
  written: "Post",
  story: "Story",
  blog: "Blog post",
};
const KIND_MANY: Record<PieceKind, string> = {
  long: "Long videos",
  vertical: "Clips",
  written: "Posts",
  story: "Stories",
  blog: "Blog posts",
};
const FORMATS: Record<string, string> = {
  short: "Shorts",
  reel: "Reel",
  story: "Story",
  thread: "Thread",
  carousel: "Carousel",
};
const PLACES: Record<string, { name: string; mark: string }> = {
  site: { name: "The site", mark: "web" },
  email: { name: "Email", mark: "email" },
  editor: { name: "Editor", mark: "" },
  gbp: { name: "Business Profile", mark: "google" },
};

/** "YouTube Shorts", "Instagram Reel", "LinkedIn". */
export function branchName(b: Pick<Branch, "platform" | "format">): string {
  const place =
    PLACES[b.platform]?.name ??
    PLATFORM_SPECS[b.platform as keyof typeof PLATFORM_SPECS]?.name ??
    b.platform;
  const f = FORMATS[b.format];
  return f ? `${place} ${f}` : place;
}
const markOf = (platform: string) => PLACES[platform]?.mark ?? platform;

/** A draft, a failed send or a rendered recording waiting on him (`@wren/content/pieces`). */
const waits = (b: Branch) => b.state === "draft" || b.state === "failed" || b.state === "review";
export const waitingOf = (p: Pick<Piece, "branches">) => p.branches.filter(waits);
/** A piece's waiting branches and its children's. */
export const allWaiting = (p: Piece): Branch[] => [
  ...waitingOf(p),
  ...p.children.flatMap(allWaiting),
];

/** A branch's state in a few words, and its tone. */
export function stateOf(b: Branch, now = new Date()): { label: string; tone: TagTone } {
  switch (b.state) {
    case "draft":
      return { label: "Waiting on you", tone: "accent" };
    case "failed":
      return { label: "Failed", tone: "warn" };
    case "queued":
      if (b.waitingForBrowser) return { label: "Waiting for the browser", tone: "neutral" };
      return {
        label: b.at ? `Queued, ${soon(b.at, now) ?? "next slot"}` : "Queued, next slot",
        tone: "neutral",
      };
    case "publishing":
      return { label: "Posting now", tone: "neutral" };
    case "live":
      return { label: "Live", tone: "green" };
    case "editing":
      return { label: "In the editor", tone: "neutral" };
    case "review":
      return { label: "Ready to review", tone: "accent" };
    default:
      return { label: "Not yet", tone: "neutral" };
  }
}

/** What a live branch did: "23 views, 3 reactions", or when it went. */
function didOf(b: Branch): string | null {
  if (b.state !== "live") return null;
  const parts = [
    b.views != null ? `${b.views.toLocaleString("en-US")} views` : null,
    b.engaged ? `${b.engaged} engaged` : null,
  ].filter(Boolean);
  const when = b.at ? relative(new Date(b.at)) : null;
  return [parts.join(", "), when].filter(Boolean).join(" · ");
}

/** Where a branch opens in the portal: its draft, or the recording in Studio. */
function hrefOf(b: Branch): string | null {
  // A recording opens in Studio's editor.
  if (b.platform === "editor")
    return `/content/studio?video=${/^video:(\d+)/.exec(b.id)?.[1] ?? ""}`;
  if (b.id.startsWith("blog:")) return "/content/studio?make=blog";
  return `/content/drafts/${b.id}`;
}

export const pieces = () =>
  call<{ pieces: Piece[] }>("console/call", {
    service: "Pieces",
    handler: "list",
    key: "wren",
    input: {},
  });
export const usePieces = (): Load<{ pieces: Piece[] }> => useCall("pieces", pieces);

const ROW = "grid grid-cols-[1.25rem_minmax(0,1fr)_auto] items-center gap-x-3 py-2";

function BranchRow({ b }: { b: Branch }) {
  const s = stateOf(b);
  const did = didOf(b);
  const href = hrefOf(b);
  const mark = markOf(b.platform);
  return (
    <li className={cx(ROW, "border-(--ui-hair) border-t first:border-t-0")}>
      <span className="flex justify-center">
        {mark ? <PlatformMark mark={mark} size={15} /> : <Icon name="edit" />}
      </span>
      <div className="min-w-0">
        <span className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
          {href ? (
            <a
              className="font-medium text-[14px] text-(--ui-ink) no-underline hover:underline"
              href={href}
            >
              {branchName(b)}
            </a>
          ) : (
            <span className="font-medium text-[14px]">{branchName(b)}</span>
          )}
          <Tag tone={s.tone} dot>
            {s.label}
          </Tag>
          {did ? <span className={cx("text-[13px] tabular-nums", QUIET)}>{did}</span> : null}
        </span>
        {b.error ? <p className="m-0 mt-1 text-[13px] text-(--ui-bad)">{b.error}</p> : null}
      </div>
      {b.url ? (
        <a
          className={cx(
            "inline-flex items-center gap-1 text-[13px] no-underline hover:underline",
            QUIET,
          )}
          href={b.url}
          target="_blank"
          rel="noreferrer"
        >
          View <Icon name="external" />
        </a>
      ) : (
        <span />
      )}
    </li>
  );
}

/**
 * Yes on each waiting draft: each takes its platform's next slot. Wren's own desk, as the Drafts
 * page's Approve: `marketing/approveDraft` alone is a client's, and would land on its database.
 */
async function approveAll(ids: string[], done: () => void) {
  try {
    await call("console/call", {
      service: "ContentDesk",
      handler: "approve",
      key: "default",
      input: { ids },
    });
    say.done(
      ids.length > 1
        ? `Approved ${ids.length}. Each takes its next slot.`
        : "Approved. It takes its next slot.",
    );
    done();
  } catch (err) {
    say.failed(err);
  }
}

/** One piece: what it is, its words, every branch and its state, and its clips under it. */
export function PieceCard({
  piece,
  reload,
  nested = false,
}: {
  piece: Piece;
  reload: () => void;
  nested?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(!nested && piece.children.length <= 3);
  // Drafts only: a failed one needs a look first, not a blind yes; a rendered cut needs one look
  // in Studio, so it gets a Review link instead.
  const ready = piece.branches
    .filter((b) => b.state === "draft" && b.platform !== "editor")
    .map((b) => b.id);
  const review = piece.branches.find((b) => b.state === "review" && b.platform === "editor");
  const live = piece.branches.filter((b) => b.state === "live").length;
  return (
    <article
      className={cx(
        "border border-(--ui-hair) bg-(--ui-bg)",
        nested
          ? "rounded-none border-x-0 border-b-0 px-0 pt-3"
          : "rounded-(--ui-radius-panel) px-4 pt-3.5 pb-2",
      )}
    >
      <header className="flex flex-wrap items-start gap-x-3 gap-y-2">
        <div className="min-w-0 flex-1">
          <p className={cx("m-0 text-[12.5px] font-medium", QUIET)}>
            {KIND_NAMES[piece.kind]}
            {piece.branches.length > 1
              ? ` · ${piece.branches.length} places${live ? `, ${live} live` : ""}`
              : ""}
          </p>
          <h3 className="m-0 mt-0.5 text-[15.5px] font-semibold [text-wrap:pretty]">
            {piece.title || "Untitled"}
          </h3>
          {piece.text && piece.text.trim() !== piece.title ? (
            <p className={cx("m-0 mt-1 line-clamp-2 max-w-[70ch] text-[13.5px]", QUIET)}>
              {piece.text}
            </p>
          ) : null}
        </div>
        {review ? (
          <ButtonLink size="dense" tone="primary" href={hrefOf(review) ?? undefined}>
            Review
          </ButtonLink>
        ) : null}
        {ready.length ? (
          <Button
            size="dense"
            tone="primary"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              await approveAll(ready, reload);
              setBusy(false);
            }}
          >
            {ready.length > 1 ? `Approve all ${ready.length}` : "Approve"}
          </Button>
        ) : null}
      </header>
      {piece.branches.length ? (
        <ul className="m-0 mt-2.5 list-none p-0">
          {piece.branches.map((b) => (
            <BranchRow key={b.id} b={b} />
          ))}
        </ul>
      ) : (
        <p className={cx("m-0 my-2.5 text-[13.5px]", QUIET)}>
          No drafts yet. The planner writes them.
        </p>
      )}
      {piece.children.length ? (
        <div className="mt-1 border-(--ui-hair) border-t pt-2 pb-1">
          <button
            type="button"
            className={cx(
              "flex items-center gap-1.5 bg-transparent p-0 text-[13px] font-semibold",
              QUIET,
            )}
            onClick={() => setOpen((o) => !o)}
            aria-expanded={open}
          >
            <Icon name={open ? "down" : "right"} />
            {childLine(piece.children)}
          </button>
          {open ? (
            <div className="mt-1 border-(--ui-hair) border-l pl-4">
              {piece.children.map((c) => (
                <PieceCard key={c.id} piece={c} reload={reload} nested />
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}

/** "3 clips, 2 posts from it, 1 waiting on you". */
function childLine(children: Piece[]): string {
  const by = new Map<PieceKind, number>();
  for (const c of children) by.set(c.kind, (by.get(c.kind) ?? 0) + 1);
  const parts = [...by].map(
    ([k, n]) => `${n} ${(n > 1 ? KIND_MANY[k] : KIND_NAMES[k]).toLowerCase()}`,
  );
  const waiting = children.flatMap(allWaiting).length;
  return `${parts.join(", ")} from it${waiting ? `, ${waiting} waiting on you` : ""}`;
}

type Show = PieceShow;
const SHOWS: Record<Show, string> = {
  all: "Any state",
  waiting: "Waiting on you",
  queued: "Queued",
  live: "Live",
};
const branchesIn = (p: Piece): Branch[] => [...p.branches, ...p.children.flatMap(branchesIn)];
const shows = (p: Piece, s: Show): boolean =>
  s === "all" ||
  branchesIn(p).some((b) =>
    s === "waiting" ? waits(b) : s === "queued" ? b.state === "queued" : b.state === "live",
  );
const onPlatform = (p: Piece, place: string): boolean =>
  branchesIn(p).some((b) => b.platform === place);

/**
 * What a piece is, as he looks for it: a carousel or a thread is a format on a post's branch,
 * so it's found by its branches; the rest by the piece's kind.
 */
type What = Exclude<PieceWhat, "all">;
const WHATS: { id: What; name: string; is: (p: Piece) => boolean }[] = [
  { id: "long", name: "Long videos", is: (p) => p.kind === "long" },
  { id: "clip", name: "Clips", is: (p) => p.kind === "vertical" },
  {
    id: "post",
    name: "Posts",
    is: (p) => p.kind === "written" && p.branches.some((b) => b.format === "post"),
  },
  { id: "thread", name: "Threads", is: (p) => p.branches.some((b) => b.format === "thread") },
  { id: "carousel", name: "Carousels", is: (p) => p.branches.some((b) => b.format === "carousel") },
  {
    id: "story",
    name: "Stories",
    is: (p) => p.kind === "story" || p.branches.some((b) => b.format === "story"),
  },
  { id: "blog", name: "Blog posts", is: (p) => p.kind === "blog" },
];
/** Every piece, a long video's clips and promos beside it: a carousel made from a video counts. */
const everyPiece = (ps: Piece[]): Piece[] => ps.flatMap((p) => [p, ...everyPiece(p.children)]);

type Sort = PieceSort;
const SORTS: Record<Sort, string> = {
  new: "Newest first",
  waiting: "Waiting on you first",
  views: "Most views first",
  soon: "Going out soonest first",
};
const viewsOf = (p: Piece) => branchesIn(p).reduce((n, b) => n + (b.views ?? 0), 0);
/** Soonest first among what is set to go out; pieces with nothing queued follow, newest first. */
const bySoon = (a: Piece, b: Piece): number => {
  const x = nextOut(a);
  const y = nextOut(b);
  return x && y ? x.localeCompare(y) : x ? -1 : y ? 1 : b.at.localeCompare(a.at);
};
const sorted = (ps: Piece[], by: Sort): Piece[] =>
  by === "new"
    ? ps
    : [...ps].sort((a, b) =>
        by === "views"
          ? viewsOf(b) - viewsOf(a)
          : by === "soon"
            ? bySoon(a, b)
            : allWaiting(b).length - allWaiting(a).length || b.at.localeCompare(a.at),
      );
const found = (p: Piece, q: string): boolean =>
  !q || `${p.title}\n${p.text}`.toLowerCase().includes(q) || p.children.some((c) => found(c, q));

const CHIP =
  "inline-flex h-8 items-center gap-1.5 rounded-(--ui-radius) border border-(--ui-hair) bg-transparent px-3 text-[13px] text-(--ui-ink-2) transition-colors duration-150 hover:bg-(--ui-hover)";
const CHIP_ON = "border-(--ui-ink) text-(--ui-ink) font-semibold";
const COUNT = "text-[12px] tabular-nums text-(--ui-ink-3)";
const ROW_LABEL = "w-14 shrink-0 text-[12.5px] font-medium text-(--ui-ink-3)";

/** A row of chips under a label: one picked, a count beside each. */
function Chips<T extends string>({
  label,
  options,
  value,
  set,
}: {
  label: string;
  options: { id: T; name: string; n?: number; mark?: string; tip?: string }[];
  value: T;
  set: (v: T) => void;
}) {
  return (
    <fieldset className="m-0 flex min-w-0 items-start gap-2 border-0 p-0">
      <legend className="sr-only">{label}</legend>
      <span className={cx(ROW_LABEL, "pt-1.5")} aria-hidden>
        {label}
      </span>
      <div className="flex min-w-0 flex-wrap gap-1.5">
        {options.map((o) => (
          <button
            key={o.id}
            type="button"
            aria-pressed={value === o.id}
            {...tipProps(o.tip)}
            className={cx(CHIP, value === o.id && CHIP_ON)}
            onClick={() => set(o.id)}
          >
            {o.mark ? <PlatformMark mark={o.mark} size={13} /> : null}
            {o.name}
            {o.n !== undefined ? <span className={COUNT}>{o.n}</span> : null}
          </button>
        ))}
      </div>
    </fieldset>
  );
}

/**
 * Marketing → Pieces: every piece, found by words, what it is, where it went and its state, in
 * the order he picks. The picks live in the address, so a link or a reload keeps them.
 */
export function PiecesPage(props: PageProps) {
  const load = usePieces();
  const what = (WHATS.find((w) => w.id === props.params.get("what"))?.id ?? "all") as What | "all";
  const show = (
    (props.params.get("show") as Show) in SHOWS ? props.params.get("show") : "all"
  ) as Show;
  const place = props.params.get("platform") ?? "";
  const sort = (
    (props.params.get("sort") as Sort) in SORTS ? props.params.get("sort") : "new"
  ) as Sort;
  const [q, setQ] = useState(props.params.get("q") ?? "");
  const set = (k: string, v: string) =>
    navigate(
      href("/content/pieces", { [k]: v === "all" || v === "new" ? "" : v }, props.params),
      true,
    );

  const view = viewOf(what, show, sort);
  const all = load.data?.pieces ?? [];
  const every = everyPiece(all);
  const words = q.trim().toLowerCase();
  // A kind inside a long video (a carousel, a thread) lists on its own; the rest list as made.
  const pool = what === "all" || what === "long" ? all : every;
  const fits = (p: Piece, skip?: "what" | "show" | "place") =>
    (skip === "what" || what === "all" || (WHATS.find((w) => w.id === what)?.is(p) ?? true)) &&
    (skip === "show" || shows(p, show)) &&
    (skip === "place" || !place || onPlatform(p, place)) &&
    found(p, words);
  const shown = sorted(
    pool.filter((p) => fits(p)),
    sort,
  );
  const whats = WHATS.map((w) => ({
    id: w.id,
    name: w.name,
    tip: sayPieceWhat(w.id),
    n: (w.id === "long" ? all : every).filter((p) => w.is(p) && fits(p, "what")).length,
  })).filter((w) => w.n > 0 || w.id === what);
  const inView = (v: (typeof PIECE_VIEWS)[number]) => {
    const w = WHATS.find((x) => x.id === v.what);
    return (v.what === "long" ? all : every).filter(
      (p) =>
        (!w || w.is(p)) && shows(p, v.show) && (!place || onPlatform(p, place)) && found(p, words),
    ).length;
  };
  const places = [...new Set(every.flatMap((p) => p.branches.map((b) => b.platform)))]
    .filter((p) => p !== "editor")
    .sort()
    .map((p) => ({
      id: p,
      name: branchName({ platform: p, format: "" }),
      mark: markOf(p),
      n: pool.filter((x) => onPlatform(x, p) && fits(x, "place")).length,
    }));
  const waiting = all.flatMap(allWaiting).length;
  return (
    <>
      <PageHeader
        title="Pieces"
        lede={
          load.data
            ? `${all.length} pieces in the last 120 days${waiting ? `, ${waiting} drafts waiting on you` : ""}. Each shows everywhere it went.`
            : "Everything you made, each with everywhere it went."
        }
        actions={
          <a href="/content/studio" className="text-[13.5px]">
            Make something
          </a>
        }
      />
      <div className="mb-5 grid gap-2.5">
        <Chips
          label="View"
          value={view?.id ?? ""}
          set={(id) => {
            const v = PIECE_VIEWS.find((x) => x.id === id);
            if (v) navigate(href("/content/pieces", paramsOf(v), props.params), true);
          }}
          options={PIECE_VIEWS.map((v) => ({
            id: v.id,
            name: v.name,
            tip: sayPieceView(v),
            ...(v.id === "all" ? {} : load.data ? { n: inView(v) } : {}),
          }))}
        />
        <div className="flex flex-wrap items-center gap-2">
          <Input
            // edit-ok: search box
            aria-label="Find a piece"
            type="search"
            value={q}
            placeholder="Find by its words"
            className="h-8 min-w-0 flex-1 basis-60 text-[13.5px]"
            onChange={(e) => {
              setQ(e.target.value);
              set("q", e.target.value.trim());
            }}
          />
          <select
            aria-label="Sort"
            className="h-8 rounded-(--ui-radius) border border-(--ui-hair) bg-(--ui-bg) px-2 text-[13px]"
            value={sort}
            onChange={(e) => set("sort", e.target.value)}
          >
            {(Object.keys(SORTS) as Sort[]).map((s) => (
              <option key={s} value={s}>
                {SORTS[s]}
              </option>
            ))}
          </select>
        </div>
        <Chips
          label="What"
          value={what}
          set={(v) => set("what", v)}
          options={[
            {
              id: "all",
              name: "Everything",
              tip: sayPieceWhat("all"),
              n: all.filter((p) => fits(p, "what")).length,
            },
            ...whats,
          ]}
        />
        {places.length > 1 ? (
          <Chips
            label="Where"
            value={place || "all"}
            set={(v) => set("platform", v)}
            options={[
              { id: "all", name: "Anywhere", tip: "Pieces that went anywhere" },
              ...places.map((p) => ({ ...p, tip: `Pieces that went to ${p.name}` })),
            ]}
          />
        ) : null}
        <Chips
          label="State"
          value={show}
          set={(v) => set("show", v)}
          options={(Object.keys(SHOWS) as Show[]).map((s) => ({
            id: s,
            name: SHOWS[s],
            tip: sayPieceShow(s),
            ...(s === "all"
              ? {}
              : { n: pool.filter((p) => shows(p, s) && fits(p, "show")).length }),
          }))}
        />
      </div>
      {load.error && !load.data ? (
        <LoadFailed error={load.error} onRetry={load.retry} />
      ) : !load.data ? (
        <Loading lines={8} />
      ) : !shown.length ? (
        <Empty>
          {all.length ? (
            <>
              Nothing fits these.{" "}
              {what === "carousel" ? (
                <a href="/content/studio?make=carousel">Make a carousel</a>
              ) : null}
            </>
          ) : (
            "Pieces show here once you make one."
          )}
        </Empty>
      ) : (
        <section className="grid grid-cols-1 gap-3">
          {/* The cards' titles are h3: this keeps the heading order whole for a screen reader. */}
          <h2 className="sr-only">Your pieces</h2>
          {shown.map((p) => (
            <PieceCard key={p.id} piece={p} reload={load.retry} />
          ))}
        </section>
      )}
    </>
  );
}

/** A thing the system did: a branch going live, failing, or getting set for a time. */
export interface Happening {
  at: string;
  branch: Branch;
  piece: Piece;
}

/** The last `days` days of what went out, failed or got queued, newest first. */
export function happenings(all: Piece[], days = 7, now = Date.now()): Happening[] {
  const since = new Date(now - days * 86_400_000).toISOString();
  const out: Happening[] = [];
  const walk = (p: Piece) => {
    for (const b of p.branches)
      if ((b.state === "live" || b.state === "publishing") && b.at && b.at >= since)
        out.push({ at: b.at, branch: b, piece: p });
      else if (b.state === "failed") out.push({ at: p.at, branch: b, piece: p });
    p.children.forEach(walk);
  };
  all.forEach(walk);
  return out.sort((a, b) => b.at.localeCompare(a.at));
}

/** What happened: the newest few things the system did with his pieces. */
export function WhatHappened({ items, limit = 8 }: { items: Happening[]; limit?: number }) {
  const [more, setMore] = useState(false);
  const shown = more ? items : items.slice(0, limit);
  return (
    <Section title="What happened" note="The last 7 days">
      {items.length ? (
        <ul className="-my-1 m-0 list-none p-0">
          {shown.map(({ at, branch: b, piece: p }) => {
            return (
              <li key={b.id} className={cx(ROW, "border-(--ui-hair) border-t first:border-t-0")}>
                <span className="flex justify-center">
                  {markOf(b.platform) ? (
                    <PlatformMark mark={markOf(b.platform)} size={15} />
                  ) : (
                    <Icon name="edit" />
                  )}
                </span>
                <p className="m-0 min-w-0 truncate text-[14px]" {...clipProps()}>
                  <span className={cx(b.state === "failed" ? "text-(--ui-bad)" : "")}>
                    {b.state === "failed" ? "Failed on" : "Went live on"} {branchName(b)}:
                  </span>{" "}
                  <span className="font-medium">{p.title}</span>
                  {b.state === "live" && b.views != null ? (
                    <span className={QUIET}> · {b.views.toLocaleString("en-US")} views</span>
                  ) : null}
                </p>
                <span className={cx("text-[13px] tabular-nums", QUIET)} {...dateTip(new Date(at))}>
                  {relative(new Date(at))}
                </span>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className={cx("m-0 text-[14px]", QUIET)}>Nothing went out in the last 7 days.</p>
      )}
      {items.length > limit ? (
        <button
          type="button"
          className={cx("mt-2 bg-transparent p-0 text-[13px] underline", QUIET)}
          onClick={() => setMore((m) => !m)}
        >
          {more ? "Fewer" : `All ${items.length}`}
        </button>
      ) : null}
    </Section>
  );
}

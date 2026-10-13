/**
 * Pieces (designs/2026-10-13-primitives-first.md): each thing William made, once, with where it
 * went under it. A long video carries its clips and promo posts. Approve all says yes to every
 * branch of a piece that waits. `Pieces/wren` through the console.
 */

import type { Branch, Piece, PieceKind } from "@wren/content/pieces";
import { PLATFORM_SPECS } from "@wren/content/write";
import {
  Button,
  cx,
  Empty,
  Icon,
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
} from "@wren/ui";
import { useState } from "react";
import { call } from "../../api.js";
import { type Load, useCall } from "../../load.js";
import type { PageProps } from "../../module.js";
import { QUIET } from "../work/bits.js";

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

export const waitingOf = (p: Pick<Piece, "branches">) =>
  p.branches.filter((b) => b.state === "draft" || b.state === "failed");
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

/** Where a branch opens in the portal: its draft, or the recording in Videos. */
function hrefOf(b: Branch): string | null {
  if (b.platform === "editor") return `/marketing/videos/${b.id.slice("video:".length)}`;
  if (b.id.startsWith("blog:")) return "/marketing/write?blog=1";
  return `/marketing/drafts/${b.id}`;
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

/** Yes on each waiting draft: each takes its platform's next slot. */
async function approveAll(ids: string[], done: () => void) {
  try {
    await call("marketing/approveDraft", { ids });
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
  // Drafts only: a failed one needs a look first, not a blind yes.
  const ready = piece.branches.filter((b) => b.state === "draft").map((b) => b.id);
  const live = piece.branches.filter((b) => b.state === "live").length;
  return (
    <article
      className={cx(
        "border border-(--ui-hair) bg-(--ui-bg)",
        nested ? "border-x-0 border-b-0 px-0 pt-3" : "rounded-(--ui-radius) px-4 pt-3.5 pb-2",
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

const KIND_ORDER: PieceKind[] = ["long", "vertical", "written", "story", "blog"];
type Show = "all" | "waiting" | "queued" | "live";
const SHOWS: Record<Show, string> = {
  all: "All",
  waiting: "Waiting on you",
  queued: "Queued",
  live: "Live",
};
const shows = (p: Piece, s: Show): boolean =>
  s === "all" ||
  [...p.branches, ...p.children.flatMap((c) => c.branches)].some((b) =>
    s === "waiting"
      ? b.state === "draft" || b.state === "failed"
      : s === "queued"
        ? b.state === "queued"
        : b.state === "live",
  );
const placesOf = (ps: Piece[]) =>
  [
    ...new Set(
      ps
        .flatMap((p) => [...p.branches, ...p.children.flatMap((c) => c.branches)])
        .map((b) => b.platform),
    ),
  ]
    .filter((p) => p !== "editor")
    .sort();
const onPlatform = (p: Piece, place: string): boolean =>
  p.branches.some((b) => b.platform === place) || p.children.some((c) => onPlatform(c, place));

const CHIP =
  "h-8 rounded-(--ui-radius) border border-(--ui-hair) bg-transparent px-3 text-[13px] text-(--ui-ink-2) transition-colors duration-150 hover:bg-(--ui-hover)";
const CHIP_ON = "border-(--ui-ink) text-(--ui-ink) font-semibold";

/** Marketing → Pieces: every piece, newest first, narrowed by kind, state or platform. */
export function PiecesPage(props: PageProps) {
  const load = usePieces();
  const [kind, setKind] = useState<PieceKind | "all">(
    (props.params.get("kind") as PieceKind) ?? "all",
  );
  const [show, setShow] = useState<Show>((props.params.get("show") as Show) ?? "all");
  const [place, setPlace] = useState(props.params.get("platform") ?? "");
  const all = load.data?.pieces ?? [];
  const kinds = KIND_ORDER.filter((k) => all.some((p) => p.kind === k));
  const shown = all.filter(
    (p) =>
      (kind === "all" || p.kind === kind) && shows(p, show) && (!place || onPlatform(p, place)),
  );
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
      />
      <div className="mb-5 flex flex-wrap items-center gap-2">
        {(["all", ...kinds] as const).map((k) => (
          <button
            key={k}
            type="button"
            className={cx(CHIP, kind === k && CHIP_ON)}
            onClick={() => setKind(k)}
          >
            {k === "all" ? "Every kind" : KIND_MANY[k]}
          </button>
        ))}
        <span className="mx-1 h-5 w-px bg-(--ui-hair)" aria-hidden />
        {(Object.keys(SHOWS) as Show[]).map((s) => (
          <button
            key={s}
            type="button"
            className={cx(CHIP, show === s && CHIP_ON)}
            onClick={() => setShow(s)}
          >
            {SHOWS[s]}
          </button>
        ))}
        <select
          aria-label="Platform"
          className="ml-auto h-8 rounded-(--ui-radius) border border-(--ui-hair) bg-(--ui-bg) px-2 text-[13px]"
          value={place}
          onChange={(e) => setPlace(e.target.value)}
        >
          <option value="">Every platform</option>
          {placesOf(all).map((p) => (
            <option key={p} value={p}>
              {branchName({ platform: p, format: "" })}
            </option>
          ))}
        </select>
      </div>
      {load.error && !load.data ? (
        <LoadFailed error={load.error} onRetry={load.retry} />
      ) : !load.data ? (
        <Loading lines={8} />
      ) : !shown.length ? (
        <Empty>{all.length ? "No piece fits these." : "Pieces show here once you make one."}</Empty>
      ) : (
        <div className="grid gap-3">
          {shown.map((p) => (
            <PieceCard key={p.id} piece={p} reload={load.retry} />
          ))}
        </div>
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
            const s = stateOf(b);
            return (
              <li key={b.id} className={cx(ROW, "border-(--ui-hair) border-t first:border-t-0")}>
                <span className="flex justify-center">
                  {markOf(b.platform) ? (
                    <PlatformMark mark={markOf(b.platform)} size={15} />
                  ) : (
                    <Icon name="edit" />
                  )}
                </span>
                <p className="m-0 min-w-0 truncate text-[14px]">
                  <span className={cx(b.state === "failed" ? "text-(--ui-bad)" : "")}>
                    {b.state === "failed" ? "Failed on" : "Went live on"} {branchName(b)}:
                  </span>{" "}
                  <span className="font-medium">{p.title}</span>
                  {b.state === "live" && b.views != null ? (
                    <span className={QUIET}> · {b.views.toLocaleString("en-US")} views</span>
                  ) : null}
                </p>
                <span className={cx("text-[13px] tabular-nums", QUIET)} title={s.label}>
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

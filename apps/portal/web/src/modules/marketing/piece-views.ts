/**
 * Marketing → Pieces' built-in views: one press sets what, state and order together, so the
 * usual looks (what waits on him, what is scheduled, the carousels) are a click, not three.
 * The address still holds each pick; a view is only the picks that match. No React.
 */

export type PieceWhat = "all" | "long" | "clip" | "post" | "thread" | "carousel" | "story" | "blog";
export type PieceShow = "all" | "waiting" | "queued" | "live";
export type PieceSort = "new" | "waiting" | "views" | "soon";

export interface PieceView {
  id: string;
  name: string;
  what: PieceWhat;
  show: PieceShow;
  sort: PieceSort;
  /** Its hover, when the read-out of what, state and sort says it worse than a sentence. */
  hint?: string;
}

export const PIECE_VIEWS: readonly PieceView[] = [
  { id: "all", name: "Everything", what: "all", show: "all", sort: "new" },
  { id: "waiting", name: "Waiting on you", what: "all", show: "waiting", sort: "waiting" },
  { id: "scheduled", name: "Scheduled", what: "all", show: "queued", sort: "soon" },
  { id: "carousels", name: "Carousels", what: "carousel", show: "all", sort: "new" },
  { id: "videos", name: "Long videos", what: "long", show: "all", sort: "new" },
  { id: "clips", name: "Clips", what: "clip", show: "all", sort: "new" },
  { id: "written", name: "Written posts", what: "post", show: "all", sort: "new" },
  { id: "posted", name: "Posted", what: "all", show: "live", sort: "new" },
  { id: "best", name: "Best", what: "all", show: "live", sort: "views" },
];

/** The view the address's picks add up to, if any; a mix of picks no view names is none. */
export function viewOf(what: string, show: string, sort: string): PieceView | null {
  return PIECE_VIEWS.find((v) => v.what === what && v.show === show && v.sort === sort) ?? null;
}

/**
 * The address params a view sets. Blank is the default, which `href` leaves out. Where it went
 * (`platform`) is cleared, so a view shows all of its own; the search words stay.
 */
export function paramsOf(v: PieceView): Record<"what" | "show" | "sort" | "platform", string> {
  return {
    what: v.what === "all" ? "" : v.what,
    show: v.show === "all" ? "" : v.show,
    sort: v.sort === "new" ? "" : v.sort,
    platform: "",
  };
}

/** The soonest moment a piece (or a child of it) is set to go out, or null when none is queued. */
export function nextOut(p: {
  branches: { state: string; at: string | null }[];
  children: unknown[];
}): string | null {
  let soon: string | null = null;
  const walk = (x: typeof p) => {
    for (const b of x.branches)
      if (b.state === "queued" && b.at && (soon === null || b.at < soon)) soon = b.at;
    for (const c of x.children) walk(c as typeof p);
  };
  walk(p);
  return soon;
}

const WHAT_ABOUT: Record<PieceWhat, string> = {
  all: "Every piece, whatever it is",
  long: "Long videos, their clips and posts under them",
  clip: "Vertical clips: Shorts and Reels",
  post: "Written posts",
  thread: "Posts that run as a thread",
  carousel: "Posts of swipeable slides, inside a long video too",
  story: "Stories",
  blog: "Blog posts on the site",
};
const SHOW_ABOUT: Record<PieceShow, string> = {
  all: "In any state",
  waiting: "A draft, a failed send or a cut to review, waiting on you",
  queued: "Approved and set for a time",
  live: "Out on at least one platform",
};
const SORT_ABOUT: Record<PieceSort, string> = {
  new: "newest first",
  waiting: "waiting on you first",
  views: "most views first",
  soon: "soonest to go out first",
};

/** What a kind chip finds, in words. */
export const sayPieceWhat = (what: PieceWhat): string => WHAT_ABOUT[what];
/** What a state chip finds, in words. */
export const sayPieceShow = (show: PieceShow): string => SHOW_ABOUT[show];

/** What a view finds, for its hover: its `hint`, else its kind, state and order read out. */
export function sayPieceView(v: Pick<PieceView, "what" | "show" | "sort" | "hint">): string {
  if (v.hint) return v.hint;
  const kind =
    v.what === "all" ? (v.show === "all" ? "Every piece" : "Pieces") : WHAT_ABOUT[v.what];
  const state = v.show === "all" ? "" : ` · ${SHOW_ABOUT[v.show]}`;
  return `${kind}${state} · Sort: ${SORT_ABOUT[v.sort]}`;
}

/**
 * What Studio's parts share: the kinds it makes, the platforms its words go to, the read of the
 * drafts that wait, and the small words and times its rows say. One place, so the due cards, the
 * New row, the compose view and the waiting table never keep their own copies.
 */
import { PLATFORM_SPECS } from "@wren/content/write";
import { PLATFORMS, type Platform } from "@wren/core/content";
import { THREAD_MAX, THREAD_MIN } from "@wren/core/content/thread";
import type { IconName } from "@wren/ui";
import { ApiError } from "../../api.js";
import { contentDesk } from "./desk.js";

/** The platforms that post words alone (YouTube as a community post); videos start from a recording. */
export const TEXT = PLATFORMS.filter(
  (p) => !PLATFORM_SPECS[p].needsMedia || PLATFORM_SPECS[p].words,
);
export const nameOf = (p: Platform) => PLATFORM_SPECS[p].name;
/** What a post is there: "YouTube post" for YouTube. */
export const targetOf = (p: Platform) => PLATFORM_SPECS[p].words?.name ?? nameOf(p);

/**
 * What a post is about (`?from=video:<id>`, Studio's "Write a post about it"): it hangs under that
 * video in Pieces. `?about=` carries the title for the line that says so.
 */
export const fromOf = (
  params: URLSearchParams,
): { from: string; id: string; title: string } | null => {
  const id = /^video:(\d+)$/.exec(params.get("from") ?? "")?.[1];
  return id ? { from: `video:${id}`, id, title: params.get("about") || `Video ${id}` } : null;
};

/** The platform chip on top (`?platform=`), when it's one Wren posts to. */
export const chosen = (params: URLSearchParams): Platform | null => {
  const p = params.get("platform");
  return PLATFORMS.find((x) => x === p) ?? null;
};

export type Make = "post" | "thread" | "carousel" | "story" | "blog" | "video";
export interface MakeKind {
  id: Make;
  name: string;
  /** Where it goes, in a few words. */
  where: string;
  mark: IconName;
  /** Whether it goes to this platform. */
  on: (p: Platform) => boolean;
}

/** What Studio makes, in the order he reaches for them. */
export const MAKES: readonly MakeKind[] = [
  {
    id: "post",
    name: "Post",
    where: "One, or a batch",
    mark: "note",
    on: (p) => TEXT.includes(p),
  },
  {
    id: "thread",
    name: "Thread",
    where: `X, ${THREAD_MIN} to ${THREAD_MAX} posts`,
    mark: "list",
    on: (p) => p === "x",
  },
  {
    id: "carousel",
    name: "Carousel",
    where: "Instagram, LinkedIn",
    mark: "boxes",
    on: (p) => p === "instagram" || p === "linkedin",
  },
  {
    id: "story",
    name: "Story",
    where: "Instagram, Facebook",
    mark: "phone",
    on: (p) => p === "instagram" || p === "facebook",
  },
  { id: "blog", name: "Blog post", where: "The site, then email", mark: "doc", on: () => false },
  {
    id: "video",
    name: "Video",
    where: "From a recording",
    mark: "play",
    on: (p) => !!PLATFORM_SPECS[p].needsMedia,
  },
];
export const makeKind = (id: Make): MakeKind =>
  MAKES.find((m) => m.id === id) ?? {
    id: "post",
    name: "Post",
    where: "",
    mark: "note",
    on: () => false,
  };
export const offeredFor = (only: Platform | null) => MAKES.filter((m) => !only || m.on(only));
export const makeOf = (params: URLSearchParams): Make | null => {
  const m = params.get("make");
  if (MAKES.some((k) => k.id === m)) return m as Make;
  if (params.has("blog")) return "blog";
  if (params.has("story")) return "story";
  return null;
};
/** The asked kind when it's offered, else the first offered. */
export const pick = (asked: Make | null, offered: readonly MakeKind[]): Make =>
  offered.find((m) => m.id === asked)?.id ?? offered[0]?.id ?? "post";

/**
 * Write's old address in Studio's terms: `?blog=1` and `?story=1` become `?make=`; the rest
 * (`from`, `about`, `platform`, `idea`) rides along.
 */
export function studioHref(params: URLSearchParams): string {
  const q = new URLSearchParams(params);
  for (const kind of ["blog", "story"] as const)
    if (q.has(kind)) {
      q.delete(kind);
      if (!q.has("make")) q.set("make", kind);
    }
  const rest = q.toString();
  return `/content/studio${rest ? `?${rest}` : ""}`;
}

/** One idea's drafts that wait, as ContentDesk's `waiting` answers. */
export interface Waiting {
  ideaId: string;
  idea: string;
  /** The offer line it serves (a line id in the shape), when the plan says. */
  line?: string | null;
  /** How it argues (`IDEA_ANGLES`), when he picked one. */
  angle?: string | null;
  drafts: {
    id: string;
    platform: Platform;
    text: string;
    title: string | null;
    state: string;
    error: string | null;
    edited: boolean;
    own: boolean;
    story?: boolean;
    carousel?: boolean;
    thread?: boolean;
    missing?: string[];
    /** When it was made (ISO). An older answer has none. */
    at?: string | null;
    /** When it is set to post (ISO), or none for the next free slot. */
    slot?: string | null;
  }[];
}

/** What an idea's drafts are: a story, a carousel or a thread, else a post. */
export function kindOfIdea(i: Waiting): Make {
  const d = i.drafts[0];
  if (!d) return "post";
  return d.story ? "story" : d.carousel ? "carousel" : d.thread ? "thread" : "post";
}

export const desk = <T>(handler: string, input: Record<string, unknown>, requestId?: string) =>
  contentDesk<T>(handler, requestId ? { ...input, requestId } : input);
export const message = (err: unknown) => (err instanceof ApiError ? err.message : String(err));

export const when = (at: string) =>
  new Date(at).toLocaleString(undefined, {
    weekday: "short",
    hour: "numeric",
    minute: "2-digit",
  });

/** "a thread is 3 to 7 posts" as a sentence. */
export const sentence = (s: string) =>
  `${s.charAt(0).toUpperCase()}${s.slice(1)}${/[.!?]$/.test(s) ? "" : "."}`;
export const listed = (xs: readonly string[]) =>
  xs.length < 2 ? (xs[0] ?? "") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`;

/** The earliest time an idea's drafts are set to post, in ms; null when none has one. */
export function slotOf(i: Waiting): number | null {
  const at = i.drafts.flatMap((d) => (d.slot ? [Date.parse(d.slot)] : []));
  return at.length ? Math.min(...at) : null;
}

/** Past its slot: it was set to post before now and still waits. */
export const lateSlot = (i: Waiting, now = Date.now()) => {
  const slot = slotOf(i);
  return slot !== null && slot < now;
};

/** How long its oldest draft has waited: "3h", "2d", "now". */
export function waited(i: Waiting, now = Date.now()): string {
  const at = i.drafts.flatMap((d) => (d.at ? [Date.parse(d.at)] : []));
  if (!at.length) return "";
  const hours = Math.floor((now - Math.min(...at)) / 3_600_000);
  if (hours < 1) return "now";
  return hours < 48 ? `${hours}h` : `${Math.floor(hours / 24)}d`;
}

/** A row's words: the title, else the first line; and the next line under it as a hook. */
export function headlineOf(i: Waiting): { title: string; hook: string } {
  const d = i.drafts[0];
  const lines = (d?.text ?? "")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && l !== "---");
  if (d?.title) return { title: d.title, hook: lines[0] ?? "" };
  return { title: lines[0] ?? i.idea, hook: lines[1] ?? "" };
}

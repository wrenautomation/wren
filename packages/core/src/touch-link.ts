/**
 * The item's own page for a touch (designs/2026-10-17-people-depth.md): the comment, the reply,
 * the status, the DM thread. Pure: it reads only what a source row holds, so a live writer and
 * the backfill build the same link. Null when the platform gives no page for the item; the
 * touch's `url` (the post or profile it sits on) then stays its only link.
 */
import { BROKEN_IG_URL, type TouchKind } from "./touches-schema.js";

export { BROKEN_IG_URL };

/** What a source row holds about the item. */
export interface ItemRef {
  /** The row's own url: the post, the thread, the profile or a DM thread. */
  url?: string | null | undefined;
  /** The platform's id for the item: a comment id, a status id, a comment URN. */
  externalId?: string | null | undefined;
  /** The post or thread the item sits under (id or URN). */
  post?: string | null | undefined;
  /** The comment it answers; absent or the post's id means it is on the post itself. */
  parent?: string | null | undefined;
}

/** A url worth showing as a link: null for a form no platform opens. */
export function usableUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  return new RegExp(BROKEN_IG_URL).test(url) ? null : url;
}

const POST_URN = /^urn:li:(?:share|ugcPost|activity):\d+$/;
const COMMENT_URN = /^urn:li:comment:\((urn:li:(?:share|ugcPost|activity):\d+),([^,()]+)\)$/;
const FEED = "https://www.linkedin.com/feed/update/";

/** A comment URN made of the pieces a row holds, or null. */
function linkedinComment(id: string | null | undefined, post: string | null | undefined) {
  if (!id) return null;
  const whole = COMMENT_URN.exec(id);
  if (whole) return { post: whole[1] as string, urn: id };
  if (/^\d+$/.test(id) && post && POST_URN.test(post))
    return { post, urn: `urn:li:comment:(${post},${id})` };
  return null;
}

function linkedinLink(kind: TouchKind, r: ItemRef): string | null {
  if (kind === "dm")
    return r.url && /linkedin\.com\/messaging\/thread\//.test(r.url) ? r.url : null;
  if (kind !== "comment" && kind !== "reply" && kind !== "mention") return null;
  const urlPost = r.url ? /\/feed\/update\/(urn:li:[A-Za-z]+:\d+)/.exec(r.url)?.[1] : undefined;
  const on = r.post && POST_URN.test(r.post) ? r.post : urlPost;
  const item = linkedinComment(r.externalId, on);
  if (!item) return null;
  const base = `${FEED}${item.post}/`;
  const parent =
    r.parent && r.parent !== r.post && r.parent !== item.post
      ? linkedinComment(r.parent, item.post)
      : null;
  return parent
    ? `${base}?commentUrn=${encodeURIComponent(parent.urn)}&replyUrn=${encodeURIComponent(item.urn)}`
    : `${base}?commentUrn=${encodeURIComponent(item.urn)}`;
}

const postOf = (r: ItemRef) =>
  /^(?:t3_)?([a-z0-9]+)$/i.exec(r.post ?? "")?.[1] ??
  (r.url ? /reddit\.com\/(?:r\/[^/]+\/)?comments\/([a-z0-9]+)/i.exec(r.url)?.[1] : undefined);

function redditLink(kind: TouchKind, r: ItemRef): string | null {
  if (kind === "dm") return r.url && /reddit\.com\/message\//.test(r.url) ? r.url : null;
  if (kind !== "comment" && kind !== "reply" && kind !== "mention") return null;
  const post = postOf(r);
  const id = /^(?:t1_)?([a-z0-9]+)$/i.exec(r.externalId ?? "")?.[1];
  return post && id ? `https://www.reddit.com/comments/${post}/_/${id}/` : null;
}

function xLink(kind: TouchKind, r: ItemRef): string | null {
  if (kind !== "comment" && kind !== "reply" && kind !== "mention") return null;
  return /^\d+$/.test(r.externalId ?? "") ? `https://x.com/i/status/${r.externalId}` : null;
}

function facebookLink(kind: TouchKind, r: ItemRef): string | null {
  if (kind !== "comment" && kind !== "reply") return null;
  // A comment's Graph id is `<post>_<comment>`; a reply's `<comment>_<reply>`.
  return /^\d+_\d+$/.test(r.externalId ?? "") ? `https://www.facebook.com/${r.externalId}` : null;
}

/** Instagram: the media's permalink (shortcode form) plus the comment id; never a numeric media id. */
function instagramLink(kind: TouchKind, r: ItemRef): string | null {
  if (kind !== "comment" && kind !== "reply") return null;
  const base = /^(https:\/\/www\.instagram\.com\/(?:p|reel|tv)\/[A-Za-z0-9_-]+\/)/.exec(
    usableUrl(r.url) ?? "",
  )?.[1];
  const id = r.externalId;
  if (!base || !id || !/^\d+$/.test(id)) return null;
  const parent = r.parent && r.parent !== r.post && /^\d+$/.test(r.parent) ? r.parent : null;
  return parent ? `${base}c/${parent}/r/${id}/` : `${base}c/${id}/`;
}

function youtubeLink(kind: TouchKind, r: ItemRef): string | null {
  if (kind !== "comment" && kind !== "reply") return null;
  const video =
    r.post && /^[A-Za-z0-9_-]{11}$/.test(r.post)
      ? r.post
      : r.url
        ? /[?&]v=([A-Za-z0-9_-]{11})/.exec(r.url)?.[1]
        : undefined;
  return video && r.externalId && /^[A-Za-z0-9_.-]+$/.test(r.externalId)
    ? `https://www.youtube.com/watch?v=${video}&lc=${r.externalId}`
    : null;
}

/** The item's own page, or null when the platform gives none (or the row lacks what it takes). */
export function itemLink(platform: string, kind: TouchKind, ref: ItemRef): string | null {
  switch (platform) {
    case "linkedin":
      return linkedinLink(kind, ref);
    case "reddit":
      return redditLink(kind, ref);
    case "x":
      return xLink(kind, ref);
    case "facebook":
      return facebookLink(kind, ref);
    case "instagram":
      return instagramLink(kind, ref);
    case "youtube":
      return youtubeLink(kind, ref);
    default:
      return null;
  }
}

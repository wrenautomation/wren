/**
 * A client's Google Business Profile as a `ContentChannel` (designs/2026-10-07-client-social.md):
 * local posts and reviews through the Business Profile API (v4) on the connected location. Posts
 * take no comments; the Profile's reviews come in as comments on the location, and `reply`
 * answers one. Google gives no per-post numbers, so metrics are zeros and insights say why.
 */
import {
  type ActivityQuery,
  type CommentRow,
  type ContentChannel,
  type Insights,
  type InsightsQuery,
  knownGaps,
  type ListQuery,
  METRICS as M,
  type MediaHost,
  type Metrics,
  type Post,
  type Published,
  type PublishedRow,
  pageOf,
  previewOf,
  publicUrlOf,
  type SiteClient,
} from "@wren/core/content";
import { fieldsOf, ShapeError } from "@wren/core/content/shapes";

export const BUSINESS_SITE = "google_business";
/** Where a Profile is managed: posts and reviews have no public link of their own. */
const PROFILE_URL = "https://business.google.com/";
const STARS: Record<string, number> = { ONE: 1, TWO: 2, THREE: 3, FOUR: 4, FIVE: 5 };

export interface BusinessProfileOptions {
  /** `accounts/<a>/locations/<l>`: the connected location. */
  location: string;
  host?: MediaHost;
  now?: () => Date;
}

interface LocalPost {
  name: string;
  summary?: string;
  createTime?: string;
  searchUrl?: string;
}
interface Review {
  name: string;
  reviewer?: { displayName?: string; isAnonymous?: boolean };
  starRating?: string;
  comment?: string;
  createTime?: string;
  updateTime?: string;
  reviewReply?: { comment?: string };
}

/** A review in words: its stars, then what they wrote. */
export function reviewText(r: Pick<Review, "starRating" | "comment">): string {
  const n = STARS[r.starRating ?? ""] ?? 0;
  const said = (r.comment ?? "").trim();
  const stars = n ? `${n}/5 stars` : "A rating";
  return said ? `${stars}. ${said}` : `${stars}, no words.`;
}

export function businessProfileContent(
  sites: SiteClient,
  o: BusinessProfileOptions,
): ContentChannel {
  const now = o.now ?? (() => new Date());
  const at = `/v4/${o.location}`;
  return {
    platform: "google_business",
    async publish(post: Post): Promise<Published> {
      const f = fieldsOf("google_business", post.extra);
      if (f.action && f.action !== "CALL" && !f.actionUrl)
        throw new ShapeError("Button link: a link is needed for that button");
      if (post.media && post.media.kind !== "image")
        throw new ShapeError("google_business: a post takes a photo, not a video");
      const body: Record<string, unknown> = {
        languageCode: "en",
        summary: post.text,
        topicType: "STANDARD",
        ...(f.action
          ? {
              callToAction: {
                actionType: f.action,
                ...(f.action !== "CALL" && f.actionUrl ? { url: f.actionUrl } : {}),
              },
            }
          : {}),
        ...(post.media
          ? {
              media: [
                {
                  mediaFormat: "PHOTO",
                  sourceUrl: await publicUrlOf(post.media.source, o.host, "google_business"),
                },
              ],
            }
          : {}),
      };
      const p = await sites.call<LocalPost>(BUSINESS_SITE, "POST", `${at}/localPosts`, body);
      return {
        id: p.name,
        url: p.searchUrl ?? PROFILE_URL,
        publishedAt: p.createTime ?? now().toISOString(),
        fetchedWith: "api",
      };
    },
    async list(q: ListQuery = {}): Promise<PublishedRow[]> {
      const out = await sites.call<{ localPosts?: LocalPost[] }>(
        BUSINESS_SITE,
        "GET",
        `${at}/localPosts`,
        { pageSize: 100 },
      );
      return pageOf(
        (out.localPosts ?? []).map((p) => ({
          id: p.name,
          url: p.searchUrl ?? PROFILE_URL,
          publishedAt: p.createTime ?? now().toISOString(),
          fetchedWith: "api" as const,
          preview: previewOf(p.summary ?? ""),
        })),
        q,
      );
    },
    async metrics(id: string): Promise<Metrics> {
      return {
        id,
        views: 0,
        reactions: 0,
        comments: 0,
        shares: 0,
        asOf: now().toISOString(),
        fetchedWith: "api",
      };
    },
    async insights(_q: InsightsQuery): Promise<Insights> {
      return {
        values: [],
        gaps: knownGaps("no_api", "Google gives no numbers per Business Profile post", [
          M.views,
          M.linkClicks,
        ]),
        asOf: now().toISOString(),
      };
    },
    // A local post takes no comments: what people say is in the reviews.
    async comments(): Promise<CommentRow[]> {
      return [];
    },
    async reviews(q: ActivityQuery = {}): Promise<CommentRow[]> {
      const out = await sites.call<{ reviews?: Review[] }>(BUSINESS_SITE, "GET", `${at}/reviews`, {
        pageSize: 50,
        orderBy: "updateTime desc",
      });
      const { since } = q;
      return (out.reviews ?? [])
        .filter((r) => !since || (r.updateTime ?? r.createTime ?? "") >= since)
        .map((r) => ({
          id: r.name,
          postId: o.location,
          author: r.reviewer?.isAnonymous
            ? "A Google user"
            : (r.reviewer?.displayName ?? "A Google user"),
          text: reviewText(r),
          ...(STARS[r.starRating ?? ""] ? { stars: STARS[r.starRating ?? ""] } : {}),
          at: r.createTime ?? now().toISOString(),
          ...(r.reviewReply?.comment ? { repliedWith: r.reviewReply.comment } : {}),
          raw: r,
        }))
        .slice(0, q.limit ?? 50);
    },
    async reply(reviewName: string, text: string): Promise<void> {
      if (!reviewName.startsWith(`${o.location}/reviews/`))
        throw new ShapeError("google_business: only this Profile's reviews are answered here");
      await sites.call(BUSINESS_SITE, "PUT", `/v4/${reviewName}/reply`, { comment: text });
    },
  };
}

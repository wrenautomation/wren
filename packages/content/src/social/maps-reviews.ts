/**
 * A client's Google reviews read off Maps (designs/2026-10-09-review-replies.md): autobrowse's
 * `web GET /place/reviews`, by the client's Place ID, for a client whose Business Profile isn't
 * reading them through the API. Each lands as a review row like the API's, marked `source: maps`:
 * its reply is copied and posted on Google by hand.
 */
import type { CommentRow, SiteClient } from "@wren/core/content";

/** Read this often per client: Maps is a browser read on the desk. */
export const MAPS_EVERY_MS = 6 * 60 * 60 * 1000;
/** Newest first, this many a read. */
export const MAPS_LIMIT = 20;

/** One review as `web GET /place/reviews` answers it. */
export interface MapsReview {
  id: string;
  author: string;
  authorUrl: string | null;
  stars: number | null;
  text: string;
  at: string | null;
  estimated: boolean;
  ago: string;
  edited: boolean;
  reply: { text: string; ago: string } | null;
}

export interface MapsRead {
  placeId: string;
  name: string | null;
  url: string;
  reviews: MapsReview[];
}

/** The place every Maps review of it hangs under. */
export const mapsPost = (placeId: string) => `place:${placeId}`;

/** A read's reviews as review rows: a review with no time is skipped, it can't be ordered. */
export function mapsRows(read: MapsRead): CommentRow[] {
  return read.reviews.flatMap((r) =>
    r.at && r.author
      ? [
          {
            id: r.id,
            postId: mapsPost(read.placeId),
            author: r.author,
            text: r.text,
            at: r.at,
            ...(r.reply?.text ? { repliedWith: r.reply.text } : {}),
            url: read.url,
            ...(r.stars ? { stars: r.stars } : {}),
            raw: { source: "maps", placeId: read.placeId, ...r },
          },
        ]
      : [],
  );
}

/** Read a place's newest reviews through autobrowse. */
export async function readMapsReviews(sites: SiteClient, placeId: string): Promise<CommentRow[]> {
  const read = await sites.call<MapsRead>("web", "GET", "/place/reviews", {
    placeId,
    limit: MAPS_LIMIT,
  });
  return mapsRows(read);
}

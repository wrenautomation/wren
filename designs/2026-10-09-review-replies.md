# Review reading with drafted replies

2026-10-09. Gaps item 9 (`2026-10-09-gaps.md`; audit: GHL Reputation, Birdeye). Every review of a
client's business is read, shown with its stars, and gets a reply drafted the moment it lands.
A person approves each reply. Nothing posts on its own.

## Today

- A connected Business Profile's reviews already come in: `SocialWatch` reads them
  (`businessProfileContent.reviews`, Business Profile API v4) and `keepReviews` keeps each as a
  `comments` row under post title "Reviews". They show in the Inbox as comment threads, and
  Reply posts through `reviews/<id>/reply`.
- Two gaps. Google hasn't approved Business Profile API access, so no client reads reviews yet.
  A review is just a comment: no stars to filter on, no view of reviews alone, no draft.
- Review requests (`2026-10-07-missed-call-and-reviews.md`) already hold each client's Place ID
  (`google_business.place_id`).

## Reading

| Source | Needs | Reply |
|---|---|---|
| Business Profile API (have) | the client's Profile connected; Google's API approval (held) | posts on Google |
| Google Maps, signed out (new) | the Place ID only | none: copy the draft, open the review on Google |

- New autobrowse route `web GET /place/reviews` (`placeId`, newest first, up to 50): name,
  stars, words, time, the owner's reply if any, and the review's link. A browser leg on the desk,
  like `/place`. Maps' own review list response gives the rows, not the page text.
- `SocialWatch` reads Maps for a client with a Place ID and no Profile reading reviews,
  every 6 hours. When both exist, the API wins and Maps is skipped.
- Both land through `keepReviews`. A review seen twice (Maps and later the API) keeps one row:
  the ref is the Maps review id, and the API row matches by author and time within a minute.
- Facebook recommendations need Meta's `pages_read_user_content` review. Later, with the Meta
  app review.

## Data (one migration, 0219)

On `comments` (each database that holds comments):

- kind `review` joins `post_reply`, `comment_reply`, `username_mention`.
- `stars` smallint, 1 to 5, null for anything but a review.
- `replied_text` text: the owner's reply as read from the source, so a reply made on Google by
  hand counts as answered.

`keepReviews` writes kind `review`, `stars` from `starRating` or Maps' number, and the reply.

## Drafting

- A kept review that has no reply reaches `AutoReply` (`2026-10-09-auto-reply.md`) on channel
  `comment` the same way a heard reply does. The `comment` mode applies (Suggest by default).
  Other comments still wait for their own reply trigger.
- `suggestReply` gets the stars and a review brief:
  - thank them by first name, and say one specific thing from their words;
  - 4 or 5 stars: short and warm;
  - 1 to 3 stars: own the experience without admitting fault, give one way to reach the owner
    (`{biz.phone}` or `{biz.email}` from business facts), never argue;
  - never offer anything for a review, never name a job, price or detail they didn't write;
  - no words, just stars: one line of thanks.
- The draft waits in To approve. A Maps-read review has no reply option, so it waits as a
  "Copy and post" item: Approve copies the text and opens the review on Google, then marks it
  answered.
- Wren itself has no reviews to read today. Wren's own Business Profile reads the same way once
  it has one.

## Portal

- **Marketing → Reviews** (`marketing.review`): stars, who, their words, when, source,
  reply state (none, drafted, replied). Views: Needs reply (default), 1 to 3 stars, All.
  Open goes to the thread.
- Its Overview top: average stars and count over 90 days, reply rate, median time to reply.
- A 1 or 2 star review rings like an `@` mention: a notice to the client's admins.
- The client's Marketing gets the same page on its own database.

## Not in this round

- Facebook, Yelp (its API gives three excerpts and no replies) and others.
- Posting a reply on its own: Auto stays held, and a public reply always waits on a yes.
- Review widgets on the client's site.

## Decision log

- 2026-10-09: my calls (William: build it all, ask nothing). Reviews stay `comments` rows so the
  Inbox, To approve and the reply path need nothing new; the migration only adds what a review
  has that a comment hasn't. Maps reading comes first because it needs no Google approval.

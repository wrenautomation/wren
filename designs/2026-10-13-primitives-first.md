# Primitives first

William, 10-13: "i work with the primitives (the actual content that we generate) and my mental
stack is as light as possible. The UI shows how it branches off (reels + shorts + tiktok,
autoclipped and custom short form) and does the sorting. Goal of this portal is to maximize
visibility into what happens, while minimizing actual user complexity." Then: "this principle
should apply across the whole UI."

## What's wrong now

From a pass over every page (132 screenshots, 10-13):

1. **One piece, many rows.** A post drafted for 4 platforms is 4 rows in To approve. One
   vertical clip is 6 rows on Plan.
2. **Platform is navigation.** Every Marketing page opens with a 10-platform bar.
3. **Counts, not work.** Today says "To approve 87" and "Engage 66" and sends him to a table.
4. **Walls of zeros.** Overviews are 8-tile grids, most at 0. The eye can't find what moved.
5. **25 sidebar entries.** Half are machinery he rarely opens (Loops, Handlers, Library, Voice).
6. **No "what happened".** Nothing says what the system did since he last looked.

## Rules for every page

1. **One primitive, one row.** A thing he makes or decides shows once. Its copies hang under it.
2. **Branches show state.** Each branch shows where it goes and its state: draft, queued for a
   time, live with its views, failed and why.
3. **The system sorts.** A page opens on what needs him, in the system's order. Filters exist;
   they're never the way in.
4. **Work, not counts.** A count only sits beside the items it counts.
5. **Quiet zeros.** Numbers still at zero fold into one line.
6. **What happened.** The first page of an app says what the system did lately.
7. **Platform is a filter.** Never a page, never the top of a page.

## Primitives by app

| App | Primitive | Branches |
|---|---|---|
| Marketing | piece: long video, clip, post, story, blog | long video → YouTube, its clips, its promo posts. Clip → Shorts, Reels, TikTok, Facebook, LinkedIn, X. Post → LinkedIn, X, Threads, Reddit, Facebook, Business Profile. Blog → the site, the email |
| Inbox | a person | their messages on every channel |
| Pipeline, Outbound | a company, a campaign | its people, sends, replies |
| Clients | a client | its services, health, flags |

## Marketing

Pages: **Today, Pieces, Write, Engage, Numbers, More.** Videos, Posted and Feed move to More
(their links keep working). No platform bar on any page.

- **Today** (was Plan). Three blocks:
  - *Make*: one row per primitive, not per platform. "Vertical clip: today 0 of 3", then the
    platform marks it feeds. One button to make the next one. Per-platform goals open under
    "Goals" to edit.
  - *Waiting on you*: piece cards with their drafts. "Approve all" says yes to every waiting
    branch of that piece at once.
  - *What happened*: the last 7 days, newest first. Went live, failed, numbers.
- **Pieces.** Every piece, newest first, each a card with its branch tree. Chips: kind
  (long video, clip, post, story, blog) and state (waiting, queued, live). Platform is a select.

### The piece read

No new table. Lineage is already stored:

- `content_ideas.ref` = `video:<id>` is the long video's idea, `video:<id>/short:<n>` and
  `video:<id>/vertical` are its clips.
- A promo draft's `video_draft` points at the YouTube draft.
- Every other idea is a post, or a story when its drafts are stories (`formatSql`).
- `blog_posts` rows are blog pieces: branches "site" (published) and "email" (emailed).
- `video_edits` rows with no idea yet are long videos still in the editor, so a recording shows
  the moment it lands.

`packages/content/src/pieces.ts`: `piecesOf(rows)` builds the tree (pure, unit tested).
`pieceRows(db)` reads it. `Pieces/wren` serves `list`. Approve all calls the existing
`marketing/approveDraft` with the piece's waiting draft ids.

## The whole portal

- **Today (home).** Make (Marketing's primitives), then Waiting on you as the items themselves:
  piece cards, then each other kind as one batch line with its first items shown
  ("16 LinkedIn invites: Corey Emanuel, Chris Yee, ... Review"). Then what happened.
- **Overviews.** Every app's overview tile grid (one template) folds zero tiles into one quiet
  line: "Nothing yet: Replies, Booked, Mentions." Tiles that need him stay first.
- **Sidebar.** Automations and Tools fold shut by default, with their waiting counts summed on
  the heading. One click opens; the choice is remembered.

## Later

Inbox by person, Pipeline by company, Clients by client: the same card with branches. Each is a
read like `pieces.ts` over records that exist.

## Decisions

- 10-13: derive lineage from `ref` and `video_draft`; no `kind`/`parent` columns. They'd copy
  what the ref already says.
- 10-13: Plan's id stays `plan` (old links), labelled Today.

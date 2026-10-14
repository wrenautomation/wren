# Content types (2026-10-14)

William: "theres also like a video tab on marketing tab which is cool, wonder why there aren't tabs for other content types? or should it be a unified tab with filters? not sure. plan this out in a principled way."

## Answer first

Keep one list, with types as filters. That list is Pieces, and it already exists. Videos is the only content type that has its own page, and the reason isn't that it's a type. It has a production line: a recording is edited, rendered on the Mac and reviewed before it becomes a draft. No other type has that, so none gets a tab. To make the rule visible, Videos is relabelled **Studio**: the page for recorded media. Three gaps get closed so every video piece and what came from it shows in one place.

## What exists (10-14)

| Type | Where it's made | Where it shows | Production steps before a draft |
|---|---|---|---|
| Long video | Videos (recording → agent pass → render → review) | Pieces `long`, editor branch | many, minutes of Mac render |
| Shorts / vertical | Videos (Approve a Short / vertical), fans out to YouTube, Reel, TikTok, X, FB, LinkedIn | Pieces `vertical`, child of the long video | same render |
| Text post (LinkedIn, X, Threads, Reddit, FB, YouTube post) | Write → Post | Pieces `written` | none |
| X thread | Write, or Promote "thread"; edited in `thread.tsx` | Pieces, view by format | none |
| Carousel | Write → Carousel (slides drawn from text) | Pieces "Carousels" view | an automatic draw, seconds |
| Story | Write → Story (photo or a clip already cut) | Pieces `story` | upload |
| Blog + email | Write → Blog post (lander Markdown, then Newsletter) | Pieces `blog` (site, email branches) | commit and deploy, automatic |
| Comments, replies, DMs | Engage | not pieces | none |

The Today page's Make rows already group the cadence plan by piece (`catalog.ts`: long, vertical, written, story, replies, newsletter). Each row's button goes to the page where that piece is made (`makeAt`, `plan.tsx`).

## Principles

1. **The day is organized by work, not by artifact or platform.** Today says what to make and what waits. That's the way in.
2. **A sidebar entry is a place where different work happens.** Write is for typing. Studio is for recordings. Engage is for answering other people. Pieces is the record of everything made. Numbers is for results.
3. **A type gets its own workspace only if it has a production line.** It must pass all four tests:
   - its source isn't typed (a recording, audio);
   - a job runs for minutes;
   - the result has to be watched or heard to judge it;
   - it has states before "draft".
   
   Today only video passes. Blog, carousel and story fail at least three, so each is a box in Write.
4. **Type is a filter, and so is platform.** Neither one is a tab. The 10-13 rule 7 now covers type too.
5. **One piece shows once, with its lineage.** Anything made from a piece hangs under it, whatever its type.
6. **Weak is fine, so nothing waits on polish.** Approve all covers text. A video gets one look because a bad cut can't be fixed after it goes out.

## What the tools do

Based on what I know of these products, not checked against their current UIs this week:

- **Buffer, Hootsuite, GHL Social Planner:** one composer and one queue or calendar. Images, video and carousels are attachments on a post, and you filter by channel and status. None has a tab per content type. Engagement is separate (Hootsuite Streams and Inbox, Buffer's Engage).
- **Later:** started visual-first. Its Media Library is a separate workspace because media is the input, and the calendar is a view over posts.
- **Notion content calendars:** one database with Type, Platform and Status properties. Board, calendar and filtered views sit over it. Lineage is a relation or sub-items.
- **Descript:** a separate production app. A project is a recording, edited through its transcript, then published.
- **Opus Clip:** one long video goes in and scored clips come out, listed under the source project, then scheduled. Lineage is project → clips.

The pattern: schedulers keep one list and treat type as a property. Production tools are separate because editing is a different job. Opus Clip shows lineage as parent → children. Wren already does all three: Pieces is the list, Studio is the production tool, and the piece tree is the lineage.

## Recommendation

### Workspaces (own sidebar entry)

- **Studio** (id `videos`, relabelled). Recordings from add through to approve: the agent's pass, checks, render, review, and Approve, Schedule or Reject for the long video, its Shorts and the vertical. Any future recorded medium (a podcast, a webinar) joins Studio, not a new tab.
- **Write.** Every typed piece, chosen by the "What you're making" picker: Post, Carousel, Story, Blog post. Its Video card links to Studio.
- **Engage.** Other people's posts and our comments and replies. It's a queue, not pieces.

### Filters (Pieces views)

Everything made. The existing views stay, and "Videos" is renamed **Long videos** so it doesn't clash with the old page name. Add a **Best** view (live, sorted by views). That replaces the reason to open More → Posts.

### Lineage: one long video, start to finish

```
Long video "X"                     [Studio: editing → review]  → YouTube (live, 1.2k)
├─ Short 1 (proposed → approved)   → YouTube Short, Reel, TikTok, X, FB, LinkedIn
├─ Short 2 (proposed)              → in Studio
├─ Promo post                      → LinkedIn, X, Threads      (video_draft, exists)
├─ Carousel                        → Instagram, LinkedIn        (Promote "carousel", exists)
├─ Post about it                   → X, Threads                 (new: ref video:<id>/post:<k>)
└─ Blog post                       → site, email                (new: blog_posts.from_ref)
```

What's stored: idea `ref` and `video_draft` (exist), plus one new nullable column on `blog_posts`. While a recording is in Studio, its card shows a **Review** link instead of being part of Approve all.

### Sidebar after

**Today · Write · Studio · Engage · Pieces · Numbers · More**

This follows the day: what to do, then make, then answer, then look back. Pieces moves after Engage because Today already brings up what waits, so Pieces is for looking things up.

### What moves, merges or is cut

| Thing | Change |
|---|---|
| Videos label | becomes "Studio"; id and links stay |
| Pieces view "Videos" | becomes "Long videos"; id `videos` stays for links |
| Old by-platform day page (id `today`, `TODAY` DayPage) in More | hidden. It breaks "platform is a filter"; Today (plan) replaces it |
| More → Posts (`content`) | stays as the per-post numbers record, moved under More's Numbers heading; Pieces "Best" covers browsing |
| Write's waiting board | stays for now (it has inline edit and rewrite, which PieceCard lacks) |
| Feed | stays in More (where ideas come in; "Use as idea" opens Write) |

### Phone

- Marketing's bottom tabs stay **Today, Write, Engage**, then More (Pieces, Studio, Numbers). `PHONE_TABS` in `apps/portal/web/src/areas.ts` doesn't change.
- Video review on the phone comes from Today's Waiting card: Review opens the Studio record.
- Below 900px the Studio record shows the review block first: preview, checks, then Approve, Schedule, Reject, and "Ask for changes" with dictation. Transcript, cuts and captions fold behind "Edit" because editing happens at the Mac.

## Phases

Each phase ships on its own.

**C1. Labels and order (UI only).**
- `apps/portal/web/src/modules/marketing/index.ts`:
  - `MAIN` order becomes `plan, write, videos, engage, pieces, overview`, with `videos: "Studio"`.
  - The `videos` page's `about` becomes "Recordings: the agent edits, you review, they go out as videos and Shorts."
  - `TODAY` gets `hidden: true`.
  - Posts (`content`) gets `group: "Numbers"`.
- `apps/portal/web/src/modules/marketing/piece-views.ts`: the `videos` view name becomes "Long videos"; add `{ id: "best", name: "Best", show: "live", sort: "views" }`. Update `piece-views.test.ts`.
- `write.tsx` `MAKES`: the video card's `where` text says it opens Studio.
- Map: `map/objects/content/piece.md`, `video-edit.md` (the Surfaces lines), then `map/_meta/build.sh`.

**C2. Videos count as waiting, and proposed Shorts show.**
- `packages/content/src/pieces.ts`:
  - `VideoRow` gains `state` and `shorts: {title}[]`.
  - `pieceRows` selects them and leaves out `rejected`.
  - The editor branch is `editing` for added and edited, and a new `BranchState` `review` for rendered.
  - `waitingOf` counts `review`.
  - Each `shorts[n]` without an idea at `video:<id>/short:<n+1>` becomes a child `vertical` piece with one editor branch (`editing`).
- Add cases to `pieces.test.ts`.
- `apps/portal/web/src/modules/marketing/pieces.tsx`: `allWaiting` stays, but Approve all (around line 200) sends only non-editor branch ids. An editor branch shows a "Review" link (`hrefOf` already points to `/marketing/videos/<id>`).
- `plan.tsx` needs no change: it reads `allWaiting`.

**C3. Lineage from a video for words.**
- `packages/content/src/ideas.ts` `addIdea` takes an optional `ref`.
- `own.ts` `writeOwn` takes `from` (`video:<id>`) and writes ref `video:<id>/post:<8 chars>` (unique under `uq_content_ideas_ref`).
- `restate/desk.ts` `write` passes `from` through.
- `write.tsx` reads `?from=` and shows "About: <video title>" with a clear button.
- The Studio record gets a "Write a post about it" link to `/marketing/write?from=video:<id>`.
- `pieces.ts`: a ref `video:<id>/<anything>` nests under the long video. `short:` and `vertical` keep kind `vertical`; anything else takes its kind from its formats.

**C4. Blog from a video.**
- Migration `packages/db/drizzle/0257_blog_from.sql` (the next free number when built): `alter table blog_posts add column from_ref text`.
- `packages/content/src/schema.ts` `blogPosts.fromRef`.
- `restate/blog.ts` `save` takes `from`.
- `blog-box.tsx` gets a "From" select over recent long-video pieces.
- `pieces.ts` nests `blog:<slug>` under its video.
- Map card `content/blog-post.md`.

**C5. Studio on a phone.**
- `apps/portal/web/src/modules/marketing/videos.tsx`: the review-first order, with Edit folded below 900px.
- Screenshots at 390 and 1360.

## Not here

- Moving Write's waiting board onto PieceCard. That waits until PieceCard can edit and rewrite in place; until then there would be two edit UIs.
- Funnel links on hand-written posts about a video (Promote's `video_draft` path). The C3 ref nests them but adds no link.
- Linking a newsletter to several sources. One `from_ref` per blog post for now.

## Decision log

- 10-14: No tab per content type. Type is a filter on Pieces, as platform already is (extends 10-13 rule 7).
- 10-14: A type gets a workspace only if it passes all four production tests. Only recorded media does. A future podcast joins Studio.
- 10-14: Videos is relabelled Studio, id kept. One-line revert in `MAIN` if the name doesn't stick.
- 10-14: A rendered video is "waiting" (branch state `review`) but is left out of Approve all. A cut needs one look.
- 10-14: `blog_posts.from_ref` is the one new stored link. Blog posts have no idea row, so `ref` can't carry it. This is a deliberate exception to 10-13's "no parent columns".
- 10-14: The old by-platform day page is hidden. Today (plan) replaces it.

## Build log

- 10-14 C1: sidebar Today, Write, Studio, Engage, Pieces, Numbers; Studio label and about; by-platform day page hidden; Posts under More's Numbers; Pieces "Long videos" and "Best" views; "Open Studio" copy in Write, Today and the funnel picker.
- 10-14 C2: rendered recording is branch `review` (waiting, Review link, not in Approve all); proposed Shorts without an idea hang under their video as `editing` clips; rejected recordings left out.
- 10-14 C3: Write takes `?from=video:<id>` (and `?about=` for the title), shows About with Clear; `ContentDesk.write` `from` writes ref `video:<id>/post:<8 hex>`; Studio's "From this video" links to Write (post and blog); Pieces nests any `video:<id>/<k>` ref.
- 10-14 C4: migration 0257 `blog_posts.from_ref`; `Blog.save` `from`; Blog box From pick over recent long videos (preset by `?from=`); Pieces nests `blog:<slug>` under its video; long pieces carry `video`.
- 10-14 C5: Studio record below 900px: Review section (checks, Ask for changes, then passes) after the preview; title, cuts, transcript and Ask Claude fold behind Edit. Screenshots at 390 and 1360 from a local preview on a throwaway database.

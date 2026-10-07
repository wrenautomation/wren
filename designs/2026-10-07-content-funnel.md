# Content funnel: YouTube long-form first, everything else feeds it (2026-10-07)

William, 10-07 (relayed): one long recording feeds every platform; promo posts point at the
video; written posts, short vertical and comments are three capabilities with per-platform
adapters, not fifteen features. This is the system's default bias from now on.

## Answer first

- **The funnel is video → site → booking.** YouTube long-form is the top asset. Every draft
  says which stage it serves (Reach, Trust, Convert) and where it points (a video, the site,
  booking). The link it carries is filled by code: the lander's `/go/<channel>/<stage>/<post>`,
  which counts the click. A video adds `?v=<YouTube id>` and hops on to YouTube; booking adds
  `?to=/book/reactivation`. A client's post links its own video straight.
- **Promo is a post type.** Pick a YouTube video (uploaded or approved to go), get one draft per
  platform (LinkedIn, X, Reddit, Instagram), each in its platform's tone, pointing at the video.
  Reddit stays organic: first person, the lesson itself, a link only where the subreddit allows.
- **Comments learn.** Every comment draft (answers on our posts, Reddit threads, LinkedIn posts)
  reads his past yeses and nos, with the reject reason and note, as few-shot examples: the most
  relevant to the post at hand, then the newest, 6 at most.
- Built here: those three, then the counted video hop, Promote on a client's portal, and the
  examples in Ask Claude on a comment (see "Built, second pass"). The rest is in the build
  order, shown "In development" where a surface exists.

## His model

Channels in focus: YouTube, LinkedIn, Reddit, X, Instagram. TikTok gets the vertical file free.

**Funnel.** YouTube long-form is king. Everything else feeds it or is cut from it.

- A promo on any other platform is a written post plus a link to the video.
- One long recording becomes: Shorts, Reels and TikTok (one vertical file); written posts; an X
  thread; a Reddit post on the lesson.

**Overlaps: one capability each, adapters per platform.**

1. **Short-form vertical** (YT Shorts, IG Reels, TikTok): one asset.
2. **Written posts** (Reddit, X, LinkedIn): one idea, rewritten per platform. Reddit organic
   (first person, no pitch, no links, the sub's rules). LinkedIn a hook plus short lines. X
   denser, opinionated, assumes expertise. An IG carousel is a LinkedIn PDF post.
3. **Comments** (Reddit, LinkedIn, X, IG): high value only (a fact, a number, a real
   experience). He approves each. Approved and rejected ones become few-shot examples.
4. **Follows and connects** (LinkedIn, X, IG), within platform limits. Not Reddit.

**Targeting.** Places (subreddits and the like) come from research and enrichment, never
hard-coded.

**Funnel identification.** Every post knows its stage and target. Attribution goes through the
lander's `/go/<channel>/<campaign>/<content>`.

## Gap table (main @ 1939ae05)

| Part | Today | Missing |
|---|---|---|
| YouTube long-form | Video editor cuts, renders, approves a private upload (`packages/content/src/video.ts:177` `approveVideo`); footer links `/go/yt/<slug>` (`packages/templates/defaults/post/youtube/`) | nothing for this build |
| Short-form vertical | Shorts and the vertical cut render; Approve writes the YouTube Short and an IG Reel draft (`video.ts:259`) | TikTok copy of the same file (adapter exists, `packages/channel-tiktok/src/content.ts`; no draft written) |
| Funnel stage and target on a draft | none: `content_drafts` has no stage (`packages/content/src/schema.ts:94`); a draft's link is `/go/<code>/<id8>` appended on LinkedIn, YouTube, Facebook only when `WREN_CONTENT_LINK_SITE` is set (`platforms.ts:122`, `restate/scheduler.ts:119`), unset on prod | stage, target, the video, the link, in the editor and CLI (**built here, a**) |
| Promo post | none; a YouTube draft has no "promote" | one draft per platform pointing at the video (**built here, b**) |
| Written posts per platform | one prompt per idea, a one-line `shape` per platform (`platforms.ts:37`); playbooks per platform (`playbook.ts`) | adapters with real per-platform rules: Reddit's sub rules, LinkedIn hook, X density (build order 1) |
| X thread | X shape keeps one post; threads "In development" (`packages/core/src/content/shapes.ts:362`) | thread drafting and posting (build order 2) |
| IG carousel = LinkedIn PDF | LinkedIn document "In development" (`shapes.ts:298`); no IG carousel | one slide set, two adapters (build order 3) |
| Comments, drafted | answers on our posts (`packages/outreach/src/comments.ts:154`), Reddit threads (`discovery/threads.ts:283`), LinkedIn posts (`linkedin-posts.ts:369`); each reads his last 5 edits (`packages/core/src/ask.ts:286`) | approvals and rejections as examples (**built here, c**); X and IG comments on others' posts (build order 5) |
| Training record | `draft_events` keeps every generated, edited, sent, rejected step with reason and note (`packages/core/src/draft-record.ts`) | read back into prompts (**c**) |
| Follows and connects | LinkedIn invites, 20 a day, gated (`packages/outreach/src/invites.ts`) | X and IG follows (build order 4) |
| Targeting | Reddit places found and judged by research, watched by him (`packages/outreach/src/discovery/places.ts`) | joining a sub from the account (build order 6) |
| Attribution | lander `/go/` redirects to our pages with utm (`lander/functions/go/[[path]].ts`); our pages only | a hop for an outside video (YouTube), counted at the edge (**built, second pass**) |

## Built here

### (a) Stage and target on every draft

- Columns on `content_drafts`: `stage` (reach | trust | convert, default reach), `points_to`
  (video | site | booking, default site), `video_draft` (the YouTube draft it points at, null),
  `linked` (his switch; null follows the platform's rule). Migration with a backfill: YouTube
  long videos become trust/site; a Short or Reel cut from a video points at its long upload;
  everything else reach/site.
- The link is derived, never typed: `targetLink` and `funnelOf` in `packages/content/src/funnel.ts`.
  - video: `/go/<code>/<stage>/<first 8 of the draft id>?v=<YouTube id>`; none until it is up.
    The lander counts the click and sends it to YouTube. A URL whose id doesn't parse goes
    straight.
  - site: `https://wrenautomation.com/go/<code>/<stage>/<first 8 of the draft id>`.
  - booking: the same plus `?to=/book/reactivation` (the only offer with a booking page).
- Whether a post carries a link (`linkRule`):
  - Instagram, TikTok, a YouTube Short: never (not clickable; the bio link counts them).
  - LinkedIn, Facebook, YouTube video: yes.
  - X: only a promo (points to a video). A link on X costs reach; a promo is worth it.
  - Reddit: only a promo, and only where the subreddit allows links (`reddit_places.judged`).
  - He can turn it off on any post, and on where the rule allows.
- A video's own upload (`approveVideo`) is trust/site, not linked: its footer already links the
  site and booking. Its Shorts and Reels are reach/video, pointing at the long upload.
- Approve refuses a linked video post whose video isn't on YouTube yet.
- The scheduler appends the derived link, as before, on its own line. `WREN_CONTENT_LINK_SITE`
  goes: one site, Wren's, the one the footers name. A client's drafts never carry Wren's link.
- Editor: a Funnel group above Basics (Stage, Points to, the video, the link and its switch);
  the preview shows the link as it will post. Lists show stage and target. CLI:
  `wren content funnel <id> [--stage] [--to] [--video] [--link on|off|auto]`, and `show` prints
  them. A redraft keeps all four.

### (b) Promo

- `promoteVideo` (`packages/content/src/promo.ts`): from a YouTube video draft (published, or
  approved and waiting to upload). One idea per video (ref `promo:<draft>`), source `promo`; its
  text is the video's title and description without the footer: his words, so the facts guard
  holds claims to them.
- Per platform, one model call through the same guarded path as any draft, with a promo brief:
  - LinkedIn: hook line, short lines, what the viewer gets, points to the video. No hashtags.
  - X: one dense, opinionated post that assumes expertise, under 230 characters for the link.
  - Reddit: the lesson as its own post, first person, no pitch. Subreddit: the best-fit watched
    place that takes posts (`reddit_places`), its rules summary in the prompt. It mentions the
    video only where links are allowed. No watched place: skipped, with why.
  - Instagram: a Reel needs a video, so it carries the vertical cut or the first Short's Reel
    upload with a caption that sends people to the long video ("link in bio"). None rendered:
    skipped, with why.
- Each draft: stage reach, points to video, `video_draft` set. Drafts wait in To approve;
  nothing posts without his Approve.
- Surfaces: Videos (Promote, plus a Promos section on the video with each draft's state and the
  wider pieces "In development"), Posts (Promote on a YouTube post), ContentDesk `promote`,
  `wren content promote <video|draft> [--platforms]`.
- Instagram skips when the video's own Reel already carries the same file. A client's Promote:
  see "Built, second pass".

### (c) Comments learn from his decisions

- `commentExamples` (`packages/outreach/src/examples.ts`) reads `draft_events` for kinds
  comment, thread and linkedin_comment: each item's last decision (sent = approved, rejected
  with its reason and note), with the words that went out or were turned down and the post they
  answered (`comments`, `reddit_threads`, `linkedin_posts`).
- Ranked by word overlap with the post at hand, ties to the newest; 90 days, 6 at most, at
  least one no when there is one. A few hundred tokens a draft.
- Fed to all three drafting prompts beside his edits. All three kinds feed each one: a comment
  is one capability, and relevance picks. `wren drafts examples [--about text]` prints them.

## Built, second pass (2026-10-07)

### Counted video hop

- `targetLink` (`packages/content/src/funnel.ts`) sends every Wren link through `/go/`. A video
  target is `/go/<code>/<stage>/<id8>?v=<id>`; `youtubeId` reads watch, youtu.be, shorts and
  live URLs and takes only an 11-character id.
- Lander `functions/go/[[path]].ts`: with a valid `?v=` it writes one `hits` row (page
  `youtube:<id>`, the utm, the visitor with consent, no time on page) at the edge, then 302s to
  `https://www.youtube.com/watch?v=<id>`. Link previews from crawlers are not counted. Only a
  YouTube id passes, so it is never an open redirect. Lander decision D8.
- A client's video post links its own YouTube URL straight: Wren's lander never carries a
  client's traffic. A client post pointing at the site or booking has no link, and Approve
  refuses it while it is switched on.
- Editor: under the link, "Counts the click, then opens the video on YouTube."
- Order: the lander deploys first. Until it does, `?v=` lands on the home page.

### Promote on a client's portal

- `MarketingConsole.promote` (`packages/content/src/restate/marketing-console.ts`), route
  `marketing/promote` (act, app marketing). The client's Posts page shows Promote on a YouTube
  post, the same as Wren's.
- Checked before it starts, each refusal said back: its approver only (`decide`, the same rule as
  approve), its plan and `models` gate open (`clientDrafting`), the post a YouTube video
  approved to go up (`promotable` in `promo.ts`), and at least one of its logins taking a promo.
- Then sent to `ContentDesk/<client>/desk` `promote`, not awaited (one model call per platform).
  Drafts land in the client's database and wait in its To approve. Nothing posts.
- Platforms are the client's own logins (LinkedIn, Reddit today). The rest come back "no login
  of this client's posts here yet".

### Ask Claude on a comment reads his decisions

- `readDraft` (`packages/content/src/draft-ask.ts`) adds `examplesFor(db, COMMENT_KINDS_LEARNED,
  about)` for a comment, a Reddit thread and a LinkedIn post: the same few-shot the drafters
  read, closest to what the draft answers.
- The prompt (`draft-ask.prompt`) puts them after his edits and before the SOP. Posts, DMs and
  invites get none.

## Built, third pass (2026-10-07): X thread and carousel

Both are drafts only. Nothing posts without his Approve, and the carousel upload is not built.

### X thread

- One draft holds the thread: X, `kind` thread, the posts in its text with a `---` line between
  them (`packages/core/src/content/thread.ts`). The draft box, Ask Claude, history and undo work
  on it as on any post.
- `draftThread` (`packages/content/src/promo.ts`): one model call writes 3 to 7 posts, dense and
  expert. The facts guard checks each post (`guardParts` in `packages/core/src/grounded.ts`) and
  names the post it flags. The first post carries no link. The funnel link rides on the last.
- Checked at save, approve and post (`threadUnfit`): 3 to 7 posts, each 280 or under as X counts
  (a link is 23), the last with its link.
- Editor: a box per post with its count out of 280 (the last counts its link), Split here, Merge
  with next, Up, Down, and the guard's flags under a post. Beside it, the chain as X shows it.
- Posting (`packages/channel-x/src/content.ts`): post 1 with its media and settings, then each
  next post as a reply to the last. If a later post fails, the thread stays posted and the draft's
  notes say which posts to reply by hand. Same approval path as any X post.

### Carousel

- One slide set, 5 to 10 slides, a title and up to 4 short lines each
  (`packages/core/src/content/slides.ts`). Two drafts share it through `deck`: a LinkedIn
  document post and an Instagram carousel. A save writes both (`saveSlides` in
  `packages/content/src/carousel.ts`).
- `draftCarousel`: one model call for the slides, the LinkedIn post and the Instagram caption,
  each slide guarded.
- Rendering: `slidesHtml` draws the slides in the title cards' look. Playwright HTML to image
  (`packages/content/src/slide-paint.ts`) shoots a 1080 square PNG per slide and prints the same
  page as a PDF. Local chromium, or the box's over CDP (`WREN_CDP_URL`). Files go to the media
  bucket. A changed set reads as not drawn (`slidesKey`).
- Editor: Slides above Basics, with a strip of each slide as it renders, title and lines per
  slide, Up, Down, Add after, Remove, Save slides and Draw, and download links. Beside it,
  Instagram's swipe or LinkedIn's document post.
- Upload is "In development" in the editor. Approve refuses a carousel and says so. Download the
  files and post by hand.

### Promote picks the piece

- Promote asks what to draft: a post on each channel, an X thread, a carousel, or all three
  (`pieces` on ContentDesk `promote`, `MarketingConsole.promote`, and
  `wren content promote --pieces`). Default: the posts, as before.
- Videos → Promos lists X thread and Carousel with their state and Open links. TikTok and Follows
  stay "In development".
- `ContentDesk.slides` and `MarketingConsole.draftSlides` save a set and draw it. CLI:
  `wren content slides <draft> [file] [--draw]`.

## Build order (after this)

1. Written-post adapters: Reddit (the sub's rules read into the prompt and checked before
   approve), LinkedIn (hook plus short lines), X (dense). One idea, three drafts. Today's
   `shape` lines become per-platform briefs with examples.
2. Built (third pass): X thread, 3 to 7 posts in one draft, posted as replies in a chain.
3. Built (third pass): carousel, one slide set as an IG carousel and a LinkedIn PDF. Next: the
   upload (LinkedIn document, Instagram carousel container).
4. Follows: X and IG, within limits, gated like LinkedIn invites.
5. Comments on others' posts for X and IG, through the same examples.
6. Joining watched subreddits from the place's account.
7. Built (second pass): a lander hop for a video (`/go/<ch>/<stage>/<post>?v=<youtube id>`),
   counted at the edge like a site link.
8. TikTok draft from the vertical file at the video's Approve.

## Cost

$0 new. A promo is up to 4 model calls on the fleet's model (Cohere credits on prod). Examples
add a few hundred tokens per comment draft.

## Decision log

- 2026-10-07: written from William's model (relayed) and the gap check.
- 2026-10-07: stage names Reach, Trust, Convert (top, middle, bottom). Target is where the post
  sends people, separate from stage: a Convert post can point to booking or the site.
- 2026-10-07: the link is derived from stage, target and video, not stored, so it never goes
  stale when the video uploads or the target changes. `linked` is the only stored choice.
- 2026-10-07: a video link goes straight to YouTube. The lander's `/go/` lands only on our
  pages and records the visit in the browser, so it can't count a hop to YouTube yet (build
  order 7). Replaced the same day: the hop is built.
- 2026-10-07: `WREN_CONTENT_LINK_SITE` removed (unset on prod): the footers already name
  wrenautomation.com, and two link paths would drift.
- 2026-10-07: Instagram promo rides on a rendered vertical or Short. IG can't post words alone.
- 2026-10-07: `linked` is nullable. Null follows the platform rule, so a rule change reaches every
  draft he hasn't switched by hand, and no insert path has to set it.
- 2026-10-07: Ask Claude on a comment does not read the examples yet; the drafting prompts do.
  Replaced the same day: it reads them.
- 2026-10-07: a Wren video link goes through `/go/?v=`, so a click on a promo is counted like a
  site visit. The hop row counts as a visit in the site rollups; that's intended.
- 2026-10-07: a client's video link stays its own YouTube URL. Its traffic is not Wren's to
  count, and a client's site link needs its own lander first.
- 2026-10-07: a client's Promote is checked in MarketingConsole before it starts, then runs on
  the desk unawaited. The portal says what's wrong at once; the drafts take a minute.
- 2026-10-07: a thread is one draft, its posts split by a `---` line in the text. The draft box,
  Ask Claude, undo and history keep working, and approve stays one decision.
- 2026-10-07: a thread that fails partway stays up. The notes say what to reply by hand; a retry
  would post post 1 twice.
- 2026-10-07: a carousel is two drafts sharing one slide set (`deck`). Each platform keeps its
  own words and verdict; the slides stay one.
- 2026-10-07: slides render with Playwright from one HTML page, the same page the editor's strip
  draws. The video title cards' renderer is ffmpeg drawtext, wrong for multi-line slides.
- 2026-10-07: the carousel upload stays in development. Approve refuses it so nothing reaches the
  scheduler that can't post.

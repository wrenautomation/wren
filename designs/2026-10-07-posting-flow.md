# Posting flow: posts, Reels, invites and comments, all gated (2026-10-07)

William, 10-07: "genuinely start posting, and have the comment replies", everything "always gated
for my approval". Targets:

- YouTube: 2 videos a week, plus 5 auto-clipped Shorts a week.
- Instagram: auto-clipped Reels.
- LinkedIn: 1 post a day, 20 connection requests a day ("highly relevant, qualified, key
  decision-makers, or content based, big companies"), and 10 comments a day on others' posts.
- Reddit: 1 post a week and 5 comments a day.
- Replies: auto replies to all comments on our posts.

## Answer first

Most of the loop exists (content desk, social inbox, video editor, invites, Reddit discovery).
Five gaps, built here. Every path is draft → To approve → his Approve → send. Nothing sends
without the click.

1. **Planner stall.** The plan counted every waiting draft of any date as filling tomorrow, so old
   drafts said "every slot filled". Now only drafts holding tomorrow's slots count. Slots per
   platform are one command, and Approve uses the same slots.
2. **IG Reel draft.** Approving a Short also writes an Instagram Reel draft from the same render.
   It waits in To approve; his Approve there posts it.
3. **Invites gated and targeted.** The sweep proposes the day's invites with person, title,
   company, size and a one-line why. He approves one by one or in a batch. Only approved ones
   send, under the ramp. Filters: company size, decision-maker titles, niche, people who engaged
   with us (ranked first).
4. **Comments on others' posts.** A daily read finds recent posts (topic searches, companies we
   follow, key people), drafts a comment in his voice, and queues up to 10 a day in To approve
   with the post shown. Approve comments from Wren's account through the existing route.
5. **Reddit comments.** The discovery loop already queues drafts in To approve and only his click
   comments. Unchanged, not started.

## 1. Planner

- `planFor`'s `waiting` counts `draft` rows whose `scheduled_for` is inside the day. Old drafts
  with no slot or another day's slot stay in To approve and no longer block the plan.
- `wren content planner slots <platform> <HH:MM...> [--days 1-5|2|1,3]` replaces one platform's
  slots in the planner's settings and keeps the rest. `--clear` puts the defaults back. It goes
  through `start`, the loop's only setter, so it starts the planner too.
- `approveDrafts` takes the planner's slots, so a post approved without a slot lands on the
  planned times, not the defaults.
- Prod target (William sets it after deploy): LinkedIn 1 per weekday, Reddit 1 per week.

## 2. Instagram Reel

- `wren video render` also uploads each full Short to the media bucket (`keys.reel-<n>`). Graph
  fetches a public URL, so a path on the Mac can't post.
- Approve on a Short writes the YouTube draft (approved, private, as today) and an Instagram
  draft: `media.kind = video` from `keys.reel-<n>`, caption = the Short's title plus the
  description, status `draft`, no slot. It shows in To approve; Approve there gives it the next
  Instagram slot and `ContentScheduler` posts it as a Reel (`channel-meta` `publish`,
  `media_type = REELS`).
- A Short rendered before this has no `reel-<n>`: Approve says "re-render to make the Reel" and
  still writes the YouTube draft. A second Approve adds a missing Reel draft and nothing else.

## 3. LinkedIn invites

**Gate.** A new outbound state `proposed` on `reach_messages` (before `queued`). The top-up writes
invites as `proposed`, never `queued`. The tick only sends `queued`. Approve moves `proposed` to
`queued` (`ReachDesk.approveInvites`); Skip marks the message `skipped` and the contact
`finished` ("skipped in To approve"), so it is never proposed again. The top-up proposes up to
tomorrow's ramp cap minus what is queued or proposed, so unanswered proposals don't pile up.
Invite from People stays one click: that click is the yes.

**Targeting** (settings `linkedin.invites`, Shop and CLI):

- `minEmployees` (0 = any). A firm with no size known passes unless `knownSizeOnly`.
- `decisionMakers` (default on): titles with founder, owner, CEO/CFO/COO/CTO/CMO/chief,
  president, VP, head of, director, partner.
- `niches`, `titles` as before.
- `engaged` (default on): people who reacted, mentioned or followed us on LinkedIn
  (`social_activity`). They skip the title and size filters and rank first. LinkedIn comment
  authors come back as URNs, not profile links, so commenters can't be matched yet.

**Rank.** Engaged first, then title tier (founder/owner/C-level/partner, then VP/head/director),
then company size, largest first, unknown last.

**Company size.** From what we hold: the agency listing's team size, the SEC ADV's employees
(5A), PPP jobs reported, then the LinkedIn company page read by Exa's cache (`findings` kind `profile`,
`employees`, a range like "11-50" compares by its top). Missing size: the next source is Exa's
company page read (`wren research profile`, free credits) or the autobrowse `/in/{v}?company=true`
read; nothing is bought here.

**Why.** Each proposal keeps its fit on the contact (`reach_contacts.fit`: why, title, company,
size, engaged). The why reads "Founder at Acme, 51-200 people. Reacted to our post." Shown in To
approve with the company.

**Where.** To approve type `connect` ("Invite to send", id `connect:<contact>`): Send invite and
Skip, one or many. Marketing → Invites gains a To approve tab with the same actions. CLI: `wren reach invites proposed|approve
<ids...>|skip <ids...>`, and `set --min-employees --decision-makers --engaged --known-size-only`.

## 4. LinkedIn comments on others' posts

**Reads** (autobrowse, `linkedin@wren` only, never `linkedin` or `linkedin@alt`):

- `GET /search/results/content` (new): posts for a keyword, newest first, past day or week.
- `GET /company/{company}/posts` (new): a company's recent posts.
- Both answer `{posts: [{urn, author, authorUrl, headline, text, at, reactions, comments, url}]}`.
  A card with no post urn is dropped: the comment route needs one. Meter `posts`, 12 a day,
  0 for the personal and research accounts.
- Key people: a content search on their name, keeping posts they wrote. People = accepted
  invites and engagers.

**Store.** Table `linkedin_posts`: one row per post urn (found → queued → commented, or skipped,
dropped), the read kept whole, the draft, why it was picked, and the comment we sent.

**Loop.** `ReachWatch` runs a posts pass once a day on the account in `linkedin.comments`
(empty = off): read the topics, companies and people, keep new posts younger than `maxAgeHours`,
rank (topic match, the author's title, engagement, recency), then draft up to `perDay` (default
10) minus today's queued, one model call each (the fleet's model, the LinkedIn playbook and
comments SOP via `commentGuide`, his last 5 edits). A drafted post becomes `queued`.

**Approve.** To approve type `lipost` ("Comment to post") shows the post, its author and the draft
box (edit, Ask Claude). Comment calls `ReachDesk.commentPost`: refuses a post already commented,
then `Content.reply` on LinkedIn with the post urn, Wren's token. Skip drops it.

Settings `linkedin.comments`: `account`, `perDay` (10), `topics`, `companies`, `people` (on),
`maxAgeHours` (72). CLI `wren reach posts status|run|list`.

## 5. Reddit comments

`RedditReads/wren` reads, ranks, drafts and sets threads `queued`; they show in To approve as
"Thread to answer". Only `ReachDesk.commentThread` posts, from his click. The loop is off.
When he wants it: `node scripts/prod-wren.mjs reach discovery start`.

## Cost

$0. Drafts on Cohere credits (10 comments, 20 invite whys are code, no model). autobrowse page
loads on the Mac: about 6 searches a day plus the comments and invites. S3: a Reel is about
75 MB, cents a month.

## Decision log

- 2026-10-07: written from his targets and the gap check. Invites gate with a message state, not
  a flag, so the tick needs no change to hold them. Engagers bypass the title and size filters:
  his "or content based". A size range compares by its top so "big" isn't missed on a range.
- 2026-10-07: LinkedIn comments read by search, not the people activity flow: that page's cards
  carry no post urn on the current layout, and the comment route needs one.
- 2026-10-07: built item 3. Size reads the raw columns, not the `*_facts` views (too slow per
  person). "Vice President" is tier 2, not tier 1. Prod had no LinkedIn engagers yet.

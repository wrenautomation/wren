---
type: object
cluster: content
universe: live
status: verified
verified: 2026-10-14 (comment proof build)
entity: packages/outreach/src/schema.ts:685
---

# comment-proof (is our sent comment there for a stranger)

Each comment we send (a Reddit thread answer, ours on someone's post, our answer to a comment on our post) is checked at 2 minutes, an hour and a day: Live (a signed-out reader sees it), Hidden (only our account sees it: a filter or a mod holds it), Missing (gone even for us), or Checking (not read yet, or the read said nothing). Each check keeps a screenshot.

## Why this shape

2026-10-14 (`designs/2026-10-14-comment-proof.md`): our Reddit accounts have 1 karma and a signed-out read of one thread did not show our comment, while the account's own page did. A send that returns 200 is no proof. The signed-out reader decides live; the account's own read tells hidden from missing. Wren reads through the sites facade in official API shapes only (no autobrowse import).

## Shape

- Table `comment_proofs` (`packages/outreach/src/schema.ts:685`, migration 0253): `item` PK (`thread:<id>`, `onpost:<id>`, `comment:<id>`), `platform`, `state` live|hidden|missing|pending, `url` (permalink), `shot` (`s3://` in the media bucket), `note`, `checked_at`, `checks` (every check appended: at, state, note, shot, round)
- Interface `CommentProof.check({platform, ref, parent, url}) → Proof` (`packages/core/src/content/proof.ts:169` `siteProof`): Reddit `reddit-public GET /api/info?id=t1_…`, then `GET /comments/{article}`, then `reddit GET /api/info` as the account; when the signed-out read fails (Reddit 403s it for hours, 10-19) the same two reads run as another Reddit account of ours (`ProofTarget.peers`, from `reach_accounts` not retired), and the note says so; LinkedIn `web GET /read` text match, then `linkedin GET /rest/socialActions/{urn}/comments` as the account. Other platforms stay pending ("no reader for x yet"). The shot is `web GET /proof/shot {url, ref|text}` (autobrowse flow `web/proof-shot`, signed out; www.reddit, since old.reddit walls a signed-out reader)
- Rows `packages/outreach/src/proofs.ts`: `proofTarget` (`:35`), `keepProof` (`:102`: a pending check never covers an earlier verdict; answers warn on round 2 hidden or missing), `proofsSince`, `sentSince` (`:158`, the backfill's list), `warningOf`
- Service `CommentProofs/check {item, round?}` (`packages/outreach/src/restate/proofs.ts:51`); `scheduleProofs` (`:45`) sends rounds 1-3 delayed 2 min, 1 h, 24 h, from `commentThread` (`restate/discovery.ts:480`), `answerComment` (`restate/desk.ts:481`, `:503`) and `commentPost` (`:1087`). Round 2 hidden or missing posts once to Discord's reach lane at `warning`. A used daily cap on the public `/api/info` read keeps nothing and warns no one: the check is sent again, same round, delayed to the reset; one by hand answers pending with the reset time (2026-10-15) Wired in `apps/worker/src/services.ts:1671` (shots via `putMedia`, LinkedIn reader `linkedin@wren`)
- Console: Outreach → Engage views Posted (sent, newest first) and Not live (hidden, missing), column Proof (`packages/content/src/social/records.ts`: `sentRows` `:265`, `proofsBy` `:285`, `PROOF_STATES` `:318`). A sent row's page shows the badge: hover for the screenshot, click for the permalink (`apps/portal/web/src/modules/marketing/proof.tsx`)
- A hidden or missing Reddit proof's note carries the mod's or AutoModerator's reply under our comment (`modNoteIn`, `packages/core/src/content/proof.ts:124`); `keepProof` hands the proof to `learnFromProof`, which keeps the floor it states or holds the sub ([[content/reddit-requirement]])
- Touch history: `person_touch_lines` adds " · Live/Hidden/Missing/Checking" to our comment touches (`packages/core/src/touches-schema.ts`)
- CLI `wren reach proof <item>` (a check now), `--recent` (the last day), `--since 2026-10-12` (backfill, one by one) (`apps/cli/src/reach.ts:776`)

## Connected to

- **joins:** [[content/reddit-requirement]] (a removal teaches a sub's floor)
- **joins:** [[content/reddit-thread]] (`thread:`), [[content/reach-post]] (`onpost:`), [[content/comment]] (`comment:`), [[leads/touch]] (the touch line's state)
- **looks-like-but-is-not:** the send's own result: a 200 from the site says it was posted, not that anyone sees it

## If you change this

- A new send path for comments must call `scheduleProofs`, or it is never checked
- A new platform reader goes in `siteProof`; until then its items stay pending
- Not built: auto-repost, karma building

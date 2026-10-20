---
type: object
cluster: content
universe: live
status: verified
verified: 2026-10-20 (O2, wa-yvs.2: published_id is a platform object)
entity: packages/content/src/schema.ts:115
---

# draft

One idea rendered for one platform, waiting for a person, then a slot, then the wire. Table `content_drafts`. Not an email `messages.state = draft`.

## Why this shape

The model proposes, the code disposes: a draft over the platform's length, missing a required title, or unparseable is never stored (`draft.ts:1`). An edit puts an approved draft back to `draft`, so what goes out is always something a person approved as written (`review.ts:1`). `claim` moves `approved → publishing` in the selecting statement, so nothing posts twice (`queue.ts:37`). `llm` keeps the call record for costs. On a `draft` row `scheduled_for` is the slot the planner gave it: inert until approved (the planner's `approve` setting approves it into that slot as it is made, Wren only), kept by an edit and a redraft, and approve schedules into it while it is ahead and free (`review.ts:100`), else into the platform's next free slot from the planner's settings. Unapproved drafts with no slot in the day don't count toward tomorrow's plan. An Instagram row can be a Short's Reel (`promptVersion` `video`, idea `ref` `video:<id>/short:<n>`). A slot takes at most 2 redrafts a day; a superseded row keeps its slot so they count. The prompt (`v4`) claims no experience the idea doesn't give, and `askGuarded` (`draft.ts:129`) runs the facts guard (`@wren/core/grounded`) with the idea as his own words: made up twice, no row.

A send that did not leave fails no draft. Every publish runs under the ledger claim `draft:<id>` and a send key (`Content.publish { sendKey }`); autobrowse answers a verdict (designs/2026-10-16-maybe-sent.md). Not sent (`before_submit`, `verified_absent`): `markWaiting` (`queue.ts`) puts it back to `approved` in its slot with `error` "Waiting for the browser: …", the pass skips that platform's other drafts and comes back in a minute, no notice; the portal shows "Waiting for the browser" (`Branch.waitingForBrowser`, `pieces.ts`). The next claim clears the error and makes a new key. Only a platform's own no (a 4xx but 408 and 409) fails a draft.

A publish that may have gone out (`unknown`) fails no draft either. It stays `publishing` with "May have gone out: …" (`markUnsure`, `queue.ts`) and its [[content/send-attempt]] `draft:<id>` waits in To approve; an edit says so (`lockedWhy`). Sent or found: `markPublished` with the platform's id (the first comment runs under `<sendKey> comment`). `ContentDesk/settlePost` settles an unsure one: it asks autobrowse again under the same key, at any age (`recheck` and `verifyOnly`, Wren's or a client's with `client`); found or sent runs the same after-publish as the scheduler (`afterPublish`: `markPublished`, the first comment, the `posted` hook), whatever he chose; any other answer leaves his word. Else Mark posted (`markPostedBy`, no id, no numbers, no first comment; the `posted` hook runs), Send again (`sendAgain`, back to `approved`) or Not sent, drop (`dropDraft`: `rejected`, slot cleared, a "rejected" draft event).

Per client: the same table in the client's own database. `ContentPlanner/<c>/daily` drafts through `ContentDesk/<c>/desk` as the client (its About, on its `models` gate, only its login platforms), into its To approve. `ContentScheduler/<c>/posts` holds due drafts (`held`) until `sendsOn(client, "content.posting")`; then posts through `Content.publish` with `client`, on its own login (`packages/content/src/clients.ts`).

## Shape

- `idea_id`, `platform`, `text`, `title`, `media`, `extra` (the platform's post shape, `SHAPES` in `packages/core/src/content/shapes.ts`: checked by `setFields` on save, by approve for required fields, by `postOf` before publish), `status` (`DRAFT_STATUSES`, `:28`), `edited`, `scheduled_for`, `approved_at`, `published_at`, `published_id` (a [[content/platform-object]] post ref, key `fk_content_drafts_platform_published_id_platform_objects`, migration 0312; `stamp` in `queue.ts` resolves the platform's id in the same transaction as the update, a Reddit id becomes `t3_<id>`, one no rule reads leaves it null with a note in `error` and the draft stays published), `url`, `error`, `redraft_of`, `note`, `prompt_version`, `playbook_id` (the [[content/playbook]] the prompt carried), `llm` (`schema.ts:115`)
- Send as: a draft box on a platform with two or more logins shows `AccountPicker` (`packages/ui/src/draft.tsx`); the pick goes through `DraftAsk.set` with `account` into `draft_accounts` (`draft:<uuid>`, migration 0274), and `ContentScheduler` publishes as it (`pickedAccount`, `restate/scheduler.ts`; designs/2026-10-15-accounts-first-class.md)

Citations: `packages/content/src/schema.ts:115`

## Connected to

- **owned-by:** [[content/idea]], [[content/platform]]
- **owns:** [[content/content-metric]]
- **recorded in:** [[content/draft-event]] (every step, who, the words)
- **joins:** [[content/platform-object]] (`published_id`; the post is an object before the row names it)
- **joins:** [[content/media]] (a stored object as `s3://`), the `Content` service (publish)
- **joins:** [[content/funnel]] (every draft's stage, target and link; promo drafts)

## If you change this

- **Hits:** `draft.ts:164`, `review.ts:70`, `queue.ts`, `slots.ts`, `restate/scheduler.ts`, `restate/desk.ts`, `costs.ts`, `lessons.ts` (reads notes and winners), `playbook.ts`, `wren content *`
- **Does not hit:** the platform adapters (they take a `Post`, not a row: `packages/core/src/content/index.ts:122`)

## Surfaces

| Surface | Role |
|---|---|
| `ContentDesk.draft/redraft` | writes |
| `ContentDesk.write` (Marketing → Studio, `apps/portal/web/src/modules/marketing/studio.tsx`; Write's `/marketing/write` redirects there, `studioHref`) | writes his own words, one post or a batch split on `---`, a draft per platform with `prompt_version` `own` (`packages/content/src/own.ts`; the fit rules in `write.ts`, which the composer previews with); `thread` makes one X thread (`ownThreadOf`); `adapt` drafts each platform by model instead; `go` `slot` or `now` approves after. `ContentDesk.waiting` reads the waiting drafts by idea for its board (with `thread` and `missing`), whose cards save through the engine under the draft box's key; `approve` takes `now` for the next pass or `at` for a picked time. Studio opens on the plan's To make, then a picker (`MAKES`: post, thread, carousel, story, blog, video showing the newest recordings; `?make=`, `?platform=` narrows it); `ContentDesk.carousel` (`carousel-box.tsx`) takes slides typed as text (`slidesFromText`) and a caption, writes an Instagram and a LinkedIn draft on one `deck` (`writeCarousel`), draws them, then `go` |
| `ContentDesk.approveVideo`, `wren video approve` ([[content/video-edit]]) | write an approved, private YouTube draft of a rendered video |
| `wren content approve/reject/edit`, `ContentDesk.approve/reject/edit` (the console) | writes; reject takes an optional `reason` and `note`, kept in [[content/draft-event]] |
| `marketing.draft` (`marketing_draft_records`, every status but published; `due` = slot else drafted, Drafts' first view Up next sorts by it), `marketing.post` | read; their `load` adds the preview's text, cap and feed cut (`PLATFORM_SPECS.feed`), and for a draft the idea's other drafts (`siblingsOf`, the editor's Other platforms, `siblings.tsx`). Its head has Approve, Schedule (day and time) and Post now (a client's drafts offer Post now only where the `post_now` portal flag is on, and `MarketingConsole/approveDraft` with `now` refuses without it, 403; migration 0268 seeds it on for `wren_test`); each sends the row's `version` (`left(md5(text), 12)`, `draftVersion` in `packages/content/src/review.ts`) as `expect`, from Drafts and To approve alike, and `approveDrafts` refuses words that moved since by name, 409 `code: "conflict"`. Marketing → Content → Today (a Day page, `apps/portal/web/src/modules/marketing/index.ts`) shows scheduled drafts by `scheduled`, posts by `published`, waiting drafts by `created` (carried onto today) with Approve; every Content page has the platform switch, and so do Plan, Studio (the chip picks that platform and narrows its board) and Engage; hand-drawn pages get it from `HandSwitch` (`apps/portal/web/src/records.tsx`). Marketing's sidebar is Today, Studio, Engage, Feed, Posted, Numbers and More (Recordings, `/marketing/videos`, is hidden and lights Studio) (`mainPlusMore`): More lists every other page by group and lights while one is open |
| the detail's draft box (`DraftAsk/set`, who = the signed-in person), `DraftAsk/ask` (Claude's rewrite), `DraftAsk/undo`, `wren drafts set draft:<id>` | write `text` through `editDraft`, one `runs` row each (`draft-ask`/`draft-set`/`draft-undo`, keeps the text replaced); `set` answers with its `turn` (the box's "Edited by" line, no re-read) and a post's new `version`, patched into the row so Approve names it, and an `expect` that moved is `staleRefusal("draft")` (`packages/core/src/refusal.ts`): 409 with `code: "conflict"` (other refusals 400); `marketing.draft`'s `load` adds the thread (`draftTurns`, `packages/core/src/ask.ts`). The `draft-set` rows are his edits: `draftEdits`/`editsFor` feed the last 5 per kind to every drafting call and the Ask Claude prompt, `wren drafts edits` prints them. Kinds: `packages/content/src/draft-ask.ts` |
| `ContentDesk.fields` / `attach` (`marketing/draftFields`, `marketing/draftAttach`), `wren content fields <id> key=value` | write `extra` and the title through `setFields`; attach puts a thumbnail, cover or subtitles file (2 MB) in [[content/media]] first. The detail's `shape` (`shapeView`, `packages/content/src/shape-view.ts`) feeds the field editor (Basics, Media, Details) and the live platform preview on Drafts, To approve and Posts (`withShape` in `apps/portal/web/src/modules/marketing/fields.tsx`, previews in `shape-preview.tsx`); the record detail draws it as `RecordExtras.form` and `aside` (`packages/ui/src/records.tsx`, `Beside`: two columns on a wide page, Preview button on a phone) |
| `ContentScheduler/default`, `ContentScheduler/<c>/posts` | moves to published/failed, or leaves a lost publish `publishing` on the send ledger; a client's waits on its live flag |
| `ContentPlanner` | reads slots; with `draft` on, gives each new draft its slot |
| `ContentMetrics` (each read cut at its limit, its post skipped; 3 in a row held, stage `loop.content-metrics/<key>`) | reads |
| `wren status` (`packages/content/src/status.ts`) | reads counts, oldest draft, this month's tokens |

## See

- Source: `packages/content/src/draft.ts`

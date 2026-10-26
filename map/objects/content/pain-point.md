---
type: object
cluster: content
universe: live
status: verified
verified: 2026-10-26 @ HEAD
entity: packages/outreach/src/pain.ts
---

# pain-point

A pain a post's author states about their own business, kept with the quote that proves it, and the person's entry onto Wren's outreach line because of it. The pain points line of `designs/2026-10-25-ingestion-engine.md` (phase 3): a `sourced` out line on Wren's map whose list the pain pass fills. `packages/outreach/src/pain.ts`; loop `PainFeed/all` (`apps/worker/src/pain-feed.ts`).

## Why this shape

A pain is a finding with proof like a study's claim ([[research/study]]), so his calls and the SOP readers see one kind of fact. It sits on the post's document, not the person: the findings check (`packages/research/src/schema.ts`) lets a `fact` carry no person, and a post's author is a handle profile ([[leads/profile]]), never a `people` row (a people row needs a firm). The person link is the fire and a `finding` line on their timeline. The line's feed is the reach reads the engine already makes ([[content/reach-post]]), so it costs no platform call. The shape's `sourced` source is the "transfer": a new subject enters at a source, no edge changes one.

## Shape

- Feed: `reach_posts` past the cursor (the last id read), state `found | queued | commented`, `fit` at or over the platform's `minFit` (`allCommentsSettings`), posted (or found) within 14 days (`MAX_AGE_DAYS`), with a handle, author not passed on ([[content/reach-pass]]). Each platform the reach reads: LinkedIn, X, Instagram.
- Read: `readPains` asks the model (`completeAndParse`, run name `pain.read`, 10 posts a call, `PER_CALL`) for `{post, pain, quote}` per post that states a pain of the author's own business; a tip, a job ad, a celebration or a pitch is none.
- Proof rule (`proven`): the quote, whitespace and curly quotes normalised, case aside, 12 to 400 characters, must be in the post's text; else the pain is dropped and counted (`unproven`).
- Kept (`keepPain`): the post as a document (`keepDocument`, kind `post`, `fetchTier` the platform; one per url and content hash); a `findings` row `kind fact`, `fact_key doc:<document>/pain/<sha256(quote)[0:12]>` (`painKey`), `value {pain, platform, handle, author, post, profile?}`, `document_id`, `source_url`, `confidence 1`, `via pain`, `question pain`, `proof {quote}`, `by model`; upsert on the key. The author's handle profile (`resolveHandle` then `profileOf`), and a `profile_events` line `kind finding`, `channel` the platform, `summary "Pain: …"`, `body` the quote, `link` the post, `source pain`, `source_id rp:<id>` (one per post).
- Fire (`painFired`): `trigger.source` with `source import:<batch>`, subject `source:import:<batch>:rp<id>`, data `{profile, row: rp:<id>, source, post, pain, cause {kind sourced, ref, at}}`. The executor opens the author's journey at the shape's sourced source that names the list ([[platform/journey]]); a second post by an author with an open journey is refused as a move back (expected). Without a profile (no handle) the finding is kept and nothing fires.
- The list: one `imports` row `source_type pain`, `source_ref reach_posts` (`painBatch`, made once, found again by those two). Its members are the journeys opened at it, not `people` rows. The shape's source must name it (`import:<id>`); `liveSources` (`@wren/pipeline/sourced`) says which lists the newest shape's live sourced sources name, and while the list is not among them the pass returns `waiting` and keeps its cursor, so no post is lost before the map holds the line.
- Loop `PainFeed/all` (Wren only): state `cursor`; every 5 min, 5 s while `more` (50 posts a pass); ledger `journeys pain`; `PainFeed/all/status` shows `scanned, read, pains, unproven, fired, waiting, more`. The model is the worker's bulk one (gateway).
- Measure: `source_numbers` (`packages/pipeline/src/views.ts`, migration 0348) per source and open day: `opened`, `deals`, `collected_cents`, `cost`, `replied` (journeys that moved on a cause of kind `touch` or `reply`, an open not counted), `booked` (moved on `booking`). `NumberRow.replied|booked` on source nodes and out lines; `pipeline.number` fields Replied, Booked; the Map's line panel says `Replied:` and `Booked:` (`lineSays`).
- Outreach: none new. The reach comment draft on the same post waits in To approve (`marketing.approval`, `onpost:<id>`); the react station's own action is the comment.

## If you change this

- A new platform in `reach_posts` joins by itself (the settings give its `minFit`).
- The finding's shape (`value`, `question`) is read by nothing yet but the SOP extract filter in `packages/pipeline/src/lines.ts` leaves `doc:%/study:%` keys only: a pain key is `doc:%/pain/%`, so a line's extract over the post's document would list it. Keep the key prefix if a reader comes to depend on it.
- The timeline kind `finding` lives in `TIMELINE_KINDS` and `TIMELINE_KIND_NAMES` (`packages/core/src/profiles-schema.ts`) and `KIND_ICONS` (`apps/portal/web/src/modules/people/timeline.tsx`, icon `quote`).
- Wren's map must hold the line (shape v8: line `pain`, station `pain`, track `pain_to_hub`, `hub_to_react.entries` + `pain`) with the batch's id; `shapeContext` (`packages/pipeline/src/store.ts`) refuses a source whose import is missing.

## Connected to

- **joins:** [[content/reach-post]] (the feed, and the comment draft that is the outreach), [[research/document]] (the post), [[research/finding]] (the pain), [[leads/profile]] (the author, by handle; the `finding` timeline line), [[platform/journey]] (the sourced open; `source_numbers`), [[platform/shape]] (the `pain` line, its `sourced` source), [[content/reach-pass]] (passed-on authors are left)
- **looks-like-but-is-not:** [[research/study]] (claims are per page of a study; a pain is per post and opens a person's journey)

## Surfaces

| Surface | Reads |
|---|---|
| People → person → timeline | the `finding` line (Pain: …, the quote) |
| Map (Numbers) | the `pain` line's Opened, Replied, Booked |
| Outreach → Engage, To approve | the reach comment draft on the post (unchanged) |
| `PainFeed/all/status` | the last pass |

## See

- Tests: `packages/outreach/src/pain.test.ts` (proof rule, key, prompt, fire), `packages/outreach/test/integration/pain.test.ts` (the pass on Postgres: batch once, waits, keeps and drops, cursor, idempotent, filters), `packages/pipeline/src/workflow.test.ts` (a shape with the line is sound)
- Design `designs/2026-10-25-ingestion-engine.md` phase 3 and its 2026-10-26 log entry; docs `docs/restate-operations.md` (`PainFeed/all/start`)

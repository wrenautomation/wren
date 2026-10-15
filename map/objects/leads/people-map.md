---
type: object
cluster: leads
universe: live
status: verified
verified: 2026-10-15 @ 448e1370
entity: packages/core/src/people-map-schema.ts:52
---

# people-map

Each live [[leads/profile]]'s stage, warmth and why, subscriptions, replies, first and last touch, and persona. Table `profile_rollups`, rebuilt from the source tables every 15 minutes; `profile_site_reads` holds Wren's site visit counts. Nothing here is a source of truth.

## Why this shape

Warmth is the one question before any outreach: has this person ever come toward us? The answer spans a dozen tables, so the list and segments read plain columns here instead. The warm gate (`coldOpenerRefusal`) never reads the table: it runs the same query live for the few profiles a send names, so it's right at send time.

One statement (`rollupRows`) is the whole rule; the refresh upserts only changed rows (`is distinct from`). About 9 s over 158k profiles on prod. `stage` and `warmth` are mirrored as traits only when not the default (absent means stranger, cold), so a Trait changed trigger hears "replied" or "warm" without 158k trait rows.

## Shape

- `profile_rollups` (`packages/core/src/people-map-schema.ts:52`): PK `profile_id`. `stage` (`STAGES`: stranger, lead, replied, booked, client, past_client), `warmth` (warm|cold), `why` (reason keys, comma list), `warmth_line`, `warm_since`; `<k>_n`, `<k>_first`, `<k>_last` for each of `ROLLUP_COUNTS` (the `WARM_REASONS` subscribed, replied, booked, form, visited, watched, opened, clicked, engaged, plus contacted); `subscriptions`, `replied_channels`, `replied_last_channel`; `first_touch_at/_channel/_touch`, `last_touch_at/_channel/_touch`, `came_from` (oldest key's source); `persona`, `persona_role`, `persona_niche`, `persona_size`; `refreshed_at`. Indexes on stage, (warmth, warm_since), persona, replied_last.
- `profile_site_reads`: per profile with a `visitor` key, page and watch-page (`/watch/`, `/v/`) counts and first/last, from the lander's log (`readSiteCounts`, 200 a pass, oldest read first). Counts only.
- Rules (`rollupRows`, `packages/core/src/people-map.ts:118`): replies are email `reply` thread events, inbound texts, site chat, their social reply/DM or a comment answering ours, and a `replied` response on ours. Forms and bookings count as replies for stage. Opens and clicks count past 2 minutes of sending (sent log's rule). Our sends alone are `contacted`, never warm. Client: a `Paid` payment line, a member of a real client workspace, or trait `lifecycle` = client; `past_client` is that trait only.
- Persona: title (people row, else trait `title`) by `ROLE_PATTERNS`; niche `companies.niche`; size from `companies.raw` (`5A`, `Company Size`, `agency.team_size`). Traits `persona_role/_niche/_size` win. `fillPersonas` (`:766`) is the LLM hook (`wren people personas --model`), never run by a pass.
- `refreshPeople` (`:436`), `warmthOf` (`:545`), `coldOpenerRefusal` (`:589`), `keyLooseHandles` (`:610`), `findProfile`, `listPeople`.
- `PeopleMap` object (`packages/core/src/people-map-pass.ts:63`): key `fleet` or `<client>/fleet`, `wake` runs `peopleMapPass` (loose handles keyed, Wren's site counts, refresh), at most once a minute; `status`. `PeopleMapNet/all` (`:96`) wakes each every 15 minutes.
- View `profile_records` joins it (defaults before the first pass); record `people.profile` gets Stage, Warmth, What they did, Persona, Role, Size, Niche, Replies, touches; tabs Warm, Replied, Booked, Clients, Cold, Subscribed. The person page's Warmth section reads live.

Citations: `packages/core/src/people-map-schema.ts:52`, `packages/core/src/people-map.ts:118`, `packages/core/src/people-map-pass.ts:63`

## Connected to

- **owned-by:** [[leads/profile]] (`profile_id`)
- **reads:** [[email/message]], [[email/thread-event]], [[sms/sms-message]], [[leads/touch]], [[leads/consent]], [[leads/person]], [[leads/company]], the lander export (site counts)
- **feeds:** [[leads/segment]] (plain columns by `profile_id`; traits `stage`, `warmth`), the warm gate in `leadRefusal` (SMS enroll, DM enroll, People → DM) and email `sendDue` (`stopped_warm`, not the reactivation sequence)

## If you change this

- **Hits:** `packages/db/drizzle.config.ts`; a migration for any column; `profile_records` view; `ROLLUP_COLUMNS` must match the table; the warm gate in every sender; segments reading its columns
- **Does not hit:** the source tables (read only); profiles and keys (except `keyLooseHandles`, through `resolveProfile`)

## Surfaces

| Surface | Role |
|---|---|
| People → People (portal) | reads |
| `wren people show/list/warm` | reads |
| `wren people refresh`, `PeopleMap/<key>/wake` | writes |
| `wren people personas` | writes `persona_*` traits |

## See

- Source: `packages/core/src/people-map.ts`, `packages/core/src/people-map-pass.ts`
- Design: `designs/2026-10-15-people-map.md`

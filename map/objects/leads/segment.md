---
type: object
cluster: leads
universe: live
status: verified
verified: 2026-10-19 @ 05e9f4a4
entity: packages/core/src/segments-schema.ts:38
---

# segment

A named group of profiles in a workspace: live (a rule kept true), manual (by hand) or snapshot (a rule's answer, frozen). Table `segments`; who is in is [[leads/segment-membership]]. Called Groups in every word a person reads (People → Groups, `/people/groups`); table, record and handler names keep "segment".

## Why this shape

A rule is data (`Rule`, a group of conditions and groups), compiled to one SQL test on `profiles p` (`compileRule`, `packages/core/src/segments.ts:503`) over [[leads/profile]] traits, its timeline, [[leads/consent]] by [[leads/profile-key]], the [[leads/sent-log]] by `key_kind` + `key_value`, [[leads/channel-stats]] steps (`profile_steps`), and other segments' members. The same rule reads as text (`packages/core/src/segments-text.ts`: `ruleText`, `parseRule`), so agents write it in the CLI and the portal's Edit as text; JSON stays the stored form. Members are stored, not recomputed per read, so entries and exits are events the executor can hear and a [[leads/broadcast]] reads a fixed list. One recompute is one statement (`setMembers`): delete who left, insert who came, log both.

A segment keeps its kind. A live one recomputes on save and on every pass, dependencies first (`recomputeOrder`); a rule that would read itself is refused (`cycleOf`). A snapshot counts once when made and again on Retake. A manual one has no rule; people go in from the People list (Add to group: a box that lists the manual groups and takes a new name, `addToGroup`, `packages/core/src/segments.ts`; a name that matches a live or snapshot group is refused) and out from its members.

What uses it (workflows' Group triggers, other segments' rules, broadcasts not yet done: `broadcastUses`, `packages/core/src/broadcasts.ts:856`) is written on the row by each pass (`setUses`, `:802`), so the list says it without reading every workflow. Anything that uses it moves `used_at`; unused 90 days, it's archived (`archiveUnused`, `:784`), members kept. Restore is one click. Archive by hand is refused while it's used.

## Shape

- `segments` (`packages/core/src/segments-schema.ts:38`): `name` unique, `kind` live|manual|snapshot, `rule` jsonb, `words` (what it was described as), `state` active|archived, `size`, `computed_at`, `uses` jsonb `[{kind, id, name}]`, `used_at`, `archived_at`, `by`. In every workspace database.
- SQL functions `segment_date(jsonb)`, `segment_number(jsonb)` (migration 0252): a trait read as a day or number, null when it isn't one.
- `segments.version` int, bumped by every save; `segment_versions` (PK `segment_id`+`version`): name, kind, rule, words, by, at per save (migration 0270 backfills v1). Read: `segmentVersions`.
- Conditions: trait (is, contains, gt, lt, exists, before, after, in_next, in_last, one_of), event (a timeline kind, optional channel and `match` words, at least N or at most M times in D days, optional `after`/`before` the person's first line of a kind), consent (channel + state, or `opted_out` from `sms_contacts`), message (a sent-log state on a channel, optional campaign words, at least/at most, counting those past it on the ladder: `MESSAGE_STATES`), step (a funnel step from `profile_steps`, optional channel and source, in D days; booked/paid on a channel = after a reach there), journey (a row in `pipeline.journeys`: optional `node`, or `reached` node (it is where the journey sits or the journey's `trail` ends an edge there), status open|done|dropped, entry (a source node id), moved or opened in D days; `journeySql`, `segments.ts:460`), segment. Any with `not`. Groups all|any, 30 conditions, 4 deep (`RULE_MOST`).
- `inSegment(db, profileId, segment|rule)` (`:1060`): one person against a rule now, following `merged_into`. The executor's In group step (`logic.segment`, `packages/core/src/segment-step.ts`) asks it.
- Writes: `saveSegment` (`:827`), `retake`, `archiveSegment`, `restoreSegment`, `addMembers` (`:535`), `removeMembers`. Reads: `previewRule` (`:1031`, count + 20 names + words), `segmentMembers` (`:596`, B6's read, pages by profile id, counts as a use).
- Describe: `describeSegment` (`:926`) asks a `SegmentModel` (the worker passes Wren's `llm`, or a client's metered one, part `people.segments`), parses with `readRule`, refuses an unknown segment id, names unknown trait keys. Never saves; the page shows the rule's words for a yes.
- Portal: `PeopleConsole` routes `segmentContext`, `segmentPreview` (read), `segmentDescribe`, `segmentSave`, `segmentArchive`, `segmentRestore`, `segmentRetake`, `memberAdd` (input `group`: id or name), `memberRemove` (act), `segmentText`, `segmentVersions` (read) (`packages/core/src/people-console.ts:101`). No client named and a team login: Wren's segments on main; else the client's database.
- Records `people.segment` (`packages/core/src/segment-records.ts:66`, view `segment_records`) with `load` = rule in words and 7/30-day moves; the Data index's "Used by" adds "Group <name>" per data point a rule reads (`dataOf`).

- Journeys: a journey rule reads `pipeline.journeys` in the same workspace DB. Text keyword `journey [at|reached N] [open|done|dropped] [entry E] [opened] [in Nd]`. A rule saved before the shape (`funnel`, `stage`) still reads: `stage` is the node, `funnel` is ignored. `journeyShape(db)` (`segments.ts:1324`) gives the editor and the describe prompt the newest shape's nodes that hold people (id, name, kind, depth from `shape_versions.depths`) and its source ids (`segmentContext.shape`). Migration 0298 put a statement trigger on `pipeline.journeys`, 0306 added `node` to it, and 0307 (which dropped `stage`) recreated it on `node` and `status`. It calls `wren_wake('Segments/fleet')`, so a live group refreshes when a journey moves. Core reads the tables by name; it imports nothing from `@wren/pipeline`. A shape's `group` source listens to this group's entered events ([[platform/shape]]).

- CLI: `wren groups list|show|check|count|save|members|history|in` (`apps/cli/src/groups.ts`; the rule text keyword is `group`, `segment` still parses), rules as text, `@file` or stdin.

Citations: `packages/core/src/segments-schema.ts:38`, `packages/core/src/segments.ts:460`, `packages/core/src/segments.ts:503`, `packages/core/src/segments.ts:673`, `packages/core/src/segments.ts:1324`, `packages/core/src/segments-pass.ts:223`

## Connected to

- **owns:** [[leads/segment-membership]]
- **reads:** [[leads/profile]], [[leads/profile-key]], [[leads/consent]], [[leads/sent-log]], [[leads/channel-stats]], [[platform/journey]] (`journey` condition)
- **feeds:** [[platform/executor]] (`trigger.segment`, through the segments pass; `logic.segment` asks `inSegment`); [[platform/shape]] (a `group` source opens journeys when people enter); [[leads/channel-stats]] (filter); [[leads/broadcast]] (read once when one starts)
- **looks-like-but-is-not:** a saved view (a list filter, per viewer); `wren campaigns` cohorts

## If you change this

- **Hits:** `packages/db/drizzle.config.ts` (lists `segments-schema.ts`), a migration for any table or view change; `compileRule` when a source table or view it reads changes (`profile_traits`, `profile_timeline`, `consents`, `sms_contacts`, `sent_records`); `describePrompt`'s shape text, `segments-text.ts` (grammar) and `apps/portal/web/src/modules/people/segments.tsx` (the editor mirrors the conditions) when a condition changes
- **Does not hit:** sending; the sources (only read)

## Surfaces

| Surface | Role |
|---|---|
| People → Groups (portal) | reads, writes |
| People → People, Add to group | writes (manual; a new name makes the group) |
| `Segments/<key>/wake` | writes (recompute); journey moves wake it |
| `wren groups` | reads, writes |
| executor `logic.segment` ("In group") | reads |

## See

- Source: `packages/core/src/segments.ts`, `packages/core/src/segments-pass.ts`
- Design: `designs/2026-10-14-customerio-audit.md` (B5), `designs/2026-10-15-channel-stats.md` (rules as code, versions, step)

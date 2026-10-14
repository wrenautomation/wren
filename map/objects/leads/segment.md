---
type: object
cluster: leads
universe: live
status: verified
verified: 2026-10-14 @ 7d42f31a
entity: packages/core/src/segments-schema.ts:38
---

# segment

A named group of profiles in a workspace: live (a rule kept true), manual (by hand) or snapshot (a rule's answer, frozen). Table `segments`; who is in is [[leads/segment-membership]]. People → Segments.

## Why this shape

A rule is data (`Rule`, a group of conditions and groups, `packages/core/src/segments.ts:146`), compiled to one SQL test on `profiles p` (`compileRule`, `:319`) over [[leads/profile]] traits, its timeline, [[leads/consent]] by [[leads/profile-key]], the [[leads/sent-log]] by `key_kind` + `key_value`, and other segments' members. Members are stored, not recomputed per read, so entries and exits are events the spine can hear and a [[leads/broadcast]] reads a fixed list. One recompute is one statement (`setMembers`): delete who left, insert who came, log both.

A segment keeps its kind. A live one recomputes on save and on every pass, dependencies first (`recomputeOrder`); a rule that would read itself is refused (`cycleOf`). A snapshot counts once when made and again on Retake. A manual one has no rule; people go in from the People list (Add to segment) and out from its members.

What uses it (workflows' Segment triggers, other segments' rules, broadcasts not yet done: `broadcastUses`, `packages/core/src/broadcasts.ts:856`) is written on the row by each pass (`setUses`, `:802`), so the list says it without reading every workflow. Anything that uses it moves `used_at`; unused 90 days, it's archived (`archiveUnused`, `:784`), members kept. Restore is one click. Archive by hand is refused while it's used.

## Shape

- `segments` (`packages/core/src/segments-schema.ts:38`): `name` unique, `kind` live|manual|snapshot, `rule` jsonb, `words` (what it was described as), `state` active|archived, `size`, `computed_at`, `uses` jsonb `[{kind, id, name}]`, `used_at`, `archived_at`, `by`. In every workspace database.
- SQL functions `segment_date(jsonb)`, `segment_number(jsonb)` (migration 0252): a trait read as a day or number, null when it isn't one.
- Conditions: trait (is, contains, gt, lt, exists, before, after, in_next, in_last), event (a timeline kind at least N times in D days), consent (channel + state, or `opted_out` from `sms_contacts`), message (a sent-log state, counting those past it on the ladder: `MESSAGE_STATES`), segment. Any with `not`. Groups all|any, 30 conditions, 4 deep (`RULE_MOST`).
- Writes: `saveSegment` (`:670`), `retake`, `archiveSegment`, `restoreSegment`, `addMembers` (`:535`), `removeMembers`. Reads: `previewRule` (`:835`, count + 20 names + words), `segmentMembers` (`:596`, B6's read, pages by profile id, counts as a use).
- Describe: `describeSegment` (`:926`) asks a `SegmentModel` (the worker passes Wren's `llm`, or a client's metered one, part `people.segments`), parses with `readRule`, refuses an unknown segment id, names unknown trait keys. Never saves; the page shows the rule's words for a yes.
- Portal: `PeopleConsole` routes `segmentContext`, `segmentPreview` (read), `segmentDescribe`, `segmentSave`, `segmentArchive`, `segmentRestore`, `segmentRetake`, `memberAdd`, `memberRemove` (act) (`packages/core/src/people-console.ts:101`). No client named and a team login: Wren's segments on main; else the client's database.
- Records `people.segment` (`packages/core/src/segment-records.ts:66`, view `segment_records`) with `load` = rule in words and 7/30-day moves; the Data index's "Used by" adds "Segment <name>" per data point a rule reads (`dataOf`).

Citations: `packages/core/src/segments-schema.ts:38`, `packages/core/src/segments.ts:319`, `packages/core/src/segments.ts:670`, `packages/core/src/segments-pass.ts:223`

## Connected to

- **owns:** [[leads/segment-membership]]
- **reads:** [[leads/profile]], [[leads/profile-key]], [[leads/consent]], [[leads/sent-log]]
- **feeds:** [[platform/spine]] (`trigger.segment`, through the segments pass); [[leads/broadcast]] (read once when one starts)
- **looks-like-but-is-not:** a saved view (a list filter, per viewer); `wren campaigns` cohorts

## If you change this

- **Hits:** `packages/db/drizzle.config.ts` (lists `segments-schema.ts`), a migration for any table or view change; `compileRule` when a source table or view it reads changes (`profile_traits`, `profile_timeline`, `consents`, `sms_contacts`, `sent_records`); `describePrompt`'s shape text when a condition changes; `apps/portal/web/src/modules/people/segments.tsx` (the editor mirrors the conditions)
- **Does not hit:** sending; the sources (only read)

## Surfaces

| Surface | Role |
|---|---|
| People → Segments (portal) | reads, writes |
| People → People, Add to segment | writes (manual) |
| `Segments/<key>/wake` | writes (recompute) |

## See

- Source: `packages/core/src/segments.ts`, `packages/core/src/segments-pass.ts`
- Design: `designs/2026-10-14-customerio-audit.md` (B5)

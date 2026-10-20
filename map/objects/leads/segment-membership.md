---
type: object
cluster: leads
universe: live
status: verified
verified: 2026-10-14 @ 7d42f31a
entity: packages/core/src/segments-schema.ts:70
---

# segment-membership

Who is in each [[leads/segment]] now, and every entry and exit. Tables `segment_members` and `segment_member_events`; the segments pass tells the spine each entry and exit a workflow hears.

## Why this shape

Rows, not a query per read: an entry or exit is a fact with a time, which `trigger.segment` fires on and the segment's page counts (7 and 30 days). `segment_member_events` is append only; its `id` is the pass's cursor, so each move is told once. One statement moves members (`setMembers`), so two passes at once can't both log one entry.

## Shape

- `segment_members` (`packages/core/src/segments-schema.ts:70`): PK (`segment_id`, `profile_id`), `since`. Index led by `profile_id`.
- `segment_member_events` (`:94`): `segment_id`, `profile_id`, `change` entered|left, `at`. Indexes led by each FK.
- View `segment_member_records` (`:145`), record `people.member` (`packages/core/src/segment-records.ts:99`): People → Members (hidden; a segment's Its people link), and a profile's related list.
- The pass (`segmentsPass`, `packages/core/src/segments-pass.ts:223`): recompute live segments, write uses, archive the unused, then fire to the spine. Entries and exits of heard segments as `trigger.segment`, `profile_trait_events` of heard keys as `trigger.trait` (both subject `profile:<id>`, once per person per node; a `trigger.segment` set to repeat gets each entry its own arrival, `heardAs` in [[platform/spine]] adds `@<data.member>`, the `segment_member_events` id the fire carries), and from 09:00 New York once a day each Date trigger's due profiles as `trigger.date` (`dueOn`, `:175`; subject `profile:<id>:<key><±offset>@<day>`; yearly keeps Feb 29 on Feb 28 in other years). Event kind `lead`, `data.lead` a door lead (`source: segment`). A first pass starts at the newest ids: history never fires.
- `Segments` virtual object (`:348`): key `fleet` (Wren) or `<client>/fleet`; `wake` runs one pass, at most every 30 s (a wake inside that sends one delayed wake); `status`. Woken at commit by `wren_wake('Segments/fleet')` triggers on `profile_traits`, `profile_keys`, `profile_events` and `segments` (migration 0252), and by `SegmentsNet/all` (`:410`) every 15 minutes for every workspace (the net for timeline sources).

Citations: `packages/core/src/segments-schema.ts:70`, `packages/core/src/segments-schema.ts:94`, `packages/core/src/segments-pass.ts:223`, `packages/core/src/segments-pass.ts:348`

## Connected to

- **owned-by:** [[leads/segment]]
- **joins:** [[leads/profile]] (`profile_id`)
- **feeds:** [[platform/spine]] (`Spine/fire` via `spineFire`)

## If you change this

- **Hits:** `trigger.segment` and `trigger.trait` subjects (a change re-fires people already told); the cursor in `Segments` state; [[leads/broadcast]]'s `segmentMembers` read (`packages/core/src/broadcasts.ts:486`)
- **Does not hit:** the segment's rule; profiles

## Surfaces

| Surface | Role |
|---|---|
| People → Members | reads; Take out (manual) |
| `Segments/<key>/status` | reads (cursor, last pass) |

## See

- Source: `packages/core/src/segments-pass.ts`
- Design: `designs/2026-10-14-customerio-audit.md` (B5)

---
type: object
cluster: leads
universe: live
status: verified
verified: 2026-10-14 @ 6b363bda
entity: packages/core/src/profiles-schema.ts:70
---

# profile

One person in a workspace, however many addresses they go by. Table `profiles`, with `profile_traits`, `profile_trait_events` and `profile_merges`; the addresses are [[leads/profile-key]]. People app in Leads.

## Why this shape

An address lives in a dozen tables (leads, people, SMS contacts, consents, social handles, enrollments, CRM contacts, form entries, chats, bookings). A profile ties them together without copying them: `profile_keys` points each address at one profile, and the timeline (`profile_timeline`) reads the source tables through those keys. Two profiles found to share an address merge into the older one. Its keys move, newer traits are taken (each logged as a trait change), and the younger keeps its row with `merged_into` set. Nothing is deleted.

Only `resolveProfile` (`packages/core/src/profiles.ts:120`) writes. Writers call it through `noteProfile` (`:327`), which never throws, so a profile failure never blocks a send or an import. Each key is locked by value (`pg_advisory_xact_lock`) in one order, so two writers holding the same address make one profile.

## Shape

- `profiles`: `id`, `name` (first one stands), `first_seen`, `last_seen`, `merged_into` (self FK), `created_at` (`packages/core/src/profiles-schema.ts:70`)
- `profile_traits`: PK (`profile_id`, `key`), `value` jsonb, `source`, `at` (`:121`). Keys match `TRAIT_KEY` (`profiles.ts:29`)
- `profile_trait_events`: append only, `old`, `new`, `source`, `at` (`:142`). What B5's "trait changed" trigger reads
- `profile_merges`: `into_id`, `from_id`, `by` (the shared key), `keys`, `traits`, `source`, `at` (`:165`)
- `profile_timeline` view (`:207`): one line per sent or received email, text, call, social touch, consent event, Wren form entry, site chat, booking, client payment, workflow run, trait change and merge. Kinds in `TIMELINE_KINDS` (`:32`). Each line has `link` to its own page and `source` (the table)
- Records `people.profile`, `people.event`, `people.trait`, `people.merge`, `people.datum` (data index: every address kind, trait and timeline kind, its sources, people, last seen, workflows that use it) (`packages/core/src/profile-records.ts`)
- Writers (source names in `PROFILE_SOURCES`, `packages/core/src/profiles-backfill.ts:46`): lead import, people import, SMS contacts (`noteContacts`), consents, social handles (`resolveHandle`), enrollments, CRM import (incl. connector pulls), Wren site forms (with the `wv` visitor), site chat, Wren bookings, call bookings
- Backfill: `backfillProfiles` (`profiles-backfill.ts:434`), CLI `wren people backfill [--dry-run] [--only] [--batch]`. Idempotent

Citations: `packages/core/src/profiles-schema.ts:70`, `packages/core/src/profiles.ts:120`

## Connected to

- **owns:** [[leads/profile-key]] (`profile_keys.profile_id`)
- **reads:** [[email/message]], [[sms/sms-message]], [[email/thread-event]], [[leads/touch]], [[leads/consent]], [[content/comment]] (through `profile_timeline`)
- **joins:** [[leads/person]] (key `person`), [[leads/lead]] (key `email`), [[leads/sent-log]] (`key_kind` + `key_value`)
- **looks-like-but-is-not:** [[leads/person]] (a human at a company, from research; a profile is anyone we hold an address for); Marketing → People (`outreach.person`, social touches) and Reactivation → People (CRM contacts), which stay and link here

## If you change this

- **Hits:** `packages/db/drizzle.config.ts` (lists `profiles-schema.ts`), a new migration for any table or view edit; every writer above; `apps/portal/web/src/modules/people/`; `PLATFORM.records` (`apps/worker/src/components.ts`); `packages/core/test/integration/profiles.test.ts`
- **Does not hit:** the source tables (the timeline only reads them); sending and compose (they don't read profiles yet)

## Surfaces

| Surface | Role |
|---|---|
| People → People, Timeline, Data (portal) | reads |
| `wren people backfill` | writes |
| every address writer via `noteProfile` | writes |

## See

- Source: `packages/core/src/profiles.ts`, `packages/core/src/profiles-schema.ts`
- Design: `designs/2026-10-14-customerio-audit.md` (B1)

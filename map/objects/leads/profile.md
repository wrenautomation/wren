---
type: object
cluster: leads
universe: live
status: verified
verified: 2026-10-14 @ fcb4c23c
entity: packages/core/src/profiles-schema.ts:71
---

# profile

One person in a workspace, however many addresses they go by. Table `profiles`, with `profile_traits`, `profile_trait_events`, `profile_merges` and `profile_events`; the addresses are [[leads/profile-key]]. People app in Leads.

## Why this shape

An address lives in a dozen tables (leads, people, SMS contacts, consents, social handles, enrollments, CRM contacts, form entries, chats, bookings). A profile ties them together without copying them: `profile_keys` points each address at one profile, and the timeline (`profile_timeline`) reads the source tables through those keys. Two profiles found to share an address merge into the older one. Its keys move, newer traits are taken (each logged as a trait change), and the younger keeps its row with `merged_into` set. Nothing is deleted.

A client's rows kept on Wren's main database (its form entries, its pay links) are the one exception: a workspace view can't read main, so each becomes one line in `profile_events` in the client's workspace, written when the row lands or changes and upserted by source row. That is the timeline's only copy.

Site visits on Wren's own profiles are read live from the lander's export by each `visitor` key when the profile page opens (`VisitReader`, `landerVisitLines` in `packages/channel-email/src/calls/site.ts`). Never stored. Client sites keep no visitor id; their kit keeps the visit's page list in `sessionStorage` and sends it with a form, kept on the entry as `site_forms.pages` and shown in its line.

Only `resolveProfile` (`packages/core/src/profiles.ts:126`) writes profiles. Writers call it through `noteProfile` (`:337`) or `noteElsewhere` (`:369`, profile plus `profile_events` line), which never throw, so a profile failure never blocks a send or an import. Each key is locked by value (`pg_advisory_xact_lock`) in one order, so two writers holding the same address make one profile.

## Shape

- `profiles`: `id`, `name` (first one stands), `first_seen`, `last_seen`, `merged_into` (self FK), `created_at` (`packages/core/src/profiles-schema.ts:71`)
- `profile_traits`: PK (`profile_id`, `key`), `value` jsonb, `source`, `at` (`:122`). Keys match `TRAIT_KEY` (`profiles.ts:35`)
- `profile_trait_events`: append only, `old`, `new`, `source`, `at` (`:143`). What B5's "trait changed" trigger reads
- `profile_merges`: `into_id`, `from_id`, `by` (the shared key), `keys`, `traits`, `source`, `at` (`:166`)
- `profile_events` (`:201`): `profile_id`, `kind`, `channel`, `at`, `summary`, `body`, `link`, `source` + `source_id` (unique; the main row it stands for), `updated_at`. Moves with a merge
- `profile_timeline` view (`:242`): one line per sent or received email, text, call, social touch, consent event, Wren form entry (with its pages seen first), site chat, booking (any calendar in this database), `profile_events` line, workflow run, trait change and merge. Kinds in `TIMELINE_KINDS` (`:33`). Each line has `link` to its own page and `source` (the table)
- Records `people.profile`, `people.event`, `people.trait`, `people.merge`, `people.datum` (data index: every address kind, trait and timeline kind, its sources, people, last seen, workflows that use it) (`packages/core/src/profile-records.ts`); a profile's detail (`ProfileDetail`, `:135`) counts its lines by kind and carries its newest 8 with their kind and channel states (`linesOf`, `:226`), drawn on the page as a short rail (`TimelineMini`) with See all. People → Timeline is a `RecordTimeline` ([[platform/records]]), the List one switch away
- Writers (source names in `PROFILE_SOURCES`, `packages/core/src/profiles-backfill.ts:48`): lead import, people import, SMS contacts (`noteContacts`), consents, social handles (`resolveHandle`), enrollments, CRM import (incl. connector pulls), site forms (Wren's with the `wv` visitor; a client's into its workspace via `noteClientForm`), site chat, bookings on any calendar, call bookings, pay links once sent and when paid (`notePayLink`, `packages/payments/src/service.ts`)
- Backfill: `backfillProfiles` (`profiles-backfill.ts:435`), and `backfillClientRows` (`:624`) for a client's rows on main. CLI `wren people backfill [--dry-run] [--only] [--batch] [--bulk [rows]]`; `--bulk` is `bulkBackfillProfiles` (`profiles-bulk.ts`): the same result in a few set-based statements per chunk, merges and what touches them one by one through `resolveProfile`, the same per-key advisory locks, so safe beside a live per-row run; with `--client <id>` it also writes that client's form entries and sent or paid pay links as lines. Idempotent

Citations: `packages/core/src/profiles-schema.ts:71`, `packages/core/src/profiles.ts:126`

## Connected to

- **owns:** [[leads/profile-key]] (`profile_keys.profile_id`)
- **reads:** [[email/message]], [[sms/sms-message]], [[email/thread-event]], [[leads/touch]], [[leads/consent]], [[content/comment]] (through `profile_timeline`); the lander export, live (site visits)
- **copies:** [[platform/hosted-form]] entries and [[platform/pay-link]] rows of a client, one `profile_events` line each in its workspace
- **joins:** [[leads/person]] (key `person`), [[leads/lead]] (key `email`), [[leads/sent-log]] (`key_kind` + `key_value`)
- **feeds:** [[leads/people-map]] (stage, warmth, persona per profile; mirrors traits `stage`, `warmth`), [[leads/segment]] (rules read traits and the timeline; a trait or `profile_events` write wakes `Segments`), [[leads/segment-membership]] (`trigger.trait` reads `profile_trait_events`)
- **looks-like-but-is-not:** [[leads/person]] (a human at a company, from research; a profile is anyone we hold an address for); Marketing → People (`outreach.person`, social touches) and Reactivation → People (CRM contacts), which stay and link here

## If you change this

- **Hits:** `packages/db/drizzle.config.ts` (lists `profiles-schema.ts`), a new migration for any table or view edit; every writer above; `apps/portal/web/src/modules/people/`; `PLATFORM.records` (`apps/worker/src/components.ts`); `packages/core/test/integration/profiles.test.ts`; `profiles-bulk.ts` mirrors `resolveProfile`'s rules, so a rule change there changes it too (`profiles-bulk.test.ts` compares both)
- **Does not hit:** the source tables (the timeline only reads them; `profile_events` is rewritten from them); sending and compose (they don't read profiles yet)

## Surfaces

| Surface | Role |
|---|---|
| People → People, Timeline, Data (portal) | reads (People also reads [[leads/people-map]]) |
| `wren people backfill` | writes |
| every address writer via `noteProfile` | writes |

## See

- Source: `packages/core/src/profiles.ts`, `packages/core/src/profiles-schema.ts`
- Design: `designs/2026-10-14-customerio-audit.md` (B1)

---
type: object
cluster: leads
universe: live
status: verified
verified: 2026-10-14 @ 6b363bda
entity: packages/core/src/profiles-schema.ts:94
---

# profile-key

One address a person goes by, tied to one [[leads/profile]]. Table `profile_keys`.

## Why this shape

An address is unique across a workspace (`uq_profile_keys_kind_value`), so it belongs to at most one profile. If a new set of keys spans two profiles, they merge. Values are normalized by `keyOf` (`packages/core/src/profiles.ts:57`) so the same address written two ways is one key: emails lowercased without `mailto:`, phones E.164 (US default), handles bare.

## Shape

- `id`, `profile_id`, `kind`, `value`, `source` (first writer), `first_seen` (`packages/core/src/profiles-schema.ts:94`)
- `kind`: `email`, `phone`, `visitor` (the site's `wv` cookie), `person` (a `people` row id), `handle:<platform>`, `crm:<source>` (`PROFILE_KEY_KINDS`, `:29`)
- indexes: unique (`kind`, `value`); (`profile_id`, `kind`); (`profile_id::text`) for the record page
- `profile_key_records` view and `people.key` record (`packages/core/src/profile-records.ts`)

Citations: `packages/core/src/profiles-schema.ts:94`, `packages/core/src/profiles.ts:57`

## Connected to

- **owned-by:** [[leads/profile]]
- **joins:** [[leads/sent-log]] (`key_kind` + `key_value`), [[leads/touch]] (`handle:<platform>`), [[leads/person]] (`person`)
- **looks-like-but-is-not:** `social_handles` (a handle with its touches; a key is just the address)

## If you change this

- **Hits:** `keyOf` and every writer's key list (`profileFrom`, `packages/core/src/profiles-backfill.ts:63`); `profile_timeline`, which joins each source on its key
- **Does not hit:** the source tables

## Surfaces

| Surface | Role |
|---|---|
| People → profile Addresses tab, `/people/addresses` | reads |

## See

- Source: `packages/core/src/profiles.ts`
- Design: `designs/2026-10-14-customerio-audit.md` (B1)

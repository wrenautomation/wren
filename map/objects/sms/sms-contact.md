---
type: object
cluster: sms
universe: live
status: verified
verified: 2026-09-28 @ 28823cd
entity: packages/channel-sms/src/schema.ts:135
---

# sms-contact

One phone number we may text, with the basis for texting it, its carrier lookup, and its thread state. Table `sms_contacts`. The SMS thread; there is no enrollment table.

## Why this shape

Consent basis is a column, not a comment: `published` (the business put the number on its own site, with the document as evidence) or `opt_in` (they wrote first) (`lift.ts:1`, `events.ts:1`). One thread per company; a landline or toll-free lands `unreachable`; a STOP lands `opted_out` and a phone suppression, forever (`enroll.ts:1`).

## Shape

- `e164`, `company_id`, `person_id`, `source_document_id`, `source_url`, `source_kind`, `basis`, `basis_detail`, `line_type`, `carrier`, `lookup`, `number_id`, `state` (`CONTACT_STATES`, `:52`), `state_reason`, `niche`, `sequence`, `enrolled_at`, `ended_at`, `read_at` (`schema.ts:138`–`164`)
- one enrolled row per number (`uq_sms_contacts_enrolled_e164`, `:169`)

Citations: `packages/channel-sms/src/schema.ts:135`

## Connected to

- **owned-by:** [[leads/company]], [[sms/sms-number]]
- **owns:** [[sms/sms-message]]
- **joins:** [[research/document]] (evidence), [[leads/suppression]] (kind phone), [[platform/niche]] (`SMS_SEQUENCES`)
- **looks-like-but-is-not:** [[email/enrollment]]

## If you change this

- **Hits:** `lift.ts:146`, `contacts.ts:27`, `enroll.ts:69`, `events.ts:144`, `threads.ts`, `SmsDesk`, the phone app (`apps/phone`), `wren sms *`
- **Does not hit:** email enrollments; `leads`

## Surfaces

| Surface | Role |
|---|---|
| `SmsDesk.lift/addContact/enroll` | writes |
| `SmsEvents.ingest` | writes state on STOP/reply |
| phone PWA, `wren sms threads` | read, mark read |

## See

- Source: `packages/channel-sms/src/enroll.ts`

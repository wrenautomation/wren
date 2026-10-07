---
type: object
cluster: sms
universe: live
status: verified
verified: 2026-09-28 @ 28823cd
entity: packages/channel-sms/src/schema.ts:149
---

# sms-contact

One phone number we may text, with the basis for texting it, its carrier lookup, and its thread state. Table `sms_contacts`. The SMS thread; there is no enrollment table.

## Why this shape

Consent basis is a column, not a comment: `published` (the business put the number on its own site, with the document as evidence; read from [[research/contact-point]]) or `opt_in` (they wrote first, were added by hand with a reason, or ticked the texts box on the site's form) (`lift.ts:1`, `events.ts:1`, `form.ts:1`). One thread per company, and none while an email or DM sequence holds the same lead or touched the firm in the last day (left `new`, the reason in `state_reason`; form applicants exempt; `packages/core/src/leads.ts`); a landline or toll-free lands `unreachable`; a STOP lands `opted_out` and a phone suppression, forever (`enroll.ts:1`).

## Shape

- `e164`, `company_id`, `person_id`, `source_document_id`, `source_url`, `source_kind` (`tel_link`/`page_text`/`manual`/`inbound`/`form`/`hook`), `source_ref` (the site application id, or the speed run's id for `hook`), `name`, `email` (form applicants), `zone` (the lead's own time zone, from the form), `basis`, `basis_detail`, `line_type`, `carrier`, `lookup`, `number_id`, `state` (`CONTACT_STATES`, `:52`), `state_reason`, `niche`, `sequence`, `enrolled_at`, `ended_at`, `read_at`, `paid_cents` and `paid_at` (text-to-pay, [[platform/pay-link]], migration 0181) (`schema.ts:152`–`182`)
- one enrolled row per number (`uq_sms_contacts_enrolled_e164`, `:189`); one row per site application (`uq_sms_contacts_source_ref`, `:187`)

Citations: `packages/channel-sms/src/schema.ts:149`

## Connected to

- **owned-by:** [[leads/company]], [[sms/sms-number]]
- **owns:** [[sms/sms-message]]
- **joins:** [[research/document]] (evidence), [[research/contact-point]] (the lift's input), [[leads/suppression]] (kind phone), [[platform/niche]] (`SMS_SEQUENCES`)
- **looks-like-but-is-not:** [[email/enrollment]]

## If you change this

- **Hits:** `lift.ts:40`, `contacts.ts:27`, `enroll.ts:69`, `events.ts:144`, `threads.ts`, `SmsDesk`, the phone app (`apps/phone`), `wren sms *`
- **Does not hit:** email enrollments; `leads`

## Surfaces

| Surface | Role |
|---|---|
| `SmsDesk.lift/addContact/enroll` (with `client`: that client's database, needs `sms.texts`) | writes |
| `SmsWatch` form pass, `SmsDesk.forms`, `wren sms forms` | writes form applicants |
| `SmsEvents.ingest` | writes state on STOP/reply |
| phone PWA, `wren [--client X] sms threads` | read, mark read |
| portal app `texts`, `SmsConsole.records*` / `reply` (team only) / `callDone` | reads `sms.thread`, replies, closes Call now |

## See

- Source: `packages/channel-sms/src/enroll.ts`

---
type: object
cluster: research
universe: live
status: verified
verified: 2026-10-05 @ 69689da
entity: packages/research/src/schema.ts:257
---

# contact-point

One way to reach a firm that its own site publishes: a phone, its LinkedIn company page, a team member's LinkedIn profile, or an X/Instagram/Facebook/YouTube/TikTok profile. Table `contact_points`, one row per (company, kind, value).

## Why this shape

Every stored page is read once by the free `contacts` stage (`packages/research/src/enrichment/contacts.ts:265`), so every channel reads one store instead of re-parsing pages: the SMS lift reads phones from here (`packages/channel-sms/src/lift.ts:40`), the lead sheet reads the rest. `pages` counts the pages carrying the value; a footer link on every page outranks a one-off mention. A profile is tied to a person only when exactly one held person's name sits near it. Published links are never written to `companies.linkedin_url` or `people.linkedin_url`: those stay Exa-confirmed, and the sheet prefers them.

## Shape

- `company_id`, `person_id`, `kind` (`CONTACT_KINDS`), `value` (E.164 or one canonical URL, `socialProfile` `contacts.ts`), `source` (`link` beats `text`), `pages`, `document_id` and `source_url` (first page seen), `created_at`, `seen_at` (`schema.ts:257`)

Citations: `packages/research/src/schema.ts:257`

## Connected to

- **owned-by:** [[leads/company]], [[research/document]] (evidence)
- **joins:** [[leads/person]] (`person_id`), [[research/enrichment]] (one `contact_scan` row per page read), [[sms/sms-contact]] (the lift)
- **looks-like-but-is-not:** `companies.linkedin_url` (confirmed, not published)

## If you change this

- **Hits:** `contacts.ts`, `lift.ts:40`, the `lead_sheet` view (`packages/channel-email/src/views.ts`), `wren email sheet`
- **Does not hit:** compose, the Exa profiles stage

## Surfaces

| Surface | Role |
|---|---|
| `Enrichment.contacts` (pool stage after `scan`) | writes |
| `SmsDesk.lift`, `wren sms lift` | read phones |
| `lead_sheet`, `wren email sheet` | read phone, socials, LinkedIn fallbacks |

## See

- Source: `packages/research/src/enrichment/contacts.ts`

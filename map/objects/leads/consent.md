---
type: object
cluster: leads
universe: live
status: verified
verified: 2026-10-05 @ 6573a02
entity: packages/core/src/marketing.ts:97
---

# consent

A person's yes to one marketing topic on one channel, with its proof. Tables `topics`, `consents`, `consent_events`; the one send rule is `mayMarket` in core. Cold outreach never reads it: it keeps [[leads/suppression]] alone.

## Why this shape

Marketing to people who signed up runs on provable consent (CASL, GDPR, TCPA for texts), so every change is an append-only event with its proof, the same pattern as `suppression_events` (`packages/core/src/schema.ts:445`). A suppression beats every consent. "Unsubscribe from everything" writes an `opt_out` suppression, so it stops cold outreach too. Only a confirmed double opt-in that started after an opt-out lifts it (`confirmConsent`, `packages/core/src/marketing.ts:229`), and the person's own Undo within 24 hours lifts their own click (`:406`).

## Shape

- `topics`: `name`, `public_name`, `line`, `channel` (email | sms), `cadence`, `public` (`packages/core/src/schema.ts:389`)
- `consents`: one per `channel` + `address` + `topic_id`; `state` (pending | confirmed | withdrawn), `source` (lander_form | meta_lead_form | sms_keyword | calcom_booking | preference_center), `text_version`, a time per state, `frequency`, `paused_until`, `last_sent_at` (`:410`)
- `consent_events`: `consent_id`, `kind` (the states, frequency, paused, sent), `by`, `evidence` jsonb (`:445`)

`mayMarket` (`packages/core/src/marketing.ts:97`): no suppression on the address or its domain, a confirmed consent for the topic, not paused, under the person's frequency, and on SMS 4 in 31 days. Pending expires at confirm time after 7 days; no loop.

Citations: `packages/core/src/marketing.ts:97`, `packages/core/src/schema.ts:389`

## Connected to

- **owns:** `topics`, `consent_events`
- **joins:** [[leads/suppression]] (read by `mayMarket`, written by unsubscribe-everything and the double opt-in lift)
- **looks-like-but-is-not:** [[leads/suppression]] (a no to everything; a consent is a yes to one topic)

## If you change this

- **Hits:** the `Marketing` Restate service (`packages/channel-email/src/restate/marketing.ts:135`) behind the phone Worker's `/marketing/<handler>` and the lander's `/api/subscribe` and `/prefs/`; signed preference links (`signLink`, `marketing.ts:520`, keyed from `WREN_SITE_EXPORT_TOKEN`: rotating it breaks old links); `marketingEnvelope` (`:546`), the headers and footer every marketing email must carry; the console records `marketing.subscriber` and `marketing.topic` (`packages/core/src/marketing-records.ts:12`, `:72`) over the views in `marketing-views.ts`
- **Does not hit:** compose, resolution and the send ticks of cold outreach; no marketing sender exists yet

## Surfaces

| Surface | Role |
|---|---|
| `Marketing{signUp,confirm,prefs,set}` | writes |
| console records `marketing.subscriber`, `marketing.topic` | read |

## See

- Design: `designs/2026-10-04-borrowed-ui.md` (Opt-in marketing)
- Source: `packages/core/src/marketing.ts`

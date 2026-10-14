---
type: object
cluster: leads
universe: live
status: verified
verified: 2026-10-14 @ b0d2bdb5
entity: packages/core/src/marketing.ts:115
---

# consent

A person's yes to one marketing topic on one channel, with its proof. Tables `topics`, `consents`, `consent_events`, `marketing_sends`, `message_settings`; the one send rule is `mayMarket` in core. Cold outreach never reads it: it keeps [[leads/suppression]] alone.

## Why this shape

Marketing to people who signed up runs on provable consent (CASL, GDPR, TCPA for texts), so every change is an append-only event with its proof, the same pattern as `suppression_events` (`packages/core/src/schema.ts:1352`). A suppression beats every consent. "Unsubscribe from everything" writes an `opt_out` suppression, so it stops cold outreach too. Only a confirmed double opt-in that started after an opt-out lifts it (`confirmConsent`, `packages/core/src/marketing.ts:282`), and the person's own Undo within 24 hours lifts their own click (`undoUnsubscribeEverything`, `:487`).

## Shape

- `topics`: `name`, `public_name`, `line`, `channel` (email | sms), `cadence`, `public`, `keyword` (sms only, unique, upper case) (`packages/core/src/schema.ts:1374`)
- `consents`: one per `channel` + `address` + `topic_id`; `state` (pending | confirmed | withdrawn), `source` (lander_form | meta_lead_form | sms_keyword | calcom_booking | preference_center), `text_version`, a time per state, `frequency`, `paused_until`, `last_sent_at` (`:1402`)
- `consent_events`: `consent_id`, `kind` (the states, frequency, paused, sent), `by`, `evidence` jsonb (`:1438`)

`mayMarket` (`packages/core/src/marketing.ts:115`): no suppression on the address or its domain, a confirmed consent for the topic, not paused, under the person's frequency, on SMS 4 in 31 days, and under the workspace's cap across every channel. Pending expires at confirm time after 7 days; no loop.

- `message_settings`: one row (`id = 1`), `cap_per_day`, `cap_per_week` (null = no cap), `utm_links`; a missing row is `MESSAGE_DEFAULTS` (2 a day, 5 a week, links tagged) (`packages/core/src/message-settings.ts:26`). It is the client's own database's, so each client sets its own. `capOf` reads a cap from text: a whole number, or "off" or 0 for none, at most `CAP_MAX` (100)
- `marketing_sends`: one row per marketing message sent, `person_key`, `channel` (email | sms | dm), `campaign` slug, `sent_at`; index `(person_key, sent_at)`. `overCap` (`:123`) counts a rolling day and week of one key. `recordMarketingSend` writes it with the consent's `sent` event, in one transaction
- `personKeyOf` (`:112`) is the key a person is counted under on any channel: `person:<id>` from the resolver, else `email:<address>`, `phone:<number>` or `handle:<name>`. The default resolver knows only `leads.person_id` by email; `setPersonResolver` (`:105`) swaps it. Nothing installs one yet, so an address on two channels counts as two people unless a lead links them
- `tagLinks` (`:222`) adds `utm_source` (the client's id, `wren` in Wren's own), `utm_medium` (channel) and `utm_campaign` (the slug) to every http link, never over a parameter already there, never on our `/go/` tracked links. The newsletter, SMS sequences (not when a tag would add a billed part) and DM sequences call it; cold sends tag links only

Citations: `packages/core/src/marketing.ts:115`, `packages/core/src/message-settings.ts:123`, `packages/core/src/schema.ts:1374`

Two one-step sources confirm without a click (`giveConsent`), and neither lifts an opt-out: a Meta lead form's ticked box (`Ads.leadConsents`, `packages/channel-meta/src/consent.ts:1`, skips leads already recorded for the form) and a text that is only a topic's keyword (rule 3 in `packages/channel-sms/src/events.ts:1`).

## Connected to

- **owns:** `topics`, `consent_events`, `marketing_sends`, `message_settings`
- **joins:** [[leads/suppression]] (read by `mayMarket`, written by unsubscribe-everything and the double opt-in lift)
- **feeds:** [[leads/profile]] (asking or giving consent notes the address; each consent event is a timeline line)
- **looks-like-but-is-not:** [[leads/suppression]] (a no to everything; a consent is a yes to one topic)

## If you change this

- **Hits:** the `Marketing` Restate service (`packages/channel-email/src/restate/marketing.ts:136`) behind the phone Worker's `/marketing/<handler>` and the lander's `/api/subscribe` and `/prefs/`; signed preference links (`signLink`, `marketing.ts:640`, keyed from `WREN_SITE_EXPORT_TOKEN`: rotating it breaks old links); `marketingEnvelope` (`:666`), the headers and footer every marketing email must carry; the console records `marketing.subscriber` and `marketing.topic` (`packages/core/src/marketing-records.ts:13`, `:75`) over the views in `marketing-views.ts`
- **Also hits:** Account > Messaging (`delivery.messaging` record, `packages/delivery/src/records.ts:536`; routes `messagingChange|LinksOn|LinksOff` need `manage`, `packages/delivery/src/messaging.ts:28`): an owner edits the two caps and the link switch, saved in the client's database, logged as the person. Nothing else writes `message_settings`
- **Cap reach:** only the newsletter calls `mayMarket` and `recordMarketingSend` today (`packages/channel-email/src/restate/newsletter.ts:136`, `:151`; the blog's audience tally, `packages/content/src/restate/blog.ts:146`, reads it too). SMS and DM sends are not counted or checked, so the cap is enforced for email only; a new marketing send path must call both
- **Does not hit:** compose, resolution and the send ticks of cold outreach (own policy, no cap); transactional mail (an opt-in confirm, a receipt) never asks `mayMarket`
- **Sends:** the `Newsletter` object (`packages/channel-email/src/restate/newsletter.ts:1`), one per `<topic>:<slug>`: a blog post to every confirmed consent (`issueAudience`), each passing `mayMarket` at its own send; a `sent` event whose evidence names the issue makes a rerun skip it (`issueSentTo`). Needs `WREN_MARKETING_POSTAL`. CLI `wren newsletter topic|send|status`

## Surfaces

| Surface | Role |
|---|---|
| `Marketing{signUp,confirm,prefs,set}` | writes |
| `Ads.leadConsents`, an SMS keyword through `SmsEvents.ingest` | writes |
| `Newsletter{send}`, `wren newsletter` | sends, writes `sent` and a `marketing_sends` row |
| Account > Messaging (`delivery/messaging*`) | writes `message_settings` |
| console records `marketing.subscriber`, `marketing.topic` | read |

## See

- Design: `designs/2026-10-04-borrowed-ui.md` (Opt-in marketing), `designs/2026-10-11-newsletter.md`
- Source: `packages/core/src/marketing.ts`

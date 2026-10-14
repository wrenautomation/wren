---
type: object
cluster: email
universe: live
status: verified
verified: 2026-10-14 @ da6ecb5
entity: packages/channel-email/src/schema.ts:632
---

# email-click

One email's link, followed, counted per landing page. Tables `email_clicks` and its cursor `click_syncs`. Not `open_events` (a pixel fetch) and not the lander's `clicks` (its `/go/` hops).

## Why this shape

The lander is the source of truth: each email's sign-off link carries `?r=<messages.link_code>` and the lander records it on the view it lands on (`hits.r`). `ClicksScheduler` reads `hits` forward from a stored cursor, hourly, and counts the coded ones. Counts are increments, so the cursor moves in the same transaction as the rows it covers (`inbox/click-sync.ts:1`). Without that a run that died half way would count a view twice. The sent log needs clicks in SQL to set "clicked", which a live read of the export could not give it.

A code no message holds is stored with `message_id` null (typed by hand, or the message since deleted). Text and DM `/go/` links would land here the same way if they carried a code, but neither has a code column and `/go/` drops `?r=` on the redirect, so only email arrives today. A click is interest, not consent: nothing sends or stops on these rows.

## Shape

- `email_clicks`: `link_code` + `url` (unique), `message_id` (null when unknown), `first_at`, `last_at`, `clicks` (`schema.ts:632`)
- `click_syncs`: `base_url`, `cursor_id` (the lander's view id), `synced_at`, `stats` (`schema.ts:661`)
- `clickedEmails`: one row per email (its pages, clicks added), with message, company and niche; behind `wren email clicks` (`inbox/clicks.ts:212`)
- `clickFollowUps`: what each code's visitors did after (visitors, views, secs, form, applied). Read live from the export's `hits` and `applications` by `wren email clicks`, never stored; with no token or the lander down the command prints counts only (`inbox/clicks.ts:283`)
- The first run reads all of the lander's `hits` history; start `ClicksScheduler/fleet` in prod once

Citations: `packages/channel-email/src/schema.ts:632`, `packages/channel-email/src/inbox/click-sync.ts:45`

## Connected to

- **owned-by:** [[email/message]] (`message_id`, cascade)
- **joins:** the lander's `/api/export?table=hits` (outside the tree, `EXPORT_TOKEN`)
- **looks-like-but-is-not:** [[email/open-event]]; `SiteClick` (the lander's `clicks` table, a `/go/` hop)

## If you change this

- **Hits:** `inbox/click-sync.ts`, `restate/clicks-scheduler.ts`, `clickedEmails`, `clickFollowUps`, the `sent_records` and `sent_activity` views (migration), `wren email clicks`, the lander's `hits.r` column and `?r=` link
- **Does not hit:** anything that sends or stops

## Surfaces

| Surface | Role |
|---|---|
| `ClicksScheduler` (when `WREN_SITE_EXPORT_TOKEN` is set) | writes |
| `sent_records`, `sent_activity` | reads |
| `wren email clicks` | reads (the table, and the lander's export live for the follow-up) |

## See

- Source: `packages/channel-email/src/inbox/click-sync.ts`

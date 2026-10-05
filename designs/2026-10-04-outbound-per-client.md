# Outbound per client (2026-10-04)

## Answer first

- The outbound stack runs for Wren's niches on the main database. Client #1 needs it to run for them. This is that build.
- Order comes from the offer: lead sheet, sequences, replies, booking. Each step ships ready on its own, then the next.
- Each component meets the four conditions in `2026-10-04-components-and-marketplace.md`: settings parse with `{}` valid, data in `wren_client_<id>`, the loop goes over installed clients only, records and app per client.
- The pattern is reactivation's: the loop lists clients with the component in `clients.products`, opens each one's database with `clientUrl`, and reads its settings block.
- Shared caches stay on main: page archive, Exa cache, address verification results. They hold public facts, not a client's work, and every client gains from them.

## O1. Lead sheet

`research.discovery`, `research.crawl`, `research.people`, `research.verify`, `research.lead_sheet`.

- Settings: what a niche holds today (who to find, where, which roles), as the client's block.
- The client's firms, people and sheet rows go in its database. Crawled pages and verdicts stay on main.
- PoolScheduler tops up each installed client's pool, with its own daily cap from settings.
- The Pipeline app reads the client's sheet.

## O2. Sequences

`email.sequences`, `email.inbox_health`, `email.experiments`.

- Senders come from the client's settings, not the roster in `senders_config.toml`. Each sender's login comes from `clients.accounts.gmail`.
- Enrollments, sends and events live in the client's database. Suppression stays global: an opt-out from any client is an opt-out everywhere.
- The kill switch and pacing are per client.

## O3. Replies

`email.replies`.

- Replies sort into the client's database. Every answer still waits on an approve, as `wren email answers` does today.

## O4. Booking

`sms.texts`, `sms.reminders`.

- The client's cal.com from `clients.accounts.calcom`, its numbers from `clients.accounts.telnyx`.
- SmsWatch's reminder pass runs per installed client, on that client's bookings and contacts.

## Open (William's call)

- Whose inboxes send for a client: domains the client owns, or ones Wren buys for them. Buying is spend.
- Who approves reply answers for a client: Wren, the client's owner, or either.
- Caps per client: sends a day, verifications a day, texts a month.

## Decision log

- 2026-10-04: Written at the end of components C3. No code yet.
- 2026-10-04: Building now with defaults that cost nothing and match today, so William's three answers become settings changes, not code. Senders: the addresses in the client's settings, logins from `clients.accounts.gmail`; the code never buys a domain. Answers: wait on Wren's approve, as today. Caps: settings fields, defaulting to Wren's current values.
- 2026-10-04 (O1 built): Settings live on `research.lead_sheet` only: `genericWords`, `crawlHints` (empty = Wren's), `perPass` (over Wren's per-pass sizes), `verificationsPerDay` (null = no cap, as Wren today). The other four take `{}`. "Which roles" (`mailsRoleInboxes`) is a compose rule: O2.
- 2026-10-04: A client's pool is `PoolScheduler/<client>/all`, started by hand like Wren's niches; `Discovery`/`Enrichment` take the same `<client>/...` keys, `Resolution` takes `client` in its input. Walks stay one at a time through the single `Resolution/default` key.
- 2026-10-04: Clients get no `profiles` (Exa is metered, its queue is compose's) and no re-checks; `modelStages` stays the worker's setting.
- 2026-10-04: Verdicts: a client's walk reads main's recent verdict per address (30 days, never `risky`) and writes fresh probes to main unattributed (migration relaxes `ck_verifications_attributed`). The daily cap counts only fresh probes.
- 2026-10-04: Pages: a client's crawl reads main's 200s under 30 days by URL and keeps fresh ones on main with no company. The client still keeps its own copy: extraction joins on it. `PageArchive` stays main's only.
- 2026-10-04: The Pipeline in a client's workspace is the app `leads` (same pages as `pipeline`), read through `EmailConsole.records*` on the client's database, refused unless `research.lead_sheet` is installed.
- 2026-10-04 (O1 gap): Install, configure and uninstall start and stop the component's client loops (`clientLoops` on the component, sent by `ConsolePortal` after the journaled change, only for services this worker binds). A loop also stops itself on its next pass once its client, block or unit is gone. Covers `PoolScheduler/<client>/all` and the O2–O4 loops.
- 2026-10-04 (O2 built): `email.sequences` block: `niche` (which of Wren's niches' plan and copy; null composes nothing), `senders` [{address, name, signature, suspended}], `mailsRoleInboxes` (null = the niche's), `sending` (the overrides reactivation already had). `{}` sends nothing. Requires `accounts.gmail`; transport stays Wren's Workspace service account, as reactivation's. Pausing a client's inbox is `suspended: true` through configure.
- 2026-10-04: Loops: `ComposeScheduler/<client>/<niche>`, `SendScheduler/<client>/<addr>` and `InboxScheduler/<client>/<addr>` per active sender. A mailbox in both reactivation and sequences sends under sequences' caps. No open pixel and no offered times for a client's mail.
- 2026-10-04: Suppression: a client's reads ask its database then main; its stops write both, main's evidence names the client. No backfill. Reactivation's compose is not threaded (its send gate reads both).
- 2026-10-04: Kill switch and opener cap per client: `campaign_controls` in its database, set through `EmailConsole.setCampaign`/campaign actions with `client` (Wren's team, sequences installed). Env default = Wren's rules under the client's caps, kill switch on.
- 2026-10-04: `email.inbox_health` and `email.experiments` stay not ready: Postmaster is per domain on Wren's account, placement seeds send mail, experiments spend model calls. Spend is William's call.
- 2026-10-04 (O3 built): `email.replies` takes `{}`. Replies classify in the client's `Disposition/<client>/replies`; invites run only for its sequences' niche, draft from Wren's niche copy, offer no times, and say `booked` from its cal.com through autobrowse (`accounts.calcom`), else never. Pings name the client. Answer with `wren --client X email answers` or the console with `client`; both go through `Disposition/<client>/replies`.
- 2026-10-04 (O4 built): `sms.texts` block `{senderName, campaignId}` (nulls = Wren's name, no 10DLC watch), requires `accounts.telnyx` = a messaging profile in Wren's Telnyx account. Loops `SmsSender/<client>/fleet`, `SmsWatch/<client>/daily`. Wren's live gate; no form follow-up, no phone-app push. Templates start empty, so nothing sends until words are set (`SmsDesk.setTemplate` with `client`). SMS opt-outs stay in the client's database.
- 2026-10-04: `sms.reminders` takes `{}`, requires `accounts.calcom`; SmsWatch's reminder pass reads that cal.com through autobrowse.
- 2026-10-04: Webhooks: `/webhooks/telnyx/<client>` (set as the profile's webhook URL, Wren's signing key) → `SmsEvents.ingestFor`; `/webhooks/calcom/<client>` checked against `CALCOM_WEBHOOK_SECRETS[<client>]` → `CallBookings.ingestFor`. Both land in the client's database even after uninstall, so a STOP or a booking is never lost. Same handlers as Wren's routes.
- 2026-10-04: Open: client SMS enrollment and the rest of the desk; `wren sms templates` with `--client` (the desk takes `client`, the CLI does not pass it yet).
- 2026-10-05 (closed): every `SmsDesk` handler on a client's data takes `client` (threads, thread, read, reply, label, stats, addContact, lift, enroll, templates). Enroll is the same path on the client's database, refused by `clientSms` unless `sms.texts` is installed. `wren --client X sms ...` passes it; queue and watch use `X/fleet` and `X/daily`; `sms numbers` and `sms forms` refuse `--client`. Portal: app `texts` (component `sms.texts`) reads `sms.thread` through `SmsConsole.records*` on the client's database; `SmsConsole.reply` is Wren's team only, through `SmsDesk.reply` with `client`. Rows-based record, 500 most recent threads. Still open: numbers per client (pool rows are added by hand in its database), forms and push per client, templates in the portal.

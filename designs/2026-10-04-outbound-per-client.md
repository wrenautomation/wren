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

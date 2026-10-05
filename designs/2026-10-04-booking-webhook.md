# Booking webhook (2026-10-04)

## Answer first

- A lead who books from an email's link never reaches wren. The link carries the message's code (`/book/<offer>?r=<link_code>`), and cal.com hands it back in `metadata.r`. But cal.com's webhook only goes to the lander, which pings #meetings and stops there.
- So a booked lead still gets the follow-up. Copy evolution's `booked` fitness and the cost per booked call miss them. Today only `call_invites` (bookings William approved from a reply) count.
- Fix: cal.com pushes to wren through the phone Worker, the door Telnyx already uses. Wren records the call, stops the sequence, and counts it.

## Webhook or poll: the survey

| Seam | Today | Verdict |
|---|---|---|
| cal.com bookings | Lander webhook → Discord only | **Push to wren** (this doc). A booking is rare and urgent: the next follow-up can't wait for a pass. |
| Telnyx SMS | Webhook → phone Worker → `SmsEvents.ingest` | Already push. |
| Gmail replies | `InboxScheduler` every 2 min | Keep polling. Push needs Pub/Sub, a relay and a watch renewed weekly, to save under 2 min on a queue William approves by hand. |
| Lander forms and clicks | Read from `/api/export` (SmsWatch every 30 min, `wren email clicks`) | Keep. A form's first text waits 20 min on purpose, and a click starts nothing. Push when forms become a real channel. |
| SMS reminders | SmsWatch lists the next day's calls | Keep. The list re-reads moves and cancels, which per-booking timers would have to chase. |
| Wise invoices | Entered by hand | Push when the first invoice is out and there's a Wise token (balance credit webhook). |
| Meta lead forms | Read on demand | Push (leadgen webhook) when a lead-form ad runs. |

## Shape

1. **Door.** `POST /webhooks/calcom` on the phone Worker. It checks `x-cal-signature-256` (HMAC-SHA256 of the raw body, hex) against `CALCOM_WEBHOOK_SECRET`; unsigned or wrong is 401. It forwards to `CallBookings/ingest/send` with an idempotency key built from trigger, uid and start, so a retried webhook applies once. Restate down is 502, so cal.com retries. A `PING` gets 200 and goes no further.
2. **Subscription.** A second cal.com webhook (the lander's stays for #meetings), made with `WREN_CALCOM_API_KEY`: `BOOKING_CREATED`, `BOOKING_RESCHEDULED`, `BOOKING_CANCELLED`, its own secret.
3. **Record.** A `call_bookings` row per cal.com uid: state (`booked`, `cancelled`), start, attendee email and name, offer, `r`, and the message and enrollment it matched (both nullable). A reschedule moves the row to the new uid and time.
4. **Match.** `r` → `messages.link_code` → enrollment. With no `r`, the attendee email matches an enrollment's `to_email`. No match still keeps the row.
5. **Effect.** A matched active enrollment stops the way a reply does: `stopCompany`, company-scoped, with a new stop reason `booked`. A cancel marks the row and never restarts a sequence.
6. **Count.** Copy evolution's booked outcome and the unit economics funnel count `call_bookings` not cancelled, next to `call_invites` booked. Where the console lists booked calls, these show too.
7. **Catch-up.** `wren email bookings sync [--since]` lists cal.com bookings through the same ingest. It backfills from the campaign start and repairs any webhook that was missed.

Per-client cal.com (outbound O4) adds `/webhooks/calcom/<client>` with that client's secret, landing in its database. Not in this build.

## Done when

- A signed test event ingests once, twice-sent applies once, an unsigned one is 401.
- A booking with `r` stops its enrollment and company; evolution and economics count it.
- Backfill run on prod; the subscription is live and its first `PING` comes back 200.
- Gates pass.

## Decision log

- 2026-10-04: Written from William's ask to find where a webhook shape beats the current call. The phone Worker over the lander as the door: wren owns the ingest, and the Worker already holds the Restate token and the signed-forward pattern.
- 2026-10-04 build: migration `0080_call_bookings`. `call_bookings.booked_at` is cal.com's `createdAt`, else the time it arrived; the row also keeps the link's `code`.
- 2026-10-04 build: a late BOOKING_CREATED never revives a cancelled row; only a reschedule or cancel sets the state. Sync lists by `afterStart` from the first email sent (or `--since`), oldest booked first, and skips the old half of a reschedule.
- 2026-10-04 build: attendee-email match takes that address's newest enrollment.
- 2026-10-04 build: `contact_outcomes` reads a `booked` stop or any matched booking as warm, so recycling never mails a firm that booked.
- 2026-10-04 build: economics counts only matched bookings, and skips an enrollment whose `call_invites` row already counts as booked. Evolution unions both, one per recipient.
- 2026-10-04 build: console record `email.call`, an inbox "Calls" page; the Booked tiles point at it. A missing `CALCOM_WEBHOOK_SECRET` is 503, as Telnyx's key is.

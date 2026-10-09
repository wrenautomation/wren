---
type: object
cluster: sms
universe: live
status: verified
verified: 2026-10-09 @ 0ad591c4
entity: packages/channel-sms/src/schema.ts:624
---

# review-ask

One customer asked for a Google review, by text or by email: the ask, the one reminder, clicks on the counted link, private feedback. Table `review_asks`, in each client's database. Product words: Reviews, Review asks, Review links opened.

## Why this shape

One row per subject (`uq_review_asks_subject`), made before anything is sent, so a retry changes nothing and every refusal keeps its reason (`askReview`, `packages/channel-sms/src/reviews.ts:193`). Every customer is asked; rating never decides. The token is stored plain: it can only count a click and open Google's public form.

## Shape

- `subject`, `source` (won, done, paid, hand, door), `name`, `phone`, `e164`, `email` (trimmed, lowercased), `via` (text, email), `sent_at` (an email ask's send; a queued one without it resends), `token`, `place_id`, `contact_id` ([[sms/sms-contact]], set null), `ask` / `reminder` (queued, would_send, skipped, refused) with `_at` and `_detail`, `clicks`, `clicked_at`, `feedback`, `feedback_at` (`schema.ts:624`); migrations 0178, 0201
- the walk (`reviews.steps`): `in.customers` → `reviews.ask` → wait 3 days → `reviews.ask` `round: 2` (`remindReview`, `reviews.ts:327`, only if unopened). Door `{input: customers, subject: phone}`, so a door customer with only an email is refused at the door
- entry: call outcomes won (`won`) and not yet / not fit (`done`) with `onlyLive` (`packages/channel-email/src/calls/outcome.ts`); paid and anything else by the door; by hand `SmsConsole.askReview` (`restate/console.ts:211`, a phone or an email, 409 unless live)
- channel: the part's `via` (text by default); a customer with only the other channel is asked on that one. Email goes from portal@ under the client's name (`bookerMailer`, the worker's `mail.send`), template `email:reviews/<key>` (defaults in `packages/templates/defaults/email/reviews/`), which must carry `{review_link}`; `mailTo` (`reviews.ts:405`) adds the feedback line when on and a stop line, plus `List-Unsubscribe` one-click headers. No mailer (`WREN_PORTAL_FROM`/`WREN_PORTAL_MAILBOX` unset) or the client's sends off: `would_send`
- rules: no Place ID refused, no phone and no email skipped (an email finds its thread's phone), opt-outs and ended threads refused, email suppressions refused, once per person (phone or email) per `daysBetween` (90)
- link `phone.wrenautomation.com/r/<client>/<token>` → `Reviews/click` (`clickReview`, `reviews.ts:325`) → 302 to Google's write-review form; `/feedback` → `Reviews/feedback` (`saveFeedback`, `reviews.ts:467`); `/stop` (an email's stop link, GET confirms, POST or one-click stops) → `Reviews/stop` (`stopReview`, `reviews.ts:480`), an `opt_out` email suppression in the client's database. `makeReviews` (`restate/answers.ts:88`)
- record `sms.review` (`reviewRecord`, `records.ts:393`, with By and Email): views Asked, Opened, Feedback, All

Citations: `packages/channel-sms/src/schema.ts:624`, `packages/channel-sms/src/reviews.ts:193`, `packages/channel-sms/src/restate/answers.ts:88`, `packages/channel-sms/src/restate/console.ts:211`, `packages/channel-sms/src/records.ts:393`

## Connected to

- **owned-by:** the `reviews` part (`packages/channel-sms/src/components.ts`), a Shop template; needs fact `google_business.place_id` (setup `setup.google_business`, `setups.ts:171`; done for you, `findPlace` (`setups.ts:143`) reads the Place ID off Google Maps through autobrowse `web GET /place` on the desk and makes it the account's ref)
- **joins:** [[sms/sms-message]] (ask and reminder texts), email suppressions (`/stop`), [[email/call-booking]] (outcomes), [[platform/phone-worker]] (`/r/`), [[platform/spine]]
- **looks-like-but-is-not:** reviews gained (not counted: Google Business Profile API in development)

## If you change this

- **Hits:** `reviews.ts`, `answers.ts`, `console.ts`, `records.ts`, `apps/phone/src/worker.ts` (`REVIEW_PATH`), the email defaults, Texts > Reviews (`apps/portal/web/src/modules/texts/ask.tsx`)
- **Does not hit:** the main database (except reading the Place ID)

## Surfaces

| Surface | Role |
|---|---|
| `Spine/emit` and the door → `reviews.ask` | writes |
| phone Worker `/r/<client>/<token>[/feedback\|/stop]` → `Reviews` | counts clicks, keeps feedback, stops email |
| portal Texts > Reviews, Ask for a review (`SmsConsole.askReview`) | reads, writes |

## See

- Source: `packages/channel-sms/src/reviews.ts`
- Design: `designs/2026-10-07-missed-call-and-reviews.md`

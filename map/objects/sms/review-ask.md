---
type: object
cluster: sms
universe: live
status: verified
verified: 2026-10-07 @ da86269
entity: packages/channel-sms/src/schema.ts:616
---

# review-ask

One customer asked for a Google review: the ask, the one reminder, clicks on the counted link, private feedback. Table `review_asks`, in each client's database. Product words: Reviews, Review asks, Review links opened.

## Why this shape

One row per subject (`uq_review_asks_subject`), made before anything is sent, so a retry changes nothing and every refusal keeps its reason (`askReview`, `packages/channel-sms/src/reviews.ts:145`). Every customer is asked; rating never decides. The token is stored plain: it can only count a click and open Google's public form.

## Shape

- `subject`, `source` (won, done, paid, hand, door), `name`, `phone`, `e164`, `email`, `token`, `place_id`, `contact_id` ([[sms/sms-contact]], set null), `ask` / `reminder` (queued, would_send, skipped, refused) with `_at` and `_detail`, `clicks`, `clicked_at`, `feedback`, `feedback_at` (`schema.ts:616`); migration 0178
- the walk (`reviews.steps`): `in.customers` → `reviews.ask` → wait 3 days → `reviews.ask` `round: 2` (`remindReview`, `reviews.ts:266`, only if unopened). Door `{input: customers, subject: phone}`
- entry: call outcomes won (`won`) and not yet / not fit (`done`) with `onlyLive` (`packages/channel-email/src/calls/outcome.ts`); paid and anything else by the door; by hand `SmsConsole.askReview` (`restate/console.ts:204`, 409 unless live)
- rules: no Place ID refused, no phone skipped (email asks in development; an email finds its thread's phone), opt-outs and ended threads refused, once per phone per `daysBetween` (90)
- link `phone.wrenautomation.com/r/<client>/<token>` → `Reviews/click` (`clickReview`, `reviews.ts:325`) → 302 to Google's write-review form; `/feedback` → `Reviews/feedback` (`saveFeedback`, `reviews.ts:338`). `makeReviews` (`restate/answers.ts:87`)
- record `sms.review` (`reviewRecord`, `records.ts:388`): views Asked, Opened, Feedback, All

Citations: `packages/channel-sms/src/schema.ts:616`, `packages/channel-sms/src/reviews.ts:145`, `packages/channel-sms/src/restate/answers.ts:87`, `packages/channel-sms/src/restate/console.ts:204`, `packages/channel-sms/src/records.ts:388`

## Connected to

- **owned-by:** the `reviews` part (`packages/channel-sms/src/components.ts`), a Shop template; needs fact `google_business.place_id` (setup `setup.google_business`, `setups.ts:135`)
- **joins:** [[sms/sms-message]] (ask and reminder texts), [[email/call-booking]] (outcomes), [[platform/phone-worker]] (`/r/`), [[platform/spine]]
- **looks-like-but-is-not:** reviews gained (not counted: Google Business Profile API in development)

## If you change this

- **Hits:** `reviews.ts`, `answers.ts`, `console.ts`, `records.ts`, `apps/phone/src/worker.ts` (`REVIEW_PATH`), Texts > Reviews (`apps/portal/web/src/modules/texts/ask.tsx`)
- **Does not hit:** the main database (except reading the Place ID)

## Surfaces

| Surface | Role |
|---|---|
| `Spine/emit` and the door → `reviews.ask` | writes |
| phone Worker `/r/<client>/<token>[/feedback]` → `Reviews` | counts clicks, keeps feedback |
| portal Texts > Reviews, Ask for a review (`SmsConsole.askReview`) | reads, writes |

## See

- Source: `packages/channel-sms/src/reviews.ts`
- Design: `designs/2026-10-07-missed-call-and-reviews.md`

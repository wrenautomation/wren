# Hosted forms and text-to-pay (2026-10-07)

Product audit items 5 and 7 (`designs/2026-10-07-product-audit.md`). William: "steal all the stuff."

## Answer first

- **Forms are data.** A form is a row: fields (text, email, phone, select, multi, date, consent,
  hidden UTM), required and simple rules (digits, letters, ZIP, web address), a thank-you line or a redirect, and an optional
  booking step. No code change or deploy for a new form.
- **Hosted at `/o/f/<slug>`** on the owner's host: `wrenautomation.com` for Wren, the client's
  custom domain for a client. The same `/o/*` route Sites already uses, so nothing changes in DNS
  or `wrangler.toml`.
- **Embed** with an iframe tag or a one-line script that drops the iframe in. A Sites page's form
  section takes a form by id and renders that form in place of the default fields.
- **Every submit** runs Turnstile, keeps the consent words it showed (text and a version hash),
  keeps the UTM touch and the `wv` cookie, and enters the owner's door with
  `event: "form.submitted"`. Speed to lead runs off it as it does for the lander.
- **Numbers:** views, starts, submits and conversion per form and per source. Every submission is
  kept whole; the list exports to CSV.
- **Text-to-pay:** a Stripe Payment Link on the client's own key. Made from a text thread or the
  Payments page, sent by text or email. It waits in To approve unless whoever made it may approve
  for that client. Texts hold for the 8:00 to 20:00 window.
- **Paid** comes back by Stripe's `checkout.session.completed` webhook, checked with the
  client's own signing secret. The link turns paid, the contact gets `paid_at` and the amount,
  the thread shows it, and the spine hears `payment.received` (a Payment trigger).
- **Nothing charges anyone.** We never see a card. "Managed by Wren" (Stripe Connect) is
  **In development**: the fee split is William's call.

## Forms

### Data

All in the main database with a `client` column, like `site_pages` (one read at the edge).

- `site_form_defs`: `id`, `client`, `slug` (unique per owner), `name`, `status` (draft | live |
  retired), `spec` (JSON, below), `hook` (the door; null takes the owner's site door, as pages
  do), `created_*`, `updated_*`.
- `site_forms` (the existing submissions table) gains `form`, `consent` (`{text, version}` when
  the box was ticked), `visitor` (the `wv` cookie), `human` (`yes` or `off`: Turnstile passed, or
  wasn't set up). `page` turns nullable: a hosted form has no page.
- `site_events` gains `form` and the event `start` (first field touched). `page` turns nullable.
  A page with a form section counts its view on both.

`spec`:

```json
{
  "title": "Get a quote", "intro": "Two minutes.", "button": "Send",
  "fields": [
    {"key": "name", "kind": "text", "label": "Name", "required": true},
    {"key": "email", "kind": "email", "label": "Email", "required": true},
    {"key": "phone", "kind": "phone", "label": "Phone"},
    {"key": "service", "kind": "select", "label": "Service", "options": ["Repair", "Install"]},
    {"key": "sms_consent", "kind": "consent", "label": "<TCPA words>"},
    {"key": "utm_source", "kind": "hidden"}
  ],
  "after": {"kind": "thanks", "text": "Thanks. We'll text you soon."},
  "booking": {"url": "/book"}
}
```

Rules per field: `required`, `min`/`max` length, and one `rule` from a fixed list: `digits`,
`letters`, `zip`, `url`. No free regex: a client's typo can't lock a form, and no pattern runs
unchecked on the server. An email needs an `@` and a dot; a phone needs 10 to 15 digits. Every form
needs an email or a phone field. Hidden fields fill from the URL's query on load (`utm_*` by
default).

The consent box's words default to TCPA wording with the owner's name filled in:
"I agree to get texts from <business> at the number above, including marketing texts sent by
automated means. Consent is not a condition of purchase. Msg and data rates may apply. Msg
frequency varies. Reply STOP to stop, HELP for help." Its version is the first 12 hex of the
words' SHA-256. A submission keeps the words and version it was shown. Only a ticked box counts
(`sms_consent: "yes"`), as `leadOf` reads it.

### Serving

- `GET /o/f/<slug>` (or the form's id): the portal Worker asks `Sites/serveForm`, caches 60
  seconds, and sends a CSP that allows Turnstile's script and frame and lets any site frame it
  (`frame-ancestors *`: the embed).
- Posts go to the existing `/o/__form` with `{form, page?, view, fields, touch}`. The Worker checks
  Turnstile (`cf-turnstile-response` in the fields) when `TURNSTILE_SECRET` is set and refuses
  without a pass, reads the `wv` cookie, and calls `Sites/form`.
- The kit loads Turnstile into every `form[data-wren-form]` when the Worker has a site key, so
  data pages, hosted forms and code pages get the same check. Every page's CSP (`PAGE_CSP`, code
  pages too) allows `challenges.cloudflare.com` for script and frame.
- After a submit the form shows its thanks, or goes to its redirect. A booking step shows "Pick a
  time" with name and email carried in the query.

Embed:

```html
<iframe src="https://<host>/o/f/<slug>?embed=1" title="<name>" style="width:100%;border:0;min-height:640px" loading="lazy"></iframe>
<script src="https://<host>/o/__kit.js" data-embed="<slug>" defer></script>
```

The second drops the same iframe where the tag sits and resizes it to the form's height.

### Door

`Sites/form` keeps the submission, then enters the door: the form's own hook, else the owner's
first `site`-preset hook. The payload is the lander's shape plus `event: "form.submitted"`,
`form`, `form_id`, `consent_text`, `consent_version`, `visitor`, `utm_*`. Webhooks out
(`designs/2026-10-07-webhooks-out.md`) sends `form.submitted` on any door entry of kind `form`.

### Portal

Sites → Forms (Sites is where every public page lives) and Sites → Submissions.

- **Forms**: list with views, starts, submits, conversion. New form. Detail: the builder (fields
  in order, each with kind, label, required, rules, options), after-submit, booking step, consent
  words, a live preview, embed snippets, numbers per source. Publish and retire are direct: the
  words a person sees are the client's own, and a form asks, it never sends. Routes:
  `formCreate`, `formSave`, `formPublish`, `formUnpublish`, `formRetire`, `formDetail`.
- **Submissions**: every field, the source, consent words and version, visitor, door result.
  Export to CSV from the list.

## Text-to-pay

### Data

Main database, `client` column, so To approve and the webhook read one place.

- `pay_links`: `id`, `client`, `contact` (an `sms_contacts` id in the owner's database, or
  null), `email`, `name`, `channel` (sms | email), `description`, `amount_cents`, `quantity`,
  `currency`, `status` (waiting | sending | sent | processing | unpaid | paid | refunded |
  declined | failed), `why`, `stripe_link`, `url`, `message` (the queued text's id),
  `paid_cents`, `paid_at`, `session`, `intent` (the PaymentIntent), `refunded_cents`,
  `refunded_at`, `dispute` (open | won | lost) and `dispute_at`, `checked_at` (reconcile),
  `told` (changes the spine heard), `live` (Stripe's livemode), `created_*`, `approved_*`.
- `pay_accounts`: per client, the webhook endpoint's id and the name of its signing secret in the
  key store. Never the secret.
- `pay_events`: each Stripe event once, by its id, with what applying it did. Kept trimmed: ids,
  amounts, status, email. No card data ever reaches us; Stripe Checkout holds it.
- `sms_contacts` gains `paid_cents` and `paid_at`.
- `sms_messages.kind` gains `pay` (with `text_back` and `review`, all in `ANSWER_KINDS`): it waits
  for the asked window (8:00 to 20:00, clamped to the legal 20:00 cutoff) and skips opted-out,
  unreachable and stopped threads.

### Flow

1. **Create** (`payments/create`) from a thread (`contactId`) or the Payments page (phone or
   email): amount, description, quantity, channel.
2. **Approve:** if `mayApprove(who, client, approver)`, it goes on at once. Otherwise it waits in
   To approve (`pay:<id>`) and on the Payments page.
3. **Send:** a Price and a Payment Link on the client's key (idempotency key = our id, one
   completed checkout allowed, metadata `wren_link`). Then the text through `SmsDesk.reply` as
   kind `pay`, held for the window, or the email through the client's mailer when its sends
   flag `payments` is on.
4. **Paid:** Stripe posts to `https://app.wrenautomation.com/__pay/stripe/<client>`. The Worker
   passes the raw body and `Stripe-Signature` to `Payments/stripe`, which checks the HMAC with the
   client's signing secret (5 minute tolerance), keeps the event once, and on
   `payment_status: paid` marks the link, the contact and fires `payment.received`. Webhooks out
   maps the `trigger.payment` fire to `payment.received` too. A retried event answers `seen` and
   changes nothing; another client's link never matches from this client's endpoint.
5. **After:** refunds, disputes and bank payments that fail move the link too. See "Durable
   payments".

### Durable payments (2026-10-14)

Stripe sends each event at least once, in any order. Our worker can die between any two steps.
Every path below holds under both.

- **Client.** The official `stripe` SDK on an injected fetch, API version pinned
  (`Stripe.API_VERSION`). Each write carries an idempotency key from our row's id
  (`wren-price-<id>`, `wren-link-<id>`, `wren-webhook-<connect>`). The SDK retries twice on the
  same key, then Restate retries the step on the same key for up to 30 minutes. A 5xx or a dropped
  connection is never a failure. Stripe's 4xx is, at once, with its message.
- **Ids before inserts.** A link's id comes from the journal (`ctx.rand`, then `linkIdFor`). A
  retried step finds its row instead of making a second link. Ask again and the deposit do too.
- **Events.** `checkout.session.completed`, `async_payment_succeeded`, `async_payment_failed`,
  `charge.refunded`, `charge.dispute.created|updated|closed`. The Worker checks nothing but size.
  `Payments/stripe` checks the signature (SDK, 5 minutes either way), keeps the event once by its
  id, then applies it with the link's row locked.
- **States** (`states.ts`, pure). Paid is sticky. Processing only from an open state. A failed
  bank payment makes it unpaid. Refunds use Stripe's running total, so an old event never
  lowers it. A dispute event older than the last one is skipped. Status comes from the facts:
  refunded when the refund covers the payment or a dispute is lost. An open dispute keeps
  access; a won one keeps it.
- **Out of order.** A refund or dispute that arrives before its checkout is kept as unknown. Once
  the checkout names the PaymentIntent, it is applied.
- **After a crash.** The thread's paid mark is worked out again from the links, net of refunds,
  and cleared at zero. It runs on every delivery, duplicates included, so Stripe's resend finishes
  a run cut short. The spine hears each change (paid, refunded, failed) once ever: a journaled
  token claims it in `told`.
- **Reconcile.** `PayReconcile/all`, daily. Each connected client's links from the last 120
  days, at most 50 per pass, rechecked after 20 hours. It reads the link's sessions, its payment
  with the charge, and its disputes. A missed fact is applied as a `recon:` event through the
  same steps. Paid here but not on Stripe is drift: one event, said on the link, never changed
  by code. It also adds the new events to endpoints Wren registered. It writes nothing else on
  Stripe.
- **Access.** No portal page sits behind a paywall. Access means three things. The thread's
  paid mark. The document's deposit, which shows paid, clearing or refunded and makes a new link
  after a failed bank payment. And the spine's `payment` trigger with `on: paid | refunded |
  failed | any`. All three follow the link both ways.
- **Invoices.** The delivery app's invoices (Wise, manual) stay manual. The engagement's start
  gate only goes forward. Stripe invoices and subscriptions are not built.
- **Tests.** `states.test.ts` covers every transition and order. Integration, on a real
  Postgres: `money.test.ts` (duplicates, replay, any order, crash, access both ways, reconcile),
  `restate-payments.test.ts` (Restate retries with `alwaysReplay`, exactly-once spine),
  `stripe-mock.test.ts` (every call against Stripe's own spec) and documents'
  `restate-deposit.test.ts`.

### Setup and vendors

- Vendor `stripe`: own key only. "Managed by Wren" shows **In development**.
- Setup `setup.stripe` (site `stripe`): step 1 the key (client pastes a restricted key, or sends
  it to Wren), step 2 the webhook (Wren registers it through the API with that key; if the key
  can't, the client adds the endpoint and pastes its signing secret). Checks `stripe.key` and
  `stripe.webhook` read our rows, no network.
- Keys live in the key store (`designs/2026-10-07-key-store.md`). The browser stages the key and its
  signing secret outside Restate; `connect` takes `keyRef` and `secretRef`, and its schema
  refuses a raw key. Status shows the key's last 4.

### Portal

- **Payments** app: links with status, amount, paid, who and when. Views: All, To approve, Sent,
  Paid. New link. Approve and decline. Connect Stripe. Clients see their own.
- **Texts → thread**: "Send pay link"; the detail shows what they paid.
- **To approve**: pay links waiting, type "Payment".

## Forms, round two (2026-10-09)

Gaps item 7: show-when rules, steps, A/B per form, and forms in a client's own Sites. One
migration.

### Show when

A field may carry `show: {key, op, values?}`. `key` names an earlier field, so rules read top to
bottom and can't loop. `op` is `is` or `not` (with `values`), or `filled` or `empty`.

- `is` on pick one: its pick is one of `values`. On pick any: any pick is. On text: the same
  words, any case. `not` is the opposite. `filled` and `empty` work on any kind, hidden too, so a
  `utm_source` from the link can pick what shows.
- A field its rule hides isn't asked, isn't required, and its value is dropped on the server: the
  submission holds only what the visitor saw.
- One email or phone field has no rule, so every lead can be reached.
- The kit hides and disables a hidden field (a disabled field isn't sent). The server works out
  the same from the values, in order.

### Steps

Field kind `step` ("New step"). Its label heads the step that starts there. The form shows one
step at a time with Back and Next. Next checks only the step's shown fields. A step whose fields
are all hidden is skipped. Without script every step shows, as one form.

- Not first, not last, never two in a row, at most 9 (10 steps). Its key is `step_<n>`; it never
  holds a value and takes no rule.
- The kit counts `step` with its number (`site_events.step`) when a visitor reaches step 2 and
  on. The form's numbers read views, starts, each step, submits: where people stop.

### A/B per form

`site_form_splits`: `id`, `client`, `form`, `state` (running | shipped | stopped), `b` (B's
spec), `weight` (B's share, 1 to 99), `winner`, `started_*`, `ended_*`. One running per form.

- `/o/f/<slug>` serves A or B by weight. The `wab` cookie on `/o/f/<slug>` keeps a visitor on
  their arm for 30 days, as page splits do. A frame on another site rarely keeps a cookie, so
  there each load rolls again. Bots get A, uncounted.
- The form tag carries `data-fsplit` and `data-arm`; the kit sends both with every event and the
  submit. `site_events` and `site_forms` gain `form_split` and `arm`.
- A submit is checked against its arm's spec: the split's `b`, even after the split ends.
- The call: views and submits per arm through `splitCall` (beta-binomial, 100 views an arm before
  a call, 95% sure to name a winner).
- Start copies A as B to edit. Ship B: B's spec becomes the form's and the split ends `shipped`.
  Stop: ends `stopped`, A stays. All direct, no To approve: a form only collects.
- A page's form section always shows A. The page's own split tests the page.
- Routes: `formSplitStart`, `formSplitSave` (B's spec and weight), `formSplitStop`,
  `formSplitShip`.

### A client's own Sites

Its Sites gets Forms and Submissions with its rows only (`formRecordFor`, `entryRecordFor`, as
pages and links have). Its people build, publish and split their own forms; publish is direct, as
above. New form makes the form the workspace's: a client's in theirs, Wren's in Wren's.

## In development

- Stripe Connect (managed by Wren). Refunds from the portal (Stripe's dashboard for now), Stripe
  invoices and subscriptions. A drag editor.

## Shipped

- Migrations `0182_forms` (form defs, `site_forms`/`site_events` columns, records views) and
  `0183_payments` (`pay_links`, `pay_accounts`, `pay_events`, contact paid columns, message kinds).
- `@wren/sites`: `forms.ts`, `form-store.ts`, kit embed and Turnstile, `/o/f/<slug>` serving.
- `@wren/payments`: `stripe.ts` (signature, form body, API on an injected fetch), `store.ts`,
  `service.ts` (`Payments/send`, `Payments/stripe`), `console.ts`, `records.ts`, `setups.ts`.
- Portal: `src/pay.ts` (`/__pay/stripe/<client>`, POST, app host, 256 KB), Sites → Forms and
  Submissions, Payments app, "Send pay link" on threads, pay links in To approve, "Managed by Wren
  (in development)" on Vendors.
- Tests: forms and Stripe unit tests; sites and payments integration on a real Postgres with a
  fake Stripe (no network, no charge).
- Round two (2026-10-09): show-when rules and steps (743e0826, migration `0204_form_steps`);
  A/B per form (495ae61c, `form-split.ts`, migration `0205_form_splits`, the Worker's form
  branch shares the page split cache and cookie); a client's own Forms and Submissions
  (`formRecordFor`, `entryRecordFor`, New form owned by the asking workspace).
- Durable payments (2026-10-14): official SDK, `states.ts`, refunds, disputes, bank payments,
  `PayReconcile`, Ask again, migration `0259_pay_money`.

## Build

1. Forms: schema, spec, render, kit, serve, door, numbers, records, console, portal.
2. Payments: package, Stripe client with injected fetch, store, webhook, send path, setup,
   records, console, portal, To approve.
3. Worker, preview seed, map cards, shots.

## Decision log

- 2026-10-07: forms live in `@wren/sites` and reuse `site_forms`, `site_events`, `/o/__form` and
  the form section. One door path for pages and forms.
- 2026-10-07: `/o/f/<slug>`, not `/f/`: the apex route `/o/*` already reaches the Worker.
- 2026-10-07: form publish is direct, not a To approve item: a form only collects.
- 2026-10-07: pay links in the main database: To approve and the webhook read one place.
  The thread mark lives with the contact in its owner's database.
- 2026-10-07: `payment.received` is a spine fire (trigger `trigger.payment`, event kind
  `invoice`), as bookings are, not a door entry: there's no hook to name.
- 2026-10-14: the official `stripe` SDK plus stripe-mock, not a paid billing layer. The SDK pins
  the API version, types every object, retries on the same idempotency key, and keeps the
  signature check current. stripe-mock checks our requests against Stripe's own spec in CI. The
  only state of our own is a pay link's, and `states.ts` holds it. A paid service was never
  needed.
- 2026-10-14: an open dispute keeps access, a lost one ends it, a won one keeps it. A refund
  ends access only when it covers the payment.
- 2026-10-14: reconcile reads Stripe and heals through the same steps as a webhook. Drift
  (paid here, nothing on Stripe) is said on the link, never fixed by code.
- 2026-10-14: reconcile widens a client's pasted endpoint too, found by its URL, adding events and
  never dropping the client's own. A key that can't read or change endpoints leaves a plain note in
  the Stripe panel (`pay_accounts.note`): which events to add, and the read access a restricted
  key needs. It clears once the endpoint hears them all.
- 2026-10-14: delivery invoices stay Wise and manual. Stripe invoices or subscriptions for Wren's
  own billing are William's call (money).
- 2026-10-14: the reverse gate (wa-2hf). A setup invoice refunded in full or lost to a chargeback
  pauses a running engagement, the same `paused` the forward gate leaves; a partial refund doesn't.
  An open dispute flags urgent and pauses nothing. It is recorded by hand (`wren delivery refund`,
  `dispute`), since delivery invoices are Wise. It never resumes itself: `wren delivery engagement
  active` once settled. A fee handed back also stops an onboarding plan from starting.

---
type: object
cluster: platform
universe: live
status: verified
verified: 2026-10-14 @ e629cd17
entity: packages/payments/src/schema.ts:39
---

# pay-link

Text-to-pay: a Stripe Payment Link on the client's own key, sent by text or email, moved by Stripe's webhooks (paid, clearing, failed, refunded, disputed) and a daily reconcile. Tables `pay_links`, `pay_accounts`, `pay_events`; services `Payments`, `PaymentsConsole`, `PayReconcile`; the Payments app.

## Why this shape

Links live in main with a `client` column, so To approve and the webhook read one place; the thread's paid mark lives with the contact in the client's own database. Approval follows the client's approver like every send. Nothing charges anyone and no card data reaches us: Stripe Checkout holds it. Each Stripe event is kept once by id and applied by pure steps (`packages/payments/src/states.ts:109`) that give the same end in any order: paid is sticky, refunds take Stripe's running total, an older dispute event is skipped. Stripe writes go through the official SDK with idempotency keys from our row ids, inside Restate steps that retry 5xx and dropped connections; link ids come from the journal, so a retry finds its row.

## Shape

- `pay_links`: `client`, `contact`, `email`, `name`, `channel` sms|email, `description`, `amount_cents`, `quantity`, `currency`, `status` waiting|sending|sent|processing|unpaid|paid|refunded|declined|failed, `why`, `stripe_link`, `url`, `message`, `paid_cents`, `paid_at`, `session`, `intent`, `refunded_cents`, `refunded_at`, `dispute` open|won|lost, `dispute_at`, `checked_at`, `told` (changes the spine heard), `live`, `created_*`, `approved_*`. Migration `0259_pay_money` adds the money columns.
- `pay_accounts`: per client, the webhook endpoint id, the signing secret's key-store name (never the secret), `how` api|pasted, `live`, `note` (what reconcile found wrong with the endpoint's events that it couldn't fix; shown in the Stripe panel, cleared by a new key or secret or once the endpoint hears everything; migration `0261_pay_webhook_note`).
- `pay_events`: one row per Stripe event id, trimmed (ids, amount, status, email), `result` paid|processing|unpaid|refunded|disputed|stale|unknown|ignored|drift. Reconcile's own rows have `recon:<link>:…` ids. An `unknown` refund or dispute is applied once its checkout names the PaymentIntent (`applyEvent`, `packages/payments/src/store.ts:334`).
- `sms_contacts.paid_cents`, `paid_at`; `sms_messages.kind` `pay` (in `ANSWER_KINDS`, `packages/channel-sms/src/schema.ts:127`: held for the asked window, 20:00 cutoff). Migration `0183_payments`.
- Webhook: `POST app.<host>/__pay/stripe/<client>` (`apps/portal/src/pay.ts:33`, Restate idempotency key = SHA-256 of body and signature) → `Payments/stripe` → `takeWebhook` (`packages/payments/src/service.ts:231`), signature by the SDK in `verifySignature` (`packages/payments/src/stripe.ts:241`, 5 min either way). Events: `STRIPE_EVENTS` (`packages/payments/src/stripe.ts:19`). Then `settleLink` (thread paid mark net of refunds, cleared at zero; timeline line) and `tellChanges` (each of paid, refunded, failed fires `trigger.payment` once, claimed in `told`). Webhooks out: `payment.received`, `payment.refunded`, `payment.failed`.
- `PayReconcile/all` (`packages/payments/src/reconcile.ts:256`): daily, links of 120 days per connected client, 50 a pass; heals missed facts as `recon:` events, keeps drift (paid here, nothing on Stripe) as one event and the link's `why`; adds missing `STRIPE_EVENTS` to the client's endpoint, Wren's (by id) or a pasted one (found in the account by its URL), keeping the events the client chose. A key that can't read or change endpoints gets `pay_accounts.note` instead: which events to add, and that a restricted key needs read on Checkout Sessions, Payment Intents, Charges and Disputes (`holdEndpoint`). Off until started (`node scripts/ingress.mjs PayReconcile/all/start`).
- Ask again (`payments.again`): an `unpaid` link (bank payment failed) gets a new link with the same ask, once.
- Setup `setup.stripe` (`packages/payments/src/setups.ts:12`): key, then webhook (registered by API when the key allows, else pasted secret). Keys: the browser stages them (`/api/keys/stage`), `connect` takes `keyRef` and `secretRef`; the worker reads them from `pgKeyStore`.

Citations: `packages/payments/src/schema.ts:39`, `packages/payments/src/schema.ts:115`, `packages/payments/src/schema.ts:145`, `packages/payments/src/states.ts:109`, `packages/payments/src/service.ts:285`, `packages/payments/src/store.ts:390`, `packages/payments/src/reconcile.ts:70`, `apps/worker/src/services.ts`

## Connected to

- **owns:** `pay_links`, `pay_accounts`, `pay_events`
- **owned-by:** `@wren/payments`
- **writes:** [[leads/profile]] in the client's workspace: one `profile_events` line per link once sent, rewritten when paid or refunded (`notePayLink`, `packages/payments/src/service.ts`). The old `sms_contacts.paid_at` timeline stand-in is gone; [[documents/document]] deposits read the link's status (paid, clearing, refunded; a failed bank payment gets a new link)
- **joins:** [[clients/client]] by `client`; [[sms/sms-contact]] by `contact`; [[sms/sms-message]] (the `pay` text via `SmsDesk.reply`); [[platform/vendors]] (`stripe`, own key); [[platform/spine]] (`trigger.payment`)
- **looks-like-but-is-not:** [[books/vendor]] bills (Wren's own spend)

## If you change this

- **Hits:** `states.ts` and its tests first (every order must end the same), the payment line on the person's timeline (`lineFrom.payLink`, `packages/core/src/profiles-backfill.ts`), the Stripe webhook URL registered on every client's account (path and client slug), To approve (`pay:<id>` items in `packages/content/src/social/records.ts`), the thread's Paid fact in Texts, webhooks out's `payment.received` payload.
- **Does not hit:** cards or charges (none here).

## Surfaces

| Surface | Role |
|---|---|
| Payments app (`apps/portal/web/src/modules/payments`) | links, views All/To approve/Sent/Paid/Refunds and failures, New pay link, approve/decline, Ask again, Stripe panel (drift count) |
| Texts thread | Send pay link, Paid fact |
| Marketing → To approve | pay links waiting, type Payment |
| Account → Vendors | Stripe: their key; Managed by Wren (in development) |
| Stripe dashboard (outside the tree) | the webhook endpoint for `STRIPE_EVENTS`; refunds are made there |

## See

- Source: `packages/payments/src`
- Design: `designs/2026-10-07-forms-and-pay.md`

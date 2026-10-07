---
type: object
cluster: platform
universe: live
status: verified
verified: 2026-10-07 @ 6fc58b65
entity: packages/payments/src/schema.ts:43
---

# pay-link

Text-to-pay: a Stripe Payment Link on the client's own key, sent by text or email, marked paid by Stripe's webhook. Tables `pay_links`, `pay_accounts`, `pay_events`; services `Payments`, `PaymentsConsole`; the Payments app.

## Why this shape

Links live in main with a `client` column, so To approve and the webhook read one place; the thread's paid mark lives with the contact in the client's own database. Approval follows the client's approver like every send. Nothing charges anyone and no card data reaches us: Stripe Checkout holds it. Each Stripe event is kept once by id, so retries change nothing.

## Shape

- `pay_links`: `client`, `contact`, `email`, `name`, `channel` sms|email, `description`, `amount_cents`, `quantity`, `currency`, `status` waiting|sending|sent|paid|declined|failed, `why`, `stripe_link`, `url`, `message`, `paid_cents`, `paid_at`, `session`, `live`, `created_*`, `approved_*`.
- `pay_accounts`: per client, the webhook endpoint id, the signing secret's key-store name (never the secret), `how` api|pasted, `live`.
- `pay_events`: one row per Stripe event id, trimmed (ids, amount, status, email).
- `sms_contacts.paid_cents`, `paid_at`; `sms_messages.kind` `pay` (in `ANSWER_KINDS`, `packages/channel-sms/src/schema.ts:127`: held for the asked window, 20:00 cutoff). Migration `0183_payments`.
- Webhook: `POST app.<host>/__pay/stripe/<client>` (`apps/portal/src/pay.ts:22`) → `Payments/stripe` → `takeWebhook` (`packages/payments/src/service.ts:145`), HMAC by `verifySignature` (`packages/payments/src/stripe.ts:147`, 5 min tolerance). Paid fires `trigger.payment`; webhooks out sends `payment.received`.
- Setup `setup.stripe` (`packages/payments/src/setups.ts:12`): key, then webhook (registered by API when the key allows, else pasted secret). The worker binds `keys: null`: Connect answers "in development" in prod.

Citations: `packages/payments/src/schema.ts:43`, `packages/payments/src/schema.ts:100`, `packages/payments/src/schema.ts:130`, `packages/payments/src/console.ts:122`, `packages/payments/src/service.ts:168`, `apps/worker/src/services.ts`

## Connected to

- **owns:** `pay_links`, `pay_accounts`, `pay_events`
- **owned-by:** `@wren/payments`
- **joins:** [[clients/client]] by `client`; [[sms/sms-contact]] by `contact`; [[sms/sms-message]] (the `pay` text via `SmsDesk.reply`); [[platform/vendors]] (`stripe`, own key); [[platform/spine]] (`trigger.payment`)
- **looks-like-but-is-not:** [[books/vendor]] bills (Wren's own spend)

## If you change this

- **Hits:** the Stripe webhook URL registered on every client's account (path and client slug), To approve (`pay:<id>` items in `packages/content/src/social/records.ts`), the thread's Paid fact in Texts, webhooks out's `payment.received` payload.
- **Does not hit:** cards or charges (none here).

## Surfaces

| Surface | Role |
|---|---|
| Payments app (`apps/portal/web/src/modules/payments`) | links, views All/To approve/Sent/Paid, New pay link, approve/decline, Stripe panel |
| Texts thread | Send pay link, Paid fact |
| Marketing → To approve | pay links waiting, type Payment |
| Account → Vendors | Stripe: their key; Managed by Wren (in development) |
| Stripe dashboard (outside the tree) | the webhook endpoint for `checkout.session.completed` |

## See

- Source: `packages/payments/src`
- Design: `designs/2026-10-07-forms-and-pay.md`

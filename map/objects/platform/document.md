---
type: object
cluster: platform
universe: live
status: verified
verified: 2026-10-09 @ 900950d3
entity: packages/documents/src/schema.ts:107
---

# document

Documents and e-sign: a contract, proposal or estimate from the client's template, sent by text or email, signed on a page under the client's host by a typed name, an email and a consent box. Tables `docs`, `doc_templates`, `doc_events`, `doc_counters`; services `Documents`, `DocumentsConsole`; its own Documents app (Documents, Templates); Send estimate on a texting thread.

## Why this shape

Rows live in main with a `client` column, so the edge serves a signing page with one read and To approve sees every client's. A document copies what it needs from its template, so a template edit never changes a sent one. Send freezes the text and keeps its SHA-256; the signer's post must carry the same hash, so what was signed is what was shown. Only the link token's SHA-256 is kept; a reminder mints a new token and the old link dies. The table is `docs` because research owns `documents`.

## Shape

- `docs`: `client`, `template`, `kind` contract|proposal|estimate, `number` (`EST-0007`, per client and kind from `doc_counters`), `title`, `body` (light marks, `{slots}`), `lines` (DocLine jsonb), cents totals (checked `total = subtotal + tax`), `deposit_cents`, recipient `name`/`email`/`contact`, `channel` email|sms, `status` draft|waiting|sending|sent|viewed|signed|declined|expired|void|failed, `token_hash`, `expires_days`/`expires_at`, `sha256`, signer fields, `consent_version`, `pay_link`.
- `doc_events`: made|asked|sent|viewed|signed|declined|paid|voided|expired|reminded, with `ip`, `agent`, `note`. The PDF's signing record reads here.
- Pure math in `packages/documents/src/lines.ts:5` (kinds, totals rounded per line, slots); the portal imports it.
- Slots: `{contact.name|first_name|email}`, `{biz.name}`, `{biz.<fact>}` (`customFacts`), `{doc.number|total|deposit|expires}`. A slot left blocks Send.
- Edge: `apps/portal/src/docs.ts:97` serves `/o/d/<token>` (GET page, POST sign/decline after Turnstile), `/pdf`, `/pay` on the client's host, Wren's apex, or the app host. Never cached; bots never count as an open.
- Deposit: `/o/d/<token>/pay` makes a `pay_links` row (`pay_links.document`) on the client's Stripe key on first ask, then 303 to Stripe.
- Spine: `trigger.document` (viewed|signed|declined), event kind `document`, webhooks out `document.*` (`docFired`, `packages/documents/src/service.ts:124`).
- Migration `0222_documents`. Texts kind `doc` (in `ANSWER_KINDS`).

Citations: `packages/documents/src/schema.ts:107`, `packages/documents/src/service.ts:248`, `packages/documents/src/console.ts:139`, `apps/portal/src/docs.ts:97`, `apps/worker/src/services.ts:1017`

## Connected to

- **owns:** `docs`, `doc_templates`, `doc_events`, `doc_counters`
- **owned-by:** `@wren/documents`
- **joins:** [[clients/client]] by `client`; [[sms/sms-contact]] by `contact`; [[sms/sms-message]] (the `doc` text via `SmsDesk.reply`); [[platform/pay-link]] (the deposit); [[platform/spine]] (`trigger.document`)
- **looks-like-but-is-not:** research's `documents` table (source documents for studies)

## If you change this

- **Hits:** `shownText` (any change re-hashes: a sent document's stored `sha256` stops matching and signing is refused), the consent words (bump `CONSENT_VERSION`), the `/o/d/` path in every link already sent, To approve (`doc:<id>`), webhooks out's `document.*` payload.
- **Does not hit:** cards or charges (Stripe holds them).

## Surfaces

| Surface | Role |
|---|---|
| Documents app → Documents, Templates | drafts, Send, approve/decline, remind, void, duplicate, PDF |
| Texts thread | Send estimate |
| Marketing → To approve | documents waiting, type Document |
| Signing page `/o/d/<token>` | read, sign, decline, PDF, pay deposit |

## See

- Source: `packages/documents/src`
- Design: `designs/2026-10-09-documents.md`

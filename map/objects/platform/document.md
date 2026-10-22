---
type: object
cluster: platform
universe: live
status: verified
verified: 2026-10-21 @ b73663f5
entity: packages/documents/src/schema.ts:128
---

# document

Documents and e-sign: a contract, proposal or estimate from the client's template, sent by text or email, signed on a page under the client's host by a typed name, an email and a consent box (`signing: own`), or sealed by Documenso (`signing: sealed`). Tables `docs`, `doc_templates`, `doc_events`, `doc_counters`; services `Documents`, `DocumentsConsole`; its own Documents app (Documents, Templates); Send estimate on a texting thread.

## Why this shape

Rows live in main with a `client` column, so the edge serves a signing page with one read and To approve sees every client's. A document copies what it needs from its template, so a template edit never changes a sent one. Send freezes the text and keeps its SHA-256; the signer's post must carry the same hash, so what was signed is what was shown. Only the link token's SHA-256 is kept; a reminder mints a new token and the old link dies. The table is `docs` because research owns `documents`.

## Shape

- `docs`: `client`, `template`, `kind` contract|proposal|estimate, `number` (`EST-0007`, per client and kind from `doc_counters`), `title`, `body` (light marks, `{slots}`), `lines` (DocLine jsonb), cents totals (checked `total = subtotal + tax`), `deposit_cents`, recipient `name`/`email`/`contact`, `channel` email|sms, `status` draft|waiting|sending|sent|viewed|signed|declined|expired|void|failed, `token_hash`, `expires_days`/`expires_at`, `sha256`, signer fields, `consent_version`, `pay_link`, `signing` own|sealed, `envelope_id` (Documenso's, unique), `sealed` (jsonb: the three bucket keys, the sealed PDF's SHA-256, when).
- `doc_events`: made|asked|sent|viewed|signed|declined|paid|voided|expired|reminded, with `ip`, `agent`, `note`. The PDF's signing record reads here.
- Pure math in `packages/documents/src/lines.ts:5` (kinds, totals rounded per line, slots); the portal imports it.
- Slots: `{contact.name|first_name|email}`, `{biz.name}`, `{biz.<fact>}` (`customFacts`), `{doc.number|total|deposit|expires}`. A slot left blocks Send.
- Edge: `apps/portal/src/docs.ts:97` serves `/o/d/<token>` (GET page, POST sign/decline after Turnstile), `/pdf`, `/pay` on the client's host, Wren's apex, or the app host. Never cached; bots never count as an open.
- Deposit: `/o/d/<token>/pay` makes a `pay_links` row (`pay_links.document`) on the client's Stripe key on first ask, then 303 to Stripe. Its id comes from the journal, so a retry or a second click finds one link; Stripe's 5xx is retried, its refusal shuts the page. The page follows the link both ways: paid, clearing (bank), refunded; a failed bank payment gets a new link (`packages/documents/src/service.ts:211`).
- Spine: `trigger.document` (viewed|signed|declined), event kind `document`, webhooks out `document.*` (`docFired`, `packages/documents/src/service.ts:156`).
- Sealed (`signing: sealed`, designs/2026-10-21-esign-and-newsletter.md): `Documents.send` makes a Documenso envelope from the frozen text (`sealedPdf`, placeholders `{{signature, r1}}` and `{{date, r1}}`, `documenso.ts`), keeps its id (`keepEnvelope`), makes it live and mails Documenso's link under the client's name; no Wren token and no Wren expiry. The phone Worker's `/webhooks/documenso` forwards to `Documents.signed` (`service.ts:590`): opened → viewed, completed → signed, rejected → declined, cancelled → void; on completed the sealed PDF, certificate and audit log go to the files bucket under `clients/<client>/documents/<doc>/` (`sealSigned`, `sealedKeys`) and `consent_version` is `SEALED_CONSENT_VERSION`. A void calls `Documents.cancel`, which cancels the envelope. `own` and `sealed` never mix: `signDoc` and `declineDoc` refuse a sealed one. Config `WREN_DOCUMENSO_URL`/`_TOKEN` (SSM `env-3`); unset, a sealed send stops with a reason.
- Migrations `0222_documents`, `0316_docs_sealed`. Texts kind `doc` (in `ANSWER_KINDS`).

Citations: `packages/documents/src/schema.ts:128`, `packages/documents/src/service.ts:324`, `packages/documents/src/console.ts:315`, `packages/documents/src/documenso.ts:68`, `apps/portal/src/docs.ts:97`, `apps/worker/src/services.ts:1251`

## Connected to

- **owns:** `docs`, `doc_templates`, `doc_events`, `doc_counters`
- **owned-by:** `@wren/documents`
- **joins:** [[clients/client]] by `client`; [[sms/sms-contact]] by `contact`; [[sms/sms-message]] (the `doc` text via `SmsDesk.reply`); [[platform/pay-link]] (the deposit); [[platform/spine]] (`trigger.document`); Documenso (outside, [[effects/CONTEXT]])
- **looks-like-but-is-not:** research's `documents` table (source documents for studies)

## If you change this

- **Hits:** `shownText` (any change re-hashes: a sent document's stored `sha256` stops matching and signing is refused), the consent words (bump `CONSENT_VERSION`), the `/o/d/` path in every link already sent, To approve (`doc:<id>`), webhooks out's `document.*` payload.
- **Does not hit:** cards or charges (Stripe holds them).
- **Sealed:** the Documenso id on `docs.envelope_id` and the webhook's event names (`eventOf`, `documenso.ts`); a Documenso upgrade can change both. `docs.sha256` stays the text's fingerprint; the sealed file's hash is in `sealed`.

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

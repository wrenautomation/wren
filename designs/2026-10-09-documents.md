# Documents, e-sign and estimates

2026-10-09. Gaps item 9 (`2026-10-09-gaps.md`; audit: GHL "Documents & Contracts", "Proposals &
Estimates"). A client sends its customer a contract, proposal or estimate. The customer reads it
on the client's own host, signs by typing a name, and pays a deposit if one is asked. Every step
is kept as proof.

## Today

- Wren's own services agreement (`packages/delivery/src/contract.ts`): one template, the issued
  text frozen with its SHA-256, signed in the portal by an owner with a typed name, a ticked box
  and the fingerprint of the text they read. IP and agent kept, and the signed copy mailed.
- Pay links (`2026-10-07-forms-and-pay.md`): a Stripe Payment Link on the client's own key, sent
  by text or email, waits in To approve, and paid comes back by webhook.
- Hosted forms serve on the owner's host under `/o/*`. Documents serve the same way.

What's missing: anyone who isn't a portal login can't sign, there are no line items, and there is
no template a client can write.

## Shape

New package `@wren/documents`. Tables live in the main database with a `client` column, like
`pay_links`, so the edge serves a signing page with one read. Wren's own documents use client
`wren`.

| Kind | Has | Signing means |
|---|---|---|
| `contract` | words | they agree to the words |
| `proposal` | words and line items | they accept the work and price |
| `estimate` | line items, a short note | they accept the price; a deposit can follow |

All three kinds share one table, one page and one flow. The kind only sets the default template,
the number prefix (`DOC`, `PRO`, `EST`) and the button label ("Sign", "Accept").

## Data (one migration, 0222)

- `doc_templates`: `id`, `client`, `kind`, `name`, `body` (light marks, as `contract.ts`: `# `,
  `## `, `- `, blank lines), `lines` (default line items), `deposit_pct`, `expires_days`
  (default 30), `archived_at`, `created_*`, `updated_*`. A client edits freely. A document copies
  what it needs, so editing a template never changes a sent document.
- `documents`: `id` (uuid), `client`, `template`, `kind`, `number` (per client and kind,
  `EST-0007`), `title`, `body` (filled), `lines` (`[{name, detail, qty, unit_cents, tax_pct}]`),
  `currency`, `subtotal_cents`, `tax_cents`, `total_cents`, `deposit_cents`, recipient (`name`,
  `email`, `contact`: an `sms_contacts` id), `channel` (email | sms), `status`, `why`,
  `token_hash`, `expires_at`, `sha256` (of the text as shown: body, lines and totals), the times
  `sent_at`, `viewed_at`, `signed_at` and `declined_at`, the signer's `signer_name`,
  `signer_email`, `signed_ip`, `signed_agent` and `consent_version`, then `declined_why`,
  `pay_link`, `created_*` and `approved_*`.
- `doc_events`: every step once, in order: `made`, `asked`, `sent`, `viewed`, `signed`,
  `declined`, `paid`, `voided`, `expired`, with time, who (a login or "recipient"), IP and agent.
  The signing record reads from here.
- `doc_counters`: `(client, kind) → next`, taken in the same transaction as the insert.
- `pay_links` gains `document` (uuid, null). `sms_messages.kind` gains `doc`.

Statuses: `draft` → `waiting` (To approve) → `sent` → `viewed` → `signed` | `declined` |
`expired`, and `void` from any open status. Once signed, a document never changes. A fix means a
new document.

Money is integer cents. Tax is per line, a percent the client types, rounded per line, and no
tax engine. Totals are worked out on the server only.

## Filling

The body and line names take the same `{...}` slots as Templates (`2026-10-07-templates-live-copy.md`):
`{contact.first_name}`, `{contact.name}`, `{biz.name}`, `{biz.phone}`, `{biz.email}`, custom
fields (`{custom.<key>}`), `{doc.number}`, `{doc.total}`, `{doc.expires}`. They are filled once,
when the document is made. A slot with no value blocks Send and names the slot. Nothing is sent
half filled.

## Sending

- **Make** from a template, a text thread, a contact, or blank. The draft can be edited.
- **Send** checks the slots, freezes the text and its SHA-256, and makes the link. It waits in
  To approve (`doc:<id>`) unless `mayApprove(who, client, approver)`, the same rule pay links
  use.
- **Link**: `https://<owner host>/o/d/<token>`. The token is 32 random bytes, base64url, and only
  its SHA-256 is stored. The link goes out by email through the client's mailer (its sends flag
  `documents`) or by text through `SmsDesk.reply` as kind `doc`. Texts hold for the 8:00 to 20:00
  window and skip opted-out threads, as `pay` does.
- **Remind** is a button, the same message again. Nothing reminds on its own while sending is on
  hold.

## Signing page

Served by the portal Worker from `Documents/serve`. It is cached for no time, set `noindex`, and
carries the owner's Look (logo, colors), like a hosted form.

- It shows the title, number, words, line items, totals and the expiry date.
- The first open counts `viewed`. Later opens add a `viewed` event at most once an hour.
- To sign: type your full name, give an email (prefilled when sent by email), and tick a box:
  "I agree to sign electronically. Typing my name is my signature." The words carry a version.
  Turnstile runs as on forms. The post carries the SHA-256 the page showed, and the server refuses
  it if the text changed. That covers US ESIGN and UETA, and Ontario's Electronic Commerce Act.
- **Decline**: an optional reason, kept.
- After a signature the page shows "Signed by <name> on <date>" and a PDF link. An estimate or
  proposal with a deposit shows **Pay deposit**: a pay link made right then on the client's
  Stripe key. No To approve step, since the client approved the document that asks for it. With no
  Stripe connected, no deposit can be set.
- Expired or void: one line saying so, and how to reach the owner (`{biz.phone}`, `{biz.email}`).

## Proof

- **PDF** at `/o/d/<token>/pdf`, built on demand from the frozen row with `pdf-lib`: the words,
  lines, totals, then a signing record page listing each event's time, IP and agent, the signer's
  name and email, the consent words, and the SHA-256. The same row always gives the same PDF.
- **Mail**: once signed, the signer and the client's owners get the link to the signed copy.
- **Spine**: `document.viewed`, `document.signed` and `document.declined` enter the owner's door
  (Workflow triggers), and the webhooks out send them. A paid deposit fires `payment.received` as
  today, with `document` set.

## Portal

**Payments → Documents** (`payments.document`, `payments.doc_template`), for Wren and each client
on its own rows:

- List: number, who, kind, total, status, sent, viewed, signed. Views: Open (default), To approve,
  Signed, All.
- Detail: an editor while it's a draft (title, words with a slot picker, a line table with a
  running total, deposit, expiry, recipient), a live preview of the signing page, and the
  timeline from `doc_events`. Actions: Send (or Ask), Approve, Decline, Remind, Void, Duplicate,
  Copy link, PDF.
- Templates: list, new, edit, archive. Three starters ship with every client: a short service
  agreement, a proposal, and an estimate. Their words are plain, and the client edits them.
- A text thread gets "Send estimate". A contact shows its documents.
- To approve: waiting documents, type "Document".

## Not in this round

- Drawn signatures, several signers in order, and signing fields placed on an uploaded PDF.
- Turning an estimate into a recurring invoice. Deposits only.
- Moving Wren's own services agreement onto this. It stays in `delivery` until a client-facing
  need forces it.
- Reminders on a schedule, while sending stays on hold.

## Decision log

- 2026-10-09: my calls (William: build it all, ask nothing).
  - One table for all three kinds: they differ only in labels and defaults.
  - Typed-name signing, as Wren's own agreement already does. Drawn signatures add no legal
    weight under ESIGN or Ontario's Act.
  - The PDF is built on demand instead of stored: nothing to keep in sync, and the frozen row is
    the record.
  - Main database with `client`: one read at the edge, like `pay_links`.
- 2026-10-09, as built:
  - The table is `docs`: research already owns `documents`.
  - Records `documents.document` and `documents.template`, served by `DocumentsConsole` (portal
    service key `documents`, app Payments).
  - Slots are `customFacts`' names: `{biz.<key>}`, `{field.<key>}`, plus `{contact.name}`,
    `{contact.first_name}`, `{contact.email}`, `{biz.name}`, `{doc.number|total|deposit|expires}`.
  - A reminder mints a new token, so the older link stops working.
  - The deposit's pay link is made on first ask at `/o/d/<token>/pay`, not at signing: no
    Stripe call for a signer who never pays online.
  - A bot's fetch (a texting app's link preview) is served but never counts as an open.
  - A client with no live domain links on the app host, which serves any client's documents.
  - Totals and slots live in `lines.ts` with no imports, so the editor shows the server's math.
  - The deposit percent is derived from the cents, not stored.

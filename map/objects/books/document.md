---
type: object
cluster: books
universe: live
status: verified
verified: 2026-09-30 @ ec9a947
entity: packages/books/src/schema.ts:99
---

# document

A raw money record kept forever: a vendor email, one of its PDFs, or a file added by hand. Table `books.documents`; the bytes live in the document store.

## Why this shape

CRA wants the source behind every entry for 6 years, so nothing captured is thrown away, even an ad or a personal email. Rows are keyed by `sha256`, so the same bytes are one row; `(mailbox, mailbox_key)` lets a re-run skip a message before fetching it. `reading` keeps the model's raw answer and the checks' verdicts, so a wrong bill traces back to what was read.

## Shape

- `documents` (`schema.ts:99`): sha256, media type, size, `store_key`, source (mailbox | file | attachment), `parent_id` (an attachment's email), mailbox and `mailbox_key`, Message-ID, from, subject, sent, vendor, text, kind (bill | payment | notice | other), `read_at`, `reading`, `run_id`
- Store: S3 `WREN_BOOKS_BUCKET`, else `.books/` on disk; key from `storeKey` (`packages/books/src/store.ts:28`)

Citations: `packages/books/src/schema.ts:99`, `packages/books/src/store.ts:28`

## Connected to

- **owned-by:** [[books/vendor]] (`vendor_id`; null when no sender rule matched)
- **owns:** its attachments (`parent_id`)
- **joins:** [[books/bill]] (`bills.document_id`, `bill_documents`, `bill_payments.document_id`), [[ledger/run]]
- **looks-like-but-is-not:** [[research/document]] (a company's web page, `public.documents`)

## If you change this

- **Hits:** `capture`, `keepEmail` (`packages/books/src/capture.ts:48`, `:101`), `readDocuments` (`packages/books/src/read.ts:108`), `reviewQueue` (`packages/books/src/report.ts:141`), `wren books doc`
- **Does not hit:** the journal (entries cite bills, not documents)

## Surfaces

| Surface | Role |
|---|---|
| `wren books import` | writes |
| `wren books read --vendor` / `dismiss` | set vendor, kind |
| `wren books review` / `doc` | read |

## See

- Source: `packages/books/src/capture.ts`, `packages/books/src/store.ts`

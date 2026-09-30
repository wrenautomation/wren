---
type: process
status: verified
verified: 2026-09-30 @ 0964efe
consumes: ["[[books/vendor]]"]
produces: ["[[books/document]]", "[[books/bill]]", "[[books/entry]]", "[[ledger/run]]"]
---

# books-import

Vendor emails become bills, and bills become journal entries.

## Input → Movement → Output

Each mailbox in `WREN_BOOKS_MAILBOXES` (delegated Gmail or autobrowse) and a first day (`WREN_BOOKS_SINCE`). One search per mailbox finds every known vendor's emails; each email and its PDFs are stored raw, the model reads those a vendor rule matched, and `check` keeps what is printed and adds up. `post` then makes the journal match the bills.

## Why this shape

The model is never trusted with a number: each figure must be printed in the document and add up, or the bill is held. Posting reconciles instead of appending, so a re-read or a review decision is safe any time: what changed is reversed on the same date and posted again.

## Steps

1. Seed the chart and vendors (`packages/books/src/chart.ts:124`).
2. Search each mailbox (`packages/books/src/mailbox.ts:92`); keep every new email and PDF (`packages/books/src/capture.ts:48`, `:101`).
3. Read unread documents that have a vendor (`packages/books/src/read.ts:123`), check the reading (`packages/books/src/ground.ts:250`), save the bill (`read.ts:298`), void the bills a re-read no longer gives (`:387`), link payments (`:410`); a payment naming no invoice stays on account.
4. Post (`packages/books/src/post.ts:105`) at the stated CAD charge, else the Bank of Canada rate (`packages/books/src/rates.ts:38`).
5. The CLI wraps it in one `runs` row (`apps/cli/src/books.ts:166`).

## If you change this

- **Hits:** [[books/document]], [[books/bill]], [[books/entry]]
- **Does not hit:** the email channel's inbox sync (books runs its own search and shares only the MIME reader, `packages/core/src/mail.ts`)

## Surfaces

| Surface | Role |
|---|---|
| `wren books import` | runs it all |
| `wren books read` / `post` | one step again |
| `wren books payments` | every payment, with its bill or on account |
| no loop yet | runs by hand |

## See

- Objects: [[books/bill]], [[books/entry]]
- Source: `apps/cli/src/books.ts`, `packages/books/src/`

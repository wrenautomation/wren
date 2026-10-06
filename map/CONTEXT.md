# How to walk this map

Verified against commit `83459e9` on 2026-09-28. The repo is a TypeScript monorepo (pnpm + turbo): Restate (self-hosted on the box) calls a Lambda (`apps/worker`), which runs every channel's services over Postgres 17 (Drizzle). Deps point down: `config` ← `db` ← `core` ← `research`, `content`, `channel-*`; `niches` sits on the channels; `books` sits on `core`, `db` and `llm`; `cli` and `worker` sit on everything; `llm` and `offers` are leaves. Channels never import each other.

## Walk

1. `CLAUDE.md` names the cluster. `objects/_index.md` names the card.
2. A card says what the thing is, why it has this shape, where it lives (`path:line`), and what a change hits first-order.
3. `effects/CONTEXT.md` turns a change into a short list of cards. It never repeats a card.
4. Load the entry file, one hub and one card. Do not read the whole `objects/` folder.

## Universes

| Universe | Meaning here |
|---|---|
| **live** | Bound in `apps/worker/src/services.ts` or reachable from `apps/cli`, and running in prod. Implement against these. |
| **leftover** | Present, no longer the main path. None now: the old LinkedIn pipeline tables, `llm_calls` and the notes inbox were dropped on 2026-09-28 (`packages/db/drizzle/0014_drop_leftovers.sql`). Mark a card `leftover` when something loses its writer. |
| **ghost** | Named but not wired. None now. |
| **in build** | Wired, not yet live by design. SMS: the `fake` provider is refused on Lambda (`apps/worker/src/services.ts:365`) until Telnyx is configured. Cards stay `live`. |

## Name collisions

| Word | Meanings |
|---|---|
| lead | prose: a company to reach. `leads` table: one email address with `status` (`packages/core/src/schema.ts:219`). `Ads.leads`: Meta lead-form fills. |
| message | `messages` (email drafts and sends, `packages/channel-email/src/schema.ts:236`) vs `sms_messages` (`packages/channel-sms/src/schema.ts:200`). Different states, different tick. |
| draft | `messages.state = draft`; a `content_drafts` row. |
| enrollment | `enrollments`: one email sequence per company. SMS has no table; a contact's `state` becomes `enrolled`. |
| campaign | worker `Campaign` (a niche's templates + sequences + plan, `apps/worker/src/services.ts:176`); a Meta campaign id in `ad_launches`; the 10DLC campaign that `WREN_SMS_LIVE` stands for. |
| verification | `verifications` rows (address verdicts); `Discovery.verify` (does this domain belong to this company); `Resolution.verifyLeads`. |
| sync | loop handler `sync` = one pass now (`packages/core/src/restate/loop.ts`); `syncInbox` = read a mailbox; `inbox_syncs` / `open_syncs` = cursors. |
| template | an `.email` file parsed to a `Template` tree; `template_versions` = the stored source per content hash; an SMS `SmsStep` body. |
| sender | a roster `Sender` (an inbox address); `SmsSender` (the SMS loop object); `enrollments.sender` (the address chosen at compose). |
| run | `runs` ledger row; one pass of a loop object. |
| post | a published content draft; LinkedIn's `/rest/posts`; `wren books post` (make the journal match the bills). |
| document | `documents` (a company's web page, `packages/research/src/schema.ts:31`) vs `books.documents` (a vendor email or PDF, `packages/books/src/schema.ts:99`). |
| account | `books.accounts` (the chart, `packages/books/src/schema.ts:34`); `clients.accounts` (a client's ids, jsonb, `packages/core/src/clients/schema.ts:26`); autobrowse accounts (logins, not in this repo). |
| line | `books.lines` (one side of a journal entry) vs `books.bill_lines` (a bill's printed items). |
| sites | autobrowse's Restate service, not in this repo. Every platform and Meta call goes through it (`packages/core/src/content/restate.ts:21`). Reddit does not. |
| worker | `apps/worker` (Node/Lambda Restate endpoint); `apps/phone` (Cloudflare Worker, SMS inbox + webhooks); `deploy/pixel` (Cloudflare Worker, open pixel). |
| box | autobrowse's EC2 machine, woken by `packages/core/src/content/box.ts`. |

## What the map is not

Not a spec (those are `designs/`), not an ops runbook (`docs/restate-operations.md`), not a tutorial (`walkthrough/`). When a card wants to explain behaviour, it points at the file that owns it.

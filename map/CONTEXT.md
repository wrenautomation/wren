# How to walk this map

Verified against commit `28823cd` on 2026-09-28. The repo is a TypeScript monorepo (pnpm + turbo): Restate Cloud calls a Lambda (`apps/worker`), which runs every channel's services over Postgres 17 (Drizzle). Deps point down: `config` ← `db` ← `core` ← `research`, `content`, `channel-*`; `niches` sits on the channels; `cli` and `worker` sit on everything; `llm` and `offers` are leaves. Channels never import each other.

## Walk

1. `CLAUDE.md` names the cluster. `objects/_index.md` names the card.
2. A card says what the thing is, why it has this shape, where it lives (`path:line`), and what a change hits first-order.
3. `effects/CONTEXT.md` turns a change into a short list of cards. It never repeats a card.
4. Load the entry file, one hub and one card. Do not read the whole `objects/` folder.

## Universes

| Universe | Meaning here |
|---|---|
| **live** | Bound in `apps/worker/src/services.ts` or reachable from `apps/cli`, and running in prod. Implement against these. |
| **leftover** | Present, no longer the main path. `packages/channel-linkedin` tables `posts`, `post_ideas`, `competitors`, `competitor_posts`, `research_runs`, `post_metrics`: no writer in the tree, read only by `status.ts`. The content loop (`packages/content`) replaced that pipeline. `notes` and `LinkedinInbox` stay live. |
| **ghost** | Named but not wired. `docs/restate-operations.md:363` cites `packages/channel-email/src/restate/loop.ts`; the loop primitive lives at `packages/core/src/restate/loop.ts:150`. The SMS `fake` provider on Lambda is refused (`apps/worker/src/services.ts:312`), so a prod SMS send path exists only once a real provider is configured. |

## Name collisions

| Word | Meanings |
|---|---|
| lead | prose: a company to reach. `leads` table: one email address with `status` (`packages/core/src/schema.ts:252`). `Ads.leads`: Meta lead-form fills. |
| message | `messages` (email drafts and sends, `packages/channel-email/src/schema.ts:234`) vs `sms_messages` (`packages/channel-sms/src/schema.ts:200`). Different states, different tick. |
| draft | `messages.state = draft`; a `content_drafts` row; leftover `posts.status = draft`. |
| enrollment | `enrollments`: one email sequence per company. SMS has no table; a contact's `state` becomes `enrolled`. |
| campaign | worker `Campaign` (a niche's templates + sequences + plan, `apps/worker/src/services.ts:151`); a Meta campaign id in `ad_launches`; the 10DLC campaign that `WREN_SMS_LIVE` stands for. |
| verification | `verifications` rows (address verdicts); `Discovery.verify` (does this domain belong to this company); `Resolution.verifyLeads`. |
| sync | loop handler `sync` = one pass now (`packages/core/src/restate/loop.ts`); `syncInbox` = read a mailbox; `inbox_syncs` / `open_syncs` = cursors. |
| template | an `.email` file parsed to a `Template` tree; `template_versions` = the stored source per content hash; an SMS `SmsStep` body. |
| sender | a roster `Sender` (an inbox address); `SmsSender` (the SMS loop object); `enrollments.sender` (the address chosen at compose). |
| run | `runs` ledger row; one pass of a loop object; leftover `research_runs`. |
| post | a published content draft; leftover `posts` table; LinkedIn's `/rest/posts`. |
| notes | `notes` table (LinkedIn raw notes, live); `content_drafts.note` (a redraft instruction). |
| sites | autobrowse's Restate service, not in this repo. Every platform and Meta call goes through it (`packages/core/src/content/restate.ts:21`). Reddit does not. |
| worker | `apps/worker` (Node/Lambda Restate endpoint); `apps/phone` (Cloudflare Worker, SMS inbox + webhooks); `deploy/pixel` (Cloudflare Worker, open pixel). |
| box | autobrowse's EC2 machine, woken by `apps/worker/src/autobrowse-box.ts`. |

## What the map is not

Not a spec (those are `designs/`), not an ops runbook (`docs/restate-operations.md`), not a tutorial (`walkthrough/`). When a card wants to explain behaviour, it points at the file that owns it.

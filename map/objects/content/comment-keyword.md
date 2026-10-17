---
type: object
cluster: content
universe: live
status: verified
verified: 2026-10-16 (keyword DMs on the ledger)
entity: packages/content/src/schema.ts:1067
---

# comment-keyword

A word that, commented on our Instagram or Facebook post, gets that person a DM (ManyChat's comment-to-DM). Tables `comment_keywords` and `keyword_hits` (the DM log). Pages Marketing → Comment keywords and Keyword DMs.

## Why this shape

Meta's private reply is the only DM a page may send from a comment: one per comment, within 7 days. So a hit is per comment, and per person per keyword, so a second comment doesn't DM twice. Matching is whole words, any case, accents off (`saysKeyword`). The narrowest keyword wins: a post's own, then a platform's, then everywhere. The send reuses the DM door: `planPrivateReply` refuses, `privateReplied` keeps the contact, message, touch and a `sent` [[content/draft-event]] with via `wren`.

## Shape

- `comment_keywords`: `keyword` (normalized), `platform` (null both), `post` (null every), `dm`, `reply` (public, optional), `active`; unique per keyword and scope
- `keyword_hits`: `keyword_id` (cascade), `comment_id` (unique), `platform`, `author`, `state` queued/sent/failed, `why`, `ref`, `at`, `sent_at`
- views `comment_keyword_records` (caught, sent, failed, last), `keyword_hit_records`

Citations: `packages/content/src/social/keywords.ts`, `packages/content/src/restate/keyword-dm.ts`, `packages/content/src/restate/social.ts:223`

## Connected to

- **joins:** [[content/comment]] (`comment_id`, its contact once DM'd)
- **produces:** [[content/draft-event]] (`sent` dm), a reach message and touch via `privateReplied`

## If you change this

- **Hits:** `SocialWatch` (catches after it keeps comments; `stats.keywordDms`), `KeywordDm.send/add/remove`, records `marketing.comment_keyword` (edits: state, dm, reply) and `marketing.keyword_hit`, the portal's `FORM` and `ONE` maps in `apps/portal/web/src/records.tsx`, `keywords.test.ts` (unit and integration)
- **Does not hit:** reach accounts' comments (`account_id` set): those DM through the sender

## Surfaces

| Surface | Role |
|---|---|
| `SocialWatch` pass | catches, sends each hit to `KeywordDm.send` |
| `KeywordDm.send` (ingress-private) | DM via `Content.privateReply` as `private:<comment id>`, then `Content.reply` if set as `comment:<comment id>`, each through `sendAtMostOnce` ([[content/send-attempt]]). Sent: hit `sent`. Unsure, not sent or Meta's no: hit `failed` with why; no reply after a DM that may not have gone |
| Marketing → Comment keywords | New keyword, Delete, edit DM, reply, on/off |
| Marketing → Keyword DMs | the log, Failed view |

---
type: object
cluster: watch
universe: live
status: verified
verified: 2026-10-09 @ 0ad591c4
entity: packages/watch/src/schema.ts:50
---

# mail (the Monitor)

One email the Monitor read in William's inboxes (`reader = 'monitor'`), or in a client's connected mailboxes in that client's own database (`reader = 'mail'`, [[email/mail-access]]), a `watch.mail` row, and the rules (`watch.rules`) that sort it into Needs you, held or dropped.

## Why this shape

The Monitor is Wren's first routed workflow: `Watch/all` reads, the spine carries each row to `watch.triage`, and the verdict picks the port. A row keeps sender, subject, a summary and the verdict, never a body. The snippet stays only until triage reads it. A rule with a sender and a verdict settles in code for $0; the model reads the rest with every rule's words in its prompt. Whatever can't be settled shows: no model, an answer that doesn't parse, or triage still failing.

## Shape

- `mail` (`schema.ts:50`): one per (mailbox, Gmail message id); `verdict` null until triage, `done_at` when William clears it
- `mail_sent` (`schema.ts:106`, migration 0198): a reply from the Inbox through the client's mailbox; ours only, `sending` then `sent` or `failed`. The thread's timeline shows it as ours
- `rules` (`schema.ts:30`): words, optional sender (address or domain) and subject words, optional verdict. Migration 0095 seeds the Inbox Insiders rule
- Read: `readMail` (`packages/watch/src/read.ts:25`) searches `in:inbox` minus promotions and social, from an hour before the newest kept
- Triage: `settle` (`packages/watch/src/triage.ts:26`), `triage` (`:68`), `sortAgain` (`:110`), step `triageStep` (`:129`); events are `mail:<row id>`
- Mailbox access is core's (`packages/core/src/mailbox.ts`), shared with the books; `MailMeta.link` is the provider's own link (Outlook), else the view builds Gmail's
- Clients: `MailReader/all` (`packages/watch/src/clients.ts:54`, every 15 min) reads each client with the `mail.triage` part into its own `watch.mail`, then emits to that client's `mail` workflow; `clientTriageStep` (`triage.ts`) names the client in the prompt. A Google mailbox's mail goes only to `WREN_GOOGLE_LLM` (a model that doesn't train on it; unset, the rules alone and the rest shows), by `isGoogleMailbox` (`packages/channel-email/src/access/access.ts`). Marketing → Inbox shows those rows as type Mail (`packages/content/src/social/records.ts:145`)

Citations: `packages/watch/src/schema.ts:30`, `:50`, `:106`, `:148`; `packages/watch/src/restate.ts:28`

## Connected to

- **owns:** its rules
- **joins:** [[platform/spine]] (workflow `watch`: `read.mail` → `triage.mail` → `out.needs_you` / `out.held`)
- **looks-like-but-is-not:** [[books/document]] (the books keep whole billing emails; the Monitor keeps headers); `marketing.inbox` (leads' answers, not William's mail)

## If you change this

- **Hits:** the `mail_records` view (Inbox app, Your mail), WatchConsole (`hide` holds everything still waiting from that sender), the triage prompt
- **Does not hit:** mail already settled (a new rule reaches new mail only, except Hide like this on what's waiting)

## Surfaces

| Surface | Role |
|---|---|
| `Watch/all` on the box, every 15 min (`wren monitor start`) | writes rows, emits to Spine |
| Spine `watch.triage` (Lambda, `WREN_WATCH_LLM`) | writes verdicts |
| WatchConsole (Inbox app: Done, Hide like this, Show like this, Sort again, rules) | writes |
| Inbox app, admins only (`needs: team`) | reads |

## See

- Source: `packages/watch/`
- Design: `designs/2026-10-05-workflows.md` (The Monitor)

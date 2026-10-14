---
type: object
cluster: leads
universe: live
status: verified
verified: 2026-10-14 @ 3bc65ea4
entity: packages/core/src/broadcasts-schema.ts:60
---

# broadcast

One email or text to a [[leads/segment]], sent now or at a time, optionally at that time in each person's zone. Tables `broadcasts` and `broadcast_recipients`. People → Broadcasts.

## Why this shape

Nothing sends without a yes: draft, then asked (To approve), then approved (`scheduled`), then `sending`, then `sent`. Declined and canceled go back to editable. Approve and Restore tell the `Broadcast` object when to run (`packages/core/src/broadcast-run.ts:87`). Each schedule bumps a generation, and a run from an older one ends.

On its time, `startBroadcast` (`packages/core/src/broadcasts.ts:486`) reads the segment once into recipients, each with its own `due_at`. Local time means the same wall clock in each person's zone (`dueFor`, `:141`). It starts when the first zone reaches it (`startOf`, `:157`).

`sendRecipient` (`:608`) gates each person on [[leads/consent]], suppressions and the frequency cap (`mayMarket`). A capped person goes `held` until `marketingRoomAt` and is tried again then, as queued follow-ups are. Email leaves from here, in batches of 20, through the workspace's mailer (`MailOf`): Wren's from portal@; a client's from the mailbox it picked in Account → Messaging, with its postal address, and unsubscribe links that name the client. The daily ceiling is 1,500, or 400 from a free Gmail. A text is queued on [[sms/sms-message]] (kind `broadcast`, ref `<slug>/<id>`) for the texts sender, which keeps quiet hours. Each person is one journaled step, so a retry never sends twice.

Results are the [[leads/sent-log]]'s rows for it (`broadcast` column), counted on its ladder, each linking to its rows.

## Shape

- `broadcasts` (`packages/core/src/broadcasts-schema.ts:60`): `name`, `channel` email|sms, `segment_id`, `topic_id`, `subject` (email), `body` (plain text, `{first_name|there}`), `send_at`, `local`, `zone`, `state`, asked/decided by+at, `note`, `tested_to`/`tested_at`, `started_at`, `finished_at`. Migration 0254.
- `broadcast_recipients` (`:113`): `broadcast_id`, `profile_id` (unique pair), `address`, `zone`, `state` due|held|sent|queued|skipped|failed, `due_at`, `why`, `sent_at`.
- Views `broadcast_records`, `broadcast_recipient_records` (`:149`, `:202`). Records `people.broadcast`, `people.recipient` (`packages/core/src/broadcast-records.ts:69`).
- Words: `checkWords` (`broadcasts.ts:69`): email needs a subject; a text needs STOP and at most 459 characters; only `first_name`, `name`.
- Portal: `PeopleConsole` routes `broadcastContext`, `broadcastPreview`, `broadcastMonth` (read), `broadcastSave`, `broadcastAsk`, `broadcastApprove`, `broadcastDecline`, `broadcastCancel`, `broadcastRestore`, `broadcastTest` (`packages/core/src/people-console.ts:285`). To approve lists waiting ones (`packages/content/src/social/records.ts:1419`).
- Test send: one copy marked [test] to one address; a text test goes only to the operator's own thread. Recorded only as the last test.
- Its segment use is written on each segments pass (`broadcastUses`, `broadcasts.ts:856`; `packages/core/src/segments-pass.ts:245`).

Citations: `packages/core/src/broadcasts-schema.ts:60`, `packages/core/src/broadcasts.ts:608`, `packages/core/src/broadcast-run.ts:99`

## Connected to

- **reads:** [[leads/segment]], [[leads/segment-membership]], [[leads/profile]], [[leads/consent]], [[leads/suppression]]
- **writes:** [[sms/sms-message]] (texts), `marketing_sends` (counts toward the cap)
- **feeds:** [[leads/sent-log]] (its rows and results)
- **looks-like-but-is-not:** a newsletter issue (one topic's list, no segment); a workflow (per person, on a trigger)

## If you change this

- **Hits:** `packages/db/drizzle.config.ts` (lists `broadcasts-schema.ts`), a migration; `sent-views.ts` (the broadcast rows); `apps/portal/web/src/modules/people/broadcasts.tsx`; To approve (`packages/content/src/social/records.ts`, `apps/portal/web/src/modules/marketing/index.ts`); `apps/worker/src/services.ts` (`mailOf`: each workspace's mail)
- **Does not hit:** the segment's rule; consent rows

## Surfaces

| Surface | Role |
|---|---|
| People → Broadcasts (portal) | reads, writes |
| Marketing → To approve | approves, declines |
| `Broadcast/<key>/run` | sends |

## See

- Source: `packages/core/src/broadcasts.ts`, `packages/core/src/broadcast-run.ts`
- Design: `designs/2026-10-14-customerio-audit.md` (B6)

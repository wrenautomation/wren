---
type: object
cluster: content
universe: live
status: verified
verified: 2026-10-06 @ 6420682
entity: packages/outreach/src/schema.ts:318
---

# linkedin-invite (LinkedIn connection requests from our people)

Invites to people we already hold with a LinkedIn page, up to 20 a weekday from the account named in settings. An accept lands in Replies; every message after it is William's click. Built dark: no account named until he says go.

## Why this shape

William, 2026-10-06 (relayed): 20 a day, a plan then the build. The sender is `linkedin@wren` (william@wrenautomation.com, also Wren's posting token); never his personal account or `linkedin@alt`. Accepts are found in one read of recent connections every 6 h, not one profile read per pending invite (about 400 a day at 20 a day). A free account gets 5 notes a month, so the sixth invite goes bare instead of failing. See `designs/2026-10-06-linkedin-invites.md`.

## Shape

- No table of its own. An invite is a `reach_messages` row `kind = connect` on a `reach_contacts` row (`schema.ts:114`; `connected_at`, `withdrawn_at` `:140`)
- View `reach_invites` (`schema.ts:318`): one row per invite, `status` queued/pending/accepted/withdrawn/ended/failed/unknown/skipped
- Sequence `linkedin-invite` (`sequences.ts`): `connectFirst`, no steps, 21 days
- Code `packages/outreach/src/invites.ts`: `invitesSettingsSchema` (`:31`), `peopleForInvites` (`:72`, senior titles first, held niches and declined firms out), `topUp` (`:119`, tomorrow's ramp cap minus queued), `markAccepted` (`:200`), `staleInvites` (`:228`), `applyWithdraw` (`:246`), `sweepInvites` (`:289`, 5 withdraws a pass)
- Notes cap: `notesThisMonth` in `tick.ts`, policy `linkedin.notesPerMonth` (5)
- Ramp: `standingOf` in `policy.ts`, 1 on the first send day then +3 a send day to 20 (`sendDaysBetween`; weekends don't count). William 10-06.
- Loop: ReachWatch every 6 h (`restate/index.ts:121`, `invitesPass` `:256`); desk handlers `withdrawInvite` (`:788`), `invites` (`:823`)
- autobrowse: `GET /connections`, `POST /in/{vanity}/withdraw` (`src/sites/linkedin.ts`), via `packages/channel-linkedin/src/outreach.ts`
- DM drafts (designs/2026-10-06-content-desk.md): `reach_contacts.draft`, `draft_at`, `draft_for` (`schema.ts:149`, migration 0121); `packages/outreach/src/drafts.ts` (`contactsToDraft` `:53`, `draftDm` `:143`, `queueDraft` `:165`, 30 model calls a day, the `outbound-copy` SOP via `dmGuide` in `@wren/content` (newest, the platform's own first) and his last 5 DM edits (`editsFor`, `packages/core/src/ask.ts`)); written by `draftsPass` (`restate/index.ts:308`) after the invites pass; a new inbound clears it (`replies.ts` `receive`). the detail's draft box holds it, Reply and Message send what it saved (a changed send is kept as an edit, `keepSentEdit`); Ask Claude kinds `dm` and `invite` (`packages/content/src/draft-ask.ts`)
- Message/Invite from People: record `marketing.person` (`records.ts:538`, ids `li:<people.id>`, `reddit:<handle>`), `packages/outreach/src/from-people.ts` (`personContact`, `messageAccount`: lead guard, `linkedin@wren` once connected, else `reddit@wren`); desk `draftPerson`, `messagePerson`, `invitePerson` (`restate/index.ts:901`, `:933`, `:958`; invite enrolls `linkedin-invite` under the ramp)
- Console: component `linkedin.invites` (settings in `wren_settings`), record `marketing.invite` (Marketing → Invites), `marketing.approval` item "Accepted your invite" (Marketing → To approve, `packages/content/src/social/records.ts:361`); CLI `wren reach invites status|sweep`

## Connected to

- **joins:** [[leads/person]] (`people.linkedin_url` is the source; contacts carry `person_id`, `company_id`)
- **joins:** [[content/comment]] (the same reach accounts, tick and live gate)
- **looks-like-but-is-not:** `linkedin-connect`, an invite plus two automatic DMs; kept in code, unused, since auto DMs break the replies rule

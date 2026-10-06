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
- Console: component `linkedin.invites` (settings in `wren_settings`), record `marketing.invite` (Marketing → Invites), Replies item "Accepted your invite" (`apps/worker/src/replies.ts`); CLI `wren reach invites status|sweep`

## Connected to

- **joins:** [[leads/person]] (`people.linkedin_url` is the source; contacts carry `person_id`, `company_id`)
- **joins:** [[content/comment]] (the same reach accounts, tick and live gate)
- **looks-like-but-is-not:** `linkedin-connect`, an invite plus two automatic DMs; kept in code, unused, since auto DMs break the replies rule

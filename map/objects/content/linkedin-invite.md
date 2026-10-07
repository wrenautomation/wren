---
type: object
cluster: content
universe: live
status: verified
verified: 2026-10-07 @ 50cd49f0
entity: packages/outreach/src/schema.ts:356
---

# linkedin-invite (LinkedIn connection requests from our people)

Invites to people we already hold with a LinkedIn page, up to 20 a weekday from the account named in settings. The sweep proposes them; each waits in To approve for his yes, and only approved ones send. An accept lands in Replies; every message after it is William's click. Built dark: no account named until he says go.

## Why this shape

William, 2026-10-06 (relayed): 20 a day, a plan then the build. The sender is `linkedin@wren` (william@wrenautomation.com, also Wren's posting token); never his personal account or `linkedin@alt`. Accepts are found in one read of recent connections every 6 h, not one profile read per pending invite (about 400 a day at 20 a day). A free account gets 5 notes a month, so the sixth invite goes bare instead of failing. See `designs/2026-10-06-linkedin-invites.md`. 10-07: "highly relevant, qualified, key decision-makers, or content based, big companies", all gated for his approval (`designs/2026-10-07-posting-flow.md` item 3).

## Shape

- No table of its own. An invite is a `reach_messages` row `kind = connect` on a `reach_contacts` row (`schema.ts:139`; `connected_at`, `withdrawn_at` `:163`; `fit` `:175`, the why To approve shows, migration 0161)
- Gate: message state `proposed` (before `queued`). The top-up writes `proposed`; the tick only sends `queued`; `approveInvites` makes it `queued`, `skipInvites` marks it `skipped` and the contact `finished` ("skipped in To approve"). Invite from People stays one click: that click is the yes
- View `reach_invites` (`schema.ts:356`): one row per invite, `status` proposed/queued/pending/accepted/withdrawn/ended/failed/unknown/skipped, plus `fit`
- Sequence `linkedin-invite` (`sequences.ts`): `connectFirst`, no steps, 21 days
- Code `packages/outreach/src/invites.ts`: `invitesSettingsSchema` (`:36`; `decisionMakers` on, `minEmployees`, `knownSizeOnly`, `engaged` on), `peopleForInvites` (`:137`: held niches and declined firms out; engaged people skip title and size filters and rank first, then title tier, then firm size, unknown last; engagers not in People come after engaged ones who are), `whyOf` (`:235`), `topUp` (`:263`, tomorrow's ramp cap minus queued and proposed; `enroll` with `first: "proposed"`, `ordered`), `proposedInvites` (`:367`), `approveInvites` (`:388`), `skipInvites` (`:409`), `markAccepted` (`:432`), `staleInvites` (`:460`), `applyWithdraw` (`:478`), `sweepInvites` (`:521`, 5 withdraws a pass)
- Firm size, cheapest first: `companies.raw` `agency.team_size`, SEC ADV `5A`, PPP `enrichments` (`firmographics`, `ppp-foia`, `jobs_reported`), `findings` kind `profile` `employees` (Exa's cache of the LinkedIn page). A range compares by its top. Missing: Exa's company read or autobrowse's company page would fill it; nothing is bought
- Engaged: `social_activity` LinkedIn `reaction`, `mention`, `follow` with an `/in/` actor URL. LinkedIn `comments` authors are URNs, not vanities, so commenters can't be matched yet. Prod had 0 such rows on 10-07
- Notes cap: `notesThisMonth` in `tick.ts`, policy `linkedin.notesPerMonth` (5)
- Ramp: `standingOf` in `policy.ts`, 1 on the first send day then +3 a send day to 20 (`sendDaysBetween`; weekends don't count). William 10-06.
- Loop: ReachWatch every 6 h (`invitesPass`, `restate/index.ts:399`); desk handlers `withdrawInvite` (`:1140`), `invites` (`:1162`), `proposedInvites` (`:1179`), `approveInvites` (`:1185`, effect sends), `skipInvites` (`:1199`)
- autobrowse: `GET /connections`, `POST /in/{vanity}/withdraw` (`src/sites/linkedin.ts`), via `packages/channel-linkedin/src/outreach.ts`
- DM drafts (designs/2026-10-06-content-desk.md): `reach_contacts.draft`, `draft_at`, `draft_for` (`schema.ts:149`, migration 0121); `packages/outreach/src/drafts.ts` (`contactsToDraft` `:70`, `draftDm` `:166`, `queueDraft` `:223`, 30 model calls a day, Wren's facts (`factsBlock`) and the facts guard (`guardDraft`, his earlier messages count as his own words; made up twice, no draft; a `runs` row `guard`), the `outbound-copy` SOP via `dmGuide` in `@wren/content` (newest, the platform's own first) and his last 5 DM edits (`editsFor`, `packages/core/src/ask.ts`)); written by `draftsPass` (`restate/index.ts:455`) after the invites pass; a new inbound clears it (`replies.ts` `receive`). the detail's draft box holds it, Reply and Message send what it saved (a changed send is kept as an edit, `keepSentEdit`); Ask Claude kinds `dm` and `invite` (`packages/content/src/draft-ask.ts`)
- Message/Invite from People: record `marketing.person` (`records.ts:538`, ids `li:<people.id>`, `reddit:<handle>`), `packages/outreach/src/from-people.ts` (`personContact`, `messageAccount`: lead guard, `linkedin@wren` once connected, else `reddit@wren`); desk `draftPerson`, `messagePerson`, `invitePerson` (`restate/index.ts:1269`, `:1301`, `:1333`; invite enrolls `linkedin-invite` under the ramp)
- Per client: `ReachWatch/<c>/daily` sweeps and tops up on the client's LinkedIn login, `ReachSender/<c>/fleet` sends, rows in its database; only with `sendsOn(client, "linkedin.invites")` and its login `active` (`wren reach accounts activate <id> --client <c>`, `ReachDesk.setAccountState` with `client`). Settings are its install's block; empty `account` = its first LinkedIn login
- Console: component `linkedin.invites` (Wren's settings in `wren_settings`, Shop renders the filters), record `marketing.invite` (Marketing → Invites, tab To approve), `marketing.approval` items `connect:<contact>` "Invite to send" (Send invite / Skip, one or many; `connectRows`, `packages/content/src/social/records.ts:167`) and `invite:<contact>` "Accepted your invite"; portal actions `marketing.connectApprove`, `marketing.connectSkip`; CLI `wren reach invites status|set|sweep|proposed|approve <ids...>|skip <ids...>`, `set --decision-makers --min-employees --known-size-only --engaged`

## Connected to

- **joins:** [[leads/person]] (`people.linkedin_url` is the source; contacts carry `person_id`, `company_id`)
- **joins:** [[content/comment]] (the same reach accounts, tick and live gate)
- **looks-like-but-is-not:** `linkedin-connect`, an invite plus two automatic DMs; kept in code, unused, since auto DMs break the replies rule
- **joins:** [[content/funnel]] (follows and connects, one capability across LinkedIn, X, IG)

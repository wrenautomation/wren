# LinkedIn invites, 20 a day (2026-10-06)

William, 10-06 (relayed by the keycycle/sops session): "we also need a way to automate linkedin
connection requests, 20 a day … make a plan and implement that."

## Answer first

Most of it was built on 10-01 inside reach and never armed: the `/in/{vanity}/connect` route and
flow, autobrowse's `connect: 20` site cap, the invite ramp (1 on the first send day, +3 each send day after, up to 20; weekends don't count), the
10:00-17:00 New York weekday window, and journaled sends. What's missing:

1. **Targets.** Contacts come from our own people: `people.linkedin_url` (Exa team search and the
   importers fill it). Each morning the day's cap is topped up from there.
2. **Invite only.** A new sequence, `linkedin-invite`, sends the invite and nothing else. An
   accepted invite lands in Replies. Any message after that is his click.
3. **Accepts at scale.** Today the tick reads one profile per pending invite per day. At 20 a day
   that becomes about 400 reads a day. Instead, one read of "recently added connections" every
   6 hours finds the accepts.
4. **Withdraw.** Still pending after 21 days: withdraw from the profile's Pending button. The
   flow reads the button first, so an accept we missed is caught there.
5. **A page.** Marketing → Invites: queued, pending, accepted, withdrawn.
6. **The sender is a setting.** Component `linkedin.invites` names the autobrowse credential.
   Empty = nothing tops up.

The sender is `linkedin@wren`: the member account on william@wrenautomation.com, in his name, as
Wren's founder. It also holds Wren's posting token. Never his personal account (kept for his job
search) or `linkedin@alt` (research only). Nothing arms until he says go.

## Flow

```
people (linkedin_url, title, niche)          ReachWatch, every 6 h per LinkedIn account
   │ top-up: tomorrow's cap, minus queued        ├─ GET /connections → accepted
   v                                             ├─ pending ≥ 21 days → POST /in/{v}/withdraw
reach_contacts (person_id, company_id)           └─ top-up
   │ enroll linkedin-invite (lead guard)
   v
reach_messages kind=connect ──ReachSender──> POST /in/{v}/connect   (live gate, window, ramp, autobrowse cap)
   │
   v
accepted → Replies "Accepted your invite" → Message (manual DM, his click)
```

## Parts

**autobrowse** (`src/sites/linkedin.ts`, `src/browser/flows/linkedin-reach.ts`)
- `GET /connections` (`max`, default 40): recently added connections, newest first: name, vanity,
  url, headline, the "connected 2 days ago" label. Meter `network: 1`, cap 12 a day.
- `POST /in/{vanity}/withdraw`: open the profile and read the button. Pending → withdraw and
  confirm → `{withdrawn: true, relationship: "none"}`. Already connected or no invite →
  `{withdrawn: false, relationship}`. Irreversible. Meter `withdraw: 1`, cap 20 a day.
- The connect route stays. Its note is 200 characters, and a free account gets 5 notes a month.

**wren**
- `linkedinOutreach`: `connections()` and `withdraw(handle)`, both optional on `OutreachChannel`.
  `fakeOutreachChannel` gets both.
- `reach_contacts.withdrawn_at`, beside `connected_at`. View `reach_invites`: one row per invite,
  with `status` = queued, pending, accepted, withdrawn, ended (the contact stopped some other
  way), failed, and days pending.
- Sequence `linkedin-invite`: `connectFirst`, no steps, 21 days. `linkedin-connect` (invite plus
  two auto steps) stays in code, unused: auto DMs break the replies rule.
- `invites.ts`:
  - `peopleForInvites(db, settings, limit)`: people with a `/in/` URL, matching the niches and
    title words in settings, not already a contact, not held. Senior titles first.
  - `topUp`: adds them as contacts (`found_in = people`, person and company linked), then
    enrolls until queued invites for the account reach tomorrow's cap. Enroll's lead guard still
    refuses a lead another channel holds.
  - `sweep`: reads connections, then marks invited contacts `connected` (`connected_at`).
    Pending past `withdrawAfterDays` is withdrawn, at most 5 a pass (four passes a day, under
    autobrowse's 20). The contact becomes
    `unreachable` with reason "invite withdrawn after 21 days" and `withdrawn_at` is set.
- Notes: a note goes only while the account has sent fewer than `notesPerMonth` (5) notes this
  month. After that the invite goes bare instead of failing.
- ReachWatch: the sweep and top-up run on LinkedIn accounts every 6 hours, beside health.
- Component `linkedin.invites` (stage reach, for Wren). Settings: `account`, `perDay` (20),
  `niches`, `titles`, `withdrawAfterDays` (21). The note is the `linkedin:connect-note`
  template; empty = no note. Records `marketing.invite`.
- Marketing → Invites. Tabs: To send, Pending, Accepted, Withdrawn, All. Withdraw on pending,
  Message on accepted.
- Replies: an accepted invite with no messages yet is an item "Accepted your invite".
- CLI: `wren reach invites status|set|sweep` (set = Shop's settings from a terminal; sweep = the
  watch's pass now: accepts, withdraws, top-up).

## Limits and cost

- 20 a day on weekdays is 100 a week. That is at LinkedIn's usual weekly ceiling for a free
  account, so the ramp starts at 1: 1, 4, 7, 10, 13, 16, 19, then 20 from the eighth send day.
- Page loads on the Mac: 20 invites, 4 connection reads and up to 20 withdraws, about 45 a day.
  $0. Restate: about 30 actions a day on top of the free 100k a month.
- A withdrawn invite can't be sent to the same person again for 3 weeks. We never re-invite.

## For William

1. Say go. Then: `wren reach accounts add linkedin linkedin@wren`, set the account in Shop →
   LinkedIn invites, `activate`, set `linkedin@wren`'s autobrowse connect cap to 20, and turn on
   `WREN_REACH_LIVE`.
2. A note or not. Default: no note (5 a month free). A note = fill the connect-note template.

## Decision log

- 2026-10-06: planned and built dark. Invite only; accepts go to Replies; every message is his
  click.
- 2026-10-06: the sender is a new account in his real name, not yet made. Not his personal
  account, not `linkedin@alt`. `account` stays empty until he says go.
- 2026-10-06: correction: the account exists. It is `linkedin@wren` (william@wrenautomation.com,
  "William Jin", also Wren's posting token). No new signup. Profile basics set by the autobrowse
  flow `linkedin-profile-basics`.
- 2026-10-06: William said go: "linkedin should start doing 20 invites a day with a rampup. do 1,
  then 4, then 7 all the way until we get to 20." The ramp counts send days (weekdays), so a
  weekend doesn't jump it.

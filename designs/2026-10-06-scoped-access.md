# Scoped access: per-channel roles, grants and time limits (2026-10-06)

William, 10-06: "we need the scaffolding for rbac, abac, acl type stuff on the dashboards for
productization. ex. in a big agency, each person needs specific scopes if he's like a youtube
guy, or just a linkedin guy, or maybe he's a youtube guy but the company trusts him so he can
read other sources of outreach and bring up issues, but shouldn't edit them in normal
procedure. maybe temp permissions need to be given for specific operations, or new permissions
given to people as they grow in the company, etc. this would apply to my agency if i ever
start hiring."

Builds on `2026-10-05-access.md`, which left out custom roles and per-record sharing until a
client asked. This is the ask.

## Answer first

- A **grant** says who may do which verbs, where, until when. Where is a scope: a client, apps,
  channels, or one record.
- A **role** is a named bundle of grants. Today's six roles stay as built-ins. Owners and admins
  add their own, like "YouTube editor".
- A person holds a role plus extra grants. A grant can end at a time or after a number of uses.
- A new verb, `comment`, lets a person raise an issue on anything they can read, without
  editing it.
- Anyone can ask for access they lack. The ask lands in the Inbox of people who can grant it.
- Records carry their channel, so a LinkedIn editor's lists hold LinkedIn rows only. That's the
  attribute part.
- Wren's own team uses the same model on Wren's apps, so hiring needs no new build.

## The YouTube editor, as data

| Grant | Verbs | Scope | Until |
|---|---|---|---|
| role "YouTube editor" | read, act, comment | Marketing, channel youtube | |
| role "YouTube editor" | read, comment | Marketing and Outbound, every channel | |
| extra | act | channel linkedin | Friday 17:00 |
| extra | effect | one record: post 812 | 1 use |

He edits and approves YouTube work, reads every other channel and raises issues there, covers
LinkedIn this week, and may publish one post once.

## Model

- **Verbs:** today's seven (read, act, run, effect, money, manage, team) plus `comment`.
- **Scope:** `{ client, apps?, channels?, record? }`. Left out means all. `apps` are app ids
  (`marketing`, `outbound`, `calendar`, …). `channels` are `youtube`, `linkedin`, `x`,
  `tiktok`, `instagram`, `facebook`, `reddit`, `email`, `sms`, `phone`. `record` is
  `type:id` (that's the ACL).
- **`roles` table:** id, client (`wren` for Wren's team, null for built-ins), name, about, and
  its grants as rows of verbs plus scope. Built-ins are rows too, seeded from `TEAM_GRANTS` and
  `MEMBER_GRANTS`, so nothing changes for anyone today.
- **`grants` table:** login, client, verbs, scope, `role` or extra, `until`, `uses_left`,
  `reason`, `by`, `at`.
- **Check:** `can(who, verb, target)`, where target is `{ client, app, channel?, record? }`. A
  grant matches when its scope covers the target, it hasn't expired, and it has uses left.
  Grants only add. There are no deny rules, so the answer is easy to explain: list the grants
  that match.
- **Using a counted grant:** the server decrements `uses_left` in the same transaction as the
  write, so a one-use grant can't be used twice.
- **Fresh read:** one indexed read of a login's grants per portal call, as roles are read today.
  Expired grants drop out at read time, so nothing needs to sweep them.

## Hard limits

- A person grants only verbs and scopes they hold, plus `manage` over that scope.
- On Wren's apps, `effect` and `money` stay with admins. Money and spend are William's call.
- An owner's grants never reach past their own client.
- The last person with `manage` on a client can't remove it from themselves.

## Attributes

- Each record type declares `app` and `channel`: a column, a fixed channel, or none. An
  inventory test fails a type that declares neither, like the route inventory today.
- A list read by a channel-limited login adds `channel in (...)` to its query, so counts and
  filters match what the person sees. A single-row read checks the row.
- A route keeps its permission and gains its app from the routes map. A handler whose input
  names a channel checks that channel too.
- The web gets the full grant list in `portalMe`. `can` in `@wren/ui/access` takes the same
  target, so a hidden button and a refused call always agree.

## Raise an issue

- With `comment` on a row, a person sees "Raise issue" in place of the actions they can't use.
- An issue is a short note on that record: who, what, when, open or resolved. It lands in the
  Inbox of whoever has `act` on that scope. An issue is inbound, so it belongs in the Inbox.
- It shows on the record's panel, beside History.

## Ask for access

- Where a person can read but not act, a quiet "Ask for access" sits under the record's
  actions. They pick the verb, the scope (this record, this channel) and how long, plus a
  reason.
- The ask lands in the Inbox of people who can grant it. Approving creates the grant with that
  expiry. Both steps are audited.

## Pages

- **Person** (Team for Wren's team, Account → People for a client): their role, then each extra
  grant as a sentence ("Can approve LinkedIn posts until Fri 5 pm"), with Add, End now, and
  History, which shows every grant, change and expiry.
- **Roles:** built-ins read only; custom roles as a list of grants written as sentences; Copy a
  role to start one.
- **View as:** an admin or owner opens the portal as that person, read only, with a bar on top.
  This is how to check a role before handing it out.
- **Access review:** who can do what, per app and channel, with grants ending this week.

## Phases

1. Model: `roles`, `grants`, `comment`, `can` with targets, built-ins seeded. Unit tests walk the
   whole matrix, and today's six roles answer exactly as before.
2. Attributes: `app` and `channel` on every record type, list filtering, route targets, the
   inventory test. Integration tests on synthetic data cover the YouTube editor, a read-only
   LinkedIn view, a grant that ends, a one-use grant used twice, and a grant above the
   granter's own.
3. Web: the Person page, Roles, Raise issue, Ask for access, and `portalMe` grants.
4. View as and Access review. Screenshots at 1440 and 390 as admin, a YouTube editor and a
   read-only member.

## Left out

- Deny rules: grants only add.
- Field-level limits, like hiding prices inside a row: money already covers prices.
- SSO and SCIM, until a client asks.

## Decision log

- 2026-10-06: William asked for it. Written; building. Grants with scopes, over fixed role
  lists, because "a YouTube guy who reads everything" and "LinkedIn until Friday" are scopes
  and times, not new roles. Additive only, so every answer is a list of matching grants.
- 2026-10-06: Phase 1 built. A login's role stays on its membership or seat row, now a built-in
  or custom role id with an FK to `roles`; the `grants` table holds extras only. Same answers,
  one less join, and the last-admin and last-owner checks keep working on the row. Built-ins are
  seeded rows so the FK holds. `comment` is added to every built-in that holds `act`, so the
  six old roles answer the old seven verbs exactly as before (test `OLD_VERBS`). A target part
  left out means "anywhere" (the route-level check); `null` means "none", so only an unscoped
  grant matches it. A counted grant is spent in its own transaction before a cross-service call,
  in the same one for a write in the main database.
- 2026-10-06: Phase 2 built. `app` and `channel` are required on `defineRecord`, checked at
  declare time, and every type lands in `DECLARED` for the inventory test. A channel-limited
  login's list wraps the type's source in `channel in (...) or key in (...)`, so totals,
  facets and stats agree with the rows. A type with none of the login's rows drops out of
  `recordsTypes`. Routes take their place from a `RouteApps` map per service (`"*"` plus
  overrides); the guard also checks every channel the input names (`channel`, `platform`,
  `platforms`). Inline edit and `call` moved from `run` to `act` with a row check: a call
  needs `on {record, id}`, a handler the type lists in `calls`, and an input that names that
  row. Built-in roles see no change, since every team role with `act` also has `run`.
  `marketing.audience` is channel-less, as its rows are keyed by platform and hold no posts.
- 2026-10-06: Phase 3 built. Issues and asks are two tables (migration 0137), and roles, grants,
  issues and asks are console record types built per reader, so the portal draws them with the
  List template at Wren and at a client alike. An issue's target is the record's app and
  channel, read off the row when the type keeps one. It is in the Inbox of whoever has `act`
  there ("Waiting on you"). An ask is listed for whoever `refusal` lets grant it, never for the
  asker. A client's people get Issues and Asks under Account, since a client workspace has no
  Inbox. The web gets the same `Who` from `portalMe`, and a record page checks its head
  actions at that row, so the YouTube editor sees Approve on YouTube posts only. Raise issue
  replaces the head actions only when there are none; otherwise it lives in the Issues tab.

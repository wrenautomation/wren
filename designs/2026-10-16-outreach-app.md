# Outreach app

Living doc. Started 2026-10-16 (bead wa-9zv). William: "kind unintuitive that linkedin invites ONLY show up in inbox, not marketing. also might want to separate marketing / content with outbound (comments, dms you to do)".

## Answer first

Outbound gets its own app, Outreach, at `/outreach`. Marketing keeps content: Today, Drafts, Studio, Pieces, Numbers and More (Feed, Comments on our posts, Followers, Texts and the rest). Outreach holds what we write to other people: Engage, DMs, Invites, People, then Thread replies and Places (Reddit), then Accounts and DM copy (Setup). Invites have their own tab with a count, so they no longer hide in To approve. The Inbox stays inbound only. To approve keeps its approvals, and each outbound row links to its place in Outreach.

## Pages

| Page | Record | Views |
|---|---|---|
| Engage | `marketing.engage` | To do, Scheduled, Held, Posted, Not live, Reddit, Their posts, All |
| DMs | `marketing.dm` | To do, Sent, Unread, Replied, All |
| Invites | `marketing.invite` | To approve, To send, Sent, To message, Accepted, Withdrawn, All |
| People | `marketing.person` | Can message, Can invite, Touched, All |
| Thread replies, Places | `marketing.thread`, `marketing.place` | as before |
| Accounts, DM copy | `marketing.account`, `marketing.dm_copy` | as before |

- Engage is outbound only now: Reddit threads and others' posts with our comment drafted, and what we sent. Comments on our posts stay in Marketing → Comments and the Inbox. DMs moved to the DMs tab. Our answers under comments stay in Posted, with their proof.
- DMs To do: their reply is unread, or a draft waits. Sent: our message is the last one. An invite alone is not a DM sent; Invites holds it. A new `turn` field holds this.
- Invites To message: accepted, no message either way past the invite. A new `next` field says what an invite waits on (approve, message). The tab counts both.
- People gets an account column and filter: who would send (their thread's account, else the People default per site).

Records keep their ids and their `app: "marketing"`, so grants, handlers, saved views and the CLI don't change.

## Moves

- Old addresses redirect in the router (`apps/portal/web/src/moved.ts`): `/marketing/{engage,dms,invites,people,threads,places,accounts,dm-copy}` and anything under them go to `/outreach/...`, search kept. One table, one unit test.
- Nav, ⌘K and hover menus read the modules, so they follow. The phone dock's Engage opens Outreach. Outreach has its own phone tabs: Engage, DMs, Invites.
- The Engage head's "invites wait in To approve" line goes: the Invites tab counts them.
- Links in code that named the old paths now name the new ones. The `draft_events` view's `/marketing/dms/` links stay and redirect; no migration for a link.

## Accounts

Every Outreach list with an account field gets the Account filter (2+ accounts) and column from `packages/ui/src/accounts.tsx`. Draft boxes keep the "Send as" picker (Engage, DMs, accepted Invites, Thread replies), saved through the one write path.

## Tests

- Unit: `turnOf` (`packages/outreach/src/records.test.ts`), the move table (`apps/portal/web/src/moved.test.ts`), areas and phone tabs (`areas.test.ts`).
- Integration: Engage outbound only (`packages/content/test/integration/records.test.ts`); Invites `next` through accept and a first message, a bare invite not in DMs Sent (`invites.test.ts`); DM `turn` and views (`flow.test.ts`); People's account (`drafts.test.ts`).
- Browser, on a local preview seeded by `packages/content/test/outreach-preview.ts`: `apps/portal/scripts/outreach-e2e.ts` (nav, old addresses, Invites views, the Account filter across a reload, Send invite pressed twice goes once, a comment on their post sent with the tab hidden goes once and lands, phone tabs). The fake Restate and runner moved to `apps/portal/scripts/e2e-kit.ts`, shared with `writes-e2e.ts`.

## Not done

- Received invites. Nothing reads LinkedIn's invitation manager today: no autobrowse route, no table. It needs a desk read and a deploy.
- A picker on People's Message and Invite. Those sends have no draft item to hold a pick until the person has a thread. Once they do, their DM row has the picker.
- A picker on a proposed invite. The connect send uses the account the sweep picked.

## Decisions

- 2026-10-16: Outreach sits in the Marketing area, right after Marketing. Engage is the phone dock's reply tab, and comments on others' posts are marketing reach.
- 2026-10-16: redirects, not hidden copies. The 2026-10-11 split kept hidden duplicate pages; two pages per record drift.
- 2026-10-16: records stay `marketing.*`. Renaming would touch grants, the CLI, saved views and audit rows for no gain.

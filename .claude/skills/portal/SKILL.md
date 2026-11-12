---
name: portal
description: Help William find his way around the Wren portal (app.wrenautomation.com): where a page or setting lives, what a place is for, the keys, his look, and how a client's portal differs. Use when he asks "where do I...", "how do I change...", "what does this page do", or says a page won't load.
---

# Navigating the portal

Answer with the place first: place, then page, then the address. Example: "Back office → Look, `/office/look`."

## Where things are

The portal is a fixed shell of places (designs/2026-11-04-portal-places.md). Code: `apps/portal/web/src/modules/places.ts`.

**Wren's sidebar, in order:**

| Place | Holds | Address |
|---|---|---|
| Map | Offers on the metro map, terms | `/map/offers` |
| Today | Approvals, messages, mail, calendar | `/today/approve` |
| Campaigns | Overview board; Content (plan, studio, posts, voice and facts); Outreach (engage, conversations, cold email, inboxes) | `/campaigns/overview` |
| Research | Weaver runs and sources | `/research/runs` |
| People | Everyone once, clients, timeline. A person's journey (steps reached, days at the step) leads their own page; no Journeys page | `/people/people` |
| Back office | Contracts, money, spend, accounts, team, grants, look | `/office/money` |

**A client's sidebar:** Today, Campaigns (its reactivation run and posts), People, Back office. Project (plan, updates, deliverables, results) is parked since 11-12: off the sidebar, reached from links, ⌘K and Today's offer cards. A client sees only the pages of the products it holds.

- **Addresses:** `/<place>/<page>`, with filters and the open record in the query (`?person=12`). A reload or a shared link lands on the same screen.
- **Hidden pages:** some pages have no tab and open from a link (Today's DMs, replies, calls).
- **Old addresses:** they redirect. Content, Outbound, Reactivation and Results now live in Campaigns; Clients in People. The table is `apps/portal/web/src/moved.ts` (`MOVED`, `MOVED_APPS`, `CLIENT_MOVED`).
- **Gone:** Learn, Notes, Review, Handlers, Marketplace, Workflows, Loops, Ask, the lead sheet, SEO pages, Ads. Loops and flags are CLI verbs now (`wren loops`, `wren features`).

## His look

Back office → Look (`/office/look`): colors, fonts, radius. Wren's workspace only.

## Keys

- ⌘K opens a page, a record or an action. `?` lists the keys.
- ⌥↑ / ⌥↓ moves to the page above or below.
- `[` folds the sidebar. `]` hides the page column.
- ⌘J opens the Claude agent panel.
- In lists: ↑ ↓ (or J, K) move, Enter opens, Esc closes.

## When a page won't load

It shows "This page couldn't load." with Try again.
1. Reproduce it with the local preview: `pnpm --filter @wren/portal preview`, then open the same address.
2. Read the server log for the failing `/api/...` call. A missing column means the local database needs `pnpm db:migrate`.
3. Fix it in the module or its service, then add a test.

## Agents

Outside agents read `/llms.txt` and `/agent/SKILL.md`.

## Changing the look of a screen

Use the `wren-ui` skill (`.claude/skills/wren-ui/SKILL.md`).

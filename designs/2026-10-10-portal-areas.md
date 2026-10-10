# Portal areas and Today

2026-10-10. William: "the main UI is disorganized, it's just a bunch of cards with apps i came up
with". Then: "Just build it", and write the design for the record.

## Problem

"/" was a grid of equal app cards, about 19 in Wren's workspace, in the order they were built.
Only Reactivation and Your project carried numbers (`Glance`), so Wren's home said nothing about
the day. Inside an
app, the only way out was "All apps" back to the grid. Things waiting on him sat in three apps
(Inbox, Marketing → To approve, Marketing → Inbox).

## Shape

1. **Today is home.** "/" opens Today, not the grid:
   - setup and health alerts (`SetupNow`, `HealthNow`), as before;
   - **Needs you**: one line per page with something waiting (each page's `count` in Wren's
     workspace, its `badge` in any), its app, the number, a link;
   - Wren's workspace: the numbers that say how the day goes (replies, booked, upcoming calls,
     calls to mark) and the next calls with their brief one click away;
   - a client's: a card per service they bought, with its app's `Glance`, and the add-on offer;
   - pins.
2. **One sidebar everywhere**, Today included. Today at the top, then pins, then the apps under
   five areas. The open app expands in place to its pages. Each app shows what waits in it.

   | Area | Apps |
   |---|---|
   | Inbox | Inbox, Texts |
   | Leads | Pipeline (client: same app), Outbound, Opportunities, Calls, Reactivation |
   | Marketing | Marketing, Sites, Learn |
   | Automations | Workflows, Loops, Library, Marketplace, Voice, Handlers |
   | Business | Clients, Money, Payments, Documents, Team, Your project |
   | Tools | Notes, Calendar, Ask, Review |

   An area with none of the viewer's apps is left out. An app no area names goes under Tools, so a
   new app always shows.
3. **One place for what waits.** Wren's Inbox gains To approve. Marketing's copy is hidden from
   its tabs; its address still opens, so old links and pings land.
4. **Names.** A client's "Lead sheet" is "Pipeline", as it is in Wren's.
5. **Phone.** The sidebar hides under 900px, as before. Today lists the areas and their apps
   there, so a phone can reach every app from home.

## Not changed

Every app's pages, routes and records. ⌘K and G-keys. The client's offer grouping moves from cards
to Today's list.

## Code

- `apps/portal/web/src/areas.ts`: `AREAS`, `areasOf(apps)`.
- `apps/portal/web/src/waiting.ts`: `useWaiting`, every app's waiting counts, read on load, on a
  workspace change and each minute.
- `apps/portal/web/src/today.tsx`: the Today page.
- `packages/ui/src/shell.tsx`: `AppShell` takes `nav` (Today, areas, the open app's tabs) in place
  of `launcher` and `app`'s back link.

## Decision log

- 2026-10-10: Areas group apps; pages don't move between apps. Moving pages would break links in
  pings and mail, and a page's record is served by its product either way.
- 2026-10-10: App cards left Wren's home; they only showed blurbs. A client's bought services
  keep theirs, with the glance.
- 2026-10-10: Marketing's ~45 tabs regrouped: Content, Reach, Ads & Site, Numbers.
- 2026-10-10: Apps got distinct icons; four shared "board" and five "note".

---
name: portal
description: Help William find his way around the Wren portal (app.wrenautomation.com): where a page or setting lives, what an app is for, the keys, his look and layout, and how a client's portal differs. Use when he asks "where do I...", "how do I change...", "what does this page do", or says a page won't load.
---

# Navigating the portal

Answer with the place first: app, then page, then the address. Example: "Settings → Themes, `/settings/themes`."

## Where things are

- **Sidebar:** every app, grouped by area. Today sits at the top and shows what needs him across all apps. Pins sit under Today.
- **Window:** the open app. Its pages run down the left edge. The bar across the top has the app, the page, its one button and the pin.
- **Addresses:** `/<app>/<page>`, with filters and the open record in the query (`?person=12`). Reload or share a link and it lands on the same screen.
- **Live list of apps and pages:** Settings → Guide (`/settings/guide`). It reads the app list itself, so it never goes stale. In code, each app is a `Module` in `apps/portal/web/src/modules/<id>/index.ts` (`id`, `name`, `pages`).

## His own settings (Wren's workspace only)

| Want | Go to |
|---|---|
| Sidebar width, page column, row height, text size | Settings → Layout. Or drag a panel's edge; double-click resets it. |
| Try a theme, including the loud ones | Settings → Themes. Wear applies it at once. |
| Tune colors, fonts, radius | Settings → Look |
| Every app, page and key | Settings → Guide |

Showcase themes (aurora, synthwave, terminal, gilded, riso, brutal) are for Wren's workspace only. The server refuses them on a client.

## Clients and people

- A client's people, domain, look and components: Clients → the client.
- Roles, managers, giving access: Access. A manager can hand out only what they hold.
- Team seats: Team.

## Keys

- ⌘K opens anything: a page, a record or an action. `?` lists the keys.
- ⌥↑ / ⌥↓ moves to the page above or below. G then a letter jumps to a page of the open app.
- `[` folds the sidebar. `]` hides the page column. N writes a quick note.
- In lists: ↑ ↓ (or J, K) move, Enter opens, Esc closes, `/` searches.

## When a page won't load

It shows "This page couldn't load." with Try again.
1. Reproduce it with the local preview: `pnpm --filter @wren/portal preview`, then open the same address.
2. Check the server log for the failing `/api/...` call. A missing column means the local database needs `pnpm db:migrate`.
3. Fix it in the module or its service, then add a test.

## Agents and automation

Agents use `/api/agent` with a token from Account → AI tools, or the `wren` skill (`/agent/SKILL.md`). `/llms.txt` and `/robots.txt` explain the rules to outside agents.

## Changing the look

To change how a screen or a part looks, use the `wren-ui` skill (`.claude/skills/wren-ui/SKILL.md`).

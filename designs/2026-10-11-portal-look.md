# Portal look

2026-10-11. William: "make sure design kits are well implemented / incorporated into library, and then potentially redo and reorganize the UI? I don't like the current look."

## What was wrong

- The open app unfolded into the sidebar. Marketing's 25 pages pushed every other app off screen, and the sidebar changed shape on each app.
- A bar on the canvas said "Wren / W Wren": the stamp, the brand's name, then the workspace with its own initials mark.
- Two icon sets: the kit's hand-drawn `Icon` paths beside Lucide, which the design-kits list names as the one vendor.
- Five shadcn parts nothing used (card, tabs, sidebar, separator, tooltip), so there were two ways to draw a sidebar.

## Decision

- **Sidebar = apps only.** Whose workspace (stamp, name, switcher) at its head, Today, pins, every app by area, the viewer's own buttons at its foot. The open app is marked, never unfolded. A closed app's pages still fly out on hover.
- **The window holds the app.** A bar across its top: the app's mark and name, the page on screen, its one button, the pin. Its pages run down a column on the window's left edge, with groups, nesting, counts and drop targets as before (Learn's tree keeps working). An app with one page has no column.
- **Phone unchanged:** the bar on the canvas, the app's pages as tabs that scroll sideways.
- **Type:** page titles 28px semibold, tighter. The page on screen in the column gets a lavender wash and bar.
- **Kit:** `Icon` draws Lucide; the unused shadcn parts are gone. `@wren/ui` is the only door to shadcn, Base UI and Lucide.

## Not now

- Collapsing the sidebar to icons. With twenty custom app names, icons alone don't say which app is which.
- New fonts. Figtree stays; General Sans (the lander's) is Fontshare-licensed, and its files can't go in a public repo.

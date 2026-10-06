# Library, saved views and a portal you shape

2026-10-06. William: "we need like a whole library / filter system and customizability on the UI
thats missing". He said "go on everything", so this builds without a second yes.

## What exists

Every list already has filter chips, a Filter picker, search, sort, a column picker and code-made
views as tabs; the Shop has facets down the side. All of it lives in the URL, so it's gone on the
next visit unless he bookmarks it. Nothing on the portal is his to arrange.

## What it adds

1. **Saved views.** "Save view" on any list keeps its filters, search, sort and columns under a
   name, for him or the team. They show as tabs after the built-in ones; rename, reorder,
   delete. Table `saved_views` (viewer, record, name, params, shared, position). A list opens on
   the viewer's last-used view, and the columns he picks stay picked.
2. **Filters everywhere.** Every list page, the Inbox queue included, shows Filter and search.
   At phone width they open as one sheet. Chips say what's set, in plain words.
3. **Customize.** Pin apps and pages to the rail and drag them into order. Pick and order the
   Overview's tiles. Kept per viewer in `viewer_prefs`. Reset puts the defaults back.
4. **Library app.** One place for everything reusable, as a Shop-style grid with tags, facets
   and search. Each kind opens its full content (never just a name):
   - Templates and Sequences: every outreach template, version, variant and step with its
     numbers, as `2026-10-06-edits-claude-templates.md` lays out.
   - Snippets: saved replies and blocks, new table `snippets` (title, body, tags, channel).
     "Insert" from any draft editor and reply box.
   - Media: videos, Shorts, thumbnails and images from the media bucket, with where each was
     used.
   - SOPs: the `wren sop` set, read only here.
   - Workflows and templates: the Shop's, linked.
   Tags are free text, shared by the team. Anything in the Library can be favorited, and
   favorites float to the top of pickers.

## Rules

- No new UI library: shadcn, Base UI and the existing tokens, records declared in code (console
  standard). New kinds of Library item are records, not pages.
- Saved views and prefs are per viewer; a shared view needs `wren:manage`. A client's viewer
  sees only its own.
- Motion only for real events.

## Build order

1. Saved views, sticky columns, last-used view.
2. Filters on every list and the phone sheet.
3. Library app: Templates and Sequences, Snippets with Insert, Media, SOPs, Workflows.
4. Customize: rail pins and order, Overview tiles.

## Decision log

- 2026-10-06: written from his ask; building on his "go on everything".
- 2026-10-06: Copy became Templates and Sequences, from `2026-10-06-edits-claude-templates.md`.

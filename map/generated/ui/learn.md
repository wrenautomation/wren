# Learn: app, wren workspace

Saved links and followed sources, read, scored against Wren's SOPs, and kept like a drive.

Registered in `apps/portal/web/src/modules/learn/index.ts`.

| Page | Template | Drawn in | Calls | For |
|---|---|---|---|---|
| Home | hand | `apps/portal/web/src/modules/learn/home.tsx` | `LearnConsole/alerts`, `LearnConsole/bell`, `LearnConsole/bellSeen`, `LearnConsole/browse`, `LearnConsole/home`, `LearnConsole/item`, `LearnConsole/open`, `LearnConsole/progress`, `LearnConsole/rail`, `LearnConsole/seen`, `LearnConsole/today`, `LearnConsole/unseen`, `media/grant` (host) | The best of what you follow, scored against your SOPs. |
| Today | hand | `apps/portal/web/src/modules/learn/today.tsx` | `LearnConsole/alerts`, `LearnConsole/bell`, `LearnConsole/bellSeen`, `LearnConsole/browse`, `LearnConsole/home`, `LearnConsole/item`, `LearnConsole/open`, `LearnConsole/progress`, `LearnConsole/rail`, `LearnConsole/seen`, `LearnConsole/today`, `LearnConsole/unseen`, `media/grant` (host) | The last day's best from what you follow. |
| Search | hand | `apps/portal/web/src/modules/learn/learn.tsx` | `LearnConsole/alerts`, `LearnConsole/bell`, `LearnConsole/bellSeen`, `LearnConsole/browse`, `LearnConsole/home`, `LearnConsole/item`, `LearnConsole/open`, `LearnConsole/progress`, `LearnConsole/rail`, `LearnConsole/save`, `LearnConsole/search`, `LearnConsole/seen`, `LearnConsole/today`, `LearnConsole/unseen` | Search every transcript, word for word. |
| Sources | hand | `apps/portal/web/src/modules/learn/sources.tsx` | `ConsolePortal/call`, `LearnConsole/alerts`, `LearnConsole/bell`, `LearnConsole/bellSeen`, `LearnConsole/browse`, `LearnConsole/home`, `LearnConsole/item`, `LearnConsole/open`, `LearnConsole/progress`, `LearnConsole/rail`, `LearnConsole/seen`, `LearnConsole/today`, `LearnConsole/unseen`, `media/grant` (host) | The creators and feeds you follow. |
| Competitors | overview | `apps/portal/web/src/records.tsx` |  | How competitors' reels, posts and films are made, and how far they reach. |
| Breakdowns | list of `learn.breakdown` | `apps/portal/web/src/records.tsx` | `learn.breakdown_records` | Each reel, post or film broken down into its hook, beats and ask. |
| Hooks | list of `learn.hook` | `apps/portal/web/src/records.tsx` | `learn.hook_records` | Hook styles, ranked by how far they reach. |
| SOPs | list of `learn.sop` | `apps/portal/web/src/records.tsx` | `learn.collections`, `learn.items`, `learn.sop_sources`, `learn.sources`, `public.content_playbooks`, `public.documents` | Your SOPs, and the items added to each one. |
| Items (link only) | hand | `apps/portal/web/src/modules/learn/drive.tsx` | `LearnConsole/alerts`, `LearnConsole/bell`, `LearnConsole/bellSeen`, `LearnConsole/browse`, `LearnConsole/home`, `LearnConsole/item`, `LearnConsole/open`, `LearnConsole/progress`, `LearnConsole/rail`, `LearnConsole/save`, `LearnConsole/search`, `LearnConsole/seen`, `LearnConsole/today`, `LearnConsole/unseen`, `media/grant` (host) | One saved item, with its transcript and notes. |
| Saved (link only) | hand |  |  | Everything you saved to come back to. |
| Save a link (link only) | hand | `apps/portal/web/src/modules/learn/learn.tsx` | `LearnConsole/alerts`, `LearnConsole/bell`, `LearnConsole/bellSeen`, `LearnConsole/browse`, `LearnConsole/home`, `LearnConsole/item`, `LearnConsole/open`, `LearnConsole/progress`, `LearnConsole/rail`, `LearnConsole/save`, `LearnConsole/search`, `LearnConsole/seen`, `LearnConsole/today`, `LearnConsole/unseen` | Save a link to read and learn from. |

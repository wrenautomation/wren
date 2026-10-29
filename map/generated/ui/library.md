# Library: app, wren workspace

Every template, sequence, snippet, video and SOP, with its numbers and where it's used.

Sidebar: team: Tools.

Registered in `apps/portal/web/src/modules/library/index.ts`.

| Page | Template | Drawn in | Calls | For |
|---|---|---|---|---|
| Templates | hand | `apps/portal/web/src/modules/library/templates.tsx` | `ConsolePortal/recordsGet`, `TemplatesConsole/detail`, `TemplatesConsole/move`, `TemplatesConsole/preview`, `TemplatesConsole/publish`, `TemplatesConsole/renameFolder`, `TemplatesConsole/reset`, `TemplatesConsole/restore`, `TemplatesConsole/save` | Every template and prompt, by folder, with its versions. |
| Sequences | list of `templates.sequence` | `apps/portal/web/src/records.tsx` |  | The email sequences our workflows send. |
| Snippets | list of `library.snippet` | `apps/portal/web/src/records.tsx` | `public.snippets` | Replies you send often, ready to drop into any draft. |
| Media | list of `library.media` | `apps/portal/web/src/records.tsx` | `public.content_drafts`, `public.content_ideas`, `public.content_playbooks`, `public.platform_objects`, `public.video_edits` | Every rendered file, and where it went. |
| Sections | hand | `apps/portal/web/src/modules/library/sections.tsx` |  | The blocks a page is built from. |
| SOPs | list of `library.sop` | `apps/portal/web/src/records.tsx` | `public.content_playbooks` | The SOPs the content loop follows. |
| Workflows (link only) | list of `library.workflow` | `apps/portal/web/src/records.tsx` | `public.clients`, `public.workflow_templates` | Saved workflow templates, and how each one is wired. |

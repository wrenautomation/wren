# objects/ui/: the UI hub

Tune one part of the portal's look in about 3 files: the screen, the `@wren/ui` part, its story. The look's rules are `DESIGN.md` at the repo root; the loop is the `wren-ui` skill (`.claude/skills/wren-ui/SKILL.md`).

## Walk

1. **Area → app.** The sidebar's areas list app ids (`apps/portal/web/src/areas.ts:17`). An app is a `Module` in `apps/portal/web/src/modules/<id>/index.ts`; Wren's own apps (workflows, outbound, inbox, loops, money, pipeline, clients, team, handlers, review, ask) are `WREN_APPS` in `modules/wren/index.ts:1306`; `leads` is at `:893`.
2. **App → screen.** A page is data or a hand page (`ModulePage`, `apps/portal/web/src/module.ts:162`).
   - `template: "list" | "queue" | "form" | "shop" | "overview" | "day"`: drawn by `TemplatePage` (`apps/portal/web/src/records.tsx:829`) from the `@wren/ui` template below. Tune the template, not the page.
   - A hand page (`HandPage.Page`, `module.ts:75`): its own file in the module folder. It uses `@wren/ui` parts; tune those parts.
3. **Screen → part → story → DESIGN.md section.** The table. Open one story: `http://localhost:61000/?path=/story/<id>`.
4. **A whole page or the layout across apps:** its page story, `http://localhost:61001/?path=/story/pages-client--<app>` (Wren's: `pages-wren--<app>`). [[ui/page-story]].

## Parts

Every story set has `default`, `empty`, `loading`, `failed`, `worst-case`; extra ids are named. File stem = story id prefix.

| Screen piece | Part (`packages/ui/src/`) | Stories (`<stem>--…`) | DESIGN.md |
|---|---|---|---|
| a list page (`list`), its rows, needs tiers, bulk bar | `RecordList` `records.tsx:953` | `records`, + `rows-loading`, `rows-failed`, `bulk` | Lists and records |
| an open record (panel or full page) | `Panel` `records.tsx:2513`, `RecordPage` `:2684` | `records--panel-*` (`open`, `default`, `empty`, `loading`, `failed`, `worst-case`) | Lists and records |
| a list's views, search, filters, sort | `ListBar` `list-bar.tsx:1070`, `SearchBox` `:1270` | `list-bar`, + `search-default` | Lists and records |
| the frame: sidebar, app bar, pages column, Today | `AppShell` `shell.tsx:166` | `shell`, + `home` | Navigation and shell, Phone |
| an action's form, its run, undo, blocked reason | `FormBox` `action.tsx:357`, `useRun` `:915` | `action`, + `form-dialog`, `form-box-*` | Buttons |
| buttons and tags | `Button`, `Tag` `controls.tsx` | `controls` | Buttons |
| a table, a record's facts | `DataTable` `table.tsx:340`, `FactsTable` `:472` | `table`, + `facts-*` | Tables |
| a card view (`card` on a list page) | `RecordCard` `card-grid.tsx:205`, `cards.ts` | `card-grid` | Cards |
| a form with kept edits | `useEditForm` `edit-form.tsx:102` and its fields | `edit-form` | Inputs |
| a reply or post draft with its turns | `DraftBox` `draft.tsx:185` | `draft` | Inputs |
| which account sends, the account filter | `AccountPicker` `accounts.tsx:145` | `accounts` | Inputs |
| a `day` page | `RecordDay` `day.tsx:118` | `day` | Lists and records |
| a before/after | `Diff` `diff.tsx:62` | `diff` | Tables |
| tile sparks, trends, funnels | `Sparkline`, `TrendChart`, `BarsChart` `charts/index.tsx:43` | `charts` | Charts |
| `queue`, `form`, `shop`, `overview` pages | `RecordQueue` `queue.tsx:52`, `RecordForm` `form.tsx:27`, `RecordShop` `shop.tsx:37`, `RecordOverview` `overview.tsx:135` | none yet | Lists and records, Cards |

No part story: the portal's marketing pieces (`modules/marketing/pieces.tsx`, `plan.tsx`, `videos.tsx`) import `api.ts` at load. Tune them in their page story (`pages-wren--marketing`, `pages-wren--today`).

## Cards

| Card | Ask it |
|---|---|
| [[ui/kit]] | what `@wren/ui` is, its one door, what a part change hits |
| [[ui/story]] | how a story renders with no `/api`, where fixtures live, what the gates run |
| [[ui/page-story]] | how a whole page renders on a fake server, where its answers live, what fails its test |

Next door: [[platform/portal-shell]] (the frame's behaviour), [[platform/records]] (what a record page serves).

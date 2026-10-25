# objects/ui/: the UI hub

Tune one part of the portal's look in about 3 files: the screen, the `@wren/ui` part, its story. The look's rules are `DESIGN.md` at the repo root; the loop is the `wren-ui` skill (`.claude/skills/wren-ui/SKILL.md`).

## Walk

1. **Area → app.** The sidebar's areas list app ids (`AREAS_TEAM` `apps/portal/web/src/areas.ts:19`, a client's `AREAS_CLIENT` `:50`). An app is a `Module` in `apps/portal/web/src/modules/<id>/index.ts`; Wren's own apps (workflows, outbound, inbox, loops, money, clients, team, handlers, review, ask) are `WREN_APPS` in `modules/wren/index.ts:1304`; `leads` is at `:891`. An old app id or page address is in `MOVED`/`MOVED_APPS` (`apps/portal/web/src/moved.ts`).
2. **App → screen.** A page is data or a hand page (`ModulePage`, `apps/portal/web/src/module.ts:162`).
   - `template: "list" | "queue" | "form" | "shop" | "overview" | "day"`: drawn by `TemplatePage` (`apps/portal/web/src/records.tsx:829`) from the `@wren/ui` template below. Tune the template, not the page.
   - A hand page (`HandPage.Page`, `module.ts:75`): its own file in the module folder. It uses `@wren/ui` parts; tune those parts.
3. **Screen → part → story → DESIGN.md section.** The table. Open one story: `http://localhost:61000/?path=/story/<id>`.
4. **A whole page or the layout across apps:** its page story, `http://localhost:61001/?path=/story/pages-client--<app>` (Wren's: `pages-wren--<app>`, each tab of the reshaped apps `pages-wren-apps--<app>-<tab>`). [[ui/page-story]].

## Parts

Every story set has `default`, `empty`, `loading`, `failed`, `worst-case`; extra ids are named. File stem = story id prefix.

| Screen piece | Part (`packages/ui/src/`) | Stories (`<stem>--…`) | DESIGN.md |
|---|---|---|---|
| a list page (`list`), its rows, needs tiers, bulk bar | `RecordList` `records-list.tsx:299` | `records`, + `rows-loading`, `rows-failed`, `bulk` | Lists and records |
| an open record (panel or full page) | `Panel` `records-panel.tsx:74`, `RecordPage` `records-page.tsx:87` | `records--panel-*` (`open`, `default`, `empty`, `loading`, `failed`, `worst-case`) | Lists and records |
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
| a graph: ribbons (people as width), loops, diff marks, export | `Graph` `graph/index.tsx`, `ribbonWidth` `graph/model.ts:111` | `ribbons` (`Graph/Ribbons`: default, dark, empty, loading, failed, loops, worst-case) | Motion |
| the parts to drag onto a graph editor (the workflow editor, the Map's edit mode) | `PaletteDrawer`, `PanelBlock` `graph/palette.tsx` | `Pages/Map` edit stories; the workflow editor's page stories | Cards |
| `queue`, `form`, `shop`, `overview` pages | `RecordQueue` `queue.tsx:52`, `RecordForm` `form.tsx:27`, `RecordShop` `shop.tsx:37`, `RecordOverview` `overview.tsx:135` | none yet | Lists and records, Cards |

No part story: the portal's marketing pieces (`modules/marketing/pieces.tsx`, `plan.tsx`, `videos.tsx`) import `api.ts` at load. Tune them in their page story (`pages-wren--marketing`, `pages-wren--today`).

## The Map page

Home for the team (`apps/portal/web/src/map/`; M2.1 and M3, 2026-10-19). The Map is a full surface: `MapHome` (`Home.tsx`) renders `MapPage` (`MapPage.tsx`) edge to edge in a `bleed` shell window (`AppShell bleed`), so the canvas never gives up room. Today is a sheet (the portal's `Sheet`, `@wren/ui/components/ui/sheet`) opened from the Map's header button; on a phone it is a tab under the Map, open by default. The Map takes the app's tokens, so light stays light and dark stays dark; there is no forced night canvas. Nothing docks beside the graph: the node details (`NodePanel`), `History`, the palette and the edit panels are cards over the canvas, placed once in `overlay.ts` (`AT_RIGHT`, `OVER_RIGHT`; along the foot on a phone).

`MapPage` reads once through `useMap` (`read.ts`: shape, number rows for the window, ghosts) and draws `graphOf` (`model.ts`, pure) in the graph kit with `direction="down"`, `ribbons`, `bare`, `soft` and `stretch` (the graph takes the height of its box). Ribbons: a wire with `weight` draws as a ribbon 2 to 48 px (`ribbonWidth`) and eases when its number changes (off under reduced motion; nothing loops); `loop` wires are thin dashed and left out of the layout; SVG and PNG export draw both. `NodePanel` shows a node's numbers, people newest first, crossings in and out, Open; `History` lists versions, picks two and draws the diff (`diffGraph`/`diffLines`, `diff.ts`), and "Restore" on an older version lists what it changes then saves a new version `Restore v<n>`. Open and a double click go to the managing app filtered to the node (`ROUTES`, `routes.ts`; `routes.test.ts` checks each is a real page).

Edit mode (M3): the team with the `act` grant at app `deals` (the grant the server checks) sees an Edit button; `?edit=1` holds the mode in the address. The shared palette (`packages/ui/src/graph/palette.tsx`: `PaletteDrawer`, `PanelBlock`; the Wren editor uses the same part) lists the four kinds (`KINDS`, `edit.ts`); a drag onto the canvas adds a node with a free id (`idFrom`) and opens its card. A line is dragged from a handle (hold Alt, or turn on "Loop line", for a loop); `reasonFor` (`edit.ts`) refuses what `checkShape` would, and the reason shows on hover. `NodeEdit` and `EdgeEdit` (`EditPanel.tsx`) edit fields by kind (the advance rules reuse `LogicForm`, `modules/wren/logic-form.tsx`) and remove; Remove on a node that open journeys sit on asks where they go (`moves`) or to keep them as a ghost. Every change goes to one local draft, `useShapeDraft` (`Draft.tsx`, one `useEdit` entry per viewer, so a reload or another page gives it back; if the shape moved meanwhile `DraftConflict` asks which to keep). `DraftBar` counts changes and lists `problemsOf`; `SaveDialog` asks for a note, calls `pipeline/shapeVersion { body, note, moves }` and shows the server's sentences if it refuses, with the draft kept. Export downloads the newest version as YAML (`pipeline/shapeExport`, `file.ts`); Import (`Import.tsx`) reads a file with `pipeline/shapePreview`, lists the diff against the newest version, and saves through `pipeline/shapeImport`. An empty workspace shows "Start from Wren's shape" (`pipeline/shapeStart`, note "Starter"). The pure edit steps are tested in `edit.test.ts`. Stories: `pages-map.stories.tsx` (`Pages/Map`: full canvas, Today sheet, phone tab, dark, edit, restore, import, tags, drafts, undo, node history, Today proposals), data `mocks/data/map.ts` and `map-drafts.ts` on a synthetic shape (`pipeline.shape_draft` is stubbed there; the record itself comes from the server half).

Shape history like git (2026-10-20, brief `designs/briefs/2026-10-20-shape-git-2-ui.md`; wire types in `packages/pipeline/src/history.ts`, `diff.ts`). `History` has two tabs, Versions and Drafts (count of open drafts). Versions: each line shows its tags (`Tag`), "from draft <name>" and its commit in the git mirror (`shortSha`, a link to `mirror.url`; no sha, no link). Act-grant viewers get Tag (`TagForm.tsx` -> `shapeTag`; tags never edit or delete), whole-version Restore, and Undo on each line of a picked-two diff (`Undo.tsx`: `shapeUndoPreview` shows the lines it would change or the server's refusal, then `shapeUndo`; the Map reads again). Drafts (`DraftList.tsx`, reads through `useDrafts`, `read.ts`): one row per open draft with Open, Compare (a version or live, via `shapeDiff` with `draft:<id>`; same drawing and lines), Propose (state `draft` only), Apply and Drop (asks why). Apply (`ApplyDialog`) shows the draft against live; when the draft's `base` is older than the newest version it first shows base to live with "Live changed since this draft started." There is no merge. Pure helpers: `drafts.ts` (`drafts.test.ts`). Edit mode exits (`DraftExits.tsx`, `Draft.tsx`): "Save version" as before, "Save as draft" (`shapeDraftNew`, name and note; the draft opens), and, with a server draft open (`?edit=1&draft=<id>`), "Update draft" (`shapeDraftUpdate`) in place of Save. The device draft of an opened draft lives under `map:draft:<client>:<id>` (`draftStoreKey`). `DraftBanner` names the open draft; Close asks first when edits are unsaved (they stay on the device). Node history: `BlameList.tsx` (one shared list, `useBlame` -> `shapeBlame`) sits in `NodePanel`, `NodeEdit` ("Node history") and `EdgeEdit` ("Line history"); a line opens History on that version beside its parent. Today (`today.tsx` `ProposalsLine`): "N shape proposals wait" when `pipeline.shape_draft` view `proposed` has rows (`useProposals`, a small read, not the `waiting.ts` count: that counts pages and a proposal has none); it links to `/?history=drafts`.

## Cards

| Card | Ask it |
|---|---|
| [[ui/kit]] | what `@wren/ui` is, its one door, what a part change hits |
| [[ui/story]] | how a story renders with no `/api`, where fixtures live, what the gates run |
| [[ui/page-story]] | how a whole page renders on a fake server, where its answers live, what fails its test |
| [[ui/player]] | the one media player in the shell: slots, the dock, resume, Picture-in-Picture |

Next door: [[platform/portal-shell]] (the frame's behaviour), [[platform/records]] (what a record page serves).

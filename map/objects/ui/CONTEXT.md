# objects/ui/: the UI hub

Tune one part of the portal's look in about 3 files: the screen, the `@wren/ui` part, its story. The look's rules are `DESIGN.md` at the repo root; the loop is the `wren-ui` skill (`.claude/skills/wren-ui/SKILL.md`).

## Walk

1. **Place → app.** The sidebar is the places (`PLACES`, `apps/portal/web/src/areas.ts:18`). A place is one app: a `Module` that `apps/portal/web/src/modules/places.ts` builds from the pages of the modules in `modules/<id>/` (Wren's `TEAM_PLACES` `:231`, a client's `CLIENT_PLACES` `:332`). Research is its own module (`modules/research/`, in `MODULES`, `modules/index.ts:9`). An old app id or page address is in `MOVED`/`MOVED_APPS` (`apps/portal/web/src/moved.ts`).
2. **App → screen.** A page is data or a hand page (`ModulePage`, `apps/portal/web/src/module.ts:180`).
   - `template: "list" | "queue" | "form" | "shop" | "overview" | "day"`: drawn by `TemplatePage` (`apps/portal/web/src/records.tsx:836`) from the `@wren/ui` template below. Tune the template, not the page.
   - A hand page (`HandPage.Page`, `module.ts:77`): its own file in the module folder. It uses `@wren/ui` parts; tune those parts.
3. **Screen → part → story → DESIGN.md section.** The table. Open one story: `http://localhost:61000/?path=/story/<id>`.
4. **A whole page or the layout across apps:** its page story. Every page a person can open has one ([[ui/page-story]], the table under Page stories).

## Parts

A set has `default`, `empty`, `loading`, `failed`, `worst-case` where the part has those states; other ids are named for what they show. The id prefix is the file stem. A folder adds its name (`graph-ribbons`, `charts-dashboard`); the stories in `metro/` are `orrery`.

| Screen piece | Part (`packages/ui/src/`) | Stories (`<stem>--…`) | DESIGN.md |
|---|---|---|---|
| a list page (`list`), its rows, needs tiers, bulk bar | `RecordList` `records-list.tsx:303` | `records`, + `rows-loading`, `rows-failed`, `late`, `by-field`, `bulk`, `sorted` | Lists and records |
| an open record (panel or full page) | `Panel` `records-panel.tsx:74`, `RecordPage` `records-page.tsx:86` | `records--panel-*` (`open`, `default`, `empty`, `loading`, `failed`, `worst-case`) | Lists and records |
| the rows of any list: groups, folds, picks, the wait | `Rows` `rows.tsx:491` | `rows` | Lists and records |
| a row's peek, its main action, panel or sheet | `PeekView` `peek.tsx:53` | `peek` | Lists and records |
| a panel beside the page | `SidePanel` `side-panel.tsx:17` | `side-panel` | Navigation and shell |
| a list's views, search, filters, sort | `ListBar` `list-bar.tsx:1174`, `SearchBox` `:1418` | `list-bar`, + `filtering`, `search-default` | Lists and records |
| the frame: sidebar, app bar, pages column | `AppShell` `shell.tsx:172` | `shell`, + `home`, `client` | Navigation and shell, Phone |
| an action's form, its run, undo, blocked reason | `FormBox` `action.tsx:369`, `useRun` `:960` | `action`, + `form-dialog`, `form-box-*` | Buttons |
| buttons, tags, segments, checks | `Button` `controls.tsx:93`, `Tag` `:196`, `Seg` `:268` | `controls`, + `parts`, `focus` | Buttons |
| a job's steps, a wait | `Steps` `steps.tsx:165`, `Busy` `busy.tsx:33` | `steps`, `busy` | Loading |
| a table, a record's facts | `DataTable` `table.tsx:348`, `FactsTable` `:492` | `table`, + `facts-*` | Tables |
| a form with kept edits | `useEditForm` `edit-form.tsx:105` and its fields | `edit-form` | Inputs |
| a reply or post draft with its turns | `DraftBox` `draft.tsx:187` | `draft` | Inputs |
| which account sends, the account filter | `AccountPicker` `accounts.tsx:149` | `accounts` | Inputs |
| an `overview` page | `RecordOverview` `overview.tsx:137` | `overview` | Lists and records, Cards |
| a `day` page | `RecordDay` `day.tsx:117` | `day` | Lists and records |
| a before/after | `Diff` `diff.tsx:62` | `diff` | Tables |
| tile sparks, trends, bars, rings | `Sparkline`, `TrendChart`, `BarsChart`, `RingChart` `charts/index.tsx:82` | `charts`, `charts-dashboard` | Charts |
| a graph: ribbons (people as width), loops | `Graph` `graph/index.tsx:47`, `ribbonWidth` `graph/model.ts:111` | `graph-ribbons` | Motion |
| one Weaver run as a graph: claim web, search tree, lanes; click a node to open it in place. Its own export `@wren/ui/research/run`; the portal maps a serve view in `modules/research/graph.ts` | `RunGraph` `research/run/graph.tsx:170` | `research-run`, `weaver-research--graph` | Motion |
| the research web: runs, sources, claims as dots | `WebCanvas` `graph/index.tsx:36` | `graph-web` | Motion |
| the metro map: lines, stations, tracks, zoom, focus, diff marks | `MetroMap` `metro/map.tsx:151` | `orrery`, `orrery-lab`, `orrery-money-models` | Motion |
| the agent chat: a thread, its cards, the chat list | `AgentThread` `agent-thread.tsx:421`, `AgentChats` `agent-chats.tsx:34` | `agent-thread`, `agent-chats` | Lists and records |
| a product's cards in the chat: a Weaver run as the Research page's own graph in card mode (`RunGraph card`), one source read alone. A CLI's `::view` line makes the part (`lift`, `apps/portal/web/src/modules/agent/thread.ts`); the portal's table is `modules/agent/views.ts`; the card reads by ref in `modules/research/chat-card.tsx`, data from `runGraphOf` | `RunCard`, `SourceCard` `research/run/card.tsx` | `research-chat`, `pages-agent--card` | Cards |
| the leaf and the sweep | `Leaf` `metro/marks.tsx:628`, `Sweep` `sweep.tsx:76` | `leaf-and-sweep` | Shapes |
| `queue`, `form`, `shop` pages | `RecordQueue` `queue.tsx:60`, `RecordForm` `form.tsx:27`, `RecordShop` `shop.tsx:37` | no part story: their page stories | Lists and records, Cards |

No part story: a module's own pieces (for example `modules/marketing/pieces.tsx`, `plan.tsx`, `videos.tsx`) import `api.ts` at load. Tune them in their page story (`wren-campaigns-content--plan`, `wren-campaigns-content--studio`).

## Page stories

Files in `apps/portal/web/src/stories/`, one per sidebar group, laid out as the portal's sidebar: `<client|wren>/<place>/<group>.stories.tsx`, title `Wren/<Place>/<Group>`; Weaver and Vireo are top-level groups. The order is `storySort` in `.storybook/preview.tsx`. Ids follow titles (`wren-map-layers--floor`). Shared helpers: `<group dir>/<source>-kit.tsx`. The guard `stories-cover.test.ts` fails on a page with no story (`designs/2026-11-05-story-parity.md`).

| Folder | Shows |
|---|---|
| `wren/shell/` | the sidebar, the phone dock, the player |
| `wren/agent-chat`, `weaver/` | the agent chat on tapes; Weaver's tree, sources, web |
| `wren/map/` | Overview, Loading and empty, Panels, Focus, Layers, History, Drafts, Import and export, Offer shapes, Offers |
| `wren/today/` | Overview (states), Approve and messages, Mail, Calendar |
| `wren/campaigns/` | Overview, Content, Outreach, Cold email |
| `vireo/` | Variants: Batches, Projects |
| `wren/people`, `wren/office/` | People; Back office: Money, Team, Workspace |
| `client/` | Today, Project, Campaigns (Reactivation, Content), People (Lists, Journeys), Back office (Account, Contract, Money, Accounts, Team), States |

## The Map page

Home for the team (`apps/portal/web/src/map/`; designs `2026-10-19-business-map.md`, `2026-10-23-focus-view.md`). `MapHome` (`Home.tsx`) draws `MapPage` (`MapPage.tsx`) with Today's tasks under it (`TodayTasks.tsx`, from `tasksOf`, `tasks.ts`). The page only reads: `useMap` (`read.ts`) gives the shape, the window's numbers, the open journeys and the ghosts; `view.ts` (pure) turns them into the `MetroView` that `MetroMap` (`@wren/ui/metro`) draws. The fold depth, the folds and the open panel stay in the browser (`kept.ts`).

- Panels are cards over the canvas, placed in `overlay.ts`. `NodePanel.tsx` shows a station, a track, a line, the hub or a campaign; the pick is in the address (`?node=`, `?track=`, `?line=`).
- A focus page (`FocusPage.tsx`, `focus.ts`) draws one part at `/map/<kind>/<id>`, a set at `/map/parts/<parts>`, a saved view at `/map/view/<id>` (`views.tsx`).
- The shape changes only through History (`History.tsx`: Restore, Undo `Undo.tsx`, Tag `TagForm.tsx`), a draft (`DraftList.tsx`, `DraftBanner.tsx`, `?draft=<id>`: Propose, Apply, Drop), Import (`Import.tsx`) and a campaign's form (`CampaignForm.tsx`, which saves a draft). A diff draws as marks on the same map. `BlameList.tsx` lists a part's history. `Refused.tsx` shows a server refusal as sent.
- Open goes to the app that manages a station (`routes.ts`; `routes.test.ts` checks each is a real page). Today's "N shape proposals wait" line is `ProposalsLine` (`apps/portal/web/src/today.tsx`).
- Stories: `stories/wren/map/` (`Wren/Map/…`, on Tidy data), answers in `mocks/data/map.ts`, `map-read.ts` and `map-drafts.ts`, a synthetic shape.

## Cards

| Card | Ask it |
|---|---|
| [[ui/kit]] | what `@wren/ui` is, its one door, what a part change hits |
| [[ui/story]] | how a story renders with no `/api`, where fixtures live, what the gates run |
| [[ui/page-story]] | how a whole page renders on a fake server, where its answers live, what fails its test |
| [[ui/player]] | the one media player in the shell: slots, the dock, resume, Picture-in-Picture |

Next door: [[platform/portal-shell]] (the frame's behaviour), [[platform/records]] (what a record page serves).

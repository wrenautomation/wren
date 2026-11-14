# Studio: the video suite (2026-11-13)

Status: design, 11-13, goldfish reviewed. Owner: the sources session (claude-4a1ac867).

## William's words (11-13)

- "our video making stuff is a bit underbaked … first video is going to be a meta video … a super well edited video of me building out my sort of agentic video system."
- Key features: "the split testing and the variations", "being inspired by creator feeds … getting AI to recreate their stuff or extract patterns", "Claude doing the remotion", "a video editor UI that is very rich … inspired by Adobe After Effects", "automating all of our clipping, automating our posts, our hooks", A/B tests on "visuals, editing, storyboarding … the copywriting".
- "our first like real like demo sort of unified dashboard thing will be for video making."
- "having all these as columns would be too dense like sub sidebar pages for each. Like a full studio suite."
- "for demo videos i want each product or build to look decoupled but it will actually exist in wren … (ex studio is by itself)"
- "Hooks and titles belong in the scriptwriting process imo"
- "not sure about vireo / tests being its own thing feel like it should be embedded inside the clips or something"
- "ads and short form variation (most hooks split testing + body + diff ctas)"
- Address and shell: "your call".

## Goal

One app, Studio, holds a video from an idea to live numbers. Every stage where taste decides shows its variants and his scores in place. In a demo, Studio looks like a product of its own: its name, its own sidebar, no Wren navigation. It runs on Wren's data, runtime and sign-in.

Non-goals (for now):
- Its own address (`studio.wrenautomation.com`). The look comes from the frame; a demo films the window. Added later by D5's path.
- Posting with no click from him. Posts and ads still wait on his approval.
- A new render engine (`2026-11-10-video-editor-pick.md` settled it); a co-edit model; export to Premiere or Resolve; Studio for a client.

## Terms

- **Finish**: the portal's video editor on a `video_edits` row: true preview, timeline, marks, agent presence (`modules/marketing/finish*.tsx`).
- **Pieces**: a read that groups what he makes: a long video with its clips and promo posts, each branch's state and numbers. Nothing stored (`packages/starling/inbound/src/pieces.ts`).
- **Vireo**: the variant loop. A subject holds batches; a batch holds samples he scores blind (`../vireo/src/schema.ts`).
- **Part**: one piece of a script: title, hook, beat, CTA or thumbnail.
- **Combo**: one short or ad built from one hook, one body and one CTA.

## What exists (11-13)

| Need | Exists | Where |
|---|---|---|
| Creator feeds | Tracked creators, daily read, outlier score on views and likes, Outliers page | `packages/research/src/creators.ts`, `modules/canon/outliers.tsx` |
| Patterns | Canon breakdowns, rule sets, `wren playbook <type>` | `packages/content-standard/src/breakdown.ts`, Canon `video-editing` |
| A video's state and numbers | Pieces: long video, clips, posts, branch states, views | `pieces.ts` |
| Edit | `video_edits` row (with the read-along `script`), `wren video …`, own frame runtime that plays spans of a raw file, Finish, storyboard of a recorded edit | `packages/starling/studio`, `2026-10-15-storyboard.md` |
| Clip picks | The look pass proposes Shorts, moments, chapters, thumbnails (`Look.shorts`) | `packages/starling/studio/src/schema.ts:94-98` |
| Quality | Floor checks P0-P3, render gate | `2026-11-10-studio-quality-floor.md` |
| Variants | Vireo batches, blind scores, notes with box and time, steers, live numbers per segment; one batch view `OneBatch` | `modules/variants/batches.tsx:445` |
| Publish | Content drafts, approval, posting by API or autobrowse | `packages/starling/inbound` |
| One-app frame | `AppShell` with no `areas` draws a slim bar and only the open app's pages; `brand` is a prop | `packages/ui/src/shell.tsx:169-174, 280-283` |

Missing: a record for a video before footage; a script with variants of its parts; combos; batches inside each stage; "make one like this"; the Studio frame.

## Decisions

### D1. The spine: `video_projects`, before footage only

| | A. New `video_projects` | B. Grow `video_edits` | C. Vireo subject as spine | D. Grow `content_ideas` |
|---|---|---|---|---|
| Starts before footage | Yes | No: an edit needs a recording | Yes | Yes |
| One row per video for every page | Yes, with Pieces after filming | Only after filming | No: Vireo judges, it holds no pipeline | Mixed with text post ideas |
| Vireo stays a reusable engine | Yes | Yes | No | Yes |

Pick A. Priorities: one row per video; Vireo stays the judge; nothing starts after filming.

The row holds what nothing else holds: `id`, `title`, `kind` (`long`, `short`, `ad`, `demo`), `brief`, `inspiration` (jsonb list of refs: a `creator_posts` key or a Canon id), `edit_id` (null until filming), `subjects` (jsonb: Vireo subject id per part kind), `folder` (a Vireo folder), `by` (agent id or person), timestamps. No `stage` column: before filming the stage is the script's state; after it, Pieces gives the state. One project holds a long video and its shorts: they are Pieces children of its edit.

### D2. The script is parts; variants live in Vireo

Table `video_script_parts`: `project_id`, `position`, `kind` (`title`, `hook`, `beat`, `cta`, `thumbnail`), `text` (a beat's words and shot note), `chosen` (a Vireo sample id, null for a beat).

- A beat is plain text on its row.
- A title, hook, CTA or thumbnail under test is a Vireo sample in the project's subject for that kind. `chosen` names the winner. One store for the variant text; blind judging comes with it.
- The storyboard before filming draws one frame per beat.
- At filming, `wren video add --project <id>` sets `edit_id` and writes the chosen version into `video_edits.script` (the read-along). From then on the edit is the truth; `video_edits.title` and `thumbnail` take the chosen title and thumbnail once.

Rejected: variants as jsonb on the part, or as Studio rows. Both copy text Vireo already holds.

### D3. Short form and ads are combos from one recording

| | A. One recording per shoot | B. One recording per part |
|---|---|---|
| Fits Vireo `Source` (one footage `ref` + spans, `vireo/src/sync.ts:14-17`) | Yes | No: needs many refs |
| Fits one `edit_id` | Yes | No |
| Cost | The retake pass sees other hooks as retakes | A Vireo minor bump and a many-edit project |

Pick A. He films every hook, the body and every CTA in one recording.

- Table `video_combos`: `project_id`, `hook`, `body`, `cta` (Vireo sample ids, or a beat range for the body), `spans` (raw seconds: the part's range minus silence and filler cuts; retake cuts inside a chosen range are ignored), `sample_id` (the combo's Vireo video sample), `ship` (when it goes out).
- Render: a Short gains `spans` in place of one `from`/`to`. The frame runtime already plays spans of a raw file.
- He judges combos in clock mode. Moment mode pauses a follower whose cut dropped the leader's moment (`modules/variants/together.tsx:130-140`), which every different hook does.
- The Combos page shows the grid: hooks down, CTAs across. The agent proposes the first set; he picks which to render.
- A part's number is the mean of its combos' numbers, per metric, unweighted, for reading only. Never a verdict.
- Organic shorts ship through the content desk; ads through Meta (`meta-ads` SOP). Ads need an `ad` collector in Vireo's host collectors (`packages/variants/src/collectors.ts:154`) and his yes on spend.

### D4. Tests live inside each stage

Vireo keeps its own page. Studio embeds `OneBatch` (exported, with an `onBack` in place of the link to Vireo's page) for the batch of that stage: titles, hooks and CTAs on Scripts, edit styles on Edit, combos on Combos, thumbnails on Publish. Same component, so the blind rule holds as on Vireo's page. A project's subjects sit in one Vireo folder (`apps/portal/web/src/folders.ts`).

"Waits on him" = an open batch with samples he has not scored. Projects shows that count per project.

### D5. The frame

| | A. One-app frame on `app.` | B. Product host `studio.` | C. Separate app (`apps/studio`) | D. Hidden sidebar (WA-1380) |
|---|---|---|---|---|
| Looks standalone | Yes: Studio's name, its pages only | Yes, and the URL | Yes | No: Wren's bar stays |
| Work | `App.tsx` only: `brand` = Studio, no `areas`, no launcher | A new site kind before the `ours` test (`apps/portal/src/hosts.ts:80-81`), a workspace pin, sign-in | A second build and deploy | Built (f2a75eeac) |
| Change to `shell.tsx` | None | None | — | — |

Pick A. `/studio/*` on `app.` always draws the one-app frame: the Studio stamp (`public/studio-icon.svg`), the viewer's name in place of the workspace, Studio's pages in the sidebar, tab title `<page> · Studio`. No launcher, area list, dock, pins, View as, Account, customize or palette. A module opts in with `standalone: { stamp }` (`module.ts`). No `?frame=product` param: in-page links drop it, so the frame would flicker away. Studio stays a place in Wren's sidebar (`areas.ts`); the frame has no link back to Wren.

B later, only if the film should show the URL. Then it uses the `app.` sign-in on the new host (`AUTH_ORIGIN` for every own subdomain, `apps/portal/web/src/api.ts:116`; the host in `WREN_AUTH_APPS`), never the client handoff: it refuses Wren's team (`packages/core/src/clients/domains.ts:173-175`).

Standalone check, for every page: no Wren brand, no area list, no other app's pages, tab title "Studio".

### D6. Pages

The Studio app (`Module`: `id: "studio"`, `standalone: { stamp }`, `requires: { audience: "team" }`, Wren's workspace).

| Page | Holds | Built from |
|---|---|---|
| Projects | Every project, its state, what waits on him; New project | new, Pieces |
| Inspiration | Creator feed and outliers, Canon patterns, "Make one like this" | Outliers page |
| Scripts | Parts, the storyboard before filming, the title, hook and CTA batches | new |
| Edit | Finish on the project's edit, edit-style batches | Finish |
| Combos | Shorts and ad combos (D3), formats, the combos batch | new |
| Publish | Drafts, ads, schedule, live numbers per combo and per part, thumbnail batch | content desk, Vireo live |

Content's page `studio` (`modules/marketing/pages.ts:120`) keeps its id and its links, and its label becomes "Write". The hidden `write` page stays hidden. No `moved.ts` entry: no address changes.

Edit takes `?project=<id>` (Finish on its edit), `?video=<id>` (any recording) or neither (the newest recordings). Publish is Content's drafts page under Studio's name.

States, step 1 (each row is a story in `stories/wren/studio/studio.stories.tsx`):

| Page | State | Shows | Enters on | Next | Motion |
|---|---|---|---|---|---|
| Projects | loading | skeleton rows | open | typical, empty, failed | rows fade in (150 ms) |
| Projects | typical | title, kind, brief, stage tag, "N to score", references | list answers | new project form | none on read |
| Projects | empty | "No project yet", what a project holds, New project | list answers `[]` | form | none |
| Projects | load failed | alert with the reason, Try again | list refused (after retries) | loading | none |
| Projects | long text | titles and briefs wrap whole | worst-case fixture | — | — |
| New project | open | title, kind (Long video, Short, Ad, Demo), Add, Cancel | New project | added, add failed, closed | form fades in (150 ms) |
| New project | added | the project heads the list | add answers | typical | new row fades in (150 ms) |
| New project | add failed | the reason under the form; typed words stay | add refused | open | none |
| Inspiration | typical | outliers, best multiple first | open | — | as Outliers |
| Edit | no project | newest recordings, each opens here | `/studio/edit` | a video | as Write's shelf |
| Edit | not filmed | title, how to tie a recording, Copy the command | `?project=` with no edit | — | none |
| Edit | no such project | "This project isn't here", All projects | `?project=` unknown | Projects | none |
| Edit | project filmed | Finish on its edit, back to Projects | `?project=` with an edit | — | as Finish |
| Publish | typical | the drafts table | open | — | as drafts |
| All | narrow (390) | top bar with stamp and name; page tabs under the Studio header | width | — | — |
| All | wide (1280) | stamp, "Studio / name", sidebar of four pages | width | — | — |

### D7. Commands

Agent drives, code is tools. JSON out.

- `wren project new|show|list|set` (`video_projects`; `set` writes title, brief, kind, inspiration).
- `wren project part add|set|choose` (`video_script_parts`; `choose` sets `chosen`).
- `wren project combos propose|add|render` (`video_combos`; `render` adds the Vireo sample).
- `wren video add --project <id>` (sets `edit_id`, writes the script); `wren project film <id> <video>` ties a recording made outside it.
- Vireo batches through `wren variants` as now.

## Build order

1. `video_projects`, `wren project`, the Studio app with Projects, Inspiration (Outliers), Edit (Finish) and Publish (drafts), the frame (D5 A), the `write`/`studio` rename.
2. Scripts (D2) with `OneBatch` embedded (D4).
3. Combos (D3): Short `spans`, `video_combos`, clock-mode judging.
4. Publish numbers per combo and per part; the `ad` collector after his yes on spend.

Own docs or tasks: "make one like this" (input a creator post or Canon pattern, output a project and a first script from `wren playbook`); editor research (After Effects, Premiere, CapCut, Descript, OpenFilm: what Finish adds); moving the demo film style (Vireo `demo-film-style:1`, now in a scratch Remotion project) into `packages/starling/studio`.

The meta video films this build: autobrowse takes of each page as it lands.

## Risks

- Near-identical organic shorts on one account split the audience and may read as duplicates. Ship organic combos days apart; run the dense grids as ads.
- The retake pass proposes cuts on the other hooks in a shoot. Combo spans ignore retake cuts inside chosen ranges (D3).
- `OneBatch` reads the URL today. Its export must keep the blind rule: a test that `change`, `why` and lineage stay hidden in the Studio mount.

## Decision log

- 2026-11-13: William set the shape (sub-sidebar pages, standalone look, hooks in scripts, tests embedded, combos for shorts and ads); shell and address left to us.
- 2026-11-13: goldfish review: 45 findings (critic 15, reader 16, zoom-out 6, overlaps merged), 27 applied, 8 rejected or shrunk (host deferred so its path map and cookie points drop; variant rows replaced by Vireo samples; balanced-grid fit dropped). Picked D1 A without `stage` (Pieces), D2 variants in Vireo, D3 A one recording, D4 `OneBatch` embedded, D5 A one-app frame on `app.` (host deferred). Open: none for William; spend on ads waits on his yes at step 4.
- 2026-11-13: step 1 built. D5 changed: the frame is always on for `/studio/*` (a `?frame=` param drops on in-page links), the viewer's name replaces the workspace, Studio stays a Wren sidebar place with no link back. D6 changed: Content's `studio` page keeps its id and is relabeled "Write" (no address moves). State table added.

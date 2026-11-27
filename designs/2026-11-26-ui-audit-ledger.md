# UI audit loop: ledger (11-26 21:10 ET to 11-27 01:00 ET)

William, 11-26: run until 11-27 01:00 ET (his usage resets then), "no more no less". Audit the Storybook UI one part at a time, over and over. Prod must be at least as good as Storybook, edge cases most of all. Track what he agreed to apart from what we made. A performance round every 30 min. The two sessions work in parallel: wren v2 (main) and wren v2 sidecar.

## How a cycle runs

1. **Audit** (sidecar): shoot the part's stories at 390 and 1280 (`look: raycast`), read every PNG, run box-fit and tells, and hold it to the owner rules. Write the findings under the part, numbered.
2. **Edge cases** (sidecar): worst-case data (skill `ui-design:break-ui`): long names, missing fields, 0 / 1 / 500 rows, unknown statuses, non-Latin text. Each break becomes a finding.
3. **Prod parity** (sidecar): the prod route renders the same component as the story (`verify-the-path-the-page-reads`). Prod's real data shapes, read only through `node scripts/prod-sql.mjs` (counts, longest values, nulls, odd values), are covered by a fixture. A prod shape no fixture covers is a finding.
4. **Fix** (main): fix the findings, prove them (shots, story tests, `peers check`, guards), then commit and run `scripts/push.sh`. Mark each finding fixed, false alarm (one line why) or William's call.
5. Log one line under the part, with the commit.

Main fixes part N while the sidecar audits part N+1. Each session claims a row by writing its name in **Held**. A finding in brand or icons goes to the sidecar (it draws those). One browser at a time: wrap every Playwright run in `lockf /tmp/wren-ui-browser.lock`. One Storybook, :61000, shared.

**Performance round** (main), when 30 min or more have passed since the last one. It measures one thing from this rotation, fixes the worst, and logs the numbers:

1. Prod list reads against the 300 ms budget: `recordsList` per record type.
2. Re-renders and long tasks on a part with 500 rows (Playwright trace).
3. The portal's route chunks: kB per route, and the heaviest import.
4. First paint of the shell and To approve on a 4x CPU throttle.

**Stop.** Each tick runs `date` first. At 01:00 ET or later: delete the loop's crons, stop Storybook and caffeinate, write the summary at the bottom of this file, tell the sidecar to stop, and tell William. After 00:40, start only small fixes.

Rules: no leads, clients, amounts or emails in fixtures. Invent no activity. Show the whole text (no ellipsis). No mono outside a terminal, no keycaps, no coloured left stripe, purple under ~1% of a screen. No prod writes.

## Agreed by William (fix toward these; do not redesign them)

| Part | What he agreed | Source |
|---|---|---|
| Look | Raycast light: mostly white, soft greys, the L5 Notion feel | 11-26 sidecar quotes |
| Aerie Tasks | copies Backlog.md; Board as v116 "to the tee"; List with a right pane; "no agent separation for the column"; subtle motion | 11-26 |
| To approve | "a bunch of bento cards is fine. lets lock in those" | 11-26 |
| Batches | "more ui actions at the top level"; opening a variant "looks good" | 11-26 |
| Icons | swap B, stroke 1.6 (WA-1464) | 11-26 |
| Hovers | the hover triangle: no flicker when the cursor moves onto it | 11-26 |

## Made by us, not yet agreed (William critiques these)

| Part | State | Note |
|---|---|---|
| Shell top pills (D2) | built (WA-1456) | D2 is open: William picks the nav |
| Anton docked | built (WA-1457) | "the agent view needs work" |
| Perch mark | ported (WA-1460) | Anton's circle mark and the SMS icon are his call |
| Everything in the queue below | as built before the redesign | |

## Queue

| # | Part | Stories | Held | State |
|---|---|---|---|---|
| 0 | WA-1464 icon swap | kit icons | main | done, 02daa0b4e |
| 1 | Aerie: Intake, Decisions, History | `stories/wren/aerie` | sidecar | audited; pass 2 audited |
| 2 | Today / To approve | `stories/wren/today`, `redesign/shell` | sidecar | audited; pass 2 audited |
| 3 | Variants / Batches | `stories/vireo`, batches | sidecar | audited; pass 2 audited |
| 4 | Anton panel | `redesign/anton`, `wren/agent-chat` | sidecar | audited; pass 2 audited |
| 5 | Canon | `stories/wren/canon` | sidecar | audited; pass 2 audited |
| 6 | Map | `stories/wren/map` | sidecar | audited; pass 2 audited |
| 7 | Explorer | `stories/wren/explorer` | sidecar | audited; pass 2 audited |
| 8 | Office | `stories/wren/office` | sidecar | audited; pass 2 audited |
| 9 | Studio | `stories/wren/studio` | sidecar | audited; pass 2 audited |
| 10 | Campaigns | `stories/wren/campaigns` | sidecar | audited; pass 2 audited |
| 11 | Shell (side nav, More, phone tabs) | `stories/wren/shell` | sidecar | audited; pass 2 audited |
| 12 | Client: campaigns, office, people | `stories/client` | sidecar | audited; pass 2 audited |
| 13 | Weaver | `stories/weaver` | sidecar | audited; pass 2 audited |

After 13, start again at 1 with a fresh eye.

## Findings

### Row 1: Aerie Intake, Decisions, History (sidecar, 11-26 21:15)

34 stories at 390 and 1280, `look: raycast`, messy data. Shots: scratchpad `audit1/`.

1. Times and dates show wide gaps: "Nov 26 , 9 : 02 PM". Aerie sets `tabular-nums` by hand, and Schibsted's tnum widens `, . :`. Raycast sets `--ui-numeric: normal` for this (theme.tsx:498). Fix: use `[font-variant-numeric:var(--ui-numeric)]`, as `records-columns.tsx:27` does. Places: intake.tsx:384, history.tsx:240, decisions.tsx:352/441/450, list.tsx:164, board.tsx:23, task.tsx:254. 207 hand-set `tabular-nums` exist in portal and ui. Sweep the ones that hold punctuation.
2. Phone: the "Answered a: …" toast covers the "Saving" pill and the Map tab (decisions answer-lands, intake file-failed). Put both above the tab bar, stacked, not on top of each other.
3. Phone tabs: Tasks, Intake, Decisions and History all use the same three-line icon. **Fixed 5db722932 (sidecar):** Aerie picks in `areas.ts` (board, inbox, choices, history). The cause: "tasks" matched `/ask/` and got the chat icon; the rest fell back to `list`.
4. History at 390: the search becomes a bare magnifier with no field and no word. Keep a short field, as at 1280.
5. Decisions: "Recommended" moves around. It is inline after the option in the queue card, and on its own line under the text in the keep/send card and in Answered. Pick one place.
6. Actor ids show raw: "agent:claude-builder", "runner:claude", "peers:cc-1a2b3c4d". `who()` (look.ts:130) strips only "@". Show the name, and the kind as a word or icon.
7. Answered decision reads "b from william · 2 days ago. Why: …". Use the option's words: "william picked Three weeks · 2 days ago".
8. Cards differ between sibling pages. Intake receipts are grey fills with no border. Decisions cards and all empty states are white, with a border and a shadow. Use one card surface in Aerie.
9. Prod parity: 862 of 1,340 prod events are "imported it (tasks)" by williamjin, in bursts. No fixture has a burst, so prod History is hundreds of the same line. Fix: collapse a run of one kind by one actor ("imported 824 tasks"). Add a fixture with a burst of 300 imports.
10. Prod parity: 38 imports have place "archive/tasks" and print raw: "imported it (archive/tasks)". No fixture has it. Say "imported it to the archive".
11. Prod parity: prod has 0 intakes and 0 decisions, so prod shows only the empty states. Intake's "Nothing filed from words yet" reads oddly. Say "Nothing filed yet".
12. No-actor card at 390: the CLI line breaks inside the command ("aerie actor set <id>" / "--email …"). Give it its own copy row, as Intake's "aerie intake … Copy" has.
13. Coverage: no story shows the mic. Dictate renders nothing with no engine (dictate.tsx:359), and Storybook has none. Add a story with a fake engine, so the box with the mic is shot at 390.
14. Box-fit: the underlined text button (View as, Try again, Copy, Clear) is 25.19 px high and needs 29.2 px: 45 hits. This is the carried "View as" item. Fix it once in the kit's link button.

False alarms: failed stories show skeletons at 390 because the shot came during the one 1 s retry (query.ts:42). The blue and black double ring on option b comes from the story's scripted click (`has-[:focus-visible]`), not from a mouse pick.

### Row 2: Today, To approve, Messages, Mail, Calendar (sidecar, 11-26 21:35)

29 stories (`stories/wren/today`, `redesign-shell--today`, `--today-night`) at 390 and 1280, `look: raycast`. Shots: scratchpad `audit2/`.

1. Search fields cut their placeholder mid-word: "Search items to approve and a", "Search inbox items and a muc". The placeholder takes the view's name, and a long name overflows the fixed field. Use "Search" alone (whole text, no cut).
2. "Sends 1 month ago" on items that still wait (43 days). A send time in the past reads as sent. Say "Was due 1 month ago", or show the wait only.
3. Kind labels mix case: "draft" next to "Post draft", "Copy to make live", "Video to approve". Use one sentence case.
4. Little dots (L5.4, his words: "no little circle things to the left"): Mail's Queue and Verdict cells ("● Needs you", "● Show", "● Hold"), and the coloured squares in Messages' Type column. Use a word or a tint.
5. Calendar says "Shaded: your open hours (America/Chicago)", but no shading shows in the Raycast week grid. The tint is missing or too faint on white.
6. `stories/wren/today/overview` renders the Map ("Your business"), not Today. Move it under Map or rename it, so this row's stories show Today.
7. Prod parity: To approve in prod is mostly invites: 253 pending `reach_invites` and 0 waiting `content_drafts`. The card fixtures have 5–6 rows, and no story has hundreds. Add a 300-card story and check scroll, paging and the counts.
8. Fixture: messy data fills "Held because" with its own label, so cards read "Held because: Held because 5 …". No prod value starts that way. Fix the messy mock, so the shot does not hide a real doubling.
9. Box-fit: only the carried link-button item (36 hits).

### Row 3: Variants / Batches (sidecar, 11-26 21:36)

32 `app-vireo-*` stories at 390 and 1280, `look: raycast`. Shots: scratchpad `audit3/`.

1. `subjects--tree` at 390: the long blue node label runs up over the header and the "Batches" back link. The label does not wrap inside its node. At 1280 it fits.
2. At 390 the "By state" chip shrinks to "B". Keep the whole word; let the chip row wrap or scroll.
3. The batch page shows two "Rename" links stacked: one under the heading, one beside "No title". Each reads as the same action. Name what each renames ("Rename subject", "Add title"), or keep one.
4. Tabular figures widen ", :" in prose ("Marked 0 of 3 … line , as prod data has :"). Same cause as row 1 #1: `tabular-nums` set on running text.
5. Little dots (L5.4, his words: "no little circle things to the left"): the chat card's "● 0 of 4 marked" pill and "● Brief". Use a word or a tint.
6. Prod parity (prod 11-26): 9 subjects, 54 batches (27 open), 552 samples, 1 note. Batches hold up to 100 samples; the stories hold at most 12. Add a 100-sample batch story and check the grid, paging and the counts. 28 samples have no name, so the unnamed sample state is real. Longest values: batch "why" 1,223 chars, batch note 1,200, sample body 2,118, batch title 84, sample name 60, subject name 37. The fixtures' long lines are shorter than prod's "why" and note; lengthen them to 1,300.
7. Box-fit: only the carried link-button item (27 hits).

### Row 4: Anton panel (sidecar, 11-26 21:39)

15 stories (`redesign-anton--*`, `app-wren-agent-chat--*`) at 390 and 1280, `look: raycast`. Shots: scratchpad `audit4/`.

1. Each user message carries a page line with the raw path: "Research › Runs (/iframe.html)". In the app it shows a URL path, which means nothing to William. Show "Research › Runs" only.
2. `on-map`: the empty panel shows only "Ask Orrery", alone at mid-left, with no line under it and no prompts. The other empty panels ("What are we tuning?", "What should I research?") have a line and four prompts. Give Orrery the same.
3. `card` at 390: the hero tree in the Vireo card is cut at both sides. "Lit desk scene" runs off the left; "Editori grid" and "Index with type and a muc" run off the right. Fit the tree to the card width, or let it pan.
4. `card-on-live`: "Search the round's queries" shows twice: once faint with a spinner, once live with "0s". One step, one line.
5. Tabular figures in prose again: the turn foot reads "Sonnet · 2 . 8 s" and "Sonnet · 0 . 0 s". Same cause as row 1 #1. A turn that took 0.0 s should not show a time.
6. Little dot (L5.4, his words: "no little circle things to the left"): the card's "● A batch waits" pill. Use the word or a tint.
7. `commands`: the story replays a stream on a timer. The 390 shot caught the /context table empty with a caret; the 1280 shot caught it full. Shots differ per run. Freeze the story at the end state, with a separate `streaming` story for the mid state.
8. `commands`: "Context Usage" sets one word bold and one grey in the same heading. Use one weight.
9. `gone` titles the chat "Chat". When the session is gone, keep the last known title, or say "Chat not found".
10. Prod parity: not measured. Anton sessions live on the Mac (the box at 127.0.0.1:4748), not in prod Postgres; prod `chat_threads` and `chat_messages` are site chat and hold 0 rows.
11. Box-fit: only the carried link-button item (1 hit per 1280 shot, 2 on `changes-and-ask`). The 404s are fixture URLs (`i.ytimg.com/vi/abcdefghijk`, `bakers.example`, session `…00ff` on `gone`), expected.

### Row 5: Canon (sidecar, 11-26 21:47)

50 `app-wren-canon-*` stories at 390 and 1280, `look: raycast`. Shots: scratchpad `audit5/`.

1. The UI labels the owner "His": the "His" tag on a source, "His note", "His notes" on a topic. It names one person's gender in a product other people sign in to. Use "Yours" / "Your note", or the person's name when another user reads it.
2. Post titles cut with "…" in the outlier grid ("…minute teardown of…", "…carry the…"). Memory "show the whole text": no ellipsis. Show the whole title; the tile grows.
3. At 390 the "All outliers / Breakouts / Hidden gems / Viral now" tab row cuts "Viral no" at the right edge with no cue that it scrolls. Wrap it, or fade the edge.
4. The creator filter sheet puts a radio circle at the left of each creator row. L5.4 ("no little circle things to the left") removed check circles. Use a check mark after the name when picked (wren v2 owns the kit choice; see the dots line in rows 2–4).
5. `outliers--selecting`, `--saved`, `library--search`, `--no-match` end with focus on "Skip to content". The shots show the skip link, and the page scrolls so the sticky header covers the creator strip. Move the story's end focus to the control it tests.
6. Prod parity (prod 11-26): 10,760 Canon records (8,440 findings, 2,009 sources). 92 record titles run over 200 chars, 3 over 1,000; the longest is a source at 7,605 chars. The fixtures' titles are short. Add a 7,600-char source title story and check the library row and the opened sheet. Creators: 22 active, 1 failing reads; 1,696 posts, 90 at 10x or more, top 255x. 1,324 posts (78%) have no title and 368 no picture, so the text tile is the common tile, not the edge case. Every post has a title, text or picture.
7. Box-fit: only the carried link-button item (2 hits on `library--topic` and `--binary-file` at 1280). The 404s and 500s are the fixtures' missing picture and the `failed` story's planned errors.

### Row 6: Map (sidecar, 11-26 21:58)

68 stories (`app-wren-map-*`, `today--overview`) at 390 and 1280, `look: raycast`. Shots: scratchpad `audit6/`.

1. Story checks fail (red play functions, not planned 4xx): `loading-and-empty--loading` at both widths (the "Reading your map" skeleton is not visible); `focus--station` at 390 (`FocusPage.tsx:564` line not visible); `drafts--apply-live-changed` and `drafts--apply-refused` at 1280 (`DraftList.tsx:53` row not visible); `overview--phone` at 1280 ("Retainer" not in view: a phone-only check runs at desktop width).
2. Labels at the right edge of the map frame are cut mid-word at 390: "Not a fi", "Jo", "Re", "Folk". Start the pan with the label inside the frame, or pad the frame by one label width.
3. The station panel says "median 1,200 h". Above 48 h, show days ("median 50 days").
4. The focus page shows Now, Arrived and Left twice: in the header line and again as a list below the map. Keep one.
5. The Today panel on the Map: rows start with initials circles ("AN", "CM", "BF"). L5.4 removed avatars at the left edge. Put the person's name in the row meta.
6. The same panel lists "Send the contract · 0 waiting at Booked" under "waiting on you". A task with no one waiting should not count as waiting.
7. The orange dot before "The newest version dropped a part…" is a little circle to the left (L5.4). Drop it; the sentence carries the warning.
8. In the panels, the "Signed" tag icon sits on its own line above the word. Put the icon and word on one line.
9. Box-fit on Layers: the plate buttons (`button.mlay-open`) are 110–254 px high, and their content needs 130–364 px, on 11 plates. The 3D transform may cause this, but check that a click on a plate's top part still opens it.
10. `focus--line` ends with focus on "Skip to content" (same as row 5 #5).
11. Prod parity (prod 11-26): the live shape (version 9) has 17 stations, 17 tracks, 5 lines and 2 groups; the longest station label is 16 chars. 9 versions, 2 drafts, 1 tag. The `big` story covers this size. No gap.

### Row 7: Explorer (sidecar, 11-26 22:09)

54 `app-wren-explorer-*` stories at 390 and 1280, `look: raycast`. Shots: scratchpad `audit7/`.

1. The Map view is a blank grey box at 390 (`canon--map-root`, `--map-at-line`: 480 px, no nodes). At 1280 it draws. Either draw it at phone width or hide the Map view button there.
2. `canon--map-link` at 1280 shows only a spinner (shot tool: "no body"). The story never loads.
3. `canon--shot-opened` at 390: the story check fails (the shot `img` is not visible).
4. A Weaver pick or page whose picture is missing shows a bare grey block (picks 1 and 3, the read page's preview). Other tiles show the site icon. Use the site icon for every missing picture.
5. The business-map station panel prints the raw line "attached sop: Booking SOP (booking)" (`packages/paths/src/metro-tree.ts:75`), and its meta reads "time · book", "condition": internal kind ids. These are the `key: value` lines an agent greps, shown as is. Keep them for agents; render them as fields for a person ("SOP: Booking SOP", plain kind words).
6. The numbered black circles on Weaver pick tiles ("1", "2") sit at the top left. Under L5.4 ("no little circle things to the left") use a plain number or none; rank already sets the order.
7. In a folder, the "↗" after a long subject title wraps alone onto the next line. Keep the icon with the last word.
8. Fixture: `weaver--run-board` reads "r1 · 3 pages, 2 kept" in the header and "Pages 180" below, from two mocks. Make the run list mock agree with `BOARD_VIEW`.
9. Box-fit: the Map view's node buttons are 54 px high and need 55.5 px (22 on `canon--map-at-line`, 13 on `business-map--map-root`, 3 on `weaver--map-run`). A 1.5 px overflow: add the padding or drop the fixed height.
10. Prod parity: Canon holds 10,760 records (the fixture says 10,577; close). The business map has 5 lines (the fixture has 10). Weaver runs live on the Mac, not in prod. No gap.

### Row 8: Back office (sidecar, 11-26 22:14)

18 `app-wren-back-office-*` stories (Money, Spend, Model usage, Payments in, Subscriptions, Speed, Accounts, Team, Grants, Look, Experiments, Contracts) at 390 and 1280. Shots: scratchpad `audit8/`.

1. At 390 the money rows drop the amount. Spend, Model usage and Subscriptions show the name, "This month" or "Monthly", and no dollar figure. On a money page the amount is the row's point. Keep the amount; drop the period word first.
2. Spend at 1280 has two columns named "Month": one shows "Oct 2026", the other "This month". Name the second "Period", or drop it (the tab already filters by month).
3. The side nav under Back office shows "Money" twice.
4. Model usage at 390 cuts the name after three lines with no "…" ("…as prod data has"). Memory "show the whole text": show it all, as Spend does.
5. At 390 the page header wraps "Back office" onto two lines although the bar has room.
6. The Money donut's centre label cuts the account name with "…" ("Account 7 and a much longer real world line, as prod…"). Show the percent only in the centre; the name is in the list below.
7. Payments in and Accounts start each row with an initials circle ("AN", "EB", "BF"). L5.4 ("no little circle things to the left") removed avatars. Drop them; the name is already first.
8. Speed lists raw handler ids ("VariantsConsole/batches", "ConsolePortal/recordsList"). Show the screen a person waits on ("Batches list"), with the id as meta.
9. Box-fit: no hits. The 500s are the `-fails` stories' planned errors.
10. Prod parity (prod 11-26): 26 bill payments, 1 subscription end, 4 connector grants, 2 social grants. The fixtures (3–8 rows) match this size.

### Row 9: Studio (sidecar, 11-26 22:27)

36 stories (`app-wren-studio-*`, `app-wren-studio-add-creator-*`, `app-wren-campaigns-content--studio-*`) at 390 and 1280. Shots: scratchpad `audit9/`.

1. `studio-add-creator--nothing-found` at 390 is blank: the sheet never opens (0 controls; `api/delivery/me` 404). At 1280 it draws. Fix the story's mock.
2. Waiting rows on Write start with a checkbox and then a letter tile ("P", "T", "C", "S"). Two marks before the title, and the tile is the L5.4 shape ("no little circle things to the left"). Drop the tile; the line name already shows the line.
3. At 390 the "Approved: 2 ideas" toast covers the "+" button (Write and To approve). Lift the button while a toast shows, or put the toast above it.
4. Waiting rows show "Thu 7:16 PM · 26h" in orange. "26h" has no word: say "26 h late" or "due in 26 h".
5. `campaigns-content--studio-open`: the draft text button is 113–115 px high, its text needs 170–173 px (box-fit, both widths). The text spills under the next block. Drop the fixed height.
6. The Inspiration creator strip uses round photos and initials circles ("B", "E") with platform badges. At 1280 the grouped view puts a round photo left of each creator name. Same L5.4 question: keep the photo (it is the person), drop the initials circle, use the name.
7. "Bartholomew Featherstone haugh-Montgomery" breaks a name inside a word. `hyphens: auto` splits proper names; set `hyphens: manual` on names.
8. Inspiration at 390 stacks two chip rows (All posts / Breakouts …, All / Long-form …) and an icon row before any post. Three bars of filters on a phone. Fold the kind row (All / Long-form / Shorts / Posts) into the Filter menu at 390.
9. Edit not filmed tells a person to run `wren project film 3 <video id>` and gives "Copy the command". A person in the portal has no shell. Give a "Pick the recording" button that does the same call; keep the command as meta for agents.
10. The Edit video cards are flat black with a play icon. A render that has a frame should show it; a failed render should say so on the frame, not only in the chip.
11. The Publish table header puts a type icon (circle check, "T", "#") before each column name. Column icons repeat on every column and say nothing a person needs. Kit records-page: wren v2.
12. Prod parity (prod 11-26): 0 video projects, 298 content drafts, 24 tracked creators, 15 creator people, 1,696 creator posts. Projects shows its empty state in prod. Inspiration fixtures hold 8 posts from 5 creators; prod is 200 times that. Test the grid and the creator strip at 1,700 posts and 15 people (paging, strip scroll).

### Row 10: Campaigns (sidecar, 11-26 22:32)

23 `app-wren-campaigns-*` stories (Overview, Posts, Drafts, Recordings, Followers, Engage, Conversation, Invites, Cold email, Booked calls, Finish) at 390 and 1280. Shots: scratchpad `audit10/`.

1. Cold email overview: the "Inboxes paused 3" card has a pink tint and a red top border. The tint marks the state; the border is a stripe accent. Drop the border.
2. At 390 the page "…" button sits alone on its own row under the subtitle on Engage, Conversation, Invites, Inboxes and Booked calls. On Posts and Drafts it stays right of the title. Keep it in the title row on every page.
3. Conversation at 390 shows "LinkedIn · Last 30 days · …" per row: the window repeats the filter, and the numbers (answered, time to reply) are gone. At 1280 the "Window" column repeats the filter too. Drop the window; at 390 keep time to reply.
4. Recordings and Followers start with a black primary button ("Approve", "Read now") before any row is picked. "Approve" with no object reads as approve all. Name it ("Approve 1 waiting") or move it to the row.
5. Followers shows a one-option filter ("All 8"). Hide the bar when it has one option.
6. Followers at 390 ends each row with a bare number ("21", "19"). No header says which. Name it ("21 followers").
7. Engage and Write rows mark the kind with a small coloured square ("Their post", "Reddit thread", "Offer builder"). L5.4 ("no little circle things to the left"). Same as kit (c); not every tag went through `Tag`. wren v2.
8. Finish, agents here: "session-7f3a is on Captions" shows a raw session id next to a coloured dot. Show the agent's name, drop the dot.
9. Finish, marks: the marked box carries a black circle "1" at its top left (same as R7.6). The mark chips on the timeline are 15 px high and need 16.3 px (box-fit, 3–5 per story). Drop the fixed height.
10. Finish at 390: the filmstrip word chips cut each word ("One li", "on the pag", "sectio"). Show the word, or a tick with the word on hover.
11. Cold email lists repeat campaign names ("SEC RIA" twice, "Agencies" three times) with nothing to tell them apart. Add the start date or the list name.
12. Cold email campaign rows end with "▷" when the state is "Follow-ups only" and "…" when "Opening". A lone play icon has no word. Use one "…" menu, with "Resume" inside.
13. Fixtures: Followers puts person names in the "Platform" column and the same number in every column; Conversation says 7 comments but "3 of 12 answered"; the Overview chart runs Oct 11–17 under "this month". Fix the mocks so a reader can trust the numbers.
14. Box-fit: only item 9.
15. Prod parity (prod 11-26): 48 social posts, 4 booked calls, 2 email campaigns, 312 invites (253 pending), 257 follower-count days. Invites is the big list: test it at 300 rows. The other fixtures match.

### Row 11: Shell (sidecar, 11-26 22:36)

20 stories (`app-wren-shell-*`, `redesign-shell--*`, kit `shell--*`) at 390 and 1280. Shots: scratchpad `audit11/`. Box-fit: no hits. No load errors.

1. Kit `shell--worst-case` at 1280: the sidebar's workspace name breaks letter by letter ("Internat / ional / Consoli / dated") because the long tag beside it takes half the column. Put the tag under the name, or cap the tag width. wren v2.
2. At 390 a long name in the top bar runs above the bar and is cut at the top edge (`redesign-shell--client-keeps-apps` "Acme Plumbing and a much longer…", `shell--worst-case`). Clamp the bar title to one line and show the whole name in the page title below it. wren v2.
3. Kit `shell--client` at 390: the tab bar shows "Apps" at both ends (Apps · Today · Waiting · Approved · Apps). `shell--default` puts three tabs left and Apps far right with a gap. Spread the tabs evenly and show Apps once. wren v2.
4. The header shows the app name twice on Aerie: "Aerie" title and an "Aerie" chip. On Variants the chip says "Vireo", which earns it. Hide the chip when it matches the title.
5. The side nav count badges are pink circles on the phone dock and black circles at 1280. Use one badge style.
6. Map at 390 (`shell-sidebar--items`): "The newest version dropped a part that people are still on: Joined (1)" with an orange dot before it. The line is unclear to a person, and the dot is L5.4. Say "1 person is on a step the new version removed: Joined" with a link.
7. Recordings: "Minutes 0" for a 1-second call. Show seconds under a minute ("1 s").
8. Today cards read "Held because: Held because 5 …" and Engage reads "Copy to make live · 43 days" with no word for the 43 days. The first is the fixture (it fills a field with its label). The second is page-level: say "waiting 43 days".
9. App stories at 390 show no phone tab bar (Today, Aerie, Variants, People). The tab bar sits in the kit shell only. Check that a phone in prod shows `PHONE_TABS` (5db722932) and add one app story that shows it.

### Row 12: Client (sidecar, 11-26 22:44)

65 `app-client-*` stories (Today, Project, Reactivation, Content, People, Journeys, Back office, states) at 390 and 1280. Shots: scratchpad `audit12/`. Box-fit: no hits. The 500s come only from `project--plan-fails` and `states--failed` (planned).

1. Project and Reactivation overviews show "Needs you 6", "Waiting on your OK 3", "Paperwork to do 4" and "Drafts to approve 2" as pink cards with a red top border. This is the R10.1 stripe on a shared stat card, three in a row on Project. Keep the tint, drop the border. Kit stat card: wren v2.
2. At 390 the client top bar shows the long account name over three lines, cut at the top edge (`today--default`). Same as R11.2.
3. Updates and Timeline show a one-option filter ("All updates 8", "All"). Same as R10.5: hide a one-option bar. Kit list bar: wren v2.
4. People, the peek and the person page mark stage, warmth and role with small coloured squares ("Stranger", "Warm", "Owner", "Lead"). Same as R10.7 (wren v2 has it).
5. Social starts each account row with an initials circle ("A", "S"). Same as R8.7 (done by wren v2 for the kit row; check this page uses it).
6. Messages rows show an orange "43 days" with no word (R9.4, R11.8). Say "waiting 43 days".
7. Timeline at 390: "0 lines from Nov 13 to Nov 26" wraps to four lines between the filter icons and the Day/Week/Month switch. Put the count on its own line above the bar.
8. Import at 390: each row puts two wrapped blocks side by side (file name left, "From …" right-aligned). Stack the source under the name.
9. The person page lists "Unknown · Region": the label and value read reversed. Say "Region: unknown", or hide fields with no value.
10. Team: the clicked member's email shows a blue focus ring cut tight to the text. The brand accent is purple; ask wren v2 whether `--ui-focus` should follow it.
11. Fixtures: Needs you says "Answered 1 month ago" on an open ask; an email reads "To approve" with "Why it stopped: Replied"; the peek reads "What they did 1", "Persona 1"; Setup reads "Setting 1 / Value 1". Give the mocks real field values so a reader can judge the page.
12. Prod parity (prod 11-26): 2 clients, 2 members, 2 accounts, 2 client records, 0 reports. The fixtures run larger than prod; no gap.

### Row 13: Weaver (sidecar, 11-26 22:52)

12 `app-weaver-research-*` stories at 390 and 1280. Shots: scratchpad `audit13/`. Box-fit: no hits. No load errors.

1. Three stories never leave the skeleton in the shot: `graph-plays` (both widths), `live` (both widths) and `all-runs` (390 only; 1280 draws). Either the mock never answers, or the page waits on a stream the story does not feed. Make each story reach its named state.
2. The run line prints "$0 . 42" and "6 hits , 4 kept , 4 read ,": a space before each dot and comma. The parts are separate spans with gaps. Join them in one text run (both widths).
3. The stats say "Spend $0.01" and the graph header on the same run says "$0.42". One of the two reads a different field. Show one spend.
4. Graph nodes carry numbered black circles ("1 round 1", "2 Run 2") at the left. R7.6 (wren v2) removed them from pick tiles; the graph still has them. Use "Round 1" as text.
5. Back and forth rows print raw agent lines: "plan: How do small bakeries…", "follow posts of https://www.youtube.com/watch?v=…". Show the step in words ("Plan", "Follow the channel") with the query as the second line.
6. The reference sheet starts with an initials circle ("M", "C") and reads "@Maya Baker · YouTube" (a handle with a space; fixture). R8.7 again. "The page reads rich" means nothing to a person; say what was read ("Full text and comments").
7. A pick with no picture is a flat grey block (pick 1 on References, the Run 2 card on All runs). R7.4: use the site icon.
8. No serve: the error shows "TypeError: Failed to fetch" under the help text. Keep it as meta under "Details"; the help text is enough.
9. Chat: the "/" menu lists Claude Code commands (`/auto-mode-setup`, `/autocompact`, `/clear`) next to `/weaver:weaver`. On a research page, list the research skills first and the rest under "More".
10. Prod parity: Weaver runs live on the Mac (`weaver serve`), not in prod. The fixture run sizes (4 to 180 pages, 3 searches, 12 picks) match a normal run. No gap.

### Row 1, pass 2: Aerie (sidecar, 11-26 23:04)

91 `app-wren-aerie-*` stories (pass 1 had 34; Tasks, Board, Columns and Task are new) at 390 and 1280. Shots: scratchpad `audit1b/`. Box-fit fell from 45 hits to 8; the 500s and 503s are the planned `-failed` stories.

Pass 1 items:
- Fixed: R1.1 (times read "10:54 PM", kit (a)), R1.3 (5db722932), R1.14 (link button, kit (b)).
- Better: R1.2. The toast now sits inside the screen, but at 390 it still covers the last card's text (decisions answer-lands).
- Still open: R1.4 (History at 390 is a bare magnifier), R1.5 ("Recommended" on its own line in Answered), R1.6 (raw "runner:claude", "agent:claude-marketing", "router"), R1.7 ("b from william · 2 days ago. Why: …"), R1.8 (Intake receipts are grey fills, Decisions cards are white).

New:
1. The status filter (`tasks--picks-status`) puts a coloured dot before each status (L5.4: "no little circle things to the left"). Long status names spill over the next row: the row holds a fixed height, and the text needs 3–12 px more (all 8 box-fit hits). Kit filter menu: wren v2.
2. The filter lists the raw status "Needs Human Input", while the board column says "Needs you". Use one name. Prod has 12 tasks in that status.
3. `tasks--many-tasks` at 390 renders all 800 rows into one 36,000 px page. At 1280 the list scrolls in its own pane. Prod has 923 tasks (810 Done). Virtualize the phone list, or page it at 50.
4. Task chips show raw session ids ("cc-1a2b3c4d", "cc-9f8e7d6c") next to the person. Show "a Claude session", with the id on hover.
5. The task page says "Edits from the web open at the switch (setting web_writes)". A person cannot act on it. Say "Editing here is off. Turn it on in Settings", and link to it.
6. Board cards end with a priority arrow ("↑", "=") and no word. List rows say "high" and "medium". Use the word on the board too.
7. Columns: "Content" has no count while every other folder has one.
8. Prod parity (prod 11-26): 923 tasks in 21 areas, 2 actors, the longest title 322 characters. Prod has the statuses "Deferred" (10) and "Blocked" (2); no fixture has them. Add both to the fixtures and check that the board and filter show them.

### Row 2, pass 2: Today (sidecar, 11-26 23:10)

29 stories at 390 and 1280. Shots: scratchpad `audit2b/`. Box-fit fell from 36 hits to 0. The 500s come only from the planned `overview--failed` story.

Pass 1 items:
- Fixed: R2.1 (the field says "Search" only), R2.3 (kinds read "Post draft", "Video to approve", "Reply to send"), R2.4 (Mail cells and the Messages Type column have no dots), R2.9 (box-fit 0).
- Still open: R2.2 ("Sends 1 month ago" on a card that waits 43 days), R2.5 (no shading in the week grid under "Shaded: your open hours"), R2.6 (`overview--*` still renders the Map), R2.7 (no 300-card story), R2.8 ("Held because: Held because 5").

New:
1. The header "Approve" button shows with nothing picked. It does not say what it approves. Show "Approve 6", or show it only when cards are picked.
2. The open card's panel lists "Held because -", "Sends -", "Suggests -", "On -" in a row. Hide empty fields.
3. The panel shows "When 1 month ago" and "Waiting since 1 month ago". Both say the same thing. Keep "Waiting since".
4. Mail rules: the verdict "Show" is amber, while "Hold" and "Drop" are plain ink. Amber reads as a warning. Use one colour for all verdicts.
5. Mail rules: "Settled by" says "Code, $0" in green. "$0" adds nothing on a code rule. Say "Code" or "Model" alone; show a cost only when it is above 0.
6. "Mail rules" shows in the side nav only while you are on it. It is missing on every other Today page. Show it under Mail always, or reach it from Mail's menu only.
7. Calendar has no page title. Every other Today page starts with a heading; Calendar starts with the booking page box. Add "Calendar" above it.
8. Kit (wren v2): table headers wrap to two or three lines ("Waiting since", "Held from them", "Settled by") while the cells have room. Keep a header on one line; shrink the column instead.

### Row 3, pass 2: Variants (sidecar, 11-26 23:17)

32 `app-vireo-*` stories at 390 and 1280. Shots: scratchpad `audit3b/`. Box-fit fell from 27 hits to 0. The one error is the planned `close-fails` story. The header and "Skip to content" that float mid-page in `tree-open` and `mark` come from the full-page shot after the story scrolls; viewport shots are clean.

Pass 1 items:
- Fixed: R3.2 ("By state" whole at 390), R3.4 (prose no longer gets tabular gaps), R3.7 (box-fit 0).
- Better: R3.1. The long subject name now sits in the phone header, not over the page. It wraps to four blue lines and touches the top edge. On the phone, title the header "Batches"; the page heading already shows the whole name.
- Better: R3.5. The "0 of 4 marked" pill lost its dot. "● Brief" in the empty tree (`chat-cards--growing`) keeps one.
- Still open: R3.3 (two "Rename" links stacked), R3.6 (no 100-sample batch story; fixture lines stay far under prod's 1,200-character "why" and note).

New:
1. Little dots (L5.4, his words: "no little circle things to the left"): each sample note starts with a green dot ("● 0:01.2–0:02.4 This pace works", "● “I can introduce you…” Concrete"). Use the time or the quote alone.
2. The mark pill "☆ Amazing · 9" is blue, and the star is blue. Blue is not in the palette; the accent is purple. Use the zone tint the "3 amazing" count pill uses.
3. Chat cards: "0 of 4 marked" and "A batch waits" sit in a red tint. Red reads as an error, but this is the normal waiting state. Use a neutral or purple tint.
4. Worst-case fixture: batch titles read "as a long brie batch 1". The fixture cuts the subject at 60 characters mid-word (`batches.stories.tsx:135`). Cut at a word, so the shot does not look like a UI cut.
5. Prod parity (prod 11-26 23:15): 9 subjects, 55 batches, 560 samples, the largest batch 100 samples. Same as pass 1 plus one batch.

### Row 4, pass 2: Anton panel (sidecar, 11-26 23:22)

15 stories at 390 and 1280. Shots: scratchpad `audit4b/`. Box-fit 0. Errors: `gone` is planned (404 on a gone session); `card` and `card-on-live` are not (item 3).

Pass 1 items:
- Fixed: R4.4 (`card-on-live` shows one "Working" line), R4.5 (the turn foot reads "Sonnet · 2.8 s"), R4.6 ("A batch waits" has no dot; its red tint is row 3 pass 2 item 3).
- Better: R4.3. At 390 the Vireo card's tree fits on the left. The right still cuts "Editori grid" and "Index with type and a muc".
- Still open: R4.1 (each user message ends "Research › Runs (/iframe.html)"), R4.2 (`on-map` shows "Ask Orrery" alone, no line, no prompts).

New:
1. The research map card spaces its punctuation: "bakers . example", "https : //www . youtube . com", "with samples ." The cause is likely tabular figures or letter spacing on the node text. Set the node text as prose.
2. Little dots (L5.4, his words: "no little circle things to the left"): the round node "bakery wholesale accounts first buyer" ends in an orange and a blue dot. Use a word or drop them.
3. `card` and `card-on-live` fetch from the open web: `icons.duckduckgo.com/ip3/bakers.example.ico` and `i.ytimg.com/vi/abcdefghijk/mqdefault.jpg`, both 404. A story must not call outside hosts. Serve the icon and the poster from the mock.
4. The compacted chat numbers its list "1 . Banana", "2 . Orange". Tabular figures on list markers again (row 1 #1 cause).
5. `commands`: while `/context` streams, its table shows as raw text ("| Category | Tokens | Percentage | |----------|---|"). Hold a table row until it is whole, or render the rows as they close.

### Row 5, pass 2: Canon (sidecar, 11-26 23:30)

50 `app-wren-canon-*` stories at 390 and 1280. Shots: scratchpad `audit5b/`. The 404s are the fixture's missing picture; the 500s and 403s are the planned `failed` stories.

Pass 1 items:
- Fixed: R5.4 (creator rows have no radio circle), R5.7 (the link-button hits are gone).
- Better: R5.3. "Viral no" still cuts at 390, but the edge now fades (kit (g)), so the row reads as one that scrolls.
- Still open: R5.1 ("His" tag `record.tsx:94`, "His note" `record.tsx:146`, "His notes" `topic.tsx:74`), R5.2 ("…a 40-minute teardown of…", "…carry the…"), R5.5 ("Skip to content" shows in `outliers--selecting` and `library--library-search`), R5.6 (no 7,600-character title story; prod unchanged: 10,760 records, longest title 7,605).

New:
1. A failed add shows the raw tool error: "yt-dlp: this video is private". Say "This video is private" and keep the tool name in the record's fields. Prod has 0 add requests now, so the first real failure will show it.
2. The library filters are native selects ("Every type", "Every topic", "Any status", `parts.tsx:53`). Every other list filters through the list bar's Filter menu. Use that menu here.
3. The record's Fields list shows raw values: "provider human: william", "by william", "why he sent it". Show "William" as a name, and drop "provider" when "by" says the same.
4. Box-fit's 2 hits (`library--topic`, `--binary-file`) are a false positive: a closed `<details>` (`topic.tsx:538`) holds its hidden body. Fix the check in `shoot.mjs` to skip closed details (sidecar).

### Row 6, pass 2: Map (sidecar, 11-26 23:42)

68 `app-wren-map-*` stories at 390 and 1280. Shots: scratchpad `audit6b/`. The 400s and 404s are planned (`apply-refused`, `import-refused`, `missing`).

Pass 1 items:
- Fixed: R6.3 ("median 50d", ac7a14f).
- Still open: R6.1 (red play checks: `loading-and-empty--loading` both widths, `focus--station` 390, `drafts--apply-live-changed` 1280, `overview--phone` 1280; `apply-refused` now fails only with its planned 400), R6.4 (Now, Arrived, Left in the header line and again below), R6.5 ("AN", "CM", "BF" circles in the Today panel), R6.6 ("Send the contract · 0 waiting at Booked" under "waiting on you"), R6.7 (the orange dot now sits on its own line above the sentence at 390), R6.8 ("Signed" icon above its word), R6.9 (the same 11 Layers plate hits).
- Not seen: R6.2 (no label cut mid-word in these shots; the "7 day" tab cuts at the edge with the fade).

New:
1. The map draw is flaky. In this pass `overview--today`, `panels--hub` and `drafts--open` stop at "Drawing your map", and `focus--parts` is blank at both widths. Pass 1 drew all four. On a rerun `panels--hub` drew, `drafts--open` did not, and `focus--parts` drew its page with no map. No map code changed since pass 1, so the draw is slow under load or it races. Time the draw in a story, and make each panel story wait for the map before its check.
2. New red play check: `focus--views-menu` at 1280 (the current view's link in the menu is not visible).
3. Box-fit: on the focus pages an SVG `g` is 11 px high and its content needs 17 px (`focus--station`, `--parts`, `--view`, `--home-view`; 9 hits). Check that a station label is not clipped.
4. Prod parity (prod 11-26 23:35): 9 versions, 2 drafts, 1 tag. Same as pass 1; the `big` story covers it.

### Row 7, pass 2: Explorer (sidecar, 11-26 23:50)

54 `app-wren-explorer-*` stories at 390 and 1280. Shots: scratchpad `audit7b/`. The 404s and 500s are the planned `failed` and `not-indexed` stories. Storybook ran under load from parallel shot runs, so read a blank map with row 6 pass 2 item 1.

Pass 1 items:
- Fixed: R7.1 (the Map view draws at 390), R7.4 (a missing picture shows the site icon), R7.6 (no numbered circles on picks, 55ca06c35), R7.7 ("↗" stays with "bakers?").
- Better: R7.2. `canon--map-link` now loads the page and its side list at 1280, but the map pane is a blank grey box in this shot.
- Moved: R7.3. `canon--shot-opened` now passes at 390 and fails at 1280 ("img not visible"), although the shot shows the picture. The check likely runs before the picture loads; wait for it.
- Still open: R7.5 ("attached sop: Booking SOP (booking)", "time · book", "condition"), R7.8 ("r1 · 3 pages, 2 kept" over "Pages 180"), R7.9 (map node buttons 1.5 px short: now 65 hits, because the map also draws at 390).

New:
1. Little circles (L5.4, his words: "no little circle things to the left"): the business-map station page puts a hollow circle before each linked station under "Goes to" and "Comes from" ("○ Held", "○ Fit?"). Use the station's own icon, as the map does, or none.
2. Box-fit: on `business-map--line` and `--station` an SVG `g` is 8–14 px high and needs 17 px (3 hits per width). Same as row 6 pass 2 item 3.
3. Prod parity (prod 11-26 23:25): Canon 10,760 records (the fixture says 10,577), the business map 5 lines. Same as pass 1.

### Row 8, pass 2: Back office (sidecar, 11-26 23:53)

18 `app-wren-back-office-*` stories at 390 and 1280. Shots: scratchpad `audit8b/`. Box-fit 0. The 500s are the planned `-fails` stories.

Pass 1 items:
- Fixed (55ca06c35): R8.1 (amounts show at 390), R8.4 (model names are short), R8.5 ("Back office" on one line), R8.7 (no initials circles).
- Still open: R8.2 (Spend has two "Month" columns: "Oct 2026" and a green "This month"), R8.3 (the side nav shows "Money" as a group label and again as its item), R8.6 (the donut centre still cuts "Account 7 and a much longer real world line, as prod…"), R8.8 (Speed lists "VariantsConsole/batches", "ConsolePortal/recordsList").

New:
1. The Money list starts each account row with a coloured square, the donut's key (L5.4, his words: "no little circle things to the left"). Keep the key, but put it after the name, or tint the amount pill in the account's colour.
2. Money shows amounts in grey pills ("$8,620.00"); Spend, Model usage and Payments in show plain amounts. Use one style.
3. Prod parity (prod 11-26 23:52): `books` holds 23 spend rows, 18 subscriptions, 114 card rows. The fixtures hold 3–8 rows; add a 120-row Spend story to check the table and the month groups.

### Row 9, pass 2: Studio (sidecar, 11-27 00:03)

31 `app-wren-studio-*` stories and 5 `app-wren-campaigns-content--studio-*` stories at 390 and 1280. Shots: scratchpad `audit9b/`, `audit9c/`. Box-fit: 1 hit per width, R9.5. The 400, 409 and 500 errors are the planned fail stories; the 404 is the fixture's `FakeReel003.jpg`.

Pass 1 items:
- Fixed: R9.1 (`add-creator--nothing-found` draws at 390: "No accounts found for Zyx Qor").
- Settled: R9.11 (column type icons stay, Notion precedent; open for William).
- Fixed after this pass (8bfebf306): R9.3. While a toast shows, the "+" rises 52 px above it (Material: the button moves up over a snackbar).
- Still open: R9.2 (letter tiles "P", "T", "C", "S" after the checkbox, at both widths), R9.4 ("Thu 8:59 PM · 26h"; the 1280 Age column says "26h" in orange), R9.5 (`studio-open`: the draft button is 112.89 px high, its text needs 170.09 px; the LinkedIn preview ends "list one...."), R9.6 (initials circles "B", "E" in the creator strip), R9.7 ("Featherstone / haugh- / Montgomery" still breaks inside the name), R9.8 (three filter bars at 390), R9.9 ("Copy the command" on Edit), R9.10 (black video cards; "Render failed" is only in the chip).

New:
1. The creator strip shows a person with no name as "@e" under an "E" circle. Show the handle in full, or the platform name.
2. `@ops-notes` carries two platform badges on one photo (LinkedIn and X) that overlap. Show one badge and a count, or put the badges under the name.
3. `key-apart` at 390: the long names wrap to 8–10 lines under each photo, so the strip is 230 px high. Do not clamp (his rule: show the whole text). Give the name a wider slot (about 96 px) so it takes fewer lines.
4. At 390 the Publish chips cut "Scheduled" to "Sched" next to the "More" button, and Compose cuts "Video" to "Vid". The edge fades, but a cut word beside a More menu reads as a bug. Put the chips that do not fit into More.
5. Compose ends the count line with a green dot: "● Fits every picked platform". Say it with the word alone, or a check icon.
6. Prod parity (prod 11-27 00:01): 0 video projects, 298 content drafts, 0 drafts waiting. Same as pass 1.

After this pass, wren v2 759d96689: R9.6 (a face with no photo is a grey blank with a person icon), New 3 (96 px slot, no clamp), New 5 (check icon; the bad state keeps red and its words). New 1 stays: "@e" is the whole handle of a one-letter fixture. R9.7 stays: no slot fits the 17-letter "Featherstonehaugh". Seen by wren v2: the outliers card at 1280 cuts "@a_very_long_handle_for_a_creator_wh" with no mark (show the whole text).

### Row 10, pass 2: Campaigns (sidecar, 11-27 00:10)

23 stories (18 `app-wren-campaigns-*`, 5 `app-wren-campaigns-content--*` that are not Studio) at 390 and 1280. Shots: scratchpad `audit10b/`. Errors 0. Box-fit: only R10.9.

Pass 1 items:
- Fixed: R10.1 (the paused inboxes card keeps its tint, no top border), R10.5 (Followers has no one-option bar), R10.7 for Engage (no coloured squares; Write keeps its letter tiles, R9.2).
- Still open: R10.2 (at 390 the "…" button sits on its own row on Engage, Conversation, Invites, Inboxes and Booked calls), R10.3 (Conversation shows "Last 30 days" per row; the 1280 Window column too), R10.4 ("Read now" and "Approve" with no object), R10.6 (Followers rows end "21" with no word at 390), R10.8 ("session-7f3a is on Captions" with a coloured dot), R10.9 (black circle "1" on the marked box; the mark chips are 15 px high and need 16.27 px, 3–5 hits per story), R10.10 (filmstrip chips "One li", "on the pag", "sectio" at 390), R10.11 ("SEC RIA" twice, "Agencies" three times), R10.12 (a lone "▷" on "Follow-ups only" rows), R10.13 (Followers: names in the Platform column, one number in every column; Conversation "3 of 12" next to 7 comments).

New:
1. Followers at 1280: the breadcrumb says "Campaigns › Posts" and the side nav marks Posts. Name the page Followers in both.
2. At 390 the same cut chip beside More (row 9 pass 2, item 4) shows on Engage ("Po"), Booked calls ("All bo"), Posts ("Leade") and Drafts ("Sched"). One kit fix: the chips that do not fit go into More.
3. Prod parity (prod 11-27 00:10): 312 invites, 253 pending. Same as pass 1; Invites still needs a 300-row story.

### Row 11, pass 2: Shell (sidecar, 11-27 00:14)

20 stories (`app-wren-shell-*`, `redesign-shell--*`, kit `shell--*`) at 390 and 1280. Shots: scratchpad `audit11b/`. Box-fit 0. Errors 0.

Pass 1 items:
- Fixed: R11.1 (the workspace name wraps by word; the tag sits under it), R11.3 (`shell--client` tabs: Today · Waiting · Approved · Apps, evenly spread; `shell--default` too), R11.5 (count badges are black on the phone tab bar, the dock and the 1280 side nav).
- Still open: R11.2 (`redesign-shell--client-keeps-apps` at 390: "Acme Plumbing and a much longer…" still runs above the bar; `shell--worst-case` now fits in 3 lines), R11.4 ("Aerie" chip next to the "Aerie" title, both widths), R11.6 (orange dot and "The newest version dropped a part that people are still on: Joined (1)"), R11.8 ("Held because: Held because 5"; "Copy to make live · 43 days"), R11.9 (`redesign-shell--today` at 390 has no phone tab bar).
- Not in this set: R11.7 (Recordings "Minutes 0"); check it on row 10's Recordings next pass.

New: none.

### Row 12, pass 2: Client (sidecar, 11-27 00:22)

64 `app-client-*` stories at 390 and 1280. Shots: scratchpad `audit12b/`. Box-fit 0. The 500s come only from `project--plan-fails` (planned).

Pass 1 items:
- Fixed: R12.1 (stat cards keep the tint, no top border), R12.3 (Updates and Timeline have no one-option bar), R12.4 (stage, warmth and role are plain coloured words), R12.5 (Social rows have no initials circles).
- Still open: R12.2 (`today--default` at 390: the account name runs above the top bar; same as R11.2), R12.6 (Messages "43 days" with no word), R12.7 (Timeline at 390: "0 lines from Nov 14 to Nov 27" wraps to 4 lines between the icons and Day/Week/Month), R12.8 (Import rows: file name and "From …" side by side), R12.11 (the peek reads "What they did 1", "Persona 1", "Phones 1", "Came from 1").
- Not seen in this set: R12.9 ("Unknown · Region"), R12.10 (the focus ring on Team). Check them on the person page and with a click next pass.

New: none.

Prod parity (prod 11-27 00:22): 2 clients. Same as pass 1.

### Row 13, pass 2: Weaver (sidecar, 11-27 00:26)

12 `app-weaver-research-*` stories at 390 and 1280. Shots: scratchpad `audit13b/`. Box-fit 0. Errors 0.

Pass 1 items:
- Fixed: R13.1 (`graph-plays`, `live` and `all-runs` draw at both widths), R13.2 (the run line reads "$0.42 · 1 round · 3 searches · 6 hits, 4 kept, 4 read, 2 findings"), R13.9 (the "/" menu puts Skills first, then Commands).
- Partly fixed: R13.6 (the reference sheet has a person icon, not an initials circle; it still reads "@Maya Baker · YouTube" and "The page reads rich").
- Still open: R13.3 (stats "Spend $0.01", graph header "$0.42" on the same run), R13.4 (numbered black circles on graph nodes), R13.5 ("plan: How do small bakeries…", "follow posts of https://www.youtube.com/watch?v=…"), R13.7 (a pick with no picture is a flat grey block), R13.8 (no serve: "This page couldn't load." over a mono "Failed to fetch"; the help text is gone, so nothing tells a person to start `weaver serve`).

New:
1. `graph-plays` at 390: the "Skip to content" link shows over the graph. The story's play step moves focus to it. Keep the link off screen until a key press.
2. Graph and All runs cards start each source with a grey square before the name ("bakers.example", "Maya Baker"): an empty site icon slot, L5.4 (his words: "no little circle things to the left"). Show the site icon, or nothing.

Prod parity: Weaver runs on the Mac, not in prod. Same as pass 1.

After 13, the next pass starts again at row 1.

## Known, carried over

- "View as" link: fixed by (b); 26.56 px high, content 26.6 px.
- Anton's footer "Sonnet · ctx" is mono: fixed, (l).
- Markdown `ol` numbers show a gap ("1 ."): fixed, (l).
- Kit side-panel Motion story fails under reduced motion in the test browser: fixed, (m). graph/map Open Box and Pick Line still fail (files outside WA-1454); metro Zoom Play and Open With Enter, and confirm Answers, fail on some runs only (load).

## Kit fixes (main)

| Item | From | Fix | Commit |
|---|---|---|---|
| (a) numbers | rows 1–4 | `tabular-nums` reads `--ui-numeric`; 35 arbitrary `[font-variant-numeric:…]` classes replaced | 63dd75c84 |
| (b) quiet/link button | box-fit, rows 1–5 | 14px/1.3, py 0.3em | 63dd75c84 |
| (c) dots at the left | rows 2–4, L5.4 | `Tag` `dot` prop removed; `Cue` draws nothing for a plain tone; `StateMark` tints the word | 63dd75c84 |
| (d) search placeholder | row 2 | "Search" (the aria-label keeps the noun) | 63dd75c84 |
| (e) phone toast | row 1 | sits above the tab bar (`data-tab-bar`), inside the screen at 390 | 63dd75c84 |
| (f) list bar gutter | carried | does not reproduce: the Save view icon keeps 16 px at 390. The cut labels were (g) | — |
| (g) labels cut at the right edge | rows 5, 6 | `.ui-scroll-fade`: a scroll-driven mask fades the hidden edge, none when the row fits; on `.ui-seg[data-fill]`, list bar, records sections, shell, switch bar. List bar shape row stays whole; narrow bar wraps tools under it. Phone Segmented centres against the track; a too-wide tab shows its start | 3b210671f |
| (h) box at the left of pick rows | row 5, L5.4 | the many-pick list shows a check after the count, like the menu | 3b210671f |
| (i) avatars, rank circles, provider ids, narrow money, phone bar | R7.6, R7.7, R8.1, R8.4, R8.5, R8.7 | no avatar or rank circle; `NameWithMark`; money first when narrow; mock model ids; phone bar title centred | 55ca06c35 |
| (j) tabs, badge, stripes, one-view strip, dots | R10.1, R10.5, R10.7, R11.1–R11.3, R11.5, R12.1, R12.3, R12.5, P2.1 | phone tabs share the width, Apps once; one count pill; stat card tint only; calendar block left stripe gone; ViewTabs hide under two views; Social drops the face; `StateMark` draws only a platform mark; sidebar tag under the name; phone bar 44 px; pick list a column (rows never squeeze); Aerie status filter drops its dot; calendar weekdays in sentence case | 6b5c60a24 |
| (k) table heads wrap | row 2 pass 2, item 8 | a head wants its whole label on one line; only a tight room wraps it | ab03ab9f9 |
| (l) mono meta, spaced punctuation | carried; row 4 pass 2 items 1, 4 | agent times, counts, status line, file caption and choice numbers in sans 12px (terminal blocks keep mono); `ol` markers use normal figures (a tabular 1 sits mid-cell); `.rg` root follows `--ui-numeric` (Schibsted tnum widened `. :`); JSON counts say "1 run"; the status line drops its trailing dot while the context menu is open | 18e5f53f7 |
| (m) "1 statu", Motion story | (l) follow-up; carried | a plural drops its s only over 3 letters and not in -is -us -ss; the Motion story checks the width transition only when motion is allowed | ae944f316 |
| (n) face blank, strip slot, fit check | R9.6, R9.7, row 9 pass 2 items 1, 3, 5 | a creator with no photo is a grey blank with a person (was a purple-tint letter); strip slot 96 px, no clamp (a 17-letter word still breaks inside); "@e" is the whole one-letter handle, no change; Compose "Fits" gets a check, a misfit keeps red and the words | 759d96689 |

Pages add `ui-scroll-fade` to their own sideways rows (Canon presets, Map filters: sidecar).

Answered, no change:
- R12.10 `--ui-focus`: the default look already rings in the purple accent, 2 px offset. The blue ring is the Raycast look's own (`focus: #3a6df0`, v116, as Raycast). Its accent is ink; a purple ring there breaks the ~1% purple rule.
- R9.3 FAB is page-level (`studio.tsx:180`): sidecar.
- R9.11 column type icons stay (Notion precedent). Open for William.
- Tells `studio-compose.tsx:346` middle dots: one counter row ("chars · posts · Reads in"), read as one meta line. False alarm.

## Performance rounds

| Time | Measured | Before | After | Commit |
|---|---|---|---|---|
| 11-26 21:15 | 1. prod list reads, from `rt.invocations` (48 h) and `pg_stat_statements` | recordsList p50/p95 ms: To approve 351/1021, Inbox 307/987, People 209/802, Batches 163/416. recordsCounts 268–417 ms (9 counts in parallel: engage 155–188, approval 97–238, the rest 16–109) | not fixed this round | — |
| 11-26 21:55 | 2. To approve's 15 reads, timed one by one on prod from the Mac (24 ms round trip), read-only | reach 560–990 ms; every other read 23–135 ms. Reach read up to 500 Reddit threads (bodies, sources) to keep the 4 queued of 6,497 | the queued read is 0.2 ms on prod; reach 382–452 ms from the Mac, the rest is 8 round trips (about 1 ms each from Lambda). Prod p50 needs traffic: read it next round | adadacdec |
| 11-26 23:20 | 3. recordsList by list, 72 h, split at adadacdec (02:50 UTC); then People › Timeline (`people.event`) | To approve after: 206/209 ms (n=2, was 351/1021); Inbox 281/365 (n=4). Timeline 2,312 p50 (n=2): both calls were the hover prefetch, unwindowed: rows 1.8 s, counts 2.8 s. 281,881 of 283,914 lines are trait changes. An index on `profile_trait_events(at)` did not change the plan (local test, 300k rows, rolled back): the view hash-joins `profiles` after the union | timeline pages skip the table prefetch; the page reads a day at a time (94 ms warm) | cc2e1e703 |
| 11-26 23:50 | 4. every portal handler, 24 h; then `recordsCounts` by batch, host overlap and `pg_stat_statements` | recordsCounts leads: 164 calls, p50 529 / p95 965 ms. 133 are the sidebar's 9-ask batch (p50 586). With no other call in flight it is still 529, so contention is not the cause. Server time is small: the largest count statement averages 42 ms (`profile_records` step flag). The rest is app work: engage and approval load rows into the app, then count them (`jsonb_to_recordset`) | not fixed. Not changed: the Lambda pool (2, `lambda.ts:30`). Raising it lets portal reads queue in PgBouncer's 20 server connections behind research stages that hold a transaction for minutes; that is William's call, and the data does not point at it | — |
| 11-27 00:20 | 3. route chunks: a fresh `vite build web` with source maps; output bytes per source from the map | `main.js`, loaded by every page: 3,628 kB raw, 1,138 kB gzip. By source: portal modules 1,048 kB (marketing 279, variants 94, canon 90, aerie 62, people 59, account 53), kit 669, agent chat (`@assistant-ui/*`, `assistant-stream`) 360, markdown (`streamdown`, `parse5`, `marked`, micromark) about 300, Studio compositions 152, zod 89, drizzle-orm 61 and `packages/core/src/schema.ts` 30. `simple-icons` is 13 (named imports shake). Workers already split: voice 1,868, elk 1,595 | not fixed. Every page module is imported at boot (`modules/index.ts`); only research's run view is lazy | — |

Round 4 probe (prod, read-only, from the Mac at 24 ms a round trip; temp script deleted): engage items 614–630 ms for 180 rows, about 25 round trips; approval items 398–460 ms for 35 rows; comment rows 115–208 ms for 68 rows; unsureSends 46–56 ms. On Lambda a round trip is about 1 ms, yet one engage count takes 173 ms there. The Lambda has 1024 MB (about 0.6 vCPU), so the batch is CPU-bound, and more connections would not help. Options for the next round:
- A. Count in SQL: let a record's `rows` take the view's where, so a "new, waiting" count skips `sentRows` and the answered comments. Code only; touches the records core.
- B. Share loaders inside one counts batch: approval and engage both build reach items. Code only; smaller.
- C. Lambda memory 1024 → 1769 MB (one full vCPU). Costs money: William's call.

Round 5 options (bundle), largest first:
- D. Lazy pages: each module's page components load on first visit (`lazy()` per route in `modules/index.ts`); nav data stays eager. Cuts most of the 1,048 kB. Touches every module's entry; a hover prefetch keeps the click instant.
- E. Lazy agent chat: `agent-thread` and its markdown load when the side chat first opens. About 660 kB. One seam in `packages/ui`.
- F. Server code on the client: `people/segments.tsx` takes `TIMELINE_KINDS` from `profiles-schema.ts` and `FUNNEL_STEPS` from `channel-stats-schema.ts`, which pull `schema.ts`, the pg-core tables and drizzle. Move the constants to plain files. About 90 kB; `segments.ts` still imports drizzle `sql`, so its client half needs a split too.

Open from round 3: the Timeline's List (`as=rows`) still reads the whole view unwindowed (785 ms rows, 550 ms count). The fix is a default window on that list, or trait changes out of the timeline (99% of its lines). The second one is a product call for William.

Next round: trace the engage and approval counts in the sidebar batch (load, then count in the app); count in SQL where the loader allows it. Then read To approve's prod p50/p95 since adadacdec from `rt.invocations`. Then Inbox (307/987): trace its reads the same way. Seen in passing, outside the UI: Aerie's CLI and mirror read all of `aerie.task` (194 ms mean, 7,381 calls since 11-06), `mirror_file` (93 ms) and the task tree (69 ms). The tables are small (923 rows, few dead rows), so the time is likely the wide text columns. That is Aerie's repo, not this loop.

## Log

- 11-26 21:10: loop set up. WA-1454 pushed (62fdfe430).
- 11-26 22:30: kit fixes (a)–(e) pushed (63dd75c84), (g)–(h) committed (3b210671f). Main takes R7.6, R7.7, R8.1, R8.4, R8.5, R8.7.
- 11-26 23:18: batch 3 (55ca06c35) and batch 4 (6b5c60a24) green. Batch 5: table heads on one line.
- 11-26 23:27: batch 5 green (ab03ab9f9). Perf round 3: timeline prefetch skipped (cc2e1e703).
- 11-26 23:48: batch 6 (18e5f53f7): mono meta, list numbers, research card figures. The active nav's corner marks are the `.ui-nav-sweep` design, not a ring.
- 11-26 23:53: perf round 4 measured, not fixed: the sidebar counts spend their time in app loaders, not in SQL or the pool.
- 11-27 00:18: (n) 759d96689: Canon strip faces and slot, Compose fit check. Seen: an outliers card at 1280 cuts "@a_very_long_handle_for_a_creator_wh" (sidecar told).
- 11-27 00:24: perf round 5 measured, not fixed: the entry chunk is 1.14 MB gzip because every page loads at boot. Options D–F above.

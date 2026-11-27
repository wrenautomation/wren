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
| 2 | Today / To approve | `stories/wren/today`, `redesign/shell` | sidecar | audited; pass 2 auditing |
| 3 | Variants / Batches | `stories/vireo`, batches | sidecar | audited |
| 4 | Anton panel | `redesign/anton`, `wren/agent-chat` | sidecar | audited |
| 5 | Canon | `stories/wren/canon` | sidecar | audited |
| 6 | Map | `stories/wren/map` | sidecar | audited |
| 7 | Explorer | `stories/wren/explorer` | sidecar | audited |
| 8 | Office | `stories/wren/office` | sidecar | audited |
| 9 | Studio | `stories/wren/studio` | sidecar | audited |
| 10 | Campaigns | `stories/wren/campaigns` | sidecar | audited |
| 11 | Shell (side nav, More, phone tabs) | `stories/wren/shell` | sidecar | audited |
| 12 | Client: campaigns, office, people | `stories/client` | sidecar | audited |
| 13 | Weaver | `stories/weaver` | sidecar | audited |

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

## Known, carried over

- "View as" link: 25.19 px high, needs 29.2 px (box-fit).
- Anton's footer "Sonnet · ctx" is mono.
- Markdown `ol` numbers show a gap ("1 .").
- Kit side-panel Motion story fails under reduced motion in the test browser; graph/map Open Box and Pick Line fail in files outside WA-1454.

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

Pages add `ui-scroll-fade` to their own sideways rows (Canon presets, Map filters: sidecar).

## Performance rounds

| Time | Measured | Before | After | Commit |
|---|---|---|---|---|
| 11-26 21:15 | 1. prod list reads, from `rt.invocations` (48 h) and `pg_stat_statements` | recordsList p50/p95 ms: To approve 351/1021, Inbox 307/987, People 209/802, Batches 163/416. recordsCounts 268–417 ms (9 counts in parallel: engage 155–188, approval 97–238, the rest 16–109) | not fixed this round | — |
| 11-26 21:55 | 2. To approve's 15 reads, timed one by one on prod from the Mac (24 ms round trip), read-only | reach 560–990 ms; every other read 23–135 ms. Reach read up to 500 Reddit threads (bodies, sources) to keep the 4 queued of 6,497 | the queued read is 0.2 ms on prod; reach 382–452 ms from the Mac, the rest is 8 round trips (about 1 ms each from Lambda). Prod p50 needs traffic: read it next round | adadacdec |

Next round: read To approve's prod p50/p95 since adadacdec from `rt.invocations`. Then Inbox (307/987): trace its reads the same way. Seen in passing, outside the UI: Aerie's CLI and mirror read all of `aerie.task` (194 ms mean, 7,381 calls since 11-06), `mirror_file` (93 ms) and the task tree (69 ms). The tables are small (923 rows, few dead rows), so the time is likely the wide text columns. That is Aerie's repo, not this loop.

## Log

- 11-26 21:10: loop set up. WA-1454 pushed (62fdfe430).
- 11-26 22:30: kit fixes (a)–(e) pushed (63dd75c84), (g)–(h) committed (3b210671f). Main takes R7.6, R7.7, R8.1, R8.4, R8.5, R8.7.

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
| 0 | WA-1464 icon swap | kit icons | main | to build |
| 1 | Aerie: Intake, Decisions, History | `stories/wren/aerie` | sidecar | audited |
| 2 | Today / To approve | `stories/wren/today`, `redesign/shell` | sidecar | audited |
| 3 | Variants / Batches | `stories/vireo`, batches | sidecar | audited |
| 4 | Anton panel | `redesign/anton`, `wren/agent-chat` | sidecar | audited |
| 5 | Canon | `stories/wren/canon` | sidecar | audited |
| 6 | Map | `stories/wren/map` | sidecar | audited |
| 7 | Explorer | `stories/wren/explorer` | sidecar | auditing |
| 8 | Office | `stories/wren/office` | | |
| 9 | Studio | `stories/wren/studio` | | |
| 10 | Campaigns | `stories/wren/campaigns` | | |
| 11 | Shell (side nav, More, phone tabs) | `stories/wren/shell` | | |
| 12 | Client: campaigns, office, people | `stories/client` | | |
| 13 | Weaver | `stories/weaver` | | |

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

## Known, carried over

- At 390 the list bar's icons run to the screen edge (the Save view icon has no gutter).
- "View as" link: 25.19 px high, needs 29.2 px (box-fit).
- Anton's footer "Sonnet · ctx" is mono.
- Markdown `ol` numbers show a gap ("1 .").
- Kit side-panel Motion story fails under reduced motion in the test browser; graph/map Open Box and Pick Line fail in files outside WA-1454.

## Performance rounds

| Time | Measured | Before | After | Commit |
|---|---|---|---|---|
| 11-26 21:15 | 1. prod list reads, from `rt.invocations` (48 h) and `pg_stat_statements` | recordsList p50/p95 ms: To approve 351/1021, Inbox 307/987, People 209/802, Batches 163/416. recordsCounts 268–417 ms (9 counts in parallel: engage 155–188, approval 97–238, the rest 16–109) | not fixed this round | — |
| 11-26 21:55 | 2. To approve's 15 reads, timed one by one on prod from the Mac (24 ms round trip), read-only | reach 560–990 ms; every other read 23–135 ms. Reach read up to 500 Reddit threads (bodies, sources) to keep the 4 queued of 6,497 | the queued read is 0.2 ms on prod; reach 382–452 ms from the Mac, the rest is 8 round trips (about 1 ms each from Lambda). Prod p50 needs traffic: read it next round | adadacdec |

Next round: read To approve's prod p50/p95 since adadacdec from `rt.invocations`. Then Inbox (307/987): trace its reads the same way. Seen in passing, outside the UI: Aerie's CLI and mirror read all of `aerie.task` (194 ms mean, 7,381 calls since 11-06), `mirror_file` (93 ms) and the task tree (69 ms). The tables are small (923 rows, few dead rows), so the time is likely the wide text columns. That is Aerie's repo, not this loop.

## Log

- 11-26 21:10: loop set up. WA-1454 pushed (62fdfe430).

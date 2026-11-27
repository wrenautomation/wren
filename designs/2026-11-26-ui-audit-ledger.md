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
| 1 | Aerie: Intake, Decisions, History | `stories/wren/aerie` | | |
| 2 | Today / To approve | `stories/wren/today`, `redesign/shell` | | |
| 3 | Variants / Batches | `stories/vireo`, batches | | |
| 4 | Anton panel | `redesign/anton`, `wren/agent-chat` | | |
| 5 | Canon | `stories/wren/canon` | | |
| 6 | Map | `stories/wren/map` | | |
| 7 | Explorer | `stories/wren/explorer` | | |
| 8 | Office | `stories/wren/office` | | |
| 9 | Studio | `stories/wren/studio` | | |
| 10 | Campaigns | `stories/wren/campaigns` | | |
| 11 | Shell (side nav, More, phone tabs) | `stories/wren/shell` | | |
| 12 | Client: campaigns, office, people | `stories/client` | | |
| 13 | Weaver | `stories/weaver` | | |

After 13, start again at 1 with a fresh eye.

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

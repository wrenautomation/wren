# Automations that do real work

Living doc. Started 2026-10-14. William: "workflows canvas is also hitting issues, 'This page hit a problem. Try again, or open another app.' and i feel like the whole workflows thing is underdeveloped / basically not fleshed out. in fact id say the same for the whole automations tab. figure that out so it serves real utility".

## Answer first

Automations is a drawing of Wren with no way in. You can't see what runs, can't turn one thing off, and can't start a useful one in a minute. The fix:

1. **All**: one list of everything that runs on its own. Each row shows its trigger, its runs in the last 30 days, failures, what's waiting, its last and next run, its last error, and an on/off switch. Every number opens its rows.
2. **New**: four templates that run on prod services today, plus build from words and a blank canvas.
3. **Runs**: the executions list we already have, with each step's outcome.
4. Cut the pages that repeat each other.

## The crash

Every push deploys the portal, and the deploy keeps only the new build's files. A tab opened before a deploy asks for the canvas's lazy graph file, gets the app's HTML back, and `Contained` showed "This page hit a problem". Fixed in d4498c6f: such a tab reloads itself once (`apps/portal/web/src/stale.ts`).

Also found:
- "Start blank" and "Build it" opened "No workflow called made.…": a made workflow wasn't a `console.component` row. Fixed in 2cf50eb4.
- During an idle prod test the canvas got 76 × 429. The mail that day says why: "Workers daily request limit exceeded". The canvas polls `console.event` every 8 s, which adds to that. aac08c4c ("fewer Worker requests") landed alongside.

## Audit (prod, 2026-10-14)

| Page | What it is | Verdict |
|---|---|---|
| Workflows → Canvas | Wren's six cards with 30-day numbers; opens each part | Keep. It's the map, not the home |
| Workflows → Executions | Each subject's path, per-step data, Retry, Replay | Keep as **Runs**. It's the history view |
| Workflows → Events | Raw arrivals; failed ones show in Runs → Failed too | Hide (old links keep working) |
| Workflows → Holds, Checks | Check holds and pass rates | Keep |
| Loops → Overview, Agents, Loops, Settings, Flags, Infra | 58 loops, 24 stopped; Agents is per part | Keep. All links into it |
| Library → Workflows | Same list as the Marketplace catalog, no numbers | Hide |
| Marketplace | The Shop: install templates on clients | Keep |
| Voice | Phone agent, in development | Keep |
| Handlers | Every service handler, a dev tool | Move to Tools |

Prod data:
- Spine runs come from three workflows only: Monitor (triage 247, bills 157 with 2 errors), Learn (read 55, score 2) and reach comments (4).
- `workflow_saves` is empty. No made workflow, so no editor use yet.
- `comment_keywords`: 0 rows. `auto_replies`: 0 rows, so every channel is on Suggest.
- The real work runs in loops (sync, send, read). Before this change no page showed loops and workflows side by side.

## What I took from others

| From | Took | Left |
|---|---|---|
| GHL | Workflow list with state and enrolled counts; templates by goal ("booking → reminders"); one switch per workflow | Their folder tree, stats tabs per action |
| customer.io | Trigger in words on each row; per-step counts; Draft vs live | Goals and conversion reports (no events to count yet) |
| Zapier | History: each run, each step's in and out, replay; on/off switch on every row; error on the row | Task metering |

## All (`console.automation`)

One record, built from what's already stored. No new tables.

- **Workflows**: Wren's own (`for: "wren"`), any that ran on the spine, and every made one, drafts included. Not setups, not the root.
  - Trigger: each trigger node's own words (`says`), else "Takes in <in ports>". A built-in one with neither is "Fed by its loops".
  - Numbers: from `events`, grouped per subject the way `spine_executions` does.
- **Loops**: one row per service. It counts keys running and failing, with last pass, next pass and error. Named for the part that owns it.
- **Keyword DMs**: one row per comment keyword, with caught, sent and failed.
- **Auto-replies**: one row per inbox channel, with its mode (Off, Suggest, Auto).

Views: All, Failing, Off (drafts included). No sidebar count: it would cost a Worker request on every page.

Links:
- runs → `/workflows/canvas?path=<id>&pane=runs`
- failed → `&runs=failed`, waiting → `&runs=waiting`
- loop → `/loops/all?q=<service>`
- keyword → `/marketing/keywords?keyword=<id>`; caught and failed → `/marketing/keyword-dms?keyword=~<word>`
- Test run → the canvas with `?test=1`: the editor opens with the tester
- auto-reply → its page

## On and off

| Kind | Off means | How |
|---|---|---|
| Made workflow | Its triggers hear nothing; subjects inside finish | `off` on the live save. `hearersOf` skips it, its door answers 409, its clocks stop |
| Built-in workflow | Its loops are its switch | Opens Loops |
| Loop service | Stop after the pass in flight | Opens Loops; Start and Stop per key (`setLoop`) |
| Keyword | Comments with it are ignored | `recordsEdit` on `marketing.comment_keyword`, state on or off |
| Auto-reply | Off / Suggest / Auto | its page |

Publishing a draft keeps the switch as it was. Turning a made workflow back on needs the same permission as publishing it.

## Templates (New)

Each one makes a made workflow as a draft and opens it on the canvas to check and publish. Nothing sends until Publish, which asks for the id when it sends.

| Template | Graph | Runs on |
|---|---|---|
| Comment keyword → DM | links to the keyword form | `KeywordDm` (SocialWatch catches the comment). One send path, so no spine copy |
| New lead → follow-up | Form → Notify me → Wait until an answer (2 days) → on timeout, Send message (email) | Sites forms' door; notifier; `logic.message` |
| Booking → confirm | Booking (booked) → Send message (email) → Notify me (sent or skipped) | `bookingFired`; reminders 24 h and 1 h before already go out by SmsWatch and Calendar |
| Segment entry → message | Segment (entered) → Send message (email) | B5 segment triggers. Opens with its segment and subject to fill, so it can't publish blank |

New action parts:
- **Send message** (`logic.message`): email or text. Settings: topic, subject, body with broadcast fills (`{first_name|there}`).
  - Gated by `mayMarket` (consent to the topic, suppressions, frequency cap) exactly like a broadcast.
  - A text queues on the person's existing text thread. Email goes through `BroadcastMail` with the topic's footer and one-click unsubscribe.
  - Records the send on the consent.
  - Ports: sent, skipped (with why).
  - A client's runs in its own database and sends through its own mailer (`MailOf`: the mailbox and postal address in Account → Messaging), as its broadcasts do. With none set, the step fails with why and a retry sends.
  - Email claims its send on the consent first, so a retry never sends twice. A failed send takes the claim back.
- **Notify me** (`logic.notify`): a line to the operator lane, with a link to the run.

A test run plays the walk with nothing sent ("Would send …").

## Build order

1. `console.automation` and All. ✔
2. On/off for made workflows and keywords; Test run from the row. ✔ Loop keys keep their switch on Loops.
3. Send message and Notify me, and the New page with the four templates. ✔ Templates live in `packages/core/src/automation-templates.ts`; `workflowBuild {template}` makes the draft.
4. Hide Events and Library → Workflows; move Handlers to Tools; map cards. ✔

## Decision log

- 2026-10-14: All is a record, not a page-only read. It gets search, views, counts on the sidebar and the phone list for free. The page draws it with linked numbers.
- 2026-10-14: Loops show one row per service, not per key. 58 rows of keys drown the six workflows. The Loops page keeps the keys.
- 2026-10-14: Built-in workflows get no switch of their own. Their loops are the switch, and two switches for one thing would disagree.
- 2026-10-14: Off is a field on the live save, not a new table. It versions with the workflow, and History shows who flipped it.
- 2026-10-14: Comment keyword → DM stays on KeywordDm. A spine copy would be a second send path for the same DM.
- 2026-10-14: Booking reminders already run (SmsWatch texts, Calendar mail). The template adds a confirmation and a ping, not a third reminder.
- 2026-10-14: Send message gates like a broadcast (`mayMarket`). A workflow that messages a segment is marketing, and marketing needs consent.
- 2026-10-14: Wren's workspace only for All in v1. Clients see Workflows when their pages show it.
- 2026-10-14: The templates use the `newsletter` topic, Wren's one email topic on prod. Send message skips anyone without a yes to it and says why on the run.
- 2026-10-14: New lead pings first and emails only if no answer in 2 days. An instant email to a form fill nobody opted into would skip anyway.

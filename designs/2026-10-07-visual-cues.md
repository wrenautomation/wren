# Visual cues: platform marks, tints, Content by platform and day

Living doc. Started 2026-10-07.

## What William said

2026-10-07: "i like the content filter type thing, but i think the unified content dashboard needs to be a little more visual, and segregated by content platform its just everything is quick to access, no context switching, and ability to manage by daily. honestly of the filter like a logo beside the name or color coded slightly would probably be good enough. just slightly more visual cue. im assuming across the UI having better visual cues for differences probably be better"

## Plan

### 1. One rule for cues

A value gets one cue, picked by what it names:

1. **A platform, site or channel** shows its mark: YouTube, LinkedIn, Instagram, X, TikTok, Reddit, Facebook, Meta, Discord, Google, and our own email, text, call, DM and web.
2. **A kind of thing** (a campaign, a stage, a type, an item's kind) shows a small square swatch in a stable tint.
3. **A state** (done, waiting, failed) keeps its tone dot. No second color system.

The records say which. A state gains `mark` and `tint`; `cued(states)` in `@wren/core/records` fills them: a key that names a known mark gets it, any other key a tint from a hash of the key. A `choice` field (a campaign) is tinted with no declaration. A status left as it is keeps its dots.

The shell then draws the cue wherever the value shows: list cells, filter options and pills, record headers (and the subtitle under the title), group headings, Inbox and Queue rows, and the Day board's groups. Graph nodes don't get marks: their nodes are steps, not channels, so nothing there is cheap and true.

### 2. The parts

- `PlatformMark` in `@wren/ui`: inline SVG, paths from simple-icons (CC0) for the brands, drawn simply for our own channels. Brand color at 14 to 16px; `mono` draws it in the text's color for dense spots. No third-party image loads.
- `Cue`: a field's value as its mark, its swatch, or its dot. `StateMark` uses it.
- Tints: 8 muted hues as `--ui-cue-1` to `--ui-cue-8` in the kit's tokens. A swatch is the hue itself; a wash is the hue at 10% over the paper, so both read on light and night themes.
- `SiteMark` uses `PlatformMark` for known hosts and keeps the letter otherwise.
- Domains, URLs and emails break only after dots, slashes and @, never mid-word.

### 3. Content by platform and by day

- **Platform switch.** Across the top of every Content page: All, then each platform with its mark and how many wait on him there. It is the list's `platform` filter in the URL, so it stays put moving between Today, Drafts, Posts, Comments and Videos. It scrolls sideways on a phone.
- **Today.** Content opens on one day: Today, back, next, pick a day, and a week strip with a dot on each day that has work. The day is grouped by platform, each group under its mark, with what's scheduled and posted, drafts waiting on him, and comments and DMs to answer. Each row carries its main action (Approve, Answer, Reply) from the existing actions, and Open. Nothing new can send.
- **Day template.** Built as a generic template, `template: "day"`, declared as data: sources (a record, a view, its date field, its main action), a group-by field and the page that opens a row. Other apps can reuse it.
- **No data yet.** A platform with no source yet shows its mark and an honest empty line, never made-up rows.

## Where cues apply

Batch 1 (marks, cues, domain breaks):

| Where | Field | Cue |
|---|---|---|
| Marketing: Drafts, Posts | Platform | mark |
| Marketing: Comments | Site; Kind | mark; tint |
| Marketing: DMs, Threads, Invites, People | Site | mark |
| Marketing: Activity, Followers | Site; Kind | mark; tint |
| Marketing: Media library, SOPs | Platform; Kind | mark; tint |
| Marketing: Subscribers, Topics | Channel | mark |
| Marketing: Site, Sessions | First touch | mark for email and texts, tint for the rest |
| Inbox: Waiting on you (and Marketing → Inbox) | Type; Site; Kind | mark for DM, email, text, tint for the rest; mark; same |
| Inbox, Marketing: To approve | Type; Site (incl. email, texts); Kind | tint; mark; tint |
| Inbox: Calls; Email replies | Campaign | tint (a choice) |
| Pipeline: Companies | Campaign; Stage | tint (a choice); dot (a state) |
| Library: templates, snippets | Channel; Fits | mark for email, text, DM, tint for post, prompt, comment, anywhere |
| Workflows: Components and Shop | Type; Stage; Channels | tint; tint; mark for email, texts, calls, DMs, web, tint for ads and social |
| Workflows: Executions | Waiting for | tint (a choice) |
| Books: Unit economics, cohorts | Channel | mark for email and SMS, tint for the rest |
| Accounts | each site's section | mark when the site is a known platform, nothing otherwise |
| Runs, setups | site | `SiteMark`: the mark for a known host, the letter otherwise |
| Record pages | the subtitle under the title | its field's cue |
| Queue rows, form sections, shop groups | the subtitle or group field | its cue |
| Filter options and pills | any cued field | its cue before the label |

Batch 2 (Content by platform and by day):

| Where | What | Date it sits on |
|---|---|---|
| Content: Today, Drafts, Posts, Comments, Videos | platform switch: All, then each platform's mark and what waits (drafts, comments, DMs, videos waiting) | none |
| Content: Today | Scheduled drafts | `scheduled` (Posts at) |
| Content: Today | Posted | `published` |
| Content: Today | Drafts waiting, with Approve | `created` (Drafted); no post date until approved |
| Content: Today | Comments to answer, with Answer | `at` (when it came) |
| Content: Today | DMs to answer, with Reply | `lastAt` (the last message) |
| Content: Today | Videos to approve, with Approve | `updated` (the last change; under YouTube) |

Waiting work dated before today, or with no date, sits on today until it's done, not on its own past day. A platform with nothing that day is named on one line under the groups. A switch pick a page's type can't hold (LinkedIn on Videos) says "No LinkedIn videos here."

Not cued: "Where" (reach account or our post) stays plain; with Type and Kind beside it a third swatch was noise. Status fields keep their dots everywhere.

## Decision log

- 2026-10-07: Written from William's note above. One rule (mark, tint, dot), declared on the records, drawn by the shell. Content gets a platform switch and a Today page on a new generic Day template.
- 2026-10-07: One set of tints for both themes. Mid-light hues read on the paper by day and by night, so no second set. Never red, green or amber: those are the tones.
- 2026-10-07: "Reach" is not a DM mark. A reach account sends comments and invites too.
- 2026-10-07: Domain breaks use `<wbr>` after dots, slashes and @. Truncating hid the end of the domain, the part people read.
- 2026-10-07: The switch's key is `platform` on every Content page, so a tab link carries it (`across` on the page). DMs count toward it: Today lists them.
- 2026-10-07: Today reads drafts, posts, comments, DMs and videos from their own records, not the Inbox, so each row's action is that page's own.
- 2026-10-07: Waiting work moves to today rather than staying on its past day. The past shows what happened; today shows what waits.
- 2026-10-07: The local preview registers Marketing's records and Pipeline's companies, so these pages draw there.

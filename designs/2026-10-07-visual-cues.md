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

Filled in as built.

## Decision log

- 2026-10-07: Written from William's note above. One rule (mark, tint, dot), declared on the records, drawn by the shell. Content gets a platform switch and a Today page on a new generic Day template.

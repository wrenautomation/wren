# Visual timeline

2026-10-15. William: "can we have our UI be more visual? ex. the timeline is a table. why not an actual navigable timeline for the timeline? ... just do some more creative / visually intuitive UI, not too much. we'll discuss design language soon."

## What

People → Timeline (`apps/portal/web/src/modules/people/index.ts`, page `timeline`, record `people.event`) is a list template today: columns at, who, kind, channel, summary. Make it a real timeline you move through.

- A time axis you can navigate: days as sections down the page, newest on top, a sticky date rail or header so you always know where you are. Jump: Today, a date picker, prev/next day or week. Zoom: day / week / month (week and month bucket lines into dense rows or a strip with counts).
- Each line is an event card on the axis: time, who (links to the profile), kind icon, channel mark (`PlatformMark` and the existing choice tints), one-line summary, and a link to its source. Same kinds read the same color everywhere.
- A density strip at the top (sparkline or bars per day for the visible range) you can click to jump to a day. Counts are real; no fake data.
- Filters keep working: kind, channel, who, and the saved views the list has now. Reuse the list's filter UI.
- Phone: one column, dates sticky, swipe-free; check WebKit 393 wide.
- The person page's Timeline (`modules/people/timeline.tsx`, counts by kind) gets the same treatment in small: their own lines on a short vertical axis, newest first, "See all" to the full page filtered to them.

## Bar

- `ui-bar` memory: high ticket, framed sections, clear borders and heading scale, soft corners. Motion only for real events (new lines arriving, a jump landing). Numbers never animate.
- Use the kit (`@wren/ui`), Lucide through the kit only, existing tokens. Don't invent a new motif or palette: a design language pass is coming.
- Build it as a reusable kit part (e.g. `Timeline` in `packages/ui`) fed by any record with a time field, so other pages (Posted, Sent, a deal's history) can use it next. Wire only People → Timeline and the person page now.
- Data: the same loader the list uses, paged by time window (don't load everything). If the server needs a window or per-day counts query, add it beside the existing one.
- Keep a "List" toggle to the old table for power use.

## Done

Unit tests for bucketing and paging. Screenshots (desktop 1440, phone 393) of local dev with synthetic data, saved under the studio cache or tmp, never committed. Never shoot the live portal.

## Calls made (builder, 2026-10-15)

Prod sizing: the busiest day had ~34k lines, most days under 100. A day can't be read whole, so lines load per day, a page at a time, and counts come from the server.

- **Kit part.** `RecordTimeline` and `TimelineSpec` in `packages/ui/src/timeline.tsx`, pure math in `timeline-axis.ts` (windows, buckets, tests). One export line in `index.ts`. A spec names fields: `at` (required), `who` and `whoLink`, `kind`, `channel`, `link`, and `icons` (state key → kit icon name). Any record with a date field can use it.
- **Page.** A list page gains `timeline?: TimelineSpec`. It opens as the timeline; `as=rows` shows the old table. A "Timeline | List" switch sits in the bar on both sides. The list keeps rows only (`card: false`): one switch, not three. The address keeps `as`, so the list's last-used memory brings back whichever he picked.
- **Zoom.** `zoom=day|week|month`, `day=YYYY-MM-DD` anchors the newest day shown (default today). Day: 14 days as sections, newest on top. Week: 12 weeks, a dense row per day. Month: 13 weeks, a dense row per week. All fit the server's 92-day stat cap.
- **Counts.** `stats` gains `until` (a bare day: the period ends there, not now) and `by` (a status field: each day's count per state). One call gives the strip, each day's total and its per-kind chips. Grouping by a declared status can't leak a name, so the demo rules hold.
- **Lines.** A day section reads its lines (`list` with `at` in the day, `-at`, 50 a page, cursor for more) only when it scrolls into view. Empty days fold into one quiet line ("Nothing Oct 11 to 13").
- **Strip.** Bars per day (per week in month zoom) for the range. A bar is a link: in day zoom it scrolls to that day and the header washes once (a jump landing); in week or month it zooms in. Bars never animate.
- **Line card.** Time, kind icon over a node on the rail in the kind's tint, kind label, channel mark, who (to the profile), summary on one line, Open (its source page). The card opens the line's own record page.
- **Filters.** Same `ViewTabs` and `ListBar` as the list: views, saved views, quick filters, search. The window's `at` overrides an `at` filter.
- **Motion.** Only real events: a jump's landing wash, lines that arrive on Refresh wash once. No count or bar animates.
- **Person page.** Its Timeline section shows the newest 8 lines on a short rail (`TimelineMini`), counts by kind kept as chips, and "See all" to the full page filtered to them. The lines come from the profile's own `load` (one more small query), not a second call.
- **Phone.** One column, the time above the card, headers sticky under the phone bar, the strip scrolls sideways inside itself only.

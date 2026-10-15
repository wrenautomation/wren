# Channel stats and segment rules as code

Bead wa-44o. Started 2026-10-15. William: "sort super granularly: who did what, where, from what. Map every stat so we know when one acquisition channel is weaker than another." And: "a bunch of conditionality, almost like code."

## Answer first

- **Segments stay B5's** (`packages/core/src/segments.ts`). Their rules get the missing conditions: an event on a channel, at most N times, before or after another event, matching some text; a message's campaign and at most N; a funnel step on a channel or source; a trait in a list.
- **Text form.** A rule reads and writes as text, for agents and the CLI. The portal keeps editing the JSON. Both parse to the same `Rule`.
- **Versions.** Each save keeps a version row. `segments.version` counts them.
- **`inSegment(db, profile, segment)`** answers for one person now. The spine gets one small node, **In segment** (yes, no, skip).
- **Channel stats.** One view, `profile_steps`, holds each person's funnel steps per channel and source: reached, saw, engaged, replied, booked, paid, plus cost. `channelStats` counts people per channel, per source, or per trait value. It filters by any segment or rule and compares channels side by side. `channelPeople` lists the people behind any number.
- **Portal.** People → Channels is the stats page; each number opens its people and can become a segment. People → Segments gains the new conditions and a text view.
- **CLI.** `wren segments list|show|check|count|save|members|history|in` and `wren channels`.

## The rule, extended

| Condition | New fields | Means |
|---|---|---|
| event | `channel`, `atMost`, `match`, `after`, `before` | a timeline kind on one channel, between N and M times, in D days, whose line matches text, after or before the person's first anchor line |
| message | `atMost`, `campaign` | a sent-log state, at most N, in one campaign |
| step (new) | `step`, `channel`, `source`, `days` | a funnel step from `profile_steps` |
| trait | op `one_of` | value is one of a comma list |

- `atLeast` may be 0 when `atMost` is set: "at most 0" is never.
- An anchor is `{event, channel?}`. With `after`, only lines after the person's first anchor line count; with `before`, only lines before it. With no anchor line, nothing counts for `after`, and every line counts for `before`. Either way, "opened before booking" holds for people who opened and never booked.

## Text form

```
all(
  trait stage is "cold",
  trait persona is "agency owner",
  step saw on reddit in 30d,
  not message opened on email
)
```

- Groups are `all(...)` and `any(...)`. `not` goes before any item.
- `trait <key> is|contains|one_of|>|<|exists|before|after|in_next|in_last [value]`
- `event <kind> [on <channel>] [matching "<text>"] [>= N | <= N | N..M] [in Dd] [after <kind> [on <ch>]] [before <kind> [on <ch>]]`
- `message <state> [on <channel>] [campaign "<text>"] [count] [in Dd]`
- `step <reached|saw|engaged|replied|booked|paid> [on <channel>] [source "<text>"] [in Dd]`
- `consent <email|sms> <state>` and `segment <id>` or `segment "<name>"`.
- `ruleText(rule)` prints it and `parseRule(text)` reads it back. Both round trip in tests.

## profile_steps (view)

One row per person, channel, source and step: `profile_id`, `channel`, `source_kind`, `source`, `step`, `at`, `ref`, `cost_usd`, `sends`.

| From | Channel | Steps |
|---|---|---|
| `sent_records` + `profile_keys` | email, sms, newsletter, linkedin, x, reddit, ... | reached (sent, not bounced or failed); saw (opened or past); engaged (clicked); replied. Sends and SMS `cost_usd` ride on reached |
| `touches`, ours | platform | reached; their response: accepted or liked = engaged, replied = replied |
| `touches`, theirs | platform | reached, saw, engaged; a reply or DM also replied |
| `site_forms` (Wren's), by email or visitor | the `/go/` source (youtube, linkedin, ...), else referral with a referrer, else site | reached, saw, engaged, replied (a form is a hand raised) |
| trait `source` naming a channel | that channel (referral) | reached at the trait's time |
| timeline `booking` (not cancelled), `payment` | none | booked, paid: attributed at query time |

What a channel can't prove shows as a dash, not a zero. Texts and DMs have no open, so "saw" is unknown there.

## channelStats

`channelStats(db, {by, channel?, days?, segment?, rule?, attribution?, now})`:

- `by`: `channel`, `source` (campaign, post, thread, video, link), or `trait:<key>` (persona, stage, any trait).
- Cohort: people whose first reach on the row's channel (or source) falls in the window. Later steps count from that reach to now.
- Booked and paid by `attribution`:
  - `any` (default): booked after their first reach there.
  - `first`: that was their first reach anywhere.
  - `last`: it was their last reach before the booking.
- Each row has people per step, `sends`, `cost_usd`, the rates between steps, and `proves` (the steps it can show).
- `views` per channel, people unknown: post views from `content_metrics`, and `/go/` visitors from `link_days`. Shown as their own columns, never as a click-through.
- `channelPeople` takes the same filters plus a row key and a step, and returns up to 500 people with name, link and time.

## Spine hook

`logic.segment` (In segment): settings `segment`; ports yes, no, skip. The step finds the person from the subject: `profile:<id>`, an email enrollment (`<kind>:email:<id>`), a text contact (`<kind>:sms:<id>`), else `data.email` or `data.phone`. No person means skip. A live segment is checked now, by its rule; a manual or snapshot one by its members. A dry run says what it would check and goes yes.

## Open calls I made

- Funnels are cohorts by first reach, so a channel's rates read "of those reached in the window". Totals by event day can come later.
- Bookings and payments carry no channel, so they are attributed at read time. `any` is the default because cold email and content often reach the same person.
- No new table for stats. The view reads the sources live, like the timeline does. At prod size (about 1.4k sent rows, 53 touches) it reads in well under a second. A rollup table comes when it doesn't.
- Site visits per person stay with the lander (the 09-29 rule). A person's visit counts only through a form.
- Ad spend stays in Marketing. People can't be tied to a Meta ad yet, so it isn't a channel row here.
- Traits like stage, persona and warmth come from wa-sf5 (the people rollup). They're read by key, so nothing here waits on it.

## Decision log

- 2026-10-15: extend B5 in place, per the coordinator. No second segment system.

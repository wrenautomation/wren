# Booked call: pre-call brief and call outcome (2026-10-07)

The `close` block (designs/2026-10-05-workflows.md) gets its two missing parts. Before each booked call the rep gets a one-screen brief where every fact names its source and date. After the call the rep marks how it went, and the outcome moves the lead along the spine. Nothing new is sent to a lead.

## What

- The brief covers who they are and their company, how they came in, the thread, dossier facts and recent posts, signals, and open questions. It is built when the call is booked and rebuilt and pinged to the team before the call. It shows on the call's page.
- The rep marks the call: Won, Not yet (with a reason), No-show, or Not a fit.
  - Won queues client onboarding.
  - Not yet goes back to keep warm after 30 days.
  - No-show is recorded only, since no rebook path exists yet.
- Both live in the client's own database. `{}` is valid settings for each part. A client gets a Calls app once the outcome part is installed.

## Data

- One call table for every source: `call_bookings` holds cal.com bookings (Wren's and each client's) and our own calendar's (mirrored as `wren-<id>`).
- `call_bookings` gets four columns: `outcome` (won, not_yet, no_show, not_fit, with a check), `outcome_reason`, `outcome_at` and `outcome_by`.
- New table `call_briefs`: one row per call (unique FK, which doubles as the FK index).
  - `brief` jsonb holds the brief.
  - `built_at`, `start` (the call time it was built for), `sent_at` and `model` (null when code alone wrote it).
- `calendar.bookings.showed` is dropped. Held and no-show become the outcome on the mirror row. The `calendar.booking_records` view reads it from there, and a calendar call and a cal.com call share one outcome.

## One vocabulary

`@wren/core/calls` holds every call outcome and its label:

- **Dials** (speed to lead's `speed_runs.call_outcome`): reached, voicemail, no answer, wrong number.
- **Meetings** (`call_bookings.outcome`): won, not yet, no-show, not a fit.

Speed to lead imports its list and labels from there. The values don't change, so neither does its check.

## Brief

Code builds it from what the database already holds. Each item carries `source` (a link or a named place such as "Booking form" or "Email reply") and `at` (a date). An item with no date is dropped.

| Part | From |
|---|---|
| Who | the booking's name and email; person and company through the matched enrollment, else the SMS contact with that email |
| How they came in | channel and campaign; first touch (the first email sent, or the first text); the booking's source and form answers for our calendar |
| Thread | the last 3 inbound replies, email and text, cut to 280 characters |
| Dossier | `dossierBrief`: the top 6 facts and `recentPosts` |
| Signals | `research_signals` for the company or person, last 90 days, newest 5 |
| Open questions | code first (gaps: no company, no reply, unknown size or stack); then at most 3 from the model |

- **Model.** One call per build through the worker's `llm` (`WREN_LLM=gateway` on prod, the free path), with 300 tokens at most. It sees only the facts above.
- **Checks.** Code keeps a line only if it:
  - ends in "?"
  - is under 160 characters
  - has no link
  - has no number missing from the facts
  - repeats nothing

  It keeps 3 at most. A failed or empty answer means code questions only.
- **When.**
  - **On booking.** A booking emits `close` from `in.calls`. That comes from `CallBookings.ingest`/`ingestFor` and from `Calendar.book`/`reschedule`. The subject is `call:<id>:<start>`, so a moved call is a new arrival.
  - **Spine step.** `calls.brief` builds and stores the brief. It then sends `CallBriefs/send` delayed to `leadMinutes` before the start (60 by default).
  - **Send.** If the call is still booked at that time, it rebuilds and pings the team.
- **Ping.** It goes to the email Discord lane (the existing internal channel), named for the client. It carries counts and a portal link, and none of the lead's words.
- **Page.**
  - A record shows its stored brief.
  - A call with none yet shows one built live by code, unsaved.
  - Rebuild (team, act) builds and saves.

## Outcome

- Actions on the call's page and list:
  - Won
  - Not yet (asks a reason, with suggestions from settings)
  - No-show
  - Not a fit
  - Clear
- Who and when are kept, and the audit log names the person.
- One `setCallOutcome` in `atomic` writes it, then emits on the spine with the call's subject:
  - **Won:** `close` from `outcome.won`, and `onboarding` from `in.clients`. The contract node has no step, so the client waits there and nothing sends.
  - **Not yet:** `close` from `outcome.later`. The wire waits 30 days, then `keep_warm` holds the lead. Its parts are planned and send nothing.
  - **No-show:** the row only.
- Changing an outcome writes the row again. The spine keeps one arrival per port and subject, so a repeat emits nothing new.
- Handlers:
  - `EmailConsole.callOutcome {ids, outcome, reason?}`, for Wren or a client with `calls.outcome`.
  - `EmailConsole.callBrief {id}`, the rebuild.
  - `CalendarConsole.outcome` maps calendar ids to their mirror rows.

## UI

The call page leads with the brief:

1. **Who.** Who, company and the call time, biggest.
2. **Outcome.** The four buttons, before anything else to read. When set, it shows the outcome, reason and who.
3. **Brief.** How they came in, open questions, thread, dossier facts, posts, signals. Each line ends with its source and date, in quiet type.

The same component is used on Inbox > Calls, Calendar > Calls and the Schedule's side panel, and on a client's Calls app.

## Settings

- `calls.brief`:
  - `leadMinutes` (60)
  - `questions` (true; false is code only)
  - `ping` (true)
- `calls.outcome`:
  - `reasons` (Timing, Budget, Needs a partner's yes, Wants proof)

`{}` is valid for both.

## Shop

- `calls.brief` and `calls.outcome` move to their package and are Ready.
- `close` stays "Parts in development" because `keep_warm` uses follow-up and nurture, which are planned.

## Decision log

- 2026-10-07: One call table (`call_bookings`) rather than outcome columns on each source. The calendar's `showed` folds into it.
- 2026-10-07: One vocabulary module for dial and meeting outcomes. Two lists by kind, not one mixed check.
- 2026-10-07: Brief stored per call and rebuilt before the call, so facts are fresh and the page loads fast.
- 2026-10-07: The ping carries a link, not content, to keep the notifier's counts-only rule.
- 2026-10-07: Code checks the model's questions; no fact comes from the model.
- 2026-10-07: Won queues onboarding and never sends; no-show has no rebook path yet.
- 2026-10-07 (built): A dated finding shows once, under Signals, in the dossier's words. A post shows under Recent posts. Facts read as words, never raw JSON.
- 2026-10-07 (built): Rebuild is on Inbox and client Calls pages. Calendar pages show the brief without it. The reasons list is in settings but not yet offered as picks in the Not yet box.
- 2026-10-10 (built): "On the site" on Wren's own briefs. The lander export takes `visitor=`; `calls/site.ts` finds the visitors who applied with the booking's email, then lists the pages they saw most and their newest recorded sessions. Only the lines are kept, never a visitor id. A client's calls have no lander, so none.

## Open (William's call)

- **No-show rebook.** A text or email offering a new time. It sends to a lead, so it waits on William.
- **Client reps' ping.** A client's rep sees the brief in their Calls app, but the ping goes to Wren's lane. Mailing it to the rep is William's call.
- **Lead time.** 60 minutes by default; settable per client.
- **Not-yet reasons.** The default list.

---
type: object
cluster: email
universe: live
status: verified
verified: 2026-10-16 @ d046f3c9
entity: packages/channel-email/src/schema.ts:593
---

# call-recording

A call William recorded with OBS on his Mac: the video in the files bucket, its words, and the model's notes. Table `call_recordings`; console record `calendar.recording` (Calendar > Recordings).

## Why this shape

Meet recording needs paid Workspace, so the desk on the Mac records instead (designs/2026-10-16-call-recording.md). The Mac does the heavy work (720p encode, whisper.cpp) so the worker only signs a read. `file_key` is unique: a retried `wren calls add` lands on the same row. The booking link is nullable because Record now covers calls nobody booked.

## Shape

- `call_booking_id` (nullable, cascade), `file_key` (unique, `calls/<day>/<name>.mp4`), `bytes`, `duration_s`, `started_at`, `ended_at`, `transcript`, `segments` (timed lines), `notes` (`CALL_NOTES`: summary, needs, objections, next), `model`, `by` (desk | manual) (`schema.ts:593`)
- in: `wren calls add <file>` (`apps/cli/src/calls.ts`): encode, transcribe, `writeNotes`, `putLocalFile`, `saveRecording` (`calls/recording.ts:175`), which also writes the person's timeline line (`recordingLine`, `calls/recording.ts:149`)
- out: `wren calls upcoming` (`upcomingCalls`, `calls/recording.ts:32`): what the desk arms for; `recordingOf` puts it on the call's brief (`calls/brief.ts`)
- Record now / Stop: `CalendarConsole.recorder|record|stopRecording` (`packages/calendar/src/console.ts:319`) ask autobrowse's `calls` service through `askRecorder` (`packages/calendar/src/recorder.ts:41`), cancelled past `RECORDER_WAIT_MS`

Citations: `packages/channel-email/src/schema.ts:593`, `packages/channel-email/src/calls/recording.ts:175`, `packages/calendar/src/records.ts:112`

## Connected to

- **owned-by:** [[email/call-booking]]
- **joins:** [[leads/profile]] (timeline line, source `call_recordings`)
- **joins:** [[email/call-brief]] (the brief shows the notes)
- **looks-like-but-is-not:** [[voice/call]] (the phone agent's calls); studio videos from `wren video watch` (other OBS files)

## If you change this

- **Hits:** autobrowse `src/calls/` (parses `wren calls upcoming` JSON and runs `calls add`); worker IAM `CallRecordings` in `deploy/terraform/files.tf` (signs `calls/*`); `apps/portal/web/src/modules/calendar/recorder.tsx`
- **Does not hit:** client calendars (Wren's own calls only)

## Surfaces

| Surface | Role |
|---|---|
| Calendar > Recordings, Inbox > Calls brief | reads |
| Calendar > Calls, Inbox > Calls head | Record now, Stop recording |
| the Mac's desk | writes, through `wren calls add` |

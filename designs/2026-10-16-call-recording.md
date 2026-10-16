# Call recording

2026-10-16. Bead wa-1at: "Record every booked call: OBS on the Mac, transcript on the person."

Calls aren't recorded. Cal.com and our calendar book Google Meet, and Meet's own recording needs
a paid Workspace tier. OBS 32 is on William's Mac, and the desk (autobrowse) already runs there.

## Decisions

- **OBS records, driven by obs-websocket.** It ships inside OBS 28+. The desk talks to it with
  `obs-websocket-js` (the vetted client). No clicks, keys or dialogs on his Mac. `autobrowse calls
  setup` turns the server on by writing OBS's own `plugin_config/obs-websocket/config.json`
  while OBS is closed. Its password is made there, kept as credential `obs` in autobrowse's
  store, and never printed.
- **Its own scene, put back after.** The desk builds a scene `Wren call` over the websocket:
  the main display (`screen_capture`, type display) and system audio (`sck_audio_capture`). The
  mic is OBS's global Mic/Aux. A recording saves the program scene and the mic and audio mutes,
  switches to `Wren call`, unmutes, records, then puts all three back. The record path is never
  touched, so his profile stays as it is.
- **The file moves out at once.** OBS writes into its usual folder; on stop the desk moves the
  file to `~/Movies/Wren calls/`. `wren video watch` only takes files quiet for 60 s, so a call
  never becomes a video.
- **When it records.** The desk reads `wren calls upcoming` every 5 minutes (cal.com's and our
  calendar's calls, one table: `call_bookings`). From 5 minutes before a call to its end, it
  checks the screen every 15 s for a call window: a Meet tab, a Zoom meeting or a Teams call,
  by window title (CoreGraphics' window list through `osascript`, read only). Seen: record.
- **When it stops.** No call window for 3 minutes, or 30 minutes past the booked end, or OBS
  stopped by hand. A manual recording stops on Stop, on 3 minutes without a call window once
  one was seen, or after 3 hours.
- **Manual.** `autobrowse calls start|stop|status`, and Record now / Stop on Calendar > Calls
  and Inbox > Calls (`CalendarConsole.record|stopRecording|recorder` → the desk's `calls`
  service). A start the Mac doesn't take within 10 s is cancelled, so it never starts late.
- **State on disk.** The recording in progress is a file
  (`~/.config/autobrowse/call-recording.json`). The desk restarts on every autobrowse commit; a
  restart mid-call picks the recording back up.
- **One line to William at start.** A macOS banner: "Recording this call. Tell them it's
  recorded."
- **After the call: `wren calls add <file>` on the Mac.** It runs where whisper.cpp does. One
  per file, from a queue on disk, 3 tries, then a notice. It:
  1. makes a 720p mp4 (VideoToolbox, about 300 MB an hour) and a 16 kHz wav;
  2. transcribes with studio's `transcribe` (whisper.cpp large-v3-turbo, VAD), no WhisperX
     pass: a transcript needs words, not frame times;
  3. uploads the mp4 to the files bucket under `calls/` (private, encrypted, streamed);
  4. writes notes through the LLM seam (`WREN_LLM`, prod's gateway): a summary, what they
     said they need, objections, next steps. Code checks the shape; a failed parse keeps the
     transcript and leaves notes empty;
  5. saves a `call_recordings` row and the person's timeline line, then deletes both local
     files.
- **Matching a person.** A booked recording carries its `call_bookings` id. A manual one takes
  the Wren booking whose start is within 15 minutes before to 60 after the recording's start;
  none, and it stays unlinked (listed under Calendar > Recordings).
- **Data.** Table `call_recordings` (main and every workspace by migration; only main is
  written): booking id (nullable FK, cascade), `file_key`, `bytes`, `duration_s`, `started_at`,
  `ended_at`, `transcript` (text), `segments` (jsonb, timed lines), `notes` (jsonb), `model`,
  `by` (`desk` or `manual`).
- **Timeline.** One `profile_events` line per recording (source `call_recordings`, kind `call`,
  channel `calendar`), written by `wren calls add` through `noteElsewhere`. Not a new branch in
  `profile_timeline`: views hang off it (channel stats), and a recording is written once, by one
  writer, like a pay link.
- **Portal.** Calendar > Recordings lists every recording; its page plays the mp4 (a GET signed
  for 10 minutes), shows the notes and the transcript. A booked call's page (Inbox > Calls,
  Calendar > Calls, the Schedule's panel) shows the notes and links to it.
- **Storage.** The wren files bucket, not autobrowse's shots bucket: the portal signs it. The
  worker's role gets `s3:GetObject` on `calls/*`. Kept for good.
- **Consent.** The lander's booking page and its confirmation, our calendar's booked and moved
  mails (Wren's calendar only; a client's never says it), and the cal.com event's description
  say calls are recorded.
- **One audio track.** OBS's simple output mixes mic and system audio. The notes model reads
  who said what from the words. Two tracks (mic apart) would need Advanced output on his
  profile; later, if the notes get speakers wrong.

## Not built

- Client calls. Only William's Mac records, so only Wren's calls.
- Speaker labels (see above).
- Recording phone calls (the voice agent keeps its own turns).

## One-time steps

- OBS must be closed when `autobrowse calls setup` runs (it reads the websocket config at
  start). After that the desk opens it when a call starts (`open -g -a OBS`, minimised to the
  menu bar).
- OBS needs macOS Screen Recording (it already has it for videos).

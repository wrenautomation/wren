# Video editor: Claude Code cuts, Wren shows and uploads (2026-10-06)

William, 10-06 (relayed by the keycycle/sops session): a Claude Code-powered video editor in
JS/Remotion, so he doesn't pay for Descript. First use: his YouTube videos, face cam plus a Google
Doc read-along, about 8 minutes each. Basics only: cut silences and filler words from the
transcript, auto captions, a face cam corner layout, Shorts and Reels cut from the long video, a
thumbnail, 1080p export, upload to Wren's YouTube with his yes. Input: separate screen and camera
tracks from Cap's studio mode or OBS.

Status: proposal. Nothing is built until he agrees.

## Answer first

- **Claude Code is the editor.** It reads the transcript and writes the edit: cuts, retakes,
  captions, Shorts picks, title, description, thumbnail text. He says what to change in plain
  words, in his terminal, like the email templates.
- **Everything runs on his Mac.** The raw tracks are there, and so are Claude Code, a GPU for
  Whisper, and the desk that already uploads to YouTube.
- **Engine: ffmpeg cuts, Remotion draws.** ffmpeg cuts both tracks to 1080p in about a minute.
  Remotion lays out the cut tracks with captions, the corner cam, Shorts and the thumbnail, and its
  Studio previews every change live in the browser.
- **Home: a new package, `packages/studio`, in wren.** It doesn't go in `packages/video`, because
  the reactivation worker imports that, and Remotion must stay out of anything the worker bundles.
- **UI: Marketing → Videos.** Watch the preview, read the transcript with cuts struck through, pick
  a thumbnail, Approve. Approve uploads through the existing YouTube path, private by default.
- **$0.** whisper.cpp runs locally. Remotion is free while Wren has 3 people or fewer. Claude Code
  runs on his plan.

## Flow

```
Cap studio project (screen, camera, mic as separate files)
  │ wren video add <dir> [--script <google doc url>]
  v
ingest: probe tracks, audio → whisper.cpp (Metal) → words with timestamps
  │
  v
Claude Code (his terminal) ── wren video show / wren video set ──> the edit (video_edits row)
  │   cuts, retakes, layout per range, captions, shorts, title, description, thumbnail text
  v
wren video cut      ffmpeg: apply cuts to both tracks → two synced 1080p files (VideoToolbox)
wren video studio   Remotion Studio on localhost: scrub the result while talking to Claude
wren video render   Remotion: long 16:9, Shorts 9:16, 3 thumbnail stills → out/
  │ preview + stills → S3 (private), row updated
  v
Marketing → Videos ── Approve ──> content draft (media.kind video, source = the file on the Mac)
                                   → YouTube upload on the desk (private) → he publishes or schedules
```

## Parts

**Transcript (free first).**
- whisper.cpp (`brew install whisper-cpp`), the large-v3-turbo model (1.6 GB file), on the M2
  Pro's GPU. It outputs word timestamps as JSON. An 8 minute video should take about a minute;
  we'll measure it on the first video.
- Whisper drops most "um"s and "uh"s. The cut rule doesn't need them: any gap between words over
  0.4 s shrinks to 0.15 s. A dropped filler sits in such a gap, so it is cut with the silence.
  Fillers Whisper does write ("like", "you know") are cut when Claude judges them fillers.
- If too many fillers still get through: CrisperWhisper (free, local, verbatim) writes every
  filler with its timestamp. A paid fallback is OpenAI's API at $0.006 a minute (about $0.05 a
  video). Not used.
- With `--script`, the Google Doc is read too. Captions take the script's spelling (names,
  jargon). Claude lines the transcript up with the script to find retakes: a line read twice keeps
  the last take.

**The edit.** One row per video, `video_edits`: tracks (paths, sync offset), words (read only),
cuts (`from`, `to`, why: silence, filler, retake, manual), layout per range (corner, cam only,
screen only), captions (on, style), shorts (`from`, `to`, title), title, description, chapters,
tags, thumbnail (frame, text), state (added, edited, rendered, approved, uploaded) and the S3 keys.
`wren video show <id>` prints the edit as JSON; `wren video set <id>` writes it, checked, and
records a `runs` row, as `wren drafts set` does. Claude Code works through these two commands.

**Cut pass (ffmpeg).** It trims both tracks by the cut list, adds a 10 ms audio fade at each cut so
there are no clicks, scales to 1080p and encodes with VideoToolbox. Two synced files go out.
Changing cuts reruns it in about a minute; nothing else does. Remotion's timeline then stays one
straight run per track instead of hundreds of pieces.

**Composition (Remotion).** React compositions:
- `Long`: 16:9 1080p30, the screen full, the cam in a rounded corner, switching per layout range.
- `Short`: 9:16 1080×1920, cam on top and screen below, or cam only, with bigger captions.
- `Thumbnail`: a still, his face from the chosen frame plus the title text, three variants.
- Captions: word by word from the transcript, the spoken word highlighted, in Wren's look
  (`DEFAULT_LOOK` from `@wren/video`).

Studio previews every layout, caption or Shorts change without a render. The final 8 minute render
should take 5 to 15 minutes on the M2 Pro (an estimate; measured on the first video).

**Shorts and Reels.** Claude picks 2 to 4 clips of 20 to 60 s from the transcript: a strong first
line, makes sense alone. Each clip is a row in `shorts`, rendered as a vertical file. A vertical
video of 3 minutes or less uploads to YouTube as a Short. Reels: the file is made; posting to
Instagram waits until the IG channel posts video.

**Upload.** Approve on Videos (or `wren video approve <id> [--short n]`) writes a content draft with
`media.kind = video` and `source` = the rendered file's path on the Mac. The existing path does
the rest: channel-youtube → autobrowse `POST /upload/youtube/v3/videos` (private unless set),
then `thumbnails/set`. Custom thumbnails need Wren's channel phone-verified; I check once before
building. One fix in the upload: it reads the whole file into memory, so it should stream from
disk.

## Where it shows

Marketing → **Videos**. A row per video: title, raw and cut length, state, Shorts count. Detail:
the preview player (a presigned S3 link), the transcript with cut words struck through, Shorts,
the three thumbnails, title and description. Actions: Approve (long or one Short), pick a
thumbnail. A video waiting on his Approve also shows in the Inbox's "Waiting on you".

v1 edits happen in Claude Code. Later, Ask Claude from the page (the DraftAsk pattern) can rewrite
the edit, plus a render job on the desk so the page can render without the terminal.

## Remotion vs our ffmpeg timeline

| | ffmpeg only (extend `packages/video`) | ffmpeg cuts + Remotion draws (proposed) |
|---|---|---|
| Captions | This Mac's ffmpeg has no text filters (no libass, no drawtext). Caption images would come from Chrome anyway, one overlay per caption page | CSS. Word highlight is a few lines |
| Preview | Render a low-res file per change (about a minute) | Studio, live, while he talks to Claude |
| Render time | Fastest, a few minutes | 5-15 min for 8 min (estimate) |
| New deps | None | `remotion`, `@remotion/cli`, `@remotion/renderer`; Chrome Headless Shell on first render |
| License | Free | Free for individuals and companies of 3 or fewer. 4+ people: $25 a seat a month. Used inside a product for clients: $0.01 a render, $100 a month minimum |
| Thumbnails, title cards, motion later | Hand-built filter graphs | React components Claude writes well |

Remotion fits the visual parts and ffmpeg fits the heavy media work, so each does its own job. The
cost to watch: if the editor becomes something clients use, Remotion's company license is at least
$100 a month. ffmpeg alone has no such cost.

## Own repo or package

`packages/studio` in wren. It reuses the DB, runs, content drafts, the YouTube path, S3 publish and
the look, so no new seam. It moves to its own repo when someone other than Wren uses it, as
credvault did. Only the CLI imports it; the worker never does.

## Input

Cap studio mode (free) saves screen, camera and mic as separate files in a `.cap` project, on one
clock, so no sync is needed. `wren video add` reads that folder. OBS works when it records separate
files (Source Record plugin). Their start times can differ, so the sync offset comes from matching
the two audio tracks. That is built only if he records with OBS.

## Cost

| Item | $ |
|---|---|
| whisper.cpp + model, local | $0 |
| ffmpeg, VideoToolbox | $0 |
| Remotion while Wren is 3 people or fewer | $0 |
| Claude Code (his plan) | $0 |
| YouTube upload + thumbnail | $0 (free API quota) |
| S3 previews: ~400 MB a video with Shorts, at $0.023/GB-month | about $0.01 a month a video |

Disk on the Mac: Cap's raw tracks are a few GB per video; the cut files about 0.5 GB. Nothing is
deleted.

## Build order (after he agrees)

1. `video_edits`, `wren video add|show|set`, whisper.cpp ingest, cut pass, the `Long` composition
   with corner cam and captions, Studio. This step replaces Descript for the long video.
2. Shorts, thumbnails, `render`, S3 previews.
3. Marketing → Videos, Approve → YouTube, upload streams from disk.

## For William

1. Agree or change: ffmpeg cuts + Remotion draws, in `packages/studio`.
2. Cap studio mode or OBS for recording? Cap needs no sync work.
3. Captions on the long video too, or only on Shorts?

## Decision log

- 2026-10-06: proposed. Not built.

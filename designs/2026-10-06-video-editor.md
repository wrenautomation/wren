# Video editor: Claude Code cuts, Wren shows and uploads (2026-10-06)

William, 10-06 (relayed by the keycycle/sops session): a Claude Code-powered video editor in
JS/Remotion, so he doesn't pay for Descript. First use: his YouTube videos, face cam plus a Google
Doc read-along, about 8 minutes each. Basics only: cut silences and filler words from the
transcript, auto captions, a face cam corner layout, Shorts and Reels cut from the long video, a
thumbnail, 1080p export, upload to Wren's YouTube with his yes. Input: separate screen and camera
tracks from Cap's studio mode or OBS.

Status: agreed 10-06 ("Agree, captions on all, I'll do OBS"). Building in the order below. His
10-06 asks on top: cuts must be consistent and never cut what he said; a Gemini option like the SOP
video reader has; TwelveLabs as a second option.

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
OBS recording (one file, or screen + camera via Source Record)
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

**Cuts he can trust.** His worry: an automatic pass cuts things it shouldn't. So:
- Silence cuts need two signals to agree: no word in the transcript there AND ffmpeg
  `silencedetect` hears silence there (noise floor measured from the track, not fixed). A transcript
  gap alone never cuts; Whisper's word times drift by a few hundred ms.
- Only gaps of 0.7 s or more are cut, and 0.2 s of air stays on each side. A cut never lands
  inside a word; each edge snaps to the quietest 20 ms in its window.
- Fillers and retakes are proposals, not cuts: they show struck through in yellow, and apply only
  when he or Claude (with him) accepts them. Silence cuts apply by default.
- Same tracks + same settings = the same cut list. No model in the silence pass, so reruns match.
- `wren video cuts <id>` prints every cut with the words either side, its reason and length. Any cut
  over 2 s, or one touching a word, is flagged for a look. `wren video keep <id> <n>` undoes one.
- Knobs in settings (`studio.cuts`): min gap, air kept, noise margin. Defaults above; the first
  videos tune them.

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

## Looking at the picture: Gemini or TwelveLabs (option)

Claude Code reads only the transcript by default ($0). For picks that need the picture (thumbnail
frames, Shorts that work visually, chapters at screen changes), `wren video look <id> --with
gemini|twelvelabs` adds a pass. Both write the same shape onto the edit: `looks` = moments
(`at`, `why`), Shorts ideas, chapter marks, thumbnail frames, a one-line summary. Claude Code
reads them like the transcript; nothing applies them without the edit being set.
- **Gemini:** the cut file at 360p goes to Gemini's Files API with the same fleet keys and model
  order the SOP video reader uses (`fleetKeys(process.env, "gemini")`, rotate on 429). Free tier.
- **TwelveLabs:** one index (`wren-videos`, Pegasus + Marengo). The cut file uploads once; Pegasus
  answers the same ask, and `wren video find <id> "<words>"` searches it ("where I show the
  dashboard"). Free plan: 600 minutes of video in total, index kept 90 days, so about 75 eight
  minute videos. Key `TWELVELABS_API_KEY` on the Mac only. Past the free 600 minutes it costs
  $0.042 a minute to index; that is William's call, so the CLI stops at the cap.

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

## Input: OBS

He records with OBS. Two shapes, both read by `wren video add`:
- **Two files** (screen and camera, via OBS's free Source Record plugin): their start times can
  differ, so the sync offset comes from cross-correlating the two audio tracks (ffmpeg pulls 16 kHz
  mono, a few lines of math). Corner cam and Shorts layouts need this shape.
- **One file** (OBS's own scene, cam already placed): no sync. The long video keeps OBS's layout;
  Shorts crop the cam box (`--cam x,y,w,h`, once per scene) to put the cam on top.

Setup note for him (in `wren video add --help`): OBS → Tools → Source Record on the camera source,
same folder as the main recording.

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

Answered 10-06: agreed; OBS; captions on the long video and Shorts.

## Decision log

- 2026-10-06: proposed. Not built.
- 2026-10-06: William agreed: OBS, captions on all. Added: cuts need transcript and audio to agree,
  fillers and retakes are proposals, `cuts`/`keep` review; Gemini and TwelveLabs as look options.
- 2026-10-06: step 1 built (`packages/studio`, `video_edits` 0122), with cuts and both looks. The
  per-lead demo commands moved to `wren video demo try|render|show`, freeing `wren video show` for
  the editor. Knobs in `wren_settings` `studio.cuts` (`wren video knobs`). whisper runs with Silero
  VAD, and a word edge that falls inside a detected silence moves to its edge (`fitWords`): whisper
  smears the word next to a long pause across it, which hid every gap on the first smoke. The noise
  floor uses 20 ms frame peaks, not RMS, since silencedetect tests samples. TwelveLabs: one index
  `wren-videos` holds Marengo only (the API allows no Pegasus in an index); Pegasus 1.6 reads the
  uploaded asset. No usage endpoint, so the 600 free minutes are counted from our looks (indexing
  and analysis each count the cut's minutes); a re-look of the same cut reuses the index.
- 2026-10-06: step 2 built: `Short`, `Thumbnail` (3 variants), `wren video render`, previews. Shorts
  are checked on their cut length (none, or 2 to 4 of 20 to 60 s). Previews (540p) and stills go
  to the private media bucket through `uploadMedia`, as `s3://` URIs in `keys`. A render bundles
  once and links the edit folder in as `public`: Remotion copies the public dir into every bundle,
  and its server refuses a linked file but serves a linked folder. Smoke on a 118 s synthetic
  clip (106 s cut), with the Mac at load 15-20 from other sessions: Long 234 s, a 27 s Short
  66 s, a thumbnail about 1.5 s, all on VideoToolbox. Real timing waits for his first video.
- 2026-10-06: step 3 built. Marketing → Videos (`marketing.video`); a rendered video is also
  `video:<id>` in the Inbox's "Waiting on you". Approve (`wren video approve <id> [--short n]` or the
  page) writes one YouTube draft per video or Short, approved with no slot, private, with the file's
  path on the Mac; a second Approve answers the same draft. The worker's media host leaves a path it
  doesn't have as a path, so the desk reads it from disk. The picked thumbnail goes up after the
  video; a refused one doesn't fail the post. Chapters are not written into the description yet.
  The autobrowse upload streams from disk with one attempt and a 2 hour PUT timeout (autobrowse
  cd3db46). Checked: Wren's channel is not phone-verified
  (`longUploadsStatus: eligible`), so custom thumbnails are refused until he verifies it.

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

v1 edits happened in Claude Code only; step 4 brings editing, Ask, render and ingest to the page.

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
4. Editing from the page, no terminal (William 10-06: "human intervention editing and claude code
   guided by human editing [should] be first class"; he felt features were missing):
   - In place: title, description, tags, chapters, Shorts titles, thumbnail text, through
     `setEdit` (checked by `editPatchSchema`, a `runs` row per change), like draft edits.
   - Cuts on the page: each proposed cut with the words it strikes, Keep or Cut (`keepCut`), and
     a manual cut by selecting words in the transcript.
   - Ask Claude on a video, the DraftAsk pattern: the question and the edit go to the desk's
     `claude` service; it answers with a patch, which wren checks and applies. Claude stays read
     only.
   - Render from the page: a job the Mac runs (`wren video render`), with its state on the row
     (rendering, rendered, failed and why). It waits while the Mac is off.
   - New OBS recordings appear by themselves: the Mac ingests a finished file from OBS's
     recording folder (read from OBS's profile) as an Added video.
5. Formats and captions (William 10-07: "workflows to autodimension for different formats";
   "mostly the captions are more important", he will often make separate Reels). One recording,
   each format it suits, captions right in each:
   - **Orientation kept.** The cut pass scales a landscape track to 1080 high (today) and a
     portrait one to 1080 wide (1080×1920), not 1080 high. Previews already branch on it.
   - **Formats on the edit.** `formats: ("long" | "vertical")[]`, set by `wren video add` from the
     main track: landscape → `["long"]`, portrait → `["vertical"]`; `wren video set` and the page
     change it (a landscape cam take can add `vertical`). `render` renders what it lists, plus
     Shorts and thumbnails as now; `--only vertical` works.
   - **`Vertical` composition**, 1080×1920, the whole cut (not a 20-60 s clip): a portrait source
     fills the frame; a landscape source is cropped to a 9:16 window centred on the face (the
     `camBox`/cam file's centre when known, else the frame's centre; face-follow is later, not
     here). Output `out/vertical.mp4`, 540p preview to S3 like the others.
   - **Captions per format.** The long video keeps its lower-third line. Vertical (and Shorts) get
     the Reels style: 2-4 words a line, big (about 80 px on 1080 wide), bold, white with a dark
     outline, the spoken word highlighted, sitting about 62-70% down, clear of the Reels/Shorts UI
     (bottom 20%, right 15%). Lines break on pauses and punctuation, never mid-phrase, and never
     run past the speech.
   - **Fix a word before render.** Whisper mishears names ("drug fooding" for dogfooding, "Wren").
     `wren video words <id> --fix "<wrong>=<right>"` (every match, case kept) and `--at <s>
     <text>` (one word) rewrite the transcript's text, never its times, as a `runs` row like
     `set`; the page's transcript gets the same edit. An optional `studio.words` list in
     `wren_settings` (`Wren`, `dogfooding`…) goes to Whisper as its prompt on ingest.
   - **Approve a vertical.** `wren video approve <id> --vertical [--privacy]`: one YouTube draft
     (YouTube files a vertical ≤3 min as a Short itself) and an Instagram Reel draft waiting in
     To approve, as Shorts do now. The page gets "Approve vertical".
   - **Loudness** (his first upload, 10-07: video 3 rendered at -27.5 LUFS; YouTube turns loud
     audio down, never quiet audio up). Every rendered video is leveled to -14 LUFS integrated,
     true peak -1.5 dB: two-pass ffmpeg `loudnorm` (measure, then apply with the measured I, TP,
     LRA and threshold), audio only, the video stream copied. No `offset=`: this ffmpeg build
     refuses it.
   - **Footers.** Every upload ends with a footer (after the chapters, a blank line between). Each
     is a `post` template in the store, defaults in `packages/templates/defaults/post/`:
     `post:youtube/footer` under a long video (the site, booking, the other socials, the bio),
     `post:youtube/shorts-footer` under a Short (plain text: links there can't be clicked), and
     `post:instagram/reel-footer` under a Reel's caption ("link in bio"). `{video}` is the
     video's slug (id, then title words), the `utm_campaign` of the lander's `/go/yt/<slug>`, so
     a visit or a booking says which video sent it. Edited with `wren templates get|set` or the
     Library's Templates; a new version waits in To approve.
   - **Render survives an expired AWS session.** Render checks the AWS session before it starts
     and fails fast with "run aws-login". `wren video render <id> --upload` uploads previews from
     the files already in `out/` and marks it rendered, no re-render. A good render whose upload
     fails is "failed" with that hint.
   - Checked: unit tests on the scale filter for both orientations, the caption line breaker
     (pauses, punctuation, 2-4 words, timing), `formats` defaults and `words --fix`, and the
     loudnorm filter strings; a render of a synthetic 10 s portrait clip and a 10 s landscape clip
     to `vertical`, stills looked at; a synthetic clip measures -14 ±1 LUFS after leveling.

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
  video; a refused one doesn't fail the post. Chapters go under the long video's description on
  the cut timeline (`chapterLines`), dropped when YouTube would ignore them (under 3, under 10 s apart).
  The autobrowse upload streams from disk with one attempt and a 2 hour PUT timeout (autobrowse
  cd3db46). Checked: Wren's channel is not phone-verified
  (`longUploadsStatus: eligible`), so custom thumbnails are refused until he verifies it.
- 2026-10-06: William (relayed by a peer session): Cap (desktop 0.6) is allowed as a second recorder
  beside OBS. Its server is not self-hosted; Wren reads only the project folder Cap writes.
- 2026-10-06: step 4 built. The Videos detail edits in place: title, description, tags, chapters
  ("m:ss Title" lines), Shorts titles and thumbnail text save on blur through `VideoDesk.set`
  (`setEdit`, one run each, holding what it replaced). Cuts show the words they strike with Keep
  or Cut; words picked in the transcript become a `manual` cut (`VideoDesk.cut`). Undo puts back
  the newest page change from its `before`. Ask Claude follows DraftAsk: a `video-ask` run, the
  desk's read-only `claude` with the edit and one allowed read (`video show <id>`, since the words
  outgrow the prompt), an answer `{reply, patch}`; Wren merges cut changes by their ends, checks
  the patch with `editPatchSchema` and `checkPatch`, and writes it. Render sets `render` waiting
  and calls the desk's `studio.render` (autobrowse), which runs `wren video render <id> --cut` on
  the Mac; the CLI marks it rendering, then rendered or failed with the last lines of the error.
  The call waits in Restate while the Mac is off; a waiting row refuses a second Render for 3 h.
  Auto-ingest: the desk runs `wren video watch` every minute. OBS's folder comes from its profile
  (simple or advanced output); a file counts once it has been quiet 60 s and no process holds it.
  Cap's `recordings/*.cap` count once `recording-meta.json` says Complete; each segment's screen
  is laid with its mic and the segments joined (ffmpeg concat, video copied), the camera likewise,
  offset by Cap's start times. A seen-file ledger plus a `tracks.main.path` check keep it once per
  recording. Not handled: OBS Source Record's second file is skipped, not paired (`wren video add`
  on the folder pairs it); a Cap project whose segments lack the camera in some loses the camera.
  Checked with synthetic rows and a synthetic Cap project; OBS isn't installed and Cap has no
  recordings yet, so the watcher's first real pickup waits for his first take.
- 2026-10-07: William: "upload should be configurable". Approve takes who sees it: `wren video
  approve <id> --privacy private|unlisted|public` (default private), the same `privacy` on the
  desk's `approveVideo`, and an optional "Who sees it" select on both Approve actions (blank:
  private). First real takes: OBS's noise gate at open -20 / close -30 dB muted 78% of take one
  to digital zero (Whisper got 809 words in 18 min); RNNoise and a -45 / -55 gate fixed take two.
  He wants no inner cuts on these talking takes, only the dead start and end.
- 2026-10-07: Step 5 built. Built: the cut pass keeps orientation (phone rotation read on probe);
  `formats` on the edit (migration 0167 backfills portrait rows to `["vertical"]`); the `Vertical`
  composition; Reels captions on Vertical and Shorts; `wren video words --fix/--at` and the page's
  Fix word and Fix everywhere, undoable; `studio.words` as Whisper's prompt; `approve --vertical`
  and "Approve vertical" (drafts written through `fieldsOf`; YouTube kind `short` at ≤180 s, else
  `video` with the thumbnail; the Reel gets `shareToFeed`). From his first upload: every render
  leveled to -14 LUFS, true peak -1.5; the `youtube.footer` under every description (`wren video
  footer`, a default in code, "" turns it off); render checks the AWS session first, `--upload`
  uploads what `out/` holds, a failed upload after a good render says how. Choices: a
  vertical-only edit's plain Approve (the Inbox's too) approves the vertical; split-layout Shorts
  keep their caption on the face/screen seam, full-frame ones sit at 66%; a fix with a different
  word count merges into one word over the span. loudnorm's dynamic mode (forced by the
  true-peak cap) lands about 1 dB short, so the apply runs once more from the original aimed past
  -14 by the shortfall. Checked: unit tests (scale filter, line breaker, formats, word fixes,
  loudnorm filters); the video integration file (vertical approve, word fix and undo, footer);
  synthetic 10 s portrait and landscape renders to vertical, stills looked at (80 px captions,
  2-4 words, 66% down, clear of the right 15%); three synthetic clips from -39, -30 and -27 LUFS
  measured -14.4 to -14.2 after leveling; fake AWS keys fail the render before it starts.
  Not handled: the line breaker has no grammar, so a noun phrase can still split ("record the
  whole / take"); measured true peak after AAC is about -1.3, a hair over -1.5; the record's list
  state doesn't show a vertical-only upload (it joins on `video:<id>`); the footer has no page
  control; the expired-token path was checked with fake keys, not a real expired session. The
  local Docker database's migrations are out of step from 0138 (not this branch), so the CLI
  checks ran on a throwaway migrated Postgres.
- 2026-10-07: footer = post templates, not a setting. William: website first, then book a call,
  then the other socials. `youtube.footer` in `wren_settings` and `wren video footer` are gone
  (prod had no row); Approve reads `post:youtube/footer`, `post:youtube/shorts-footer` or
  `post:instagram/reel-footer` through `liveOrDefault` and fills `{video}` (`videoSlug`: the id,
  then title words, 40 characters at most). The booking link is
  `/go/yt/<slug>/book?to=/book/reactivation`: the only offer with a booking, on Wren's own
  calendar, whose booking keeps the utm (`schedule.ts` reads it off the address). The YouTube
  channel link is left out: a viewer is already on it. Posts are now editable from the CLI and
  the Library like emails and prompts; a publish waits in To approve. The studio part names the
  three footers in `provides.templates`.

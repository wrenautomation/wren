---
type: object
cluster: content
universe: live
status: verified
verified: 2026-10-07 @ HEAD
entity: packages/studio/src/schema.ts:85
---

# video edit

One of William's OBS or Cap recordings being edited into a YouTube video: a `video_edits` row holding the words, the cuts and the edit. Package `@wren/studio`; the commands are `wren video add|show|set|approve|cuts|keep|knobs|cut|studio|render|look|find|watch`. Marketing → Videos shows it (`marketing.video`) and edits it in place (`VideoDesk`). Shop part `studio` ("Video editor", `packages/content/src/components.ts`) owns `VideoDesk`, the record and the cut knobs.

## Why this shape

The row is the edit; files are outputs beside the recording (`dir`). Every time is on the raw main track, so a cut can be undone without re-transcribing, and the cut timeline is derived (`keepSegments`, `cuts.ts:168`, frame-quantized so audio and video never drift). Silence cuts are deterministic: a cut needs a transcript gap and an ffmpeg silence to agree (`silenceCuts`, `cuts.ts:121`), after `fitWords` (`cuts.ts:88`) pulls whisper's smeared word edges back to the silence. Fillers and retakes are only proposals. Remotion runs as its own CLI from `packages/studio`, never bundled: the worker imports only `@wren/studio/schema`, `/cuts` and `/edit` (writes, no Remotion), and every render runs on the Mac.

## Shape

- Columns: `tracks` (main, optional `cam` with `offsetS` from audio sync `media.ts:162`, `camBox`), `words` [{w,s,e}], `cuts` [{from,to,why,state}], `layout`, `captions`, `shorts`, `chapters`, `tags`, `description`, `thumbnail`, `looks` (by provider), `files` (cutMain, cutCam, then long, short-n, thumb-n in `<dir>/out`), `keys` (`s3://` media-bucket URIs of the 540p previews and stills, same names, plus `reel-<n>`: the full Short for Instagram), `state` (`schema.ts:9`), `render` (a page render on its way: waiting, rendering, failed and why; null when done, `schema.ts:115`)
- Writes: `addVideo` (`edit.ts:93`; a file, an OBS folder or a Cap project), `setEdit` (`edit.ts:232`, zod-checked, then `checkPatch` `edit.ts:197`: Shorts none or 2-4 of 20-60 s once cut; one `runs` row per write holding `before`, or the Ask's own run; `state` is not settable), `setCut` (`edit.ts:282`: a cut by its ends, else a new `manual` cut), `setRender` (`edit.ts:301`), knobs in `wren_settings` `studio.cuts` (`setCutKnobs`, `edit.ts:45`), render files, keys, state `rendered` and `render` cleared (`setRendered`, `edit.ts:319`)
- Recordings: OBS's folder from its profile (`obsRecordingDir`, `obs.ts:32`), a file finished once quiet 60 s and closed (`findRecordings`, `obs.ts:58`, `isOpen`); a Cap project (`<name>.cap`, `recording-meta.json`) once Cap says Complete (`capNotReady`, `cap.ts:57`), its screen and mic laid together per segment and joined, the camera offset by Cap's start times (`capTracks`, `cap.ts:86`). `wren video watch` (`apps/cli/src/studio.ts:362`) adds each once (ledger `~/.cache/wren/recordings-seen.json`, then a `tracks.main.path` check)
- Page edits (`VideoDesk`, `packages/content/src/restate/video-desk.ts:55`): `set` fields, `cut` (Keep or Cut a proposal, or words picked in the transcript), `undo` the newest change from its `before` (`undoVideo`, `video-ask.ts:124`), `ask`: a `video-ask` run, then the desk's read-only `claude` with the edit and one allowed read (`video show <id>`, `videoPrompt` `video-ask.ts:28`); Claude answers `{reply, patch}`, Wren merges cut changes and writes through `setEdit` (`applyAnswer`, `video-ask.ts:87`). `render` sets `render` waiting and calls the desk's `studio.render` (autobrowse `src/studio/service.ts`): `wren video render <id> --cut` on the Mac against prod, which sets rendering, then done or failed with why
- Looks: Gemini through the SOP reader's `askGemini` and fleet keys (`look.ts:105`); TwelveLabs indexes the 360p cut in `wren-videos` (Marengo) and asks Pegasus (`look.ts:214`), stopping before the free 600 minutes, counted from `looks.twelvelabs.media.minutes` (`twelvelabsMinutes`, `edit.ts:316`)
- Compositions `Long` (`packages/studio/remotion/index.tsx:107`), `Short` (`index.tsx:162`: face on top + screen, or face alone; one-file crops `camBox`), `Thumbnail` (`index.tsx:206`: 3 variants in `DEFAULT_LOOK`); props from `longProps` (`props.ts:24`), `shortProps` (`props.ts:101`), `thumbnailProps` (`props.ts:125`)
- Render: `renderAll` (`remotion.ts:87`) bundles once with the edit folder linked as `public` (no copy), h264 on VideoToolbox; 540p previews by `preview` (`media.ts:254`), uploaded by `uploadMedia` from `@wren/content`
- Approve (`approveVideo`, `packages/content/src/video.ts:98`): his yes writes one YouTube draft per video or Short (idea `ref` `video:<id>` / `video:<id>/short:<n>`, so a second Approve answers the same draft), `approved` with no slot, `privacyStatus: private`, media source = the rendered file on the Mac, `extra.thumbnail` = his pick (`pickThumbnail`, `:165`, stored as `files.thumbnailPick`) else the first still, and the long video's description gets its chapters on the cut timeline (`chapterLines`, `:51`; none when YouTube would ignore them). The desk reads the file from its own disk: `s3MediaHost` leaves a path it doesn't have as a path (`packages/content/src/media.ts:60`). After the upload `thumbnails/set` runs; a refusal never fails the post (`packages/channel-youtube/src/content.ts:116`). A Short also gets an Instagram Reel draft on the same idea: media = `keys.reel-<n>` (the full Short, uploaded by `wren video render`, `reelKey`), caption = title plus description, status `draft`, no slot, so it waits in To approve and posts only on his Approve there (`channel-meta` `publish`, `media_type REELS`). No `reel-<n>` (rendered earlier): `reel.missing` says render again; a second Approve adds only a missing Reel draft
- Record `marketing.video` (`videoRecord`, `video.ts:225`): lengths, state (the long draft's published/failed shows as On YouTube/Upload failed), `render`, detail signs `keys` from the media bucket and carries the editable fields, the cuts with their words (`cutRows`, `video.ts:197`) and the page's turns (`videoTurns`, `video-ask.ts:111`); a `rendered` row is also `video:<id>` in `marketing.approval` (Marketing → To approve; `videoRows`, `packages/content/src/social/records.ts:129`)
- Step 2 outputs by name (`numbered`, `longOf`, `video.ts:23`, `:35`): `long`, `short-<n>`, `thumb-<n>`, 1-based

Citations: `packages/studio/src/schema.ts:85`, `packages/db/drizzle/0122_video_edits.sql`, `packages/db/drizzle/0123_video_render.sql`

## Connected to

- **owned-by:** [[ledger/run]] (every add, set, keep, cut, render, look; the page's `video set|keep|cut-words|undo` and `video-ask`)
- **produces:** [[content/draft]] (Approve: platform youtube, private; a Short's Instagram Reel, waiting), [[content/idea]] (`ref` `video:<id>`)
- **joins:** [[platform/settings]] (`wren_settings` component `studio`), [[platform/llm-client]] (Gemini keys from `llm.env`)
- **looks-like-but-is-not:** [[reactivation/demo-video]] (`wren video demo …`, per lead, recorded by a browser); [[content/media]] (files a post carries)

## If you change this

- **Hits:** whisper-cli and its two models in `~/.cache/wren/whisper` (large-v3-turbo, silero VAD); ffmpeg with `h264_videotoolbox` (Mac only); the Remotion entry `packages/studio/remotion/index.tsx` reads `LongProps`, `ShortProps`, `ThumbnailProps`; the media bucket (`WREN_MEDIA_BUCKET`) holds previews and stills; `askGemini` in `packages/research/src/sops/index.ts` is shared with the SOP reader; `TWELVELABS_API_KEY` in `.env`
- **Hits (Approve, record, page):** `ContentDesk.approveVideo/pickThumbnail`, `VideoDesk` and the record in the worker, which import `@wren/studio/schema`, `/cuts` and `/edit` (no Remotion); the Marketing module `apps/portal/web/src/modules/marketing/videos.tsx` and its inline actions (`index.ts`, routed in `apps/portal/web/src/records.tsx`); `@wren/ui`'s `RecordAct` (extras run inline actions); the autobrowse desk reads the file from the Mac's disk, serves `studio.render` and runs `wren video watch` every minute
- **Hits (recorders):** OBS's `user.ini`/`global.ini` and profile `basic.ini`; Cap's `recording-meta.json` (Cap 0.6 `crates/project/src/meta.rs`), read as the format stands; a Cap upgrade that moves fields breaks `capTracks`
- **Does not hit:** Restate state, the Remotion bundle (the worker never imports `@wren/studio`'s index)

## Surfaces

| Surface | Role |
|---|---|
| `wren video add <file\|dir\|name.cap>` | write (ingest) |
| `wren video watch` (desk, every minute) | write (ingest each new finished recording once) |
| `wren video show` / `set` | read / write (Claude Code edits here) |
| `wren video cuts` / `keep` / `knobs` | read / write |
| `wren video cut` / `studio` | write files / read |
| `wren video render [--short n] [--only long\|shorts\|thumbs] [--cut]` | write files, S3 previews, `keys`, state, `render` |
| `VideoDesk.set/cut/undo/ask` (Videos detail) | write the edit, a `runs` row each |
| `VideoDesk.render` (Videos → Render) | write `render`, call the desk's `studio.render` |
| `wren video look --with gemini\|twelvelabs`, `find` | write `looks` / read (TwelveLabs search) |
| `wren video approve <id> [--short n]`, `ContentDesk.approveVideo` (Videos and Inbox Approve) | write a YouTube draft (and a Short's Reel draft, waiting), state → approved |
| `ContentDesk.pickThumbnail` (Videos → Pick thumbnail) | write `files.thumbnailPick` |
| `marketing.video`, `marketing.approval` (`video:<id>`) | read |

## See

- Source: `packages/studio/`, `apps/cli/src/studio.ts`, `packages/content/src/video.ts`, `packages/content/src/video-ask.ts`, `packages/content/src/restate/video-desk.ts`
- Design: `designs/2026-10-06-video-editor.md`

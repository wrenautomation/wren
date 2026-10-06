---
type: object
cluster: content
universe: live
status: verified
verified: 2026-10-06 @ HEAD
entity: packages/studio/src/schema.ts:74
---

# video edit

One of William's OBS recordings being edited into a YouTube video: a `video_edits` row holding the words, the cuts and the edit Claude Code writes. Package `@wren/studio`; the commands are `wren video add|show|set|approve|cuts|keep|knobs|cut|studio|look|find`. Marketing → Videos shows it (`marketing.video`).

## Why this shape

The row is the edit; files are outputs beside the recording (`dir`). Every time is on the raw main track, so a cut can be undone without re-transcribing, and the cut timeline is derived (`keepSegments`, `cuts.ts:168`, frame-quantized so audio and video never drift). Silence cuts are deterministic: a cut needs a transcript gap and an ffmpeg silence to agree (`silenceCuts`, `cuts.ts:121`), after `fitWords` (`cuts.ts:88`) pulls whisper's smeared word edges back to the silence. Fillers and retakes are only proposals. `@wren/studio` is CLI only: Remotion runs as its own CLI from `packages/studio`, never bundled, and the worker never imports it.

## Shape

- Columns: `tracks` (main, optional `cam` with `offsetS` from audio sync `media.ts:162`, `camBox`), `words` [{w,s,e}], `cuts` [{from,to,why,state}], `layout`, `captions`, `shorts`, `chapters`, `tags`, `description`, `thumbnail`, `looks` (by provider), `files` (cutMain, cutCam; step 2 adds renders), `keys` (step 2 S3), `state` (`schema.ts:9`)
- Writes: `addVideo` (`edit.ts:87`), `setEdit` (`edit.ts:204`, zod-checked, one `runs` row per write; `state` is not settable), knobs in `wren_settings` `studio.cuts` (`setCutKnobs`, `edit.ts:39`)
- Looks: Gemini through the SOP reader's `askGemini` and fleet keys (`look.ts:105`); TwelveLabs indexes the 360p cut in `wren-videos` (Marengo) and asks Pegasus (`look.ts:214`), stopping before the free 600 minutes, counted from `looks.twelvelabs.media.minutes` (`twelvelabsMinutes`, `edit.ts:277`)
- Approve (`approveVideo`, `packages/content/src/video.ts:65`): his yes writes one YouTube draft per video or Short (idea `ref` `video:<id>` / `video:<id>/short:<n>`, so a second Approve answers the same draft), `approved` with no slot, `privacyStatus: private`, media source = the rendered file on the Mac, `extra.thumbnail` = his pick (`pickThumbnail`, `:143`, stored as `files.thumbnailPick`) else the first still. The desk reads the file from its own disk: `s3MediaHost` leaves a path it doesn't have as a path (`packages/content/src/media.ts:60`). After the upload `thumbnails/set` runs; a refusal never fails the post (`packages/channel-youtube/src/content.ts:116`)
- Step 2 outputs are read by name, defensively (`numbered`, `longOf`, `video.ts:21`, `:33`): `files.long`/`keys.long` (or `preview`), `short<n>`, `thumb<n>`, any separator, counted from 0 or 1
- Record `marketing.video` (`videoRecord`, `video.ts:180`): lengths, state (the long draft's published/failed shows as On YouTube/Upload failed), detail signs `keys` from the media bucket; a `rendered` row is also `video:<id>` in `marketing.inbox` (`videoRows`, `packages/content/src/social/records.ts:129`)
- Composition `Long` (`packages/studio/remotion/index.tsx:98`), props from `longProps` (`props.ts:34`)

Citations: `packages/studio/src/schema.ts:74`, `packages/db/drizzle/0122_video_edits.sql`

## Connected to

- **owned-by:** [[ledger/run]] (every add, set, keep, cut, look)
- **produces:** [[content/draft]] (Approve: platform youtube, private), [[content/idea]] (`ref` `video:<id>`)
- **joins:** [[platform/settings]] (`wren_settings` component `studio`), [[platform/llm-client]] (Gemini keys from `llm.env`)
- **looks-like-but-is-not:** [[reactivation/demo-video]] (`wren video demo …`, per lead, recorded by a browser); [[content/media]] (files a post carries)

## If you change this

- **Hits:** whisper-cli and its two models in `~/.cache/wren/whisper` (large-v3-turbo, silero VAD); ffmpeg with `h264_videotoolbox` (Mac only); the Remotion entry `packages/studio/remotion/index.tsx` reads `LongProps`; `askGemini` in `packages/research/src/sops/index.ts` is shared with the SOP reader; `TWELVELABS_API_KEY` in `.env`
- **Hits (Approve, record):** `ContentDesk.approveVideo/pickThumbnail` and the record in the worker, which import only `@wren/studio/schema` (no Remotion); the Marketing module `apps/portal/web/src/modules/marketing/videos.tsx`; the autobrowse desk reads the file from the Mac's disk
- **Does not hit:** Restate state, the Remotion bundle (the worker never imports `@wren/studio`'s index)

## Surfaces

| Surface | Role |
|---|---|
| `wren video add <file\|dir>` | write (ingest) |
| `wren video show` / `set` | read / write (Claude Code edits here) |
| `wren video cuts` / `keep` / `knobs` | read / write |
| `wren video cut` / `studio` | write files / read |
| `wren video look --with gemini\|twelvelabs`, `find` | write `looks` / read (TwelveLabs search) |
| `wren video approve <id> [--short n]`, `ContentDesk.approveVideo` (Videos and Inbox Approve) | write a YouTube draft, state → approved |
| `ContentDesk.pickThumbnail` (Videos → Pick thumbnail) | write `files.thumbnailPick` |
| `marketing.video`, `marketing.inbox` (`video:<id>`) | read |

## See

- Source: `packages/studio/`, `apps/cli/src/studio.ts`, `packages/content/src/video.ts`
- Design: `designs/2026-10-06-video-editor.md`

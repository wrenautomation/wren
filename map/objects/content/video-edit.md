---
type: object
cluster: content
universe: live
status: verified
verified: 2026-10-06 @ a9416b7
entity: packages/studio/src/schema.ts:74
---

# video edit

One of William's OBS recordings being edited into a YouTube video: a `video_edits` row holding the words, the cuts and the edit Claude Code writes. Package `@wren/studio`; the commands are `wren video add|show|set|cuts|keep|knobs|cut|studio|render|look|find`.

## Why this shape

The row is the edit; files are outputs beside the recording (`dir`). Every time is on the raw main track, so a cut can be undone without re-transcribing, and the cut timeline is derived (`keepSegments`, `cuts.ts:168`, frame-quantized so audio and video never drift). Silence cuts are deterministic: a cut needs a transcript gap and an ffmpeg silence to agree (`silenceCuts`, `cuts.ts:121`), after `fitWords` (`cuts.ts:88`) pulls whisper's smeared word edges back to the silence. Fillers and retakes are only proposals. `@wren/studio` is CLI only: Remotion runs as its own CLI from `packages/studio`, never bundled, and the worker never imports it.

## Shape

- Columns: `tracks` (main, optional `cam` with `offsetS` from audio sync `media.ts:162`, `camBox`), `words` [{w,s,e}], `cuts` [{from,to,why,state}], `layout`, `captions`, `shorts`, `chapters`, `tags`, `description`, `thumbnail`, `looks` (by provider), `files` (cutMain, cutCam, then long, short-n, thumb-n in `<dir>/out`), `keys` (`s3://` media-bucket URIs of the 540p previews and stills, same names), `state` (`schema.ts:9`)
- Writes: `addVideo` (`edit.ts:91`), `setEdit` (`edit.ts:224`, zod-checked, then `checkPatch` `edit.ts:192`: Shorts none or 2-4 of 20-60 s once cut; one `runs` row per write; `state` is not settable), knobs in `wren_settings` `studio.cuts` (`setCutKnobs`, `edit.ts:43`), render files, keys and state `rendered` (`setRendered`, `edit.ts:280`)
- Looks: Gemini through the SOP reader's `askGemini` and fleet keys (`look.ts:105`); TwelveLabs indexes the 360p cut in `wren-videos` (Marengo) and asks Pegasus (`look.ts:214`), stopping before the free 600 minutes, counted from `looks.twelvelabs.media.minutes` (`twelvelabsMinutes`, `edit.ts:316`)
- Compositions `Long` (`packages/studio/remotion/index.tsx:107`), `Short` (`index.tsx:162`: face on top + screen, or face alone; one-file crops `camBox`), `Thumbnail` (`index.tsx:206`: 3 variants in `DEFAULT_LOOK`); props from `longProps` (`props.ts:24`), `shortProps` (`props.ts:101`), `thumbnailProps` (`props.ts:125`)
- Render: `renderAll` (`remotion.ts:87`) bundles once with the edit folder linked as `public` (no copy), h264 on VideoToolbox; 540p previews by `preview` (`media.ts:254`), uploaded by `uploadMedia` from `@wren/content`

Citations: `packages/studio/src/schema.ts:74`, `packages/db/drizzle/0122_video_edits.sql`

## Connected to

- **owned-by:** [[ledger/run]] (every add, set, keep, cut, render, look)
- **joins:** [[platform/settings]] (`wren_settings` component `studio`), [[platform/llm-client]] (Gemini keys from `llm.env`)
- **looks-like-but-is-not:** [[reactivation/demo-video]] (`wren video demo …`, per lead, recorded by a browser); [[content/media]] (files a post carries)

## If you change this

- **Hits:** whisper-cli and its two models in `~/.cache/wren/whisper` (large-v3-turbo, silero VAD); ffmpeg with `h264_videotoolbox` (Mac only); the Remotion entry `packages/studio/remotion/index.tsx` reads `LongProps`, `ShortProps`, `ThumbnailProps`; the media bucket (`WREN_MEDIA_BUCKET`) holds previews and stills; `askGemini` in `packages/research/src/sops/index.ts` is shared with the SOP reader; `TWELVELABS_API_KEY` in `.env`
- **Does not hit:** the worker, Restate, prod Lambda bundles

## Surfaces

| Surface | Role |
|---|---|
| `wren video add <file\|dir>` | write (ingest) |
| `wren video show` / `set` | read / write (Claude Code edits here) |
| `wren video cuts` / `keep` / `knobs` | read / write |
| `wren video cut` / `studio` | write files / read |
| `wren video render [--short n] [--only long\|shorts\|thumbs]` | write files, S3 previews, `keys`, state |
| `wren video look --with gemini\|twelvelabs`, `find` | write `looks` / read (TwelveLabs search) |

## See

- Source: `packages/studio/`, `apps/cli/src/studio.ts`
- Design: `designs/2026-10-06-video-editor.md`

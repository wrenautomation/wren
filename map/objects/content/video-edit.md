---
type: object
cluster: content
universe: live
status: verified
verified: 2026-10-06 @ 2cbd7d3
entity: packages/studio/src/schema.ts:74
---

# video edit

One of William's OBS recordings being edited into a YouTube video: a `video_edits` row holding the words, the cuts and the edit Claude Code writes. Package `@wren/studio`; the commands are `wren video add|show|set|cuts|keep|knobs|cut|studio|look|find`.

## Why this shape

The row is the edit; files are outputs beside the recording (`dir`). Every time is on the raw main track, so a cut can be undone without re-transcribing, and the cut timeline is derived (`keepSegments`, `cuts.ts:168`, frame-quantized so audio and video never drift). Silence cuts are deterministic: a cut needs a transcript gap and an ffmpeg silence to agree (`silenceCuts`, `cuts.ts:121`), after `fitWords` (`cuts.ts:88`) pulls whisper's smeared word edges back to the silence. Fillers and retakes are only proposals. `@wren/studio` is CLI only: Remotion runs as its own CLI from `packages/studio`, never bundled, and the worker never imports it.

## Shape

- Columns: `tracks` (main, optional `cam` with `offsetS` from audio sync `media.ts:162`, `camBox`), `words` [{w,s,e}], `cuts` [{from,to,why,state}], `layout`, `captions`, `shorts`, `chapters`, `tags`, `description`, `thumbnail`, `looks` (by provider), `files` (cutMain, cutCam; step 2 adds renders), `keys` (step 2 S3), `state` (`schema.ts:9`)
- Writes: `addVideo` (`edit.ts:87`), `setEdit` (`edit.ts:204`, zod-checked, one `runs` row per write; `state` is not settable), knobs in `wren_settings` `studio.cuts` (`setCutKnobs`, `edit.ts:39`)
- Looks: Gemini through the SOP reader's `askGemini` and fleet keys (`look.ts:105`); TwelveLabs indexes the 360p cut in `wren-videos` (Marengo) and asks Pegasus (`look.ts:214`), stopping before the free 600 minutes, counted from `looks.twelvelabs.media.minutes` (`twelvelabsMinutes`, `edit.ts:277`)
- Composition `Long` (`packages/studio/remotion/index.tsx:98`), props from `longProps` (`props.ts:34`)

Citations: `packages/studio/src/schema.ts:74`, `packages/db/drizzle/0122_video_edits.sql`

## Connected to

- **owned-by:** [[ledger/run]] (every add, set, keep, cut, look)
- **joins:** [[platform/settings]] (`wren_settings` component `studio`), [[platform/llm-client]] (Gemini keys from `llm.env`)
- **looks-like-but-is-not:** [[reactivation/demo-video]] (`wren video demo …`, per lead, recorded by a browser); [[content/media]] (files a post carries)

## If you change this

- **Hits:** whisper-cli and its two models in `~/.cache/wren/whisper` (large-v3-turbo, silero VAD); ffmpeg with `h264_videotoolbox` (Mac only); the Remotion entry `packages/studio/remotion/index.tsx` reads `LongProps`; `askGemini` in `packages/research/src/sops/index.ts` is shared with the SOP reader; `TWELVELABS_API_KEY` in `.env`
- **Does not hit:** the worker, Restate, prod Lambda bundles

## Surfaces

| Surface | Role |
|---|---|
| `wren video add <file\|dir>` | write (ingest) |
| `wren video show` / `set` | read / write (Claude Code edits here) |
| `wren video cuts` / `keep` / `knobs` | read / write |
| `wren video cut` / `studio` | write files / read |
| `wren video look --with gemini\|twelvelabs`, `find` | write `looks` / read (TwelveLabs search) |

## See

- Source: `packages/studio/`, `apps/cli/src/studio.ts`
- Design: `designs/2026-10-06-video-editor.md`

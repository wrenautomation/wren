# Video finishing view (2026-10-15)

William: "studio experience needs to be way better." He is the content machine: the page tells him
what to do, he finishes it, he posts. Lane D of `2026-10-14-saving-and-ui-audit.md` ("What lane D
needs from the render path").

## What exists

- `video_edits` holds the edit. Every time is seconds on the raw main track; the cut timeline is
  derived (`keepSegments`, `onCut`, `toCutTime` in `@wren/studio/cuts`, frame-quantized at 30 fps).
- Cuts (`cuts` with `cut`/`proposed`/`kept`), captions (`captions.style`, `long`/`short` shown on
  screen or as a track), words with fixes (`setWords`), the thumbnail (`thumbnail.at`, `.text`),
  formats `long` (16:9) and `vertical` (9:16, window from `verticalWindow` on the face).
- Render: `VideoDesk.render` queues the Mac's `wren video render <id> --cut`: ffmpeg cut pass,
  Remotion `Long`, `Vertical`, `Short`, `Thumbnail`, 540p previews and full Reels to S3.
- Studio's detail (`videos.tsx`) shows the rendered preview and edits fields, cuts and words. Lane
  B moves those onto the save engine and marks a slot after Preview for this view.

## What this adds

**The edit.** Migration `0267_video_finish` (after lane B's 0265 and 0266):
- `overlays` jsonb: `{ text, from, to, x, y, size }[]`. Raw seconds; `x`, `y` the text's middle as
  0..1 of the output frame; `size` s, m or l. Checked in `editPatchSchema` (120 characters, inside
  the frame, inside the recording).
- `crops` jsonb: `{ vertical?, square?, portrait? }`, each `{ x, y }`, the crop's middle as 0..1
  of the picture. Unset: the face, as now.
- `formats` gains `square` (1:1, 1080x1080) and `portrait` (4:5, 1080x1350).
- `captions.place`: `{ long?, short? }`, the line's middle as 0..1 from the top.
- Cover frame stays `thumbnail.at`.

**`@wren/studio/finish`**, pure and browser-safe (the page and the render share it): frame sizes
per format, `cropWindow` (generalizes `verticalWindow`), `snapFrame`, the timeline edits
(`trimCuts` for in/out, `moveCutEdge` for a cut's edge, clamped and frame-snapped),
`overlaysOnCut`, and `formatFor(platform, rendered)`.

**Saving.** `setEdit` takes `expect`: the fields' values the editor opened on. If any moved, it
refuses with `staleRefusal("video")` (409, code `conflict`), checked under a row lock. `VideoDesk.set`
passes `expect` through and keeps the refusal's code. A new `VideoDesk.line` rewrites one caption
line's words (times spread over the line, stressed words remapped), with the line's prior text as
`expect`.

**Render.** `Long`, `Short` and `Framed` (was `Vertical`; now 9:16, 1:1 and 4:5 from props) draw
the text overlays and place captions at `captions.place`. `renderAll` renders `square.mp4` and
`portrait.mp4` when the edit lists them; `--only` takes them. After a render the Mac uploads, when
missing: `source` (the raw main track at 540p, a keyframe every 10 frames, so the page scrubs frame
by frame), `source-cam` (the camera file, same), `strip` (60 frames in one JPEG for the timeline),
and `cover-<format>.jpg` (the exact cover frame, ffmpeg). Tests make a tiny clip with ffmpeg's
lavfi colours; no real media.

**Approve.** The whole cut's drafts pick the render each platform takes (`formatFor`): Instagram
and TikTok 9:16; Facebook and LinkedIn 4:5, else 1:1, else 9:16; X 1:1, else 9:16. The cover goes
to Instagram's `thumbOffset` and `cover`, and TikTok's `coverMs`.

**The page.** `finish.tsx`, one section after Preview on a wide screen while the video is editable:
- Player over `source`, skipping cut spans as it plays, so a trim shows at once. Text and caption
  lines drawn live over it; in 9:16, 1:1 or 4:5 the frame crops live and a drag moves it.
- Timeline under it: the filmstrip, kept and cut spans, in and out handles, each cut's edges,
  text bars, caption lines, the cover marker and the playhead. Drag snaps to frames. Keys: Space
  plays, arrows step a frame (Shift: a second), I and O set in and out.
- Panels: Text (add at the playhead, edit, size, remove), Captions (style, on screen per format,
  height, lines edited in place), Cover (use this frame), Formats (which render, crop per format).
- One `useSaved` over cuts, overlays, crops, captions, thumbnail and formats: journaled per video,
  one save per pause (1.2 s), a drag sets on release only, never per frame. Conflicts show Keep
  mine / Use theirs.
- Phone: not shown; finishing happens at the Mac.

## Files

- `packages/db/drizzle/0267_video_finish.sql`, `meta/_journal.json`
- `packages/studio/src/finish.ts` (+ test), `schema.ts`, `edit.ts` (+ test), `props.ts`,
  `media.ts`, `words.ts`, `remotion.ts`, `remotion/index.tsx`, `index.ts`, `package.json`
- `packages/content/src/restate/video-desk.ts`, `video.ts` (record `finish`, approve picks)
- `apps/cli/src/studio.ts` (render uploads, `--only square|portrait`)
- `apps/portal/web/src/modules/marketing/finish.tsx` (new), `videos.tsx` (one section),
  `apps/portal/web/src/records.tsx` (`videoLine`, `expect` through), `modules/marketing/index.ts`,
  `apps/portal/package.json` (`@wren/studio`)
- `map/objects/content/video-edit.md`

## Left

Nothing.

## Log

- 2026-10-15: written.
- 2026-10-15: built (edit, render, approve, then the portal view; migration renumbered 0267 after lane B). Tested on a local preview with synthetic media.
- 2026-10-15: render only what changed. `render-hash.ts` hashes each output's real props (no mattes) and the render stores it as `files["<output>.hash"]`; `wren video render` redoes only outputs whose hash differs, is missing or whose file is gone (`--again` forces), skips an unchanged cut pass, re-cuts a moved cover from the rendered file. `VideoDesk.render` takes `only`. The Finish preview note and the Shapes panel name the stale outputs. Renders from before hashes redo once. The Mac service (autobrowse `src/studio/service.ts`) passes `only` on as `--only`.
- 2026-10-15: a crop per Short. `crops.shorts["<n>"]` (a Short's number, 1 to 12) holds its centre on his picture; a Short with none follows the vertical crop, then the face as before. It lives in `crops`, so older patches and the `shorts` rules are untouched. `ShortProps.crop` reaches the composition and the hash; `coverRect` (`finish-look.ts`) places the face for the render and the mattes. Finish: pick a Short under Shapes, drag the 9:16 picture, or reset it.
- 2026-10-15: preview matches render. `finish-look.ts` holds the corner cam box (`cornerCam`), the caption sizes and places per format (`longCaption`, `reelY`, `reelCaption`) and each word's stress look (`captionWordLook`, `pillLook`, `CAPTION_LOOK`); the Long, Short and Framed compositions and the Finish preview all draw from it. The preview gets the words with their stress and the edit's `layout`, draws captions as the render breaks them on the cut timeline (`captionTrack`, `captionShown`, `finish.ts`), and plays the camera file in a second video in its corner (or full on `cam`). Draft fields and slides saves answer `saved` (`fieldsSaved`, `slidesSaved`, `shape-view.ts`) and the page patches from it (`draft-patch.ts`); a save that moved the draft's status reads again. Render again: `VideoDesk.render` takes `again`, through `rendering` to the Mac, which passes `--again` (autobrowse `src/studio/service.ts`).

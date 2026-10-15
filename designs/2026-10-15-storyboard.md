# Storyboard

2026-10-15. Studio's editor opens on a storyboard. A change is one sentence. Built on bead wa-zex.

## What

- The edit as frames, one per beat: a chapter, or a run of whole sentences (~30 s raw, `BEAT.partS`) when there are no chapters, plus one per Short.
- Each frame: a poster (the Finish drawing: still, corner cam, captions, text on screen, a Short's 9:16 crop and title card), raw time range, where it plays once cut, the words, what's cut out, on-screen text, layout, cut length.
- Header: title, length after cuts, formats, Shorts count, captions.
- A box under the board and one per frame. A sentence there goes to the model. It answers a patch plus one plain line per change. The page shows the board after, changed frames marked. Apply saves. Undo goes back one. Nothing renders until Render.
- Timeline (the old sections) is one tab away: `?editor=timeline`. Phone: one column.

## Why

The timeline shows times and bars. William thinks in parts of the talk. A frame per part shows what he'll see, and a sentence is faster than finding the bar. The patch is the same `video set` takes, so nothing new can be saved that the CLI and Finish can't already save.

## Where

- `@wren/studio/storyboard` (pure): `storyboardOf`, `beatSpans`, `boardChange`, `beatText`, `storyboardText`.
- `@wren/studio/change`: `changePrompt`, `changeAnswerOf`, `checkChange`, `proposeChange`, `applyChange`, `withCutChanges` (moved from content's Ask Claude).
- `VideoDesk.propose` (worker's model), `VideoDesk.set` with `proposal`, `VideoDesk.undo`. The record's `storyboard` comes with every load and every set/undo answer.
- CLI: `wren video storyboard <id> [--json]`, `wren video ask <id> "<sentence>" [--beat part-2] [--apply] [--json]`, `wren video undo <id>`.
- Page: `apps/portal/web/src/modules/marketing/storyboard.tsx`; tabs and default view in `videos.tsx`.

## Patch contract

1. `propose(id, sentence, beat?)`: sentence ≤ 1000 characters. Beat is a frame key (`chapter-n`, `part-n`, `short-n`) or none.
2. The model gets the edit's fields (`video show`'s shape, silence cuts left out), the storyboard text and the frame meant. It answers `{"changes": [lines], "patch": {fields} | null}`.
3. `checkChange` runs the patch through `readyPatch`, the same parse, sort, Short snap and `checkPatch` as `setEdit`. Cut entries merge onto the cuts by their ends (`withCutChanges`); others become `manual` cuts. Fields that don't move are dropped.
4. Refused: asked once more with the reasons. Still refused: `issues`, and Apply is off.
5. Answer (`Proposal`): `run`, `changes`, `patch`, `expect` (each patched field as it was), `issues`, `snapped`, `after` (board after), `changed` (`header` fields, `beats` keys, `gone` keys), `model`.
6. Apply = `set(id, patch, expect, proposal: run)`. A field moved since the proposal is refused as a conflict (409). The `video set` run's stats name the proposal; Undo restores from its `before`.
7. Runs: `video propose` holds sentence, patch, lines, issues, asks. It writes nothing else, so Undo skips it.

## Decisions

- Model: the worker's (gateway, free keys), CLI default `gateway` with `gateway:cohere` fallback. No Claude desk call: a patch is small and checked.
- Changed frames use `animate-ui-changed`, the kit's existing motion; it plays only on a real proposal.
- Poster stills are `<video src="#t=">` on the 540p `source`, loaded when in view; the filmstrip shows until then.
- Shorts have no long-video layout; their frame says "Vertical, 9:16".
- Local preview answers `propose` with `WREN_PREVIEW_LLM` (default `gateway`).

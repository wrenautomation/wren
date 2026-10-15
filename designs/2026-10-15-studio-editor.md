# Editor in Studio

2026-10-15. William: "i like the editor, haven't really tried it, but maybe make it more accessible in the studio? just do some more creative / visually intuitive UI, not too much. we'll discuss design language soon."

## What

The video editor lives behind Marketing → Recordings (hidden page `videos`, `modules/marketing/videos.tsx` + `finish.tsx`). Studio (`studio.tsx`) only links to the newest recording. Make editing a first-class part of Studio.

- Studio gets a visual Videos shelf: recent recordings and rendered videos as thumbnail cards (poster frame, duration, state: editing / rendered / waiting on you / posted, platforms it went to). One click opens the editor right there in Studio (full width), with a clear way back to the shelf. No hunting through a hidden page.
- The editor itself: make what it can do visible at a glance. A timeline strip of the cut (clips, removed silences, captions) you can scrub, the preview beside it, and the main moves as obvious buttons (trim, cut a silence back in, caption style, render, approve). Reuse what finish.tsx already does; this is surfacing and layout, not new editing features.
- Drafts that wait on him in Studio show as visual cards per platform (the feed look `PLATFORM_SPECS.feed` already renders), not plain rows, where they aren't already.
- Phone: shelf scrolls horizontally, editor stacks preview over controls; check WebKit 393 wide.

## Bar

- `ui-bar` memory: high ticket, framed sections, clear borders and heading scale, soft corners. Motion only for real events (render progress, a cut applied). Numbers never animate.
- Use the kit (`@wren/ui`), Lucide through the kit only, existing tokens. Don't invent a new motif or palette: a design language pass is coming.
- Don't touch packages/studio transcription or timing code (another builder is on word timing in packages/studio/src/whisper.ts and align).
- Old links to Recordings keep working.

## Done

Unit tests where logic moved. Screenshots (desktop 1440, phone 393) of local dev with synthetic or local-only media, saved outside the repo, never committed. Never shoot the live portal.

## Scope change (William, 2026-10-15)

"All the editor needs is to be able to be used the same way Claude Code used it for my first few videos, as a human." Parity with the CLI is the bar; the shelf and the look come second.

What Claude Code ran on videos 2-4 (prod `runs`, 10-07 to 10-14): `video render` 57 (mostly `--only shorts --short n`), `video words` 16 (`--fix` 15, `--punctuate` 1), `video set` 11 (title, description, chapters, cuts, captions, shorts 4x, layout + camBox 1x), `video cut` 4, `video add` 4, `video swap` 3, `video look` 2 (gemini), `video cuts --redo` 1, `video stress` 1 (model proposal).

## Parity: CLI to editor

Every control calls the handler the CLI's code calls (`setEdit`, `setWords`, `setStress`, `swapShortMedia`, `approveVideo`, VideoDesk.render). No new editing logic.

| CLI | Editor control | Through |
|---|---|---|
| `video set` title, description, tags, chapters, thumbnail text | Fields (had) | VideoDesk.set |
| `video set` cuts, `video keep <n>` | Finish timeline: drag to cut, Put it back; Cuts list Keep/Cut (had) | VideoDesk.set, .cut |
| `video set` captions, `--captions-style/-long/-short/--behind` | Finish → Captions; Captions box when not finishing (had) | VideoDesk.set |
| `video set` formats, crops, overlays | Finish → Shapes, Text (had) | VideoDesk.set |
| `video set` shorts (from, to, title, card, cardText) | **Shorts editor**: add from the timeline pick or the playhead, start/end, title, on-screen title, remove; the look's suggested Shorts with Use | VideoDesk.set (setEdit snaps to sentences) |
| `video set` layout | **Layout**: ranges, each corner / face only / screen only; add from the timeline pick | VideoDesk.set |
| `video set` camBox | **Face box** in Shapes: x, y, w, h in the recording's pixels, or clear | VideoDesk.set |
| `video stress --add/--drop` | Transcript: pick a word, Stress (had) | VideoDesk.set |
| `video stress` (model proposes) | **Propose stressed words** | new VideoDesk.stress → `proposeStress` + `setStress` |
| `video words --fix`, `--at` | Fix a word everywhere; pick a word, Fix (had) | VideoDesk.words |
| `video words --punctuate` | **Add punctuation** (shown while the transcript has none) | new VideoDesk.punctuate → `punctuate` + `setWords` |
| `video cut`, `video render` | Render (cut + only what changed), Render again (had) | VideoDesk.render |
| `video render --only <part>` | **Render one part** (long, vertical, square, portrait, Shorts, thumbnails) | VideoDesk.render `only` |
| `video swap [--short n]` | **Use the new render** on approved Shorts | new VideoDesk.swap → `swapShortMedia` |
| `video approve [--short n] [--vertical] [--privacy]` | Approve, Approve a Short, Approve vertical (had) | ContentDesk.approveVideo |
| `video approve --replace` | **Upload as a new video** on Approve | ContentDesk.approveVideo `replace` |
| `video look` results | **Suggestions** from the look: Shorts, chapters, thumbnails, each with Use | detail `looks`, VideoDesk.set |
| `wren templates set post:youtube/footer` | link to the footer templates | Library → Templates (had) |

Not in the editor, and why:

- `video add`, `video watch`: ingest on the Mac, automatic a minute after a recording stops.
- `video look`, `video find`, `video cuts --redo`, `video knobs`, `render --still`, `render --upload`, `video source`, `video studio`: need the recording or the cut file on the Mac's disk (ffmpeg, Remotion, the look proxy). The desk's `studio` service serves only `render` today; a `look` and `redo` there is autobrowse work, listed in what's left.
- `render --short n`: Render redoes only the outputs whose hash moved (`render-hash.ts`), so one changed Short renders alone; Render one part → Shorts covers the rest.

## Open calls (made by the builder)

- Studio opens a video at `/marketing/studio?video=<id>`: the editor replaces the page body, a back bar returns to the shelf. `/marketing/videos/<id>` stays and still works.
- The editor in Studio is the same record body (`TemplatePage` over the `videos` page), so every action, poll and save is one code path. `RecordPage` gets `back` and `wide` props for it.
- Shelf cards read `marketing.video` with `thumbs` (poster), and Pieces for where each went (platform marks). Twelve newest; All recordings links to the list.
- Waiting drafts: each card leads with the post as its feed shows it (`FeedPost`, phone cut from `PLATFORM_SPECS.feed`) and a platform mark; the words edit under it as before. Stories and carousels keep their card.
- New handlers are thin: one call into `@wren/studio` or `@wren/content`, a `runs` row from the function they call. The model ones use the worker's LLM (prod: gateway).

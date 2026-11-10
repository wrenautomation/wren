# Video editor we use and sell (WA-1285, 2026-11-10)

William, 11-10: "investigate usemotion (the html with agentation style annotations editor), raea, compound video editor, etc. to find the best custom video editor solution for us that we can also sell as part of our systems."

"usemotion" = OpenFilm (openfilm/openfilm, MIT): click a part to change it, draw a box or mark a range, and tell the agent. Its film.html is already an export of our edit row (`2026-10-24-video-film-file.md`).

## What we have

- The edit row (`video_edits`) is the truth. Agents change it through `wren video …`; saves carry `expect` (stale write refused) and locks (`edit.ts:484-510`).
- Finish, the portal editor (`apps/portal/web/src/modules/marketing/finish*.tsx`, 2,636 lines, `2026-10-15-video-finishing.md`): it plays the recording's S3 playback copy, skips cut spans, draws text and captions live, lets you drag crops, and has a timeline with a filmstrip, cut edges and caption lines. Saves offer Keep mine or Use theirs.
- The look Finish draws is an imitation. The real picture comes from the Remotion composition (`packages/starling/studio/remotion/index.tsx`), rendered on the Mac: 331 s for the 57 s X demo promo (WA-1268), 2.2 s for one still.
- The composition plays `cutMain`, the file the ffmpeg cut pass writes (`props.ts:165-171`). Mattes are cut from that file too. So a new cut needs a pass on the Mac before any true picture shows it.

## Target state

- Finish shows the true picture (the composition itself) live, cuts included, for us and for a client in their portal.
- The person marks a part, a box or a range and types a note. The agent reads the mark and patches the row.
- The export happens once, at the end. On the Mac for us. On a server only when a client edits.
- We may sell it: the license allows a hosted editor for clients.

Non-goals (for now): a live agent cursor, a shared co-edit model (CRDT), export to Premiere or Resolve. `expect` and locks already cover two writers.

## Priorities, in order

1. We may sell it hosted (license). A "no" drops the option.
2. The edit experience with the agent.
3. Iteration speed: preview first, export second.
4. Risk: maturity, maintainers, a fork to keep.
5. Port cost in risk and $ (not dev time).
6. Run cost.

## What the market has (11-10)

Each fact with its URL: tasks repo `docs/11-10/video-editor/` (html-editors, gpu-engines, timeline-editors).

| Candidate | Render path | Editor | May we sell hosted? | Maturity |
|---|---|---|---|---|
| Remotion (ours) | Chrome capture; Lambda fan-out; Player plays live in a browser | none we need (Finish is ours) | **Yes, with a fee.** A video editor or the Player = "Automators": $0.01 a render, $100/mo minimum (covers 10,000 renders). Player previews are free. A client who operates the project adds their headcount to ours (limit: 4 people). Agent-written code is allowed; client-written code is not. 5.0 (not out) also counts contractors | 72k stars, 499 contributors, 4.0.542 |
| OpenFilm | Chrome capture, parallel, chunked | OpenFilm Studio: timeline, click-to-edit, box and range marks to the agent (`chat-marks.ts`), versions, NLE export | **Yes.** MIT; a fork may not use the name | created 10-04, v0.3.2, 2 main authors |
| HyperFrames (HeyGen) | Chrome capture; Lambda, Cloud Run shipped | Studio with notes pinned to a frame; not a drop-in embed | **Yes.** Apache-2.0 | 8 months, 134 contributors |
| Raea | Rust GPU engine, Remotion's API | CLI | **No.** FSL; each version turns Apache 2 years after release (v0.1.0: 2028-11) | 3 weeks, 1 author |
| Framefields | Native WebGPU in Node; Linux needs a Vulkan GPU | localhost preview player | **Yes.** Apache-2.0 | 5 weeks, 3 contributors, own TS API |
| Compound | closed Mac app | You + Agent on one timeline | **No.** Closed, $20/mo | n/a |
| OpenReel, WeftCut | browser WebCodecs; Electron + ffmpeg | timelines; WeftCut "Tacks" = notes on a range | **Yes.** MIT | alpha; 7 contributors |
| OpenChatCut, kimu, MasterSelects | | timelines | AGPL: full source to every user. **Not for us** | |
| Palmier Pro, Cardboard, PandaStudio, OpenEdit's engine, Twick, Shotstack SDK, Helios | | | closed, Shield, Elastic or "sustainable use". **No** | |

- Speed: Chrome capture runs about 10-24 fps on one machine. Raea did our cut in 27.6 s (331 / 27.6 = 12x). Framefields claims 255 frames at 1080p in 2.6 s (vendor number).
- In-browser export (`@remotion/web-renderer`) is out: it does not support `backdropFilter`, and the composition uses it (`index.tsx:907`).

## Options

### A. Finish plays the real composition (Remotion Player)
- `@remotion/player` replaces Finish's drawn overlay. Finish keeps its timeline, its save engine and its locks.
- Live cuts: the composition plays the raw `source` playback copy with one `Sequence` per kept span, not `cutMain`. Mattes, kit sounds and images go to S3 next to the playback copies.
- Marks: copy OpenFilm's box and range shape (MIT, with notice). A mark saves as a note on the row; the agent reads it and patches the row.
- Exports stay on the Mac: Remotion for finals, Raea for drafts. Lambda, and media per client, wait for the first paying client.
- Gain: no port, no new editor, one composition for preview and export. Mature base.
- Cost: the Automators fee once a client operates the editor (at least $100/mo). The preview is close to the export, not exact: the Player plays `OffthreadVideo` as a plain `<video>`, may drift up to 0.45 s before it seeks, and Safari may not play VP9-alpha mattes. The export stays the truth.

### B. Fork OpenFilm Studio; film.html becomes the source
- Gain: box and range marks, click-to-edit and versions exist on day one. MIT, no fee.
- Cost: every row writer (setEdit, locks, the edit pass, words, cuts, render hash) moves to film.html, or we build film.html import (planned as part 2 on 10-24, not built). Port the composition to film pages. Keep a fork of a 5-week-old, 2-author project. OpenFilm Studio seems to run as a local process on a folder (an inference), so a hosted mode per client is ours.

### C. HyperFrames
- The same shape as B on HeyGen's format. Gain: Apache, a large team, Lambda render shipped. Cost: the same port as B, a Studio that does not embed, and Finish thrown away.

### D. Framefields GPU render, Finish as the editor
- Gain: fast export with no fan-out, Apache, no fee.
- Cost: its own TS API, so a full port. Its preview is a separate player, so Finish keeps its imitation. Linux needs a GPU host (the box and Lambda have none).

| | A | B | C | D |
|---|---|---|---|---|
| 1 Sell | yes, fee | yes | yes | yes |
| 2 Experience | Finish + marks | best on day one | good, no embed | Finish, imitation preview |
| 3 Speed | live preview; exports unchanged | live preview; Chrome export | same as B | fast export; no live true preview |
| 4 Risk | low | young fork | medium | young, own API |
| 5 Port | none | all row writers | all | all |
| 6 Run | $100/mo per sold editor, at least | $0 | $0 | GPU host |

## Recommendation: A

- The editor exists (Finish). What it lacks is the true picture and marks. A adds both with no port.
- Speed for editing comes from a live preview, not from the engine. A gives it for cuts and looks. Exports stay as they are (Raea drafts at about 30 s).
- The fee is small next to a sold editor, and only starts with a client.
- B is the fallback if the fee or Remotion's terms block a sale.

## Risks

- Remotion 5.0 terms (contractors count). We can stay on 4.x.
- The preview differs from the export (drift, mattes on Safari). Trial 1 measures it.
- Raea is a canary build. Drafts only; Remotion stays.

## Trials (on a Long edit row with a matte)

1. A Finish story with `@remotion/player` on the raw source and one `Sequence` per kept span. Measure: a cut change and a caption change to a new picture, matte sync, Safari/iPad. Free.
2. Ask Remotion in writing: the 5.0 terms and how they count us. Free.
3. A Lambda export: only when a client is near. Spends cents; needs William's yes.

## Decision log

- 11-10: options A-D compared on the priorities above. Recommend A. Raea stays for internal drafts (WA-1268). Pending William.
- 11-10: goldfish review: 36 findings (critic 15, reader 15, zoom-out 6), 21 applied, 15 rejected or merged. Changed: Finish (the existing editor) is now the base; the Player plays the raw source so cuts show live; the license cost follows Remotion's FAQ (a fee once a client operates the editor); Lambda waits on a client; B's cost includes the row writers; Non-goals and Risks added. Open: William's pick, the fee, marks vs agent cursor, copying OpenFilm code.

## William's calls (11-10) and the new base

His words: "finish as our own editor makes sense, and i want a free way to sell this", "were not asking remotion btw i dont want the remotion fee", "for the base i want our own software for this, or ability to adapt since then we can wire our system into our vireo system too", "marks are enough, but maybe a cursor would be nice too", "lets do this."

So option A's Remotion Player is out for the sold product. The composition uses 10 Remotion names and none of its animation math (no spring, interpolate, delayRender; all timing is our own `src/*.ts`). The base options, all free to sell:

| Base | What | Gain | Cost |
|---|---|---|---|
| E1. Own frame runtime + HyperFrames engine | Our own small React runtime (frame clock, Sequence, Video, Audio, Img, fonts) plays the composition in Finish. Export: `@hyperframes/engine` (Apache-2.0) seeks our page through its `window.__hf` protocol, captures with Chrome beginFrame, encodes with ffmpeg; its Lambda package fans out | No port of the composition. Preview and export are one runtime we own. Apache engine, 134 contributors. Raea still drafts (same component names) | Chrome-class export speed. We own the runtime (video seek, audio mix props) |
| E2. Own runtime + own capture | Same runtime; our own Playwright capture and ffmpeg | No dependency | We rebuild what E1 gets free: beginFrame, video frame extraction, chunking, Lambda |
| E3. Fork OpenFilm | film.html as source | Marks and click-to-edit on day one | Every row writer moves; young fork |
| E4. Framefields | GPU engine | Fast export | Full port to its API; no true preview in Finish; GPU host |

Pick: E1. Priorities: free to sell, our own base, fastest loop with Vireo, least risk. If the engine falls short, E2 swaps in behind the same seek protocol.

Marks = Vireo notes. A Vireo note already carries `box` (fractions), `time` (seconds) and `quote`. Finish writes the same note shape on an edit; the agent reads it through `wren variants show` or `wren video marks`. One mark model for both. Each agent pass on an edit can be a Vireo sample (`studio: {edit, format}` exists), so cuts are judged, kept and shipped in one loop.

Agent cursor: second, after marks. It is a presence row (who, edit, time, part) that Finish polls or streams; no co-edit model.

Take from the others (ideas; OpenFilm and HyperFrames code is MIT / Apache, copied with notice where it saves work):
- OpenFilm: box and range marks, click a part to edit it, named versions, FCP/Premiere export (later).
- WeftCut: timeline diff of an agent's change; undo per session.
- OpenChatCut: approve or reject an agent's draft before it lands.
- Raea: measured checks P0-P3, judge calibrated to his scores, one still for the agent (WA-1267).
- HyperFrames: beginFrame capture, chunked Lambda render, a note pinned to a frame.
- Framefields: beat grid and audio-reactive values for cuts on the music.
- Compound: You and Agent on one timeline; sliders for a part's values.

Build order:
1. Spike: own runtime renders the Promo and one Long row through `@hyperframes/engine`; time and SSIM against Remotion.
2. Runtime in Finish in place of the drawn overlay; raw source + one Sequence per kept span.
3. Marks as Vireo notes; `wren video marks`.
4. Remotion removed from the package; Raea draft flag.
5. Agent cursor. Content playbook (own design doc): Vireo's locked guides and kept winners feed one guide per format for all content and ads.

- 11-10: William picked Finish as the editor, no Remotion fee, own base. Pick E1. Marks first, cursor after.

## Spike result (11-10): E1 holds

The composition file ran unchanged. "remotion" and the two font imports were aliased to a 130-line runtime; `@hyperframes/engine` 0.9.30 captured the page.

| Test | Remotion 4.0.533 | Own runtime + engine | Picture (SSIM vs Remotion) | Sound |
|---|---|---|---|---|
| Promo, 57 s at 60 fps, 3,426 frames, 96 sounds | 331 s | 92 s (capture 73, encode 17, audio 2) | 0.993, 1 frame under 0.95 | -23.7 LUFS both |
| Long, 7 s at 30 fps, camera + VP9-alpha matte + captions | 18 s | 14 s | 0.991, lowest frame 0.989 | -25.7 LUFS both |

Raea scored 0.979 on the same Promo. The Long test used a synthetic matte (a circle cut from the cut file): the October edit folders are gone from the Mac.

What the runtime had to match:
- Remotion's page sets `box-sizing: border-box` on every element. Without it each padded scene moved 70 px.
- Screen recordings are variable frame rate (about 2 frames a second). A frame holds until the next one starts. A plain `ffmpeg -ss` shows the next frame early; the frame server reads packet times and starts at the keyframe before.
- Video frames come from our own frame server (ffmpeg, 120-frame chunks, read ahead, PNG for alpha), not the engine's injector. The injector needs a fixed list of `<video>` ids; our videos mount and unmount with their Sequence.
- The engine waits on `window.__hfWaitForSeekCompletion` after each seek. The runtime resolves it when every image has decoded.
- Sound: one pass over all frames lists each sound (file, start, trim, volume, loop); ffmpeg mixes them.

Engine facts: on the Mac it captures by screenshot (beginFrame is Linux only). It ran 4-5 Chrome workers on this Mac without an OOM. The capture loop, worker pool and frame merge are the engine's; the page, the frame server and the audio mix are ours.

Open from the spike: fonts load from Google by `<link>` (prod: self-hosted files); a moving volume is a step per frame (fine for the ducked bed, check by ear); the live preview mode (`<video>` synced to the clock) is not built yet.

## Build step 1 (11-10): Remotion is out

`packages/starling/studio` renders on our runtime. No Remotion package is left in the repo.

| Part | File | Does |
|---|---|---|
| Runtime | `frames/runtime.tsx` | The frame clock, `Sequence`, `Video`, `Audio`, `Img`. Three modes: render, play, scan |
| Player | `frames/player.tsx` | A composition live in any page, scaled to its box. The clock is the caller's |
| Page | `frames/page.tsx` | The page Chrome draws. `?play` makes it a preview with a scrubber |
| Frame server | `frames/frame-server.ts` | Serves the page, the edit's folder and exact video frames. Keeps 48 chunks on disk |
| Render script | `frames/render.ts` | `node frames/render.ts <job.json>`: bundle once, then each still and video |
| Compositions | `compositions/index.tsx` | Was `remotion/index.tsx`. Exports `COMPOSITIONS` by name |
| Wrapper | `src/render.ts` | Was `src/remotion.ts`. Same `renderAll`, `renderStill`, `renderStills`, `renderPromo`; `openPreview` replaces `openStudio` |

Measured with the real script: Promo 115 s (Remotion 331 s), SSIM 0.997 against the spike's output, -23.7 LUFS. Long test 9 s, SSIM 0.992 against Remotion, -25.7 LUFS.

Closed from the spike's open list:
- Fonts are files in the bundle (`@fontsource/figtree`, `@fontsource/geist-mono`, latin). No network at render.
- A moving volume is a 1 kHz envelope with straight lines between frames, multiplied into the sound. No steps.
- The preview is built: real `<video>` and `<audio>`, moved back to the clock past 0.12 s of drift.

New in the build:
- A video renders in pieces of 1,800 frames. Each piece is encoded and its frames deleted while Chrome draws the next. A 30 minute video holds about 1 GB of frames on disk, not 13 GB.
- A sound is one note per unbroken run of frames. It stops when its Sequence ends. The spike let it play to the file's end.
- Output is tagged BT.709, TV range. Remotion's was untagged full range.
- CI sets `PUPPETEER_SKIP_DOWNLOAD`: no check draws a video, so CI fetches no Chrome.

Not checked: a real Long with a camera cut, a Short and a Framed render. The October edit folders are gone; the first real recording is the test.

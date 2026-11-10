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

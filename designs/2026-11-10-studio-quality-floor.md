# Studio quality floor (WA-1267)

Status: design, 11-10. Source: `tasks/docs/11-09/sources/raea/audit.md` (Raea's `check`, `judge`, `floor.md`, `rubric.md`). Raea is FSL: we write our own code from its rules and copy none of its source.

## Goal

A render cannot reach Approve with a fault a machine can measure. Today `wren video check` (`studio/src/video-check.ts`) is one Gemini look at a contact sheet against `bar.ts`. It guesses at faults that we can count: a caption on screen for 0.2 s, a word under the like button, five flashes in a second. A guess misses some and invents others, and nothing stops Approve when it fails (`approveVideo` in `inbound/src/video.ts` reads no check).

Target:

1. Measured checks run with no model, from the render's own data, and rank each fault P0–P3.
2. Approve refuses an output while a P0 or P1 stands on its current render.
3. The model judges only what we cannot measure, by a fixed rubric, and only advises until its calls agree with William's.
4. The floor rules live in Canon, where every content skill reads them.

## Non-goals

- Swapping Remotion for Raea or our own engine (WA-1268 measures that). The checks must survive such a swap, so they read an engine-neutral manifest, never Remotion internals.
- 3D, games, sound models.
- Checks on a non-video sample (text, image). The rank and gate shapes are general; only video uses them now.

## The key choice: where the measured checks read the frame from

Most checks need to know where text sits and when. Three ways to know it:

| | A. Manifest from props | B. Measure in Chrome | C. Pixels only |
|---|---|---|---|
| How | The props the composition gets (`longProps`, `shortProps`) already hold every word's time, the caption style, each overlay's box, the big word's box (`placeWord`), each sound's time. A pure function turns them into a `RenderManifest`: text boxes per time span, picture changes, cues. Flash, contrast and loudness read the file with ffmpeg. | A measure mode in the composition writes each text element's `getBoundingClientRect` per sampled frame during a render. | OCR on sampled frames finds the text boxes; ffmpeg finds cuts, flashes and loudness. |
| Truth of boxes | Our layout math, the same functions the composition calls. Wrong only where CSS wraps differently from our estimate. | Exact. | What OCR reads; it misses styled or moving text. |
| Cost per check | Milliseconds, before or after a render. | One more Chrome pass; this Mac renders one thing at a time. | Seconds per frame, a model or tesseract. |
| Survives a new engine | Yes: any engine takes the same props. | No: tied to the DOM. | Yes. |
| Runs before a render | Yes: a fault shows in the edit, before the render spends minutes. | No. | No. |

Priorities, in order: the check must be true; it must survive a new renderer (William wants our own base, WA-1268); it must be cheap enough to run on every render and every Vireo variant; it should run before a render.

**Recommend A**, with one guard: the composition and the manifest call the same layout functions (`placeWord`, `wordBox`, the caption box), so there is one estimate, not two. Where the composition lays text out in CSS with no matching function today, phase 1 moves that math into a shared function first. B stays the fallback for one check if A's boxes prove wrong in practice. C is rejected: slow, and OCR misses exactly the styled captions we use most.

## Checks and ranks

Rank meaning: **P0** breaks a platform rule, a law or health (never ships). **P1** a viewer sees the fault (blocks Approve). **P2** below our bar, a person decides. **P3** a note.

| Check | Reads | Rule | Rank |
|---|---|---|---|
| Text off frame | manifest boxes | any part of a text box outside the frame | P0 |
| Text under platform buttons | manifest boxes, per-platform zones | a caption or overlay box overlaps the zone of the output's platform (Shorts, Reels, TikTok: right rail and bottom bar, numbers in `platform-zones.ts`) by more than 10% | P1 |
| Caption hold | manifest caption spans | a line is on screen less than 0.3 s per word | P1 |
| | | less than 1 s (a fast speech run can force it) | P2 |
| Still too long | manifest picture changes (cut, layout, crop move, overlay in or out; captions do not count) | Short: no change for more than 10 s | P1 |
| | | Short: more than 3 s | P2 |
| Flashes | file: per-frame luma (ffmpeg `signalstats`) | more than 3 flashes in any 1 s (WCAG 2.3.1: a swing of 10% of full luma and back) | P0 |
| Contrast | file: frames at the middle of each text span, cropped to its box | text color against the box's background pixels below 3:1 | P1 |
| Cue off its word | manifest cues and words | a cue anchored to a word or a cut lands more than 2 frames from it | P1 |
| Loudness | file (`loudness.ts` measures) | integrated outside -14 ±1 LUFS, or true peak above -1 dBTP | P0 |
| Name spelled as the brief | manifest caption words, the brief's names | a word within edit distance 2 of a brief name but not equal | P1 |
| Name said but not shown | words, captions, overlays | a brief name is said and no caption or overlay shows it within 2 s | P2 |

Every issue carries `{rank, check, at, says, box?}`. The existing model issues keep their shape and get a rank from the rubric (below).

## Approve gate

`approveVideo` reads the newest `video check` run for the output it approves. It refuses when that run's hash differs from the output's current render hash ("check it again: the render changed") or when a P0 or P1 stands. A P2 shows in the Videos page beside Approve; it does not block. `wren video check` runs the measured checks first, then the model; a model failure no longer fails the run, because the gate does not need the model.

Phase 1 also runs the manifest checks inside `wren video set` and the edit pass, before any render, so the edit agent fixes a short hold or a buried word while the edit is cheap.

## Rubric judge

`bar.ts` becomes the rubric: per mode (open, point, shown, pace, read, sound, world, own), one or two fixed questions, each answered on five levels (poor, weak, fair, good, great) with one line of why. The prompt is frozen per version; a change is a new version id on each answer, so old calls stay comparable. The pass rule lives in code: any "poor" is P1, any "weak" is P2.

Measured checks drop the bar lines they now cover (`text`, `pace`, the hold half of `captions`). The model keeps taste: `open`, `hook`, `face`, `private`, `plain`, `best`.

## Calibration

The judge advises (its P1 shows as P2) until it agrees with William. His calls already exist: his Vireo verdicts on video samples (zones Bad, Okay, Good, Amazing) and his Approve or Reject on Videos. Each judged render records the judge's levels beside his call when he makes one. Agreement = his Bad matches a judge "poor" or "weak", and his Good or Amazing matches no "poor". `wren video judge stats` shows the agreement per mode. A mode's judge gates once it agrees on enough calls (his number; see Open).

## Floor rules into Canon

New lines in `sop-content-principles` (a rule set, fixed line ids, through `knowledge`): every name said is on screen; no camera move eases to a dead stop; cut to the song's map (its sections and hits), not a fixed tempo; a new version sits beside the old, never over it; names are spelled as the brief. Each cites Raea's floor guide as its source. The measured checks cite the line ids they enforce.

## Sound cue map (William, 11-10, walk 7.3)

From the reel he sent: click = a thing pops up on screen; flash = a quick cut; whoosh = a scene change; glitch = text pops up; riser = builds tension. The kit (earshot `launch`, `sfx/fx/`) has `click`, `whoosh.short`, `whoosh.long`, `riser`, and `snap` (a camera shutter for a whip cut), which serves as flash. It has no glitch. Earshot's `forge` makes one in code (recipe `glitch`, MIT, no sample), so `make.mjs` adds a `glitch` role beside the `launch` kit. `ROLE_SAYS` gets the map's meaning per role, so the edit pass places them by it.

## Phases

1. **Manifest and measured checks.** `RenderManifest` from props; the shared layout functions; `platform-zones.ts`; the file checks (flash, contrast, loudness); ranks; `wren video check` runs them and stores ranked issues. Done when each check has a unit test on a synthetic edit that fails it, and a real edit's check runs in under 5 s.
2. **Approve gate.** Done when `approveVideo` refuses a P0 or P1 and a stale check, with a test for each, and the Videos page shows ranks.
3. **Rubric judge.** Done when `bar.ts` is the rubric, the model answers levels per mode, and the pass rule is in code.
4. **Floor rules.** Done when the five lines are in Canon and `knowledge render` shows them.
5. **Calibration.** Done when his calls record beside the judge's and `judge stats` shows agreement per mode.
6. **Sound cues.** Done when the kit has `glitch` and `ROLE_SAYS` carries the cue map.

## Risks

- Box math drifts from CSS. Guard: the shared functions, plus a story that draws each manifest box over a rendered still, so a drift is visible.
- Contrast on video behind captions changes every frame; one frame per span can miss a bright flash behind the text. Three frames per span (start, middle, end) take the worst.
- Too many P1 on old edits blocks work. The gate applies to renders checked after phase 2 ships; old approvals stand.

## Open (William)

- The calibration trigger: how many of his calls, at what agreement, before a mode's judge gates. Recommend 30 calls at 80%.
- An override on a P1 (Approve anyway, with a reason on the record), or none. Recommend none for P0, an override with reason for P1.

## Decision log

- 2026-11-10: Manifest from props (A) over Chrome measure (B) and pixels (C): true enough with shared layout functions, engine-neutral, runs before a render.
- 2026-11-10: flash = the kit's `snap`; `glitch` made with earshot forge, not bought.

# Studio quality floor (WA-1267)

Status: design, 11-10, goldfish reviewed. Source: `tasks/docs/11-09/sources/raea/audit.md` (Raea's `check`, `judge`, `floor.md`, `rubric.md`). Raea is FSL: we write our own code from its rules and copy none of its source.

Terms: **floor** = faults code can stop or measure, ranked P0–P3 (below). **Bar** = `BAR` in `studio/src/bar.ts`, the rules the model reads. **Output** = one rendered file of an edit (long, short-N, vertical, square, portrait); each has its own render hash, `<output>.hash` in `files` (`render-hash.ts`).

## Goal

No output reaches a platform with a fault that code can stop or measure. Today:

- `wren video check` (`studio/src/video-check.ts`) is one Gemini look at a contact sheet against `BAR`. It guesses at faults we can count: an overlay half off frame, a word under the like button, five flashes in a second.
- `wren video render --no-check` skips it, and a check error never fails a render.
- `approveVideo` and `swapShortMedia` (`inbound/src/video.ts`) read no check. `selfChecks` (`inbound/src/video-edit.ts:447`) only colors the Finish view.
- An approve also makes Facebook, LinkedIn and X drafts from the square or portrait output (`alsoDrafts`, `video.ts:483`). Those files are checked as `longProps` or not at all.
- The compositions name "General Sans" (`finish-look.ts:134`), but no font file loads. Each machine draws its own fallback, so the Mac and Lambda renders differ and no code can know a text's width.

Target:

1. Layout code refuses a fault before it is saved, where it can.
2. What layout cannot stop is measured at render end, ranked, and stored on the output's hash.
3. Approve and swap refuse any output they post while it has no current result or has a P0 or P1.
4. The model judges only taste, per bar line, and advises until its calls agree with William's.

## Non-goals

- Swapping Remotion for Raea or our own engine (WA-1268). Prevention lives in our layout code and the checks read props and files, so both survive a swap.
- The sound cue map (VE-10 to VE-14 in Canon `video-editing`). It conflicts with `SOUND_RULES` (`sounds.ts:125`: click = a mouse click, `pop` = an overlay in) and is not a floor item. Own task: WA-1291.
- Loudness: `loudness.ts` already corrects every render to `LOUDNESS` (-14 LUFS, -1.5 dBTP, within 0.5) and throws on a miss.
- Cue on its word, and names spelled as the brief: no data feeds them (`Sound` has no anchor, a `VideoEdit` has no brief or names). Their Canon lines stay; the checks wait for the data.
- Checks on text or image samples.

## The key choice: stop a fault, or find it

| | A. Find: manifest from props | B. Find: measure in Chrome | C. Find: pixels only | D. Stop: constrain the layout code |
|---|---|---|---|---|
| How | A pure function turns props into text boxes per time span; checks read it. | A measure mode writes each element's `getBoundingClientRect` per sampled frame. | OCR on sampled frames. | `overlaySchema` (`finish.ts:65`) and `placeWord` (`safe-zones.ts:160`) refuse a box off frame or under a platform's buttons, with widths from the font file; `reelLines` (`captions.ts`) holds a line long enough. A bad edit is never saved. |
| Truth | An estimate: the composition does not call our layout math; it draws in CSS (`index.tsx:240-297`). | Exact. | Misses styled text. | Exact once the font is bundled and measured (fontkit, MIT). |
| When | Before or after a render. | During a render only. | After a render. | At save, in the edit pass and in `wren video set`. |
| Survives a new engine | Yes. | No. | Yes. | Yes. |
| Gate needed | Yes. | Yes. | Yes. | No: the fault cannot exist. |

Priorities, in order: the result must be true; it must survive a new renderer (WA-1268); a fault is cheaper to stop than to find, rank and override.

**Recommend D** for every fault our layout makes (text off frame, under buttons, caption hold), plus measured file checks for what layout cannot see (flash, contrast, Short pace). A, B and C all find a fault after the edit made it, and A rests on a box estimate the browser does not share.

D needs one change first: bundle one font file in the studio package (Figtree recommended, see Open), load it in the compositions, and measure with fontkit from the same file. Every render's text then looks the same on the Mac and on Lambda. That is a visible change: today's Mac renders draw San Francisco.

## Faults and where each stops

Rank: **P0** a platform rule, a law or health; never ships, no override. **P1** a viewer sees it; blocks, overridable with a reason. **P2** below our bar; shows beside Approve. **P3** a note.

| Fault | Where | Rule | Rank |
|---|---|---|---|
| Text off frame | D: `overlaySchema`, `placeWord` | glyph box (font metrics, `textWrap: balance` lines) inside the frame margin | refused at save |
| Text under platform buttons | D: `overlaySchema`, `placeWord`; zones in a new `platform-zones.ts` | box overlaps an output's button zone by more than 10%. A vertical posts to YouTube, Instagram and TikTok: the union of their zones. Numbers come from each platform's published safe-zone guide, cited in the file. | refused at save |
| Caption hold | D: `reelLines` | a line holds at least `max(1 s, 0.3 s × words)`, extended into the gap after it or merged with the next line | never made |
| Flash | file, at render end | WCAG 2.3.1 general flash: a pair of opposite changes in relative luminance of 10% or more, the darker state under 0.80. Measured per tile on a 4×4 grid (each tile under WCAG's 25% area), so a flash in a corner counts. More than 3 in any 1 s. | P0 |
| Contrast | file, at render end | overlays and the big word only (captions carry their own stroke or pill, `finish-look.ts:256`). Text fill against the pixels in a ring around the glyph box, worst of 3 frames (start, middle, end), below 3:1 | P1 |
| Short pace | props, at render end | no picture change for more than 10 s: a kept-span cut, a layout mark or an overlay in or out. A Short's crop is one fixed point, so it does not count. Long videos have no pace rule, as in `BAR`. | P1 |
| | | more than 3 s | P2 |
| Private data on screen | model (bar `private`) | keys, tokens, emails, customer data in any frame | advice (P2) until he lets the judge gate |

Every result carries `{rank, rule, at, says, box?}`. `rule` keeps its name: `selfChecks` reads it (`video-edit.ts:334`).

## Results and the gate

- **Where results live.** The render writes one `video check` run per output at its end, `{output, hash, results}`, beside the loudness pass. The props-only pace check runs there too. The run's `hash` is the output's render hash. No run, or a null hash, counts as unchecked.
- **The gate.** `approveVideo` and `swapShortMedia` refuse when any output they post (the YouTube file and every `alsoDrafts` file) is unchecked on its current hash ("check it first: `wren video check <id>`") or has a P0 or P1. A P1 passes with `--override "<reason>"`; the reason and the P1s it passed go on a `video override` run. A check run that threw reads as unchecked. P2 shows beside Approve. The match reuses `selfChecks`' logic; the gate reads the newest check run per output by query, not from the capped step list (`STEP_MAX`).
- **The model.** `wren video check` runs after the file checks. A model failure no longer fails the run, and no model answer gates.
- **Before a render.** The edit pass and `wren video set` run D's rules and the pace check as warnings. The big word's place needs the matte made at render, so it is decided there.
- **Old outputs.** Approvals before phase 3 stand. An old output needs one `wren video check` before its next approve.

## Model judge

Each bar line goes to the floor or stays with the model:

| Bar id | Goes to |
|---|---|
| `text` | floor: off frame and under buttons (D), contrast (file). The "reads at phone size" half stays with the model. |
| `pace` | floor: Short pace |
| `captions` | font: fixed in code. 2–3 words at a time and no over-animation: model |
| `private` | model; advice only for now (William, 11-10) |
| `cuts`, `open`, `face`, `plain`, `hook`, `best` | model |

The model answers each line on five levels (poor, weak, fair, good, great) with one line of why, under a frozen prompt version stored on each answer. Code ranks the answer: poor = P1, weak = P2. The edit pass still reads all of `BAR` plus the floor rules (`editPrompt`), so the edit agent knows them.

## Calibration

The model judge calls Vireo video samples as a second judge, `by: judge:<version>`, beside William's calls (one call per judge per sample, already in Vireo). Map: his Bad (score 1–3) = "poor" or "weak"; Okay (4–6) = "fair"; Good (7–8) and Amazing (9–10) = "good" or "great". Per bar line, measure the precision and recall of the judge's "poor" against his Bad. A line's judge leaves advisory once it clears his threshold (see Open). Approve and Reject are not used: Reject covers a whole edit, and Approve is not a score.

## Floor rules into Canon

Add the lines not there yet. `video-editing`: no camera move eases to a dead stop; cut to the song's map, not a fixed tempo; a new version sits beside the old. `content-principles`: every name said is on screen; names are spelled as the brief. Each cites Raea's floor guide. The checks and schema refusals cite the line ids they enforce.

## Phases

1. **Stop at the source.** Bundle and load the font; fontkit text widths; `platform-zones.ts`; `overlaySchema` and `placeWord` refuse off-frame and under-button boxes; `reelLines` hold. Done when each rule has a unit test with a synthetic edit it refuses, and a story shows a Reels frame with its button zones drawn over it.
2. **File checks.** Flash, contrast and Short pace at render end, stored per output on its hash. Done when each has a test on a synthetic clip that fails it. Budget: under 1 s for props checks; file checks measured per minute of video on this Mac and noted here.
   - Built 11-10: `studio/src/render-checks.ts` (`floorChecks`), text boxes from the Figtree file with fontkit (`text-box.ts`). A run's stats: `{output, hash, floor: FLOOR_VERSION, pass, issues, modelError}`; `pass` = no P0 or P1. The model's issues are P2. `--no-check` became `--no-model`: the file checks always run.
   - Measured: flash reads 40 s of 720p in 1.0 s (about 1.5 s per minute). Contrast is 3 one-frame reads per text. The predicted text box sits within 3 px of the drawn glyphs (long, "3x more replies", size l).
3. **Gate.** `approveVideo` and `swapShortMedia` refuse as above, with a test for unchecked, stale, P0, P1 and P1 with override. The Videos page shows ranks.
4. **Model judge.** Bar lines mapped as above, levels per line, ranks in code.
5. **Floor rules.** The five lines in Canon; `knowledge render video-editing` shows them.
6. **Calibration.** Judge calls on Vireo video samples; `wren variants live`-style stats per bar line.

## Risks

- The bundled font changes how every render looks. A batch of before and after stills goes to William before phase 1 ships.
- Platform button zones change with app updates. `platform-zones.ts` dates each source; a stale date (over 6 months) is a P3 note.
- A 4×4 tile grid finds a flash smaller than WCAG's area rule and so flags a little more than WCAG. That errs toward health.
- Old edits with saved overlays that now fail D: `wren video set` refuses only a changed overlay, and the render warns on an old one.

## Decided (William, 11-10)

- Font: Figtree (OFL; the portal ships it). General Sans's license (ITF FFL 2.0) bars it from a repo, a public server and any service third parties make content with. Styling gets its own Vireo loop soon, so phase 1 only bundles and loads the font.
- P1 override with a reason on record: yes. P0: none.
- The model judge does not block anything yet, `private` included: every judge rank shows as advice. Calibration still records; when a line clears 30 calls at 0.8 precision, ask him before it gates.

## Decision log

- 2026-11-10: Stop faults in layout code (D) for text and captions; measure only flash, contrast and Short pace. Over a props manifest (A), Chrome measure (B) and OCR (C): a fault that cannot be saved needs no rank or override, and A's boxes are an estimate the browser does not share.
- 2026-11-10: Calibrate on Vireo calls with the judge as a second caller; no new store.
- 2026-11-10: goldfish review: 37 findings (critic 15, reader 15, zoom-out 7), 31 applied, 6 rejected or shrunk (glossary cut to three terms; no `names` field or cue anchor added; loudness check dropped as already enforced). Open: calibration threshold, P1 override, bundled font.
- 2026-11-10: Phase 3 built: `render-gate.ts` (`passGate`, `postedOutputs`, `onThisRender`). The newest check per output is read by `argv.output`, so a failed check hides an older pass. A swap skips a blocked Short and names it in `missing`. The Videos page ranks by the same rule: P0 can't ship, P1 needs a fix or a reason, P2 is advice.

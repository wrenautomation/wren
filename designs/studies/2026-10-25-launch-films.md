# Launch films study (2026-10-25)

Fifteen product launch films, read for the autobrowse demo film. Data: `2026-10-25-launch-films.json`
(the competitor analyzer's `film` facts, designs/2026-10-25-competitor-analyzer.md, decision 5).
Media stays in `.scratch/launch-films`, never the repo.

## Method

- yt-dlp, 720p. Cuts by four signals: PySceneDetect 0.7.2 `detect-hash` and `detect-adaptive`, ffmpeg `scene>0.25`,
  `blackdetect` (d=0.3, pix_th=0.1). Loudness: ffmpeg `ebur128`, integrated.
- Hand shots from 2 fps contact sheets (0.5 s grid) for the five films nearest ours. The rest: cuts only, no labels.
- On-screen text: `wren video watch --every 1` (ffmpeg frames, Cohere vision). Cohere reads nothing on very dark frames (Linear Agent 32-47 s).

## Detector check (hand count is the judge)

| Film | Hand | PSD hash | PSD adaptive | ffmpeg 0.25 | fades |
|---|---|---|---|---|---|
| Linear Agent | 9 | 8 | 9 | 1 | 3 |
| Linear Releases | 7 | 6 | 1 | 1 | 2 |
| Linear for Agents | 12 | 11 | 1 | 1 | 6 |
| Raycast 2026 | 15 | 15 | 5 | 8 | 1 |
| Browserbase Director 2.0 | ~35 | 44 | 11 | 4 | 1 |

Counts are shots. `detect-hash` is within 20% of the hand count on four of five films. It also finds
word swaps on black and 0.5 s cards. On Director it over-counts the macro montage (+26%). Adaptive and
ffmpeg miss swaps, cards and dark fades. `cuts_trust` is `low` when detectors disagree by more than 2x.

## The films

| Film | s | Shots | Median s | LUFS | What it does |
|---|---|---|---|---|---|
| Linear Agent | 55 | 9 | 5.5 | -28.9 | Real UI on dark tilted planes, spotlight, slow track. Fades through black. |
| Linear Releases | 30 | 7 | 4.5 | -24.7 | Macro of a graph, planes stacked in depth, mono caps cards with a block caret. |
| Linear for Agents | 33 | 12 | 2.5 | -17.4 | Flat UI closer in, word swap card ("Agents for Coding / Triage / Planning"). |
| Raycast 2026 | 39 | 15 | 2.1 | -13.2 | UI 3-4x, cropped past the edge, satin backdrop. Ends on 9 mono cards, 0.5 s each. |
| Browserbase Director 2.0 | 77 | ~35 | 3.5 | -12.9 | Nearest rival. Manual way as macro montage, then prompt, agent log, cubes, result sheet, CTA. |
| Framer (2) | 37 | 7 | 1.7 | -15.7 | Morphs: a site builds itself, pulls back to the editor. Few hard cuts. |
| Arc 1.0 / Max | 34 / 18 | 23 / 12 | 0.9 / 1.2 | -11.5 / -21.6 | Archive montage, serif word cards. Brand voice, low fit. |
| Comet (rival) | 72 | 6 | 6.9 | -17.6 | Cream paper, serif, word roll, floating UI plates. |
| Cursor 3, Browserbase PH, Anthropic CU (rivals) | 90-133 | 16-29 | 3-8 | -14.7 to -27.3 | Talking heads and flat recordings with burned-in captions. A 15 s static dialog. |
| Dia, OpenAI devices (rivals) | 78 / 148 | 44 / 72 | 1.4 / 1.8 | -17.8 / -16.4 | Live action with UI inserts. Out of scope. |

## What the craft films share

1. Length 30-55 s. Rivals run 72-148 s.
2. Real product UI, never a mock. The camera, light and focus make it a film.
3. One move per shot: track, push, orbit or roll. Holds of 2-8 s on UI. Median 2-5.5 s.
4. Planes tilted in 3D, lit by a spotlight, with a vignette and shallow focus. The focus area stays sharp.
5. Text is short and set small: centered sans, or mono caps with a block caret. Words swap in place.
6. Joins are fades and dissolves through black, not hard cuts. Fast cuts only in a montage or a card run.
7. End: tagline, then the wordmark alone on black for 2-4 s. A CTA, if any, is two words ("AVAILABLE NOW").
8. Music only, no voice. Loudness spreads -13 to -29 LUFS; ambient films sit low.

## Where autobrowse beats Director 2.0

Director has our story shape: the manual way, the prompt, the agent at work, the result, the CTA.
Its weak parts: slogan cards ("What used to take hours / Now takes seconds"), clip-art cubes, 77 s long,
and a flat agent log. Ours: real sites (Cloudflare, X, LinkedIn, Learn), filmed on Linear-grade
planes, 45 s, no slogan cards.

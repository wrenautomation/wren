# Film standard: product launch films (2026-10-25)

The bar for every Wren product film. It comes from the launch films study
(`studies/2026-10-25-launch-films.md`): Linear, Raycast and Framer for craft; Browserbase Director 2.0
as the nearest rival. First film: the autobrowse demo (bead wa-qtyo.7).

## Target

A 40-50 s film of real recordings. Each shot looks like a Linear shot: a real page on a lit plane in
3D, one slow move, shallow focus. Text is small. Music only, no voice. The match check puts our frames
beside Linear Agent and Director 2.0. It passes when ours reads as Linear's class and holds no slogan card.

## Numbers

| Part | Rule |
|---|---|
| Length | 40-50 s. 16:9, 1920x1080, 60 fps. |
| Shots | 9-14. UI holds 2.5-6 s, median about 3.5 s. Cards 1.5-2.5 s. |
| Moves | One per shot, for the whole shot, eased in and out (sine). No still frame on UI. |
| Joins | Dip through black between sections: out 6 beats, in 10 beats. Hard cuts only inside a card run. |
| Type | One sans (Figtree). Cards: 5 words or fewer, 48 px, weight 600, tracking -0.02em, centered. Mono caps cards: 30 px, tracking 0.08em, typed 20 chars/s, block caret. |
| Words | A word swaps in place, 0.5-0.8 s a word. No slogan, no claim line ("hours to seconds"). |
| End | Tagline 2 s, then the wordmark alone 2.5-3 s, then the install line. |
| Sound | Music bed only, no voice. -16 LUFS integrated, true peak -1 dBTP. UI sounds 18 dB under the bed, low-passed, no whoosh. A 10 s sample goes to William before a full render. |
| Masks | Blur account IDs, emails, phone numbers, other people's names and faces. Codes are synthetic. |

## Moves

All moves are CSS 3D on the take's window, by the scene's progress `p` (0 to 1). The values are the
start and end of the shot.

| Move | What | Values |
|---|---|---|
| track | slow drift across the plane | x +4% of frame, zoom 1.15 |
| push | in toward the focus point | zoom 1.0 to 1.2 |
| pull | out from the focus point | zoom 1.25 to 1.0 |
| orbit | plane turns on its vertical axis | rotateY -12 to -4 deg, rotateX 18 deg |
| roll | Dutch: plane tilted back, turned and rolled | rotateX 28, rotateZ -8 to -5 deg, zoom 1.6 |
| macro | page 2.5-4x, cropped past the frame edge | zoom 3.0 to 3.2, centered on the act |
| rack | focus pulls from soft to sharp | blur 8 to 0 px in 0.6 s, then track |

- Light: a spotlight on the focus point (radial, falloff at 45% of the frame), outside dimmed to 35%.
  A vignette at the edges.
- Focus: sharp in a band around the focus point, blur up to 6 px outside (`backdrop-filter`, radial mask).
- The auto camera (`camera.ts`) still finds the focus point from the take's log. A move rides on top of it.

## Kit: what exists, what is new

Exists in `packages/studio` (designs/2026-10-24-filmed-takes.md): takes from `autobrowse film`, the
auto camera, the drawn cursor and its ring, the window bar, the promo scenes, entrances, the sound
kit, 60 fps renders.

New, all in the promo script and `remotion/index.tsx`:

1. `lens` on a take or screen scene: `move`, `light`, `focus`, `tilt`. A `Stage` wraps the window.
2. Entrance `dip`: in from black. With the old fade out, two scenes meet through black.
3. Text scene `style: "caps"` (mono caps, typed, block caret) and `swap` (the last word changes in place).
4. End scene `tagline` (shows before the title) and `mark: "pill"` (07: the accent pill grows into the wordmark).
5. Look `dark`: background #0b0c10, foreground #ececee. Craft films are dark.

Not used, on purpose:
- `@remotion/three`: a video on a WebGL plane re-samples the page and softens small text.
  CSS 3D keeps the page sharp. Headless Chrome also renders WebGL slowly.
- `@remotion/transitions`: our joins are dips through black, so scenes stay back to back.
  A true dissolve needs overlapping scenes; it waits until a film needs one.
- `@remotion/motion-blur`: moves are slow. Blur would cost 5-10x render time for no visible gain.

## The autobrowse film (shot plan)

Real recordings with `autobrowse film`. Learn comes from Storybook on synthetic data, never the prod portal.

| # | s | Shot | Move |
|---|---|---|---|
| 1 | 3 | Terminal: the ask to Claude Code, typed | rack |
| 2 | 5 | Cloudflare sign-up: the agent types the email | roll |
| 3 | 3 | The code arrives in Messages, the agent fills it (synthetic code) | macro |
| 4 | 3 | Card: "autobrowse learns the flow" | caps |
| 5 | 4 | The flow it wrote, as plain steps | track |
| 6 | 5 | X: the agent writes a post, stops before Post | orbit |
| 7 | 5 | LinkedIn: the same, stops before Post | roll |
| 8 | 4 | Learn: the run in Wren's Learn app | push |
| 9 | 3 | Terminal: done, the list of runs | pull |
| 10 | 7 | End: pill into the wordmark, `npm i @wrenautomation/autobrowse` | pill |

Nothing posts. A post needs William's yes and his caption.

## Decision log

- 2026-10-25: standard from the 15-film study. CSS 3D over three.js. Dips over dissolves.
  Figtree for the wordmark (07 v3 frames). Sound: bed plus soft UI ticks, sample first.

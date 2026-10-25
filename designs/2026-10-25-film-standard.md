# Film standard: product launch films (2026-10-25)

The bar for every Wren product film. It comes from the launch films study
(`studies/2026-10-25-launch-films.md`): Linear, Raycast and Framer for craft; Browserbase Director 2.0
as the nearest rival. First film: the autobrowse demo (bead wa-qtyo.7).

## Rules

The brand rules (length, shot count, holds, type, words, end, sound, masks) live in the SOP:
`sops/launch-films/notes.md` (private). This doc keeps the engineering: the moves and the kit.

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
- The lens owns the zoom. Under a lens the camera gives only the focus point; its zoom and its whoosh stay out.
  The cursor arrow and ring divide by the lens scale, so they keep their size.
- The focus point comes to the frame's middle as the lens closes in: by `min(1, scale - 1)`.

## Kit: what exists, what is new

Exists in `packages/studio` (designs/2026-10-24-filmed-takes.md): takes from `autobrowse film`, the
auto camera, the drawn cursor and its ring, the window bar, the promo scenes, entrances, the sound
kit, 60 fps renders.

New, all in the promo script and `remotion/index.tsx`:

1. `lens` on a take or screen scene: `move`, `light` and `focus` (both on by default). `Lensed` wraps the window.
2. Entrance `dip`: in from black. With the old fade out, two scenes meet through black.
3. Text scene `style: "caps"` (mono caps, typed, block caret) and `swap` (the last word changes in place).
4. Text `style: "card"` (small, centered, lines blur in). End scene `tagline` (shows before the title) and
   `mark: "pill"` (07: the accent pill grows into the wordmark).
5. Script `theme: "dark"` (`DARK_LOOK`): background #0b0c10, foreground #ececee, Figtree. Craft films are dark.
6. Fonts from `@remotion/google-fonts`: Figtree and Geist Mono, loaded before the first frame.

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
| 1 | 3 | Terminal: `autobrowse cloudflare-token …`, typed | rack |
| 2 | 5 | Cloudflare: the agent names the token and picks its permission | roll |
| 3 | 3 | Create Token clicked, then the terminal's `stored as` line (account id masked) | macro |
| 4 | 3 | Card: William's words (placeholder `THE FLOW`) | caps |
| 5 | 4 | The flow's source (`cloudflare-token.ts`) in the terminal | track |
| 6 | 5 | X: the agent writes a post, stops before Post | orbit |
| 7 | 5 | LinkedIn (the Wren page): the same, stops before Post | roll |
| 8 | 4 | Learn, from Storybook: Today, the alerts, Home | push |
| 9 | 3 | Terminal: `autobrowse workflows` and `flows` | pull |
| 10 | 7 | End: pill into the wordmark, `npm i @wrenautomation/autobrowse` | pill |

Nothing posts. A post needs William's yes and his caption. Every shot is a real run: the token is
a real one with one read permission, revoked after the take. The flow never shows the token's value.
The account id and the account's email sit under `mask` blocks (a take scene's `mask`, px on the pane,
for a time range), or the cut skips them.

## Decision log

- 2026-10-25: standard from the 15-film study. CSS 3D over three.js. Dips over dissolves.
  Figtree for the wordmark (07 v3 frames). Sound: bed plus soft UI ticks, sample first.
- 2026-10-25: brand rules moved to `sops/launch-films/notes.md` (William's yes). Kit built: lens, dip,
  card, caps, swap, tagline, pill, dark theme. `tilt` dropped: each move sets its own angles.

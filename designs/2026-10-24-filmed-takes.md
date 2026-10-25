# Filmed takes in the promo (2026-10-24)

Bead wa-qtyo.7 (the autobrowse X demo). autobrowse films a run as a take
(autobrowse `designs/2026-10-24-film.md`): each page as video plus a log of every pointer move,
click and key. This doc says how the studio makes it cinematic: a drawn cursor, zooms that follow
the action, click feedback and sounds on each click and key.

## Decision

- A take plays in the promo, as a new scene kind `take`. The X demo is the promo's shape: no
  voice, scripted shots, a caption a shot, an end card. The promo has the camera
  (`cameraAt`, `framing`), the framed card, captions, the kit sounds and the end card already.
  The long video's parts (face, words, silence cuts, Shorts) do nothing here.
- A promo render posts like any file: `wren content add --media out/promo.mp4`.
- The camera, the cursor and the sounds come from rules on the take's log, as pure functions
  beside `autoSounds`. A script's own `moves` replace the auto camera.
- A script with a take renders at 60 fps (`fps` on the script: 30 or 60; unset, 60 with a take,
  else 30). Scenes still count beats, 30 a second (`PROMO_FPS`): words, toasts and entrances move
  the same at either rate. The composition maps beats to frames (`useBeat`, the scene
  `Sequence`s); sounds are placed in seconds.

## The scene

```json
{ "kind": "take", "take": "takes/compose", "pane": "web-1", "from": 2.0, "to": 9.5,
  "caption": "…", "camera": "auto", "zoom": 1.8, "beside": "term", "title": "Terminal" }
```

- `take`: a take folder beside the script (`autobrowse film --out <script dir>/<take>`). The
  script's folder is Remotion's public dir, so the panes play from there with no copy.
- `pane`: which video (default the first web pane).
- `from` / `to`: seconds on the pane, so one take gives more than one shot. `from` defaults to 0,
  `to` to the pane's end; a `to` past the end stops the render with the pane's length.
- `camera`: `auto` (the rules), `none` (the whole page), or `moves` as in a screen scene.
  `zoom`: how close `auto` goes.
- `beside`: a second pane on the same clock (`besideAt`: both panes log epoch times). It sits
  first: left in wide, top in tall. A pane not open yet at the cut opens when it opened.
- `title`: a terminal's window bar.
- `seconds` is `to - from`. No 30 s cap: a take shot can be as long as the pane.

## Camera rules (`camera.ts`)

Screen Studio's behaviour, as rules with knobs:

1. A cluster is acts (clicks, typing) less than `joinS` (2.5 s) apart.
2. Before a cluster: ease in over 0.6 s, to `zoom` (1.8) centred on the first act's point.
3. In a cluster: a key on each act (a click's point, a focused field's middle, the field again on
   each key). `cameraAt` eases from key to key, so the centre glides; no spring is needed.
4. After a cluster: hold 1 s, then ease out over 0.6 s to the whole page.
5. A page load ends a cluster, and a load inside the hold eases out at once.
6. No edge of the page ever shows (`framing` already clamps).

Output: camera keys `{ at, x, y, zoom }`, `at` in seconds of the shot, which `cameraAt` plays.
The log is cut 4 s before `from`, so a shot cut inside a cluster starts zoomed where the camera
was; `clip` puts a key at 0 and at the end.

## Cursor (`cursor.ts` + the composition)

- The path is the log's `move` and `down` points, joined in straight lines. The hands log about
  60 points a second on their own curve, so no spring: a spring would only add lag.
- A macOS-style arrow, drawn in SVG, 3.2% of its window's width, on the page under the camera
  (it grows as the camera pushes in, as a screen recording's does).
- Press: the arrow scales to 0.85 on `down` and springs back on `up`. A ring spreads from the
  point and fades in 0.35 s.
- After 1.5 s still, the cursor fades out. It fades in when it moves.

## Sounds

The existing kit roles, with no new ones: `click` on each `down`, `key` on each key,
`key.space` on a space, `key.return` on Enter, `whoosh.short` (soft, -6 dB) on each zoom in,
plus the promo's own sounds on cuts. `spaced` keeps a fast run to the role's gap. Keys come from
the take's log, so no recorder is guessed.

## Look

- Each pane sits in a window (radius 20, the screen scene's shadow) with a bar: the three lights
  (#ff5f57, #febc2e, #28c840). A web bar is light and shows the page's address from the log's
  `load` events. A terminal bar is the look's foreground and shows `title`.
- Side by side the windows share a height; stacked, a width. Each keeps its page's shape.
- A caption sits under the windows, as in a screen scene.

## Code

| file | change |
|---|---|
| `src/take.ts` (new) | read and check `take.json` (zod); pane events in seconds |
| `src/camera.ts` (new) | `autoCamera(events, size, seconds, knobs)`, `clip`: the rules above; pure, tested |
| `src/cursor.ts` (new) | `cursorTrack(events)` once in the props, `cursorAt(track, t)` each frame: point, press, ring, fade; no imports, so the bundler takes it |
| `src/promo.ts` | `take` scene, `fps`, `takeShot` (the shot's videos, keys, track, sounds), `takeSounds` |
| `src/promo-clock.ts` | `PROMO_FPS` moves here, for the composition's `useBeat` |
| `remotion/index.tsx` | `useBeat`, the beat-to-frame `Sequence`s, `PromoTake`, `TakeWindow`, `WindowBar` |
| `src/sounds.ts` | `RecordingEvents` comment: Cap or a take; the rule text loses "(Cap)" |
| `src/cap.ts` | header: kept for a return to Cap; nothing else |
| `apps/cli` `video promo` | `readTake` each take beside the script, then `promoProps(..., { takes })` |

## Needs

ffmpeg stays as it is: `WREN_FFMPEG`, else `ffmpeg` on the PATH. The error says
`brew install ffmpeg`. Remotion ships its own ffmpeg, but no public way runs it here: `npx remotion
ffmpeg` stops on a version check, and the bare binary needs `DYLD_LIBRARY_PATH`. Filming needs
ffmpeg and ttyd on the Mac that films (autobrowse checks those).

## Proof

A 13 s promo (a text card and a 10 s shot of take2: the terminal beside the browser, a click on a
link that loads a page) rendered at 60 fps, 1920x1080, in 1 min 51 s on the Mac. The autobrowse
panes are variable frame rate (11 frames over 28 s on a still page): `OffthreadVideo` holds each
frame through its hold, so no constant-rate copy is needed.

## Later

- `finish.blur`: `@remotion/motion-blur` on fast camera moves. It renders several samples a
  frame, so it waits until a cut needs it.
- The long video's `screen` layout can use the same camera and cursor when a take carries a voice.
- The meta video (Claude Code asks autobrowse to post it on X).

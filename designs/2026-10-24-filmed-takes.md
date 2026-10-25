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
- A script with a take renders at 60 fps (`fps` on the script; default 30 as now).

## The scene

```json
{ "kind": "take", "take": "takes/compose", "pane": "web-1", "from": 2.0, "to": 9.5,
  "caption": "…", "camera": "auto", "beside": "term" }
```

- `take`: a take folder beside the script. `pane`: which video (default the first web pane).
- `from` / `to`: seconds on the pane, so one take gives more than one shot.
- `camera`: `auto` (the rules), `none` (the whole page), or `moves` as in a screen scene.
- `beside`: a second pane on the same clock, side by side (shot 2: the terminal and the browser).
- `seconds` is `to - from`.

## Camera rules (`camera.ts`)

Screen Studio's behaviour, as rules with knobs:

1. A cluster is acts (clicks, typing) less than `joinS` (2.5 s) apart.
2. Before a cluster: ease in over 0.6 s, to `zoom` (1.8) centred on the first act's point.
3. In a cluster: the centre follows the pointer, through a critically damped spring, so it trails
   and does not jitter. Typing holds the centre on the focused field's box.
4. After a cluster: hold 1 s, then ease out to the whole page.
5. A page load eases out at once.
6. No edge of the page ever shows (`framing` already clamps).

Output: camera keys `{ t, x, y, zoom }`, which `cameraAt` already plays.

## Cursor (`cursor.ts` + the composition)

- The path is the log's `move` points. A spring smooths it at 60 fps; the hands' curve stays.
- A macOS-style arrow, drawn in SVG, sized by the zoom (it grows as the camera pushes in).
- Press: the arrow scales to 0.85 on `down` and springs back on `up`. A ring spreads from the
  point and fades in 0.35 s.
- After 1.5 s still, the cursor fades out. It fades in when it moves.

## Sounds

The existing kit roles, with no new ones: `click` on each `down`, `key` on each key,
`key.space` on a space, `key.return` on Enter, `whoosh.short` (soft, -6 dB) on each zoom in,
plus the promo's own sounds on cuts. `spaced` keeps a fast run to the role's gap. Keys come from
the take's log, so no recorder is guessed.

## Look

- A web pane sits in the promo's framed card (radius, shadow), as a screen scene does.
- A terminal pane gets a window bar: three dots and a title, in the look's colours.
- Optional `finish.blur`: `@remotion/motion-blur` on fast camera moves (same vendor, free). It
  renders several samples a frame, so it is off unless the script asks.

## Code

| file | change |
|---|---|
| `src/take.ts` (new) | read and check `take.json` (zod); pane events in seconds |
| `src/camera.ts` (new) | `autoCamera(events, size, knobs)`: the rules above; pure, tested |
| `src/cursor.ts` (new) | `cursorAt(events, t)`: point, press, ring, fade; pure, tested |
| `src/promo.ts` | `take` scene, `fps`, take sounds in `promoSounds` |
| `remotion/index.tsx` | `PromoTake`: `OffthreadVideo` panes, the camera, the cursor, the window bar |
| `src/sounds.ts` | `RecordingEvents` comment: Cap or a take; the rule text loses "(Cap)" |
| `src/cap.ts` | header: kept for a return to Cap; nothing else |
| `apps/cli` `video promo` | copy each pane into the render's public dir; check ffmpeg first |

## Needs

ffmpeg stays as it is: `WREN_FFMPEG`, else `ffmpeg` on the PATH. The error says
`brew install ffmpeg`. Remotion ships its own ffmpeg, but no public way runs it here: `npx remotion
ffmpeg` stops on a version check, and the bare binary needs `DYLD_LIBRARY_PATH`. Filming needs
ffmpeg and ttyd on the Mac that films (autobrowse checks those).

## Later

- The long video's `screen` layout can use the same camera and cursor when a take carries a voice.
- The meta video (Claude Code asks autobrowse to post it on X).

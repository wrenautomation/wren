---
type: object
cluster: platform
universe: live
status: verified
verified: 2026-10-29 @ ef481a93
entity: packages/video/src/recorder.ts:283
covers: ["@wren/video"]
stamp: 96cf846f
---

# screen-video

Screen videos of web pages, made in code: `openRecorder` walks a page while the browser streams frames, `encode` turns the frames into an mp4 and a poster, `publish` puts them where a watch page plays them. Package `@wren/video`. It knows no leads, clients or products: a product writes the walk.

## Why this shape

The browser streams a frame each time the page changes (CDP screencast) at twice the viewport's size, and the mouse really moves and clicks. Zooms and captions are only noted with the second they start; ffmpeg applies them in `encode`, so nothing on the page moves and a zoomed view stays sharp. The recording is plain data once the browser closes (`timeline.ts`), so the encoder and its tests need no browser. The cursor, press ripple and full-screen card live in a shadow root on `<html>` (`overlay.ts`), so the app's styles never touch them; it is plain JavaScript in a string, since a compiled function can carry bundler helpers the page lacks. A published video's id is the only way in, so it is random and long.

## Shape

- `openRecorder` (`recorder.ts:283`), Playwright loaded only then
- `encode` (`encode.ts:104`): steady 30 fps, zooms, captions as pictures
- `capturePage` (`capture.ts:14`): one still, for a promo's screen scene
- `publish` (`publish.ts:32`): `v/<id>.mp4`, `v/<id>.jpg`, `v/<id>.json` in a CDN bucket
- callers: [[reactivation/demo-video]] (`packages/reactivation/src/video/`), the studio promo (`packages/studio/src/promo.ts`, `finish-look.ts`), slides (`packages/core/src/content/slides.ts`), `apps/cli`

Citations: `packages/video/src/index.ts:1`, `packages/video/src/publish.ts:32`

## Connected to

- **owned-by:** none (a tool for products)
- **joins:** lander `functions/v/[id].ts` (the watch page reads `v/<id>.json`)
- **looks-like-but-is-not:** [[content/video-edit]] (an edit of a filmed video); falcon `watch` (reads a video, never makes one)

## If you change this

- **Hits:** [[reactivation/demo-video]], the studio promo, lander's watch page (the `v/` layout)
- **Does not hit:** autobrowse (its own browser)

## Surfaces

| Surface | Role |
|---|---|
| lander `/v/<id>` | plays what `publish` wrote |

## See

- Source: `packages/video/src/`

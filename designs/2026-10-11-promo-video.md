# Promo videos from a script

2026-10-11. From a reel in William's notes (a product launch video: kinetic lines, notification
toasts, the dashboard with the camera pushing in, numbers counting up, an end card).

## Decision

A fifth Remotion composition, `Promo`, beside Long/Short/Vertical/Thumbnail. It renders a JSON
script; no camera, no voice, no DB. Claude Code writes the script, so a promo for a client, an
offer or a new feature is a file and a 30 second render.

`wren video promo <script.json>`: screens with a `url` are captured first (`capturePage`,
`@wren/video`, Chromium at 2x, cached as `shot-<n>.png`); then `out/promo.mp4`. `--still <s>`
renders one frame to check a layout.

## Script

```json
{
  "format": "wide | tall",
  "look": { "accent": "#7969a3" },
  "music": "track.mp3",
  "scenes": [
    { "kind": "text", "lines": ["You posted 40 videos.", "Which one booked the call?"], "accent": ["booked"] },
    { "kind": "toasts", "title": "This week", "items": [{ "title": "Call booked", "body": "From YouTube" }] },
    { "kind": "screen", "url": "https://…", "caption": "…",
      "moves": [{ "at": 0.7, "x": 0.3, "y": 0.3, "zoom": 1.8 }],
      "highlight": { "x": 0.08, "y": 0.2, "w": 0.45, "h": 0.25, "from": 0.6 } },
    { "kind": "stat", "items": [{ "value": 212, "label": "Leads" }] },
    { "kind": "end", "title": "Wren", "sub": "…", "url": "wrenautomation.com" }
  ]
}
```

- Every scene's `seconds` is optional: text by word count (2 to 6s), toasts by count, screen 4s.
- Positions are shares of the image (0 to 1), so a script survives a new capture size.
- The screen box takes the image's shape, so marks land where the script says.

## Why not

- **Hand-edited in an editor:** not repeatable per client or per feature.
- **The demo walk recorder:** it films a live session; a promo is a cut of stills and type, faster
  to change and to render.
- **Voice or music generation:** music is his file or none; voice is out until he wants one.

## Code

`packages/studio/src/promo.ts` (script schema, `promoProps`), `promo-clock.ts` (easing, camera,
counters; no imports, for Remotion's bundler), `remotion/index.tsx` (`Promo`), `remotion.ts`
(`renderPromo`), `apps/cli/src/studio.ts` (`promo`).

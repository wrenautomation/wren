# Make and read a batch

## batch.json

```json
{
  "why": "Batch 3: named places beat questions (batch 2). Now test a next step vs none.",
  "agent": "<your session id>",
  "samples": [
    { "body": "…", "name": "Next step", "parents": [22], "guides": [1], "change": "adds a next step" },
    { "media": "https://a1b2c3d4.example.pages.dev/", "posterFile": "out/scene-a.jpg", "change": "flow field, slower drift" },
    { "file": "out/cut-b.mp4", "posterFile": "out/cut-b.jpg", "name": "Low captions", "parents": [{ "id": 31, "took": "the cut" }, { "id": 29, "took": "the caption font" }], "change": "captions 20% lower", "studio": { "edit": 12, "format": "short" } }
  ]
}
```

Paths are relative to the json file. Playable: mp4 mov m4v webm jpg png gif pdf.

## Fields

- `why`: what you changed from the last batch and what it tests. Cite batches by their number ("batch 2").
- `name`: 2-4 words he can say ("Star system").
- `parents`: `[id]` or `[{"id": 7, "took": "the moving headline"}]`, main parent first. Two or more = a cross; say what each gave in `took`. See `tree.md`.
- `change`: what differs from the main parent.
- `guides`: ids of the guides this sample applies.

## By kind

- **Text**: inline `body`.
- **Image**: `file`.
- **Video**: render with studio, then `file` (mp4) + `posterFile` (jpg), and `studio: {edit, format}` (or `source: {ref, spans}`) so he can play cuts of one footage in step.
- **Page, static**: full html in `body` (a sandboxed frame; no scripts run).
- **Page that runs code** (WebGL, scroll scenes): deploy to a URL that never changes (a Cloudflare Pages preview, `https://<hash>.<project>.pages.dev`), then `media: "https://…"` + `posterFile` (a still at 1280×800). The portal frames only `*.pages.dev`. The page must not send `X-Frame-Options` or a `frame-ancestors` that shuts out `app.wrenautomation.com`. He runs one at a time, at 1280 or 390, and full screen.

## Spread on purpose

Each batch tests one or two ideas. Vary one thing per sample when you can, so his calls teach something.

## After `add`

Tell him: `<subject>` batch N waits in Variants › Batches (`n` from `add`). Stop. In the portal he marks, then presses Hand to Vireo: that closes the batch and tells the Vireo chat. In a Claude Code session he tells you himself.

## Read `show`

- Per batch: his `note` (his guide for the next batch; obey it first).
- Per sample: `score` 1-10 and its zone `verdict` (bad 1-3, okay 4-6, good 7-8, amazing 9-10), and `notes`: `quote` = a line, `box` = a region in fractions, `time` = seconds on a video.
- `leaders`: Plackett-Luce strengths across all batches.
- `guides` with `effect`; `steers` and `pruned` (`tree.md`).

Keep what high scores share; within a zone, the higher score wins. Okay = no harm, no pull. Fix every anchored Bad note.

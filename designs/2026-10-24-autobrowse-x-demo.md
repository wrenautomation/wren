# autobrowse X demo: shot list (2026-10-24)

Bead wa-qtyo.7. A standard product video for X: about 45 s, no face, no voice, screen only.
autobrowse films it (designs/2026-10-24-filmed-takes.md). He writes every caption. This file says what each shot shows and
which fact its caption carries. It gives no wording.

## Shape

- Wide, 1920x1080. X plays it muted first, so the captions carry the story.
- One caption line at the bottom of each shot. About 8 cuts in 45 s (the OpenFilm reel's rate).
- Sound: the earshot launch kit, placed by the rules: `click` on each click, `key` on each key,
  `whoosh.short` on each zoom in. A bed is the script's `music`: a kit bed once one is in the
  kit (`wren video sfx add`), or his own file.
- Real runs only. Every number on screen comes from the filmed run.

## Shots

| # | s | Shows (a take scene) | Caption carries |
|---|---|---|---|
| 1 | 4 | A browser agent clicks through X compose. The token count goes up. | The problem: an agent pays for model calls on every run. |
| 2 | 7 | `autobrowse agent x "<goal>"` in the terminal beside the browser. The agent finds compose and drafts. | Explore once, with a model. |
| 3 | 5 | `autobrowse compile`. Then scroll the flow's TypeScript in `workflows/<name>/`. | What worked becomes plain Playwright code you can read. |
| 4 | 6 | `autobrowse try <name>`: the same steps, fast, no model in the loop. | Replay has no model. |
| 5 | 4 | Two lines side by side: the explore run's cost and the replay's cost ($0). | The cost of each run, from this recording. |
| 6 | 7 | The replay stops before Post and waits. He clicks yes. The post goes up. | Anything that sends in your name waits for your yes. |
| 7 | 6 | Optional: a step breaks (X moved a button). The agent finishes it and rewrites the step. | A broken step heals itself once, then replays at $0 again. |
| 8 | 4 | End card: `npm i @wrenautomation/autobrowse`, the GitHub repo. | Where to get it. |

Cut 7 if the take is over 45 s.

## Capture

- One tape per shot: `autobrowse film <tape> --out takes/<shot>`. autobrowse types the commands
  and records the terminal and every browser it opens.
- The X account on screen is a public one. No DMs, no other people's data, no keys or tokens in the terminal.
- `autobrowse explore` leaves a bearer token in `$TMPDIR`: never `cat` it on screen.
- Shot 6 posts for real, so that take waits for William's yes. Practice takes stop before Post.

## Edit

1. A promo script: one `take` scene a shot, `camera: "auto"`, his caption on each, the end card.
2. `wren video promo <script>`: cursor, zooms and sounds come from the takes.
3. `wren content add --media out/promo.mp4` drafts the X post.

## Gaps

- The terminal window bar is new (filmed-takes doc). A device frame round the browser is not built.

# autobrowse X demo: shot list (2026-10-24)

Bead wa-qtyo.7. A standard product video for X: about 45 s, no face, no voice, screen only.
William records it in Cap. He writes every caption. This file says what each shot shows and
which fact its caption carries. It gives no wording.

## Shape

- Wide, 1920x1080. X plays it muted first, so the captions carry the story.
- One caption line at the bottom of each shot. About 8 cuts in 45 s (the OpenFilm reel's rate).
- Sound: the earshot launch kit, placed by the rules. Cap clicks get `click`, key presses get `key`,
  each caption gets `pop`, each layout change gets `whoosh.short`. Add a bed with
  `wren video music <id> bed-<name>` after a bed is in the kit (`wren video sfx add`). The kit
  holds no beds yet.
- Real runs only. Every number on screen comes from the run he records.

## Shots

| # | s | Shows (Cap, layout `screen`) | Caption carries |
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

- Cap at 60 fps, display at 1920x1080 or 2x of it. Hide the dock and notifications. One browser window, no other tabs.
- The X account on screen is a public one. No DMs, no other people's data, no keys or tokens in the terminal.
- `autobrowse explore` leaves a bearer token in `$TMPDIR`: never `cat` it on screen.
- One recording per shot is easier to cut than one long take.

## Edit

1. `wren video add <cap project>` for each take. Cap's clicks and keys go into the edit.
2. `wren video set`: layout `screen` and the caption overlays. The automatic sounds follow.
3. Render, then `wren video check` against the edit bar.
4. A 15 s teaser: `wren video promo` from stills of shots 2, 4 and 6. The promo kit adds whooshes, pops, the riser and the end hit.

## Gaps

- The edit path has no device frame (the reel's look). The `screen` layout fills the frame. A frame is a new
  overlay part, not built. Ask before building it.

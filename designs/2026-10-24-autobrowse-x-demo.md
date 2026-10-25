# autobrowse X demo: shot list (2026-10-24)

Bead wa-qtyo.7. A standard product video for X: about 55 s, no face, no voice, screen only.
autobrowse films it (designs/2026-10-24-filmed-takes.md). He writes every caption. This file says what each shot shows and
which fact its caption carries. The render's captions are drafts, marked `DRAFT:`.

## Decisions

- 10-25: the site is hn.algolia.com, not X compose. It is free and needs no sign-in, so nothing posts in his name.
  The X compose cut (old shots 1 and 6) waits for a take he says yes to.
- 10-25: the stat scene shows model tokens from the filmed runs, not dollars.
- Compile uses a model too (step names). Only the replay has none. No caption says "no model" for compile.

## Shape

- Wide, 1920x1080, 60 fps. X plays it muted first, so the captions carry the story.
- One caption line under each shot. 11 scenes in 57 s.
- Sound: the earshot launch kit, placed by the rules: `click` on each click, `key` on each key,
  `whoosh.short` on each zoom in. No bed: the kit has none yet (`wren video sfx add`), or his own file as `music`.
- Real runs only. Every number on screen comes from the filmed run.

## Shots (as cut)

| # | Take, pane, s | Shows | Caption carries |
|---|---|---|---|
| 1 | text, 3 | Two lines. | Explore once with a model; replay as code. |
| 2 | explore web-1 5-13.5, term beside | `autobrowse agent hn "<goal>"`; the agent types the query. | Explore: a model acts toward the goal. |
| 3 | explore term 82-89.2 | Four model turns, the five stories, `tokens in 8824 out 533`. | What the model did and what it cost. |
| 4 | compile term 20-26 | `autobrowse compile hn-search`: files, `model: 1221 in / 263 out`, the steps. | What worked becomes a TypeScript flow. |
| 5 | compile term 29-37.5 | `bat` scrolls the flow to `records(fp, {...})`. | The list read is in the source. |
| 6 | replay web-1 7-11.2, term beside | `autobrowse try hn-search` with "playwright". | Replay with a new query, no model. |
| 7 | replay web-2 2.9-7.7, term beside | The "playwright" results. | Same. |
| 8 | replay web-4 2.9-4.8, term beside | The "web scraping" results. | Another query, the same flow. |
| 9 | replay term 65.5-72 | The five "web scraping" rows printed. | Each replay prints the rows it read. |
| 10 | stat, 3.5 | 9,357 explore, 1,484 compile, 0 each replay. | Model tokens from these runs. |
| 11 | end | `npm i @wrenautomation/autobrowse`, github.com/wrenautomation/autobrowse. | Where to get it. |

## Capture

- One tape per take: `autobrowse film <tape> --out takes/<take>`. autobrowse types the commands
  and records the terminal and every browser it opens. `browser` sizes the browsers apart from the terminal.
- Run autobrowse from `dist` (as an npm install): compile writes to `~/.config/autobrowse/workflows/<name>`.
- No keys or tokens in the terminal. `autobrowse explore` leaves a bearer token in `$TMPDIR`: never `cat` it on screen.
- A pane's mp4 holds each frame until the next. Find cut points with `ffmpeg -f framemd5`, not `-ss` stills.
  A fast seek shows the next frame, which can be seconds later.
- A result tab closes about 1.5 s after its list paints. A take holds no frame past its pane's end.
  Show the rows in the terminal shot after it.

## Edit

1. A promo script beside the takes: one `take` scene a shot, the end card.
2. `wren video promo <script>`: cursor, zooms and sounds come from the takes.
3. `wren content add --media out/promo.mp4` drafts the X post. Posting waits for his yes and his captions.

# Research map: every birdwatch run on one canvas (WA-1090)

2026-11-05. William: a chat panel on the side and a big node map of every run and source, "like Obsidian... but a lot simpler and easier to navigate". "I just need to be able to navigate it in a way where I can see the high level of what research was done where." "I can go into YouTube and start clicking around... opening new tabs from the diagram... if it used a Hormozi video, it's embedded in the diagram." "For both the demo video and the daily use." He picked option C (WebGL, fixed positions, zoom levels).

Research: `tasks/docs/11-05/research-map-ui/memo.md` (WA-1091, run 01M6P4Y711SC011R6JKG5HY5ZC).

## Target

- Research gets a Map view beside the run list. The map fills the page; the agent chat stays docked on the right; a preview panel opens over the map's right edge.
- One canvas holds every run in every ledger the Mac has. Today: 44 runs, ~9k hits, 1.2k pages read, 6.3k findings, 2.1k channels, 3k sites (~20k nodes). Built for 100k.
- Positions never move between visits. Zoom changes what is drawn, never where.
- Every source is one click from its page: a click previews it in the panel (a YouTube video plays there, a page shows its findings and quotes); a second action opens it in a new tab.

## What is drawn

| Zoom | Shows | Label |
|---|---|---|
| Far | One island per run; a hub per site or channel that 2+ runs used, between them | the run's ask; the hub's name |
| Middle | In an island: its queries, then its sites and channels | domain or channel, favicon |
| Near | Pages (read: solid; listed only: faint) and their findings | the title; a finding's sentence |

- Zoom works by size alone: no layer hides or shows. A dot grows as the camera nears; its label shows once the dot is big enough, and labels yield to each other.
- An island is a radial tree around the run: queries on the first ring, sites and channels on the next, pages, then findings. A site or channel with one page folds into that page (5,239 sources became 497); the page keeps the key, so hubs still join on it. A tree needs no force layout: positions are a pure function of the records, cheap and stable at any size.
- Islands sit on a grid in start order, one row per ledger folder (a day's study). A shared hub sits at the middle of the runs that used it: the lines between islands show where research met (one channel behind three runs).
- Edges are drawn only near and on focus; far out, the hub lines alone. No hairball on screen (memo pattern 7).
- Colour: one per ask kind; findings by verdict (kept, cut). The design-language artifact gives the tokens.

## Moves

1. Search first (memo pattern 1): an ask, a URL, a channel, a finding's words. The camera flies to the hit.
2. Hover: the node and its neighbours light, a veil dims the rest (pattern 6).
3. Click: the preview panel (pattern 2). A page: title, site chip, date, its findings with quotes, "Open" (new tab). A YouTube page: the player (the Research page's `PlayerSlot`), the channel, its survey lift when it has one. A run: its ask, counts, spend, "Open run" (the existing run view).
4. Double click: focus. The node is the centre; only its tree and its hubs stay lit.
5. The agent can point: "show the runs about X" sets the focus (a client tool on the agent thread, later).
6. Demo: a fly-through (far → one island → a Hormozi video playing in the panel) on the sigma camera, filmed from Storybook.

## Data

`birdwatch serve --also <ledger...>` reads every ledger folder. A new `GET /map` answers `{nodes, edges}` with positions, built by a pure `mapOf(records)` in the engine (`packages/birdwatch/src/engine/map.ts`), tested there. `birdwatch map --json` prints the same. The portal draws; it computes nothing.

Live: the existing per-run event updates one island; finished runs stay where they are.

## Options

### Library (hard to change)

| Option | For | Against |
|---|---|---|
| A. sigma.js 4 + graphology, inside the graph kit as a second canvas | WebGL; labels, hover, picking and camera built in; 100k in range; Louvain and layouts if wanted | a second engine in the kit beside React Flow |
| B. cosmos.gl | GPU layout and draw, 1M+ nodes, a striking live layout | few UI parts (labels, picking are ours); a live layout moves nodes, against fixed positions |
| C. deck.gl + graph-layers | one stack with a future geo map | graph layers are a community fork; layout is ours |
| D. React Flow (the kit today) | one engine, rich DOM nodes | dies at a few thousand nodes (memo: 8 FPS at 5k) |

Ranked: daily use (labels, click, focus), fixed positions, 100k nodes, demo look. Chosen: A. The kit stays the one door: `MapCanvas` loads lazily beside `GraphCanvas`, so first paint carries neither. B only if a ledger passes ~500k nodes.

### Layout

| Option | For | Against |
|---|---|---|
| A. Radial tree per run, islands on a grid, shared hubs between | pure, stable, no worker; reads as "what was done where" | islands by time, not by topic |
| B. ForceAtlas2 over everything, cached | clusters by shared sources | a new run moves the old; slow at 100k; hairball |
| C. Islands placed by ask meaning (embeddings, 2D) | near runs are near topics | a model call per run; a new run can shift the map |

Chosen: A now. C later only to place each new island (old ones stay put), if time order reads badly.

## Done

1. `mapOf` in the engine: tests for stable positions (same records, same map; a new run moves no old node) and hubs.
2. `GET /map` and `birdwatch map --json` over every ledger folder (`--also`).
3. `MapCanvas` in `@wren/ui` graph kit; a story with 100k synthetic nodes holds 60 FPS on this Mac (measured, not guessed).
4. Research Map view: page story on a real-shaped fixture; search, hover, click preview (page, YouTube, run), double-click focus, open in a new tab.
5. The ui-design proof step: 390 and 1280, both looks.
6. Fly-through story for the demo.

## Log

- 11-05: doc written. Bench and build next.
- 11-05: engine ce64776: `mapOf`, `serve --also`, `birdwatch map`. All 10 ledgers: 14,797 nodes, 15,956 edges, 448 hubs; `/map` 1.4 MB gzipped, 0.93 s cold, 0.18 s warm.
- 11-05: sigma 4, not 3: declarative styles with state conditions, custom depth layers, custom layer programs. Measured on this Mac (M2 Pro, Metal), 100k dots:
  - A function style runs per dot per frame: 42 FPS. Every style is declarative: 60 FPS.
  - Zoom tiers that hide and show dots: 17–20 FPS. Dropped; size-based labels give the tiers.
  - Hover fade as a state on every dot: 1.2–1.4 s per hover. Replaced by a veil: one quad in the ground colour, drawn between the unlit and lit depth layers. Hover now changes only the lit dots: no frame over 17 ms in a hover sweep, 60 FPS in motion.
  - Trap: sigma leaves GL blending off between programs. A custom layer must enable it, or it overwrites what is under it.
- 11-05: Open with William: the map replaces the runs list as the Research landing, with search (recommended), or the runs list stays as a tab. The run view stays either way.

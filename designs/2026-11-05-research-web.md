# Research web: every birdwatch run on one canvas (WA-1090)

Terms: the web is birdwatch's research web, every run and source on one canvas. The Map is the business map (`designs/2026-10-19-business-map.md`); orrery is the system map. Named the web on William's ask (11-05) so the three never mix.

2026-11-05. William: a chat panel on the side and a big node map of every run and source, "like Obsidian... but a lot simpler and easier to navigate". "I just need to be able to navigate it in a way where I can see the high level of what research was done where." "I can go into YouTube and start clicking around... opening new tabs from the diagram... if it used a Hormozi video, it's embedded in the diagram." "For both the demo video and the daily use." He picked option C (WebGL, fixed positions, zoom levels).

Research: `tasks/docs/11-05/research-map-ui/memo.md` (WA-1091, run 01M6P4Y711SC011R6JKG5HY5ZC).

## Target

- Research gets a Web view beside the run list. The web fills the page; the agent chat stays docked on the right; a preview panel opens over the web's right edge.
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

`birdwatch serve --also <ledger...>` reads every ledger folder. A new `GET /web` answers `{nodes, edges}` with positions, built by a pure `mapOf(records)` in the engine (`packages/birdwatch/src/engine/web.ts`), tested there. `birdwatch web --json` prints the same. The portal draws; it computes nothing.

Live: the existing per-run event updates one island; finished runs stay where they are.

## Options

### Library (hard to change)

| Option | For | Against |
|---|---|---|
| A. sigma.js 4 + graphology, inside the graph kit as a second canvas | WebGL; labels, hover, picking and camera built in; 100k in range; Louvain and layouts if wanted | a second engine in the kit beside React Flow |
| B. cosmos.gl | GPU layout and draw, 1M+ nodes, a striking live layout | few UI parts (labels, picking are ours); a live layout moves nodes, against fixed positions |
| C. deck.gl + graph-layers | one stack with a future geo web | graph layers are a community fork; layout is ours |
| D. React Flow (the kit today) | one engine, rich DOM nodes | dies at a few thousand nodes (memo: 8 FPS at 5k) |

Ranked: daily use (labels, click, focus), fixed positions, 100k nodes, demo look. Chosen: A. The kit stays the one door: `MapCanvas` loads lazily beside `GraphCanvas`, so first paint carries neither. B only if a ledger passes ~500k nodes.

### Layout

| Option | For | Against |
|---|---|---|
| A. Radial tree per run, islands on a grid, shared hubs between | pure, stable, no worker; reads as "what was done where" | islands by time, not by topic |
| B. ForceAtlas2 over everything, cached | clusters by shared sources | a new run moves the old; slow at 100k; hairball |
| C. Islands placed by ask meaning (embeddings, 2D) | near runs are near topics | a model call per run; a new run can shift the web |

Chosen: A now. C later only to place each new island (old ones stay put), if time order reads badly.

## Done

1. [done] `webOf` in the engine: tests for stable positions (same records, same web; a new run moves no old node) and hubs.
2. [done] `GET /web` and `birdwatch web --json` over every ledger folder (`--also`).
3. [done] `WebCanvas` in `@wren/ui` graph kit; a story with 100k synthetic nodes holds 60 FPS on this Mac (measured, not guessed).
4. [done] Research Web view: page story on a real-shaped fixture; search, hover, click preview (page, YouTube, run), double-click focus, open in a new tab.
5. [done] The ui-design proof step: 390 and 1280, both looks.
6. [done] Fly-through story for the demo: `graph-web--fly-through` (run → query → page across islands, then whole; loops).

## Log

- 11-05: doc written. Bench and build next.
- 11-05: engine ce64776: `mapOf`, `serve --also`, `birdwatch map`. All 10 ledgers: 14,797 nodes, 15,956 edges, 448 hubs; `/map` 1.4 MB gzipped, 0.93 s cold, 0.18 s warm.
- 11-05: sigma 4, not 3: declarative styles with state conditions, custom depth layers, custom layer programs. Measured on this Mac (M2 Pro, Metal), 100k dots:
  - A function style runs per dot per frame: 42 FPS. Every style is declarative: 60 FPS.
  - Zoom tiers that hide and show dots: 17–20 FPS. Dropped; size-based labels give the tiers.
  - Hover fade as a state on every dot: 1.2–1.4 s per hover. Replaced by a veil: one quad in the ground colour, drawn between the unlit and lit depth layers. Hover now changes only the lit dots: no frame over 17 ms in a hover sweep, 60 FPS in motion.
  - Trap: sigma leaves GL blending off between programs. A custom layer must enable it, or it overwrites what is under it.
- 11-05: Open with William: the map replaces the runs list as the Research landing, with search (recommended), or the runs list stays as a tab. The run view stays either way.
- 11-05: wren e006fd7be: Research › Map, before Runs. Runs stays: it hosts the run view. The pick lives in `?at=`; search flies to the island at a ratio from the map's extent. Engine 0.40.0 on npm; wren pins it (011621ea9).
- 11-05: labels under the veil overlapped. While a dot is lit, only forced labels draw: the label size threshold is set in place, because `setSetting` reprocesses every dot. Reaches into sigma's private `internals`; safe while sigma is pinned at 4.0.4. Hover sweep at 100k after: p50 16.7 ms, p99 16.8 ms.
- 11-05: renamed map → web (William: "Lets called it like a web to be clear on terminology"). Engine 0.41.0: `engine/web.ts`, `webOf`, `GET /web`, `birdwatch web`. wren: Research › Web at `/research/web`, `WebCanvas` in @wren/ui, this doc. Breaks `/map` and `birdwatch map` with no alias: one caller each, both moved.
- 11-05: William: the side chat must drive every product. Birdwatch gets components drawn in the chat, ports of its full interface (a run's tree, sources, findings, the web), so the chat shows the same view and he can navigate it. Vireo gets its own the same way (WA-1119). One mechanism for both, built once in the shell's chat. Shape not agreed: he fleshes it out with this session first. Task WA-1123. Nothing is built.
- 11-06: draft chat cards for Birdwatch, as stories only (WA-1123). Not wired to the portal, not exported from `@wren/ui`. William sees them first.
  - The graph is the round 4 mock (artifact `8ad6c513`): islands of sources by kind, a disc per source sized by kept findings, a solid centre for what a claim uses, claim hubs with edges. `research/layout.ts` is pure; `research/graph.tsx` draws SVG. No new library.
  - `RunCard` is one run in a chat turn: facts, graph, claims, sources. A claim opens its findings under its own row. A source opens under the graph. `SourceCard` is one source read with no run.
  - Stories `research-chat--…`: `scope` (the agent asks how far to go), `one-source`, `channel`, `answered`, `source-picked`, `live`, `worst-case`. They cover William's three jobs: read one reel and stop, the whole channel from one reel, a standard run.
  - The UI seam, built: `AgentPart` has a `view` part (`name`, `data`); `AgentThread` takes a `views` table by name. A card sends a turn through `Say`. Vireo adds `vireo.*` to the same table (WA-1119).
  - Open, William's call: how a product's CLI output becomes a `view` part.

    | Option | For | Against |
    |---|---|---|
    | A. The CLI prints a view line with a ref (`{view, ref}`); the thread lifts it to a `view` part; the card reads the data from the product's API | no data passes through the model; the card matches the ledger; live updates | each product serves a read per view |
    | B. The agent writes the component spec | any shape, no new read | costs tokens; data can drift from the ledger |
    | C. The UI pins a run's card to the turn by a shared chat and run id | no agent choice | does not fit Vireo's shapes |

    Ranked: truth to the ledger, cost, flexibility. The session recommends A. Not chosen.
  - Known limit: 40 edges read as a tangle until a claim is pointed at (`worst-case`).

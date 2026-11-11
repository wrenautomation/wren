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
- 11-05: William chose A: the CLI names a view with a ref, the thread lifts it to a `view` part, the card reads its data from the product. Built (WA-1123), engine 0.45.0.
  - The line is a contract for every product's CLI, so its place is hard to change. The session chose it; William chose A only.

    | Option | For | Against |
    |---|---|---|
    | 1. Its own line on stderr: `::view research.run {"run":"<id>"}` | stdout stays one JSON document; the line passes a pipe on stdout; one parser for all products | lost when the agent drops stderr |
    | 2. A `view` field in the JSON on stdout | no new line | each command's JSON changes; lost in a pipe that picks a field; the thread must find JSON in mixed text |
    | 3. Its own line on stdout | simple | breaks each caller that parses stdout as one document |
    | 4. No line: the thread reads the command and its result | no CLI change | not what William chose; breaks when a command's words change |

    Ranked: no break for present callers, then pipes, then one parser. Chosen: 1. The skill tells the agent to keep stderr on.
  - No framework fits. The AI SDK and assistant-ui map a typed tool call to a component, and MCP Apps carry a UI resource. This agent's only tool is Bash on CLIs. The part itself is assistant-ui's `data` part; only the lift is custom (`lift`, `modules/agent/thread.ts`).
  - Engine: each step that writes to a run (`printDid`, `add`, `accept`) and `brief` print the line. One name: `research.run`.
  - Thread: a line in any tool's output becomes a `view` part with the ref as its data. One card for each ref in a reply; a later line moves the card under the newest step. A file read's line numbers are skipped.
  - Portal: `modules/agent/views.ts` is the table of every product's cards. `modules/research/chat-card.tsx` reads the run from `birdwatch serve` and follows `/events`; `card.ts` maps the run's records to the card. One event stream for the page, not one a card: a browser keeps 6 connections a host.
  - The session's choices, not William's: a source is a YouTube channel, a subreddit or a site; its island is its pages' class (the agent's, else the judge's best guess), `Other` with none. A run of one page and no search draws as the source card with a link to the run. The source card offers no wider job.
  - Limits: the card has no claims (the ledger holds none; open item). It never shows `Reading`: the ledger cannot tell a stopped run from one left at a step. A page that holds a `::view` line in its text can draw a card of another local run; the card only reads `birdwatch serve` on this Mac.
  - Story `pages-agent--card`: a stored chat written by hand, since no tape holds a birdwatch step yet.
- 11-05: William on a pasted source with no scope: he leans to "default, small, isolated". The agent reads the pasted sources only and stops. Not firm. Not chosen: the agent asks first; the agent widens when it judges the source good. The skill says so from engine 0.45.0.
- 11-06: William on the round 5 graph (artifact `NfPA6Hpj`): he keeps option 4, sources as thumbnail pieces on the ground. He leans to tilted; flat or tilted is still open. A click on a source must show more detail. Collapse the options to one design.
- 11-06: round 6 mock, artifact `LdYvUurK` (https://claude.ai/artifact/LdYvUurKnRNGtrguY6HQwP). One design; one switch left: flat or tilted, tilted by default. Three real runs. No real build before William settles the graph (WA-1106).
  - The session's choices, not William's:
    - Every source with a kept finding stands up: a video source as its thumbnail, a site as its icon and name. Past 14 name chips on desktop, a source stands as a small icon pin. On a phone, 4 thumbnails and 3 name chips at most; the rest stay discs.
    - One panel for a source and a claim, at the right on desktop and as a bottom sheet on a phone. A source lists each page read, each finding with its quote, its claim and its check, and the quiet pages folded. A claim lists its sources with their findings for it.
    - Claim numbers as badges on the pieces, so the map reads without the lines. Round 5's callout cards are dropped.
    - The map keeps its layout when the panel opens. It slides, and shrinks to 70 % at most, so the picked pieces stay in view. A pick fades all other pieces.
  - Mock limits: no video plays in the page (artifacts cannot embed YouTube); the tilt is drawn by hand in SVG; the data is fixed.
- 11-06: William chose tilted. The flat switch goes. Later, birdwatch researches a better UI for the graph (WA-1133) before the real build (WA-1106).
- 11-06: WA-1133 birdwatch run on graph UIs (run `01M6RXZ8NEAJSXFYGEBHMTV7JQ`, ledger `tasks/docs/11-06/graph-ui/`: 977 hits, 120 read, 186 findings, 10 claims, $0.47). William did not read it; its ideas went into round 7 of artifact `LdYvUurK`.
  - Applied: lines only for the claim, search or source in focus; a fixed place per kind; zoom changes what shows (islands as counts, then main sources, then all with a finding); kept-but-unread hits as dashed rings; a Searches tab with hits, kept, read and findings; a round control with new-source dots; a hover card with the best quote; "open at the quote" by text fragment; a funnel strip from hits to claims; a sortable sources table synced with the map; a tilt with no perspective.
  - Left out: a flat switch (William chose tilted); a minimap (100 sources fit on screen); edge bundling (the claim is the bundle).
  - The session's choices, not William's: the place per kind; zoom steps at 0.72 and 1.45; a linear funnel; the four runs.
  - Limits: not tested at 1,000 sources; videos have no time stamp for a quote.
- 11-06: round 8 of artifact `LdYvUurK` (WA-1150). William asked for faster scroll with numbers, a way to overrule a drop, no edge bars, a better ground, less flat, fewer small marks, and a clear read of size.
  - Each source is a hill on its island, cut from one height field into terraces. One step for each step in findings kept, so one finding gives no step. A dark top backs a claim. The map draws on one canvas; the terrain layer redraws only when the view turns, zooms or moves.
  - Names: only the 10 most used sources at rest (4 on a phone), type size by rank. A pick names only its own sources.
  - Dropped tab: hits grouped by the run's reason, sorted by the judge's subject score. "Read it" queues a hit; the bar copies one `birdwatch open <run> <hits>` command. The mock does not send it.
  - Perf box: draw ms, motion fps, page scroll, long tasks, scene size. Bench at 4x CPU slowdown, Chrome with GPU: page scroll 0 slow frames of 156 (round 7: 21 of 148); turning the map 12 of 340 (round 7: 27 of 292). The box's backdrop blur had cost 15 slow frames in a scroll; it is gone.
  - The session's choices, not William's: terraces, the step rule, the label counts, the phone stage height set by the map.
  - Open: William is not sure stacked round terraces are the best shape for weight. Variants next.
- 11-06: round 9 of artifact `LdYvUurK` (WA-1151). Ten looks for a source's weight, on one map and the same data, behind a Look switch. Round 8's terraces stay as look 0.
  - Looks: Relief (quarter-step contours), Peaks (lit cones, height by square root of findings kept), Towers (equal-width columns, height linear), Bubbles (flat discs, area), Pins (head by claims backed), Ridges (profile lines), Treemap (kind blocks, cells by area), Heat (shaded field), Coins (one coin per finding, to 10), Zoom (discs that rise into peaks).
  - The session's choices, not William's: the ten looks, their scales, and one shared layout for all. Treemap and Bubbles are flat, so drag pans.
  - Open: William picks a look, or a merge. The winner then gets its own spacing and label rules before WA-1106.
- 11-06: William on round 9: Towers and Coins fine; Heat interesting, the eye follows its flow; Bubbles too flat; Pins good as a stacked deck of the page cards; Relief, Peaks, Ridges, Treemap and Zoom out. The page previews, thumbnails and icons of round 6 must come back. Hollow numbered circles look weak. Polish hierarchy and alignment.
- 11-06: round 10 of artifact `LdYvUurK` (WA-1155). Seven looks: Towers, Coins, Heat, Heat + towers, Heat + coins, Decks, Heat + decks.
  - Media: the top sources get a preview card (video thumbnail with a play mark, page image, else the best page's title in full). The next ones get a chip with a thumbnail or icon. On a phone: 1 card and 2 chips.
  - Numbers are plain figures. Hollow circles are gone from the map, the list and the panel.
  - Heat gets equal-heat lines at 5 levels. Decks: up to 5 page cards a source, the best page's image in front, a ring for a source that backs a claim.
  - Page images: the mock fetched og:image for 124 top pages; 49 have one. The engine does not store them yet.
  - The session's choices, not William's: the seven looks, the card and chip counts, the island names.
- 11-06: William asked where the kinds come from ("practitioner", "vendor"). They are the engine's closed `SOURCE_CLASSES` set, William's pick on 10-28 (research-engine.md). The agent writes the class when it reads a page; where none, the judge's CLASS guess fills in. In the WA-1133 run the agent classed 109 of 120 read pages.
  - Gaps found: no class for research papers (papers split over primary_data 36, other 10, survey 4); docs and help pages fall into vendor; the set mixes who speaks with the type of evidence.
  - Options put to William (hard to change: the class feeds counts across runs):
    - A: keep the keys, rename only the shown words. Cheap; the gaps stay.
    - B: add `paper` and `docs` classes. Fixes the two gaps; keeps the mixed axis.
    - C (recommended): one axis, who speaks: research, person, company, forum, press, public body, other. The type of evidence stays in the judge's `format`. Old keys map on read, so old runs still count.
    - D: the agent names islands per run. Rejected: counts would not add up across runs.
  - Round 10 previews C's names: Research, People, Companies, Forums, Press, Other. The engine is unchanged until William picks.
- 11-06: William picked C for source kinds: one axis, who speaks (research, person, company, forum, press, public body, other). The judge's `format` keeps the type of evidence. Old keys map on read. Engine change next. Round 10 published to `LdYvUurK` (version 5).
- 11-06: William: "type of evidence and who made it are both important". C becomes two closed fields, option 1 of 3 (not chosen: 2, evidence from the judge's `format` with new values, which mixes shape and evidence again; 3, one combined key, up to 49 crumbs).
  - `speaker` on a document: research, person, company, forum, press, public_body, other. Islands and the echo warning use it.
  - `evidence` on a finding, else its document's: data, study, account, analysis, report, promo, other. Facet `needs` names evidence.
  - `format` stays the judge's shape label (video, article, paper ...) for previews and icons.
  - The agent writes both; the judge guesses both. Old `class` records map on read: practitioner to person + account, vendor to company + promo, news to press + report, forum to forum, survey to study, primary_data to data; old primary_data and survey speakers go to research when the page is a paper, else company.
- 11-06: round 11 of artifact `LdYvUurK` (version 6, WA-1157 mock). William: space needs a procedural layout; URLs and decks must not clutter.
  - Options for spacing, ranked by no overlap, fill of the stage, stable kind places, cost:
    - Fixed slot grid (round 10). Cheap; empty bands and caption clashes when kinds are missing.
    - Treemap of kinds. Fills the stage; loses the island read and the tilt.
    - rbush index for label collision. Not needed at about 100 symbols; a plain list is fast enough.
    - Chosen: d3-force for islands, then greedy placement in rank order for cards, names and island captions, as map engines place symbols.
  - Islands: present kinds in reading order on a grid shaped like the stage, set square to the screen at the preset turn. Collide holds a gap for the caption. A gentle squeeze of the long side, checked every 10 ticks, brings the layout to the stage's shape; a hard squeeze flipped it.
  - Cards: a budget in rank order (16 wide, 6 phone; 40 and 12 zoomed in). A card that would cover a placed card is skipped.
  - Names: text only. Six spots around a mark, four around a card; first clear spot wins; no spot, no name. A picked source always gets its name. Placement runs again when the view settles. The Perf box is an obstacle.
  - Looks: six, all on heat ground: three from round 10 (towers, coins, decks) and three hybrids with the source's card on its mark (card towers, card coins, card stacks).
  - Pictures, no letters: thumbnail or og image, then a page shot (PDF first page), then site icons from four sources (globe rejected), then a drawn format glyph. Reddit icons need sign-in, so subreddits show the Reddit logo.
  - Speaker islands and evidence tags preview option 1; the mock maps them from the old class and format.
  - The session's choices, not William's: the budgets, the spot lists, the squeeze rule.
- 11-07: round 12 of artifact `LdYvUurK` (version 7, WA-1157 mock). William on round 11: unsure of the islands; asked for a more traditional graph with the cards and better visual info.
  - Options, ranked by read at a glance, no overlap at about 100 nodes, path tracing, cost:
    - Islands on terrain (round 11). Weight and speaker read as place and height. Edges are hard to follow; much empty sea.
    - Force graph only. Familiar; a hairball once sources pass about 200.
    - Layered DAG (ELK or dagre): search, then source, then claim. Clean paths; wide and flat, and claims lose their center.
    - Chosen: three layouts of one flat graph, with one set of marks.
  - Layouts:
    - Claim web: d3-force with a box collide. Claims are dark cards; the top 12 linked sources (4 on a phone) are cards, the rest chips. Sources with no claim sit on a shelf below, by speaker.
    - Search tree: root, rounds, searches; each search shows the top 3 sources it found first, the rest on a click.
    - Lanes: one lane per speaker with chips; claims on the right at their sources' mean height.
  - Marks: card (image, name, counts, evidence bar), chip (icon, name, findings), dot (read, no finding), dashed ring (kept, not read). The evidence bar uses one ink at falling opacity, so it never fights the speaker hues.
  - A summary strip over the graph: who speaks, evidence, and three holes (kept not read, read no finding, findings in no claim). A hole lights its nodes.
  - Lost from the islands: weight at a glance, and speaker as place, except in Lanes. Gained: paths readable, no empty sea, claims at the center.
  - For the portal: React Flow (xyflow, MIT) with d3-force or ELK. It slows at a few thousand DOM nodes; fine for one run at about 100.
  - The session's choices, not William's: the three layouts, the card budget, the shelf.
- 11-07: round 13 of artifact `LdYvUurK` (version 8, WA-1163). William on round 12: claims too big, white and jarring; wants to click a node to open it into a subgraph of its pages, searches and findings, with far more detail.
  - Options, ranked by keeping context, depth on demand, layout stability, cost:
    - A. Open in place (Neo4j Bloom, Linkurious, Kumu). Children grow beside the node in the same web. Keeps neighbours; crowds when many nodes are open.
    - B. Drill down with a breadcrumb trail. Clean at each level; loses the neighbours.
    - C. Compound nodes (ELK, Cytoscape compound). Good for strict trees; findings link across sources, so edges cross box walls.
    - D. Semantic zoom only. No clicks; the reader can't choose which node opens.
    - Chosen: A.
  - Depth: claim to findings; source to pages with findings, pages with none, pages not read, and its searches; page to findings; finding to quote; search to sources and dropped hits with reasons. A shelf chip lifts its source into the web.
  - A run of more than 8 children (6 on a phone) opens 8 at a time behind "N more". Other kinds always show.
  - Stability (version 9, after William saw global drift): solve off screen, then one eased move per node (460 ms, cubic out). The clicked node never moves. Old nodes inside a radius sized to the new cards make room; the rest are pinned and give way a tenth as much in the box collide. A collide stuck between held nodes releases them. Closing folds the children back into the node. Measured on opening a claim: 5 of 32 old nodes move, none changes direction.
  - Claims: accent tint at 7% on paper, accent ring, number disc. No more dark blocks.
  - Edges by kind: claim (speaker colour, width by weight), tree, backs (finding to claim), via and found (dashed).
  - For the portal: React Flow with d3-force, same expand model.
  - The session's choices, not William's: the page size of 8, the anchor strength, the edge kinds.
- 11-07: round 13 on prod (WA-1182). William: polished enough; replace the run view; no drift from the artifact.
  - Options for the port, ranked by drift from the artifact, safety, cost:
    - A. Mount the mock's engine as is; it writes markup with innerHTML. Zero drift; run text in innerHTML is an XSS path, and the CSP refuses inline handlers.
    - B. React draws every mark, panel, list and table; a 1:1 port of the engine moves them by ref (`style.transform`, path `d`). Same d3 force, zoom and transitions.
    - C. React Flow (xyflow). Its own layout and pan model; the drift fixes undo round 13.
    - D. The artifact in an iframe. No drift; no portal data, theme or links.
    - Chosen: B. React never re-renders during a move, so the eased moves are the mock's.
  - `@wren/ui/research/run` is its own export: d3 and the CSS load only on a page that draws the graph.
  - The run page is a list, then one run full width: Graph (the three layouts) and Back and forth. The old tree, its elk drawing and the Sources tab are gone.
  - The portal maps a serve view on read (`modules/research/graph.ts`, a port of the mock's builder). On the artifact's run it gives the same data, field for field; the port then draws the same web and tree, node for node.
  - Images: a site's icon from icons.duckduckgo.com and a video still from i.ytimg.com, straight from the browser (CSP img-src). Through /media one view would cost 100+ Worker calls.
  - Limits until WA-1157 moves the mapping into birdwatch: no page images (og), claims only from the brief's patterns.
- 11-08: the chat card draws the page's graph (WA-1123). William 11-06: the chat cards reuse the graph's parts.
  - Options, ranked by one model of a run, the same view in chat and page, chat weight:
    - A. `RunGraph` in card mode: no run head, summary, key or table; a 460px stage; the head links the page. One model (`RunGraphData`), no new drawing code.
    - B. Counts and claims only, plus "Open in Research". Light; no graph in the chat.
    - C. Keep the draft card and restyle it. A second model of a run (`research/model.ts`) and a second graph; stale.
    - Chosen: A. Wheel zoom needs ctrl or cmd, so the chat still scrolls.
  - Deleted: `packages/ui/src/research/{cards,chat,graph,layout,model}`. One source read alone stays a findings list (`SourceCard`).
  - Stories `research-chat--…`: `scope`, `one-source`, `default`, `live`, `empty`, `loading`, `failed`, `worst-case`.
- 11-08: the graph loads on first draw; no server SDK in the web bundle (WA-1187).
  - The page and chat cards import `RunGraph`, `RunCard`, `SourceCard` through `modules/research/run-lazy.tsx` (React `lazy`). The chunk is 73 kB plus 29 kB CSS.
  - `studio-common.ts` pulled `@wren/core/autobrowse` and so `do.ts` and `@restatedev/restate-sdk` into the main chunk. The platform list moved to `@wren/core/autobrowse/platforms`. The vite `serverOnly` guard now fails the build on the Restate SDK.
  - Main chunk: 5.47 MB (1.84 MB gzip) to 3.13 MB (960 kB gzip).
  - Measured locally, one run of 3.2 MB from serve: first node at 0.5 s, 290 ms script, longest task 144 ms. Layout and view switches: no long task. Ten view toggles: DOM and heap flat.
  - Not done: per-page lazy modules; elk (3 MB) is already its own chunk.
- 11-08: Live and History replace Web and Runs; All runs draws every run on one graph (WA-1188).
  - William: the web (sigma, 11-05) is ugly and duplicates runs. "Runs" is history; a live view follows the chat.
  - Options, ranked by one drawing for every view, a live view the chat drives, cost:
    - A. Live: the chat's runs, live, on the round 13 graph. History: the runs list. Delete the web. One drawing.
    - B. Keep the web as the all-runs map, restyled. Two drawings of one model; the web had no design pass.
    - C. No live page; the chat cards only. No big view while the agent works.
    - Chosen: A, plus All runs from C's idea of a multi-run canvas: pick runs, or all, onto one graph.
  - Merge (`mergeGraphs`): a source is one node per site and name across runs; each `r` becomes the run's place (1-based); claims, searches and drops renumber and keep `run`. The graph says "Run" where one run says "Round". A drop's id is `k.id`; the read queue copies one `birdwatch open` per run.
  - Live: the chat's runs (`research.run` view parts), else runs not stopped and changed in 30 min, else the newest. A new run in the chat opens Live when the page is under Research.
  - Engine 0.50.0 drops `/web`, `birdwatch web` and `engine/web.ts`. The portal drops `WebCanvas`, sigma and graphology.
  - Build bug found: lightningcss turned `light-dark()` into `--lightningcss-light/dark` vars that nothing sets (the scheme comes from `--ui-scheme`). Every `--hair`, speaker colour and edge in the built graph was invalid; Storybook (dev, no minify) hid it. Fix: `build.cssTarget` Chrome/Edge 123, Firefox 120, Safari 17.5.
  - Measured locally, All runs (31 runs, 587 sources, 35 claims, 29 MB of views, warm serve): first node at 1.7 s, no long task at rest. Layout switches: 54 to 87 ms. Back to the claim web was 244 ms; it now reuses the last solve.
- 11-08: the claim web: fast solve, kept places, no overlap (after 469a7839d, nodes piled at 0,0 on a still redraw).
  - William asked: is the graph a composite? Close: `kids()` is the children call and `presentSet` walks it. But a run is a DAG: one source backs many claims and is found by many searches. A class tree copies shared nodes and fights React's immutable state. Kept: string keys, one dispatch per kind.
  - Options for the solve cost, ranked by real-run time, then code risk:
    - A. Grid collide plus a places cache. Chosen.
    - B. A Web Worker solve. The layout goes async and the workspace package needs worker bundling. Next step if merged graphs grow.
    - C. Precompute in weaver serve. Layout depends on DOM sizes and open state, so the server cannot know it.
  - `rectCollide`: a uniform grid (cell = largest box + gap), 3×3 neighbours. A hit under 0.5 px is none: float error held `settle` at its full 1,100 passes. A push goes 1 px past touching, so a crowd parts in fewer passes.
  - `settle(all, wide)` is the shared overlap pass. Sim ticks: 300 (d3's own end), was 360.
  - `kids` is memoized per run index (WeakMap).
  - Places cache (`placesOf`, `keepPlaces`): per run, width and node set, 48 entries. Same set: no solve, only `settle` (fonts or sizes moved). New nodes on a live run: old nodes hold, new ones grow from their parent.
  - CSS bug: `.rg .fdn { position: relative }` beat `.rg-nodes > * { position: absolute }`. Findings sat in normal flow over the claims in every open state.
  - Measured, best of 3 under load: one real run 22 ms; all 33 real runs (107 web nodes) 142 to 89 ms; synthetic 12 runs all open (860 nodes) 6.1 to about 2.5 s.
  - Checks: `web.test.ts` (no overlap, deterministic, cache copy) and an overlap `play` on Default, ClaimOpen and SourceOpen.
  - Open: the merged graph is tall (about 1.4k × 4k px) with long links. Next: lay claims out by run sector.
- 11-08: All runs packs each linked group apart, in run order.
  - Real data: 33 runs, 35 claims in 9 runs, 72 sources back claims, 5 span runs. So the merged web is mostly separate groups.
  - Options, ranked by link length, crossings, then fit at the zoom floor:
    - A. One sim, claims anchored on a sector per run. Shared sources pull sectors together; long links stay.
    - B. Groups (union-find on edges) solve alone, then skyline-pack to the room's aspect, then a light pull to close gaps. Chosen.
    - Dropped: row packing (ragged rows), gravity with no repulsion (groups bend), rigid group slides (3% gain), pull at 0.1 and 0.2 (112 and 197 crossings).
  - `pack`: gap 48 wide, 36 narrow; aim 1.2 wide, 0.6 narrow; cap 1600 wide, 900 narrow (widest that reads at the zoom floor). A phone stays one column: the pull is wide only.
  - Real merged web at 1280: 1913 × 1464 at 0.55, cut at the sides, to 1461 × 2294 at 0.61, full width, 0 overlaps. Crossings 73 to 12; link median 320 to 224, p90 642 to 299. Solve about 150 ms.
  - `mergeGraphs` moved to `@wren/ui/research/run/merge`: pure, no d3, so the portal merges in its main chunk while the graph loads late.
  - Checks: `web.test.ts` (group order, pack apart and in width, merged solve) and story `research-run--several-runs` with an overlap `play`.
- 11-08: source cards show the page's picture, as round 13 did (engine 0.52.0).
  - William: the graph still does not look as good as round 13. Real data side by side with round 13: the same layout, but no page pictures. Round 13 drew og images and page shots that its prep fetched; prod sent `og: null`.
  - Options, ranked by data kept in the run, then cost per view:
    - A. The html reader keeps og:image on the document; `weaver images` backfills old reads as `image` records (latest per document wins). Chosen.
    - B. Serve fetches og:image lazily per view, with a disk cache. No schema change, but the picture is not in the run and each new view fetches.
    - C. A Worker proxy for og images. Spends the Worker's request cap.
  - Backfill on this Mac: 600 html pages, 459 with a picture, 2 failed.
  - Not done: round 13's page shots for pages with no og image (a browser render per page).
- 11-08: the query web replaces the claim web; Tree and Lanes go.
  - William: prod drew the tree, not the web he chose. He wants the fan-out searches and their answers at the center, not claims.
  - Options, ranked by what a reader learns first, then layout cost:
    - A. Hubs = searches, each with its best finding as the answer; spokes = sources with findings, one edge per search that reached them (weight = kept). Chosen.
    - B. Keep claim hubs and add search hubs. Two hub kinds compete; the web doubles in links.
    - C. Searches as a ring of labels with no answer. Shows the fan-out, hides what it found.
  - Searches sit on a ring in run order; a source seeds at the center of its searches. A source with no finding waits on the shelf until its search opens.
  - Claims stay in the side list and the panel. A claim pick lights its sources.
  - Answers pick in run order; a finding an earlier search took counts only when none is left. Prod showed one review study on many cards.
  - Tree and Lanes removed from ui, portal routes and stories: prod had them as the default, and William called them broken.
  - Summary bars become `RingChart` donuts (the chart kit's), with the hot slice's share in the center.
  - CSP `img-src` takes https, so page pictures load in prod.
  - Storybook: `Charts/All charts` shows every prebuilt chart and graph on one page; the run graph moves to `Charts/Weaver run graph`.
- 11-08: All runs draws run hubs; the web opens whole; cards get full borders.
  - Prod All runs: 333 search hubs and 469 sources, about 3600 × 10500. The fit hit its 0.55 floor and showed an empty top-left corner. Long tasks 2.2 s and 1 s.
  - Options, ranked by what a reader learns first, then nodes drawn:
    - A. Each run is one hub: its ask and its note. A click opens it into its searches and the rest of its sources. Chosen.
    - B. All 333 search hubs at a tiny fit zoom. Unreadable and heavy.
    - C. A grid of per-run clusters with their search hubs. Still 333 cards.
  - Closed, a run shows its top 3 sources plus every source two or more runs read (51 of 469). First view: 262 nodes, longest task about 300 ms.
  - A source links to the searches of an open run, else to the run's hub. A search or source picked in a closed run opens that run first.
  - Fit: one run opens at 0.9 (William approved it on prod); several runs fit whole, floor 0.4, centered.
  - Head: a short title (the ask's first question, asides cut, at most 170 chars), the whole ask in body text under it; a phone folds it under "Whole ask". 18 of 33 real asks get a short title.
  - Phone chips in All runs: one a run (33), not one a search (333).
  - William: a colored left edge only looks wrong. Cards, chips and the answer line lose it; a tinted card gets a whole ring in its speaker's color.
- 11-08: one run's web shows every source from the start; the shelf stays for All runs only.
  - William: a live run should build its web as the agent reads. Sources show gray before they are read, turn to their color when kept, and a rejected source stays, gray and smaller.
  - Options, ranked by what a live reader sees, then nodes drawn:
    - A. Every source is a spoke from the start: a gray chip while not read, a smaller gray chip when read with no finding, its color and card or chip once it holds a finding. Chosen.
    - B. Gray dots in the web, a chip only on a finding. Fewer pixels, but a dot carries no name, so the build reads as noise.
    - C. Keep the shelf and fly a chip from it into the web on its first finding. The web stays small, but a reader cannot see which search found a source still waiting.
  - A gray spoke is a dashed gray hub line with the hub's pull, so a source sits by its searches before its finding. On its first finding the line takes the speaker's color and the chip rings out once (off with reduced motion).
  - A search now opens to its dropped hits only: its kept sources are on the map already.
  - Cost: the worst fixture lays 180 nodes, not 139; the solve takes about 30% longer (2.2 s to 2.9 s for both test runs in vitest).
  - All runs keeps its shelf: 469 sources at once is too many to draw.
- 11-09: the panel reads as a feed; sidebars fold; bars replace the rings; focus dims less.
  - William: the right panel "all looks the same… visuals first, frames first"; the side lists "take up a lot of space"; the rings "don't tell me anything"; the focus blackout is "too extreme".
  - Panel: every source, page and dropped hit leads with a 16:9 frame. The picture when there is one (video thumbnail, og:image); else the site's icon on its kind's tint. A search's kept sources are a 2-column tile grid; its dropped hits are rows with a small frame, the kind, the host and a subject-score meter. Section heads carry counts.
  - Dropped hits get a YouTube thumbnail from the URL and a site icon (`GraphDrop.th`, `ic`). Pages have no picture for a plain hit; a thumbnail per hit would need a GET per hit (cost, ToS), so no.
  - Fold: the left list folds to a 44 px rail of counts (a count opens its tab); the right panel hides to an edge tab and keeps the pick. A new pick shows the panel again. The fold is kept in localStorage; the fit uses the room left.
  - Rings out: Who speaks and Evidence are now one row a part: count, a bar of findings on one scale, the dark share in claims. A ring showed only shares of the source count; the rows show what each part gave the answer.
  - Focus: the rest drops to 50% and 35% saturation, lines to 0.16 (was 20% and 0.06).
  - Fix: the stage clips instead of hiding overflow, so a focused control can no longer scroll it sideways (the read-queue story showed it 95 px off).
- 11-09: the wide graph is a dock (dockview 8.6.2); a detail window keeps its own history (WA-1220).
  - William: panes "like vscode or an ide": open many windows, move, resize, fill the screen, hide them, "but also a bit more rooted in standard web UI". Most of all, the right panel must fill the view to read it whole. Also: a back button to branch from a finding and come back.
  - Options (hard to change: every later pane feature sits on it), ranked by what a reader can do, then risk, then code we own:
    - A. react-resizable-panels: split panes with resize and collapse. No tabs, no float, no drag to rearrange; we would build those.
    - B. dockview-react: tabs, split, drag to rearrange, float, fill (maximize), hide a group, layout to JSON. MIT, no deps, maintained. Chosen.
    - C. Our own panes on CSS grid: full control, every IDE behavior is ours to build and test.
    - D. flexlayout-react: tabs, split, float and maximize too; heavier theming, a global model object that fights React state.
  - Panes: Lists | Web | detail windows. Lists and Web hide, never close. A detail window is a tab with its own history (60 steps): a pick goes to the active window; ⌘/Ctrl-click, middle-click or the new-window button opens a new one (12 at most). Back and forward: header buttons, Alt+←/→, mouse buttons 4 and 5.
  - Fill: the header button or a double-click on a tab; Esc restores. A filled window keeps an 860 px reading column. Float and dock-back from the header.
  - The layout persists in localStorage; windows persist per run, and a window of another run drops on load. The web keeps its center when a pane resizes and fits only the first time it gets room.
  - Narrow and card mode keep the overlay panel, with the same back and forward.
  - Lag: a source click expanded the node and ran the force layout (220 ticks, 97 ms in dev) in the same commit as the panel. The relayout is now a transition after the panel paints, and the source table below defers its focus marks. Open to first paint: 170–360 ms → 40–130 ms (dev build). An early stop on the force loop does not help: free nodes never settle under 1 px per tick.
  - Fix: a page row's frame took `flex: 1` from the row's text rule and grew to half the panel.
  - Fix: a click on the folded panel's edge tab no longer reaches the stage and clears the pick.
- 11-10: the engine carries the two fields (WA-1157, weaver 0.68.1, engine b286225).
  - A `class` record holds `speaker` (a document) and `evidence` (a document or one finding). `add class <on> --speaker --evidence`. Per target and field, the latest wins.
  - Best known, in order: the agent's word, the judge's guess (it now asks both questions), an old one-axis class mapped, a rule on the host and shape. One seam: `engine/kinds.ts`.
  - The view sends `speaker` and `evidence` on each hit and document, and `evidence` on each finding, each with who said it (`by`, `p`). The portal's `kindOf` and `evOf` are deleted; the graph reads the view.
  - Facet `needs` names evidence (an old class name maps). Patterns count sources per speaker and per evidence; echo = every source is a company. Promote writes both fields to the knowledge records.
  - Old ledgers parse: the old `class` key stays readable. Old judge records with a `class` answer map too.
- 11-10: Ask, Live and History become one page, Research › Runs (WA-1106).
  - William: three pages for one job; the chat drives the graph, so they belong side by side.
  - Options, ranked by the full-size chat beside the graph, then links and stories kept, then cost:
    - A. The chat as the page's left column (420 px); past chats in a menu in its head. The right area has Live and History; `?run=` opens one run there. Chosen.
    - B. The graph only, the chat in the shell's side panel. No full-size chat; the chat stories lose their page.
    - C. The chat as a dockview pane inside the run graph. One dock for both, but the dock is per run and History is a list.
  - Narrow (under 1000 px of main): a Seg "Chat | Runs" picks the one pane shown.
  - Old addresses move: `/research/ask`, `/live`, `/history` to `/research/runs`, search kept. A bare `/history` lands on Live, one click from History.
  - A new run in the chat switches the right area to Live (was: navigate to the Live page, which dropped the chat).
  - States, right area:

    | State | Shows | Enters on | Next | Motion |
    |---|---|---|---|---|
    | serve off | NoServe with Try again | runs read fails | loading | fade |
    | loading | card skeleton | page open, retry | live, history, empty | fade |
    | no runs | Empty: ask in the chat | runs read, 0 | live (first run) | fade |
    | live | chat's runs or newest, on the graph | default, Seg, new run in chat | history, one run | fade 200 ms |
    | history | runs list, pick, folders | Seg | one run, several, live | fade 200 ms |
    | one run | back link, Graph / Back and forth | a row, a live link | history or live (back) | fade 200 ms |
    | narrow chat / narrow runs | one pane | Seg | the other | fade 200 ms |

    The chat column keeps the Ask page's states (setup read fails, no setup, loading, chat).

    Built 11-10. Proof: shots of each row at 390 and 1280, both looks; pane, view and new-run switches played (story `NewRunGoesLive`). Proof found two shared faults, both fixed: the phone bar took a hidden pane's heading, and the new-run switch read `location`, not the router. Open: the chat's run card repeats the right-hand graph (WA-1292).

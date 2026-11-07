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

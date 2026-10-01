# Portal as a product (2026-09-30)

The portal stops being a set of pages and becomes a packaged app. One shell, products plug in as modules, and a component kit carries the look. It is built for the VSL, and it is the base every client's portal is cut from.

## What William decided

- The demo "just starts with a page". It must orient you: where we are, what's done, what's next. It must look like a packaged application and show that it's reusable.
- A richer feature set, and it shows where every fact came from.
- "A literal button I can press, see a visual representation of the workflow, get my results." Built for demo wow.
- It's built for the demo. Each client gets a custom version built from it, which makes delivery quick and the agency service a product.
- "Frontend is just as important" as function.
- Shell or reactivation-only: he left it to me. My call: one shell, with products as modules (P1).

## Shape

| Piece | Where | What it does |
|---|---|---|
| Kit | `packages/ui` (new, a foundation) | the lander's tokens, plus base pieces and delivery pieces; knows no product |
| Shell | `AppShell` in `packages/ui/src/shell.tsx`, wired in `apps/portal/web/src/App.tsx` | a bar (Wren, the client, the viewer's buttons) over one window; the launcher, or an app's head and page tabs; demo note |
| Modules | `apps/portal/web/src/modules/<product>` | one product's pages, run graph and setup; `reactivation` first |
| API | `ReactivationPortal` (`packages/reactivation/src/portal`) | new routes `run` (replay events) and `setup` (what the client plugged in); `overview` gains the pipeline; person and email views carry their sources |

## Screens

- **Shell.** A slim bar on the gray canvas over one white window (P10).
  - The bar: Wren, the client (a link to Account, or a switcher for operators), and the viewer's buttons.
  - `/` is the launcher: a card per app with its blurb, a few numbers and what waits on the viewer.
  - Inside an app the window's head shows "All apps", the app's name and its one button, then its pages as tabs.
  - On a phone: the same, with the tabs scrolling sideways. No menu.
- **Home.** Answers four things: what this is, whose list it is, what's done and what's next.
  - Pipeline rail: List → Emails → Where now → Hiring → Score → Briefs → Drafts → Your OK → Sent → Replies. Each step shows a count and a state (done, running, waiting, not started). Clicking a step opens its people.
  - Needs you: drafts waiting for approval.
  - Call first: the top 3, each with a score and one line on why.
  - Waiting: parked work and when it resumes ("8 hiring checks resume tonight").
- **Run.** Full screen, with the workflow drawn as a graph in the lander's flow style.
  - Masked name chips move from node to node, and counters tick.
  - Each node names its source: LinkedIn, job boards, email check, AI with citations.
  - A feed prints real finds. It ends on a results reveal. Space pauses.
- **Sources everywhere.**
  - A source drawer shows the page, the link, who read it, when, and how sure.
  - Briefs get citation chips.
  - Emails get "why this line": sentence → brief line → fact → page.
- **Setup.** What a client plugs in: CRM export, research sources, voice, recruiters, signature, and the send rule "nothing sends without your OK". Read-only on the demo.

## Decisions

- **P1. One shell; products are modules.**
  - A module declares its id, name and pages. It may also declare a run graph and a setup page.
  - The shell renders the workspace (a client), its modules and the current page.
  - A client portal is the same shell with that client's list and settings. There is no per-client code (client-reactivation, Layers).
  - A second product is a new module, not a new app.
- **P10. A suite of apps, not a sidebar.** (William, 2026-10-01: "a suite of apps with cards to click into, not a sidebar that will grow out of control.") `/` is a launcher, one card per app (`AppGrid`, `AppCard`, `AppGlance`). An app's pages are tabs in its head. A module adds `icon`, `blurb` and an optional `Glance` (its card's numbers). One app (the demo) skips the launcher. `menu` modules (Account) sit behind the client's name, never on a card.
- **P2. The kit is a foundation.** `packages/ui` holds React pieces and CSS, and no product types. The layer lint rule already covers `packages/**`. Each piece takes plain props (steps, events, a source), and the module maps its own data onto them.
  - Base pieces: button, tabs (filters), table, tag, stat, card, drawer, menu, tooltip, toast, skeleton, empty state, icons.
  - Delivery pieces: app shell, workflow rail, run view, source drawer, cited text, person timeline, email preview with approve, stat strip, activity feed.
- **P3. Wren's default look is the lander's.** The default tokens come from the lander's DESIGN.md:
  - General Sans and white paper, with ink for text and rust for buttons and marks only.
  - Square uppercase buttons, gray windows with white nodes, hairline rules, one soft lift shadow.
  - Tabular figures, green checks, red crosses.
  - No glass, no glow.
  - Filters become underline tabs. Buttons are square; only chips are pills.
  - That's Wren's look. A client's portal can wear its own (P9).
- **P4. Paths, not hashes.** For example `/reactivation/people?filter=moved`. The URL names the product, which reads well on screen. The Worker and the preview both already serve the app for unknown paths.
- **P5. Run shows a live run when one is going, and a labeled replay when not.** (Revised at step 4.)
  - Live: `crm run` writes one plain line per person or company as it works, into `run_events` (a new table; core `runFeed`). The page polls with the last `seq` it has: every 1.5s while a run is going, every 10s while not.
  - Replay: rebuilt from the records every stage keeps (verifications, lookups, company checks, findings, scores, briefs, emails), in the live run's words. The label stays on screen: "Replay of the work on your list as of Sep 30, sped up."
  - Story order (verify → lookup → signals → score → brief → compose), not clock order. A stage with no records is left out, never filled in.
  - A run that starts while you watch the replay is offered ("Watch it live"), never swapped in.
  - There is never a fake live run.
- **P6. Motion follows the lander.** One thing at a time, in story order. Catch-up runs at most 2x, and nothing is skipped. With reduced motion, the end state shows still. Space pauses.
- **P7. Every new route passes the mask.** `run` and `setup` answer through `mask.ts` (a `source` route was dropped: sources ride along with the person and email views), and the leak test walks them. Setup names a research account by its kind ("a LinkedIn research account"), never by whose it is.
- **P8. "Why this line" needs the composer's sources.** The composer returns, for each sentence, the brief lines it used. They are stored beside the draft and never sent. A draft without them shows no "why".
- **P9. A client's look is data, not a fork.** Every color, face, radius, shadow and case in the kit is a `--ui-` token.
  - A `Theme` is a map of those tokens (`packages/ui/src/theme.tsx`). Four presets ship: `wren`, `night`, `soft`, `editorial`.
  - `AppShell` and `Gate` take `theme`. `ThemeScope` restyles one part of a page. Tints, lines and shadows are mixed from the base colors, so a theme sets a few colors and the rest follow.
  - The kit sits in CSS layer `ui`, so a client's own stylesheet always wins. Every piece takes `className`.
  - `readTheme` cleans stored or typed-in data: unknown keys and unsafe values drop, never throw.
  - The portal previews a preset with `?theme=night` (remembered; `?theme=wren` resets). A client's stored theme waits for the first client with a brand: a `theme` column on `clients`, passed through `me`.

## Later: a personal clip for every lead

William's idea (2026-09-30), not scheduled. A Playwright run drives the portal with human-paced clicks and pauses, films it, and zooms get added after, like a product trailer. Swap in one lead's data and brand, and every lead gets their own run.

What keeps it cheap later, built now:
- Themes are data (P9), so a clip can wear the lead's colors.
- The portal reads everything through one API, so a lead's data can stand in for the demo's.
- Motion is timed and finishes (P6), so a recording is the same every time.
- Stable class names and roles for the script to click.
- The Run replay plays from an event list, so a clip can script its own.

## Build order (commit and push each)

1. Kit and shell. The current pages move onto it with no feature change. Screenshots go to William for look sign-off.
2. Home, pipeline rail, Setup.
3. Sources: drawer, citation chips, "why this line".
4. Run view and results. First, re-run the demo's hiring checks after 2026-10-01 00:00 UTC (8 companies are parked on the LinkedIn cap).
5. Motion pass, phone layout, loading and empty states. Then William records the VSL.

## Where to attack

1. **A replay that reads as live.** The label stays on screen the whole time, with the run's date.
2. **Masking gaps in new routes** (P7). The run feed prints names and companies, so it needs the same mask and the same leak test.
3. **Product types leaking into the kit.** The lint rule catches imports, not shapes. Kit props stay generic (`label`, `count`, `source`), never `briefId`.
4. **Wow over truth.** Animation never shows a count or a find the data doesn't have. Empty stages show as empty.
5. **Phone.** The VSL is recorded on desktop, but prospects open links on phones. Every screen works at 375px.

## Decision log

- **2026-09-30** Design approved ("yes continue"). One shell with modules: my call, since William left it open. The demo gets a replay, not a live run.
- **2026-09-30** Step 1 built. The shell went into the kit (`AppShell`), since every client portal needs the same frame; the portal only feeds it modules. A module is `{id, name, pages}` and the sidebar groups pages by module. Paths route through one click handler, so plain `<a href>` works everywhere. Found and fixed on the way: Data health printed the dead-address share as "not contacted in over a year", plus the operator's gate text. On a phone, tables marked `stack` turn each row into a labeled block.
- **2026-09-30** Look signed off ("looks fine"), with one ask: the kit must be "heavily customizable style wise". Every look became a `--ui-` token in CSS layer `ui`, themes became data with four presets, and every piece took `className` (P9). Wren's default renders pixel for pixel as signed off. The per-lead clip idea is logged under Later.
- **2026-09-30** Step 2 built. `overview` carries the pipeline, read from `crmStatus` so the rail and `crm status` never disagree; a new `setup` route answers through the mask. The rail is a kit piece (`Rail`: phases of steps, across when wide, down when narrow, by its own width). Home now answers the four questions: the rail, then what's next (needs you, runs next, parked and till when), then what we found and the top 3. Deviations: the rail has no "running" state yet, since nothing records a live run until the Run view; a step with work due says "runs next". Setup names research logins by site only, never the import's file name, the fee or the offer. The leak test walks both routes, with a personal-looking account name and a firm-named export.
- **2026-09-30** Step 3 built. Kit pieces: `Cite` (numbered chip), `Sure` (four bars plus words: Sure, Fairly sure, Maybe, Unsure), `SourceCard` and `SourceList`, `Trail` (a claim, then what it rests on) and `Traced` (a paragraph with a "Why" chip). Brief chips light their card and scroll to it. Each email paragraph written from the brief opens "Why this line": the paragraph, the brief lines it came from, then their sources with page links. The Sources page shows how sure each reading is.
  - How P8 landed: composer v4 gets the brief as numbered lines and returns each email as paragraphs with the line numbers they used. Provenance keeps the brief's lines and each message's why. A why shows only while its paragraph is still word for word in the email, so an edited draft shows none.
  - `crm redraft [ids...] --all` rewrites drafts still waiting for approval, in place, same sender. The demo's 6 drafts were redrafted with it.
  - Deviations:
    - No `source` route. Sources ride along with the person and email views, which already pass the mask, so P7 holds with one route fewer.
    - A redraft records a new 'drafted' composition for the same enrollment. So the daily cap now counts enrollments made in the last day, and `crm status` counts drafted enrollments, not compositions.
    - The prompt now bans numbers the brief lacks: the fact gate refused two drafts that offered "10 minutes".
- **2026-09-30** William: "there's no actual approval button for the emails." The demo hid them as read-only. Now each waiting email has Approve and Don't send, and the demo shows them too. On the demo a click changes only the page (tag, counts, a line saying nothing sends); a reload resets it. Client portals call `approve` and `skip` as before.
- **2026-09-30** Step 4 built. William approved the event system ("thats the sort of system im thinking of"): live lines from `run_events`, polled; the replay from records (P5 revised, since the original "no new table" couldn't show a live run).
  - Core: `runFeed(db, runId)` writes a line and never stops the work (it warns once, then goes quiet); `readFeed` reads after a cursor. `detail` (the technical why) reaches operators only.
  - Kit: `RunView` takes steps and lines as plain props. One line at a time; a live backlog plays at most 2x, never skips; reduced motion shows the end state; Space pauses. A step's count is its handled subjects, or its last line's `count` where it has no line per subject (email checks). Parked subjects show as "waiting", not handled.
  - Portal: a Run page and a "Watch it run" header button (a module names its one header action). The `run` route is cached 2s at the edge, passes the mask, and the leak test walks it.
  - Hiring re-run stays parked: no LinkedIn reads on William's account until he lifts it. The replay shows the parked checks as waiting.
  - Next, in autobrowse's own session: a forward channel so a browser step's progress lands in the same feed (`x-feed-url`, `x-feed-tag`, `traceparent`). Wren then adds the ingest route.
  - When the portal gets a day counter or an end date for the reactivation window, it uses channel-email's `windowEnd(start, days, calendars)`: the 30 days skip holidays.
- **2026-10-01** autobrowse 0.3.0 shipped the forward channel. The ingest route waits: wren only calls autobrowse through `sites/call` and `do`, and only a workflow `run` takes a feed. It gets built with the first wren product that starts an autobrowse workflow run. Plan when it does: a portal Worker route takes `{tag, traceparent?, events:[{seq, event}]}`, checks `Bearer FEED_TOKEN` as a Worker secret (no SSM read per post), and a Restate handler writes `run_events`. The tag names the client and the run, since each client has its own database.
  - Every autobrowse call now names its caller (`wren:crm-run` and so on), so autobrowse can say who spent a capped site's reads. One failed LinkedIn read stops the stage; no second read.
- **2026-10-01** Step 5 built: phone, loading, errors, empty states, motion. Checked every page on a computer (1440 wide) and an iPhone SE, live, stalled, failing and as a fresh client with no data.
  - Phone: Sources stacks into labeled blocks like People. Checkboxes and the "Why" chip get finger-sized targets on touch screens.
  - Loading: `Loading` takes a shape (`lines`, `rows`, `cards`) and an optional heading, so each page's ghost matches what lands. People and Sources use rows; Emails and Replies use cards; the wait before the client is known shows a heading.
  - Errors: `Alert` takes `onRetry` and shows a Try again button; `useCall` returns `retry`. Every load failure has one. The messages lost their own "Try again." since the button says it.
  - Empty: every page already said what's missing and when it fills in. No change.
  - Motion: a new page, and data landing after its loader, fade in (0.4s). Opacity only, and only while it plays, so a drawer opened by a link stays where it belongs. Reduced motion turns it off with the rest.
- **2026-10-01** William: the Run view read like a task list, not a workflow ("your call"). It is now the graph the Screens section asked for.
  - Kit: a step names what it builds on (`after`; left out means the step before). Columns come from that, so parallel steps stack in one column and lines show what feeds what. `input` and `output` nodes bracket the run; the output lights when it's over. A replay drops steps it has no lines for and joins the lines around them.
  - Lines are measured from the nodes, so any theme or width keeps them attached. Across when each column gets 150px, down otherwise; down, a long line rides a left gutter.
  - Motion: a spark rides into a step for each line about one person, colored by what came of it. The line into a working step flows. Each node has a bar: finds, plain checks, misses, waiting. Reduced motion shows none of it moving.
  - Following: click a step to see only its lines, or a line to follow that person through every step they touched. Everything else dims. Escape or "Show all" clears it.
  - Portal: the three checks read the list side by side; ranking takes moves and hiring; drafts take the brief and the checked email.
- **2026-10-01** Sidebar replaced by a launcher (P10). Re-checked the earlier calls:
  - Sidebar of every app's pages → a card per app, and the open app's pages as tabs. More apps add cards, not nav length.
  - Breadcrumb header → the app's head ("All apps" / app). Tabs already say the page.
  - Phone menu sheet → gone. The bar stays, tabs scroll sideways, one less tap.
  - Demo note in the sidebar → a folded line above every page, on all sizes.
  - Big workspace card → the client's name in the bar, a link to Account (delivery session's module); no "Workspace" caption, which read as noise. The demo says "Demo".
  - Landing on the first page → `/` is the launcher when there are two or more apps. `/<app>` opens its first page; unknown paths go home.
  - Page icons dropped (tabs are text). First tabs renamed "Overview", since "Home" now reads as the launcher.
  - Later: a client sees only the apps it has (`clients.products`), once a second product ships.

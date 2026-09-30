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
| Shell | `AppShell` in `packages/ui/src/shell.tsx`, wired in `apps/portal/web/src/App.tsx` | the workspace › product frame, nav, Run button, demo note |
| Modules | `apps/portal/web/src/modules/<product>` | one product's pages, run graph and setup; `reactivation` first |
| API | `ReactivationPortal` (`packages/reactivation/src/portal`) | new routes `run` (replay events), `source` (one finding) and `setup` (what the client plugged in); `overview` gains the pipeline |

## Screens

- **Shell.** A gray canvas with a white main window.
  - The sidebar has the workspace (a switcher for operators), the product and its pages, and the viewer.
  - The header shows `workspace › product › page`, the status and Run.
  - On a phone: a top bar and a menu sheet.
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
- **P5. The demo's Run is a replay, and says so.** The label reads "Replay of the Sep 30 run, sped up".
  - Its events come from timestamps every stage already writes: verifications, person lookups, company checks, findings, scores, briefs and compositions. No new table.
  - They play in story order (verify → lookup → signals → score → brief → compose), not clock order. Stages overlap, and the briefs were redone after compose.
  - Client portals later show the same view live, from the same events.
  - There is never a fake live run.
- **P6. Motion follows the lander.** One thing at a time, in story order. Catch-up runs at most 2x, and nothing is skipped. With reduced motion, the end state shows still. Space pauses.
- **P7. Every new route passes the mask.** `run`, `source` and `setup` answer through `mask.ts`, and the leak test walks them. Setup names a research account by its kind ("a LinkedIn research account"), never by whose it is.
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

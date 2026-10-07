# Console standard

Living doc. Started 2026-10-03. Revise in place and log changes at the bottom. It replaces the app pages in `2026-10-03-console-ui.md` (Phase 2 steps 7 to 10, and Phase 3). That doc still owns the stack, access and Phase 2's server routes.

## What William said

2026-10-03, after Phase 1 shipped: the UI "isn't very in depth", "isn't clearly extensible", and the "copy / demo is also bad". It needs to be "more high ticket", "standardized", "least friction", "maximum utility".

## What's wrong today

Checked page by page on 2026-10-03, on the demo and on the app host as the operator.

Not extensible:
- Every page is written by hand: 27 page files (4,770 lines) and 3 CSS files (674 lines) in the portal's modules, plus 2,700 lines of `kit.css`. Pipeline is the only widget tree.
- Each page builds its own table, filter tabs, drawer and empty state. A second product means writing all of it again.

Not in depth:
- Numbers lead nowhere. Pipeline's stat strip and chart and Data health's bars don't open the rows behind them.
- No time. No page shows a trend, a change since last week, or a date range.
- Tables don't sort by column (except Pipeline's), filter on a field, save a view or act in bulk (except Emails). No keyboard.
- A person opens a drawer of facts with nothing to do: no draft to approve, no "called", no history.
- The operator lands on "Demo recruiting firm" as if it were Wren's workspace. Ops says "No clients yet. Add one: wren clients add <id>".

The product itself:
- Movers get no email. Compose skips anyone who moved, since their CRM address is at the old firm. Movers are the best reason to call.
- So every demo draft goes to someone with no reason to hear from us: "quick check in. Hope you're doing well. Saw you're still at Coinsquare… It's been a while since we last connected."
- "Why call now" for someone with no signal is a CRM summary ("still at Acuity Insights… last contacted 2024-07-27"). The score says "+40 still at Acuity Insights".

Copy:
- Every page opens with a title and a lede that repeats it ("People. Everyone on your list and what we found.").
- The demo apologizes on most pages: "Off on the demo", "Approving is off on the demo", "none yet", "No replies yet".
- Internal names on screen: `sec_ria`, `agencies`, "Wren ops".

Demo:
- It shows the process, not the result. A 10-step rail leads and ends on Sent 0, Replies 0.
- 21 people. Too few to feel like a real list.
- A banner on every page.

Look:
- Two styles side by side: rust uppercase buttons from `kit.css` next to outlined shadcn ones.
- Marketing type in an app: 32px titles, 15px ledes, wide gutters, empty white.
- Every chart series is black.

## The bar

High ticket means it reads like Stripe's dashboard, Linear or Attio. As rules:

1. Outcome first. A product's first screen says what the client got and what to do now, in numbers.
2. Every number links to its rows, every row opens a record, every record carries its actions. Three clicks from a number to done.
3. One way to do each thing. Tables, filters, states, empty states and confirms look and act the same in every app.
4. Dense and calm. Small type, tabular figures, hairlines, one accent. Color only where it means something.
5. Keyboard for queues. J and K move, A approves, E edits, S skips, ⌘K finds anything.
6. Nothing apologizes. An empty state says what fills it and when.
7. Undo, not confirm, for anything reversible. Confirm only what can't be undone, like a send.

## The standard: records, not pages

Products declare what their things are. The shell draws them. A new product or operator app is declarations plus one SQL view per record type, with no page code.

### Field kinds

One kind per sort of value. Each kind owns its table cell, detail line, filter control, sort and CSV cell. A new kind is one file in `@wren/ui`.

`text`, `name` (a person, masked on the demo), `company` (with its domain), `status` (fixed states, each with a tone), `number`, `money` (currency per row), `percent`, `rate` (n of m, with a Wilson interval and "too few to tell" under 30), `date` (relative, exact on hover), `verdict` (an email check), `score`, `link`, `cited` (text with source chips).

### Record types

A record type is plain data in its product package, so the server and the web read one declaration:

```ts
export const person = defineRecord({
  id: "reactivation.person",
  name: { one: "person", many: "people" },
  view: "reactivation_people", // the SQL view behind lists
  key: "id",
  title: "name",
  subtitle: "title",
  fields: {
    now: status(NOW), // moved, hiring, there, left, unknown
    company: company(),
    score: score(),
    lastContact: date("Last contact"),
    owner: name("Owner"),
    email: verdict(),
  },
  views: [
    { id: "call", label: "Call first", where: { now: ["moved", "hiring"] }, sort: "-score" },
    { id: "all", label: "Everyone", sort: "-score" },
  ],
  related: [
    { record: "reactivation.email", by: "person" },
    { record: "reactivation.finding", by: "person" },
  ],
  actions: ["reactivation.approve", "reactivation.skip", "reactivation.called"],
});
```

`defineRecord` and the kind helpers live in `@wren/core/records` with no React. `@wren/ui` maps each kind to its renderers.

### Server: one records route

Each portal service mounts the same routes from one core helper, `serveRecords(types, db, mask)`:

- `records/list {record, view?, where?, sort?, q?, cursor?}`: rows, the total, and a count per saved view.
- `records/get {record, id}`: the record, a count per related type, its activity.
- `records/export {record, view?, where?}`: CSV.

SQL comes only from the declaration. Fields must exist on the type, operators are a fixed set, values are bound, and paging is by key. A product service passes its client database and its mask, so the demo stays masked and a client sees only their own rows. Wren's own records (campaigns, inboxes, loops, spend) mount on ConsolePortal, team only.

A record whose detail needs more than its row, like a person's brief and sources, adds `load(id)` in its package.

### Templates

Five page kinds, generic, in `@wren/ui`. An app's pages are a list of these with settings:

- **Overview.** An outcome strip, what needs you, one or two trend charts, the top records. Each stat links to a saved view and shows its change against the prior period.
- **List.** Saved views as tabs with counts, search, a filter chip per field, sort per column, a column picker, bulk actions, CSV. Sticky header, 40px rows, row actions on hover, J and K to move, Enter to open. The URL holds the state, so every view is a link.
- **Record.** A side panel from a list, or a full page from a link. The head has the title, status, key fields and actions. Tabs: details, each related type as a small list, activity, sources.
- **Queue.** For anything waiting on a person: drafts, replies, asks. Items on the left; on the right, the item with its context (the brief behind a draft, the thread behind a reply) and an action bar on keys. "3 of 6". The next item opens after each action.
- **Run.** The workflow graph and feed, as now.

A page that fits none stays a component, and the log says why.

### Actions

`Action` from Phase 2 gains:
- `key`: its shortcut in a list or queue.
- `bulk`: offered on a selection.
- `undo`: the handler that reverses it. A reversible action runs at once and shows an undo toast for 10 seconds. Anything else confirms.

On the demo, an action runs on a copy of the answer in the browser. A buyer approves a draft and watches it move to Approved, and a reload resets it. The server still refuses every demo write.

### Look

The brand stays: General Sans, white paper on gray, rust for the one primary action, square corners.

- Type: 13px tables, 14px body, 20px page titles, 28px stats. No ledes.
- Size follows use. What waits on you reads first: a needs tile with a count gets an amber rule, an amber wash and a 36px figure; a nav count is an amber badge. The action pressed most on a record or queue item is the one 36px button (`size="next"`). A record's key fields read as 18px figures. Columns and Export CSV are quiet text buttons.
- Buttons in sentence case at 13px. The lander keeps its uppercase.
- Lists use the full window width. Overviews cap at 1200px.
- Status colors: green done, amber waiting on you, red failed, gray not started.
- Charts use the five theme chart colors.
- A stat tile shows the value, the label, the change against the prior period and a sparkline. The whole tile is the link.

### Copy

- A page title only. A lede only when the page needs an instruction, one line.
- Numbers lead: "6 drafts to approve", not "Your OK: 6".
- One word per state, used everywhere.
- Human names for niches, apps and stages. Never a slug, a table, a CLI command or an internal name.
- An empty state says what fills it and when: "Replies land here. The first emails go out after you approve them."
- A test fails the build on banned strings in module code: "on the demo", "none yet", a `wren ` command, a `snake_case` label.

### Demo

- Lead with the result. The overview opens on who to call this week and why, with the brief one click away. The process rail moves to Run.
- Every action works in the browser. Nothing says "off on the demo".
- One "Sample firm" chip in the top bar links to how the demo was built. No banner.
- Movers and hiring first, each with a draft that names the move or the opening.
- At least 100 people. A bigger list costs research and email checks, so its size is William's call.
- Nothing invented is shown as real. The demo has no replies or meetings, so Replies offers a labeled walk-through of what happens when someone replies.

## Product depth

The UI can only show what reactivation does, so three fixes in the product:

1. Movers get an email at their new firm. Lookup finds the address at the new company and mailifier checks it. Free path only.
2. No signal, no draft. Someone still at the same firm with no hiring or other signal goes to a "Keep warm" view, not to Emails.
3. Why call now opens with the signal in one sentence, then the facts. The score explains itself in the same words ("Moved to Osborne 4 months ago"), not "+40".

## Phases

One implementer per phase, from this doc. Commit and push each step.

### S1. Foundations, proven on People and Emails

1. Field kinds and their renderers.
2. `defineRecord`, the kind helpers and `serveRecords`, with tests on synthetic data: unknown fields refused, fixed operators, bound values, keyset paging, the mask applied.
3. The List, Record and Queue templates. Action `key`, `bulk` and `undo`. Demo actions in the browser.
4. Reactivation records: person, email (a draft) and finding. `records/*` mounted on ReactivationPortal.
5. People becomes a List with the Record panel. Emails becomes a Queue. `People.tsx`, `Emails.tsx` and anything only they used get deleted.
6. The copy test.

### S2. Wren's workspace

1. The operator's home is Wren (client zero), not the demo firm. The switcher moves between Wren, the demo and each client.
2. Records on ConsolePortal over Phase 2's routes and views: campaign, inbox, warm reply, loop, spend line, subscription, model usage.
3. Apps: Outbound, Inbox (a Queue), Loops, Money, Pipeline (its numbers open the firms behind them) and Clients (a form adds one).
4. The Overview template, used by each.

### S3. Everything else on the standard

1. Reactivation: Overview, Replies, Sources (into each record's Sources tab), Data health (into the Overview) and Setup (a form, read-only on the demo).
2. The client's project pages: plan, updates, needs you, paperwork, deliverables.
3. `kit.css`, `reactivation.css`, `work.css` and `ops.css` deleted.
4. The token pass, so the look is ours and not shadcn's defaults. General Sans stays.
   - Square corners everywhere, as Look says: buttons, inputs, tiles, the paper, dialogs, panels and menus. One `--ui-radius`, 0.
   - Hairline borders in one gray. Shadows only on overlays.
   - Tabular figures in tables and tiles. One number formatter: thousands separators, whole units in tiles, cents in lists, the currency shown one way everywhere.
   - One row height for lists.
5. Polish from S2's screenshots.
   - Columns fit short values and their headers. "Follow-ups only", "10 minutes ago" and "Failures in a row" never truncate.
   - A record hides empty fields. A campaign with no console override shows no "Set" rows.
   - One name per thing. A campaign reads "Agencies" in its list, its panel and the Overview.
   - Overview tiles fill their rows, with no lone tile.
   - The record panel's padding at 390px, and record tabs that fit at 390 ("Sources" on a person is cut off).
   - A page's title is its nav name. Setup reads "Setup", not "Settings"; Needs you reads "Needs you", not "Asks".
   - Setup is a read-only form, as item 1 says, not a list: no checkboxes, no Export CSV, and values wrap.
   - Relative times never round up a year. 18 months reads "1 year ago".
   - Billing's `<Table>` moves onto a List.
6. Leftovers: the Pipeline "Crawled, no person" count under 1s (it takes over 3s), `delivery.invite` as a client action, People's `reactivation.called` action, and no CSP errors from sonner in the browser console.

### S4. Demo and product depth

1. Product depth 1 to 3. 1 and 2 shipped 10-03 (be17b46..1633b98). What's left, seen in S3's screenshots:
   - Why call now reads as one plain sentence. "Moved to Osborne Interim Management in Sep 2025", not the profile's raw "Sep 2025 - Present (1 year) in Toronto, Ontario, Canada".
   - A mover's Email field shows the new-firm address and its verdict. The old address goes under Where now, not a red "Invalid" on someone marked Call first.
2. The demo rules. The list's size waits on William's yes.
   - The Overview's Call first rows show each person's one-sentence reason.
   - The banner goes. The top bar's "Demo" chip reads "Sample firm" and opens What's real.
   - Replies, empty on the demo, offers a labeled walk-through of what happens when someone replies.
   - Nothing on the demo host says an action only works elsewhere.
3. Campaign names, not niche keys, in firm and reply rows: "Recruiting", not "recruiting".

## Done when

- S1: People and Emails screenshot well on the demo and the app host. The finding type is under 80 lines with no JSX. Module line counts before and after are noted here. Gates pass.
- S2: Every operator app screenshots on prod as the operator with real numbers. Every stat opens its rows.
- S3: `kit.css` and the module CSS files are gone. No module file renders a `<table>` or imports CSS. Every app screenshots at 1360 and 390 with square corners and no truncated short values.
- S4: The demo's first screen shows who to call and why. Every demo action works and resets on reload. The copy test passes.

## Risks

- A generic list over a client's database is a query builder. The declaration is the allowlist, values are always bound, and adversarial tests cover it.
- Pages the templates don't fit. The escape hatch is a plain component, logged here.
- Look is taste. S1's screenshots go to William the day they land.

## Decision log

- 2026-10-03: Started after William's review of Phase 1. Records, field kinds and five templates become the standard. Phase 2's app pages and Phase 3 fold into S1 to S3. Phase 2's server routes and views stay.
- 2026-10-03: The brand stays (General Sans, rust, square corners). App buttons go to sentence case and the lander keeps uppercase. My call; William can reverse it.
- 2026-10-03: "Least friction" read as the fewest steps to a result: demo actions run in the browser, and nothing invented is shown as real.
- 2026-10-03 (product depth): `contact_scores.next_step` says what to do: `reach_out` (a move to a named firm, or open roles at their firm), `keep_warm` (no signal, the portal's Keep warm), `none` (left). Compose writes only to `reach_out`. Null means scored before the column, so it rescores.
- 2026-10-03 (product depth): "Not found yet" with no open roles is keep warm. A `job_change` with no new firm counts as left. Posts and news are not signals yet; nothing writes them.
- 2026-10-03 (product depth): Movers are their own `crm run` stage after signals, never in the loop. It stops without a fetcher or without a free, trusted verifier (smtp), so MillionVerifier credits are never touched.
- 2026-10-03 (product depth): The new firm's domain is a CRM company of the same name first, else its own site (DNS plus the ownership gate). Then the domain's proven pattern, else the top 3 common ones, best first, stopping at the first valid. A catch-all stops with no address. A miss is tried again after 30 days.
- 2026-10-03 (product depth): A found address adds the new firm to `companies` by domain, and a mover's enrollment is filed under it. So one thread per firm counts the firm they work at now; a live thread at the old firm no longer holds them. Seen on the demo: a mover was held by a colleague's keep-warm draft at the old firm.
- 2026-10-03 (product depth): The opener naming the move is asked for in the prompt, not gated: a hard gate means paid retries. The brief's signal sentence is moved first by the gate when the model puts it later. `BRIEF_VERSION` v4, `COMPOSE_VERSION` v5.
- 2026-10-03 (S1 server): The handlers are `recordsTypes`, `recordsList`, `recordsGet` and `recordsExport` on ReactivationPortal, not `records/list`. The portal Worker opens one path segment per route.
- 2026-10-03 (S1 server): `recordsTypes` sends each type's fields and views, and what this viewer may filter, sort and search. The web reads that and imports the declarations as types only.
- 2026-10-03 (S1 server): The demo never filters, sorts or searches a name or company. It never matches part of any text, and it sorts only by numbers, dates and states, because a substring hit or a page marker could spell a hidden surname. So the demo has no search box. A filter value the mask would rewrite matches nothing, and a saved view that sorts by text pages by key on the demo.
- 2026-10-03 (S1 server): `title` and `subtitle` must be fields. A field's column defaults to its key in snake_case.
- 2026-10-03 (S1 server): Cells are typed. Company is `{name, domain}`, money is `{amount, currency}` with a currency column per row, and rate is `{n, of}` (the renderer adds the Wilson interval). A cited cell is text with `[f12]` marks, and its sources come from `load`.
- 2026-10-03 (S1 server): A related list is `recordsList` with `of: {record, id}`. Activity is a declared view with `at`, `kind` and `what`. A list page is 50 rows, 200 at most. Export stops at 5000 rows and sets `capped`.
- 2026-10-03 (S1 server): Approve and skip sit on the email type, since an email row's key is the id they take. `reactivation.called` waits until that action exists.
- 2026-10-03 (S1 server): Email status takes the first match of skipped, sent, stopped, to approve, approved. A pair that went out and then got a reply shows under Sent.
- 2026-10-03 (S1 server): People have a `nextStep` field, and Keep warm reads `next_step = 'keep_warm'`. The people view inlines the finding fragments from `score.ts`, so changing those needs a new migration for the view (now 0060).
- 2026-10-03 (S1 UI): A page is declared as data, `{template: "list", record, empty?, columns?, extras?, legacy?}`. `TemplatePage` gives it the four record calls and the address, and draws `RecordList` or `RecordPage` from `@wren/ui`. People is the first. Its file holds only the extras (where now, why this score, how we looked) and the old-link rewrite.
- 2026-10-03 (S1 UI): The address holds the whole state: `view`, one param per filtered field (`a,b`, `lo..hi`, `~word`, `+`, `-`), `q`, `sort`, `cols`, `after`, the open record under its singular name (`person`) and `tab`. `/reactivation/people/<id>` is the full page. Old `?filter=moved` links rewrite to `?view=all&now=moved`.
- 2026-10-03 (S1 UI): Every field with states or a range gets a filter chip. A text field that search covers gets none, and so does a field that can only be empty or set. The demo allows no search, so it shows no box.
- 2026-10-03 (S1 UI): A page may name its default columns. People hides owner and next step until picked, so the rest fit at 1360px without cutting text. Column widths are s, m and l (108, 144 and 200px).
- 2026-10-03 (S1 UI): Lists drop the 1240px cap and use the full window. The record panel opens 560px wide on the right and covers the screen on a phone.
- 2026-10-03 (S1 UI): Bulk select is layout only, checkboxes and an "N selected" count. Head actions draw only when a page passes them, and People passes none yet. Both wait for Action `key`, `bulk` and `undo`.
- 2026-10-03 (S1 UI): The brief is a cited field, so it leads the details tab with its source chips. A chip opens Sources and lights that card.
- 2026-10-03 (S1 UI): A bare day, or a timestamp at UTC midnight, shows as that day with no time. Before, a CRM's "2024-07-27" read as the 26th at 8 PM in Toronto.
- 2026-10-03 (S1 UI): The old `people` handler, `portalPeople` and its filter list are gone. Their tenancy, mask and wildcard tests now call `recordsList`.
- 2026-10-03 (S1 UI): Lines in `apps/portal/web/src/modules`: 6290 before, 5891 after; reactivation 3112 to 2713. `@wren/ui` gained `records.tsx` (1232) and `fields.tsx` (388) for every later list to reuse.
- 2026-10-03 (S2 server): Wren's records read the main database, team only and unmasked. ConsolePortal answers `recordsTypes`, `recordsList`, `recordsGet`, `recordsExport` and `recordsStats` in a read-only transaction. The demo and clients get 403. Each type lives with its data. In channel-email: `email.campaign` (All, Opening), `email.inbox` (Sending, Paused, All), `email.reply` (Waiting on you, Booked, All), `email.firm` and `email.model` (This month, Last month, All). In books: `books.spend` (This month, Last month, All) and `books.subscription` (All, Renewing soon, Past renewal). In core: `console.client` (Clients, All) and `console.loop`.
- 2026-10-03 (S2 server): A type can declare `rows` in place of `view`, a function that returns plain rows. serveRecords calls it once per request and queries the result as a table (`jsonb_to_recordset`, every column text), so filters, sorts, pages and counts run the same SQL as on a view. Picked over a loops adapter with its own filter code. Loops, inboxes and campaigns use it.
- 2026-10-03 (S2 server): `console.loop` is `loops` as a record, its id `Service/key`. Fields: service, key, state (running, stopped), health (failing, ok), lastAt, failures, error, nextAt. Views: All, Failing, Stopped. `console.startLoop` and `console.stopLoop` both call `console/setLoop` with `{service, key, run}`.
- 2026-10-03 (S2 server): Inboxes have no SQL view, since the roster and send policy are config. `email.inbox` builds its rows from them, today's sends, active pauses and domain health. A campaign's view gets the policy's state (opening, or follow-ups only) and kill switch merged in code, console overrides included.
- 2026-10-03 (S2 server): Action ids are `<portal alias>.<route>`. `email.approve` and `email.drop` take the reply's id (`{id, body?}`). `email.pause` takes `{target, reason}` and `email.resume` takes `{target}`, where the target is an address or a domain.
- 2026-10-03 (S2 server): The new views read base tables only, so changing one never makes drizzle drop another. Migration 0061.
- 2026-10-04 (controls): Campaign controls live without a deploy. Table `campaign_controls` (migration 0066, main database only, audited) holds a kill switch and an opener cap per campaign; null means the env default. `SendPolicy.withCampaigns` merges them into a new frozen policy, read once per tick: the main send scope (deliver's resume rule, the domain kill switches), the compose and pool schedulers, and the campaign and inbox records. Client scopes don't read it.
- 2026-10-04 (controls): `email.killSwitchOff`/`email.killSwitchOn` and `email.stopOpeners`/`email.resumeOpeners` on `email.campaign` take `{ids}` and answer `{done, skipped}`; each pair is the other's undo. A value equal to env is stored as null, so the undo lands back on env with no history read. `EmailConsole.setCampaign {campaign, killSwitch?, openersPerDay?}` sets either value; null clears it. Known limit: a cap set to N through `setCampaign`, then Stop, then undo, returns to env, not N. Resume is skipped when env itself holds the campaign at 0. Campaign rows show `overrides`, `setBy` and `setAt`. Team only; an unknown campaign is skipped, or 404 on `setCampaign`.
- 2026-10-04 (controls): `console.addClient {id, name}` makes a client from the console, team only. The Lambda bundle carries `drizzle/` (the SQL and the journal, no snapshots), so `app/lambda.mjs` and `app/box.mjs` resolve `../drizzle`; the build fails when the journal and the SQL files disagree. One `ctx.run` step, retries capped at 3. `addClient` is safe to retry: a registered id comes back as it is, a half-made database is migrated again, and the insert skips a row a racing add wrote. The same id with another name, or the demo's id, is 409. A fresh migrate took about 2 s in the test container (Lambda timeout 900 s). People are added after with `delivery.invite {client, email, role}`, the existing members code. The CLI keeps refusing a taken id.
- 2026-10-03 (S2 server): Firm views follow `pipeline_funnel`: In play, With a domain, Crawled, Named person, Verified lead, Declined. A verified lead's date is when its lead row was made, which is close to when it was verified.
- 2026-10-03 (S2 server, for the UI): `recordsStats({record, view?, where?, q?, of?, at?, period, sum?, zone?})` returns `{record, view, value, prior, series: [{at, value}], currency}`. `period` is 1 to 92 days or `"month"`. `at` is a date field and defaults to the saved view's `at`. `sum` adds up a number or money field; without it, rows are counted. `zone` is an IANA zone, UTC by default, and each day starts at its midnight. A bare day, like a month's first, counts from that midnight too. `value` covers this period up to now. `prior` covers the same stretch of the period before: last week up to the same hour, or the same first days of last month, never past its end. `series` has one point per day of this period, zeros included. `currency` is set when `sum` is money; mixed currencies are refused with 400, like any ask it can't answer. It runs list's plan, so the demo's rules hold, and it groups by day only, so a key never carries a name. ReactivationPortal has it too. Known limit: a DST change inside the prior stretch moves its end by an hour.
- 2026-10-03 (S1 UI, second half): Emails is a Queue, `{template: "queue", record: "reactivation.email"}`, over the four email views. Its file holds the actions, the empty lines and the extras: the draft leads, each traced paragraph opens why that line (the brief lines, then what they cite), and a link goes to the full brief.
- 2026-10-03 (S1 UI): An action may say `when` (the states it applies to) and `sets` (what it changes). Buttons, keys and bulk use `when`; the demo lays `sets` over the row in the browser. Every record action takes `{ids}` and answers `{done, skipped}`, so approve and skip took `ids` in place of `enrollmentIds`.
- 2026-10-03 (S1 UI): Approve undoes for 10 seconds through a new `unapprove` route: approved goes back to draft unless a send already took the row. A late undo says "Too late to undo." Don't send can't be undone, so it confirms first.
- 2026-10-03 (S1 UI): `RecordExtras.lead` draws above a record's facts. The draft uses it.
- 2026-10-03 (S1 UI): People has no actions; `reactivation.called` waits. E for edit waits for an edit action.
- 2026-10-03 (S1 UI): Sonner's CSS ships as a file from `tailwind.css`; the CSP blocked the style tag it injects. One toaster sits at the app root.
- 2026-10-03 (S1 UI): On the demo, record actions run in the browser and the server refuses `approve`, `skip` and `unapprove` from a demo viewer or for the demo client. `Me` marks the demo client, so an operator looking at it acts locally too. Work-module actions on the demo still say "Works in your own workspace." until S4.
- 2026-10-03 (S1 UI): The old `emails` handler stays: its mask tests cover the email detail the Queue reads.
- 2026-10-03 (S1 UI): Module code (ts and tsx, no tests) went from 5,066 lines to 4,637. `reactivation.css` went from 355 to 285.
- 2026-10-04 (S2 UI): Wren is a workspace in the switcher, beside the demo and each client, and the operator's default. Wren's apps show only there, and a client's workspace shows only client apps. The launcher's "Wren team" grid is gone. Moving between Wren and a client goes to that workspace's home.
- 2026-10-04 (S2 UI): Overview is a template, `{template: "overview", tiles, top?}`. A tile with a period reads `recordsStats`: the number, the change from the period before, and a bar a day. A tile with no period counts a view's rows now, with no change line or bars, since a state keeps no history (loops, inboxes, subscriptions). Every tile links to its rows, narrowed to the period by the view's `at`. A top list shows a view's first 5 rows. The old trend charts are gone.
- 2026-10-04 (S2 UI): The console's one-record handlers (`approve`, `drop`, `pause`, `resume`, `setLoop`) keep their inputs. The web calls them once per id and answers `{done, skipped}` itself, so bulk and undo need no new routes.
- 2026-10-04 (S2 UI): An action may `ask` for text, `{field, label, from?}`, and `from` fills it from the row. Inbox's Send starts from the draft. E opens the first action that asks when no action takes E, which is E for edit.
- 2026-10-04 (S2 UI): `email.model` has no cost, so Money puts AI spend (spend lines whose account names AI models) beside Model calls and above the Model usage list. Cost per model waits for a cost field.
- 2026-10-04 (S2 UI): Pipeline's tiles open the firms at each stage. Its catch-all, risky and by-niche charts are dropped. The ops board page is gone; `delivery/board` stays on the server with no page.
- 2026-10-04 (S2 UI): Deleted `page.tsx`, `chart.tsx`, `data-table.tsx`, the ops and pipeline modules and `ops.css`, and with them recharts and @tanstack/react-table. On a phone the app tabs wrap to a second row, so "Data health" shows at 390px.
- 2026-10-04 (S2 UI): An action may be a `form`: fields with a label, an optional hint and pattern, and `from` to fill one from the fields before it. It makes a record, so it takes no ids, applies to no row and shows by the list's title. Clients' Add client is one (name, then a short name filled from it); the hand-built dialog is gone. Campaigns' kill switch and opener buttons are plain row actions, each the other's undo. `delivery.invite` on a client has no button yet.
- 2026-10-04 (S2 UI): Module code went from 4,637 lines to 5,010. Wren's six apps add 577, mostly declarations, and the ops and pipeline modules lose 206. `@wren/ui` went from 8,514 to 8,076.
- 2026-10-04 (S3 pages): Reactivation's Overview is the template. Tiles: Call first, Drafts to approve, Moved jobs, Hiring, Emails sent, Replies and Meetings booked (last 30 days), Keep warm, then data health over the person records: Emails that bounce, No email, No title, Quiet over a year. Twelve, so no row has a lone tile at 5, 4 or 2 columns. Top lists: Call first and Drafts to approve.
- 2026-10-04 (S3 pages): Data health's CRM-only counts (duplicate rows, owners, import errors) are dropped; the template reads records, and no record holds them. Its page and `crmHealth` route are gone.
- 2026-10-04 (S3 pages): The process rail moves to Run, above the replay, as Demo says. Run keeps its own component (live lines and replay), with no lede. The project bar on the old Overview is dropped; the project pages carry it.
- 2026-10-04 (S3 pages): Replies is a Queue over `reactivation.reply` (view `reactivation_replies`, migration 0068): Interested, Booked, All replies. The reply text leads. Mark booked (B, bulk) undoes for 10 seconds; `book` and `unbook` take `{ids}` and answer `{done, skipped}`. A reply booked before is skipped, so its undo can't drop someone else's mark. The "Owed so far" strip is dropped; billing shows invoices.
- 2026-10-04 (S3 pages): Sources is gone. The person record's Sources tab shows what a brief cites, and findings sit in its Related tab. The `raw` route went with it; its offset tests moved to `emails`.
- 2026-10-04 (S3 pages): Setup is a List over `reactivation.setting`, rows built per request from the profile, the import and the sending config (the S2 `rows` pattern). Change (E) asks for new wording on three rows only: what you place, voice, signature. Client only, so the demo shows it read-only and the server refuses demo writes. Sending rules stay Wren's call. The `setup` route is gone.
- 2026-10-04 (S3 pages): Glance stays a plain component: it's the launcher card, not a page.
- 2026-10-04 (S3 pages): `reactivation.css` is deleted. What's left of it is Tailwind classes in the module files.
- 2026-10-04 (S3 pages): Reactivation module code went from 1,724 lines to 1,052. All modules went from 4,942 to 4,270.
- 2026-10-04 (S3 pages): Project pages are records: `delivery.step`, `.update`, `.ask`, `.deliverable`, `.paperwork` and `.result`, built per request from what `deliveryHome` reads for the viewer, so a client never gets a team note. Served at `delivery/records*`. A product's app asks for its own projects (`app`); the work app gets all of them. Ids: step and result are `<project>.<key>`, paperwork is `c`, `f` or `a` plus an id.
- 2026-10-04 (S3 pages): Plan, Updates, Paperwork and Results are Lists. Needs you and Deliverables are Queues. The team posts, notes, asks, hands over, moves steps and marks them done from the same pages. The client answers, approves, asks for changes and grants access. The team sees the client's buttons too; the server lets operators act for a client.
- 2026-10-04 (S3 pages): Template additions. A form action can run per record (`each`). Its fields can be long, date, number, url, file or optional. A file uploads before the call, and the handler gets its key. Queue gets head form buttons, as List has.
- 2026-10-04 (S3 pages): Overview takes a `below` component. The work app's Overview and reactivation's put the review and the weekly pulse there (Feedback), so the Friday mail's links work again; step 1 had dropped them.
- 2026-10-04 (S3 pages): Home's welcome checklist and Needs you panel are dropped. The Overview's tiles (Needs you, Waiting on your OK, Paperwork to do, Steps done) and lists (What's next, Latest updates, Results so far) cover them. Comments stay a hand component in the record panel.
- 2026-10-04 (S3 pages): `deliver` infers the kind from what it's given: a file, a Loom, a Google doc, else a link.
- 2026-10-04 (S3 pages): The contract prints alone through `data-print` and one print rule in `app.css`, not a module file. Biome now accepts the kit's `Input` and `Textarea` as label controls.
- 2026-10-04 (S3 pages): `work.css` is deleted. Work module code went from 2,263 lines to 1,331. All modules went from 4,270 to 3,351.
- 2026-10-04 (S3 pages): A record shows its Sources tab only when the page gives sources. Overview and Queue grids get `minmax(0,1fr)` columns so long titles truncate at 390 instead of widening the page.
- 2026-10-04 (S3 look): `kit.css` is deleted. Its tokens and base moved into `tailwind.css`, and every part is Tailwind classes over the `--ui-` tokens. Themes still set those tokens on the root. The `ui-theme` scope class is gone; nothing used it.
- 2026-10-04 (S3 look): Dead parts deleted: Drawer, Pager, Tabs, SearchField, BarList, Tally, Card, CardList, Stat, StatStrip and ThemeScope. Loading ghosts are shadcn's Skeleton. Overlays use `--ui-scrim`.
- 2026-10-04 (S3 look): The auth app builds Tailwind too. Its buttons were shadcn parts with no Tailwind loaded.
- 2026-10-04 (S3 look): `ui-trail`, `ui-trail-step` and `ui-source-head` stay as unstyled markers: the demo video script finds elements by them.
- 2026-10-04 (S3 look): `@wren/ui` went from 8,193 code lines and 2,820 CSS lines to 8,380 and 302. Modules stay at 3,366.
- 2026-10-04 (S3 look): Pipeline's Overview was slow from load, not one bad plan. Each firm tile scans companies, documents, people and leads whole (about 190 MB, 300 ms alone), nine run at once, and "Crawled, no person" came back last at 33 s. Covering indexes make `email_firm_records` read indexes only (about 12 times less). `ix_documents_company_id` and `ix_people_company_id` are dropped: the new indexes start with the same column.
- 2026-10-04 (S3 look): One `--ui-radius`, 0. The six radius tokens fold into it, and shadcn's radius scale is made from it. Status dots and step marks stay round: they are marks, not surfaces. The soft preset sets 12px.
- 2026-10-04 (S3 look): One border gray, `--ui-hair` at 11% ink. `--ui-rule` and `--ui-line` are gone. Shadows only on overlays: the record panel keeps `--ui-shadow`, and shadcn's menus and dialogs keep theirs. The window, cards and launcher cards lose theirs; a launcher card washes on hover instead of lifting.
- 2026-10-04 (S3 look): The body already sets tabular figures. One `money` in format.ts: cents in lists, whole units in tiles, en-US currency symbols. Billing's and the AI spend chip's own formatters are gone. Lists already share one 40px row; Billing's Table, the one that didn't, moves onto a List in the polish step.
- 2026-10-04 (S3 look): A list column is as wide as its preset or as its head, longest state label or "10 minutes ago" needs (`widthOf`), so "Follow-ups only" and "Failures in a row" fit. A record's details skip every empty field, so a campaign with no override shows no "Set" rows. A campaign's title is its name, "Agencies", in its list, panel and Overview alike.
- 2026-10-04 (S3 look): Overview tiles sit at most four to a row, as even as they go (5 is 3 and 2), on a 12-column grid. On a phone, two to a row; an odd last one takes the whole row.
- 2026-10-04 (S3 look): A List's or Queue's title is its page's nav name, not the type's plural. The record panel's sides are 16px on a phone and its tabs spread to fit.
- 2026-10-04 (S3 look): Template addition: Form (`template: "form"`), for Setup. A line per record in sections by its first status field, values wrap, an action that applies sits on its line. No checkboxes, sort or export. Setup was the only page that needed it.
- 2026-10-04 (S3 look): Relative times count whole units and say the number: 18 months is "1 year ago", not "2 years ago" or "last year"; a day back is "1 day ago".
- 2026-10-04 (S3 look): Billing is a List over `delivery.invoice` (All invoices, To pay). Its rows are read only for an owner or Wren; anyone else gets 403, as the old `invoices` route did. That route, `Table` and shadcn's table are deleted.
- 2026-10-04 (S3 look): After the covering indexes, "Crawled, no person" takes 0.5 s alone, down from 33 s. Its SQL takes 0.2 to 0.4 s. Beside the other eight tiles it takes 1.4 to 2.4 s, and the slowest tile takes 4.5 s. The load is the nine scans at once, not one plan.
- 2026-10-04 (S3 look): Clients has Invite on a client's row. It asks for an email and invites an owner, who invites the rest from Account. It is not offered on demo rows.
- 2026-10-04 (S3 look): People has Mark called (C, bulk, undo). A new `calls` table records who called and when. Last contact is the later of the CRM's date and the last call, and the history shows "Called" with who. CRM rows stay as the CRM holds them. Undo removes your newest call. The score still reads the CRM's date (S4). The demo marks calls in the browser, timed from when the page loaded.
- 2026-10-04 (S3 look): Sonner injects its CSS as a `<style>`, which the CSP blocks. The portal build stops the inject, since the same CSS is already in the stylesheet. The build fails if sonner changes that code.
- 2026-10-04 (S4): A brief's facts give a role's start month ("moved to Acme in Sep 2025"), not the profile's dates with their duration and place. The prompt asks for one plain first sentence and never says where a fact came from or when it was read. Briefs are v5, so every client's are rewritten on their next run.
- 2026-10-04 (S4): A brief's CRM facts give month and year ("last contacted Apr 2025"), not "2025-04-01", so the model copies a plain date the way it copies a start month. Briefs are v6.
- 2026-10-04 (S4): A mover's Email is their address at the new firm with its verdict, or nothing until one checks out. Their CRM address shows as "Old email" under Where now, without its verdict, so no red "Invalid" sits on someone to call. People's Email column reads the same.
- 2026-10-04 (S4): A record's fact named like a field takes that field's place. The person's Email uses it to show the address beside its verdict.
- 2026-10-04 (S4): Why this score lists the reasons in words, no points. The first reason is the `reason` field, so a list can show it.
- 2026-10-04 (S4): An Overview list can read one field in full under each title (`line`). Call first shows each person's top reason there.
- 2026-10-04 (S4): The demo banner is gone, and the shell's notice with it. The top bar's chip reads "Sample firm" and links to What's real, a hidden reactivation page only the demo sees (audience `demo`). It says what is real, what is made up, what Wren wrote, and that actions reset on reload.
- 2026-10-04 (S4): A Queue takes an `example`, shown in place of its empty line. Only the demo passes one: Replies walks through what happens when someone replies, tagged Example, with a dashed frame and a quoted sample reply so it never reads as a real one.
- 2026-10-04 (S4): A demo action the page doesn't know says "That action isn't on this page.", not that it works once the list is live.
- 2026-10-04 (S4): Firm and reply rows show the campaign's name ("Recruiting"), made in SQL the way the Campaigns list makes it, so the three views share one rule. `niche` stays on each view for related lists. A key like `sec_ria` reads "Sec ria" everywhere until a niche carries its own label.
- 2026-10-04 (audit): Two numbers from the direction plan's Now #1 had no page after S2 moved the apps onto records. Outbound gains Variants: each copy version that sent, with its reply rate and interval (`email.variant`, from `reply_by_arm_step`). Pipeline gains Stalls: per campaign, catch-all and risky leads, firms in the resolution queue, and crawled firms with no person (`email.stall`, from `pipeline_leaks`). Cost per stage stays as Model usage by kind, since `email_stage_costs` has tokens, not dollars.
- 2026-10-06 (hierarchy pass): Tokens `--ui-warn`, `--ui-warn-ink` (amber text, 5.9:1) and `--ui-warn-tint`; `--warn` reads `--ui-warn`. Muted labels that used `--ui-ink-3` as text (record states and key fields, view counts, queue dates) move to `--ui-ink-2`. A list's create form is its primary button.

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

### S4. Demo and product depth

1. Product depth 1 to 3.
2. The demo rules. The list's size waits on William's yes.

## Done when

- S1: People and Emails screenshot well on the demo and the app host. The finding type is under 80 lines with no JSX. Module line counts before and after are noted here. Gates pass.
- S2: Every operator app screenshots on prod as the operator with real numbers. Every stat opens its rows.
- S3: `kit.css` and the module CSS files are gone. No module file renders a `<table>` or imports CSS.
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

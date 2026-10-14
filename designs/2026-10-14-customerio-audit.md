# customer.io audit, and a simpler portal

Living doc. Started 2026-10-14. Two of William's notes:

- "Investigate and compare / contrast our app to customer.io (google sign in with wrenautomation email, autobrowse audit) to see what we are lacking compared to them"
- "UI from big apps (copy UI feel), simplify user experience", and later on 10-14: "60-30-10 rule for better feel in the UI, 4.5 to 1 minimum contrast for all text (definitely is failing on some of the filters)"

## How I looked

On 10-14 I signed up through autobrowse with Google as william@wrenautomation.com. That started a 14-day trial with no card. Then I walked every section: Home, Agent, Reports, Profile activity, Message activity, Automations (the builder and its triggers), Broadcasts, Transactional, Message library, People, Custom objects, Segments (the builder), Design Studio, Assets, Data index, Integrations, More, and Workspace settings. Cost $0.

Autobrowse fix found on the way: `--login <site>` sessions could not type a stored authenticator code. `<site>.code` now asks the stored TOTP first (autobrowse e932ced).

## Answer first

customer.io is built around one profile per person, holding every event they did and every message they got. Wren has no such profile. Segments, the data index, the activity timeline, attribute and date triggers, broadcasts to a segment, and ad audience sync all sit on that profile. Wren keys rows by channel address instead: `leads` by email, `sms_contacts` by phone, `social_handles` by handle, `consents` by address, reactivation contacts by CRM id. So each app knows part of a person and no page knows the whole person.

Once Wren has that profile layer, most of the other gaps are small builds on top of it.

Wren is ahead on cold outbound (mailbox fleet, deliverability seeds, send policy), site tooling (flags, experiments, replays, heatmaps), one-click template install, and one database per client. customer.io has none of these.

## Gaps

| # | customer.io | Wren today | Build |
|---|---|---|---|
| 1 | People: one profile, traits, every identity (email, phone, device, anonymous id) merged | Separate per-channel rows, no merge, `wv` visitor cookie kept but never joined | **B1** profiles |
| 2 | Profile activity: every event and message for one person, anonymous then identified | Inbox thread (messages and touches), reactivation feed, consent feed, site sessions apart | **B1** timeline |
| 3 | Data index: every attribute and event name with sources, usage and people counts | Custom fields per record type, workflow events list | **B1** data index |
| 4 | Message activity: one sent log across channels, delivery states, CSV | One list per channel, opens and clicks tracked but never shown per message | **B2** sent log |
| 5 | Segments: data-driven, manual, snapshot; 12 condition kinds; AND/OR; size and usage; auto-archive unused | Saved views (filters on one list) | **B5** segments |
| 6 | "Describe segment": plain words to conditions | none | **B5** |
| 7 | Triggers: attribute or segment change, event, form, important date, webhook | event, form, webhook, booking, payment, deal stage and more; no attribute, segment or date triggers | **B5** |
| 8 | Broadcasts: one-time send to a segment, scheduled, calendar, best send time | Newsletter to a topic, plain text, sent now | **B6** broadcasts |
| 9 | Message frequency limits across all channels | per channel only (`mayMarket`, SMS 4 in 31 days) | **B4** |
| 10 | URL parameters added to every link | only on `/o/` pages and `/go/` links | **B4** |
| 11 | CSV import of people in the app | CLI only | **B4** |
| 12 | Global search: automations, people, docs | ⌘K finds pages and actions; records only in Learn | **B3** |
| 13 | Setup checklist ("1 of 3 done") | setup items on Today, no progress card | **B3** |
| 14 | Ad audiences tab on a segment (Meta, Google) | Meta ads read only | later, after B5 and Meta verification |
| 15 | Transactional API (template plus data) | none | later, when a client asks |

Already have: message library (Library), subscription center with topics and consent proof (Marketing → Topics, Subscribers), local-time send windows, workflow templates, test runs.

## Skip

| Idea | Why not |
|---|---|
| In-app messages, notification inbox, mobile push SDK | Our clients are local businesses without apps. Site chat covers on-site talk. |
| LINE, Slack messages to customers | No client asks. WhatsApp is already planned and waits on Meta. |
| Drag-and-drop email editor, brand styles | Cold mail is plain text on purpose. Revisit for marketing mail when a client sends newsletters with images. |
| Translations per message | US clients, English. |
| Agent chat with prompt chips on every page | Skipped once already (2026-10-04-borrowed-ui.md: "Ask AI on every page"). Ask and the inline Ask Claude stay. |
| Custom objects in settings | Records are declared in code (same reason as Twenty in borrowed-ui). |
| Schedule-a-call banner, test-mode banner on every page | They sit above every page. Ours shows setup on Today. |

## B1: profiles

One profile per person in each workspace database.

- `profiles`: id, name, first seen, last seen, merged_into (null while live).
- `profile_keys`: profile_id, kind (`email`, `phone`, `handle:<platform>`, `visitor`, `crm:<source>`, `person`), value (normalized), source, first seen. Unique on (kind, value).
- `profile_traits`: profile_id, key, value (jsonb), source, at. One row per key holds the current value. A change writes `profile_trait_events` (old, new, source, at), which B5's trait-change trigger reads.
- `resolveProfile(keys, source)` in core: find every profile any key points at. If none, create one. If one, add the new keys. If two or more, merge into the oldest: move keys and traits (newer value wins), set `merged_into`, write `profile_merges`. A merge never deletes a row.
- Writers: every place that makes or reads a channel address calls `resolveProfile`. That covers lead import, people import (email on the person), SMS contacts, consents, social handles, reactivation contacts, site form entries (email or phone plus the `wv` cookie, which joins the earlier anonymous visits), site chat, bookings, payments, connector pulls. A backfill job covers rows that already exist.
- Timeline: one view over the source tables, keyed by profile key, never copied. Sources are email messages, texts, touches, consent events, site visits by `wv`, form entries, bookings, payments, calls, and spine events that carry a key. Each line has the time, kind, channel, a one-line summary and a link to its row.
- Portal: a **People** app (Leads area). Pages: People (list: name, emails, phones, channels, last seen, consent), the profile (traits, keys, the timeline with a kind filter, merges), and **Data index** (every trait key and every timeline kind, with sources, how many people, last seen, and which workflows or segments use it).
- Map: new cards `leads/profile`, `leads/profile-key`; edits to `person`, `lead`, `touch` "connected to".

## B2: sent log

One page for every message we sent, on any channel.

- A view over email `messages`, `sms_messages`, DMs (`reach_messages`), comments we posted, newsletter sends and marketing mail. One state ladder for all of them: queued, sent, delivered, bounced, failed, opened, clicked, replied. Each row keeps its channel's own state too.
- Columns: when, channel (PlatformMark), to (the profile once B1 lands, else the address), subject or first line, state, campaign or workflow.
- Opening a row shows the message as it rendered (`MessagePreview`) and its state history.
- Views: All, Bounced and failed, Opened, Replied. CSV export comes from the list template.
- Lives at People → Sent.

## B3: simpler portal

What big apps do that we don't, from customer.io, Linear, Stripe and Intercom, checked against our own screens on 10-14.

1. **One primary button per page.** Columns, Group by and density go in one **Display** popover (Linear). Export CSV, Export JSONL and Copy link go in one **⋯** menu. Inbox → Waiting on you had six controls in its header and now shows one.
2. **Five tabs at most.** The default view and the next four by declared order stay as tabs. The rest go under **More ▾** with their counts. A view with no rows sits in More unless it is the default. Inbox had 13 tabs.
3. **Filters appear when used.** The bar shows search and Filter. A field filter (Site, Status, Type) shows as a chip only once it's set. Today every facet dropdown shows all the time.
4. **One line under each title** that says what the page is for (customer.io does this on every page). Each page declares `about`. Write the line for every page.
5. **Counts only where something waits on you.** Inbox and To approve keep their numbers. Today's 195 is gone.
6. **Shortcut hints move to `?`**, a shortcut sheet. They no longer sit as a footer under every list.
7. **Page column labels never cut off.** "Waiting on …" wraps or the column widens.
8. **⌘K searches records.** Each app's `find` covers people (B1 profiles, or leads before that), clients, deals, workflows, templates and pages. Results group by app, with recent items first.
9. **Setup card on Today.** "Get set up · 2 of 5 done", with a bar and the next step's button, built from the existing setup items. It is gone once all are done.
10. **60-30-10 color.** In every look, about 60% of the screen is the base (page background), 30% is surfaces (rail, panels, cards, table heads), and 10% is the accent. The accent marks only the one primary button, the active nav item or tab, links, focus, and real-event state. Secondary buttons are outline or ghost. On Today, each Make row's action moves from a filled accent button to an outline one, and only the page's primary stays filled. Tokens enforce it: components take `accent` only through the primary button, active and link tokens.
11. **4.5:1 contrast for all text.** Every text color on every background it sits on, in every look (light, dark, client looks and William's showcase ones), meets WCAG AA 4.5:1. Placeholders, muted lines, filter chips, tab counts, disabled labels and badges are included. Large text gets no 3:1 exception: William said all text. Two checks keep it that way: a unit test that computes the ratio for every text token on every surface token in every look, and an axe `color-contrast` scan of every portal page in each look in CI. Fix the failures first (William: "definitely failing on some of the filters").
12. **Soft pagination.** The square page boxes go. The pager matches the rest of the portal (Notion/Slack feel): a rounded radius token, quiet ghost buttons, and the current page as a subtle filled pill, not a hard box. Fixed once in the kit pager, so every list gets it.
13. **Row actions everywhere.** Act on a row without opening it. In every records table and list in the kit, desktop hover or keyboard focus shows the row's 2-4 main actions as icon buttons at its right end, plus a ⋯ menu for the rest. On phone, the same actions are swipe actions. Reply opens an inline composer under the row, not the detail page. Delete or archive is undoable from a toast, with no confirm. Actions come from each record type's existing actions, so every app gets them without per-page code. Then each app's tables are checked for the right actions (reply, archive, approve, mark done and so on).

Check every change on desktop, at WebKit 393 (phone), and in both the light and dark looks.

## B4: small ones

- **Frequency cap across channels.** A per-person cap for marketing messages across email, SMS and DMs together: per day, per week, with a client default. `mayMarket` checks the total. Cold outbound keeps its own policy. Transactional mail (opt-in confirm, receipts) is exempt.
- **URL parameters on every link.** A client setting (on by default) adds `utm_source=<client>`, `utm_medium=<channel>`, `utm_campaign=<workflow, broadcast or campaign slug>` to every http link in marketing mail, texts and DMs. It never overwrites a parameter that's already there, and it skips our own tracked `/go/` links, which add their own.
- **CSV import in the portal.** Upload, map columns (auto-guessed and editable), preview 10 rows, import. It writes through the same importers as the CLI (`wren email import`, `wren crm import`), so the checks are the same. The import shows as a row with counts (new, merged, skipped and why).

## B5 and B6 (after B1)

- **B5 segments.** Live (recomputed on change), manual (a list), snapshot (frozen at a moment). Conditions on traits, timeline kinds (did X at least N times in the last D days), consent, message state (opened, clicked, bounced) and other segments, with AND/OR groups. They compile to SQL over B1 and are checked by tests. Each segment shows its size, members and where it's used. **Describe segment**: plain words become conditions, which are shown for a yes before saving. Triggers: entered or left a segment, a trait changed, a date trait (a renewal or a birthday, with an offset). Segments unused for 90 days get archived, and one click restores them.
- **B6 broadcasts.** One send to a segment, by email or text. Now or scheduled. Recipient local time is optional. A calendar shows the month. Every broadcast goes to To approve first. The frequency cap, consent and suppressions gate each recipient. There's a Send test. Results come from the B2 sent log.

## B7: close the B1 and B2 gaps

William, 10-14: "these gaps need fixing too."

- **Client forms, pay links and calendars write profiles.** These rows live in Wren's main database, and the profile lives in the client's workspace database. When one lands for a client, resolve the profile in that client's workspace. A workspace view can't read the main database, so a new workspace table `profile_events` holds one line per row that lives elsewhere: profile, kind, at, summary, source table and id, and a link. The timeline unions it in. This is the only copy, and it is limited to sources outside the workspace. The backfill covers rows that already exist. Payments come from the pay link rows, so the `sms_contacts.paid_at` stand-in goes.
- **Site visits on the timeline.** Wren's own profiles: the timeline reads the lander export live by each `visitor` key, the same way the call brief's "On the site" does. Visit lines are shown, never stored. Client sites keep no visitor id or cookie (2026-10-07-sites.md). Instead, a client page keeps the current visit's page list in `sessionStorage` and sends it with a form. It's stored on the form entry, so the timeline shows the pages seen before that form. Nothing leaves the browser unless the person sends the form.
- **Clicked.** Store email clicks. An hourly pull of the lander export writes `email_clicks` (message, url, first and last at, count) by `link_code`. Clicks on `/go/` links in texts and DMs go there too when the link carries a code. The sent log reads it. `wren email clicks` reads the table instead of the export.
- **Delivered for email.** Email has no receipt. An email counts as delivered once 48 hours pass with no bounce, or sooner on an open, click or reply. The state history says which.

## Build order

B1 through B4 run at once, one builder each. B5 and B6 start after B1 lands. Builders commit locally and never push. The main session pushes from a clean worktree. Each new migration takes the next free number at commit and is renumbered on a rebase if another builder took it.

## Decision log

- 2026-10-14: The profile layer reads the source tables for the timeline instead of copying events. Copying would double storage and drift from the source.
- 2026-10-14: People becomes its own app in the Leads area. Marketing → People (social touches) and Reactivation → People stay and link to the profile.
- 2026-10-14 (B1 built): A merge keeps the older profile. The younger keeps its row with `merged_into`, its keys move, and only its newer traits are taken, each logged as a trait change. Nothing is deleted, so a wrong merge can be traced.
- 2026-10-14 (B1 built): Writers call `noteProfile`, which never throws. A profile failure never blocks an import, a send or a booking; the backfill (`wren people backfill`) catches up anything missed.
- 2026-10-14 (B1 built): A client's forms, pay links and calendars live in Wren's main database, so only Wren's own form entries, bookings and chats write profiles. A client's payments show on the timeline from `sms_contacts.paid_at`. Site visits by the `wv` cookie aren't in Postgres; the cookie is kept as a `visitor` key when a form carries it.
- 2026-10-14 (B7): Clicks are stored. The 09-29 "read only, nothing stored" choice in `clicks.ts` was about keeping one copy, and the sent log needs clicks in SQL. Clicks belong to a message we sent, like opens, so the no-visitor-id rule doesn't apply. Visits stay live reads.
- 2026-10-14 (B7 built): A client's calendar bookings were already in its workspace, so they need no copy. Each booking now notes the profile in whichever database holds it, and the timeline reads every calendar there. Only form entries and pay links go through `profile_events`.
- 2026-10-14 (B7 built): A pay link gets a line once it's sent. Its summary changes when it's paid. A draft or a declined link adds nothing. The line's time is when it was paid, or when it was sent if unpaid.
- 2026-10-14 (B7 built): A form line's channel is always `site`. `site_forms.channel` is the attribution channel (ads, organic), not where it happened.
- 2026-10-14 (B7 built): The kit records up to 30 page paths for the tab. A reload doesn't add a path again. A bad list never loses the form: the server checks it and keeps null. Visits on a Wren profile show only on its page, read live, as up to 40 lines across up to 5 visitor keys. They never appear in the Timeline list.
- 2026-10-14 (B5 built): Members are stored, not computed per read. An entry or exit is then a dated fact the spine can fire on, and B6 sends to a fixed list. One statement moves members and logs each move.
- 2026-10-14 (B5 built): Row triggers on traits, keys, `profile_events` and `segments` wake the pass at commit. Timeline sources read live (texts, mail, touches) have no trigger, so `SegmentsNet` wakes every workspace every 15 minutes. A pass runs at most every 30 seconds.
- 2026-10-14 (B5 built): A workspace's first pass starts at the newest entries and trait changes. History never fires. Date triggers fire once a day from 09:00 New York; a Feb 29 date fires on Feb 28 in other years.
- 2026-10-14 (B5 built): "Used" means a workflow's Segment trigger, another segment's rule, or a `segmentMembers` read (B6). Archiving by hand is refused while anything uses it. Describe segment never saves; a client's describe runs on its metered model, part `people.segments`.
- 2026-10-14 (B5 built): A message condition counts the state and every state past it on the sent log's ladder, so "opened" includes clicked.
- 2026-10-14 (B6 built): A broadcast reads its segment once, when it starts. Each person then has their own row and time. Local time means the same wall clock in each person's zone, and it starts when the first zone reaches it. Anyone whose zone is unknown gets the broadcast's own zone.
- 2026-10-14 (B6 built): A yes in To approve schedules it. Nothing else does. Decline and Cancel make it editable again. Editing an asked or approved one puts it back in To approve. Each schedule replaces the one before, so a stale wake ends on its own.
- 2026-10-14 (B6 built): `mayMarket` gates each person on consent, suppressions and the cap. A capped person is held until `marketingRoomAt` and tried again then, as queued follow-ups are. A person with no address on the channel, or with no yes to the topic, is skipped with the reason. Email goes in batches of 20 at most 1,500 a day.
- 2026-10-14 (B6 built): A text is handed to the texts sender as an `sms_messages` row (kind `broadcast`). That row keeps quiet hours, the opt-out and one copy per person. A person with no texts thread is skipped; a broadcast never opens one.
- 2026-10-14 (B6 built): A client's email broadcast refuses (503, "in development"): a client has no marketing mail sender yet. Texts work for clients. A test email goes only to our own domain. A test text goes only to the operator's phone, through its existing thread. Both are marked [test] and recorded only as the last test.
- 2026-10-14 (B6 built): Results are the sent log's rows (`broadcast` column), counted on its ladder. Email has no bounce reading yet, so "delivered" is the sent log's 48-hour rule. A broadcast is `sent` once nobody waits. A held person still counts as waiting.
- 2026-10-14 (B6 built): A broadcast's segment use is written on each segments pass, the same as a workflow's. A broadcast not yet done (draft through sending) keeps its segment from being archived.

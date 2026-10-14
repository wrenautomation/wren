# customer.io audit, and a simpler portal

Living doc. Started 2026-10-14. Two of William's notes:

- "Investigate and compare / contrast our app to customer.io (google sign in with wrenautomation email, autobrowse audit) to see what we are lacking compared to them"
- "UI from big apps (copy UI feel), simplify user experience"

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

Check every change on desktop, at WebKit 393 (phone), and in both the light and dark looks.

## B4: small ones

- **Frequency cap across channels.** A per-person cap for marketing messages across email, SMS and DMs together: per day, per week, with a client default. `mayMarket` checks the total. Cold outbound keeps its own policy. Transactional mail (opt-in confirm, receipts) is exempt.
- **URL parameters on every link.** A client setting (on by default) adds `utm_source=<client>`, `utm_medium=<channel>`, `utm_campaign=<workflow, broadcast or campaign slug>` to every http link in marketing mail, texts and DMs. It never overwrites a parameter that's already there, and it skips our own tracked `/go/` links, which add their own.
- **CSV import in the portal.** Upload, map columns (auto-guessed and editable), preview 10 rows, import. It writes through the same importers as the CLI (`wren email import`, `wren crm import`), so the checks are the same. The import shows as a row with counts (new, merged, skipped and why).

## B5 and B6 (after B1)

- **B5 segments.** Live (recomputed on change), manual (a list), snapshot (frozen at a moment). Conditions on traits, timeline kinds (did X at least N times in the last D days), consent, message state (opened, clicked, bounced) and other segments, with AND/OR groups. They compile to SQL over B1 and are checked by tests. Each segment shows its size, members and where it's used. **Describe segment**: plain words become conditions, which are shown for a yes before saving. Triggers: entered or left a segment, a trait changed, a date trait (a renewal or a birthday, with an offset). Segments unused for 90 days get archived, and one click restores them.
- **B6 broadcasts.** One send to a segment, by email or text. Now or scheduled. Recipient local time is optional. A calendar shows the month. Every broadcast goes to To approve first. The frequency cap, consent and suppressions gate each recipient. There's a Send test. Results come from the B2 sent log.

## Build order

B1 through B4 run at once, one builder each. B5 and B6 start after B1 lands. Builders commit locally and never push. The main session pushes from a clean worktree. Each new migration takes the next free number at commit and is renumbered on a rebase if another builder took it.

## Decision log

- 2026-10-14: The profile layer reads the source tables for the timeline instead of copying events. Copying would double storage and drift from the source.
- 2026-10-14: People becomes its own app in the Leads area. Marketing → People (social touches) and Reactivation → People stay and link to the profile.
